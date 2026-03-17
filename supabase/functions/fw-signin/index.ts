/**
 * fw-signin — Fantasy Wars email sign-in
 *
 * POST /functions/v1/fw-signin
 * Body: { email, password }
 *
 * Returns: { token, user: { id, email, displayName, tier, products[] } }
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET           = Deno.env.get('SUPABASE_JWT_SECRET')!;
const TOKEN_TTL_SECONDS    = 60 * 60 * 24 * 7; // 7 days

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return json({ error: 'Email and password are required.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Look up user ──────────────────────────────────────────
    const { data: user } = await admin
      .from('app_users')
      .select('id, email, display_name, password_hash')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (!user) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    // ── Verify password ───────────────────────────────────────
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    // ── Fetch active subscriptions ────────────────────────────
    const { data: subs } = await admin
      .from('subscriptions')
      .select('product_slug, tier, status')
      .eq('user_id', user.id)
      .eq('status', 'active');

    const products = (subs ?? []).map((s) => s.product_slug);
    // Highest tier wins: if any sub is 'pro', user is pro
    const tier = (subs ?? []).some((s) => s.tier === 'pro') ? 'pro' : 'free';

    // ── Issue JWT ─────────────────────────────────────────────
    const token = await mintJWT(user.id, user.email, tier, products);

    return json({
      token,
      user: {
        id:          user.id,
        email:       user.email,
        displayName: user.display_name,
        tier,
        products,
      },
    });

  } catch (err) {
    console.error('fw-signin error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
});

async function mintJWT(
  userId: string,
  email: string,
  tier: string,
  products: string[],
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  return create(
    { alg: 'HS256', typ: 'JWT' },
    {
      iss:  SUPABASE_URL + '/auth/v1',
      sub:  userId,
      role: 'authenticated',
      exp:  getNumericDate(TOKEN_TTL_SECONDS),
      iat:  getNumericDate(0),
      app_metadata: { user_id: userId, email, tier, products },
    },
    key,
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

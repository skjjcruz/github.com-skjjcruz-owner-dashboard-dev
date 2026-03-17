/**
 * fw-signup — Fantasy Wars email registration
 *
 * POST /functions/v1/fw-signup
 * Body: { email, password, displayName?, productSlug? }
 *
 * Returns: { token, user: { id, email, displayName } }
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

const SUPABASE_URL            = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET              = Deno.env.get('SUPABASE_JWT_SECRET')!;
const TOKEN_TTL_SECONDS       = 60 * 60 * 24 * 7; // 7 days

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { email, password, displayName, productSlug = 'war_room' } = await req.json();

    // ── Validate inputs ──────────────────────────────────────
    if (!email || !password) {
      return json({ error: 'Email and password are required.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: 'Invalid email address.' }, 400);
    }
    if (password.length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // ── Check for existing account ────────────────────────────
    const { data: existing } = await admin
      .from('app_users')
      .select('id')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (existing) {
      return json({ error: 'An account with this email already exists.' }, 409);
    }

    // ── Hash password + create user ───────────────────────────
    const passwordHash = await bcrypt.hash(password, 12);
    const { data: newUser, error: insertErr } = await admin
      .from('app_users')
      .insert({
        email:         email.toLowerCase().trim(),
        password_hash: passwordHash,
        display_name:  displayName?.trim() || email.split('@')[0],
      })
      .select('id, email, display_name, created_at')
      .single();

    if (insertErr || !newUser) {
      console.error('Insert error:', insertErr);
      return json({ error: 'Failed to create account. Please try again.' }, 500);
    }

    // ── Provision free subscription for chosen product ────────
    await admin.from('subscriptions').insert({
      user_id:      newUser.id,
      product_slug: productSlug,
      tier:         'free',
      status:       'active',
    });

    // ── Issue JWT ─────────────────────────────────────────────
    const token = await mintJWT(newUser.id, newUser.email, 'free', [productSlug]);

    return json({
      token,
      user: {
        id:          newUser.id,
        email:       newUser.email,
        displayName: newUser.display_name,
        tier:        'free',
        products:    [productSlug],
      },
    });

  } catch (err) {
    console.error('fw-signup error:', err);
    return json({ error: 'Internal server error.' }, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────

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

/**
 * fw-signin — Fantasy Wars email sign-in
 *
 * POST /functions/v1/fw-signin
 * Body: { email, password }
 *
 * Returns: { token, user: { id, email, displayName, tier, products[] } }
 *
 * Uses Web Crypto PBKDF2 for password verification (no external deps).
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { create, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts';

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

    // ── Verify password (PBKDF2) ──────────────────────────────
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return json({ error: 'Invalid email or password.' }, 401);
    }

    // ── Fetch active subscriptions ────────────────────────────
    const { data: subs, error: subsErr } = await admin
      .from('subscriptions')
      .select('product_slug, tier, status')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (subsErr) {
      console.error('fw-signin subscriptions error:', subsErr);
      return json({ error: `Subscriptions query failed: ${subsErr.message} (${subsErr.code})` }, 500);
    }

    const products = (subs ?? []).map((s) => s.product_slug);
    const tier     = (subs ?? []).some((s) => s.tier === 'pro') ? 'pro' : 'free';

    // ── Issue JWT ─────────────────────────────────────────────
    let token: string;
    try {
      token = await mintJWT(user.id, user.email, tier, products);
    } catch (jwtErr) {
      console.error('fw-signin JWT error:', jwtErr);
      return json({ error: `JWT minting failed: ${jwtErr instanceof Error ? jwtErr.message : String(jwtErr)}` }, 500);
    }

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
    return json({ error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` }, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────

/**
 * Verify a password against a stored "saltHex:hashHex" string produced by fw-signup.
 * Uses PBKDF2-SHA256 with the same parameters.
 */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [saltHex, hashHex] = stored.split(':');
    if (!saltHex || !hashHex) return false;
    const fromHex = (h: string) => new Uint8Array(h.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    const salt = fromHex(saltHex);
    const enc  = new TextEncoder();
    const key  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
      key, 256,
    );
    const newHex = Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
    return newHex === hashHex;
  } catch {
    return false;
  }
}

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

/**
 * fw-signin — Dynasty HQ email sign-in
 *
 * POST /functions/v1/fw-signin
 * Body: { email, password }
 *
 * Returns: { token, user: { id, email, displayName, tier, products[] } }
 *
 * Uses Web Crypto PBKDF2 for password verification (no external deps).
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import { SignJWT } from 'npm:jose';
import {
  auditEvent,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  handleOptions,
  json,
  normalizeEmail,
} from '../_shared/security.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const JWT_SECRET           = Deno.env.get('JWT_SECRET')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const { email, password } = await req.json();
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !password) {
      return json(req, { error: 'Email and password are required.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const ipLimit = await checkRateLimit(admin, 'fw-signin:ip', clientIp(req), { limit: 30, windowSeconds: 900, lockoutSeconds: 900 });
    const emailLimit = await checkRateLimit(admin, 'fw-signin:email', normalizedEmail, { limit: 8, windowSeconds: 900, lockoutSeconds: 900 });
    if (!ipLimit.allowed || !emailLimit.allowed) {
      await auditEvent(admin, req, 'fw_signin_rate_limited', 'blocked', { email: normalizedEmail }, {
        ipRetryAfter: ipLimit.retryAfterSeconds || null,
        emailRetryAfter: emailLimit.retryAfterSeconds || null,
      });
      return json(req, { error: 'Too many sign-in attempts. Try again later.' }, 429);
    }

    // ── Look up user ──────────────────────────────────────────
    const { data: user } = await admin
      .from('app_users')
      .select('id, email, display_name, password_hash, session_version')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!user) {
      await auditEvent(admin, req, 'fw_signin', 'failure', { email: normalizedEmail }, { reason: 'unknown_email' });
      return json(req, { error: 'Invalid email or password.' }, 401);
    }

    // ── Verify password (PBKDF2) ──────────────────────────────
    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await auditEvent(admin, req, 'fw_signin', 'failure', { userId: user.id, email: normalizedEmail }, { reason: 'bad_password' });
      return json(req, { error: 'Invalid email or password.' }, 401);
    }

    // ── QA reset accounts start fresh on EVERY join ───────────
    // Designated test emails (TEST_RESET_EMAILS secret) get a blank slate on
    // sign-in as well as sign-up: credentials are kept, but the account row
    // is recreated empty so the full onboarding funnel runs again. Only
    // reached after password verification succeeds.
    let isNew = false;
    if (testResetEmails().has(normalizedEmail)) {
      await admin.from('app_users').delete().eq('id', user.id);
      const { data: recreated, error: recreateErr } = await admin
        .from('app_users')
        .insert({ email: normalizedEmail, password_hash: user.password_hash, display_name: user.display_name })
        .select('id, email, display_name, session_version')
        .single();
      if (recreateErr || !recreated) {
        console.error('fw-signin test reset error:', recreateErr);
        return json(req, { error: 'Could not reset test account.' }, 500);
      }
      await admin.from('subscriptions').insert({ user_id: recreated.id, product_slug: 'war_room', tier: 'free', status: 'active' });
      await auditEvent(admin, req, 'fw_signin', 'success', { userId: recreated.id, email: normalizedEmail }, { reason: 'test_account_reset' });
      user.id = recreated.id;
      user.display_name = recreated.display_name;
      user.session_version = recreated.session_version;
      isNew = true;
    }

    // ── Fetch active subscriptions ────────────────────────────
    const { data: subs, error: subsErr } = await admin
      .from('subscriptions')
      .select('product_slug, tier, status')
      .eq('user_id', user.id)
      .eq('status', 'active');

    if (subsErr) {
      console.error('fw-signin subscriptions error:', subsErr);
      return json(req, { error: `Subscriptions query failed: ${subsErr.message} (${subsErr.code})` }, 500);
    }

    // Expand 'bundle' → both individual products so app access checks work
    const products = [...new Set(
      (subs ?? []).flatMap((s) =>
        s.product_slug === 'bundle' ? ['war_room', 'dynast_hq'] : [s.product_slug]
      )
    )];
    const tier     = (subs ?? []).some((s) => s.tier === 'pro') ? 'pro' : 'free';

    // ── Issue JWT ─────────────────────────────────────────────
    let token: string;
    try {
      token = await mintJWT(user.id, user.email, tier, products, user.session_version || 1);
    } catch (jwtErr) {
      console.error('fw-signin JWT error:', jwtErr);
      return json(req, { error: `JWT minting failed: ${jwtErr instanceof Error ? jwtErr.message : String(jwtErr)}` }, 500);
    }

    await admin.from('app_users').update({ last_sign_in_at: new Date().toISOString() }).eq('id', user.id);
    await clearRateLimit(admin, 'fw-signin:email', normalizedEmail);
    await auditEvent(admin, req, 'fw_signin', 'success', { userId: user.id, email: normalizedEmail }, { tier, products });

    return json(req, {
      token,
      // True only for QA reset accounts (fresh slate this sign-in): clients
      // route isNew sessions into the onboarding funnel.
      isNew,
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
    return json(req, { error: `Internal server error: ${err instanceof Error ? err.message : String(err)}` }, 500);
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
  sessionVersion: number,
): Promise<string> {
  const secret = new TextEncoder().encode(JWT_SECRET);
  return new SignJWT({ role: 'authenticated', app_metadata: { user_id: userId, email, tier, products, session_version: sessionVersion } })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(SUPABASE_URL + '/auth/v1')
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret);
}

// QA accounts that reset to a blank slate on every sign-in.
// Comma-separated emails in TEST_RESET_EMAILS; empty/unset disables.
function testResetEmails(): Set<string> {
  return new Set(
    (Deno.env.get('TEST_RESET_EMAILS') || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

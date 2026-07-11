/**
 * fw-signin — Dynasty HQ email sign-in
 *
 * POST /functions/v1/fw-signin
 * Body: { email, password }
 *
 * Returns: { token, user: { id, email, displayName, tier, products[] } }
 *
 * Uses Web Crypto PBKDF2 for password verification (no external deps).
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clearRateLimit,
  clientIp,
  handleOptions,
  json,
  normalizeEmail,
} from '../_shared/security.ts';
import { mintAppSessionJWT, resolveEntitlements } from '../_shared/entitlements.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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

    // ── Resolve entitlements (active + trialing, dhq-aware) ───
    let tier: 'pro' | 'free';
    let products: string[];
    try {
      ({ tier, products } = await resolveEntitlements(admin, user.id));
    } catch (subsErr) {
      console.error('fw-signin subscriptions error:', subsErr);
      return json(req, { error: subsErr instanceof Error ? subsErr.message : String(subsErr) }, 500);
    }

    // ── Issue JWT ─────────────────────────────────────────────
    let token: string;
    try {
      token = await mintAppSessionJWT({ userId: user.id, email: user.email, tier, products, sessionVersion: user.session_version || 1 });
    } catch (jwtErr) {
      console.error('fw-signin JWT error:', jwtErr);
      return json(req, { error: `JWT minting failed: ${jwtErr instanceof Error ? jwtErr.message : String(jwtErr)}` }, 500);
    }

    await admin.from('app_users').update({ last_sign_in_at: new Date().toISOString() }).eq('id', user.id);
    await clearRateLimit(admin, 'fw-signin:email', normalizedEmail);
    await auditEvent(admin, req, 'fw_signin', 'success', { userId: user.id, email: normalizedEmail }, { tier, products });

    return json(req, {
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


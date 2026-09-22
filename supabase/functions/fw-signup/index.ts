/**
 * fw-signup — Dynasty HQ email registration
 *
 * POST /functions/v1/fw-signup
 * Body: { email, password, displayName?, productSlug? }
 *
 * Returns: { token, user: { id, email, displayName } }
 *
 * Uses Web Crypto PBKDF2 for password hashing (no external deps).
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clientIp,
  handleOptions,
  json,
  isReservedTestEmail,
  normalizeEmail,
} from '../_shared/security.ts';
import { mintAppSessionJWT, resolveEntitlements } from '../_shared/entitlements.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VALID_PRODUCT_SLUGS  = new Set(['war_room', 'dynast_hq', 'bundle', 'dhq']);

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);

  try {
    const { email, password, displayName, productSlug: rawProductSlug = 'war_room' } = await req.json();
    const normalizedEmail = normalizeEmail(email);
    const productSlug = normalizeProductSlug(rawProductSlug);

    // ── Validate inputs ──────────────────────────────────────
    if (!normalizedEmail || !password) {
      return json(req, { error: 'Email and password are required.' }, 400);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return json(req, { error: 'Invalid email address.' }, 400);
    }
    if (typeof password !== 'string' || password.length < 8 || password.length > 1024) {
      return json(req, { error: 'Password must be between 8 and 1024 characters.' }, 400);
    }
    if (!VALID_PRODUCT_SLUGS.has(productSlug)) {
      return json(req, { error: 'Unknown product.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    // Existing QA addresses may use reserved domains, but public signup never
    // resets accounts or bypasses abuse limits. Explicit resets belong to the
    // authenticated administrator workflow, not an unauthenticated identity.
    const isDesignatedQa = testResetEmails().has(normalizedEmail);
    if (!isDesignatedQa && isReservedTestEmail(normalizedEmail)) {
      await auditEvent(admin, req, 'fw_signup', 'blocked', { email: normalizedEmail }, { reason: 'reserved_test_domain' });
      return json(req, { error: 'That email domain is reserved for testing and cannot receive mail. Use a real address.' }, 400);
    }
    const ipLimit = await checkRateLimit(admin, 'fw-signup:ip', clientIp(req), { limit: 10, windowSeconds: 3600, lockoutSeconds: 3600 });
    const emailLimit = await checkRateLimit(admin, 'fw-signup:email', normalizedEmail, { limit: 3, windowSeconds: 3600, lockoutSeconds: 3600 });
    if (!ipLimit.allowed || !emailLimit.allowed) {
      await auditEvent(admin, req, 'fw_signup_rate_limited', 'blocked', { email: normalizedEmail }, {});
      return json(req, { error: 'Too many sign-up attempts. Try again later.' }, 429);
    }

    // ── Check for existing account ────────────────────────────
    const { data: existing, error: lookupErr } = await admin
      .from('app_users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (lookupErr) return json(req, { error: 'Account lookup is temporarily unavailable. Try again.' }, 503);
    if (existing) {
      await auditEvent(admin, req, 'fw_signup', 'failure', { email: normalizedEmail }, { reason: 'email_exists' });
      return json(req, { error: 'An account with this email already exists.' }, 409);
    }

    // ── Hash password (PBKDF2 via Web Crypto — no external deps) ─
    const passwordHash = await hashPassword(password);

    // The service-only RPC creates the account and initial access in one
    // transaction. A provisioning failure cannot expose then delete an account
    // that a concurrent sign-in has already opened.
    const { data: created, error: provisionErr } = await admin.rpc('create_app_account', {
      p_email: normalizedEmail,
      p_password_hash: passwordHash,
      p_display_name: (typeof displayName === 'string' ? displayName.trim().slice(0, 120) : '') || normalizedEmail.split('@')[0],
      p_product_slug: productSlug,
    });
    if (provisionErr?.code === '23505') {
      return json(req, { error: 'An account with this email already exists.' }, 409);
    }
    const newUser = Array.isArray(created) ? created[0] : null;
    if (provisionErr || !newUser) {
      console.error('Account provisioning error:', provisionErr);
      await auditEvent(admin, req, 'fw_signup', 'failure', { email: normalizedEmail }, { reason: 'account_provisioning_failed', productSlug });
      return json(req, { error: 'Could not create your account. Try again.' }, 503);
    }

    // ── Issue JWT ─────────────────────────────────────────────
    // The insert trigger may also attach an existing owner-granted gift. Read
    // the same subscriptions as sign-in/profile before stamping the session.
    let tier: 'pro' | 'free';
    let products: string[];
    try {
      ({ tier, products } = await resolveEntitlements(admin, newUser.id));
    } catch (err) {
      console.error('fw-signup entitlements error:', err);
      return json(req, { error: 'Your account was created, but the session could not start. Sign in to continue.' }, 503);
    }
    const token = await mintAppSessionJWT({ userId: newUser.id, email: newUser.email, tier, products, sessionVersion: newUser.session_version || 1 });
    await auditEvent(admin, req, 'fw_signup', 'success', { userId: newUser.id, email: normalizedEmail }, { productSlug });

    return json(req, {
      token,
      user: {
        id:          newUser.id,
        email:       newUser.email,
        displayName: newUser.display_name,
        tier,
        products,
      },
    });

  } catch (err) {
    console.error('fw-signup error:', err);
    return json(req, { error: 'Internal server error.' }, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────

/** PBKDF2-SHA256 with a random 16-byte salt. Stored as "saltHex:hashHex". */
async function hashPassword(password: string): Promise<string> {
  const enc  = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key, 256,
  );
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

// Designated QA addresses may use reserved test domains. This allowlist never
// authorizes deleting an existing account or bypassing signup limits.
function testResetEmails(): Set<string> {
  return new Set(
    (Deno.env.get('TEST_RESET_EMAILS') || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

function normalizeProductSlug(value: unknown): string {
  const raw = String(value || 'war_room').trim().toLowerCase();
  const aliases: Record<string, string> = {
    'war-room': 'war_room',
    warroom: 'war_room',
    'dynasty-hq': 'dynast_hq',
    dynasty_hq: 'dynast_hq',
    scout: 'dynast_hq',
    pro: 'bundle',
  };
  return aliases[raw] || raw;
}

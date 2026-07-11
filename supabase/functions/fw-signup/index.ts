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
  normalizeEmail,
} from '../_shared/security.ts';
import { expandProductSlugs, mintAppSessionJWT } from '../_shared/entitlements.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VALID_PRODUCT_SLUGS  = new Set(['war_room', 'dynast_hq', 'bundle', 'dhq']);

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

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
    if (password.length < 8) {
      return json(req, { error: 'Password must be at least 8 characters.' }, 400);
    }
    if (!VALID_PRODUCT_SLUGS.has(productSlug)) {
      return json(req, { error: 'Unknown product.' }, 400);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    // Designated QA accounts (TEST_RESET_EMAILS) sign up repeatedly by design,
    // so they skip the abuse limits. Exposure is bounded: the exemption only
    // ever creates/resets the listed accounts themselves.
    const isTestReset = testResetEmails().has(normalizedEmail);
    if (!isTestReset) {
      const ipLimit = await checkRateLimit(admin, 'fw-signup:ip', clientIp(req), { limit: 10, windowSeconds: 3600, lockoutSeconds: 3600 });
      const emailLimit = await checkRateLimit(admin, 'fw-signup:email', normalizedEmail, { limit: 3, windowSeconds: 3600, lockoutSeconds: 3600 });
      if (!ipLimit.allowed || !emailLimit.allowed) {
        await auditEvent(admin, req, 'fw_signup_rate_limited', 'blocked', { email: normalizedEmail }, {});
        return json(req, { error: 'Too many sign-up attempts. Try again later.' }, 429);
      }
    }

    // ── Check for existing account ────────────────────────────
    const { data: existing } = await admin
      .from('app_users')
      .select('id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existing) {
      // Designated QA accounts (TEST_RESET_EMAILS secret, comma-separated)
      // reset to a blank slate on every sign-up: the old row is deleted
      // (subscriptions cascade) and the flow proceeds as a brand-new user,
      // so the full onboarding funnel can be exercised repeatedly. Unset
      // secret = feature off; sign-IN is untouched either way.
      if (testResetEmails().has(normalizedEmail)) {
        await admin.from('app_users').delete().eq('id', existing.id);
        await auditEvent(admin, req, 'fw_signup', 'success', { userId: existing.id, email: normalizedEmail }, { reason: 'test_account_reset' });
      } else {
        await auditEvent(admin, req, 'fw_signup', 'failure', { email: normalizedEmail }, { reason: 'email_exists' });
        return json(req, { error: 'An account with this email already exists.' }, 409);
      }
    }

    // ── Hash password (PBKDF2 via Web Crypto — no external deps) ─
    const passwordHash = await hashPassword(password);

    const { data: newUser, error: insertErr } = await admin
      .from('app_users')
      .insert({
        email:         normalizedEmail,
        password_hash: passwordHash,
        display_name:  displayName?.trim() || normalizedEmail.split('@')[0],
      })
      .select('id, email, display_name, created_at, session_version')
      .single();

    if (insertErr || !newUser) {
      console.error('Insert error:', insertErr);
      return json(req, { error: `DB insert failed: ${insertErr?.message ?? insertErr?.code ?? 'unknown'} (${insertErr?.details ?? insertErr?.hint ?? ''})` }, 500);
    }

    // ── Provision free subscription for chosen product ────────
    const { error: subscriptionErr } = await admin.from('subscriptions').insert({
      user_id:      newUser.id,
      product_slug: productSlug,
      tier:         'free',
      status:       'active',
    });
    if (subscriptionErr) {
      console.error('Subscription insert error:', subscriptionErr);
      await admin.from('app_users').delete().eq('id', newUser.id);
      await auditEvent(admin, req, 'fw_signup', 'failure', { userId: newUser.id, email: normalizedEmail }, { reason: 'subscription_insert_failed', productSlug });
      return json(req, { error: 'Could not provision product access.' }, 500);
    }

    // ── Issue JWT ─────────────────────────────────────────────
    const products = expandProductSlugs([productSlug]);
    const token = await mintAppSessionJWT({ userId: newUser.id, email: newUser.email, tier: 'free', products, sessionVersion: newUser.session_version || 1 });
    await auditEvent(admin, req, 'fw_signup', 'success', { userId: newUser.id, email: normalizedEmail }, { productSlug });

    return json(req, {
      token,
      user: {
        id:          newUser.id,
        email:       newUser.email,
        displayName: newUser.display_name,
        tier:        'free',
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

// QA accounts that reset to a blank slate on every sign-up. Comma-separated
// emails in the TEST_RESET_EMAILS secret; empty/unset disables the feature.
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

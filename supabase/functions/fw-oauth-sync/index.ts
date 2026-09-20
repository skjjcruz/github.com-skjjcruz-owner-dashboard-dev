/**
 * fw-oauth-sync — exchange a Supabase OAuth (Google) session for a Dynasty HQ app session
 *
 * POST /functions/v1/fw-oauth-sync
 * Header: Authorization: Bearer <supabase access_token>
 * Body (optional): { productSlug? }
 *
 * Why this exists: Google sign-in goes through Supabase Auth (auth.users) and
 * hands the browser a Supabase access token. That token has no
 * app_metadata.user_id / session_version, so requireActiveAppSession rejects it
 * and the user never lands in public.app_users — making OAuth signups invisible
 * to the admin user list and breaking their authenticated calls (fw-profile, …).
 *
 * This function validates the Supabase token, upserts an app_users row keyed by
 * email, ensures a free subscription, and mints a Dynasty HQ app JWT with the
 * claims the rest of the platform expects. Mirrors fw-signup for an OAuth user.
 *
 * Returns: { token, user: { id, email, displayName, tier, products } }
 *
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  bearerToken,
  checkRateLimit,
  clientIp,
  decodeJwtPayload,
  handleOptions,
  json,
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

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    // ── Validate the Supabase OAuth token ─────────────────────
    const accessToken = bearerToken(req);
    if (!accessToken) return json(req, { error: 'Missing session token.' }, 401);

    const ipLimit = await checkRateLimit(admin, 'fw-oauth-sync:ip', clientIp(req), { limit: 30, windowSeconds: 3600 });
    if (!ipLimit.allowed) {
      await auditEvent(admin, req, 'fw_oauth_sync_rate_limited', 'blocked', {}, {});
      return json(req, { error: 'Too many attempts. Try again later.' }, 429);
    }

    // App tokens must use the version-checked app-session path. Never let an
    // old or malformed app JWT regain authority via an OAuth exchange.
    // The unverified decode only denies; Auth still verifies every accepted token.
    const metadata = decodeJwtPayload(accessToken)?.app_metadata;
    if (metadata && ['user_id', 'session_version'].some(key => Object.prototype.hasOwnProperty.call(metadata, key))) {
      return json(req, { error: 'Use provider sign-in to start a new session.' }, 401);
    }

    // auth.getUser verifies the token against GoTrue regardless of signing scheme.
    const { data: gotUser, error: getUserErr } = await admin.auth.getUser(accessToken);
    const authUser = gotUser?.user;
    if (getUserErr || !authUser) {
      await auditEvent(admin, req, 'fw_oauth_sync', 'blocked', {}, { reason: 'invalid_token' });
      return json(req, { error: 'Invalid or expired session.' }, 401);
    }

    const normalizedEmail = normalizeEmail(authUser.email);
    if (!normalizedEmail || !authUser.email_confirmed_at) {
      await auditEvent(admin, req, 'fw_oauth_sync', 'failure', {}, { reason: 'unconfirmed_email' });
      return json(req, { error: 'A confirmed email address is required for provider sign-in.' }, 401);
    }

    const provider = String((authUser.app_metadata as any)?.provider || 'oauth');
    const metaName =
      (authUser.user_metadata as any)?.full_name ||
      (authUser.user_metadata as any)?.name ||
      null;

    const body = await req.json().catch(() => ({}));
    const productSlug = normalizeProductSlug((body as any)?.productSlug ?? 'war_room');
    if (!VALID_PRODUCT_SLUGS.has(productSlug)) return json(req, { error: 'Unknown product.' }, 400);

    // ── Upsert app_users row, keyed by email ──────────────────
    let { data: appUser, error: lookupErr } = await admin
      .from('app_users')
      .select('id, email, display_name, session_version')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (lookupErr) return json(req, { error: 'Account lookup is temporarily unavailable. Try again.' }, 503);
    // Sign-in always resumes the same account. Resetting QA data is an explicit
    // administrator action; an ordinary provider login must never erase it.

    let isNew = false;
    if (!appUser) {
      const { data: created, error: provisionErr } = await admin.rpc('create_app_account', {
        p_email: normalizedEmail,
        // Never matches a PBKDF2 credential; provider-only accounts keep the
        // existing explicit sign-in-method guidance.
        p_password_hash: `oauth:${provider}`,
        p_display_name: String(metaName || normalizedEmail.split('@')[0]).slice(0, 120),
        p_product_slug: productSlug,
      });
      if (provisionErr?.code === '23505') {
        // A competing signup/exchange committed first. Resume that committed
        // identity; never erase it or overwrite its password/subscriptions.
        const { data: winner, error: winnerErr } = await admin.from('app_users')
          .select('id, email, display_name, session_version').eq('email', normalizedEmail).maybeSingle();
        if (winnerErr || !winner) return json(req, { error: 'Account setup is temporarily unavailable. Try again.' }, 503);
        appUser = winner;
      } else {
        appUser = Array.isArray(created) ? created[0] : null;
        if (provisionErr || !appUser) {
          console.error('Account provisioning error:', provisionErr);
          await auditEvent(admin, req, 'fw_oauth_sync', 'failure', { email: normalizedEmail }, { reason: 'account_provisioning_failed' });
          return json(req, { error: 'Could not create account. Try again.' }, 503);
        }
        isNew = true;
      }
    } else if (metaName && !appUser.display_name) {
      // Backfill a display name for a pre-existing row that lacked one.
      await admin.from('app_users').update({ display_name: String(metaName).slice(0, 120) }).eq('id', appUser.id);
      appUser.display_name = String(metaName).slice(0, 120);
    }

    // ── Resolve products + tier from subscriptions ────────────
    // (active + trialing, dhq/bundle expanded — shared with fw-signin,
    // fw-profile, and fw-refresh-session so trial users never sign in free)
    const { tier, products } = await resolveEntitlements(admin, appUser.id);
    if (!products.length) products.push(productSlug);

    const sessionVersion = Number(appUser.session_version || 1);
    const token = await mintAppSessionJWT({ userId: appUser.id, email: appUser.email, tier, products, sessionVersion });

    await auditEvent(admin, req, 'fw_oauth_sync', 'success', { userId: appUser.id, email: normalizedEmail }, { provider, isNew });

    return json(req, {
      token,
      // First-ever sign-in for this account: clients route new users into the
      // onboarding funnel (plan selection) instead of straight into the app.
      isNew,
      user: {
        id:          appUser.id,
        email:       appUser.email,
        displayName: appUser.display_name,
        tier,
        products,
      },
    });

  } catch (err) {
    console.error('fw-oauth-sync error:', err);
    return json(req, { error: 'Internal server error.' }, 500);
  }
});

// ── Helpers (mirrors fw-signup) ───────────────────────────────

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

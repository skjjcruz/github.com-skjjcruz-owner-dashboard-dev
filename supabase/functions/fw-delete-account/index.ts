/**
 * fw-delete-account - permanent, user-initiated account + data deletion.
 *
 * Required for App Store / Play Store compliance: any app with account
 * creation must offer in-app account deletion (App Store 5.1.1(v)).
 *
 * POST /functions/v1/fw-delete-account   body: { confirm: true }
 *
 * Accepts either credential the app hands out:
 *
 * A) App account session (email/password, Google, Apple):
 *   1. Authenticate the caller (must be a valid, unrevoked app session).
 *   2. Best-effort cancel any active Stripe subscriptions.
 *   3. Delete the app_users row — every user-owned table references
 *      app_users(id) ON DELETE CASCADE, so child data is removed with it.
 *   4. Write a deletion tombstone (hashed email) so fw-oauth-sync won't
 *      silently recreate the account from a Google session that predates it.
 *   5. Delete the Supabase Auth user(s) for that email. auth.users ids are a
 *      different id space from app_users (and app_users has no auth_user_id
 *      column), so they are matched BY EMAIL via the paginated admin API —
 *      the old deleteUser(app_users.id) never matched anything. Best-effort:
 *      a missing auth user (email/password accounts have none) or an Auth API
 *      error never fails the deletion; the counts are audited.
 *
 * B) Legacy password-backed Sleeper session (get-session-token JWT):
 *   Its signature is verified and it is only ever minted after a password
 *   check. That is the same bar set-password already uses for a legacy user to
 *   rotate their own password, so it is the bar for deletion too; `confirm`
 *   still guards against stray requests. Deletes the caller's own `users` row
 *   (the legacy tables — field_log, league_docs, ai_chat_memory, gm_strategy,
 *   player_tags — reference users(sleeper_username) ON DELETE CASCADE) and
 *   their legacy mock_drafts rows. Legacy tokens can't be revoked, but with
 *   the row gone they own no data and get-session-token can't mint another.
 *
 * DEPLOY (matches the other in-function-auth functions):
 *   supabase functions deploy fw-delete-account --use-api --no-verify-jwt
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clientIp,
  handleOptions,
  json,
  requireActiveAppSession,
  requireSleeperSession,
} from '../_shared/security.ts';
import { deleteAuthUsersByEmail, recordDeletionTombstone } from '../_shared/account-deletion.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';

// Best-effort: cancel the user's active Stripe subscriptions so deleting the
// account also stops billing. Never blocks deletion — a Stripe hiccup must not
// trap a user in an account they asked to delete.
async function cancelStripeSubscriptions(admin: any, userId: string): Promise<void> {
  if (!STRIPE_SECRET_KEY) return;
  try {
    const { data: subs } = await admin
      .from('subscriptions')
      .select('stripe_subscription_id, status')
      .eq('user_id', userId);
    const active = (subs || []).filter(
      (s: any) => s?.stripe_subscription_id && s.status !== 'canceled',
    );
    for (const sub of active) {
      try {
        await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
        });
      } catch (_err) { /* best-effort */ }
    }
  } catch (_err) { /* best-effort */ }
}

async function deleteLegacyAccount(admin: any, req: Request, username: string): Promise<Response> {
  const actor = { username };
  const limit = await checkRateLimit(admin, 'fw-delete-account:username', username.toLowerCase(), { limit: 5, windowSeconds: 900, lockoutSeconds: 900 });
  if (!limit.allowed) {
    await auditEvent(admin, req, 'fw_delete_account_rate_limited', 'blocked', actor, { legacy: true });
    return json(req, { error: 'Too many attempts. Try again later.' }, 429);
  }

  const { data: row, error: readErr } = await admin
    .from('users')
    .select('sleeper_username, password_hash')
    .eq('sleeper_username', username)
    .maybeSingle();
  if (readErr) {
    await auditEvent(admin, req, 'fw_delete_account', 'error', actor, { legacy: true, reason: readErr.message });
    return json(req, { error: 'Failed to delete account' }, 500);
  }
  if (!row) {
    // Already gone (a retry, or deleted on another device): idempotent.
    await auditEvent(admin, req, 'fw_delete_account', 'success', actor, { legacy: true, alreadyDeleted: true });
    return json(req, { ok: true, alreadyDeleted: true });
  }
  if (!row.password_hash) {
    // Only password-backed legacy accounts ever received a session; a row
    // without a password can't be proven to belong to this token holder.
    await auditEvent(admin, req, 'fw_delete_account', 'blocked', actor, { legacy: true, reason: 'passwordless_legacy_row' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  // mock_drafts carries a plain sleeper_username column (no FK), so it
  // doesn't cascade from users — remove the caller's legacy rows explicitly.
  try {
    await admin.from('mock_drafts').delete().eq('sleeper_username', username).is('user_id', null);
  } catch (_err) { /* best-effort */ }

  const { error: delErr } = await admin.from('users').delete().eq('sleeper_username', username);
  if (delErr) {
    await auditEvent(admin, req, 'fw_delete_account', 'error', actor, { legacy: true, reason: delErr.message });
    return json(req, { error: 'Failed to delete account' }, 500);
  }

  await auditEvent(admin, req, 'fw_delete_account', 'success', actor, { legacy: true });
  return json(req, { ok: true, legacy: true });
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const session = await requireActiveAppSession(admin, req);
  const legacySession = session ? null : await requireSleeperSession(req);
  if (!session && !legacySession) {
    await auditEvent(admin, req, 'fw_delete_account', 'blocked', {}, { reason: 'invalid_session' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  // Explicit confirmation guard so a stray request can't wipe an account.
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return json(req, { error: 'Deletion not confirmed' }, 400);
  }

  if (!session && legacySession) {
    try {
      return await deleteLegacyAccount(admin, req, legacySession.username);
    } catch (err) {
      await auditEvent(admin, req, 'fw_delete_account', 'error', { username: legacySession.username }, { legacy: true, reason: String(err) });
      return json(req, { error: 'Failed to delete account' }, 500);
    }
  }

  const userId = session!.userId;

  try {
    // The row's email is authoritative for the auth-user match (the token's
    // email claim could predate an email change).
    const { data: account } = await admin
      .from('app_users')
      .select('email')
      .eq('id', userId)
      .maybeSingle();
    const email = String(account?.email || session!.email || '');

    // 1. Stop billing first (best-effort).
    await cancelStripeSubscriptions(admin, userId);

    // 2. Delete the account row — children cascade.
    const { error: delErr } = await admin
      .from('app_users')
      .delete()
      .eq('id', userId);
    if (delErr) {
      await auditEvent(admin, req, 'fw_delete_account', 'error', { userId }, { reason: delErr.message });
      return json(req, { error: 'Failed to delete account' }, 500);
    }

    // 3. Tombstone before touching auth, so a concurrent OAuth sync from a
    //    lingering Google session can't slip a recreate in between.
    const tombstoned = await recordDeletionTombstone(admin, email, 'self_service');

    // 4. Remove the Supabase Auth user(s) for this email (OAuth accounts).
    //    Best-effort: none exist for email/password accounts.
    const auth = await deleteAuthUsersByEmail(admin, email);

    await auditEvent(admin, req, 'fw_delete_account', 'success', { userId, email }, {
      authUsersFound: auth.found,
      authUsersDeleted: auth.deleted,
      ...(auth.error ? { authError: auth.error } : {}),
      tombstoned,
    });
    return json(req, { ok: true });
  } catch (err) {
    await auditEvent(admin, req, 'fw_delete_account', 'error', { userId }, { reason: String(err) });
    return json(req, { error: 'Failed to delete account' }, 500);
  }
});

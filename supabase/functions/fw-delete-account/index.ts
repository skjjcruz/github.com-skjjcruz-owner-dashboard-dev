/**
 * fw-delete-account - permanent, user-initiated account + data deletion.
 *
 * Required for App Store / Play Store compliance: any app with account
 * creation must offer in-app account deletion.
 *
 * POST /functions/v1/fw-delete-account   body: { confirm: true }
 *
 * Flow:
 *   1. Authenticate the caller (must be a valid app session).
 *   2. Best-effort cancel any active Stripe subscriptions.
 *   3. Delete the app_users row — every user-owned table references
 *      app_users(id) ON DELETE CASCADE, so child data is removed with it.
 *   4. Best-effort delete the Supabase Auth user (for OAuth accounts).
 *
 * DEPLOY (matches the other in-function-auth functions):
 *   supabase functions deploy fw-delete-account --use-api --no-verify-jwt
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  json,
  requireActiveAppSession,
} from '../_shared/security.ts';

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

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== 'POST') {
    return json(req, { error: 'Method not allowed' }, 405);
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const session = await requireActiveAppSession(admin, req);
  if (!session) {
    await auditEvent(admin, req, 'fw_delete_account', 'blocked', {}, { reason: 'invalid_session' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  // Explicit confirmation guard so a stray request can't wipe an account.
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return json(req, { error: 'Deletion not confirmed' }, 400);
  }

  const userId = session.userId;

  try {
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

    // 3. Remove the Supabase Auth user too (OAuth accounts). Best-effort:
    //    app sessions are custom-JWT, so this may be a no-op for some users.
    try { await admin.auth.admin.deleteUser(userId); } catch (_err) { /* best-effort */ }

    await auditEvent(admin, req, 'fw_delete_account', 'success', { userId, email: session.email }, {});
    return json(req, { ok: true });
  } catch (err) {
    await auditEvent(admin, req, 'fw_delete_account', 'error', { userId }, { reason: String(err) });
    return json(req, { error: 'Failed to delete account' }, 500);
  }
});

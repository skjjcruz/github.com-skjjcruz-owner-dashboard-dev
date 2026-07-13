/**
 * admin-delete-user — admin-initiated account deletion (support tooling).
 *
 * POST /functions/v1/admin-delete-user   body: { email, force? }
 *
 * The support scenario: a customer tangles themselves in duplicate accounts
 * (e.g. a Hide-My-Email Apple relay next to their real address) and needs a
 * clean start. An admin finds the account in /admin.html and deletes it:
 *   1. Caller must hold role admin/owner in app_user_roles.
 *   2. Guards: cannot delete yourself; cannot delete another admin/owner;
 *      deleting an account with a store-backed PAID subscription requires
 *      force:true (the UI double-confirms) and cancels Stripe billing first.
 *   3. Deletes the app_users row — user-owned tables cascade.
 *   4. Deletes any Supabase Auth users with the SAME EMAIL (matched by email,
 *      not id — auth.users ids are a different id space than app_users), so
 *      Google/Apple sign-ins are fully forgotten and re-signup starts fresh.
 *
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Optional: STRIPE_SECRET_KEY (billing cancellation for forced deletes)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  hasAdminRole,
  json,
  normalizeEmail,
  resolveAppUserId,
} from '../_shared/security.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY') || '';

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

// Auth users live in a different id space than app_users — match by email.
async function deleteAuthUsersByEmail(admin: any, email: string): Promise<number> {
  let deleted = 0;
  try {
    const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of data?.users || []) {
      if (normalizeEmail(u.email) === email) {
        try {
          await admin.auth.admin.deleteUser(u.id);
          deleted++;
        } catch (_err) { /* best-effort */ }
      }
    }
  } catch (_err) { /* best-effort */ }
  return deleted;
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const session = await resolveAppUserId(admin, req);
  const callerId = session?.userId || null;
  if (!await hasAdminRole(admin, callerId)) {
    await auditEvent(admin, req, 'admin_delete_user', 'blocked', { userId: callerId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const email = normalizeEmail((body as any)?.email);
    const force = (body as any)?.force === true;
    if (!email) return json(req, { error: 'email is required' }, 400);

    const { data: target } = await admin
      .from('app_users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    // Even with no app account, stray auth users under this email can block a
    // clean re-signup (the Apple relay tangle) — sweep them regardless.
    if (!target) {
      const authDeleted = await deleteAuthUsersByEmail(admin, email);
      await auditEvent(admin, req, 'admin_delete_user', authDeleted ? 'success' : 'failure',
        { userId: callerId }, { targetEmail: email, appUser: false, authDeleted });
      return authDeleted
        ? json(req, { ok: true, deletedAppUser: false, deletedAuthUsers: authDeleted })
        : json(req, { error: 'No account found with that email.' }, 404);
    }

    if (target.id === callerId) {
      return json(req, { error: 'You cannot delete your own account from here.' }, 400);
    }
    if (await hasAdminRole(admin, target.id)) {
      await auditEvent(admin, req, 'admin_delete_user', 'blocked', { userId: callerId }, { targetEmail: email, reason: 'target_is_admin' });
      return json(req, { error: 'That account holds an admin role and cannot be deleted from here.' }, 403);
    }

    // Paying customer tripwire: store-backed pro subscription needs force.
    const { data: subs } = await admin
      .from('subscriptions')
      .select('tier, status, store')
      .eq('user_id', target.id);
    const paying = (subs || []).some((s: any) =>
      s?.tier === 'pro' && ['active', 'trialing', 'past_due'].includes(s?.status) && s?.store);
    if (paying && !force) {
      return json(req, { error: 'paying_customer', message: 'This account has a live paid subscription. Confirm again to cancel billing and delete.' }, 409);
    }
    if (paying) await cancelStripeSubscriptions(admin, target.id);

    const { error: delErr } = await admin.from('app_users').delete().eq('id', target.id);
    if (delErr) {
      await auditEvent(admin, req, 'admin_delete_user', 'error', { userId: callerId }, { targetEmail: email, reason: delErr.message });
      return json(req, { error: 'Failed to delete account' }, 500);
    }
    const authDeleted = await deleteAuthUsersByEmail(admin, email);

    await auditEvent(admin, req, 'admin_delete_user', 'success', { userId: callerId },
      { targetEmail: email, targetId: target.id, paying, authDeleted });
    return json(req, { ok: true, deletedAppUser: true, deletedAuthUsers: authDeleted });
  } catch (err) {
    console.error('admin-delete-user error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

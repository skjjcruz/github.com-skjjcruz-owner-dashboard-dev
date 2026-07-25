/**
 * admin-billing-summary — server-side billing metrics for Mission Control
 *
 * GET /functions/v1/admin-billing-summary
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 * The Stripe secret key never leaves this function: the browser only sees
 * computed rollups. Apple/RevenueCat volume is read from our own
 * subscriptions table (the RC webhook keeps it current) so no RevenueCat
 * API key is needed.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  hasAdminRole,
  json,
  resolveAppUserId,
} from '../_shared/security.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY') || '';

async function stripeSummary(): Promise<Record<string, unknown> | null> {
  if (!STRIPE_SECRET_KEY) return null;
  const res = await fetch('https://api.stripe.com/v1/subscriptions?status=all&limit=100', {
    headers: { 'Authorization': `Bearer ${STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) return { error: `Stripe API ${res.status}` };
  const data = await res.json();
  let active = 0, trialing = 0, canceled = 0, mrr = 0;
  for (const sub of data.data ?? []) {
    if (sub.status === 'active') active++;
    else if (sub.status === 'trialing') trialing++;
    else if (sub.status === 'canceled') canceled++;
    if (sub.status === 'active' || sub.status === 'trialing') {
      for (const item of sub.items?.data ?? []) {
        const amount = (item.price?.unit_amount ?? 0) / 100;
        const interval = item.price?.recurring?.interval;
        mrr += interval === 'year' ? amount / 12 : amount;
      }
    }
  }
  return { active, trialing, canceled, mrrUsd: Math.round(mrr * 100) / 100, sampled: (data.data ?? []).length };
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  // ── Auth check ────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await resolveAppUserId(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_billing_summary', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const [stripe, subs, gifts] = await Promise.all([
      stripeSummary(),
      admin
        .from('subscriptions')
        .select('tier, status, store')
        .in('status', ['active', 'trialing']),
      admin
        .from('gift_grants')
        .select('status'),
    ]);
    if (subs.error) return json(req, { error: subs.error.message }, 500);

    const rows = subs.data ?? [];
    const proByStore: Record<string, number> = {};
    let freeCount = 0;
    for (const s of rows) {
      if (s.tier === 'pro') {
        const store = s.store || 'unknown';
        proByStore[store] = (proByStore[store] || 0) + 1;
      } else {
        freeCount++;
      }
    }
    const grantRows = gifts.data ?? [];
    const giftCounts = {
      active: grantRows.filter((g: any) => g.status === 'redeemed').length,
      pending: grantRows.filter((g: any) => g.status === 'pending').length,
    };

    return json(req, { stripe, proByStore, freeCount, gifts: giftCounts });
  } catch (err) {
    console.error('admin-billing-summary error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

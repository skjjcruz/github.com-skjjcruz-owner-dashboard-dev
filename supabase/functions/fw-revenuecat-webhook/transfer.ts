/**
 * fw-revenuecat-webhook/transfer.ts — pure planning for RevenueCat TRANSFER.
 *
 * RevenueCat sends TRANSFER when a purchase moves between app user ids —
 * e.g. account B taps "Restore purchases" on a device whose Apple ID bought
 * Pro while account A was signed in. The event carries no product or period
 * data, only `transferred_from` / `transferred_to` id lists, so the
 * entitlement is moved by copying the sender's App Store subscription row to
 * the recipient and downgrading the sender exactly as EXPIRATION does.
 *
 * Idempotent by construction: only rows that are still Pro, RevenueCat-backed
 * and not touched by a NEWER event are moved. A replay after success finds the
 * senders already free and plans nothing; a retry after a partial failure
 * (recipient written, sender not yet downgraded) replans the same writes.
 *
 * No I/O here so supabase/functions/tests can cover it without a database.
 */

export const TRANSFERABLE_STATUSES = ['active', 'trialing', 'past_due'];

export type SubscriptionRow = {
  user_id: string;
  product_slug: string;
  tier: string | null;
  status: string | null;
  store?: string | null;
  stripe_subscription_id?: string | null;
  rc_app_user_id?: string | null;
  rc_product_id?: string | null;
  rc_last_event_at?: string | null;
  billing_period?: string | null;
  current_period_start?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
};

export const TRANSFER_ROW_COLUMNS =
  'user_id, product_slug, tier, status, store, stripe_subscription_id, rc_app_user_id, rc_product_id, rc_last_event_at, billing_period, current_period_start, current_period_end, cancel_at_period_end';

/** Candidate uuids from the event, recipients excluded from senders. */
export function transferCandidates(
  event: Record<string, any>,
  uuidRe: RegExp,
): { from: string[]; to: string[] } {
  const ids = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((x) => String(x || ''))
      .filter((x) => uuidRe.test(x));
  const to = [...new Set(ids(event.transferred_to))];
  const from = [...new Set(ids(event.transferred_from))].filter((id) => !to.includes(id));
  return { from, to };
}

function isStripeBacked(row: SubscriptionRow): boolean {
  return row.store === 'stripe' || !!row.stripe_subscription_id;
}

function isEntitledPro(row: SubscriptionRow): boolean {
  return row.tier === 'pro' && TRANSFERABLE_STATUSES.includes(String(row.status || ''));
}

export type TransferPlan = {
  upsertTo: Record<string, unknown> | null;
  downgradeFrom: string[];
  reason: 'transfer' | 'nothing_to_transfer' | 'no_recipient' | 'recipient_has_stripe_pro';
};

export function planTransfer(args: {
  productSlug: string;
  fromRows: SubscriptionRow[];
  toUserId: string | null;
  toRow: SubscriptionRow | null;
  eventAt: string;
  nowIso?: string;
}): TransferPlan {
  const eventMs = Date.parse(args.eventAt);
  const movable = args.fromRows.filter((row) => {
    if (row.product_slug !== args.productSlug) return false;
    if (row.user_id === args.toUserId) return false;
    if (!isEntitledPro(row) || isStripeBacked(row)) return false;
    // A newer event already rewrote this row (e.g. the sender bought again
    // after the transfer and events arrived out of order) — leave it.
    const lastMs = Date.parse(String(row.rc_last_event_at || ''));
    if (Number.isFinite(lastMs) && Number.isFinite(eventMs) && lastMs > eventMs) return false;
    return true;
  });

  if (!movable.length) return { upsertTo: null, downgradeFrom: [], reason: 'nothing_to_transfer' };

  // No known recipient (an anonymous / signed-out RevenueCat id): change
  // nothing. Downgrading the sender here would be unrecoverable, because the
  // transfer BACK (anonymous → sender) carries no row to copy from.
  if (!args.toUserId) return { upsertTo: null, downgradeFrom: [], reason: 'no_recipient' };
  const downgradeFrom = [...new Set(movable.map((r) => r.user_id))];

  // Recipient already pays through Stripe: keep that row intact (overwriting
  // it would let a later App Store EXPIRATION cancel a Stripe subscription).
  if (args.toRow && isEntitledPro(args.toRow) && isStripeBacked(args.toRow)) {
    return { upsertTo: null, downgradeFrom, reason: 'recipient_has_stripe_pro' };
  }

  const source = [...movable].sort((a, b) =>
    (Date.parse(String(b.current_period_end || '')) || 0) - (Date.parse(String(a.current_period_end || '')) || 0))[0];

  const upsertTo: Record<string, unknown> = {
    user_id: args.toUserId,
    product_slug: args.productSlug,
    tier: 'pro',
    status: source.status,
    cancel_at_period_end: source.cancel_at_period_end === true,
    ...(source.billing_period ? { billing_period: source.billing_period } : {}),
    ...(source.current_period_start ? { current_period_start: source.current_period_start } : {}),
    ...(source.current_period_end ? { current_period_end: source.current_period_end } : {}),
    rc_app_user_id: args.toUserId,
    rc_product_id: source.rc_product_id || null,
    rc_last_event_at: args.eventAt,
    ...(source.store ? { store: source.store } : {}),
    updated_at: args.nowIso || new Date().toISOString(),
  };

  return { upsertTo, downgradeFrom, reason: 'transfer' };
}

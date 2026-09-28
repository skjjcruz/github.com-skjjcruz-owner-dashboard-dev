// deno test supabase/functions/tests/
import { assertEquals } from 'jsr:@std/assert@1';
import { planTransfer, transferCandidates, type SubscriptionRow } from '../fw-revenuecat-webhook/transfer.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const EVENT_AT = '2026-09-28T12:00:00.000Z';
const NOW = '2026-09-28T12:00:05.000Z';

const proRow = (over: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  user_id: A,
  product_slug: 'dhq',
  tier: 'pro',
  status: 'active',
  store: 'app_store',
  stripe_subscription_id: null,
  rc_app_user_id: A,
  rc_product_id: 'com.dhqfootball.app.dhq.annual',
  rc_last_event_at: '2026-09-01T00:00:00.000Z',
  billing_period: 'annual',
  current_period_start: '2026-09-01T00:00:00.000Z',
  current_period_end: '2027-09-01T00:00:00.000Z',
  cancel_at_period_end: false,
  ...over,
});

Deno.test('candidates: uuids only, recipients never senders', () => {
  const c = transferCandidates({
    transferred_from: [A, '$RCAnonymousID:abc', B],
    transferred_to: [B],
  }, UUID_RE);
  assertEquals(c, { from: [A], to: [B] });
});

Deno.test('moves the App Store entitlement A → B', () => {
  const plan = planTransfer({ productSlug: 'dhq', fromRows: [proRow()], toUserId: B, toRow: null, eventAt: EVENT_AT, nowIso: NOW });
  assertEquals(plan.reason, 'transfer');
  assertEquals(plan.downgradeFrom, [A]);
  assertEquals(plan.upsertTo, {
    user_id: B,
    product_slug: 'dhq',
    tier: 'pro',
    status: 'active',
    cancel_at_period_end: false,
    billing_period: 'annual',
    current_period_start: '2026-09-01T00:00:00.000Z',
    current_period_end: '2027-09-01T00:00:00.000Z',
    rc_app_user_id: B,
    rc_product_id: 'com.dhqfootball.app.dhq.annual',
    rc_last_event_at: EVENT_AT,
    store: 'app_store',
    updated_at: NOW,
  });
});

Deno.test('keeps trialing / cancel-at-period-end state', () => {
  const plan = planTransfer({ productSlug: 'dhq', fromRows: [proRow({ status: 'trialing', cancel_at_period_end: true })], toUserId: B, toRow: null, eventAt: EVENT_AT });
  assertEquals(plan.upsertTo?.status, 'trialing');
  assertEquals(plan.upsertTo?.cancel_at_period_end, true);
});

Deno.test('idempotent: a replay after success plans nothing', () => {
  const after = proRow({ tier: 'free', status: 'canceled', rc_last_event_at: EVENT_AT });
  const plan = planTransfer({ productSlug: 'dhq', fromRows: [after], toUserId: B, toRow: proRow({ user_id: B }), eventAt: EVENT_AT });
  assertEquals(plan, { upsertTo: null, downgradeFrom: [], reason: 'nothing_to_transfer' });
});

Deno.test('idempotent: a retry after a partial failure replans the same writes', () => {
  const first = planTransfer({ productSlug: 'dhq', fromRows: [proRow()], toUserId: B, toRow: null, eventAt: EVENT_AT, nowIso: NOW });
  const retry = planTransfer({ productSlug: 'dhq', fromRows: [proRow()], toUserId: B, toRow: proRow({ user_id: B, rc_last_event_at: EVENT_AT }), eventAt: EVENT_AT, nowIso: NOW });
  assertEquals(retry, first);
});

Deno.test('never moves Stripe-backed, free, or newer-than-event rows', () => {
  for (const row of [
    proRow({ store: 'stripe' }),
    proRow({ stripe_subscription_id: 'sub_123', store: null }),
    proRow({ tier: 'free' }),
    proRow({ status: 'canceled' }),
    proRow({ product_slug: 'war_room' }),
    proRow({ rc_last_event_at: '2026-09-28T13:00:00.000Z' }),
  ]) {
    assertEquals(planTransfer({ productSlug: 'dhq', fromRows: [row], toUserId: B, toRow: null, eventAt: EVENT_AT }).reason, 'nothing_to_transfer');
  }
});

Deno.test('unknown recipient (anonymous RC id): no writes at all', () => {
  assertEquals(
    planTransfer({ productSlug: 'dhq', fromRows: [proRow()], toUserId: null, toRow: null, eventAt: EVENT_AT }),
    { upsertTo: null, downgradeFrom: [], reason: 'no_recipient' },
  );
});

Deno.test('recipient already on Stripe Pro keeps their row; sender still loses the App Store one', () => {
  const plan = planTransfer({
    productSlug: 'dhq',
    fromRows: [proRow()],
    toUserId: B,
    toRow: proRow({ user_id: B, store: 'stripe', stripe_subscription_id: 'sub_9' }),
    eventAt: EVENT_AT,
  });
  assertEquals(plan, { upsertTo: null, downgradeFrom: [A], reason: 'recipient_has_stripe_pro' });
});

Deno.test('several senders: latest period wins, all are downgraded', () => {
  const C = '33333333-3333-4333-8333-333333333333';
  const plan = planTransfer({
    productSlug: 'dhq',
    fromRows: [proRow(), proRow({ user_id: C, billing_period: 'monthly', current_period_end: '2027-12-01T00:00:00.000Z' })],
    toUserId: B,
    toRow: null,
    eventAt: EVENT_AT,
  });
  assertEquals(plan.downgradeFrom, [A, C]);
  assertEquals(plan.upsertTo?.billing_period, 'monthly');
});

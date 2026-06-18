/**
 * fw-revenuecat-webhook — Apply RevenueCat subscription events to the
 * `subscriptions` table. This is the Apple In-App Purchase counterpart of
 * fw-stripe-webhook and writes the exact same shape so the rest of the app
 * (tier resolution, gating) is unchanged regardless of where someone paid.
 *
 * POST /functions/v1/fw-revenuecat-webhook
 * Auth: RevenueCat sends a fixed Authorization header that you configure in the
 *       RevenueCat dashboard (Integrations → Webhooks → "Authorization header").
 *       It must equal the REVENUECAT_WEBHOOK_AUTH secret.
 *
 * Required secrets (supabase secrets set ...):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   REVENUECAT_WEBHOOK_AUTH   — any strong random string; paste the SAME value
 *                               into the RevenueCat webhook Authorization field.
 *
 * IMPORTANT: event.app_user_id MUST be the Supabase app_users.id. The app sets
 * this by calling Purchases.logIn(<userId>) (see js/billing.js init()). If the
 * app ships anonymous RevenueCat ids ($RCAnonymousID:...), this webhook cannot
 * map a purchase to an account and will skip it.
 *
 * RevenueCat webhook reference: https://www.revenuecat.com/docs/webhooks
 */
import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_AUTH         = Deno.env.get('REVENUECAT_WEBHOOK_AUTH')!;

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// RevenueCat product id → app product slug (must exist in public.products.slug;
// these match the slugs the Stripe flow already uses).
const PRODUCT_TO_SLUG: Record<string, string> = {
  'com.dhqfootball.app.pro.monthly': 'bundle',
  'com.dhqfootball.app.dhq.monthly': 'war_room',
  'com.dhqfootball.app.dhq.annual':  'war_room',
};

interface RcEvent {
  type?: string;
  app_user_id?: string;
  product_id?: string;
  period_type?: string;     // 'TRIAL' | 'NORMAL' | 'INTRO'
  expiration_at_ms?: number;
}

Deno.serve(async (req) => {
  // ── Verify the shared Authorization header ──────────────────────────────
  const auth = req.headers.get('authorization') ?? '';
  if (!WEBHOOK_AUTH || auth !== WEBHOOK_AUTH) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { event?: RcEvent } | null = null;
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const event = payload?.event;
  if (!event || !event.type) {
    return json({ received: true, ignored: 'no event' });
  }

  try {
    await handleEvent(event);
  } catch (err) {
    console.error('[rc-webhook] handler error:', err);
    return new Response('Handler error', { status: 500 });
  }
  return json({ received: true });
});

async function handleEvent(event: RcEvent) {
  const userId = event.app_user_id;
  const type = String(event.type || '').toUpperCase();

  // Anonymous RevenueCat ids can't be mapped to an account.
  if (!userId || userId.startsWith('$RCAnonymousID')) {
    console.warn('[rc-webhook] missing/anonymous app_user_id — skipping', type);
    return;
  }

  const productSlug = (event.product_id && PRODUCT_TO_SLUG[event.product_id]) || 'war_room';
  const periodEnd = event.expiration_at_ms
    ? new Date(Number(event.expiration_at_ms)).toISOString()
    : null;

  // Map the event → (tier, status, cancel_at_period_end). In this table `tier`
  // is a paid flag: 'pro' = paid, 'free' = not paid. The granular tier
  // (standard vs pro) is carried by the user's profile, set at purchase time.
  let tier = 'pro';
  let status = 'active';
  let cancelAtPeriodEnd = false;

  switch (type) {
    case 'INITIAL_PURCHASE':
    case 'RENEWAL':
    case 'UNCANCELLATION':
    case 'PRODUCT_CHANGE':
    case 'NON_RENEWING_PURCHASE':
    case 'SUBSCRIPTION_EXTENDED':
      tier = 'pro';
      status = event.period_type === 'TRIAL' ? 'trialing' : 'active';
      cancelAtPeriodEnd = false;
      break;

    case 'CANCELLATION':
      // Auto-renew turned off, but access continues until expiration.
      tier = 'pro';
      status = 'active';
      cancelAtPeriodEnd = true;
      break;

    case 'BILLING_ISSUE':
      // In the billing grace period — keep access, flag as past_due.
      tier = 'pro';
      status = 'past_due';
      cancelAtPeriodEnd = true;
      break;

    case 'EXPIRATION':
    case 'SUBSCRIPTION_PAUSED':
      tier = 'free';
      status = 'canceled';
      cancelAtPeriodEnd = false;
      break;

    case 'TRANSFER':
      // Entitlement moved between RevenueCat ids; no single-row action here.
      return;

    default:
      console.warn('[rc-webhook] unhandled event type:', type);
      return;
  }

  const { error } = await admin.from('subscriptions').upsert(
    {
      user_id: userId,
      product_slug: productSlug,
      tier,
      status,
      current_period_end: periodEnd,
      cancel_at_period_end: cancelAtPeriodEnd,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,product_slug' },
  );

  if (error) console.error('[rc-webhook] subscriptions upsert failed:', error);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

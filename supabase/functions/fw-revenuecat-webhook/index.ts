/**
 * fw-revenuecat-webhook — Handle RevenueCat subscription lifecycle events
 *
 * POST /functions/v1/fw-revenuecat-webhook
 * (No Supabase JWT — RevenueCat sends the Authorization header value you
 *  configure in its dashboard; we require it to match REVENUECAT_WEBHOOK_AUTH.)
 *
 * This is the App Store (and any future Play Store) side of billing: the iOS
 * app purchases through RevenueCat, RevenueCat validates receipts with Apple,
 * and this webhook mirrors the entitlement into public.subscriptions — the
 * same table the Stripe webhook writes — so server-side plan checks stay
 * uniform regardless of where the user paid.
 *
 * REQUIREMENT (app side): the app must identify the RevenueCat SDK with the
 * Supabase user id — Purchases.logIn(<app_users.id uuid>) — so events arrive
 * keyed to a user we can find. Events for anonymous RC ids are acknowledged
 * and skipped (retrying cannot fix them).
 *
 * Handled events:
 *   INITIAL_PURCHASE, RENEWAL, UNCANCELLATION, PRODUCT_CHANGE,
 *   SUBSCRIPTION_EXTENDED                  → activate/refresh pro
 *   CANCELLATION                           → auto-renew off (access continues
 *                                            until period end)
 *   EXPIRATION                             → downgrade to free
 *   BILLING_ISSUE                          → mark past_due
 *   TEST                                   → 200 ok (dashboard test button)
 *   Everything else                        → acknowledged, no-op
 *
 * Required secrets:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   REVENUECAT_WEBHOOK_AUTH   (any long random string; set the SAME value as
 *                              the Authorization header in RevenueCat →
 *                              Integrations → Webhooks)
 *
 * Setup in RevenueCat Dashboard:
 *   Project → Integrations → Webhooks → Add webhook
 *     URL: https://<project>.supabase.co/functions/v1/fw-revenuecat-webhook
 *     Authorization header: <the REVENUECAT_WEBHOOK_AUTH value>
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WEBHOOK_AUTH         = Deno.env.get('REVENUECAT_WEBHOOK_AUTH') || '';

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Live App Store product line (mirrors RevenueCat offering `default`,
// entitlement `dhq`).
const PRODUCT_SLUG = 'dhq';

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

function authorized(req: Request): boolean {
  if (!WEBHOOK_AUTH) return false; // unset secret = webhook disabled, never open
  const header = req.headers.get('Authorization') || '';
  return timingSafeEqual(header, WEBHOOK_AUTH)
    || timingSafeEqual(header, `Bearer ${WEBHOOK_AUTH}`);
}

function billingPeriodFor(productId: string): 'monthly' | 'annual' | null {
  const id = String(productId || '').toLowerCase();
  if (id.includes('annual') || id.includes('yearly')) return 'annual';
  if (id.includes('monthly')) return 'monthly';
  return null;
}

function storeFor(rcStore: string): string | null {
  switch (String(rcStore || '').toUpperCase()) {
    case 'APP_STORE':
    case 'MAC_APP_STORE':
      return 'app_store';
    case 'PLAY_STORE':
    case 'AMAZON':
      return 'play_store';
    case 'STRIPE':
      return 'stripe';
    case 'PROMOTIONAL':
      return 'promotional';
    default:
      return null;
  }
}

// RC events carry the SDK app user id plus any aliases; the app logs the SDK
// in with the Supabase user uuid, so the first alias that looks like a uuid
// and exists in app_users is our subscriber. Anonymous ids ($RCAnonymousID:…)
// never match.
async function resolveUserId(event: Record<string, any>): Promise<string | null> {
  const candidates = [
    event.app_user_id,
    event.original_app_user_id,
    ...(Array.isArray(event.aliases) ? event.aliases : []),
  ].map((v) => String(v || '')).filter((v) => UUID_RE.test(v));

  for (const candidate of [...new Set(candidates)]) {
    const { data } = await admin
      .from('app_users')
      .select('id')
      .eq('id', candidate)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  return null;
}

function isoFromMs(ms: unknown): string | null {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Date(n).toISOString() : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }
  if (!authorized(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  let event: Record<string, any>;
  try {
    const body = await req.json();
    event = body?.event;
    if (!event || typeof event !== 'object') throw new Error('missing event');
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const type = String(event.type || '').toUpperCase();
  const ack = (extra: Record<string, unknown> = {}) =>
    new Response(JSON.stringify({ received: true, ...extra }), {
      headers: { 'Content-Type': 'application/json' },
    });

  if (type === 'TEST') return ack({ test: true });

  try {
    const userId = await resolveUserId(event);
    if (!userId) {
      // Retrying cannot fix an unidentified user — acknowledge, but leave a
      // loud trail: this usually means the app skipped Purchases.logIn().
      console.error('[rc-webhook] No matching app user for event', {
        type,
        appUserId: event.app_user_id,
        aliases: event.aliases,
      });
      return ack({ ignored: 'no_matching_user' });
    }

    const productId = String(event.new_product_id || event.product_id || '');
    const billingPeriod = billingPeriodFor(productId);
    const store = storeFor(event.store);
    const periodStart = isoFromMs(event.purchased_at_ms);
    const periodEnd = isoFromMs(event.expiration_at_ms);
    const eventAt = isoFromMs(event.event_timestamp_ms) || new Date().toISOString();
    const rcFields = {
      rc_app_user_id: String(event.app_user_id || ''),
      rc_product_id: productId || null,
      rc_last_event_at: eventAt,
      ...(store ? { store } : {}),
      updated_at: new Date().toISOString(),
    };

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'PRODUCT_CHANGE':
      case 'SUBSCRIPTION_EXTENDED': {
        await admin.from('subscriptions').upsert({
          user_id: userId,
          product_slug: PRODUCT_SLUG,
          tier: 'pro',
          status: String(event.period_type || '').toUpperCase() === 'TRIAL' ? 'trialing' : 'active',
          cancel_at_period_end: false,
          ...(billingPeriod ? { billing_period: billingPeriod } : {}),
          ...(periodStart ? { current_period_start: periodStart } : {}),
          ...(periodEnd ? { current_period_end: periodEnd } : {}),
          ...rcFields,
        }, { onConflict: 'user_id,product_slug' });
        break;
      }

      case 'CANCELLATION': {
        // Auto-renew switched off — Apple keeps access until the period ends,
        // so the entitlement stays; EXPIRATION does the downgrade.
        await admin.from('subscriptions')
          .update({ cancel_at_period_end: true, ...rcFields })
          .eq('user_id', userId)
          .eq('product_slug', PRODUCT_SLUG);
        break;
      }

      case 'EXPIRATION': {
        await admin.from('subscriptions')
          .update({ tier: 'free', status: 'canceled', cancel_at_period_end: false, ...rcFields })
          .eq('user_id', userId)
          .eq('product_slug', PRODUCT_SLUG);
        break;
      }

      case 'BILLING_ISSUE': {
        await admin.from('subscriptions')
          .update({ status: 'past_due', ...rcFields })
          .eq('user_id', userId)
          .eq('product_slug', PRODUCT_SLUG);
        break;
      }

      default:
        // TRANSFER, SUBSCRIPTION_PAUSED, INVOICE_ISSUANCE, … — acknowledged
        // without a write; add handling if these ever matter for entitlement.
        console.warn('[rc-webhook] Unhandled event type:', type);
        return ack({ ignored: type.toLowerCase() });
    }

    return ack({ type: type.toLowerCase() });
  } catch (err) {
    // Non-2xx makes RevenueCat retry with backoff — correct for transient
    // DB errors.
    console.error(`[rc-webhook] Error handling ${type}:`, err);
    return new Response('Handler error', { status: 500 });
  }
});

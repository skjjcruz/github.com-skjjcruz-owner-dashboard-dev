/**
 * fw-billing-portal - authenticated Stripe Billing Portal session for the
 * signed-in account.
 *
 * POST /functions/v1/fw-billing-portal
 * Body: { returnUrl? }
 * Returns: { url } — the Stripe-hosted portal where the user can cancel,
 * change plan, or update their card. Web (Stripe) subscriptions only; App
 * Store subscriptions are managed in Apple ID settings and the client links
 * there directly instead of calling this.
 *
 * Env:
 *   STRIPE_SECRET_KEY
 */

import Stripe from 'npm:stripe@14';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clientIp,
  handleOptions,
  json,
  requireActiveAppSession,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  try {
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const appSession = await requireActiveAppSession(admin, req);
    if (!appSession) return json(req, { error: 'Invalid session token.' }, 401);
    const userId = appSession.userId;
    const userEmail = appSession.email || undefined;

    const rateLimit = await checkRateLimit(admin, 'fw-billing-portal:user', userId, { limit: 10, windowSeconds: 3600, lockoutSeconds: 900 });
    const ipLimit = await checkRateLimit(admin, 'fw-billing-portal:ip', clientIp(req), { limit: 30, windowSeconds: 3600, lockoutSeconds: 900 });
    if (!rateLimit.allowed || !ipLimit.allowed) {
      await auditEvent(admin, req, 'billing_portal', 'blocked', { userId, email: userEmail }, { reason: 'rate_limited' });
      return json(req, { error: 'Too many attempts. Try again later.' }, 429);
    }

    const { returnUrl } = await req.json().catch(() => ({} as Record<string, unknown>));
    const safeReturnUrl = validateReturnUrl(returnUrl, `${SUPABASE_URL}/landing.html`);
    if (!safeReturnUrl) {
      await auditEvent(admin, req, 'billing_portal', 'failure', { userId, email: userEmail }, { reason: 'invalid_return_url' });
      return json(req, { error: 'Return URL is not allowed.' }, 400);
    }

    const { data: appUser } = await admin
      .from('app_users')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    const customerId = appUser?.stripe_customer_id;
    if (!customerId) {
      // No Stripe history — nothing to manage on the web. The client falls
      // back to the plans page (or Apple ID settings for App Store subs).
      await auditEvent(admin, req, 'billing_portal', 'failure', { userId, email: userEmail }, { reason: 'no_stripe_customer' });
      return json(req, { error: 'No web subscription on this account.', code: 'no_stripe_customer' }, 404);
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' as any });
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: safeReturnUrl,
    });

    await auditEvent(admin, req, 'billing_portal', 'success', { userId, email: userEmail }, { portalSessionId: portalSession.id });
    return json(req, { url: portalSession.url });

  } catch (err) {
    console.error('fw-billing-portal error:', err);
    return json(req, { error: 'Failed to open the billing portal.' }, 500);
  }
});

function allowedReturnOrigins(): string[] {
  // Same policy as fw-create-checkout's redirect allowlist: known production
  // origins plus env-configured extras, which may only widen the list.
  const defaults = 'http://localhost:3001,http://localhost:3002,http://127.0.0.1:3001,http://127.0.0.1:3002,https://jcc100218.github.io,https://warroom.skjjcruz.com,https://skjjcruz.github.io';
  const configured = (Deno.env.get('APP_ALLOWED_ORIGINS') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  return [...new Set([...defaults.split(','), ...configured])];
}

function validateReturnUrl(value: unknown, fallback: string): string | null {
  if (value == null || value === '') return fallback;
  try {
    const parsed = new URL(String(value));
    return allowedReturnOrigins().includes(parsed.origin) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/*
 * js/billing.js — Dynasty HQ in-app purchases (Apple StoreKit via RevenueCat)
 *
 * Platform-aware billing:
 *   • iOS app (Capacitor native) → Apple In-App Purchase through RevenueCat
 *   • Web browser                → caller falls back to the existing Stripe flow
 *
 * RevenueCat dashboard wiring (live lineup, project "Dynasty HQ Fantasy Football"):
 *   entitlement: 'dhq'   offering: 'default'
 *   packages:    'dhq monthly' / 'dhq annual'
 *   products:    com.dhqfootball.app.dhq.monthly / com.dhqfootball.app.dhq.annual
 *
 * The server side is already deployed: fw-revenuecat-webhook mirrors RevenueCat
 * events into public.subscriptions (product_slug 'dhq', tier 'pro') — the same
 * rows the Stripe webhook writes. Its one requirement is that events arrive
 * keyed to a Supabase account, which means this module MUST identify the SDK
 * with app_users.id (Purchases.logIn) before any purchase. Without that, App
 * Store purchases land as no_matching_user and the buyer stays on Scout.
 *
 * Native plugin: @revenuecat/purchases-capacitor (see BILLING-SETUP.md). After
 * `npm install` + `npx cap sync ios`, the plugin is reachable through the
 * Capacitor bridge at window.Capacitor.Plugins.Purchases. This app loads JS via
 * <script> tags (no bundler), so we call the bridge directly instead of
 * importing the npm wrapper.
 *
 * ⚠️ The native purchase path can ONLY be verified on a real device / Xcode
 * build. Verify the SDK key and method names against the installed plugin
 * version when testing on the Mac.
 */
(function () {
  'use strict';

  // Public RevenueCat SDK key for the Apple App Store app. Public by design —
  // it cannot move money or read accounts. If purchases fail with an auth
  // error on device, confirm it against RevenueCat → API keys.
  const PUBLIC_APPLE_SDK_KEY = 'appl_kiqhxjGyAcGvGMIhXyHMnxHgMEp';

  const ENTITLEMENT_ID = 'dhq';
  const OFFERING_ID = 'default';
  const PRODUCT_IDS = {
    monthly: 'com.dhqfootball.app.dhq.monthly',
    annual: 'com.dhqfootball.app.dhq.annual',
  };

  const SUPABASE_URL = 'https://sxshiqyxhhifvtfqawbq.supabase.co';
  const SESSION_KEY = 'fw_session_v1';

  function isNative() {
    return !!(window.Capacitor &&
      (typeof window.Capacitor.isNativePlatform === 'function'
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor.isNative));
  }

  function plugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases) || null;
  }

  function available() {
    return isNative() && !!plugin();
  }

  function sessionUserId() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      return s?.user?.id || null;
    } catch { return null; }
  }

  // ── Identification ─────────────────────────────────────────────
  // The webhook maps purchases to accounts by RevenueCat app-user id, so the
  // SDK must be identified with the Supabase app_users.id before a purchase.
  let _configured = false;
  let _identifiedAs = null;
  async function identify(appUserId) {
    if (!available()) return false;
    const uid = appUserId || sessionUserId();
    if (!uid) return false;
    if (_identifiedAs === uid) return true;
    const rc = plugin();
    try {
      if (!_configured) {
        await rc.configure({ apiKey: PUBLIC_APPLE_SDK_KEY, appUserID: uid });
        _configured = true;
      } else {
        await rc.logIn({ appUserID: uid });
      }
      _identifiedAs = uid;
      return true;
    } catch (e) {
      console.warn('[billing] RevenueCat identify failed:', e);
      return false;
    }
  }

  // ── Session re-mint after a purchase ───────────────────────────
  // The stored JWT was minted before the purchase and still carries the old
  // tier. The webhook writes the subscription within seconds of the purchase
  // event; retry the re-mint briefly until the pro tier lands.
  async function remintSession() {
    for (const delayMs of [0, 4000, 10000]) {
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      try {
        const cur = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (!cur?.token) return false;
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/fw-refresh-session`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${cur.token}` },
        });
        if (!resp.ok) continue;
        const data = await resp.json();
        if (data?.token && data?.user?.id) {
          localStorage.setItem(SESSION_KEY, JSON.stringify(
            Object.assign({}, cur, { token: data.token, user: Object.assign({}, cur.user || {}, data.user) })
          ));
          if (data.user.tier === 'pro') return true;
        }
      } catch { /* transient — next attempt */ }
    }
    return false;
  }

  function entitlementActive(customerInfo) {
    try {
      const active = customerInfo?.entitlements?.active || {};
      return !!active[ENTITLEMENT_ID];
    } catch { return false; }
  }

  // ── Purchase ───────────────────────────────────────────────────
  // billing: 'monthly' | 'annual'. Returns { ok, cancelled?, error? }.
  async function purchase(billing) {
    if (!available()) return { ok: false, error: 'In-app purchase is only available in the iOS app.' };
    const identified = await identify();
    if (!identified) return { ok: false, error: 'Sign in before purchasing so the subscription attaches to your account.' };
    const rc = plugin();
    const productId = PRODUCT_IDS[billing === 'annual' ? 'annual' : 'monthly'];
    try {
      const offerings = await rc.getOfferings();
      const offering = offerings?.all?.[OFFERING_ID] || offerings?.current;
      const pkg = (offering?.availablePackages || []).find(p =>
        (p?.product?.identifier || p?.storeProduct?.identifier) === productId);
      if (!pkg) return { ok: false, error: 'This plan is not available right now. Try again shortly.' };
      const result = await rc.purchasePackage({ aPackage: pkg });
      if (!entitlementActive(result?.customerInfo)) {
        return { ok: false, error: 'Purchase did not complete. You have not been charged.' };
      }
      await remintSession();
      return { ok: true };
    } catch (e) {
      if (e?.userCancelled || /cancel/i.test(String(e?.message || ''))) return { ok: false, cancelled: true };
      console.warn('[billing] purchase failed:', e);
      return { ok: false, error: e?.message || 'Purchase failed. You have not been charged.' };
    }
  }

  // ── Restore (required by App Store review) ─────────────────────
  async function restore() {
    if (!available()) return { ok: false, error: 'Restore is only available in the iOS app.' };
    const identified = await identify();
    if (!identified) return { ok: false, error: 'Sign in first, then restore purchases.' };
    try {
      const result = await plugin().restorePurchases();
      const info = result?.customerInfo || result;
      if (!entitlementActive(info)) return { ok: false, error: 'No previous purchases found for this Apple ID.' };
      await remintSession();
      return { ok: true };
    } catch (e) {
      console.warn('[billing] restore failed:', e);
      return { ok: false, error: e?.message || 'Restore failed.' };
    }
  }

  // ── Boot: identify as soon as a signed-in session exists ───────
  // Runs on every page that loads this module; a no-op on web and when
  // signed out. Identifying at boot (not just at purchase time) also keys
  // renewal/cancellation events that RevenueCat replays for this device.
  function boot() {
    if (!available()) return;
    identify().catch(() => {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  window.DHQBilling = { available, isNative, identify, purchase, restore, remintSession };
})();

/*
 * js/billing.js — Dynasty HQ in-app purchases (Apple StoreKit via RevenueCat)
 *
 * Platform-aware billing:
 *   • iOS app (Capacitor native) → Apple In-App Purchase through RevenueCat
 *   • Web browser                → caller falls back to the existing Stripe flow
 *
 * RevenueCat dashboard wiring (already configured in the RevenueCat project):
 *   public SDK key (Apple): appl_kiqhxjGyAcGvGMIhXyHMnxHgMEp  ← public CLIENT key,
 *       safe to ship in the app binary (it cannot move money or read accounts).
 *   entitlements: 'pro' (Pro tier), 'dhq' (Dynasty HQ / standard tier)
 *   offering:     'default'
 *   packages:     pro_monthly, dhq_monthly, dhq_annual
 *   products:     com.dhqfootball.app.pro.monthly / .dhq.monthly / .dhq.annual
 *
 * Native plugin: @revenuecat/purchases-capacitor (install on the Mac — see
 * BILLING-SETUP.md). After `npm install` + `npx cap sync ios`, the plugin is
 * reachable through the Capacitor bridge at window.Capacitor.Plugins.Purchases.
 * This app loads JS via <script> tags (no bundler), so we call the bridge
 * directly instead of importing the npm wrapper.
 *
 * ⚠️ The native purchase path can ONLY be verified on a real device / Xcode
 * build. The method names below follow the RevenueCat Capacitor API; verify them
 * against the installed plugin version when you wire + test on the Mac.
 *
 * This module is intentionally NOT loaded by any page yet. Wiring it into
 * onboarding.html (native → these calls, web → Stripe) is the next step, done
 * with on-device testing.
 */
(function () {
  'use strict';

  // Public RevenueCat SDK key for the Apple App Store app. Public by design.
  const PUBLIC_APPLE_SDK_KEY = 'appl_kiqhxjGyAcGvGMIhXyHMnxHgMEp';

  const ENTITLEMENTS = { PRO: 'pro', DHQ: 'dhq' };
  const OFFERING_ID = 'default';

  // RevenueCat package identifier → the app's product tier (used by the profile
  // + core.js gating). 'pro' → core.js 'pro'; 'standard' → the Dynasty HQ tier.
  const PACKAGE_TO_TIER = {
    pro_monthly: 'pro',
    dhq_monthly: 'standard',
    dhq_annual: 'standard',
  };

  // App Store product id → product slug (must match public.products.slug rows
  // already used by the Stripe flow: 'bundle' = Pro, 'war_room' = Dynasty HQ).
  const PRODUCT_TO_SLUG = {
    'com.dhqfootball.app.pro.monthly': 'bundle',
    'com.dhqfootball.app.dhq.monthly': 'war_room',
    'com.dhqfootball.app.dhq.annual': 'war_room',
  };

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

  // Map the active RevenueCat entitlements to an app tier. Pro wins over Dynasty
  // HQ. Returns 'pro' | 'standard' | null (null = no active paid entitlement).
  function tierFromCustomerInfo(info) {
    try {
      const active = (info && info.entitlements && info.entitlements.active) || {};
      if (active[ENTITLEMENTS.PRO]) return 'pro';
      if (active[ENTITLEMENTS.DHQ]) return 'standard';
    } catch (e) { /* non-fatal */ }
    return null;
  }

  // Configure RevenueCat. `appUserId` MUST be the Supabase app_users.id so the
  // fw-revenuecat-webhook can map purchases back to the account — pass it in.
  let configured = false;
  async function init(appUserId) {
    if (!isNative()) return false; // web → Stripe path handles billing
    const rc = plugin();
    if (!rc) { console.warn('[billing] RevenueCat plugin not found — run `npx cap sync ios`'); return false; }
    try {
      if (!configured) {
        await rc.configure({ apiKey: PUBLIC_APPLE_SDK_KEY, appUserID: appUserId || undefined });
        configured = true;
      } else if (appUserId) {
        await rc.logIn({ appUserID: appUserId });
      }
      return true;
    } catch (e) {
      console.warn('[billing] configure failed:', e);
      return false;
    }
  }

  // Returns the available packages from the current ('default') offering.
  async function getPackages() {
    const rc = plugin();
    if (!rc) return [];
    try {
      const res = await rc.getOfferings();
      const current = (res && res.current) || (res && res.all && res.all[OFFERING_ID]) || null;
      return (current && current.availablePackages) || [];
    } catch (e) {
      console.warn('[billing] getOfferings failed:', e);
      return [];
    }
  }

  // Purchase by RevenueCat package id ('pro_monthly' | 'dhq_monthly' | 'dhq_annual').
  // Resolves to { ok, tier?, cancelled?, error? }. On ok, `tier` is the app tier.
  async function purchase(packageId) {
    const rc = plugin();
    if (!rc) return { ok: false, error: 'Billing is unavailable on this device.' };
    const pkgs = await getPackages();
    const pkg = pkgs.find(function (p) { return p.identifier === packageId; });
    if (!pkg) return { ok: false, error: 'That plan is not available right now.' };
    try {
      const res = await rc.purchasePackage({ aPackage: pkg });
      const tier = tierFromCustomerInfo(res && res.customerInfo);
      return { ok: !!tier, tier: tier, customerInfo: res && res.customerInfo };
    } catch (e) {
      // RevenueCat reports a user cancel via userCancelled (code PURCHASE_CANCELLED).
      if (e && (e.userCancelled === true || e.code === '1' || e.code === 1)) {
        return { ok: false, cancelled: true };
      }
      return { ok: false, error: (e && e.message) || 'Purchase failed. Please try again.' };
    }
  }

  // Restore Purchases (required by App Review). Resolves to { ok, tier?, error? }.
  async function restore() {
    const rc = plugin();
    if (!rc) return { ok: false, error: 'Billing is unavailable on this device.' };
    try {
      const res = await rc.restorePurchases();
      const info = (res && res.customerInfo) || res;
      const tier = tierFromCustomerInfo(info);
      return { ok: !!tier, tier: tier };
    } catch (e) {
      return { ok: false, error: (e && e.message) || 'Could not restore purchases.' };
    }
  }

  // The current active tier from cached RevenueCat state, or null.
  async function currentTier() {
    const rc = plugin();
    if (!rc) return null;
    try {
      const res = await rc.getCustomerInfo();
      const info = (res && res.customerInfo) || res;
      return tierFromCustomerInfo(info);
    } catch (e) {
      console.warn('[billing] getCustomerInfo failed:', e);
      return null;
    }
  }

  window.DHQBilling = {
    isNative: isNative,
    available: available,
    init: init,
    getPackages: getPackages,
    purchase: purchase,
    restore: restore,
    currentTier: currentTier,
    PACKAGE_TO_TIER: PACKAGE_TO_TIER,
    PRODUCT_TO_SLUG: PRODUCT_TO_SLUG,
    ENTITLEMENTS: ENTITLEMENTS,
    OFFERING_ID: OFFERING_ID,
  };
})();

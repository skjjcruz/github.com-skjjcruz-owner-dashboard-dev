/*
 * js/billing.js — Dynasty HQ in-app purchases (Apple StoreKit via RevenueCat)
 *
 * Platform-aware billing:
 *   • iOS app (Capacitor native)          → Apple IAP through RevenueCat (Capacitor plugin)
 *   • iOS app (Swift Playgrounds shell)   → Apple IAP through RevenueCat (WKWebView bridge:
 *     the shell registers a WKScriptMessageHandler named 'dhqBilling'; this module posts
 *     {id, action, userId?, plan?} and the shell replies via DHQBilling._nativeResult(id, result))
 *   • Web browser                         → caller falls back to the existing Stripe flow
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

  function capNative() {
    return !!(window.Capacitor &&
      (typeof window.Capacitor.isNativePlatform === 'function'
        ? window.Capacitor.isNativePlatform()
        : window.Capacitor.isNative));
  }

  function plugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Purchases) || null;
  }

  // Swift Playgrounds shell: the native side registers a script message
  // handler named 'dhqBilling' and answers through DHQBilling._nativeResult.
  function wkBridge() {
    try { return (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.dhqBilling) || null; }
    catch { return null; }
  }

  function isNative() {
    return capNative() || !!wkBridge();
  }

  function available() {
    return (capNative() && !!plugin()) || !!wkBridge();
  }

  // ── WKWebView bridge plumbing (Playgrounds shell) ───────────────
  // Each call gets an id; the shell replies by evaluating
  //   window.DHQBilling._nativeResult(id, { ok, cancelled?, error?, entitled? })
  const _pending = new Map();
  const _unsettledShell = new Set();
  const SHELL_FLIGHT_KEY = 'dhq_billing_shell_inflight_v1';
  function shellFlight() {
    try {
      const raw = localStorage.getItem(SHELL_FLIGHT_KEY);
      if (!raw) return null;
      const value = JSON.parse(raw);
      return value && typeof value.id === 'string' ? value : { unknown: true };
    } catch { return { unknown: true }; }
  }
  function unresolvedShell() {
    const flight = shellFlight();
    return !!flight && (!_pending.has(flight.id) || _unsettledShell.has(flight.id));
  }
  function callShell(action, extra, timeoutMs) {
    return new Promise((resolve) => {
      // Native work can outlive this document. Persist before posting and do
      // not release it on a timeout, reload, sign-out, or uncertain exception.
      if (shellFlight()) { resolve({ ok: false, error: 'A previous App Store request is unresolved.' }); return; }
      let id;
      try {
        id = 'b_' + crypto.randomUUID();
        const record = JSON.stringify({ id, action });
        localStorage.setItem(SHELL_FLIGHT_KEY, record);
        if (localStorage.getItem(SHELL_FLIGHT_KEY) !== record) throw new Error('Could not save billing recovery.');
      } catch { resolve({ ok: false, error: 'Billing recovery could not be saved on this device.' }); return; }
      let settled = false;
      const timer = setTimeout(() => {
        if (!_pending.has(id) || settled) return;
        settled = true; _unsettledShell.add(id); _identifiedAs = null;
        // A UI timeout does not cancel the native operation. Keep its late
        // completion callback and prevent a new provider identity meanwhile.
        resolve({ ok: false, error: 'The App Store result is still unconfirmed.' });
      }, timeoutMs || 180000); // sandbox purchases can take 15s+; give real ones headroom
      _pending.set(id, (result) => {
        clearTimeout(timer); _unsettledShell.delete(id);
        if (!settled) { settled = true; resolve(result || { ok: false, error: 'Empty response.' }); }
      });
      try {
        wkBridge().postMessage(Object.assign({ id, action }, extra || {}));
      } catch (e) {
        clearTimeout(timer);
        settled = true; _unsettledShell.add(id); _identifiedAs = null;
        resolve({ ok: false, error: e && e.message ? e.message : 'Could not reach the App Store bridge.' });
      }
    });
  }
  function _nativeResult(id, result) {
    // A matching native completion may arrive in a replacement document.
    // Release only that request; it cannot resume old-account JavaScript.
    const flight = shellFlight();
    if (!flight || flight.id !== id) return;
    try { localStorage.removeItem(SHELL_FLIGHT_KEY); } catch { /* keep the fence if storage is unavailable */ }
    _unsettledShell.delete(id);
    const cb = _pending.get(id);
    if (cb) { _pending.delete(id); cb(result); }
  }

  // One operation owns one exact app credential. Re-mint may replace that
  // credential only for the same account and updates this operation's snapshot.
  function captureSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      const value = JSON.parse(raw || 'null');
      if (!value?.token || !value?.user?.id) return null;
      return { raw, token: value.token, userId: value.user.id };
    } catch { return null; }
  }
  function isCurrentSession(context) {
    try { return !!context && localStorage.getItem(SESSION_KEY) === context.raw; }
    catch { return false; }
  }
  const stale = () => ({ ok: false, accountChanged: true, error: 'The signed-in account changed. Open billing again for the current account.' });
  const pending = (message) => ({ ok: false, pending: true, error: message || 'Your Pro access is not confirmed yet. Check your plan again or restore purchases before trying another purchase.' });

  const pendingKey = context => 'dhq_billing_pending_v1:' + encodeURIComponent(context.userId);
  function hasPendingPurchase(context = captureSession()) {
    try { return !!context && sessionStorage.getItem(pendingKey(context)) === 'pending'; }
    catch { return false; }
  }
  function markPending(context) {
    try { sessionStorage.setItem(pendingKey(context), 'pending'); return true; }
    catch { return false; }
  }
  function clearPending(context) {
    try { sessionStorage.removeItem(pendingKey(context)); } catch { /* confirmed server access remains authoritative */ }
  }

  // Provider identity and purchase/restore must be one serialized operation.
  // In particular a delayed boot identify cannot move the SDK to A while B's
  // purchase is running. Every continuation still checks the app credential.
  let providerQueue = Promise.resolve();
  let providerBusy = false;
  function serialProvider(work) {
    const result = providerQueue.then(work, work);
    providerQueue = result.catch(() => {});
    return result;
  }
  let _configured = false;
  let _identifiedAs = null;
  async function identifyCurrent(context) {
    if (!available() || !isCurrentSession(context) || unresolvedShell()) return false;
    const uid = context.userId;
    if (_identifiedAs === uid) return true;
    try {
      if (wkBridge()) {
        const result = await callShell('identify', { userId: uid }, 30000);
        if (result.ok !== true) return false;
      } else {
        const rc = plugin();
        if (!_configured) {
          await rc.configure({ apiKey: PUBLIC_APPLE_SDK_KEY, appUserID: uid });
          _configured = true;
        } else {
          await rc.logIn({ appUserID: uid });
        }
      }
      // Track the identity actually installed in the SDK, even if the app
      // switched while it was pending. The next queued operation reidentifies.
      _identifiedAs = uid;
      return isCurrentSession(context);
    } catch (e) {
      console.warn('[billing] identification failed:', e);
      return false;
    }
  }
  function identify(appUserId) {
    const context = captureSession();
    if (!context || (appUserId && appUserId !== context.userId)) return Promise.resolve(false);
    return serialProvider(() => identifyCurrent(context));
  }

  async function remintSession(context = captureSession()) {
    for (const delayMs of [0, 4000, 10000]) {
      if (!isCurrentSession(context)) return false;
      if (delayMs) await new Promise(r => setTimeout(r, delayMs));
      if (!isCurrentSession(context)) return false;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/fw-refresh-session`, {
          method: 'POST', headers: { 'Authorization': `Bearer ${context.token}` }, signal: controller.signal,
        });
        if (!isCurrentSession(context)) return false;
        if (!resp.ok) {
          if (resp.status === 401) return false;
          continue;
        }
        const data = await resp.json();
        if (!isCurrentSession(context)) return false;
        if (typeof data?.token !== 'string' || !data.token || data?.user?.id !== context.userId || !['free', 'pro'].includes(data.user.tier)) return false;
        const cur = JSON.parse(context.raw);
        const updated = JSON.stringify(Object.assign({}, cur, {
          token: data.token, user: Object.assign({}, cur.user || {}, data.user),
        }));
        localStorage.setItem(SESSION_KEY, updated);
        context.raw = updated; context.token = data.token;
        if (data.user.tier === 'pro') { clearPending(context); return true; }
      } catch { /* no confirmed save or transient failure: keep recovery available */ }
      finally { clearTimeout(timer); }
    }
    return false;
  }
  function entitlementActive(customerInfo) {
    return !!customerInfo?.entitlements?.active?.[ENTITLEMENT_ID];
  }

  async function nativeOperation(kind, billing, context = captureSession()) {
    if (!available()) return { ok: false, error: 'In-app billing is only available in the iOS app.' };
    if (!context) return { ok: false, error: 'Sign in before opening billing so purchases attach to your account.' };
    if (unresolvedShell()) return pending('The App Store has not finished its previous request. You can check your plan while waiting for its result.');
    if (providerBusy) return { ok: false, busy: true, error: 'A billing request is already running. Wait for its result.' };
    providerBusy = true;
    try {
      return await serialProvider(async () => {
        if (!isCurrentSession(context)) return stale();
        const wasPending = hasPendingPurchase(context);
        if (kind === 'purchase' && wasPending) return pending();
        if (!await identifyCurrent(context)) return isCurrentSession(context)
          ? { ok: false, error: 'The App Store account could not be connected. Check your sign-in and try again.' } : stale();
        if (!isCurrentSession(context)) return stale();
        try {
          let entitled = false;
          if (wkBridge()) {
            if (!markPending(context)) return { ok: false, error: 'Purchase recovery could not be saved on this device. Free storage or reopen the app before purchasing.' };
            const result = await callShell(kind, kind === 'purchase' ? { plan: billing === 'annual' ? 'annual' : 'monthly' } : {}, kind === 'purchase' ? 240000 : 120000);
            if (!isCurrentSession(context)) return stale();
            if (result.cancelled === true) { if (kind === 'purchase' || !wasPending) clearPending(context); return { ok: false, cancelled: true }; }
            if (result.ok !== true) return pending('The App Store result could not be confirmed. Check your plan or restore purchases before trying another purchase.');
            entitled = result.entitled === true;
          } else if (kind === 'restore') {
            if (!markPending(context)) return { ok: false, error: 'Billing recovery could not be saved on this device. Free storage or reopen the app before continuing.' };
            const result = await plugin().restorePurchases();
            if (!isCurrentSession(context)) return stale();
            entitled = entitlementActive(result?.customerInfo || result);
          } else {
            const offerings = await plugin().getOfferings();
            if (!isCurrentSession(context)) return stale();
            const offering = offerings?.all?.[OFFERING_ID] || offerings?.current;
            const pkg = (offering?.availablePackages || []).find(p =>
              (p?.product?.identifier || p?.storeProduct?.identifier) === PRODUCT_IDS[billing === 'annual' ? 'annual' : 'monthly']);
            if (!pkg) return { ok: false, error: 'This plan is not available right now. Try again shortly.' };
            if (!markPending(context)) return { ok: false, error: 'Purchase recovery could not be saved on this device. Free storage or reopen the app before purchasing.' };
            const result = await plugin().purchasePackage({ aPackage: pkg });
            if (!isCurrentSession(context)) return stale();
            entitled = entitlementActive(result?.customerInfo);
          }
          if (!entitled) {
            if (kind === 'restore' && !wasPending) clearPending(context);
            return kind === 'restore'
            ? { ok: false, error: 'The App Store did not report an active Pro subscription. Check your Apple subscriptions if you expected one.' }
            : pending('The App Store has not confirmed active Pro access. Check your plan or restore purchases before trying another purchase.');
          }
          const confirmed = await remintSession(context);
          if (!isCurrentSession(context)) return stale();
          return confirmed ? { ok: true } : pending();
        } catch (e) {
          if (!isCurrentSession(context)) return stale();
          // Only the SDK's explicit cancellation flag establishes cancellation.
          if (e?.userCancelled === true) { if (kind === 'purchase' || !wasPending) clearPending(context); return { ok: false, cancelled: true }; }
          console.warn('[billing] request failed:', e);
          return pending('The billing result could not be confirmed. Check your plan or restore purchases before trying another purchase.');
        }
      });
    } finally { providerBusy = false; }
  }
  const purchase = (billing, context) => nativeOperation('purchase', billing, context);
  const restore = (context) => nativeOperation('restore', null, context);

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

  window.DHQBilling = { available, isNative, identify, purchase, restore, remintSession, captureSession, isCurrentSession, hasPendingPurchase, _nativeResult };
})();

# Dynasty HQ — In‑App Purchases (Apple StoreKit via RevenueCat)

Status: **backend + client foundation in place; native wiring + go‑live still to do.**

This documents the payments setup so nothing is lost between sessions. Apple
requires digital subscriptions sold inside the iOS app to use **In‑App Purchase**
(Guideline 3.1.1) — Stripe/Apple Pay for these would be rejected. Stripe stays
for the **web** only.

---

## What's already done

### App Store Connect ✅
- Bundle ID: `com.dhqfootball.app`
- Subscription group **Dynasty HQ Membership** with 3 auto‑renewable products,
  each with a **7‑day free trial** (Free intro offer) and worldwide pricing:

  | Product ID | Tier | Price | Duration |
  |---|---|---|---|
  | `com.dhqfootball.app.pro.monthly` | Pro | $14.99 | 1 month |
  | `com.dhqfootball.app.dhq.monthly` | Dynasty HQ | $9.99 | 1 month |
  | `com.dhqfootball.app.dhq.annual` | Dynasty HQ | $79.99 | 1 year |

- **Billing grace period:** 16 days, All Renewals, Production + Sandbox.
- **App Store Server Notifications** → RevenueCat URL (Production + Sandbox).
- Paid Apps Agreement active; banking + tax (W‑9) complete; vendor # `94335423`.

### RevenueCat ✅
- iOS app linked (In‑App Purchase key `D294R7WL43` + App Store Connect API key
  `22BV6RY325`, both "Valid credentials").
- Products imported. **Entitlements:** `pro` (Pro Monthly), `dhq` (DHQ Monthly +
  Annual). **Offering** `default` (current) with packages `pro_monthly`,
  `dhq_monthly`, `dhq_annual`.
- **Public Apple SDK key:** `appl_kiqhxjGyAcGvGMIhXyHMnxHgMEp` (public client key —
  safe to ship; it's embedded in `js/billing.js`).

### This repo ✅
- `js/billing.js` — RevenueCat client (configure / offerings / purchase /
  **restore** / entitlement→tier). Not loaded by any page yet.
- `supabase/functions/fw-revenuecat-webhook/` — writes RevenueCat events into the
  existing `subscriptions` table (mirrors `fw-stripe-webhook`).

---

## Remaining steps to go live

### 1. Install the native plugin (on the Mac, where Xcode lives)
```bash
npm install @revenuecat/purchases-capacitor   # use the version compatible with Capacitor 8
npx cap sync ios
```
Then open Xcode (`npm run cap:ios`), confirm the **In‑App Purchase** capability is
on the target, and build to a device. The plugin registers on the Capacitor
bridge as `window.Capacitor.Plugins.Purchases`, which `js/billing.js` calls.

### 2. Deploy the webhook + set secrets (Supabase)
```bash
supabase functions deploy fw-revenuecat-webhook
supabase secrets set REVENUECAT_WEBHOOK_AUTH=<a-strong-random-string>
```
Then in **RevenueCat → Integrations → Webhooks**:
- URL: `https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/fw-revenuecat-webhook`
- **Authorization** header: the same `<strong-random-string>` as the secret.

### 3. Wire the paywall (next code change — needs device testing)
In `onboarding.html`, branch the payment step on platform:
- **Native** (`window.DHQBilling.available()`): show the plans from
  `DHQBilling.getPackages()`, buy with `DHQBilling.purchase('pro_monthly' | …)`,
  and on success set the profile tier (`pro`/`standard`) so the app unlocks.
- **Web**: keep the existing Stripe `goToStripe()` flow.
- The iOS build must show **no** Stripe/credit‑card UI (instant rejection).

`init()` must be called with the **Supabase user id** as the RevenueCat
`appUserID` — that's how the webhook maps a purchase to the account. Anonymous
ids won't sync.

### 4. Turn on tier enforcement (the go‑live switch)
Gating is currently OFF for TestFlight (`canAccess()` returns `true`). When
purchases are tested end‑to‑end, set `window.__WR_ENFORCE_TIERS = true`
(see `js/core.js`). Map entitlements → tier: `pro` → `pro`, `dhq` → `warroom`.

### 5. App Review must‑haves on the paywall
- **Restore Purchases** button → `DHQBilling.restore()`.
- Near the buy button: plan name, length, **price, and "auto‑renews unless
  cancelled."**
- Links to **Terms of Use (EULA)** + **Privacy Policy** (`legal/`).
- Add the paywall **review screenshot** to each product in App Store Connect.

---

## Tier mapping reference
| RevenueCat entitlement | Product(s) | App tier (`_productTier`) | `subscriptions.product_slug` |
|---|---|---|---|
| `pro` | `pro.monthly` | `pro` | `bundle` |
| `dhq` | `dhq.monthly`, `dhq.annual` | `warroom` (a.k.a. "standard") | `war_room` |
| none | — | `free` / `scout` | — |

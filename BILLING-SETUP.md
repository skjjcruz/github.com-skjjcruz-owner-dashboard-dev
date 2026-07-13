# Apple In-App Purchase setup (RevenueCat)

How iOS billing works and the on-device steps needed to finish wiring it.
Web billing (Stripe via `fw-create-checkout`) is unaffected.

## How the pieces fit

```
iOS app ──purchase──▶ Apple StoreKit ──receipt──▶ RevenueCat
                                                      │ webhook
                                                      ▼
                                    fw-revenuecat-webhook (Supabase)
                                                      │ upsert
                                                      ▼
                                    public.subscriptions (product_slug 'dhq', tier 'pro')
                                                      │ read at token mint
                                                      ▼
                                    fw-refresh-session → app JWT carries tier 'pro'
```

The one requirement the webhook cannot work without: the app must identify
the RevenueCat SDK with the signed-in account's `app_users.id` **before** a
purchase (`Purchases.logIn`). `js/billing.js` does this automatically at boot
on every page that loads it, and again defensively before each purchase.
Unidentified purchases arrive as `no_matching_user` and are skipped — the
buyer would stay on Scout.

## Already in place

- `js/billing.js` — identification at boot, purchase, restore, and post-purchase
  session re-mint. Loaded by `index.html` and `upgrade.html`. No-op on web.
- `upgrade.html` (the Go Pro page) routes to Apple IAP when running native
  (App Store guideline 3.1.1), Stripe otherwise.
- `fw-revenuecat-webhook` deployed with `REVENUECAT_WEBHOOK_AUTH` secret.
- RevenueCat dashboard: entitlement `dhq`, offering `default`, packages
  `dhq monthly` / `dhq annual`, products `com.dhqfootball.app.dhq.monthly`
  and `com.dhqfootball.app.dhq.annual`.
- `@revenuecat/purchases-capacitor` in package.json (the JS calls go through
  the Capacitor bridge — no bundler import needed).

## To finish on the Mac (cannot be done from CI)

1. `npm install && npx cap sync ios`
2. Open `ios/App` in Xcode; confirm the In-App Purchase capability is on.
3. Verify the public SDK key in `js/billing.js` (`PUBLIC_APPLE_SDK_KEY`)
   matches RevenueCat → Project settings → API keys → Apple App Store
   (public `appl_…` key). Update if it was regenerated.
4. Build to a device / TestFlight and verify with a sandbox Apple ID:
   - sign in, buy Pro monthly on the Go Pro page → Settings should show Pro
     within seconds (webhook + fw-refresh-session);
   - `subscriptions` row appears with `store = 'app_store'`;
   - Restore Purchases works after deleting/reinstalling the app.
5. In RevenueCat → Integrations → Webhooks confirm the webhook URL is
   `https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1/fw-revenuecat-webhook`
   with the Authorization header equal to the `REVENUECAT_WEBHOOK_AUTH` secret.

## Debugging

- Purchases landing as `no_matching_user`: the SDK wasn't identified —
  check `[billing]` console logs in Safari's device inspector.
- Purchase succeeds but app still shows Scout: check `fw_refresh_session`
  rows in `security_events`, and the `subscriptions` row's `status`.
- The RevenueCat sandbox environment fires the same webhook with
  `environment: 'SANDBOX'`; test events of type `TEST` are acknowledged
  and ignored by design.

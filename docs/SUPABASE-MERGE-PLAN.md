# Supabase Project Merge Plan — Scout + War Room → one backend

**Goal:** collapse the two Supabase projects into a single backend before launch, so a
shared user account and a cross-app "bundle" subscription are first-class instead of being
kept in sync across two databases.

**Status:** PLAN ONLY. Everything here is gated behind deliberately enabling Supabase
**write** access. The investigation that produced this plan was 100% read-only.

**Decision (this doc):** the surviving primary project is **ReconAI / Scout
(`sxshiqyxhhifvtfqawbq`)**. War Room (`hovnqztlbsgsywrbidbh`) is migrated into it and then
retired. Rationale below — it comes down to data gravity.

---

## Decisions locked (2026-06-08)

| # | Decision | Choice |
|---|---|---|
| 1 | Surviving primary project | **Scout `sxshiqyxhhifvtfqawbq`, stay on us-west-2.** No relocation — avoids migrating 37.5K analytics rows + real users/subs. |
| 2 | Legacy identity model (`users`/`sleeper_username` vs `app_users`) | **Collapse during the merge.** Standardize on `app_users.id`; fold `sleeper_username` into `app_users.platform_usernames`. (See §1.) |
| 3 | Billing | **Remove Stripe entirely. Sell on the App Store via Apple In-App Purchase only, to start.** Entitlements become IAP-driven (built later — pricing/products still on hold). This rewrites Phases 4–5 below. |
| 4 | `fw-delete-account` live gap | **Deployed to Scout now** as a standalone fix (2026-06-08), ahead of the merge. Closes the App-Store in-app-deletion blocker. |

> **Stripe removal scope (new work, separate write-access task — not yet executed):**
> retire the `fw-create-checkout` and `fw-stripe-webhook` edge functions; drop the
> `stripe_customer_id` (`app_users`) and `stripe_subscription_id` / `stripe_price_id`
> (`subscriptions`) columns once nothing reads them; strip the best-effort Stripe-cancel
> block from `fw-delete-account`; and remove Stripe references from both frontends
> (8 files in the War Room repo, 2 in the ReconAI repo). Do this as its own reviewed change,
> **after** the `subscriptions` table is repurposed for IAP entitlements so no billing state
> is lost. Until then the dormant Stripe code is harmless (no new checkouts will be created).

---

## 0. What's actually out there (read-only inventory, 2026-06-08)

### Project → app → repo mapping

| Supabase project | Project name | Region / PG | App | Frontend repo | Endpoint config |
|---|---|---|---|---|---|
| **`sxshiqyxhhifvtfqawbq`** | "Owner Dashboard" | us-west-2 / 17.6.1.063 | **ReconAI / Scout** | `ReconAI-sandbox-dev` | `shared/app-config.js`, `shared/supabase-client.js` |
| **`hovnqztlbsgsywrbidbh`** | "github.com-skjjcruz-owner-dashboard-dev" | us-east-2 / 17.6.1.121 | **Dynasty HQ / War Room** | `github.com-skjjcruz-owner-dashboard-dev` | `draft-war-room/supabase-config.js` |

The Supabase *project names* are misleading (both descend from an "owner-dashboard" template).
The mapping above is established from hard evidence, not the names:
- `sxshiqyxhhifvtfqawbq` migration `003_rename_tier_reconai_to_scout`, `field_log.source` default
  `'scout'`, and `espn/yahoo/mfl` proxies → this is **Scout**.
- `ReconAI-sandbox-dev/shared/app-config.js` hard-codes `supabaseUrl =
  https://sxshiqyxhhifvtfqawbq.supabase.co` (14 refs in that repo).
- `github.com-skjjcruz-owner-dashboard-dev/draft-war-room/supabase-config.js` hard-codes
  `https://hovnqztlbsgsywrbidbh.supabase.co` (35 refs in that repo).

### Where the real users and data live

**All of it is in Scout (`sxshiqyxhhifvtfqawbq`).** War Room is effectively empty (founder
test accounts only).

| Table | Scout (`sxshiqyxhhifvtfqawbq`) | War Room (`hovnqztlbsgsywrbidbh`) |
|---|---:|---:|
| `app_users` (email/password identity) | **6** | 3 |
| `subscriptions` | **6** | 2 |
| `app_user_roles` | 1 | 2 (`owner`) |
| `users` (legacy `sleeper_username`) | **11** | 0 |
| `ai_analysis` | **262** | 0 |
| `analytics_events` | **37,542** | 0 |
| `field_log` | **59** | 0 |
| `security_events` | 149 | 12 |
| `ai_rate_limits` (legacy quota) | 4 | — (table does not exist) |
| `ai_usage_daily` / `ai_usage_monthly` (new quota) | 8 / 4 | 0 / 0 |

**Conclusion → which becomes primary:** moving Scout's data (37.5K analytics rows, 262
analyses, real users + active subscriptions, mature edge functions) into War Room would be a
high-risk migration for no benefit. Moving War Room's ~5 test rows into Scout is trivial.
Data gravity decides it: **Scout is primary.**

### Edge functions — each project has functions the other lacks

| Function | Scout | War Room | Notes |
|---|:--:|:--:|---|
| `ai-analyze` | v112 | v6 | Scout is far more mature |
| `fw-signup/signin/profile/create-checkout/stripe-webhook` | ✓ | ✓ | parity |
| `fw-request/confirm-password-reset`, `set-password`, `get-session-token` | ✓ | ✓ | parity |
| `admin-list-users`, `admin-analytics-report` | ✓ | ✓ | parity |
| `espn-proxy`, `yahoo-proxy` | ✓ | — | Scout-only (needs `yahoo_tokens` table) |
| `mfl-proxy` | ✓ | ✓ | parity |
| **`fw-delete-account`** | **—** | ✓ | **War-Room-only — see gap below** |
| **`fw-oauth-sync`** | **—** | ✓ | War-Room-only (Google/Apple sign-in sync) |

> ⚠️ **Live gap, independent of the merge:** `ReconAI-sandbox-dev/shared/supabase-client.js`
> defines `fwDeleteAccount` and calls it against Scout, but **`fw-delete-account` is not
> deployed to Scout.** In-app account deletion is currently broken on the live app, and Apple
> requires it. This must be deployed to Scout regardless of whether the merge proceeds.

### The two divergent AI-quota systems

1. **Legacy — `ai_rate_limits`** (Scout only, 4 rows): keyed on `username` + `date`, counts
   `request_count` / `tokens_used`. The original Scout throttle.
2. **Modern — `ai_usage_daily` + `ai_usage_monthly`** (both projects; Scout actively uses it,
   8/4 rows): keyed on `identifier` + `user_id`, with `tier`, `estimated_cost_usd`,
   `reserved_cost_usd` (cost-based budgeting + reservation). Introduced by migration
   `009_ai_usage_accounting` / `20260503000000_ai_usage_controls`.

Scout is mid-migration and runs **both** simultaneously. The collapse target is the modern
cost-based system; `ai_rate_limits` is retired.

### Migration lineage

- **War Room** has exactly 9 migrations: `20260317000000` → `20260517000000`. These are the
  *modern subset* of Scout's history — it was branched fresh on 2026-05-22 from a clean
  baseline, so it never carried the legacy `001`–`019` migrations or `ai_rate_limits`.
- **Scout** has the full 28: legacy `001`–`019` **plus** the same modern `2026*` set.

Implication: Scout's schema is a **superset** of War Room's, except for a handful of
War-Room-only objects (below). Merging *into* Scout means porting only the deltas.

### War-Room-only schema objects to port into Scout

- `mock_drafts` table (share_slug, draft_state, is_public) — does not exist in Scout.
- `mock_draft_prospects` — exists in both but War Room's `id` is `uuid` vs Scout's `integer`
  sequence (reconcile type).
- `draft_boards` — War Room's variant has no `user_id` FK and uses `numeric` for
  `num_teams`/`num_rounds` vs Scout's `integer`. Scout's is the richer one; keep Scout's.

---

## 1. Identity model note (read before any data move)

Scout carries **two** identity tables, a legacy artifact:
- `users` (PK `id` uuid, unique `sleeper_username`) — the *original* identity; most domain
  tables still FK to `users.sleeper_username`.
- `app_users` (PK `id` uuid, unique `email`) — the *current* email/password identity that
  billing, roles, and the new quota system FK to.

Most domain tables now carry **both** `username` (→ `users.sleeper_username`) and `user_id`
(→ `app_users.id`). This dual-key model is the single biggest source of "sync fragility" and
should be resolved as part of the merge, not after:

- **Target:** `app_users.id` is the canonical user key everywhere. `users` /
  `sleeper_username` becomes a *profile attribute* of an `app_user` (move it onto
  `app_users.platform_usernames`, which already exists), not a separate identity.
- This is a prerequisite for a clean "shared account across both apps" — you can't have a
  shared account if half the tables key off a Sleeper username that only Scout users have.

---

## 2. Merge plan (phased, all behind write-access enablement)

Each phase is independently reversible up to the cutover in Phase 6. Do **not** enable
Supabase write access until you're ready to start Phase 0, and disable it again between
working sessions.

### Phase 0 — Freeze & backup (no schema change)
- [ ] Snapshot both projects (Supabase dashboard → Database → Backups → on-demand, plus a
      `pg_dump` of `public` for each held outside Supabase).
- [ ] Record current edge-function versions and secrets (Stripe keys, AI provider keys, vault
      entries from `20260517000000_ai_provider_vault_fallback`).
- [ ] Put War Room into read-only / maintenance (it has no real traffic, so low cost).

### Phase 1 — Schema reconciliation on Scout (additive only)
- [x] **Add `mock_drafts` to Scout** (2026-06-08, migration `20260608000000_add_mock_drafts_table`).
      War Room's copy was empty (0 rows) → schema parity only. Adapted to Scout's dual-identity
      RLS (added `user_id`→`app_users` CASCADE, relaxed `sleeper_username` to nullable,
      `_account_own` + `_own` + public-by-slug policies).
- [ ] Reconcile `mock_draft_prospects.id` type; keep Scout's richer `draft_boards`.
- [ ] Verify every War-Room-only column/constraint has a home in Scout. Net effect: Scout's
      schema becomes a true superset.
- [x] **Re-ran `get_advisors` (security) after DDL** — `mock_drafts` clean (has policies). All
      remaining lints are pre-existing (ai_usage_* RLS-no-policy [service-role-only],
      mutable `search_path` on several funcs, `draft_boards` permissive `Public write`,
      `increment_rate_limit` anon-executable SECURITY DEFINER). Cleanup candidates, not blockers.

### Phase 2 — Collapse the AI-quota systems
- [ ] Backfill the 4 `ai_rate_limits` rows into `ai_usage_daily` (map `username`→`identifier`
      + resolve `user_id` via `users`→`app_users`; `tokens_used` carries over, cost columns
      default 0).
- [ ] Confirm `ai-analyze` (Scout v112) already reads/writes `ai_usage_daily/monthly` and no
      longer depends on `ai_rate_limits`; if any path still references it, patch the function.
- [ ] Drop `ai_rate_limits` (last, after the function is confirmed clean).

### Phase 3 — Edge-function consolidation on Scout
- [x] **`fw-delete-account` deployed to Scout** (2026-06-08, v1, `verify_jwt=false`). Verified
      all 16 `app_users` child FKs are `ON DELETE CASCADE`, so deletion wipes child data.
- [x] **`fw-oauth-sync` deployed to Scout** (2026-06-08, v1, `verify_jwt=false`). Pre-verified
      Scout's `products` slugs are `{bundle, dynast_hq, war_room}` — matches the function's valid
      set, so the auto-provisioned free-subscription insert won't hit the `product_slug` FK.
- [ ] Keep Scout's `espn-proxy` / `yahoo-proxy` / `yahoo_tokens` (War Room lacks these).
- [ ] Diff `ai-analyze` and the `fw-*` functions between projects; Scout's are newer, so War
      Room contributes only the OAuth-sync function above. Confirm no War-Room-only behavior is lost.
- [ ] As part of Stripe removal (Decision 3): retire `fw-create-checkout` + `fw-stripe-webhook`
      and strip the Stripe-cancel block from `fw-delete-account`. Sequence this **after** Phase 5.

### Phase 4 — Migrate War Room's users into Scout
- [ ] Dedupe `app_users` by `email`. For collisions, Scout wins (it's the live record);
      War Room test accounts that collide are dropped, not merged.
- [ ] Migrate non-colliding War Room `app_users` (likely 0–3 real) and their `app_user_roles`
      (2 `owner` rows → grant to the corresponding Scout `app_users`).
- [ ] **No Stripe reconcile** (Decision 3). War Room's 2 subscription rows are test data; do not
      carry over Stripe IDs. Any real entitlement is re-established via IAP (Phase 5).

### Phase 5 — Products & the cross-app "bundle" entitlement (Apple IAP)
- [ ] `products` already supports multiple slugs in one project. Define the product set in
      Scout: `scout`, `warroom`, and a `bundle` slug. **(Do not set prices/StoreKit product
      IDs yet — pricing/products are on hold per project decision.)**
- [ ] Repurpose `subscriptions` as the **IAP entitlement ledger**: replace the `stripe_*`
      columns with Apple fields (e.g. `apple_original_transaction_id`,
      `apple_product_id`, `expires_at`, `environment`). A server-side StoreKit/App Store Server
      Notifications handler (built later) writes rows here. **Not in this merge — pricing on hold.**
- [ ] Entitlement model is unchanged by the billing swap: a single `subscriptions` row with
      `product_slug='bundle'` grants both apps; each app gates on "active entitlement for
      {this app's slug} OR `bundle`". This is the payoff of the merge — one row, one source of
      truth, no cross-project sync — now backed by Apple instead of Stripe.

### Phase 6 — App config / endpoint repointing (the frontend cutover)
- [ ] **`github.com-skjjcruz-owner-dashboard-dev/draft-war-room/supabase-config.js`**: change
      `SUPABASE_URL` from `hovnqztlbsgsywrbidbh.supabase.co` → `sxshiqyxhhifvtfqawbq.supabase.co`
      and swap the anon key to Scout's.
- [ ] Sweep the War Room repo for the other 34 `hovnqztlbsgsywrbidbh` refs (`free-agency.html`,
      `landing.html`, `admin.html`, `login.html`, `index.html`, `onboarding.html`,
      `draft-warroom.html`, `trade-calculator.html`, `reset-password.html`,
      `connect-sleeper.html`, `gift.html`) and repoint each.
- [ ] Clean up the 2 stray `sxshiqyxhhifvtfqawbq` refs in the War Room repo and the 1 stray
      `hovnqztlbsgsywrbidbh` ref in the ReconAI repo so neither repo points at both.
- [ ] `shared/app-config.js` (ReconAI repo) already targets Scout and already carries Sentry
      DSNs for **both** `reconai` and `warroom` — confirm War Room's frontend loads this same
      config so both apps share one `supabaseUrl`.
- [ ] Verify CORS / allowed origins on Scout include War Room's web origin
      (`c2-football.github.io` / the warroom Pages origin) and the Capacitor native origins.

### Phase 7 — Cutover, verify, retire
- [ ] Deploy repointed War Room frontend; smoke-test signup, signin, Google/Apple sign-in,
      checkout, AI analyze, and **account deletion** against Scout.
- [ ] Watch Scout `security_events` + Sentry (both DSNs) for auth/RLS errors for 24–48h.
- [ ] Once stable, **pause then delete** the War Room project (`hovnqztlbsgsywrbidbh`). Keep
      its final backup for 90 days.

---

## 3. Risks & rollback

| Risk | Mitigation |
|---|---|
| Data loss during user/billing migration | Phase 0 backups; Phase 4 is additive (insert, don't overwrite Scout rows) |
| `ai-analyze` still secretly depends on `ai_rate_limits` | Drop it **last** (Phase 2), after confirming the function path |
| RLS regressions after DDL | `get_advisors` (security) after every DDL phase; both projects already have RLS on every table |
| Stripe customer/sub mismatch across two old accounts | Reconcile in Stripe dashboard before re-pointing IDs (Phase 4) |
| Frontend left pointing at dead project | Phase 6 grep sweep must hit 0 `hovnqztlbsgsywrbidbh` refs before Phase 7 deletes it |
| Rollback | Until Phase 7 deletion, War Room is untouched and intact — revert the frontend config commit to fall back |

---

## 4. Open decisions

Resolved 2026-06-08 (see "Decisions locked" up top): primary = Scout/us-west-2; identity
collapse done in-merge; Stripe removed in favor of Apple IAP; `fw-delete-account` deployed.

Still open:

1. **The two `owner` roles in War Room** — confirm these are founder/test accounts so we can
   map them to existing Scout owners rather than treating them as new users.
2. **Apple IAP entitlement schema** — deferred until pricing/products come off hold. When that
   happens, finalize the `subscriptions` IAP columns (Phase 5) and the App Store Server
   Notifications handler before any paid build ships.

---

## Appendix — note on the working branch

This investigation found both repos checked out on `claude/supabase-projects-list-ryj4wt`
(where the existing `docs/` planning set lives), not `claude/scalability-1m-users-X3MK6` as
referenced in the session brief. This doc is committed to the branch the repos are actually
on. Rename/rebase if the other name is canonical.

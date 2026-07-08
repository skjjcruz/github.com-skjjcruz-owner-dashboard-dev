# Shared Code Contract

**The `skjjcruz/DHQ-Shared` repo is the canonical owner of all shared
engine logic.** Both War Room (`warroom/`) and ReconAI/Scout (`reconai/`) vendor
these 38 modules into their own build at deploy time — neither app depends on the
other's repo, and there is no runtime CDN dependency between them.

---

## Source of truth

```
skjjcruz/DHQ-Shared   (38 modules + manifest.json)
```

(The C2 sandbox chain mirrors this layout with its own `C2-Football/dhq-shared`.)

Each app copies these in at build time and on local `npm run dev`/`start` via its
own sync script:

- War Room — `scripts/sync-reconai-shared.cjs` (`npm run sync:shared`) →
  `reconai-shared/` (dir name kept for historical reasons; the source is now
  DHQ-Shared, not ReconAI).
- ReconAI — `scripts/sync-shared.cjs` → `shared/` (the vendored modules are
  gitignored; the Scout-only modules in `shared/` stay tracked).

A change is live in each app after that app's own next deploy.

---

## Shared Files (owned by dhq-shared, vendored by both apps)

| File | Purpose | Key exports |
|------|---------|-------------|
| `app-config.js` | Public backend/runtime config — must load before provider/auth modules | `App.CONFIG`, `OD.CONFIG`, backend endpoint URLs |
| `constants.js` | Core constants — must load first | `App.POS_COLORS`, `App.ageCurveWindows`, `App.peakWindows`, `App.decayRates`, `App.BASE_PICK_VALUES`, `App.tradeValueTier`, `App.posMap`, `App.posClass`, `App.NFL_TEAMS` |
| `utils.js` | Utility functions | `App.normPos`, `App.posColor` (delegates to `POS_COLORS`), `App.calcRawPts`, `App.isElitePlayer` (7000+ DHQ or top 5 at position), `App.dhqLog` |
| `pick-value-model.js` | Dynamic dynasty pick valuation (3-phase exponential decay, KTC-calibrated) | `App.LI.dhqPickValueFn` |
| `dhq-core.js` | Standalone DHQ calculation helpers and lab engine | `App.DhqCore.*`, `calculateValues()` |
| `dhq-engine.js` | League Intel engine — scores every player using real league data | `App.LI`, `App.loadLeagueIntel()`, `App.calcOptimalPPG()` |
| `nfl-fit.js` | "Alex NFL Fit" — real-situation scouting signals + narrative (loads after `dhq-engine.js`) | `App.computeNFLFit()`, `App.fetchNFLFitNews()` |
| `dhq-providers.js` | Provider scoring logic | `dynastyValue()`, `getPlayerAction()` |
| `dhq-ai.js` | AI integration (Claude/Gemini) | `App.askAlex()` |
| `ai-dispatch.js` | AI message queue and routing | `App.AI.*` |
| `intelligence-context.js` | App-wide context and recommendation contracts | `App.Intelligence.*` |
| `analytics-engine.js` | League-wide analytics | `App.Analytics.*` |
| `assistant-tutorial.js` | Shared first-launch GM briefing tutorial | `App.AssistantTutorial.*` |
| `team-assess.js` | Roster/team strength assessment | `assessTeamFromGlobal()`, `assessAllTeamsFromGlobal()` |
| `player-modal.js` | Reusable player detail modal | `App.showPlayerModal()` |
| `sleeper-api.js` | Sleeper Fantasy API wrapper | `window.Sleeper.*` |
| `espn-api.js` | ESPN Fantasy API wrapper | `window.ESPN.*` |
| `supabase-client.js` | Auth + Owner DNA cloud sync | `window.OD.*` |
| `storage.js` | localStorage/sessionStorage abstraction | `window.Store.*` |
| `event-bus.js` | Cross-module pub/sub events | `window.Bus.*` |
| `tier.js` | Feature-flag / subscription gate (ReconAI app) | `getTier()`, `canAccess()` |

### Load Order (required)

`app-config.js` → `constants.js` → `utils.js` → `dhq-core.js` and `intelligence-context.js` before `dhq-engine.js` → `nfl-fit.js` (after `dhq-engine.js`) → everything else

`app-config.js` must load before `supabase-client.js`, `espn-api.js`,
`mfl-api.js`, `yahoo-api.js`, and AI/provider modules so all backend
function URLs and public Supabase values come from one source.

`constants.js` must come before `utils.js` because `posColor()` reads
`App.POS_COLORS`, which `constants.js` defines.

---

## Canonical Values (single source of truth in `constants.js`)

### Position colors — `App.POS_COLORS`
```js
{ QB:'#E74C3C', RB:'#2ECC71', WR:'#3498DB', TE:'#F0A500',
  K:'#9B59B6',  DL:'#E67E22', LB:'#1ABC9C', DB:'#E91E63' }
```
`posColor(pos)` in `utils.js` delegates to this object. Do not define
position colors anywhere else.

### Age curves — `App.ageCurveWindows`
```js
{
  QB:{build:[23,27],peak:[28,34],decline:[35,38]},
  RB:{build:[21,22],peak:[23,25],decline:[26,28]},
  WR:{build:[22,24],peak:[25,28],decline:[29,31]},
  TE:{build:[23,25],peak:[26,29],decline:[30,32]},
  DL:{build:[22,24],peak:[25,29],decline:[30,32]},
  LB:{build:[22,23],peak:[24,28],decline:[29,31]},
  DB:{build:[21,23],peak:[24,27],decline:[28,30]},
  K:{build:[23,27],peak:[28,35],decline:[36,40]}
}
```

`App.peakWindows` is derived from the elite peak portion of these curves.

### Decay rates — `App.decayRates`
```js
{ QB:0.12, RB:0.22, WR:0.18, TE:0.16, K:0.08, DL:0.15, EDGE:0.15, LB:0.16, DB:0.18 }
```
Annual value decline rate after the valuable decline band. Higher = steeper cliff.

### Elite assets and player value tiers

`App.isElitePlayer(pid)` is the canonical elite-asset rule:

```
DHQ >= 7000 OR top 5 at position → Elite asset
```

`App.tradeValueTier(val)` remains the pure value-band helper:

```
DHQ >= 7000  → Elite
DHQ >= 4000  → Starter
DHQ >= 2000  → Depth
DHQ >  0     → Stash
```
Use `window.App.tradeValueTier(dhq)` everywhere. Do not hardcode these
thresholds inline.

---

## How War Room Consumes Shared Code

War Room loads shared scripts through `js/shared/shared-loader.js`. The loader
resolves to the vendored `reconai-shared/` copy (synced by `npm run sync:shared`)
in every environment except the `?shared=remote` debug escape hatch, which
points at the legacy CDN. Scripts run in the browser before War Room's own JS.

**Pattern for constants that could fail to load:**

War Room's `js/core.js` sets fallbacks with `||` guards so the app
degrades gracefully if the CDN is unavailable:

```js
// Good — CDN wins if present, fallback if not
window.App.ageCurveWindows = window.App.ageCurveWindows || AGE_CURVE_WINDOWS_DEFAULT;
window.App.peakWindows   = window.App.peakWindows   || PEAK_WINDOWS_DEFAULT;
window.App.decayRates    = window.App.decayRates    || { QB:0.12, ... };
window.App.tradeValueTier = window.App.tradeValueTier || function(val) { ... };
```

**Pattern for functions that might not exist:**

```js
// Good — optional-chain before calling
const color = window.App?.POS_COLORS?.[pos] || '#999';
const tier  = window.App?.tradeValueTier?.(dhq) || { tier: '—', col: 'var(--text3)' };
```

---

## Tier System Note

The two apps use different tier models intentionally:

| | ReconAI (Scout app) | War Room |
|---|---|---|
| Model | 30-day trial → paid | Subscription tiers |
| Tiers | free / trial / paid | free / scout / warroom |
| Gate fn | `canAccess(feature)` in `tier.js` | `canAccess(feature)` in `core.js` |
| Storage key | `STORAGE_KEYS.TRIAL_START` | `od_profile_v1.tier` |

Both read from the same Supabase profile (`od_profile_v1`) for the
authoritative tier string. The mapping is handled in each app's gate
function.

---

## Making Changes

- **Changing a shared constant** — edit `constants.js` in the `dhq-shared` repo only. Verify the fallback value in `warroom/js/core.js` matches, then update it if needed.
- **Changing `posColor()`** — update `POS_COLORS` in `dhq-shared/constants.js`. `posColor()` delegates automatically.
- **Adding a new shared function** — add to the appropriate `dhq-shared` module, then add a fallback in `warroom/js/core.js` with the `|| fallback` pattern.
- **Adding a new constant** — add to `dhq-shared/constants.js` and add a matching fallback in `warroom/js/core.js`.

> Most fallbacks live in `warroom/js/core.js`, but some are co-located with
> their consumer — e.g. `App.decayRates` is guarded in
> `warroom/js/utils/player-value.js`. Grep for the symbol to find its fallback.

## Backend Ownership

Both apps share **one Supabase project, `sxshiqyxhhifvtfqawbq`** (the former
War Room project `hovnqztlbsgsywrbidbh` was merged into it — see
`docs/SUPABASE-MERGE-PLAN.md`). Each repo deploys its own functions to that
single project from its own `.github/workflows/deploy-functions.yml`:

- **ReconAI repo** deploys the provider proxies: `espn-proxy`, `yahoo-proxy`,
  and `mfl-proxy` (ReconAI is the sole owner of `mfl-proxy` — see below).
- **War Room repo** deploys account, billing, admin, and server AI:
  `ai-analyze`, `ai-feedback`, `get-session-token`, `set-password`,
  `fw-signup`, `fw-signin`, `fw-oauth-sync`, `fw-profile`, `fw-delete-account`,
  `fw-create-checkout`, `fw-stripe-webhook`, `fw-request-password-reset`,
  `fw-confirm-password-reset`, `admin-list-users`, `admin-analytics-report`.
- `yahoo-auth` is retired; `yahoo-proxy` is the single Yahoo OAuth/API surface.

Because the two repos now deploy to the **same** project, each function name
must have exactly **one** owning repo — otherwise the two deploy workflows
overwrite each other (last push wins). The only function that ever existed in
both repos was `mfl-proxy`. It is now owned solely by the **ReconAI repo**: an
anon-tolerant, IP-rate-limited CORS relay, because Scout-app users may be
anonymous and the relay only proxies public MyFantasyLeague data. War Room's
old session-gated copy was removed to end the deploy collision; War Room calls
the same shared `mfl-proxy` endpoint.

### DHQ Labs

- `shared/dhq-core.js` is the standalone calculation surface for controlled experiments.
- `App.DhqCore.buildLineupContext()` simulates the configured starting lineup and reports position point share, marginal share, slot share, and lineup importance.
- `tools/dhq-playground.html` can be opened directly in a browser to adjust league size, roster slots, scoring, and mode.
- `npm run dhq:lab -- --data-file tools/dhq-sample-data.json` runs the same core from Node without app state.

After editing any shared module: `git push origin main` in `DHQ-Shared/`. Each
app vendors the change on its next build (`npm run sync:shared`, which runs
automatically on dev/build/deploy).

---

## AI Routing Parity (client ↔ edge)

AI workload tiers are defined per call type in **two** places that must stay in
sync:

- **Client:** `reconai/shared/ai-dispatch.js` → `AI_ROUTES`
- **Edge:** War Room `supabase/functions/ai-analyze/index.ts` → `AI_ROUTES`

Both map a call type (`home-chat`, `trade-scout`, …) to a tier
(`fast` / `standard` / `premium` / `deep`), and the tier resolves to a model
(`fast` → `GEMINI_FAST`, `standard` → `GEMINI_BALANCED`, premium → Claude, …).
When you change a call type's tier, **change it in both files** — otherwise the
client believes it requested one model while the edge actually serves another.

- `home-chat` runs on **standard** (`GEMINI_BALANCED`). It is the flagship
  conversational surface and needs a model that can hold the persona voice.
  (It was previously split — client `standard`, edge `fast` — a drift the eval
  now guards against.)

`reconai/tests/alex-evals.js` enforces this: each fixture case's `expectedTier`
/ `expectedModel` is checked against **both** `ai-dispatch.js` and the War Room
edge function, so a mismatch between the two repos fails the eval.

---

## Platform Connector Gating (War Room)

War Room's loader (`index.html`) and app (`js/app.js`) gate provider connectors
by environment:

- **MFL loads on live.** `mfl-api.js` is spliced into the shared-file list
  unconditionally because the shared `mfl-proxy` is anon-tolerant. MFL league
  visibility is governed by `MFL_SANDBOX_ACCESS` (`MFL_ENABLED ||
  PLATFORM_SANDBOX_ACCESS`), so MFL can be turned on in production.
- **ESPN / Yahoo stay sandbox-only.** Their `*-api.js` files load, and their
  leagues show, only when `WR_PLATFORM_SANDBOX_ACCESS` / `PLATFORM_SANDBOX_ACCESS`
  is true (sandbox host or `?dev`).

War Room's `tests/regression.js` (live-platform-gate group) asserts this split.

---

## Cross-Repo Test Layout

A few tests read files from the *sibling* repo (ReconAI ↔ War Room):

- ReconAI `tests/alex-evals.js` reads War Room's `ai-analyze/index.ts`.
- War Room `tests/bug-capture.js` and `tests/analytics-report.js` read ReconAI's
  `shared/` modules and migrations.

Each resolves the sibling checkout through a **candidate list**, mirroring
`warroom/scripts/sync-reconai-shared.cjs`:

1. an explicit env override (`WARROOM_ROOT` / `RECONAI_ROOT`),
2. the canonical name (`../warroom` / `../reconai`),
3. the default GitHub repo name (`../github.com-skjjcruz-owner-dashboard-dev` /
   `../ReconAI-sandbox-dev`).

So the suites pass whether the repos are checked out under their canonical short
names or their full GitHub repo names. If you add a new cross-repo test, reuse
this resolver instead of hardcoding a sibling path.

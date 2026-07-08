# Repo Sync Analysis — 2026-07-08

Scope: compare the C2-Football idea-lab repos against the skjjcruz production repos,
identify feature gaps, and recommend a safe path to bring production up to date.
No C2-Football repo was modified as part of this analysis.

---

## 1. Ecosystem map (as actually wired today)

Two parallel three-repo chains exist, connected only by manual ports:

**Idea lab (C2-Football)**
- `C2-Football/dhq-shared` — canonical shared engine for the sandboxes (**38 modules**)
- `C2-Football/WarRoom-sandbox` — vendors dhq-shared via `scripts/sync-reconai-shared.cjs`
- `C2-Football/ReconAI-sandbox` — vendors dhq-shared via `scripts/sync-shared.cjs`

**Production (skjjcruz)**
- `skjjcruz/DHQ-Shared` — canonical shared engine for the live apps (**30 modules**, seeded 2026-06-22)
- `skjjcruz/github.com-skjjcruz-owner-dashboard-dev` — the TestFlight app; vendors DHQ-Shared
- `skjjcruz/ReconAI-sandbox-dev` — vendors DHQ-Shared (CI checks out DHQ-Shared before build)

**Standalone**
- `C2-Football/dynasty-hq-landing` — new marketing page; links only to Discord and X,
  no links to the app and nothing links back to it. Not wired to either chain (by design, for now).

The sync scripts on the skjjcruz side correctly point at `skjjcruz/DHQ-Shared`
(env `DHQ_SHARED_SOURCE`, sibling checkout fallback). The architecture is sound;
the problem is purely that content stopped flowing from C2 → skjjcruz after 2026-06-22.

## 2. Divergence status per pair

| C2 repo (source of new features) | skjjcruz repo (production) | Prod last updated | Gap |
|---|---|---|---|
| dhq-shared (2026-07-08) | DHQ-Shared (2026-06-22) | 16 days stale | 8 whole modules missing, ~20 of 30 common modules stale (~1,600 changed lines) |
| ReconAI-sandbox (2026-07-08) | ReconAI-sandbox-dev (2026-06-22) | 16 days stale | ~30 files differ, 8 new JS modules missing (entire Scout feature wave of 6/25–7/08) |
| WarRoom-sandbox (2026-07-08) | owner-dashboard-dev (2026-07-05, but sync reverted) | Effectively at 6/27 state | 110 files differ, 17 files only in C2 |

Good news: the June skjjcruz engine fixes (MFL future-pick ownership, FP_/DP_ pick
direction, `save/loadMflConnection`, early-career stash floor) are already present in
C2's dhq-shared — divergence since 6/22 is essentially **one-directional (C2 → prod)**,
except for prod-only security/legal assets (see §4).

## 3. Features in C2 that production is missing

From C2 commit history 2026-06-22 → 2026-07-08:

**Shared engine (dhq-shared → DHQ-Shared)** — 8 new modules:
`gm-mode.js` (473 ln), `player-value.js` (504 ln), `startsit-engine.js` (295 ln),
`alex-voice.js` (206 ln), `weekly-proj.js` (196 ln), `draft-gameplan.js` (183 ln),
`matchup.js` (128 ln), `nfl-context.js` (112 ln) — plus manifest 30 → 38, and updates to
~20 existing modules including `tier.js` free/Pro gating (`isScoutPro()`), strategy-aware
`getPlayerAction`, MFL lineup-write (login-cookie), free-tier AI guards, and the 6/22 perf
wave (parallel draft-pick fetch, season-stat caching, O(n²) hotspot removal, ~1MB MFL
player-universe cache).

**Major feature tracks (both apps):**
1. **One Alex voice** (7/08) — persona/style picker system retired, unified avatar
2. **Free/Pro monetization gate** (7/02–7/06) — `isScoutPro()`, pro-gate/pro-launch,
   surface gates + teasers, trial-preserving tier resolve — directly relevant to pricing
3. **GM Strategy engine** (7/02–7/06) — strategy-aware verdicts, AI prompt strategy block
4. **Game Day Central** (7/02–7/05) — Lineup tab → game-day hub, MFL lineup push
   (needs the `mfl-proxy` edge function, which owner-dashboard-dev does not have),
   pre-season + bye-week planner, start-sit AI
5. **Dynasty gating** (7/06) — redraft-only features hide in dynasty leagues
6. **Trade Desk redesign** (7/07) — finder-first Desk / Owner DNA / Trade Log
7. **iPhone adaptation + PhoneDock** (7/07) — mobile framework, touch fallbacks,
   landscape, sliding module strip — high value for the TestFlight app
8. **De-busying sweep** (7/07) — trimmed default-rendered AI prose
9. **Player scouting card** (7/05) — Scouting tab in player modal

**Scout-only (ReconAI-sandbox → ReconAI-sandbox-dev):** adaptive Today instrument
panel + analytics cards, Analytics rebuilt as War Room-style terminal (Window Forecast,
Leverage Board, custom report builder), Trade Finder roster-fit ranking, My Team v2,
AI + custom big boards, War Room parity features (Start/Sit unlock, Player Compare,
Tagged Sets), GM Strategy editor port. New modules: `analytics-scout.js`,
`calendar-scout.js`, `compare-scout.js`, `history-scout.js`, `tagged-sets.js`,
`today-cards.js`.

## 4. Production-only assets that must be preserved (do NOT overwrite)

The user-facing statement "prod has additional backend security features and pricing"
is confirmed. These exist only on the skjjcruz side and any sync must protect them:

- `.github/workflows/security.yml`, `.gitleaks.toml`, `.github/dependabot.yml`
- `supabase/functions/_shared/rate-limit.ts`; migrations `021_verify_account_locks.sql`,
  `022_proxy_rate_limits.sql` (ReconAI-sandbox-dev)
- Migrations `20260608*` (mock drafts, drop legacy ai_rate_limits) and
  `20260613*_pin_function_search_path.sql` (owner-dashboard-dev)
- Edge functions `fw-delete-account`, `fw-oauth-sync` (App Store compliance / OAuth)
- `legal/`, `docs/`, `connect-sleeper.html`, `themes.js`, `js/tabs/dashboard-digest.js`
- `vendor/` — self-hosted React/ReactDOM (removed the unpkg single point of failure, 6/27)
- Hardened CI/deploy workflows and CORS allowlists pointing at prod origins
- Draft data files (`player.csv`, `player-enrichment.csv`, `mock_draft_db.csv`)

## 5. The failed 2026-07-05 sync — the key lesson

owner-dashboard-dev PR #139 attempted a staged 3-way-merge port of the C2 work.
It shipped, caused broken lazy tabs and app-wide slowness, was partially rolled back
(#140) and then **fully reverted** (#141) to the pre-sync tree. The revert commit is
explicit about the cause: the sync environment blocked browser networking, so the app
could not be run and profiled, and regressions could not be diagnosed. Conclusion
recorded in the revert: *redo the sync in an environment where each change can be
verified interactively in a real browser.*

Implication: a big-bang or blind file-copy sync is known to fail here. The gap has also
grown since that attempt (the 7/06–7/08 tracks did not exist then).

## 6. Recommended way ahead

**Phase 0 — freeze a baseline (30 min)**
Tag current known-good prod (`owner-dashboard-dev@bba4c29`, `ReconAI-sandbox-dev@6c2b864`,
`DHQ-Shared@b0964f8`) so any regression has a one-command rollback.

**Phase 1 — sync the shared engine first (DHQ-Shared ← dhq-shared)**
This is the lowest-risk, highest-leverage step: DHQ-Shared has no prod-only files, the
divergence is one-directional, and both apps consume it through manifest-driven sync
scripts. Copy the 38 modules + manifest.json + draft-war-room data from C2 dhq-shared
into a DHQ-Shared branch. Both consuming apps' sync scripts already read
`manifest.json`, so the 8 new modules flow automatically once the manifest lists them.
Run both apps' test suites against the branch before merging.

**Phase 2 — ReconAI-sandbox-dev ← ReconAI-sandbox**
Smaller surface than War Room and no prior failed attempt. Port app-side files
(js/, index.html, css, sw.js, tests) while explicitly keeping the dev-only security set
(§4): security.yml, gitleaks, dependabot, rate-limit.ts, migrations 021/022, hardened
workflows and CORS lists. The C2 `mfl-proxy` login+cookie mode must be merged INTO the
dev proxy (which carries rate limiting), not copied over it.

**Phase 3 — owner-dashboard-dev ← WarRoom-sandbox (the careful one)**
Redo the reverted sync, but track-by-track rather than all at once, in an environment
with real browser verification (Claude Code on the web with network enabled, or local):
one PR per feature track in this order — (1) shared-engine consumers/loader,
(2) GM Strategy, (3) Free/Pro gate, (4) Game Day Central + deploy `mfl-proxy` function,
(5) Dynasty gating, (6) Trade Desk, (7) iPhone/PhoneDock + de-busying, (8) One Alex
voice. Verify each PR interactively (lazy-tab load, tab-switch responsiveness — the two
regressions that killed #139) before starting the next. Preserve the §4 prod-only set
throughout.

**Phase 4 — process fix so this doesn't recur**
- Adopt a weekly (or per-feature-track) sync cadence; 16 days of drift is what made
  this hard.
- Consider collapsing the two shared repos into one: make skjjcruz/DHQ-Shared a true
  mirror of C2/dhq-shared updated by a scheduled GitHub Action, or point prod's
  `DHQ_SHARED_SOURCE` at C2/dhq-shared directly (read-only, respects the no-write rule).
  Two "canonical" shared repos is the structural root cause of this drift.
- Add a CI check in both prod apps that fails when the vendored shared manifest hash
  is older than N days behind the source repo.

**dynasty-hq-landing** — no sync needed (standalone, 2 commits, current). When ready to
connect it: add app sign-up/TestFlight CTA links, and decide whether prod deploys should
serve it as the public front page. Note it loads GSAP/Lenis from CDNs; consider
self-hosting those like prod did with React (unpkg lesson, 6/27).

**Effort estimate:** Phase 1 ~1 session; Phase 2 ~1–2 sessions; Phase 3 ~3–5 sessions
(one per track group, each with interactive verification); Phase 4 ~1 session.

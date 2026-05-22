# Deep Audit - War Room and ReconAI - 2026-04-26

Status: local-only audit. No deploy, push, or production data changes.

## Scope

- Projects reviewed: `/Users/jacobc/Projects/warroom` and `/Users/jacobc/Projects/reconai`.
- Areas covered: shared data flow, Supabase/localStorage sync, DHQ valuation logic, War Room UI QA, dashboard widget QA, AI routing/cost posture, analytics instrumentation.
- Deferred by request: implementing the draft/rookie pipeline consolidation. It is still listed as a known data-fragmentation risk.

## Verification Run

- War Room unit smoke: `node tests/run.js` -> 97 passed, 0 failed.
- ReconAI DHQ sanity: `node tests/dhq-sanity-tests.js` -> 48 passed, 0 failed.
- ReconAI build: `npm run build` -> passed, with one large bundle warning at about 795 kB.
- War Room lint: `npx eslint js tests/run.js` -> 0 errors, 204 warnings.
- ReconAI lint: `npx eslint js shared main.js` -> 0 errors, 190 warnings.
- War Room AI training tests: `node ai-training-tests.js` -> 73 passed, 0 failed.
- War Room vs ReconAI AI consistency: `node reconai-consistency-tests.js` -> War Room path passed; ReconAI simulation flagged format/scarcity/quality context gaps.
- UI tab QA screenshots: `/tmp/warroom-league-*-desktop.png`, `/tmp/warroom-league-*-mobile.png`, `/tmp/warroom-league-ui-audit.json`.
- Full dashboard widget QA: 60 widget/size variants rendered. Artifacts: `/tmp/warroom-widget-audit-desktop.png`, `/tmp/warroom-widget-audit-mobile.png`, `/tmp/warroom-widget-audit.json`.

## Executive Summary

The platform is not broken; the core tests pass and the Psycho league preview can render every main War Room tab. But there are several high-impact issues that explain the "things feel off" pattern:

1. Shared code and shared database contracts can drift between War Room and ReconAI.
2. War Room cold deep links are discarded on first load.
3. Mobile league views have real horizontal overflow across tabs.
4. The dashboard widget grid is not responsive enough for all widget sizes on mobile.
5. DHQ still does not account for actual depth chart role, same-team elite competition, long-term FA/retired status, or the requested 75/25 recent-vs-career PPG weighting.
6. Product analytics is not yet first-class; field log is an activity/note log, not a click/time/session analytics system.
7. AI routing is directionally right, but model IDs/cost assumptions are stale and token cost tracking is incomplete.

## Findings

### P1 - Cold deep links and dev preview URLs are stripped

Files:
- `/Users/jacobc/Projects/warroom/js/app.js:328-350`
- `/Users/jacobc/Projects/warroom/js/app.js:577-603`

`parseHash()` and `buildHash()` exist, but the initial popstate effect replaces the current URL with `window.location.pathname` before initial hash/query restoration. In the browser, loading `http://127.0.0.1:3001/?dev=true&user=bigloco#league=1312100327931019264&tab=dashboard` landed on the league hub until I clicked Psycho League manually.

Impact:
- Shared preview links do not open the intended league/tab.
- QA automation cannot reliably cold-load specific tabs.
- The dev/user query can be lost from browser history.

Recommended fix:
- On mount, parse `location.hash` after leagues load and select the matching league/tab.
- Preserve `location.search` in `replaceState`/`pushState` when in dev/sandbox mode.
- Add a Playwright smoke test for direct loading `?dev=true&user=bigloco#league=...&tab=draft`.

### P1 - Field log has incompatible Supabase migration schemas

Files:
- `/Users/jacobc/Projects/reconai/supabase/migrations/004_create_field_log.sql:18-35`
- `/Users/jacobc/Projects/reconai/supabase/migrations/004_field_log.sql:4-35`
- `/Users/jacobc/Projects/reconai/shared/supabase-client.js:622-720`

There are two active `004` field-log migrations with incompatible table shapes. The app client writes `client_id`, `username`, `category`, `action_type`, `players`, `context`, `icon`, `text`, and `source`. The older migration defines `user_id`, `event_type`, `player_id`, `roster_id`, `season`, `week`, and `payload`.

Impact:
- A fresh Supabase environment can end up with the wrong schema or a migration failure.
- War Room and ReconAI can silently fall back to local-only field logs.
- This reintroduces the same "War Room sees it, ReconAI does not" risk the earlier field-log fix was meant to solve.

Recommended fix:
- Keep one canonical field-log migration.
- Add a repair migration that creates missing columns/indexes idempotently.
- Add a boot-time schema health check that reports remote field-log sync disabled for schema mismatch.

### P1 - War Room consumes ReconAI shared code from remote GitHub Pages

Files:
- `/Users/jacobc/Projects/warroom/index.html:904-928`
- `/Users/jacobc/Projects/warroom/free-agency.html`
- `/Users/jacobc/Projects/warroom/trade-calculator.html`
- `/Users/jacobc/Projects/warroom/draft-warroom.html`

War Room loads most shared ReconAI scripts from `https://jcc100218.github.io/ReconAI/shared/...`, and many are pinned to older version query strings. This means local War Room previews do not necessarily use local ReconAI changes. Standalone War Room pages also use unversioned remote shared scripts.

Impact:
- Local fixes in `/reconai/shared` may not appear in War Room until deployed.
- Different pages can run different versions of the shared engine.
- Audits can pass locally in ReconAI but fail in War Room preview.

Recommended fix:
- For local/dev, load shared files from a local ReconAI build or local path.
- For production, publish a single version manifest and have War Room consume that manifest.
- Add a visible shared-engine version fingerprint in both apps.

### P1 - Mobile War Room tabs have horizontal overflow

Files:
- `/Users/jacobc/Projects/warroom/js/league-detail.js:2295-2313`

Across dashboard, my team, trades, free agency, draft, analytics, and Alex at 390px wide, the document scroll width exceeded the viewport. A major contributor is the hidden fixed sidebar plus mobile layout rules. The sidebar is transformed offscreen but still contributes to the page's horizontal scroll behavior in the current structure.

Evidence:
- `/tmp/warroom-league-ui-audit.json`
- Mobile screenshots under `/tmp/warroom-league-*-mobile.png`

Recommended fix:
- Add a mobile layout containment rule for the league shell.
- Set `overflow-x: hidden` at the right shell level.
- Rework the mobile sidebar to avoid contributing to document width.
- Re-run the tab QA at 390px, 430px, 768px, and desktop.

### P1 - Dashboard widget grid overflows on mobile when all sizes are present

Files:
- `/Users/jacobc/Projects/warroom/js/tabs/dashboard.js:1077-1085`
- `/Users/jacobc/Projects/warroom/js/tabs/dashboard.js:807-833`

The dashboard grid uses `repeat(4, minmax(140px, 1fr))`. With padding and gaps, the minimum grid width is greater than a 390px mobile viewport. I forced all 60 registered widget/size variants into the dashboard. Desktop had no overflow; mobile reported `docW/bodyW=661` with horizontal overflow.

Evidence:
- `/tmp/warroom-widget-audit.json`
- `/tmp/warroom-widget-audit-desktop.png`
- `/tmp/warroom-widget-audit-mobile.png`

Recommended fix:
- Add responsive grid templates:
  - mobile: 1 column, all widget sizes span 1 column
  - tablet: 2 columns
  - desktop: 4 columns
- Clamp `xl`/`xxl` spans based on available columns.
- Add an automated widget matrix test that seeds every widget/size and checks overflow/text clipping.

### P2 - DHQ does not consume actual depth chart role

Files:
- `/Users/jacobc/Projects/reconai/shared/dhq-engine.js:629-735`
- `/Users/jacobc/Projects/reconai/js/ui.js:163-173`

ReconAI displays depth chart labels via `S.depthCharts` and Sleeper `depth_chart_order`, but DHQ valuation does not use that information. Situation multiplier is based on roster/team status, production, starter seasons, youth, durability, and position rank, not current NFL role.

Impact:
- QB3/RB3/WR4 profiles are not penalized enough if they have old production or market value.
- QB1/RB1 role changes are not promoted fast enough.
- This maps directly to the user request: "Depth chart needs to matter more."

Recommended fix:
- Add a role component to DHQ metadata and `sitMult`.
- Suggested first pass:
  - QB1: +10% to +18%
  - QB2: -15% to -25%
  - QB3+: -40% to -65%
  - RB/WR/TE role adjustment should be softer and combined with team target/carry competition.
- Add named regression tests for Cam Ward, Aidan O'Connell, Derek Carr, Ty Simpson, Fernando Mendoza, and a few clear QB1/QB3 veterans.

### P2 - DHQ does not account for elite teammate competition

File:
- `/Users/jacobc/Projects/reconai/shared/dhq-engine.js:629-735`

The current `sitMult` does not look at same-team position groups or elite players already on the NFL roster. This matters for RB/WR/TE especially. A young player behind or alongside multiple elite same-team options should not get the same role confidence as a similar player with a clear path.

Recommended fix:
- Build a team-position opportunity map from all scored players.
- Penalize rookies/young players blocked by elite same-position teammates.
- For WR/TE, account for target competition across WR/TE/RB receiving profiles, not only same nominal position.
- Keep this as a role/opportunity adjustment, not a hard ceiling.

### P2 - DHQ production weighting is not the requested 75/25 last-year/career model

File:
- `/Users/jacobc/Projects/reconai/shared/dhq-engine.js:579-588`

Production currently uses rolling year weights `[0.5, 1, 2, 3, 4]`. That leans recent but is not explicitly 75% last season and 25% career. It also does not solve half-season production cleanly: games-played penalties exist, but PPG itself is not sample-size weighted in the way the user described.

Recommended fix:
- Compute:
  - `lastYearPPGAdj = lastYearPPG * reliability(gamesPlayed)`
  - `careerPPGAdj = weighted prior seasons`
  - `productionPPG = 0.75 * lastYearPPGAdj + 0.25 * careerPPGAdj`
- Reliability should be lower for tiny samples, neutral around 10-12 games, and allow strong half-season play to matter more than it does today.
- Add regression tests for half-season breakouts and half-season injuries.

### P2 - Retired and long-term FA handling is incomplete

Files:
- `/Users/jacobc/Projects/reconai/shared/dhq-engine.js:570-573`
- `/Users/jacobc/Projects/reconai/shared/dhq-engine.js:629-656`

The engine skips explicit Sleeper `Inactive`/`Retired`, and applies a no-team/unrostered multiplier. It does not detect "FA for 1+ season" well enough, and there is no named regression coverage for Derek Carr.

Recommended fix:
- Add a status decay model:
  - explicit Retired/Inactive: near zero
  - no team plus no games last season: severe cap
  - no team plus age over position cliff: severe cap
  - no team but recent strong production: soft cap, not zero
- Add a status reason to `LI.playerMeta[pid]` so the UI can explain why the DHQ changed.

### P2 - Rookie/prospect data still has multiple active pipelines

Files:
- `/Users/jacobc/Projects/reconai/shared/rookie-data.js:1-9`
- `/Users/jacobc/Projects/warroom/index.html:928`
- `/Users/jacobc/Projects/warroom/index.html:972`
- `/Users/jacobc/Projects/warroom/draft-war-room/index.html:13`
- `/Users/jacobc/Projects/warroom/draft-war-room/player-detail.html:303`
- `/Users/jacobc/Projects/warroom/js/draft/scouting.js:1-16`

This was intentionally deferred, but the fragmentation is still real. ReconAI declares `shared/rookie-data.js` canonical, while War Room main still loads `js/draft/scouting.js`, and standalone draft-war-room pages load `csv-loader.js`.

Impact:
- War Room and ReconAI can display different rookie boards depending on which module supplied `window.getProspects`.
- Draft grades can look fixed in one surface and wrong in another.

Recommended fix later:
- Make `shared/rookie-data.js` the only provider of `getProspects`.
- Have War Room draft modules consume canonical enriched prospect objects.
- Remove or convert `csv-loader.js` and `js/draft/scouting.js` into thin adapters.

### P2 - Product analytics is not first-class yet

Files:
- `/Users/jacobc/Projects/reconai/supabase/migrations/004_create_field_log.sql`
- `/Users/jacobc/Projects/reconai/shared/tier.js:291-388`
- `/Users/jacobc/Projects/warroom/js/core.js:102-132`

There is a field log for user actions and a trial usage counter, but no general product analytics pipeline for click paths, dwell time, widget interactions, module drop-off, or feature funnels. Searches did not find PostHog, Segment, Amplitude, Mixpanel, GA/gtag, or equivalent event tracking.

Recommended design:
- Add `analytics_events` with:
  - `event_id`, `user_id/username`, `league_id`, `session_id`, `platform`, `module`, `widget`, `event_name`, `event_ts`, `duration_ms`, `entity_type`, `entity_id`, `metadata`.
- Add a tiny client wrapper: `track(eventName, payload)`.
- Batch events locally and flush every 10-20 events or on visibility change.
- Track only product behavior, not private chat text by default.
- Start with these events:
  - `module_viewed`
  - `widget_viewed`
  - `widget_clicked`
  - `player_modal_opened`
  - `trade_started`
  - `waiver_target_saved`
  - `draft_player_expanded`
  - `alex_prompt_sent`
  - `alex_response_used`
  - `session_heartbeat`

### P2 - AI model routing and cost tracking need modernization

Files:
- `/Users/jacobc/Projects/reconai/shared/ai-dispatch.js:31-48`
- `/Users/jacobc/Projects/reconai/supabase/functions/ai-analyze/index.ts:42-63`
- `/Users/jacobc/Projects/reconai/supabase/functions/ai-analyze/index.ts:281-288`
- `/Users/jacobc/Projects/warroom/supabase/functions/ai-analyze/index.ts:804-811`

ReconAI has smart routing in concept: cheap Gemini for simple tasks and Claude for complex tasks. War Room's edge function currently sends all routed analysis through Claude Sonnet. Several model identifiers are stale relative to current official pricing/model pages, and ReconAI token tracking overwrites `tokens_used` for the day instead of accumulating it.

Official pricing checked on 2026-04-26:
- OpenAI pricing: https://platform.openai.com/docs/pricing/
  - `gpt-5-nano`: $0.05 input / $0.40 output per 1M tokens.
  - `gpt-5-mini`: $0.25 input / $2.00 output per 1M tokens.
  - `gpt-5.1`/`gpt-5`: $1.25 input / $10.00 output per 1M tokens.
- Gemini pricing: https://ai.google.dev/pricing
  - `gemini-2.5-flash-lite`: $0.10 input / $0.40 output per 1M tokens.
  - `gemini-2.5-flash-preview`: $0.30 input / $2.50 output per 1M tokens.
- Anthropic pricing: https://platform.claude.com/docs/en/docs/about-claude/pricing
  - Haiku 4.5 is published at $1 input / $5 output per 1M tokens.
  - Sonnet 4.5 is published at $3 input / $15 output per 1M tokens.

Cost example for a 2,000 input token / 500 output token response:
- `gpt-5-nano`: about $0.0003
- `gemini-2.5-flash-lite`: about $0.0004
- `gpt-5-mini`: about $0.0015
- `gemini-2.5-flash-preview`: about $0.00185
- Claude Haiku 4.5: about $0.0045
- Claude Sonnet 4.5: about $0.0135

Recommendation:
- DHQ math, ranks, filters, tags, saved targets, and alerts should not require advanced AI.
- Default Alex summaries and quick Q&A should use `gpt-5-nano`, `gemini-2.5-flash-lite`, or equivalent small model.
- Trade construction, draft strategy, and nuanced opponent psychology should use a mid-tier model like `gpt-5-mini` or Gemini Flash.
- Reserve Sonnet/flagship models for deep reports, long-context league docs, mock drafts, and explicit "deep analysis" actions.
- Add per-call cost telemetry: provider, model, input tokens, output tokens, cached tokens, estimated cost, latency, and feature type.

### P3 - War Room still uses Babel-in-browser for production-shaped preview

File:
- `/Users/jacobc/Projects/warroom/index.html`

The local browser console warns about Babel standalone. It works, but it makes startup slower, complicates source mapping, and hides build-time module errors until runtime.

Recommended fix:
- Move War Room toward a Vite build like ReconAI.
- Keep live-server only as a legacy/dev fallback.

### P3 - Lint warning debt is high

Results:
- War Room: 204 warnings.
- ReconAI: 190 warnings.

Most are unused variables/components and test ignore noise. No lint errors were found. The warning count is high enough that real dead-code or broken hook risks can hide in the noise.

Recommended fix:
- Add a warning budget.
- Clean warnings by module as part of each bug-fix pass.

## Data Flow Status

Shared data that now appears properly connected:

- Field log read/write code path exists in War Room and ReconAI, after the earlier ReconAI read fix.
- Player tags from War Room player cards now call `savePlayerTags(leagueId, fullTagsMap)`.
- ReconAI waiver UI now has a War Room FA-target presentation path.
- Scout AI strategy context now reads the synced GM strategy path.
- Alex Insights now merges shared field-log/history/cache data.

Remaining shared-data risks:

- Field log database schema has conflicting migrations.
- War Room loads shared ReconAI code remotely, so local shared fixes are not guaranteed in local War Room.
- Rookie/prospect data has multiple active providers.
- AI context differs between War Room edge prompts and ReconAI chat paths.

## UI QA Status

Desktop and tablet:
- Main War Room league tabs rendered without horizontal overflow in the tested Psycho League path.
- No fatal runtime errors in the tab QA pass.

Mobile:
- Every main league tab had horizontal overflow.
- Dashboard all-widget matrix had severe horizontal overflow at 390px.
- One dashboard widget text overflow was detected: `CROSSROADS` in a compact card.
- Prior tab QA also found small text overflow in Trades and Alex Insights.

Widget registry tested:
- 60 total widget/size variants across Intel Brief, Roster Pulse, League Landscape, Market Radar, Draft Capital, Field Notes, Competitive Tiers, Power Rankings, Trade Block, Cut Candidates, Waiver Targets, and My Trophies.

## Proposed Execution Order

1. Fix direct deep links and local dev preview routing.
2. Fix mobile league shell/sidebar overflow.
3. Fix dashboard responsive grid and add the widget matrix QA script.
4. Resolve the field-log migration conflict.
5. Add DHQ role/status/production weighting changes with named regression tests.
6. Add analytics event table and client tracker.
7. Modernize AI model routing and token/cost tracking.
8. Consolidate rookie/prospect pipeline later, as requested.

## Immediate Regression Tests To Add

- Cold-load War Room directly to each tab with `?dev=true&user=bigloco#league=...&tab=...`.
- Mobile no-horizontal-overflow test for each main tab at 390px and 430px.
- Dashboard widget matrix no-overflow test for every widget size.
- Field-log schema health test against a local Supabase schema snapshot.
- DHQ named-player tests:
  - Derek Carr: long-term FA/retired-style decay.
  - Aidan O'Connell: backup/QB depth penalty.
  - Cam Ward: young starting QB protection.
  - Fernando Mendoza and Ty Simpson: rookie market rank order remains sensible.
  - Mike Evans/Kenneth Walker/Josh Downs/Kaleb Johnson: rookie/veteran neighborhood sanity by position.


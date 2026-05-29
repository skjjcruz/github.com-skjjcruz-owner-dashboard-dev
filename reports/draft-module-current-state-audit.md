# War Room Draft Module Current-State Audit And Strategic P-List

Audit date: 2026-05-16
Scope: War Room draft module only. Fantasy football only. "Best ball" is a format target; baseball is out of scope.

## Executive Read

The draft module already has a substantial foundation. The highest-value work is not to invent a new draft system; it is to consolidate the built surfaces into one trustworthy War Room draft operating system.

The current module already includes:

- A Draft tab with Flash Brief, Big Board, Mock Draft Center, and Live Draft views.
- A full Draft Command Center with setup, mock/live modes, draft grid, Alex stream, live analytics, opponent intel, trade drawer, CPU trade offers, user-initiated proposals, scenario presets, ghost replay, live Sleeper sync, save/resume, and export.
- A richer standalone Big Board with DHQ board vs My Board, tags, notes, drag re-ranking, rank editing, filters, sortable columns, expanded player cards, external links, and Ask Alex.
- Owner-profile composition that already combines Draft DNA, Trade DNA, team assessment, and owner posture.
- Shared engines for mock drafting, trades, DHQ, pick value, age curves, league intelligence, rookie data, and owner-history analytics.

The strategic gap is trust and cohesion. The module has many strong pieces, but they are split across surfaces, lightly tested, and not yet organized around one draft context contract that feeds board, mock, live, trade, Alex, and recap behavior.

One product requirement should be treated as non-negotiable: the user must be able to run their own front-office board. War Room can recommend, blend, flag, and explain, but it should never reduce draft prep to a black-box ranking list. Custom ranks, tiers, notes, tags, fades, targets, and saved board views are first-class user-owned inputs.

The board model should have three first-class views:

- DHQ Board: the default canonical value board sorted by DHQ and league/scoring context.
- AI Recommended Board: War Room's recommended board for this user, built from DHQ, GM strategy, roster build, draft format, league settings, owner intel, market value, and risk preferences.
- My Board: the user-controlled front-office board. It can start as a copy of the AI Recommended Board, but after creation it is user-owned and manually editable.

## What Exists Today

### Draft Tab

Source: `js/draft-room.js`

Current capabilities:

- Four user-facing views: Flash Brief, Big Board, Mock Draft Center, Live Draft.
- Flash Brief already thinks like a prep surface: next pick, pick path, roster targeting, best targets, board pressure, trade read, and class depth.
- Rookie market calibration fetches FantasyCalc values and maps them into DHQ-scale context.
- Top-level Big Board supports DHQ Board and My Board modes, notes, tags, drafted state, custom order, drag/re-rank, rank editing, filters, sorting, expanded details, inline stats, scouting context, links, and Alex entry points.
- Big Board rows have click-through paths through `WR.openPlayerCard` / `_wrSelectPlayer`.

Important gap:

- The top-level Big Board is more advanced than the Command Center Big Board. Mock/live drafting should not feel like a downgrade from prep.
- Big Board persistence keys use `currentLeague.id || ''` in places where the rest of the app often uses `league_id || id`; this should be normalized before the board becomes a premium saved-view surface.
- FantasyCalc is fetched directly here, while `reconai-shared/intelligence-context.js` already has FantasyCalc request/snapshot/source-evidence helpers. Draft should move into the shared intelligence contract.

### Draft Command Center

Sources: `js/draft/command-center.js`, `js/draft/state.js`, `js/draft/*.js`

Current capabilities:

- Setup supports rookie and startup variants, solo/scenario/ghost/live-sync modes, league size, rounds, snake/linear draft, user slot, user roster, speed, and draft tuning.
- Draft tuning controls exist for Owner DNA, class value, roster fit, trade activity, and pick variance.
- `MyDraftRosterPanel` shows the user's current roster plus drafted players, roster DHQ, draft-added DHQ, position buildout, available-vs-team comparisons, and five-year projection context.
- The draft grid, live analytics, Alex stream, opponent intel, trade modal, trade proposer, and export modules are already wired as first-party command-center panels.
- Local save/load exists in `state.js`; named template save/load and JSON import/export exist in `persistence.js`.
- PNG export exists through `exports.js`.

Important gap:

- `command-center.js` is a large orchestrator and should be stabilized through tests before more feature expansion.
- Recap logic references `state.pickedByIdx`, but the reducer does not maintain that field. That makes league-wide draft total/rank logic suspect.
- Supabase-backed mock draft persistence is only documented in `js/draft/mock_drafts.sql`; the live implementation is localStorage-first and cross-device/share-by-slug is not wired.

### Big Board And User Board

Sources: `js/draft-room.js`, `js/draft/big-board.js`

Current capabilities:

- Standalone board already supports most of the premium user-board basics: custom order, drag/rank edits, notes, tags, drafted markings, filters, expanded rows, player detail links, and saved local state.
- Command Center board supports search, position filters, DHQ/rank/tier/age/fit sorting, draft buttons, and player modal entry.

Important gap:

- There are two board experiences. The premium board state needs to become the source for the Command Center and live draft, not a parallel prep-only feature.
- User board metadata should flow into mock picks, live highlights, Alex recommendations, and recaps.
- User-authored prep should remain editable before and during drafts: manual ranks, tier breaks, private notes, tags, do-not-draft marks, watchlist targets, and board-view preferences should never be overwritten by automated recommendations.
- The current DHQ Board vs My Board model should become a three-board model: DHQ Board, AI Recommended Board, and My Board.

### Mock Draft Simulation

Sources: `reconai-shared/mock-engine.js`, `js/draft/cpu-engine.js`, `js/draft/persona.js`, `js/draft/state.js`

Current capabilities:

- `reconai-shared/mock-engine.js` is the canonical persona-aware CPU picker.
- CPU pick logic already accepts draft tuning for Owner DNA, class value, roster fit, trade activity, and pick variance.
- Persona composition already pulls Draft DNA, Trade DNA, team assessment, and owner posture into simulated owner behavior.
- Predictions are computed through the shared mock engine, not a separate one-off draft bot.

Important gap:

- The owner profile being passed to the simulator is promising but still too thin for the product goal. It should be enriched with full historical league intel from Owner DNA, draft history, trade history, waiver behavior, roster construction, and outcome history.
- Tuning controls need deterministic tests proving that changing sliders changes picks, offers, and acceptance odds in the expected direction.

### Owner DNA And Historical Intel

Sources: `js/draft/persona.js`, `reconai-shared/analytics-engine.js`, `reconai-shared/trade-engine.js`, `trade-calculator.html`, `tests/run.js`

Existing assets to leverage:

- Saved Owner DNA profiles and user overrides.
- `computeWeightedDNA` for recency-weighted trade behavior and confidence.
- `buildOwnerHistory` for full owner history objects.
- `analyzeDraftPatterns`, `analyzeTradePatterns`, `analyzeWaiverPatterns`, and `analyzeRosterConstruction`.
- Trade archetypes, posture, psych taxes, grudge tax, fairness grade, buyer target, and acceptance likelihood.
- Draft DNA from `DraftHistory.loadDraftDNA` / `syncDraftDNA`.
- Current Draft Command Center personas that already compose draft DNA, trade DNA, team assessment, and posture.

Strategic requirement:

- Owner profiles should become league-specific historical intel files, not generic manager stereotypes. Thin-history owners should fall back to format-aware archetypes with confidence labels.

### Draft Trades

Sources: `js/draft/trade-simulator.js`, `js/draft/trade-proposer.js`, `js/draft/trade-modal.js`, `js/draft/trade-helpers.js`, `js/draft/state.js`, `reconai-shared/trade-engine.js`

Current capabilities:

- CPU-initiated draft offers exist.
- User-initiated proposal drawer exists.
- User proposals can include picks, players, and FAAB.
- Evaluation uses pick value, player value, fairness grade, owner psychology, posture, acceptance likelihood, and trade activity tuning.
- Accepted user proposals update pick ownership and track player/FAAB movement through `tradedAssets`.

Important gap:

- This is more built than it may appear from the UI, but it needs end-to-end QA and clearer entry points from every draft context.
- CPU-initiated pick-offer acceptance and user proposal acceptance have different asset movement paths. This is probably acceptable for current CPU pick offers, but the model should be normalized before richer CPU player/FAAB offers.
- Trade rejection reasons should become explainable owner-specific feedback, not only a likelihood number.

### Live Draft, Ghost Replay, And Scenarios

Sources: `js/draft/live-sync.js`, `js/draft/ghost-replay.js`, `js/draft/scenarios.js`, `js/draft/command-center.js`

Current capabilities:

- Live sync polls Sleeper draft picks.
- Ghost replay can load current and previous league-chain drafts and replay historical picks.
- Scenario presets exist for top QB falls, trade up to 1.01, and round-one RB run.
- Live Draft view reuses the Draft Command Center in live-sync mode.

Important gap:

- Live draft should use the same roster panel, Big Board, owner intel, trade, and Alex context as mocks.
- Scenario Studio should grow from three canned presets into saved/tuned simulation environments, but only after the P0 reliability pass.

### Recaps, Analytics, And Export

Sources: `js/draft/live-analytics.js`, `js/draft/alex-stream.js`, `js/draft/exports.js`, `js/draft/command-center.js`

Current capabilities:

- Live analytics tracks draft health, value curve, roster fill, position runs, reach/steal ticker, and grade.
- Alex stream creates draft events and prompts.
- Post-draft recap modal exists with grade, position totals, roster list, local save, and text export.
- PNG export exists.

Important gap:

- Recaps are not yet a world-class strategic artifact. They should explain what happened, what the user built, what each owner revealed, what trade windows opened, and what to do next.
- Recaps should write learnings back into owner profiles and future scenario defaults.

### Test And QA Coverage

Sources: `package.json`, `tests/*.js`

Current coverage:

- Core tests cover PlayerValue, pick value, age curves, weighted DNA, draft capital, and roster summary logic.
- Regression tests cover routing, mobile/layout guardrails, rookie-waiver source contracts, and Draft tab FantasyCalc CSP.
- Rookie-data contract tests ensure draft scouting delegates to canonical rookie data.
- Intelligence-surface contract tests cover shared source-evidence and FantasyCalc intelligence helpers.
- Browser QA hits the Draft tab route.

Important gap:

- There are no targeted reducer tests for Draft Command Center state transitions.
- There are no direct tests for user-initiated draft trades, accepted/rejected proposals, tuning effects, save/resume, ghost replay, live sync unknown-player handling, or the recap bug.
- Browser QA does not yet exercise a real mock draft flow from setup through pick, trade, save, resume, export, and recap.

## Strategic P-List

### P0 - Make The Existing Draft Module Trustworthy

Goal: turn the current built module into a dependable War Room feature before expanding scope.

1. Create one Draft Context contract.
   - Feed board, mock, live, trade, Alex, and recap from one object.
   - Include draft type, league format, scoring, roster rules, player universe, user roster, picks, traded picks, team window, owner intel, DHQ, market, age curve, and projection context.
   - Include board context: DHQ Board order, AI Recommended Board order, My Board order, custom ranks, tier breaks, notes, tags, fades, targets, saved views, board lineage, and whether the mock should follow DHQ, AI Recommended, My Board, or a blended board.
   - Reuse `App.Intelligence.buildLeagueProfile`, FantasyCalc helpers, source evidence, and recommendation contracts.

2. Consolidate owner profiles into enriched Owner Intel.
   - Start from existing Owner DNA and preserve overrides.
   - Merge Draft DNA, Trade DNA, posture, psych taxes, grudge/history, weighted DNA, team assessment, full owner history, waiver behavior, roster construction, and outcome history.
   - Add confidence labels and reason codes.
   - Make mock picks and trade responses cite historical tendencies when available.

3. Unify the Big Board and Command Center board.
   - Promote the richer standalone board state into the draft context.
   - Carry My Board rank, notes, flags, fades, tags, tiers, and drafted state into mocks and live draft.
   - Normalize board storage by `league_id || id` and draft type.
   - Preserve manual user edits as the source of truth; AI suggestions can be accepted, dismissed, or blended, but should not silently rewrite a user's board.
   - Let users initialize My Board from the AI Recommended Board, then track it as a separate editable board.

4. Make user-initiated draft trades reliable end to end.
   - Verify pick-for-pick, player-plus-pick, and FAAB proposals.
   - Normalize accepted trade state so roster panel, analytics, Alex, persistence, and export all reflect the trade.
   - Use the shared trade engine and Owner Intel for acceptance and rejection reasons.

5. Fix known correctness issues.
   - Replace or maintain `state.pickedByIdx` for recap logic.
   - Move draft FantasyCalc access through the shared intelligence helpers.
   - Confirm live sync handles unknown players and players not in the current pool.
   - Confirm localStorage template stripping does not remove data needed for resume/recap.

6. Add targeted tests.
   - Reducer tests: start draft, make pick, user slot, traded pick ownership, accepted/rejected proposals, player/FAAB deltas, save/hydrate.
   - Mock-engine tests: tuning sliders change pick distributions.
   - Trade tests: Trade Activity 0 suppresses trade behavior; Trade Activity 100 increases activity without accepting bad deals.
   - Browser QA: rookie mock, startup mock, draft position change, pick, trade proposal, save/resume, export, recap, mobile.

P0 definition of done:

- A user can run rookie and startup mocks, see their roster build, propose a trade, save/resume, export, and complete the draft without a crash or confusing state mismatch.
- A user can modify their own board, tiers, notes, tags, targets, and fades before and during the draft, and those edits persist into mock/live decisions.
- A user can switch between DHQ Board, AI Recommended Board, and My Board, and can seed My Board from the AI recommendation without losing manual control.
- CPU behavior is visibly influenced by historical owner intel when history exists.
- Every recommendation can point back to league/scoring/owner/player evidence.

### P1 - Premium Big Board And User Board

Goal: make the board a flagship prep product, not just a table.

- Treat the board like a real GM/front-office draft room: user-authored rankings, tier breaks, notes, tags, watchlists, fades, and saved board views sit alongside War Room intelligence.
- Support three board lanes: DHQ value default, AI Recommended, and user-controlled My Board.
- Build saved board views per league, draft type, and format.
- Add tier bands, value badges, position colors, risk tags, projection chips, and rank movement.
- Support compact, scouting, roster-fit, and value-curve views.
- Add import/export for user ranks and notes.
- Add full click-through path validation for every player row, report row, pick row, and trade row.
- Show current DHQ, market/GHQ-equivalent when available, Y1/Y3/Y5 projection, and value-window labels.

P1 definition of done:

- The same user board powers prep, mock, live draft, Alex, and recap.
- Saved ranks/flags/tags are visible wherever draft decisions happen.
- AI can suggest board changes, but the user chooses whether to apply them.
- My Board can be created from the AI Recommended Board, but manual edits create a persistent user-owned fork.

### P2 - Realistic Mock Draft Simulator

Goal: make mocks feel like rehearsing the real league room.

- Expand scenario presets into Scenario Studio.
- Add presets for chalk, chaos, owner-history heavy, class-value heavy, no trades, aggressive trades, rebuild-heavy, contender-heavy, best ball, redraft, startup, and rookie.
- Add Monte Carlo availability odds and range-of-outcome views.
- Add analyst-style projected league mocks that generate a full pick-by-pick mock draft for the user's league without requiring the user to play through it.
- Add owner-specific trade aggression, pick-hoarding, consolidation, panic, and rebuild/contender logic.
- Let users blend owner history, current class crop, roster need, and market value.
- Let projected mocks run from different board assumptions: DHQ Board, AI Recommended Board, My Board, market/ADP, owner-history-heavy, or chaos room.
- Generate readable analyst notes for each pick: owner tendency, roster fit, value gap, tier pressure, trade-up/down logic, and alternate pick considered.

P2 definition of done:

- A user can tune a mock to answer "what if this room drafts like itself?" versus "what if this room drafts the market/class?" and see materially different outcomes.
- A user can generate a league-specific analyst mock as a report, compare versions, and turn one into a playable scenario if they want to rehearse it.

### P3 - Live Draft Command Center

Goal: make War Room excellent while the actual draft is happening.

- Harden Sleeper live sync and manual fallback.
- Show roster build, available values, tier cliffs, trade opportunities, owner-on-clock tendencies, and user-board targets in one command layout.
- Add on-clock decision cards: best value, best fit, safest pick, upside pick, trade-down target, and avoid/fade warning.
- Add draft-room timeline and owner tendency alerts.

P3 definition of done:

- Live Draft is not a thinner mock draft. It is the highest-trust mode of the same system.

### P4 - Strategic Recaps And Learning Loop

Goal: turn every mock/live draft into better future intelligence.

- Generate recap by user team, every opponent, class value, roster construction, trades, reaches/steals, and next moves.
- Update owner profiles with observed mock/live behavior.
- Track which simulated owner assumptions were accurate.
- Save/share recap artifacts.
- Carry recap insights into Scout AI as lightweight follow-up recommendations.

P4 definition of done:

- A completed draft produces useful actions and improves the next mock.

### P5 - Format Expansion For Fantasy Football

Goal: make the module dynamic across football draft formats.

- First-class startup, rookie, redraft, best ball, auction, keeper, IDP, superflex, TE premium, and custom scoring contracts.
- Draft-type-specific board columns, roster goals, value curves, and simulation behavior.
- Auction mode with budgets, nominations, price enforcement, bid tendencies, and roster spend curves.

P5 definition of done:

- The user can choose a football draft format and the board, simulator, trades, roster panel, and recap all adapt without hardcoded one-off UI.

## Build/Reuse Rule

Do not create a second valuation engine, trade engine, owner-DNA engine, rookie-data loader, or intelligence context for draft. The strategic path is:

1. Extend the shared intelligence context.
2. Enrich Owner DNA into Owner Intel.
3. Promote the richest Big Board state into the draft context.
4. Keep `reconai-shared/mock-engine.js` as the canonical simulator.
5. Keep `reconai-shared/trade-engine.js` as the canonical acceptance/psychology model.
6. Add missing tests and browser QA around the existing draft workflows.

## Recommended Immediate Sprint

1. Add draft reducer/trade proposal tests for the existing state engine.
2. Fix the recap `pickedByIdx` issue.
3. Normalize Big Board persistence keys and flow My Board into Command Center.
4. Route draft FantasyCalc/source evidence through `App.Intelligence`.
5. Browser-QA one rookie mock and one startup mock from setup through trade, save/resume, export, and recap.
6. Define the enriched Owner Intel object using existing Owner DNA and analytics outputs.

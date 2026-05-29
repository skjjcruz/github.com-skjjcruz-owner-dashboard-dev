# War Room Draft Module Product Roadmap

Status: working roadmap, War Room first. Scout AI should consume the same draft intelligence contracts after War Room proves the workflows.

## Product Thesis

The draft module should become a paid, premium reason to use Dynasty HQ War Room. The user should be able to prepare for a rookie draft, startup draft, redraft, best ball draft, or auction with one trusted fantasy-football draft operating system:

- A beautiful big board and user board that feel first class, not like a table bolted onto the app.
- Three first-class board lanes: DHQ Board as the default value board, AI Recommended Board tailored to the user's GM strategy, and My Board as the user-controlled editable front-office board.
- A user-owned front-office prep board where custom ranks, tiers, tags, targets, fades, private notes, and saved views remain editable before and during the draft.
- A mock draft room that behaves like the actual league, including owner tendencies and realistic trade behavior.
- Analyst-style projected league mocks that War Room generates pick-by-pick for the user's league, like pre-draft media mocks, without requiring the user to play through the draft.
- A live draft command center that shows the user's roster build, available player value, draft capital, trade leverage, and AI recommendations in one place.
- Post-draft analysis that explains what happened, what each team is building, and what the user should do next.

War Room is the source of truth. Scout AI should package the same truth in a lighter daily/mobile style, but it should not invent separate draft logic.

## Roadmap Principles

1. Trust beats novelty. Every recommendation must be grounded in league format, scoring, roster construction, draft type, owner behavior, and player valuation.
2. Draft mode must be dynamic. Rookie drafts, startups, live league drafts, redraft, best ball, auction, keeper, superflex, TE premium, and IDP formats cannot be hardcoded variants of the same screen.
3. The user must always know their build. In a mock or live draft, the user should see who they picked, how those picks compare to the current roster, and what is still available.
4. Trade realism is a core differentiator. CPU owners need believable motivations, and users need to be able to offer trades during mocks and live planning.
5. The big board is a product surface, not a list. Saved views, tiers, flags, projections, roster overlays, notes, and custom ranks should feel premium.
6. Owner profiles must be historical, league-specific intel files. Draft and trade behavior should be inferred from the league's full available history, not generic fantasy-manager stereotypes.
7. User board control is non-negotiable. AI can suggest, explain, simulate from a board, or offer a blended view, but it should never silently overwrite the user's board, tiers, flags, or notes.
8. The default board hierarchy should be clear: DHQ Board is canonical value, AI Recommended Board is personalized strategy, and My Board is the editable user-owned board. My Board may start from AI Recommended, then diverges as the user edits.
9. Every major draft surface needs browser QA. No roadmap item is done until the click paths work in the real War Room preview.

## Current Baseline

Recently added:

- Mock draft tuning controls for owner DNA, class value, roster fit, trade activity, and pick variance.
- Shared mock engine support for draft tuning, class crop discipline, youth premium, need weighting, and owner-history weighting.
- In-flight `My Roster Build` panel with roster DHQ, draft-added DHQ, position buildout, available-vs-team comparisons, and Y5 projections.
- Trade activity now influences CPU offer frequency and acceptance pressure.

Existing Owner DNA assets to leverage:

- Saved Owner DNA profiles through `OD.loadDNA` / `OD.saveDNA` and the `owner_dna` store.
- Trade Center's Owner DNA archetypes, manual overrides, auto-derived DNA, grudge/history logic, and psychological tax model.
- `computeWeightedDNA` and `buildDNAReasoning`, which already weight trade behavior by recency and output confidence/reasoning.
- Draft DNA from `DraftHistory.loadDraftDNA` / `syncDraftDNA`, including draft tendencies, position preference, seasons, and picks analyzed.
- Draft Command Center personas already compose draft DNA, trade DNA, team assessment, and owner posture into mock-draft behavior.

Additional built systems to leverage:

- Draft Command Center modules: `big-board.js`, `draft-grid.js`, `opponent-intel.js`, `trade-proposer.js`, `trade-modal.js`, `trade-simulator.js`, `live-analytics.js`, `live-sync.js`, `ghost-replay.js`, `scenarios.js`, `persistence.js`, and `exports.js` already form the skeleton for board, room, trade, analytics, save/resume, replay, and export workflows.
- Shared mock engine: `reconai-shared/mock-engine.js` is already the canonical persona-aware CPU picker. Expand it rather than creating a second simulator.
- Player value and pick value: `js/utils/player-value.js`, `reconai-shared/dhq-core.js`, `reconai-shared/dhq-engine.js`, and `reconai-shared/pick-value-model.js` already provide DHQ, age curves, player projections, and pick-value models.
- Trade engine: `reconai-shared/trade-engine.js` already owns posture, psych taxes, grudge tax, fairness grade, and acceptance likelihood. Draft trades should call this instead of maintaining separate acceptance math.
- Intelligence contract: `reconai-shared/intelligence-context.js` already defines league profile, recommendation, source evidence, format badges, and reason labels across player cards and free agency. Draft context should extend this contract.
- League analytics: `reconai-shared/analytics-engine.js` already includes draft, waiver, roster-construction, trade, owner-history, and weighted-DNA analysis. These outputs should feed owner-intel, recaps, and scenario defaults.
- Rookie and scouting data: `reconai-shared/rookie-data.js` plus `js/draft/scouting.js` already delegate rookie/prospect loading to the canonical shared source, with tests covering the contract.
- Platform adapters: `platform-provider.js`, `sleeper-api.js`, `espn-api.js`, `yahoo-api.js`, and `mfl-api.js` already create the path for live/manual and future host-platform draft support.
- Player detail surfaces: `js/components/player-card.js` and `reconai-shared/player-modal.js` already provide click-through player context. Big board rows and draft recap rows should reuse these paths.
- Product analytics and QA: `tests/regression.js`, `tests/rookie-data.js`, `tests/intelligence-surface-contract.js`, browser QA helpers, and AI routing tests already provide a contract suite for keeping draft work grounded and deployable.

Implementation rule: before adding a new draft subsystem, first check whether one of the modules above can be extended. New code should mostly be adapter glue, richer contracts, UI polish, or missing workflows, not duplicate valuation, trade, intelligence, or owner-behavior logic.

Known gaps:

- User-initiated trade offers need to be reliable from any draft context.
- Startup draft support exists, but the board and simulation still need stronger draft-type contracts.
- Redraft and best ball are not yet true first-class modes.
- Big board and user board need saved views, custom ranking, tiering, and visual polish.
- Live draft follow-along needs the same roster-build and tuning intelligence as mock drafts.

## P0 - Trustworthy War Room Draft Core

Goal: Make the draft module reliable enough that a user can run a startup or rookie mock, understand their team build in-flight, tune the simulation, and make realistic trade offers without confusion.

### P0.1 Draft Context Contract

Build a single draft context object used by the big board, mock draft center, live draft, Alex, and future Scout surfaces.

Required fields:

- Draft type: rookie, startup, redraft, auction, live-sync, manual.
- Season and format: football-only, with dynasty, redraft, best ball, keeper, auction, IDP, superflex, and TE premium variants.
- League format: roster slots, scoring settings, IDP, superflex, TE premium, keeper/dynasty/redraft.
- Player universe: rookies only, veterans plus rookies, free-agent pool, imported class, custom board.
- Board context: DHQ Board order, AI Recommended Board order, My Board order, custom ranks, tier breaks, tags, fades, targets, private notes, saved views, import source, board lineage, and whether the active draft should follow DHQ, AI Recommended, My Board, or a blended board.
- Team context: current roster, user picks, traded picks, team window, needs, positional health.
- Owner context: full historical league intel, draft history, trade DNA, waiver/FAAB behavior, roster-building patterns, positional tendencies, risk appetite, panic/need pressure, and results over time.
- Valuation context: DHQ, market value, positional scarcity, age curve, 3-year and 5-year projection.

Acceptance criteria:

- One context builder feeds mock picks, predictions, trade scoring, board overlays, and Alex draft prompts.
- User-authored board data persists through prep, mock, live draft, save/resume, export, and recap.
- Users can create My Board from AI Recommended Board, then edit it independently without later AI refreshes overwriting their manual work.
- The draft context reuses `App.Intelligence.buildLeagueProfile()` and source-evidence patterns instead of inventing a separate league/scoring context.
- The same mock setup can load rookie and startup drafts without conditional UI hacks.
- User slot and user roster stay correct when the user changes draft position.
- Browser QA covers rookie, startup, and live-like manual modes.

### P0.2 User-Initiated Draft Trades

Make trade offers a first-class mock draft action.

Required behavior:

- User can propose trades to any owner while on the clock or between picks.
- Offer builder supports picks, players, FAAB where relevant, and future picks.
- Offer preview shows DHQ in/out, five-year value, roster impact, pick value, fairness grade, buyer target line, and acceptance odds.
- CPU response uses owner DNA, trade history, team posture, need pressure, pick clock pressure, and the trade activity tuning slider.
- Accepted trades update the mock state, pick ownership, roster build panel, board pressure, Alex stream, and export/save state.
- Rejected trades explain why: value gap, roster fit, window mismatch, owner psychology, or low trade appetite.

Acceptance criteria:

- `Trade Activity = 0` prevents CPU-initiated offers and strongly suppresses CPU acceptance.
- `Trade Activity = 100` increases CPU offer frequency and willingness without accepting bad trades blindly.
- User can complete at least one pick-for-pick trade and one player-plus-pick trade in a mock without a reload.
- Regression tests cover accepted and rejected draft trades.

### P0.3 Roster Build In-Flight

Make the user's team build visible at all times.

Required behavior:

- Current roster plus mock picks appear in a dedicated panel.
- Position totals show count, current DHQ, draft-added DHQ, and Y5 projection.
- Available player comparisons show how the best available players compare to the user's current best player or starter threshold at that position.
- On-clock state should answer: "What does this pick do to my whole roster?"
- The panel works in startup, rookie, and live/manual draft modes.

Acceptance criteria:

- Drafting a player immediately updates roster totals and available-vs-team deltas.
- Panel does not overflow or become unreadable on desktop, tablet, or mobile.
- The selected player is visibly marked in Alex stream and roster build.

### P0.4 Simulation Tuning That Actually Changes Outcomes

Make the tuning sliders measurable, not decorative.

Required behavior:

- Owner DNA controls how much historical owner behavior influences picks.
- Class Value controls how strongly the simulator follows the current board/class tiers.
- Roster Fit controls how much teams draft for need versus best player available.
- Trade Activity controls CPU offers and acceptance appetite.
- Pick Variance controls reach/chaos behavior.

Acceptance criteria:

- A deterministic test seed shows different pick distributions when sliders are changed.
- High owner DNA increases historical-position tendency impact.
- High class value reduces extreme reaches.
- High roster fit increases need-based picks.
- High variance increases pick spread without creating obviously irrational drafts.

### P0.5 Draft QA Harness

Create repeatable draft QA for War Room.

Required coverage:

- Cold-load draft tab with `bigloco` and the Psycho league.
- Start rookie mock and startup mock.
- Change draft position and verify user pick ownership.
- Draft a player and verify roster build updates.
- Propose and resolve a trade.
- Save, reload, and resume a mock.
- Export mock results.
- Check desktop, tablet, and mobile snapshots.

Acceptance criteria:

- Build and regression stay green.
- Browser QA has no runtime crash in draft setup, draft command, trade modal, save/export, or live/manual mode.

### P0.6 Historical League Intel Owner Profiles

Leverage and consolidate the existing Owner DNA system into a richer historical owner-intel profile for the draft simulator and trade engine. This is not a rebuild from scratch; it is a unification and enrichment pass over the Owner DNA, Draft DNA, trade-history, roster-history, and league-outcome data War Room already has.

Required behavior:

- Start with the current saved Owner DNA map and preserve user overrides.
- Merge current Draft DNA, Trade DNA, posture, psych taxes, grudge history, weighted DNA reasoning, and team assessment into one owner-intel object.
- Add draft history dimensions: player types drafted, positions, rookie/veteran preference, early-round patterns, reaches, value discipline, tier behavior, and pick-trade behavior.
- Add trade history dimensions: who they trade with, positions/assets they buy and sell, age preferences, pick valuation, fairness tolerance, panic trades, consolidation trades, rebuild/contend behavior, and timing patterns.
- Add roster history dimensions: long-term team-building style, churn rate, positional hoarding, depth preferences, age curve, contender/rebuilder pivots, and attachment to drafted players.
- Add waiver and FAAB dimensions: aggressiveness, streaming behavior, prospect patience, bid discipline, and whether they chase short-term production or long-term value.
- Add outcome feedback: standings, playoff results, title windows, failed builds, and whether historical behavior actually worked.
- Generate confidence levels per owner and per behavior area so thin-history owners are not over-modeled.
- Store explainable reason codes that mock draft, trade, Alex, and recap surfaces can display.

Acceptance criteria:

- Existing Owner DNA labels and overrides continue to work in Trade Center.
- Draft Command Center personas consume the enriched owner-intel profile while preserving the existing draft DNA and trade DNA fields.
- Enriched profiles reuse `computeWeightedDNA`, `buildOwnerHistory`, `analyzeDraftPatterns`, `analyzeTradePatterns`, `analyzeWaiverPatterns`, and `analyzeRosterConstruction` where available.
- Mock picks and CPU trade responses always receive a historical owner profile when league history exists.
- Owner profiles distinguish "historically proven tendency" from "inferred from limited data."
- CPU owners can explain their simulated pick or trade using specific historical tendencies.
- Recaps update the owner profile after every completed draft or mock replay.
- The simulator gracefully falls back to format-aware archetypes only when historical league data is unavailable or too thin.

## P1 - Premium Big Board And User Board

Goal: Turn the big board into a flagship prep surface.

### P1.1 Big Board Visual System

Required behavior:

- Premium board layout with tier bands, rank movement, value badges, position color, risk tags, and projection chips.
- Toggle between compact, scouting, roster-fit, and value-curve views.
- Filters for position, tier, age, NFL team, college/team, rookie/veteran, upside, floor, value gap, and availability.
- Board rows click through to player detail/context.

Acceptance criteria:

- Board looks intentional at desktop and mobile sizes.
- No board row is dead-click unless explicitly disabled.
- User can scan tiers and value gaps without opening a modal.

### P1.2 User Big Board

Required behavior:

- Board selector supports DHQ Board, AI Recommended Board, and My Board.
- DHQ Board is the default canonical value board.
- AI Recommended Board is generated from the user's GM strategy, roster build, league format, draft type, DHQ, market value, risk profile, and owner intel.
- My Board starts from AI Recommended Board by default unless the user chooses DHQ/import/manual start.
- User can drag/re-rank players.
- User can create tiers, flags, fades, targets, do-not-draft marks, and notes.
- Notes support real front-office prep: private scouting thoughts, medical/risk flags, scheme/role notes, owner-specific draft-room reads, interview/combine notes, and watchlist reminders.
- User can save named board views per league and draft type.
- User board can override or blend with DHQ/market ranks.
- User can lock manual ranks/tiers so AI recommendations appear as suggestions instead of changing the board.
- User can import/export board CSV.

Acceptance criteria:

- Saved user board persists per league and draft type.
- Mock draft uses the saved board when configured.
- Live draft highlights user targets, fades, and tier breaks.
- AI-generated board suggestions require explicit user approval before changing ranks, tiers, tags, or notes.
- AI refreshes update the AI Recommended Board, not the user's manually edited My Board, unless the user explicitly applies those changes.

### P1.3 Projection And Value Curves

Required behavior:

- Show current DHQ, GHQ/market equivalent when available, and Y1/Y3/Y5 projection.
- Visualize player value curve by position and age.
- Highlight players whose five-year projection beats current market value.
- Distinguish peak years from value years.

Acceptance criteria:

- Projection logic is centralized and reusable by player cards, big board, mock draft, and recap.
- Projection columns are explainable with tooltips or compact labels.

## P2 - World-Class Mock Draft Simulator

Goal: Make mocks feel like rehearsing the real room, not running a generic draft bot.

### P2.1 Scenario Studio

Required behavior:

- Create scenarios from templates: chalk board, chaos room, owner-history heavy, class-value heavy, no trades, aggressive trades, rebuild-heavy, contender-heavy.
- Let user save and compare scenarios.
- Monte Carlo mode shows availability odds, range of outcomes, and top pivot points.
- Ghost replay can simulate a previous league draft with updated player values.

Acceptance criteria:

- User can run multiple scenarios and compare best picks, roster result, and trade opportunities.
- Availability odds update when tuning changes.

### P2.2 Analyst-Style Projected League Mocks

Required behavior:

- Generate full league mock drafts automatically without the user making each pick.
- Support one-round, three-round, full rookie, full startup, redraft, best ball, keeper, and auction-preview projections where format support exists.
- Let the user choose the projection basis: DHQ Board, AI Recommended Board, My Board, market/ADP, owner-history-heavy, class-value-heavy, need-heavy, no-trade, or trade-aggressive.
- Use league draft order, rosters, traded picks, scoring, roster settings, Owner Intel, GM strategy, board state, and trade tendencies.
- Include pick-by-pick analyst notes: why this owner would make the pick, roster fit, value gap, tier pressure, owner history, likely alternatives, and trade logic.
- Generate multiple versions: chalk, league-history, user-board, chaos, trade-heavy, and best available.
- Let the user compare versions by player availability, user targets, roster outcomes, trade opportunities, reaches/steals, and team grades.
- Let a projected mock become a playable scenario if the user wants to rehearse from that board.

Acceptance criteria:

- A user can click once and get a credible league-specific mock draft report.
- Every projected pick can cite at least one driver: value, need, owner tendency, board/tier pressure, strategy fit, or trade logic.
- The projection clearly labels assumptions and confidence so it reads like analysis, not fake certainty.
- Generated mocks can be saved, exported, compared, and reused in the live draft command center.

### P2.3 Owner Behavior Model

Required behavior:

- Each owner profile starts from the P0 historical league-intel file, then layers in draft DNA, trade DNA, risk appetite, historical position bias, value discipline, need sensitivity, and pick aggression.
- Model supports blend controls: full league history vs current class, need vs BPA, market vs DHQ, trade-heavy vs quiet room.
- Owner model uses evidence-weighted history, so repeated multi-year behavior matters more than one odd draft or one panic trade.
- Owner model improves after every completed draft, mock replay, live draft, and recap.
- Model can surface owner-specific tells: favorite roster builds, preferred trade partners, positions they overpay for, players they refuse to sell, and moments when they historically get aggressive.

Acceptance criteria:

- Owner predictions include confidence and reason codes.
- Owner predictions can cite the historical behavior class behind the recommendation.
- The simulator can explain why a CPU owner reached, passed, traded up, or traded down.

### P2.4 Realistic CPU Trades

Required behavior:

- CPU teams can trade up, trade down, package picks, and pursue need-based moves.
- CPU trade offers must respect team windows and owner preferences.
- Trade market should include negotiation: counteroffer, close gap, decline reason.

Acceptance criteria:

- Trade behavior changes materially between no-trade, balanced, and aggressive-trade rooms.
- CPU offers are not spammy and not obviously one-sided.

## P3 - Live Draft Command Center

Goal: Make War Room the screen a user keeps open during a real draft.

### P3.1 Live Sync And Manual Draft Modes

Required behavior:

- Follow live Sleeper drafts.
- Manual draft mode for fantasy-football leagues or host platforms without direct integration.
- Later adapters for ESPN/Yahoo/imported draft boards if legally and technically viable.
- Handle pauses, traded picks, missed picks, clock changes, and out-of-order updates.

Acceptance criteria:

- Live state updates without losing user board, targets, or roster build.
- Manual corrections are easy and reversible.

### P3.2 On-Clock Decision Engine

Required behavior:

- Show recommended pick, safe pick, upside pick, trade-down option, and "avoid" warning.
- Explain recommendation using league format, roster need, board value, projection, and owner run pressure.
- Alert when a tier is about to collapse.
- Alert when a target is unlikely to survive to the user's next pick.

Acceptance criteria:

- User can understand the next action in under 10 seconds.
- Recommendations change when roster build or board pressure changes.

### P3.3 Live Trade Desk

Required behavior:

- Identify owners likely to trade up/down.
- Suggest offers based on board tiers and roster needs.
- Track pending offers and accepted/rejected offers.
- Show immediate impact of a live trade on user picks, roster build, and available targets.

Acceptance criteria:

- User can build and evaluate a live draft trade without leaving the draft room.

## P4 - Draft Recaps And Post-Draft Intelligence

Goal: Convert draft activity into durable strategy and next actions.

### P4.1 User Recap

Required behavior:

- Grade draft by value captured, roster fit, age curve, positional health, and future flexibility.
- Show best pick, worst reach, missed target, best alternative, and trade impact.
- Generate a post-draft action plan: trade block, waiver targets, roster cuts, taxi/practice squad decisions where relevant.

Acceptance criteria:

- Recap produces concrete next actions, not generic praise.

### P4.2 League Recap

Required behavior:

- Grade every team.
- Identify winners, risky builds, rebuilders, contenders, value drafters, and panic drafters.
- Update owner DNA from the completed draft.
- Create league-wide trade opportunities based on post-draft imbalances.

Acceptance criteria:

- Recap changes future mock owner models.
- Every team card links to roster, draft picks, and trade ideas.

## P5 - Fantasy Football Format Platform

Goal: Expand from dynasty football draft strength into redraft, best ball, keeper, auction, and specialized scoring formats without rewriting the module.

### P5.1 Draft-Type Adapter Layer

Required behavior:

- Dynasty rookie adapter.
- Dynasty startup adapter.
- Redraft adapter.
- Best ball adapter.
- Keeper adapter.
- Auction adapter.
- IDP adapter.
- Superflex and TE premium format modifiers.

Each adapter defines:

- Player universe.
- Position taxonomy.
- Roster slots.
- Scoring settings and lineup rules.
- Projection horizon.
- Draft capital model.
- Replacement level.
- Scarcity multipliers.
- Best ball roster-construction rules, including stack exposure, spike-week archetypes, and roster pocket targets.

Acceptance criteria:

- New draft types do not require duplicating the command center.
- Big board, mock, live, and recap all read the same adapter contract.

### P5.2 Best Ball Draft Readiness

Required behavior:

- Best ball roster construction by build type.
- Stack detection and exposure tracking.
- Spike-week, floor, ceiling, and injury-fragility tags.
- ADP/market import support.
- Lineup-free roster pressure, including QB/TE timing and late-round correlation.
- Draft room alerts for overexposure, fragile builds, and missed stack partners.

Acceptance criteria:

- Best ball draft setup can render a board and run a mock with correct football positions, roster build pressure, ADP context, and correlation alerts.

## P6 - AI GM Strategy Studio

Goal: Let users fine-tune how Alex and the simulator think before and during drafts.

Required behavior:

- Strategy presets: BPA, win-now, youth rebuild, balanced, upside swing, risk-off, trade-down, scarcity attack.
- Editable sliders for model behavior.
- Explainable AI prompt context: league format, scoring, roster state, owner models, board state, and user preferences.
- Cost-aware routing: cheap model for quick board notes, premium model for strategy reports and high-stakes live decisions.
- Memory of user preferences per league.

Acceptance criteria:

- User can choose a draft strategy and see it reflected in recommendations, mock picks, and Alex responses.
- Alex never gives advice without league/scoring/roster context.

## P7 - Scout AI Carryover

Goal: Let Scout package War Room draft truth in a lighter experience.

Required behavior:

- Scout can show draft prep status, target watchlist, tier alerts, and live draft reminders.
- Scout uses War Room's board, roster build, owner DNA, and draft context.
- Scout recommendations point back to War Room for heavy workflows.
- Scout can summarize post-draft action items.

Acceptance criteria:

- Scout and War Room never disagree because they used different draft logic.
- Scout draft cards deep-link into the right War Room board, player, trade, or recap view.

## P8 - Monetization, Analytics, And Reliability

Goal: Make the draft module measurable, durable, and packageable.

Required behavior:

- Track mock drafts started, completed, saved, exported, resumed, analyst mocks generated, and analyst mocks converted into playable scenarios.
- Track board customization, trade offers, accepted trades, live draft sessions, and recap generation.
- Tier premium features: advanced mocks, Monte Carlo, AI strategy reports, live draft desk, exports, best ball, auction, and specialized fantasy-football formats.
- Add import/export and backup workflows.
- Add clear empty states and setup guidance without turning the screen into marketing copy.

Acceptance criteria:

- Product analytics can answer which draft features drive retention or paid conversion.
- Premium gates are clear and do not block core trust-building workflows.

## Recommended Delivery Order

1. Finish P0 user-initiated trades and draft QA harness.
2. Polish the P0 roster build panel and tuning controls after browser QA on desktop/tablet/mobile.
3. Build P1 three-board persistence: DHQ Board, AI Recommended Board, My Board, saved views, tiers, flags, notes, targets, fades, board lineage, and rank-lock behavior.
4. Add P1 projection/value-curve columns across board and roster build.
5. Build P2 scenario studio, analyst-style projected mocks, and Monte Carlo availability.
6. Build P3 live draft command center using the same P0/P1/P2 contracts.
7. Ship P4 recaps and owner-DNA feedback loop.
8. Generalize adapters for P5 redraft, best ball, keeper, auction, and specialized fantasy-football formats.
9. Add P6 strategy studio and P7 Scout carryover.
10. Package P8 monetization and analytics once the core loop is trusted.

## Immediate Next Sprint

If the next sprint is limited to the highest-leverage draft work, do this:

1. Inventory the existing Owner DNA, Draft DNA, weighted DNA, posture, grudge, psychological-tax, analytics-engine, intelligence-context, valuation, and draft-command modules, then define the enriched draft context and owner-intel objects without breaking current Trade Center behavior.
2. Make user-initiated mock draft trades fully usable.
3. Add deterministic tests for draft tuning outcomes and owner-intel influence.
4. Add browser QA for startup, rookie, user-slot changes, draft pick, trade proposal, save/resume, and export.
5. Turn the current roster build panel into a polished, responsive component.
6. Start three-board persistence: DHQ Board, AI Recommended Board, My Board, saved ranks, tiers, flags, notes, targets, fades, board lineage, and explicit AI-suggestion approval.

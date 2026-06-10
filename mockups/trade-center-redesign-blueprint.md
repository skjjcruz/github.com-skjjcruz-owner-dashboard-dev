# Trade Center Redesign Blueprint — "Adaptive War Room"

Engineering companion to the interactive mockup at [`trade-center-adaptive.html`](./trade-center-adaptive.html)
(open it at `http://localhost:3000/mockups/trade-center-adaptive.html`).

> **Status: direction locked (2026-06-07).** The tab-free *Adaptive War Room* with a **guided calm entry** is the chosen design.

**Goal:** collapse the three Trade Center tabs (Deal HQ · Owner Profiles · Trade Analyzer) into **one tab-free canvas** that **opens calm**: a guided *'best move'* hero — one recommended trade + one CTA — is the default landing, and the full workspace (a left Market Rail, a center Stage with a persistent live builder, and a right **morphing** Context Rail: Dossier ⇄ DNA ⇄ Verdict) expands from it on one click, **without changing any valuation/acceptance math.** All file refs are in `warroom/js/trade-calc.js` unless noted; verified 2026-06-07.

> The mockup carries **REUSE / NEW / PARTIAL** badges on each region (toggle them with the button in the banner). This doc is the same map in prose, plus the migration sequence.

---

## 1. What stays exactly as-is (the quality core — DO NOT TOUCH)

Canonical engine in `warroom/reconai-shared/trade-engine.js` (`window.App.TradeEngine`): `calcComplementarity`, `calcOwnerPosture`, `calcPsychTaxes` (8-factor array), `calcAcceptanceLikelihood` (linear `50 + 200·(diff+taxAdjust)/maxSide`, clamp 5–95), `fairnessGrade`, `calcGrudgeTax`. Plus in `trade-calc.js`: `buildDeal()` (:1124), `sideBreakdown()` (:1081), `generateDealsForPartner()` (:1285), `scoreDealRecommendation()` (:1052), `getDealHqTuning()` (floor default 75, 55–90, :1014), `assessTeamLocal()` (:213 — **where league scoring enters the math**), `getPlayerValue`/`getPickValue`, `FAAB_RATE=2.0` (:21), `computeWeightedDNA()` (:366), `deriveDNAFromHistory()` (:354), `window.OD.saveDNA/loadDNA`.

⚠️ **Three synced engine copies** must move together if math ever changes: canonical, `trade-calc.js:331-334`, `js/draft/trade-helpers.js:80-214`.

---

## 2. Region → existing component → engine fn (the build map)

| Mockup region | Reuse in code | Fed by |
|---|---|---|
| **Guided 'best move' hero** (default landing) | NEW chrome; Alex-voiced copy via `js/shared/alex-voice.js` | top-ranked `partnerBoard[0]` + its best `generateDealsForPartner` → `buildDeal` package |
| Module strip (no tabs) + ⚙ floor | `wr-module-strip` (~:3390), **drop the `wr-module-nav` tab bar (:3398-3401)** | `getDealHqTuning`/`dealActionableAcceptanceFloor` (:1014) |
| Metrics strip (4 cards) | `tc-dhq-metrics` (:2597) | `partnerBoard` scoring, `leverageCounts`, `savedDeals` |
| Market Rail · Partners | `tc-dhq-partner` rows + `tc-chip*`/`tc-posture-badge` + `positionChipsForAssessment` (:2625) | `calcComplementarity`, `calcOwnerPosture`, `pickAssetsForOwner` |
| Market Rail · Assets | `tc-dhq-asset-table` (:2660) repackaged as a vertical list; **Seed Switch = NEW chrome** | `assetsForRoster`, `getPlayerValue`/`getPickValue`, `assessTeamLocal`, `selectAssetFocus → setDealFocusPid` |
| Stage · mode bar + packages | `tc-dhq-modebar` + `dealCard` (:2527) | `generateDealsForPartner → buildDeal → scoreDealRecommendation`; `fairnessGrade`, `calcAcceptanceLikelihood` |
| `[Edit this deal ▸]` | relabel `tc-dhq-actions` button | `loadDealIntoBuilder()` = `loadDealIntoAnalyzer` (:1467) **minus `setTcTab('analyzer')` (:1480)** |
| Persistent builder | `TradeSide`/`tc-ta` rows + `tc-dhq-grid` (:2881) | `buildDeal()` + `sideBreakdown()`; `FAAB_RATE` |
| Rail · Dossier | `tc-dhq-dossier*` (:2710) | posture/complementarity, `ownerProfiles`, H2H `tradeHistory` (:2452) |
| Rail · DNA editor | `tc-dna-select` + AI-suggestion block (:1916) | `computeWeightedDNA`/`deriveDNAFromHistory`/`updateDna → setOwnerDna → OD.saveDNA` (:774) |
| Rail · Verdict | `tc-ta-verdict`+`tc-ta-impact-grid`+`tc-tax-table`+`tc-likelihood-bar` (:3074-3152) | `buildDeal` totals, `calcPsychTaxes`/`calcGrudgeTax`/`calcAcceptanceLikelihood`/`fairnessGrade` |
| Acceptance gauge | NEW — circular gauge (Market Desk style from `mocks/deal-hq-command-center.html`) | `calcAcceptanceLikelihood` |
| Scouting drawer | `renderOwnerDetailCard` whole (:1780) + `tc-scout-panel` sub-rail | `assessTeamLocal`, DNA derivation, `tradeHistory` verdicts |
| Locked layers | `UpgradeGate` (:3414) as **region-scoped** overlay (one CTA each) | `canAccess('trade-finder')` / `canAccess('owner-dna')` |

**NEW chrome to build:** the **guided 'best move' hero** landing + the calm→workspace transition (with a *‹ Summary* return), the **quiet-board** treatment (only the selected partner shows full chips/why; others dim to name+score+tag), the Seed Switch (Partners/Assets), the Context Rail state machine (badge + 📌 pin + morph), the circular acceptance gauge, the bottom-sheet (iPad/phone), and the region-scoped frosted lock layers.

**Entry pattern (calm first look).** The module opens on the hero, not the board. *Review & tweak* loads the hero's deal into the builder in place (verdict live); *Browse all partners* opens the board; *Build your own* opens a blank builder. All three call one `enterWorkspace()` that reveals the same canvas — depth is deferred behind a click, never removed. The quiet-board rule keeps the expanded workspace calm too.

---

## 3. The two load-bearing code changes (highest risk)

### 3a. One evaluator
Route the manual builder through `buildDeal()` and **delete the Analyzer's parallel inline recompute (`:2796-2845`)**, including the `manualBehaviorFit` acceptance-delta path (`:2845`). Drive the builder + the focused generated card from a **single `{partner, input}` reducer** so they can never diverge (pre-empts the `fairMargin(0.04)` vs `fairnessGrade` verdict-text mismatch).

**Mandatory regression before cutover:** snapshot a known manual trade's verdict text + acceptance % + grade on the current Analyzer, then assert the new `buildDeal()` path produces the same. Pass bar to confirm with the owner: exact, or tolerance ±1 grade-step / ±2% acceptance.

### 3b. Tabs → seed state (hard cutover gate)
There are no tabs to route to. Convert **every `setTcTab` caller** to seed-state and delete the tab bar. Verified callers:
`:472, :474, :476, :488, :616, :1480, :3205, :3304, :3399`.
Also replace the `window._wrAnalyzerMode` global + the `setGrudges(g=>[...g])` re-render hack (`:3011-3018`) with real React state. Seeds already exist and keep all six entry points working on one surface: `dealFocusPid`, `finderAutoTarget`, `tradeContext`, `selectedDealPartnerId`. Re-grep `setTcTab(` before shipping to confirm none is missed.

> Note: `:3205` also references an `inbox`/`dna` retry path — fold the Trade Inbox into the single surface or a drawer; don't leave it routing to a dead tab.

---

## 4. Draft-room parity (must not break)
Keep the `window.App.TradeEngine` contract and the linear acceptance curve stable. **Do not "clean up" the proposal shape** — preserve the `*Future` pick fields (`js/draft/trade-simulator.js:651`) and `offerShape` (:1148) that `DraftTradeFinder` reads. Bonus: extracting the unified finder into a shared component lets `DraftTradeFinder` (`js/draft/trade-proposer.js:97`) consume it and *improves* parity instead of being a 3rd reimplementation.

---

## 5. Suggested migration sequence
1. **Extract components** (no behavior change): pull `dealCard`, `TradeSide`, the verdict/tax/impact block, the DNA selector, and `renderOwnerDetailCard` into standalone components still rendered inside the current tabs. Ship, verify nothing changed.
2. **One evaluator** (§3a) behind a flag; run the regression.
3. **Build the single canvas** (new layout) consuming the extracted components; keep the old tabs reachable behind a flag.
4. **Seed-state cutover** (§3b): convert `setTcTab` callers, delete the tab bar + `_wrAnalyzerMode`.
5. **Morphing rail + scouting drawer + lock layers + responsive** (the NEW chrome).
6. **Retire** the old tab render paths and `command`-mode duplication once the canvas is at parity.

## 6. Open decisions (from the plan — settle during build)
Morph-on-new-partner-while-pinned behavior · asset-first discoverability nudge · iPad/phone Dossier/DNA peek-line copy · cold-open default mode/partner · saved-queue single home · tax-table default expand preference.

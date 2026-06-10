# War Room AI Training Program — Contextual Valuation Intelligence

## Purpose

This document codifies the contextual valuation rules that govern the War Room AI's recommendations across all analysis types. The AI must understand that **the same player has different value depending on the team's competitive mode, the league's format, and positional scarcity**. A 28-year-old WR2 is a useful asset to a contender but a liability to a rebuilder. A mid-tier QB is a $1 waiver claim in 1QB but a must-have in superflex. These rules ensure the AI never gives generic, one-size-fits-all advice again.

---

## 1. Changes Made (Code Reference)

### A. `supabase/functions/ai-analyze/index.ts` — Edge Function Enhancements

**New Functions Added:**
- `detectLeagueFormat(ctx)` — Parses roster_positions and scoring_settings to detect superflex, TE premium, IDP, scoring type, and slot counts
- `buildLeagueFormatBlock(fmt)` — Generates a formatted context block explaining league format implications (scarcity multipliers, positional premium rules)
- `buildTeamModeBlock(ctx)` — Generates team-mode-specific instruction blocks (REBUILD / CONTEND / CROSSROADS) that tell the AI exactly how to weight age, youth, picks, and FAAB
- `buildQualityThresholdBlock()` — Hard rules preventing the AI from recommending replacement-level players (DHQ < 500, PPG < 5.0)

**Modified Functions:**
- `buildSystemPrompt(ctx)` — Now accepts context and injects league format, team mode, and quality thresholds into the system prompt. Adds 5 critical rules the AI must follow.
- `buildFATargetsPrompt(ctx)` — Now includes team status, league format context, QB crisis detection for superflex, and strict FAAB recommendation rules. Tells the AI to say "HOLD YOUR FAAB" if no quality targets exist.
- `buildTeamPrompt(ctx)` — Now includes league format context, team mode block, superflex QB audit, and mode-aligned trade recommendations.
- `buildLeaguePrompt(ctx)` — Now includes league format detection and superflex-specific landscape notes.
- `buildRookiesPrompt(ctx)` — Now includes league format and team mode context.
- `buildFAChatPrompt(ctx)` — Now includes league format, team mode, and quality reminders.
- Main handler: `buildSystemPrompt()` now receives `context` from the request body.

### B. `js/free-agency.js` — Client-Side FAAB Logic

**New Logic:**
- League format detection: `isSuperFlex`, `isTEP`, `teamTier`, `teamWindow`, `isRebuilding`, `isContending`
- `getScarcityMultiplier(pos)` — Returns positional scarcity multipliers: QB 1.8x in superflex, TE 1.5x in TEP, RB 1.3x with 2+ RB slots
- `faabSuggest()` now accepts `playerAge` parameter and applies:
  - Quality gate: Returns null for DHQ < 500
  - Team mode gate: Returns null for rebuilding teams targeting old low-value players (age > 25, DHQ < 2000)
  - Scarcity multiplier on base valuation
  - Mode multiplier: 0.6x for rebuilders (save FAAB), 1.2x for contenders (bid aggressively)
- `recommendations` filter now enforces:
  - DHQ >= 500 quality floor
  - PPG >= 5.0 with 6+ games played
  - Rebuilding teams skip age > 25 with DHQ < 2000
- Value plays filter raised from DHQ >= 400 to DHQ >= 500, plus mode-based null filtering

### C. Client-Side Context Builders (HTML files)

**`free-agency.html` `buildFAContext()`** — Now passes:
- `scoringSettings` / `scoring_settings` — league scoring weights
- `teamTier` / `tier` — from assessTeamFromGlobal
- `teamWindow` / `tradeWindow` — CONTENDING / REBUILDING / TRANSITIONING
- `healthScore` — team health 0-100
- Player `age` and `dhq` values in roster and FA summaries

**`trade-calculator.html` `buildContext()`** — Now passes:
- `rosterPositions` / `roster_positions`
- `scoringSettings` / `scoring_settings`

**`draft-warroom.html` `buildContext()`** — Now passes:
- `scoringSettings` / `scoring_settings`
- `roster_positions`
- `teamTier`, `teamWindow`, `healthScore`, `tier`, `tradeWindow`

---

## 2. Contextual Valuation Rules

### Rule 1: Team Mode Drives Everything

| Mode | What to Recommend | What to NEVER Recommend |
|------|-------------------|------------------------|
| **REBUILDING** | Youth (age ≤ 25), draft picks, sell aging assets, patience | Aging veterans for depth, spending FAAB on low-value players, "win now" moves |
| **CONTENDING** | Proven starters, fill weak spots NOW, trade future picks for upgrades | Speculative youth projects that won't help this season, hoarding picks |
| **CROSSROADS** | Commit one direction: push or tear down. No half-measures. | Generic "add depth" advice, standing pat |

### Rule 2: League Format Multipliers

| Format | Position | Scarcity Multiplier | Rule |
|--------|----------|-------------------|------|
| Superflex | QB | 1.8x | If team has <2 startable QBs, QB is #1 priority above ALL else |
| TE Premium | TE | 1.5x | Elite TEs (top 5) are premium assets, not interchangeable |
| 2+ RB slots | RB | 1.3x | Don't trade away RB depth lightly |
| Full PPR | Pass catchers | +15% | High-volume slot WRs and receiving RBs worth more |

### Rule 3: Quality Thresholds (Hard Floor)

- **DHQ < 500** → Never recommend. Not worth a roster spot.
- **PPG < 5.0** (with 6+ games) → Never recommend. Below replacement level.
- **No stats in 2 years** (non-rookies) → Never recommend.
- **Veterans (27+) with declining trend who wouldn't start** → Never recommend for FAAB.

### Rule 4: FAAB Discipline

- "Depth for depth's sake" is NEVER valid.
- A $1 bid on a bad player wastes a roster spot.
- If no quality targets exist, say **"HOLD YOUR FAAB."**
- Remaining FAAB is a weapon for mid-season breakouts and injuries — preserve it.
- Rebuilding teams: Only bid on young upside (age ≤ 25) or emergency injury replacements.
- Contending teams: Bid aggressively ONLY on difference-makers who would start.

### Rule 5: Superflex QB Emergency Protocol

In superflex leagues, if a team has fewer starting-caliber QBs than QB-eligible roster slots:
1. This is flagged as a **CRITICAL DEFICIT**
2. QB acquisition becomes the **#1 priority** above all other positions
3. Any available QB with DHQ > 1000 should be the first recommendation
4. Trade recommendations should prioritize acquiring a QB even at premium cost
5. This overrides all other positional needs

### Rule 6: Position-Specific Age Windows

| Position | Peak Window | Sell Signal | Rebuild Avoid Age |
|----------|-------------|-------------|-------------------|
| QB | 23-39 | N/A (long career) | 32+ unless elite |
| RB | 21-31 | Age 28+ declining | 27+ |
| WR | 21-33 | Age 30+ declining | 28+ |
| TE | 21-34 | Age 30+ declining | 28+ |
| DL | 26-33 | Age 31+ | 30+ |
| LB | 26-32 | Age 30+ | 29+ |
| DB | 21-34 | Age 30+ | 29+ |

### Rule 7: Trade Partner Mode Awareness

The other side of every trade values assets through their own competitive mode. `buildPartnerModeBlock(partner)` injects this into `trade_verdict` prompts, and `buildPartnersPrompt` carries equivalent partner-mode rules:

| Partner Mode | They Accept | They Reject/Lowball |
|--------------|-------------|---------------------|
| **REBUILDING** | Draft picks (1sts/2nds above all), players aged ≤24 | Offers centered on veterans 27+ |
| **CONTENDING** | Proven starters at positions of need (will pay premium incl. picks) | Speculative youth, distant picks at full price |
| **CROSSROADS** | Offers that decisively push them one direction | Balanced "depth" swaps |

### Rule 8: Verdict Honesty vs the Deterministic Grade

When the AI gives a second opinion on a calculator-graded trade (`trade_verdict`):
- It must judge through the requesting owner's team mode FIRST — a "fair value" trade that fights the team's direction is a bad trade.
- It must apply format premiums (QB 1.8x superflex, TE 1.5x TEP) to both sides before comparing.
- If it disagrees with the deterministic grade, it must SAY SO explicitly with a concrete reason. "It depends" is never a valid final answer.
- The verdict is constrained to exactly ACCEPT / REJECT / COUNTER.

---

## 2b. Analysis Types & Cost Policy

| Type | Tier | Trigger | Cached | Counts against daily requests |
|------|------|---------|--------|-------------------------------|
| `trade_verdict` | premium | Explicit (button) | Never (deal-specific) | Yes |
| `team_diagnosis` | standard | Ambient (League Detail) | 12h, shared per roster state | No (cost budgets only) |
| `dashboard_digest` | fast | Ambient (dashboard load) | 24h, per user | No (cost budgets only) |
| `insight` | fast | Ambient (Alex Insights) | 24h, per user | No (cost budgets only) |

**Ambient request policy:** cacheable types are served from `ai_response_cache` (keyed by SHA-256 of `AI_POLICY_VERSION + type + scope + context`). Cache hits cost nothing and consume no budget. Fresh ambient calls reserve **cost** budgets (daily/monthly/global USD caps) but do not consume the plan's request allowance. `context.forceRefresh: true` bypasses the cache read and pays a normal counted request, so regenerate buttons cannot be spammed for free.

**Dynamic scarcity:** when the client passes `positionalSupply` (startable players per position league-wide) plus `teamCount`, `buildScarcityBlock()` computes real supply/demand indices per position and injects 🔴/🟠/🟢 scarcity guidance into the system prompt. Degrades silently when absent.

---

## 2c. Learning Loop (User Preference Profile)

The AI learns each owner's tendencies from their reactions to its advice:

1. **Capture** — clients send thumbs up/down, acted-on, and dismissed signals to the `ai-feedback` edge function (via `window.WR.AIFeedback.send`). Surfaces: trade verdict agree/disagree, Alex Insights card thumbs, dashboard digest thumbs, and FA target adds that match the last AI recommendation (`acted`).
2. **Store** — `ai_feedback` table (RLS, service-role only), deduped per `(identifier, rec_id, action)`.
3. **Roll up** — `get_ai_preference_summary()` condenses the last 90 days into accept rate, per-surface counts, and the most recent rejected/acted subjects.
4. **Inject** — `buildUserPreferenceBlock()` appends a ~10-line "USER PREFERENCE PROFILE" to every structured system prompt (mock drafts excluded): rejected framings are not re-pitched without overwhelming evidence; acted-on profiles get weight. The block explicitly states that quality thresholds and team-mode rules always take precedence.
5. **Cache coherence** — the response-cache key includes a decile-rounded prefs version stamp, so cached ambient insights refresh when an owner's tendencies shift meaningfully without churning on every thumb.

Fail-open at every step: with no feedback history, prompts are byte-identical to the pre-loop behavior.

---

## 3. How the System Works End-to-End

```
User clicks "Run Analysis" in War Room
        │
        ▼
Client-side buildContext() assembles:
  ├── Roster data (players, ages, DHQ values)
  ├── League format (roster_positions, scoring_settings)
  ├── Team mode (tier, window, healthScore)
  ├── FAAB budget and min bid
  └── Available free agents / rookies with ages + DHQ
        │
        ▼
Request hits ai-analyze Edge Function
        │
        ▼
buildSystemPrompt(context) generates:
  ├── Base analyst persona
  ├── detectLeagueFormat() → buildLeagueFormatBlock()
  │     └── Superflex? TEP? IDP? Scarcity multipliers
  ├── buildTeamModeBlock()
  │     └── REBUILD rules / CONTEND rules / CROSSROADS rules
  ├── buildQualityThresholdBlock()
  │     └── DHQ floor, PPG floor, FAAB discipline rules
  └── 5 Critical Rules the AI must follow
        │
        ▼
buildFATargetsPrompt(context) / buildTeamPrompt(context) etc.
  ├── Injects league format block into user prompt
  ├── Injects team mode block with specific rules
  ├── For superflex: QB crisis detection
  ├── For FA: Strict FAAB recommendation rules
  └── Tells AI to say "no good targets" if quality pool is weak
        │
        ▼
Claude generates analysis following all contextual rules
```

---

## 4. Testing Scenarios

To verify the training program works correctly, test these scenarios:

### Scenario A: Rebuilding Team in Standard League
- **Expected:** AI recommends selling aging vets for picks, targeting youth only, holding FAAB
- **Should NOT see:** "Add veteran WR depth" or "Bid $15 on 30-year-old RB"

### Scenario B: Contending Team in Superflex with 1 QB
- **Expected:** AI flags QB as #1 priority, recommends aggressive QB acquisition (trade or FAAB), values QBs at 1.8x premium
- **Should NOT see:** "Your QB situation is fine" or RB recommendations before QB deficit is addressed

### Scenario C: TE Premium League, Any Team Mode
- **Expected:** Elite TEs valued at 1.5x, AI mentions TE premium context, doesn't treat TEs as interchangeable
- **Should NOT see:** "Trade away your TE1 for a WR2" when TE1 is top-5

### Scenario D: Weak Free Agent Pool
- **Expected:** AI says "Hold your FAAB — no impactful additions available right now"
- **Should NOT see:** 5-7 recommendations of players with DHQ < 500

### Scenario E: Rebuilding Team FAAB Recommendations
- **Expected:** Only young players (≤25) or emergency injury replacements. Low bids only.
- **Should NOT see:** Any veteran depth recommendations. Any bid over 5% of remaining FAAB on non-elite talent.

---

## 5. Future Enhancements

1. ~~**Dynamic scarcity scoring**~~ — ✅ Implemented as `buildScarcityBlock()` (see Section 2b). Clients opt in by passing `positionalSupply` counts.
2. ~~**Trade partner mode awareness**~~ — ✅ Implemented as `buildPartnerModeBlock()` + partner-mode rules in `buildPartnersPrompt` (see Rule 7).
3. **Injury-triggered FAAB alerts** — If a starter is injured, temporarily lift FAAB restraint for that position only
4. **Seasonal FAAB pacing** — Early season = patient, mid-season = targeted, late season (playoffs) = aggressive for contenders
5. **BUY action in player cards** — Components.js currently has SELL/HOLD but no BUY logic. Add BUY recommendations for undervalued youth at positions of need.

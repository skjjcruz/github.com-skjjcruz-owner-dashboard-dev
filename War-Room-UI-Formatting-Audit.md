# War Room UI Formatting & Readability Audit

**Goal:** Eliminate scrolling on all Flash Brief tabs. Maximize space efficiency everywhere else.
**Target Viewports:** 1440×900 (MacBook Pro 13"), 1920×1080 (standard desktop)
**Audit Date:** April 4, 2026

---

## Executive Summary

The War Room currently requires scrolling on nearly every screen at 1440×900. The root causes are consistent: oversized fonts, generous padding/margins that compound across stacked cards, vertical layouts where horizontal would fit, and a few elements that eat viewport height without earning it (the title "FLASH BRIEF" at 1.8rem + 20px margin-bottom alone burns ~60px).

**Estimated total vertical space recoverable across Flash Brief:** 300-400px — enough to eliminate scrolling on both 1080p and 900p displays.

---

## PART 1: FLASH BRIEF — ZERO-SCROLL REDESIGN

### Current Vertical Budget (estimated pixel heights at 1440×900)

| Element | Current Height | Problem |
|---------|---------------|---------|
| Sticky time context bar | ~44px | Necessary — KEEP |
| Time mode banner (when shown) | ~40px | Conditional — OK |
| "FLASH BRIEF" title | ~58px | 1.8rem font + 20px marginBottom |
| Team Diagnosis card | ~110px | 2.8rem rank + 20px padding + 20px marginBottom |
| Action Plan card (3 items) | ~190px | 10px padding per item + 20px marginBottom |
| KPI Grid (4 cards) | ~160px | 14px padding + 1.8rem values + 12px gap |
| Two-column section | ~240px | 16px gap + 20px marginBottom |
| Power Ranking card | ~130px | 20px marginBottom |
| Footer | ~40px | 12px padding |
| **TOTAL** | **~1,012px** | **Exceeds 900px viewport by 112px** |

### Available viewport after chrome

At 1440×900: sidebar (160px wide, not vertical), header (~48px), time bar (~44px) = **~808px usable height**.
At 1920×1080: same layout = **~988px usable height**.

**Current content: ~1,012px. We need to cut ~200px minimum (for 900p) or ~25px (for 1080p).**

---

### Fix 1: Compress the Title (save ~35px)

**Current:**
```js
fontSize: '1.8rem', marginBottom: '20px'  // ~58px total
```

**Proposed:**
```js
fontSize: '1.2rem', marginBottom: '8px'   // ~28px total
```

The "FLASH BRIEF" title is pure branding — the user already knows which tab they're on from the nav. Shrink it and tighten the margin. On desktop, consider eliminating it entirely since the tab name is visible in the sidebar. Savings: **~30px**.

---

### Fix 2: Compress Team Diagnosis Card (save ~50px)

**Current:**
- Rank: `fontSize: '2.8rem'` (~45px)
- Card padding: `20px 24px`
- Card marginBottom: `20px`

**Proposed:**
- Rank: `fontSize: '1.8rem'` (~29px)
- Card padding: `12px 16px`
- Card marginBottom: `10px`
- Merge the tier label and stats onto one line instead of stacking

**Layout change:** Make diagnosis a horizontal strip instead of a tall card:
```
[#3 CONTENDER  |  Health 78  |  6-4 Record  |  PPG 243.5]
```
This collapses ~110px into ~48px. Savings: **~60px**.

---

### Fix 3: Compress Action Plan Items (save ~50px)

**Current per item:**
- Row padding: `10px 0`
- Label fontSize: `0.88rem`
- Description fontSize: `0.78rem`
- "Fix This" button: `6px 14px` padding
- Separator border between items

**Proposed per item:**
- Row padding: `6px 0`
- Label fontSize: `0.82rem`
- Description: move inline with label using " — " separator instead of stacking on second line
- Button: `4px 10px` padding, fontSize `0.72rem`
- No separator borders (rely on spacing)

**Before (per item):** ~60px → **After:** ~32px
**With 3 items:** 180px → 96px. Savings: **~84px**.

Also: cap at 3 action items max. Currently renders all priorities, which could be 5+. Show "View all" link for overflow.

---

### Fix 4: Tighten KPI Grid (save ~40px)

**Current:**
- Card padding: `14px`
- Value fontSize: `1.8rem`
- Label: separate line below
- Gap: `12px`

**Proposed:**
- Card padding: `10px 12px`
- Value fontSize: `1.4rem`
- Label: inline left-aligned with value right-aligned (horizontal layout per card instead of centered stack)
- Gap: `8px`

**Before:** ~160px → **After:** ~110px. Savings: **~50px**.

Alternative: **Move to 6 KPIs in a single row** using compact horizontal bars instead of centered tall cards. Each KPI becomes: `[LABEL: VALUE]` in a 6-column grid at 28px height = ~36px total. This is the nuclear option but gives the most savings.

---

### Fix 5: Tighten Two-Column Section (save ~40px)

**Current:**
- Trade Currency card: prose description + "Find Trades" button = ~120px
- Position Investment card: 4 position rows + header = ~120px
- Section marginBottom: `20px`
- Gap: `16px`

**Proposed:**
- Trade Currency: condense prose to 1 line + inline button. Or remove prose entirely — the "Find Trades" button IS the action.
- Position Investment: reduce row padding from `4px 0` to `2px 0`, reduce bar height from `6px` to `4px`
- Section marginBottom: `10px`
- Gap: `10px`

**Before:** ~240px → **After:** ~160px. Savings: **~80px**.

---

### Fix 6: Condense Power Ranking Card (save ~30px)

**Current:** Full card with header + prose paragraph describing your ranking.

**Proposed:** Merge into the Team Diagnosis strip (Fix 2). Your rank, tier, and a one-sentence summary can all fit in the compressed horizontal diagnosis bar. Eliminate as a separate card entirely.

Savings: **~130px** (entire card removed).

---

### Fix 7: Kill the Footer (save ~40px)

**Current:** Centered footer text with `12px padding` and `0.78rem` font saying something like "Powered by DHQ Engine."

**Proposed:** Remove. Zero information value. If needed for branding, put it in the sidebar.

Savings: **~40px**.

---

### Cumulative Savings

| Fix | Savings |
|-----|---------|
| Title compression | 30px |
| Diagnosis → horizontal strip | 60px |
| Action plan compression | 84px |
| KPI grid tightening | 50px |
| Two-column compression | 80px |
| Power Ranking → merged into diagnosis | 130px |
| Footer removed | 40px |
| **TOTAL** | **~474px** |

**Resulting height: ~1,012 - 474 = ~538px** — fits in 808px (1440×900) with 270px to spare.

This over-corrects intentionally. You can add back breathing room selectively (e.g., keep the Power Ranking card if you have viewport budget).

---

### Recommended Flash Brief Layout (Zero-Scroll)

```
┌─────────────────────────────────────────────────────────┐
│ [Diagnosis Strip]  #3 CONTENDER | Health 78 | 6-4 | PPG 243 │  ~48px
├──────────┬──────────┬──────────┬──────────┬──────────┬──┤
│ Elite: 3 │ Window:4y│ Cliff:18%│ Gap: +12 │ Rank: #3 │…│  ~44px  (compact KPI row)
├──────────┴──────────┴──────────┴──────────┴──────────┴──┤
│ ACTION PLAN                                              │
│ 1. Add RB depth — 2 starters, need 3 ············ [FIX] │  ~32px per item
│ 2. Sell aging WR — 1yr left, trending -12% ······ [FIX] │  ~96px total (3 items)
│ 3. Target 1st-rd pick — only 14 picks ··········· [FIX] │
├─────────────────────┬────────────────────────────────────┤
│ TRADE CURRENCY      │ POSITION INVESTMENT vs WINNERS     │  ~140px
│ Surplus: WR, TE     │ QB ████░░ +12%                     │
│ [FIND TRADES]       │ RB ██░░░░ -22%                     │
│                     │ WR ██████ +3%                      │
│                     │ TE ████░░ +8%                      │
├─────────────────────┴────────────────────────────────────┤
│ POWER RANKINGS (top 5)                                    │  ~160px
│ #1 Team Alpha    ELITE     Health 92  DHQ 94k            │
│ #2 Team Beta     CONTENDER Health 85  DHQ 87k            │
│ ► #3 YOUR TEAM   CONTENDER Health 78  DHQ 82k            │
│ #4 Team Delta    CROSSROADS Health 64 DHQ 71k            │
│ #5 Team Epsilon  CROSSROADS Health 61 DHQ 68k            │
└──────────────────────────────────────────────────────────┘
                                                    TOTAL: ~488px
```

This fits in **any** viewport above 600px height.

---

## PART 2: DRAFT ROOM FLASH BRIEF

### Current Issues

The Draft Room has its own Flash Brief sub-tab (`draft-room.js` line 227-231). Key problems:

1. **"ON THE CLOCK" section uses 2rem font** for the round label — burns ~40px for a single number
2. **Draft board maxHeight: 600px** creates a nested scroll-within-scroll that feels broken
3. **Right detail panel: fixed 380px width** — takes 32% of a 1200px container for a single player card
4. **Big Board rows: 32-36px height** with 8px gaps — could be 24px with 4px gaps

### Recommended Fixes

| Element | Current | Proposed | Savings |
|---------|---------|----------|---------|
| Round label font | 2rem | 1.3rem | ~15px |
| Pick card padding | 12px | 8px | ~8px per card |
| Board row height | 36px | 26px | ~10px per visible row |
| Board maxHeight | 600px (nested scroll) | Remove — let page scroll | Eliminates nested scroll |
| Right panel width | 380px fixed | 300px or collapsible | +80px horizontal space |
| Section margins | 16-20px | 10-12px | ~30px cumulative |
| Empty states padding | 2rem (32px) all sides | 1rem (16px) | ~32px |

**Critical fix:** Remove `maxHeight: 600px` on the Big Board. Nested scrolling (scroll-within-scroll) is one of the worst UX patterns. Let the entire page scroll naturally, or use `100vh - headerHeight` calc to fill remaining viewport.

---

## PART 3: ANALYST VIEW SUB-TABS

### Global Issues Across All Sub-Tabs

These problems repeat in every analytics sub-tab (roster, draft, waivers, trades, projections, playoffs, timeline):

**1. KPI Card Bloat**
Every sub-tab opens with a GMMessage (AI strategy summary) + 4 KPI cards. The pattern is:
- GMMessage: ~80px (14px padding + 8px margin + avatar + text)
- KPI Grid: ~160px (20px padding + 2.2-2.4rem values)
- **Combined: ~240px burned before any actual content appears**

**Fix:** Compress KPI cards to a single horizontal stat bar:
```
Grade: A- | Hit Rate: 62% | Top Pos: WR, RB | Seasons: 4
```
Height: ~36px instead of ~160px. Savings: **~124px per sub-tab**.

**2. Chart Grid Forces Single-Column on Narrow Viewports**
`gridTemplateColumns: repeat(auto-fit, minmax(300px, 1fr))` means on a 600px content area, charts stack vertically. Lower the minmax to 240px to allow two-column on tablets.

**3. aCardStyle Padding is Generous**
Every card uses: `border: 2px, borderRadius: 12px, padding: 16px, marginBottom: 16px`. That's 16+16+2+2 = 36px of vertical overhead per card boundary. With 4-6 cards per sub-tab, that's **144-216px of card chrome**.

**Fix:** Reduce to `padding: 10px, marginBottom: 10px, borderRadius: 8px, border: 1px`. Saves ~12px per card boundary = **~60-72px per sub-tab**.

---

### Roster Sub-Tab Specific

**Power Rankings Table:**
- Header row: 36px height is fine
- Data rows: `padding: 8px 0` on a grid with 36px avatar = ~44px per row
- In a 16-team league: 16 × 44px = 704px just for the table body
- **Fix:** Reduce row height to 32px (smaller avatars at 24px, tighter padding). 16 × 32 = 512px. Savings: **~192px**.
- Or: Show only top 5 + your team + bottom 3 with "Expand All" button.

**Radar Chart Section:**
- Currently: `display: flex, gap: 24px, flexWrap: wrap` with RadarChart at 200px
- Text description + 200px chart + 24px gap = ~224px wide, ~200px tall
- **Fix:** Reduce radar to 160px. Tighten gap to 16px.

**Insight Cards Grid:**
- `repeat(auto-fit, minmax(240px, 1fr))` with `padding: 14px 16px` per card
- **Fix:** Reduce to `minmax(200px, 1fr)` and `padding: 10px 12px`

---

### Draft Sub-Tab Specific

**Winning Draft Formula Card:**
- Each round: label + position tags + your profile tags + 10px marginBottom
- 7 rounds × ~50px = 350px
- **Fix:** Collapse into a table format: Round | Winners Pick | Your History. Height: ~200px. Savings: **~150px**.

**Hit Rates Bar Charts:**
- Two stacked BarCharts (Winners + League Avg) with legend
- **Fix:** Side-by-side instead of stacked. Cuts height in half.

---

### Waivers Sub-Tab Specific

**FAAB Profile Table:**
- Standard grid table — efficient as-is
- **Fix:** Minor — reduce header padding from 6px to 4px

**Spending Timing Card:**
- Three spending categories stacked (Winners / League / You), each with label + bar = ~110px
- **Fix:** Use grouped horizontal bars instead of stacked sections. All three bars per timing category on one row. Saves ~40px.

**FAAB Efficiency Card:**
- Two large centered numbers (2rem Bebas Neue) + "By Position" table
- **Fix:** Inline the two numbers as a stat strip instead of centered block. Saves ~30px.

---

### Projections Sub-Tab Specific

**5-Year Outlook Card:**
- 5 year rows × ~40px = 200px
- Each row: year label + progress bar + tier label
- **Fix:** Compact to 28px rows. Savings: **~60px**.

**Competitive Window Card:**
- `textAlign: center, padding: 24px` with 1.5rem value
- **Fix:** Reduce padding to 14px. This is a single number — it doesn't need a hero card.

**Aging Cliff Alert:**
- Two centered large numbers (2rem) + at-risk player list
- **Fix:** Inline the numbers. Show max 3 at-risk players with "View All" overflow.

---

### Playoffs Sub-Tab Specific

**Bracket Display:**
- Each season: label + bracket rows (variable length)
- Matchup rows: `padding: 6px 10px, marginBottom: 4px`
- **Fix:** These are already compact. Minor: reduce marginBottom to 2px.

**Rivalry Section:**
- Each rival: name + record + meeting badges
- **Fix:** Compact. Reduce meeting badge fontSize from 0.68rem to 0.64rem and padding from `1px 6px` to `1px 4px`.

---

### Timeline Sub-Tab

**Timeline Container:**
- `padding: 24px` with year groups at `marginBottom: 24px`
- Event cards: `padding: 10px 14px, marginBottom: 8px`
- **Fix:** Reduce container padding to 16px, year group margin to 16px, event card marginBottom to 6px. This is a scroll-by-design view, so perfecting zero-scroll isn't the goal — but tighter spacing improves density.

---

## PART 4: ROSTER TABLE

### Current Layout

The roster table uses a frozen left column (220px) + horizontally scrollable right section. Each player row is 42px tall.

### Issues

1. **Row height 42px is generous** for data rows. The content (0.82rem name + 0.72rem team) fits in 32px.

2. **Frozen column width 220px** — player names rarely exceed 160px. The extra 60px is wasted horizontal space on every row.

3. **Expanded player card** drops inline and pushes everything down by ~400px (photo + stats grid + age curve + buttons + career table). This is fine for detail, but consider:
   - Opening in a side panel instead of inline expansion (saves vertical displacement)
   - Or: limit inline expansion to ~200px (key stats only), with "Full Profile" opening the modal

4. **Column picker dropdown** uses `gridTemplateColumns: repeat(4, 1fr)` — fine.

5. **KPI cards above roster** use `repeat(4, 1fr)` with `14px` gap and `16px 18px` padding — same bloat pattern as Flash Brief KPIs.

### Recommended Fixes

| Element | Current | Proposed | Impact |
|---------|---------|----------|--------|
| Row height | 42px | 32px | Fits 25% more players on screen |
| Frozen column | 220px | 180px | +40px horizontal space for data |
| Avatar size | 26px | 22px | Enables tighter row height |
| Cell fontSize | 0.72rem | 0.72rem | Keep (already compact) |
| Row padding | 0 6px | 0 4px | Minor tightening |
| Expanded card | ~400px inline | 250px inline or side panel | Less displacement |
| KPI cards | 4 tall centered cards | Horizontal stat strip | ~120px saved |

---

## PART 5: TRADE CENTER

### Current Layout

3-column on desktop (≥1150px): Side A | Side B | Scout Panel. Drops to 2-column below 1150px.

### Issues

1. **Trade verdict value: 2.4rem** — the DHQ difference number is enormous. Could be 1.6rem.

2. **Roster list maxHeight: 300px** with scrolling — acceptable for player selection, but tight. Consider 400px.

3. **Scout panel maxHeight: 660px** on desktop — this is essentially the full viewport. Fine.

4. **Tax table rows: padding 0.38rem 0.7rem** — already compact. Good.

5. **DNA Grid** on the Owner DNA sub-tab: `repeat(3, 1fr)` on desktop. In a 16-team league, that's 6 rows of DNA cards. Each card is ~120px tall. Total: ~720px. This scrolls significantly.

### Recommended Fixes

| Element | Current | Proposed | Impact |
|---------|---------|----------|--------|
| Verdict value font | 2.4rem | 1.6rem | ~15px saved |
| DNA card height | ~120px | ~80px (compress) | Fits 2 more cards on screen |
| DNA grid | 3 columns | 4 columns on ≥1200px | Fewer rows |
| Team card body padding | 0.6rem 0.7rem | 0.45rem 0.55rem | Tighter cards |
| Team grid gap | 0.75rem | 0.5rem | Tighter grid |

---

## PART 6: FREE AGENCY

### Issues

1. **Nested scroll container (Analyst View): maxHeight 400px** — same nested-scroll-within-scroll problem as Draft Board.

2. **FAAB recommendation cards**: generous padding at 12-16px per card. With 10+ waiver targets, this scrolls significantly.

3. **Recommendation row height: ~30px** — could be 24px.

4. **MiniDonut FAAB gauge: height unspecified but typically 60-80px** — fine as a visual element.

### Recommended Fixes

| Element | Current | Proposed | Impact |
|---------|---------|----------|--------|
| Analyst view maxHeight | 400px nested scroll | Remove — page scroll | Eliminates nested scroll |
| Rec card padding | 12-16px | 8-10px | ~8px per card |
| Rec row height | ~30px | 24px | ~20% more visible |
| Section margins | 16-20px | 10-12px | ~30px cumulative |

---

## PART 7: GLOBAL PATTERNS TO FIX EVERYWHERE

### 1. The "Card Tax"

Every card in the app costs ~36px of vertical overhead: `border: 2px + padding: 16px top + padding: 16px bottom + marginBottom: 16px = 50px`. Multiply by 5-8 cards per screen = **250-400px of card chrome**.

**Global fix:** Create a `--card-pad` CSS variable at 10px and `--card-gap` at 8px. Apply everywhere. Savings compound massively.

### 2. Font Size Hierarchy

The app uses Bebas Neue at sizes from 0.62rem to 2.8rem. The large sizes (≥1.8rem) are used for KPI values, but they burn vertical space without improving readability on desktop.

**Proposed hierarchy:**
- Page title: 1.2rem (from 1.8rem)
- KPI value: 1.4rem (from 1.8-2.4rem)
- Card header: 1.0rem (from 1.2rem)
- Section header: 0.9rem (from 1.0rem)
- Body text: 0.82rem (keep)
- Labels: 0.72rem (keep)
- Micro text: 0.64rem (keep)

### 3. The GMMessage Tax

Every sub-tab opens with a GMMessage (AI strategy summary) that takes ~80px. Across 7 analytics sub-tabs + Flash Brief + Draft Brief, that's **~640px of AI messages** across the app.

**Fix options:**
- Make collapsible (default collapsed after first view)
- Move to a persistent sidebar "AI Advisor" panel instead of per-tab messages
- Reduce to a single-line insight strip: `"Alex: Your roster is CONTENDER-tier. Priority: add RB depth."` (~28px)

### 4. Eliminate All Nested Scrolling

Three places currently use nested scroll containers:
1. Draft Board: `maxHeight: 600px` — REMOVE
2. Free Agency Analyst: `maxHeight: 400px` — REMOVE
3. Transaction ticker: `maxHeight: 460px` — acceptable (sidebar widget)

**Rule:** The only scrolling should be the page itself. No inner scroll containers for main content areas.

---

## PART 8: CSS VARIABLE SYSTEM (Proposed)

Create a spacing/sizing system to enforce consistency:

```css
:root {
    /* Spacing scale */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 12px;
    --space-lg: 16px;
    --space-xl: 24px;

    /* Card system */
    --card-pad: 10px 12px;
    --card-gap: 8px;
    --card-radius: 8px;
    --card-border: 1px solid rgba(212,175,55,0.2);

    /* Typography scale */
    --text-hero: 1.4rem;    /* KPI values */
    --text-title: 1.2rem;   /* Page/section titles */
    --text-heading: 1.0rem; /* Card headers */
    --text-body: 0.82rem;   /* Primary content */
    --text-label: 0.72rem;  /* Labels, metadata */
    --text-micro: 0.64rem;  /* Timestamps, footnotes */

    /* Row heights */
    --row-height: 32px;     /* Table/list rows */
    --row-compact: 24px;    /* Dense lists */
    --row-relaxed: 40px;    /* Feature rows */
}
```

Currently all spacing and sizing is defined inline on every element. A variable system would make it trivial to globally tighten or loosen the entire app.

---

## PRIORITY IMPLEMENTATION ORDER

| # | Change | Impact | Effort | Screens Affected |
|---|--------|--------|--------|------------------|
| 1 | Flash Brief → horizontal diagnosis strip | Eliminates ~190px | Medium | Flash Brief |
| 2 | Compress KPI cards globally (all screens) | Saves ~120px per screen | Medium | All 8+ screens |
| 3 | Remove nested scrolling (Draft Board, FA) | Fixes worst UX bug | Low | Draft, Free Agency |
| 4 | Reduce card padding/margins globally | Saves ~60-70px per screen | Low | All screens |
| 5 | Flash Brief Action Plan compression | Saves ~84px | Low | Flash Brief |
| 6 | Reduce Bebas Neue hero font sizes | Saves ~15-20px per card | Low | All screens |
| 7 | Merge Power Ranking into diagnosis | Saves ~130px | Medium | Flash Brief |
| 8 | GMMessage → collapsible or single-line | Saves ~50px per tab | Medium | All analytics tabs |
| 9 | Roster row height 42→32px | 25% more players visible | Low | Roster tab |
| 10 | Create CSS variable system | Enables global tuning | Medium | All screens |
| 11 | Power Rankings table → show top 5 + you | Saves ~350px | Medium | Roster analytics |
| 12 | Draft Formula table → tabular format | Saves ~150px | Medium | Draft analytics |

---

*End of Audit*

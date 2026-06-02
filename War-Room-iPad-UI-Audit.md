<!-- Generated 2026-05-31 by a 45-agent fan-out audit (warroom-ui-audit workflow). 315 verified findings: 36 high / 117 medium / 162 low. Companion to War-Room-UI-Formatting-Audit.md (desktop zero-scroll, Apr 2026). -->

# War Room — UI Standardization Plan

## 1. Verdict

War Room's UI is functionally rich but systemically inconsistent: the design tokens exist and are correct, but the app overwhelmingly ignores them. Of 315 verified findings, the dominant story is **drift** (107 formatting + 40 spacing findings are hardcoded values that duplicate existing tokens) and **iPad blindness** (the `max-width:767px`/`760px` breakpoint pattern recurs across ~8 files and leaves iPad portrait 768-834px inheriting cramped or overflowing desktop layouts). The single most serious gap is **the entire drafting experience is unreachable on standard iPad portrait** (finding line 1257: `bpBucket` routes everything <1024px to a read-only MobileFeed), compounded by ~100 sub-44px touch targets including primary nav, close buttons, and the core Big Board reorder arrows. None of this is a rewrite — it is a disciplined token-and-breakpoint sweep plus targeted touch-target padding, most of it mechanical and non-breaking, with a minority needing visual verification at iPad widths.

## 2. Proposed Standard

### (a) Canonical breakpoint set
Adopt the existing `window.DraftCC.styles` values as the *only* breakpoints app-wide and delete the ~22 one-offs (480/500/520/600/620/650/700/750/760/767/780/800/900/980/1040/1050/1100/1120/1150/1180/1200/1280):

| Token | px | Behavior at/below this width |
|---|---|---|
| `BP_MOBILE` | **768** | Single-column stacks; phone treatment is **`< 768`** (use `max-width:767px` only for the true phone tier) |
| `BP_TABLET` | **1024** | iPad-portrait/landscape tier: 2-column max, sidebars auto-collapse to 72px rail or drawer, data tables get `overflowX:auto` or column-dropping, touch padding active |
| `BP_DESKTOP` | **1440** | Full multi-column desktop |

Concrete rules:
- **iPad portrait (768-834) is a first-class tier.** Any rule currently at `max-width:767px` or `760px` that governs *layout reflow, sidebar collapse, or nav drawer* must move to `max-width:1023px` (or add a `768-1023` tier). Phone-only micro-tweaks (header time-bar, etc.) stay at 767.
- For inline-JS grid templates (which CSS media queries cannot override), drive the column choice from a `viewport` state derived from these same three breakpoints.

### (b) Touch-target rule
Every interactive element (button, tappable row, icon hit area, nav item, chip toggle, close/X, select) must present a **≥44×44 CSS px hit area** under `@media (pointer: coarse)` — keep the visual glyph small, expand the hit box via `min-height/min-width:44px` + `display:flex;align-items:center;justify-content:center`, or transparent padding. Scope the bump to coarse-pointer so desktop density is untouched. **Exception:** in fixed-height no-scroll tiles (e.g. `player-tags.js` lg 320px tile, `power-rankings.js` compact header), do *not* hard-set 44px — use hit-padding/negative-margin to reach the target without growing the row, or gate density to non-touch.

### (c) Spacing / token-usage rule
- **Spacing:** use `--space-xs/sm/md/lg/xl` (4/8/12/16/24) for all gaps/margins/padding. Map exact matches mechanically (8→sm, 12→md, 16→lg, 24→xl). Off-scale values (10/14/20/26px) round to nearest token only with visual review.
- **Card padding:** `--card-pad` (16 18) for standard panels, `--card-pad-sm` (10 12) for compact/inner cards, `--card-pad-lg` (18 22) for hero. Fix the wrong fallbacks (`var(--card-pad, 14px 16px)` and `10px 14px` → `16px 18px`).
- **Radius:** only `--card-radius` (10) for panels and `--card-radius-sm` (6) for chips/buttons/tiles. Eliminate the 3/4/5/7/8/9/12/14/16/20px ladder; 12-20px hero radii may stay if a `--card-radius-lg` token is added and referenced.
- **Border:** `--card-border` (1px rgba(212,175,55,0.2)) is the standard gold edge. Replace `2px`/`0.3`/`0.15`/`0.14`/`0.12` one-offs unless a deliberately heavier hero/trophy edge is documented.
- **Color:** replace literals that *exactly* match tokens (`#2ECC71`→`--good`, `#E74C3C`→`--bad`, `#F0A500`→`--warn`, `#5DADE2`→`--info`, `#9B8AFB`→`--purple`, `#D4AF37`→`--gold`) as 1:1 swaps. **Do not blind-swap near-matches**: `#3498DB`/`#00c8b4`/`#34D399`≠`--info`, `#7C6BF8`/`#60a5fa`≠`--purple`, `#C0C0C0` medal silver ≠`--silver` `#BDB8AD`, `#D0D0D0`≠`--silver`. Introduce new tokens or leave intentional accents. **Critical:** where a literal is concatenated with an alpha suffix (`t.c + '22'`, `color+'18'`), a `var(--x)` swap produces invalid CSS — those must move to `color-mix()`/`rgba()` or keep the hex.
- **Type scale:** floor all rendered text at `--text-micro` (.6875rem/11px); map .75→`--text-label`, .9375→`--text-body`, 1→`--text-heading`, 1.125→`--text-title`. The sub-11px cluster (0.42-0.62rem) is the legibility offender — bump labels/captions, but do not blanket-bump dense data cells without layout retest.
- **Fonts:** always `var(--font-title)`/`var(--font-body)`/`var(--font-mono)` (or the `FONT_*` constants in draft files), never `'Rajdhani, sans-serif'`/`'JetBrains Mono, monospace'` literals — these are zero-visual-change swaps.

### (d) Migrate-to-WR.* rule
New surfaces **must** use `window.WR.Card / Kpi / Badge / Chip / ConfChip / DeltaLine / InsightCard`. Existing hand-rolled card/chip/kpi markup migrates opportunistically, not as a forced sweep — and only after verifying WR primitives are loaded in that bundle (the draft panels are plain inline-style React with no confirmed WR import). Note `WR.Badge`/`WR.Chip` take `kind`/`level` props, not `bg`/`color`, so migration is non-trivial where dynamic per-item color tints are used.

## 3. Cross-Cutting Themes

1. **`767px`/`760px` breakpoint excludes iPad portrait** — ~8 surfaces. App-shell sidebar (league-detail.js:2727), nav (2727/2754), Flash Brief (index.html:1595 @760), Empire (command-center @760/@1180), hub (index.html:874), free-agency.html (@768 non-monotonic), trade-calculator (@800/@1150), onboarding (@620). The recurring "iPad gets desktop" hazard.
2. **Drafting blocked on iPad portrait** — `bpBucket` returns 'mobile' for any width <1024 (draft/styles.js:68-74), so 768-834 + iPad Pro 11" portrait get read-only MobileFeed; the working `isTablet` branch (command-center.js:4097) exists but is never reached there.
3. **~100 sub-44px touch targets** — pervasive across every file. Primary nav (`.wr-module-nav` 23px, sidebar nav 32px, settings gear 22px, `.empire-back` 34×28, back/close X buttons 16-30px), filter/sort chips (20-28px), Big Board reorder arrows (16×14), widget gear/remove (22px, also hover-gated with no touch path).
4. **Hardcoded semantic color hex instead of tokens** — 107 formatting findings, the largest category. ~50+ instances each of `#2ECC71`/`#E74C3C`/`#F0A500` across league-detail, analytics, free-agency, my-team, trade-*, draft panels, primitives, and all static HTML pages.
5. **Hardcoded card padding/radius/border instead of `--card-*`** — ~40 spacing findings + many formatting. Three different gold-border alphas (0.12/0.14/0.15/0.2) across sibling dashboard widgets alone; radius ladder of 7 distinct values; wrong `--card-pad` fallbacks in 3+ files.
6. **Sub-11px font soup** — dozens of 0.42-0.62rem literals below `--text-micro`, worst at live-analytics (0.42rem) and Big Board edit buttons (0.5rem); plus ~20+ off-scale rem values per file with zero token usage for font-size in several files.
7. **Inline-JS grids with no reflow** — ~24 layout findings. Hard `repeat(N,1fr)` / fixed-px column templates that CSS cannot override: Big Board (914/1053px), Field Ranking (710px), All-Time Standings (546px), free-agency Market Explorer, owner KPI grids, trade inbox.
8. **Wide data tables with no `overflowX` wrapper** — ~10 overflow findings. The chronicles `<table>` + `overflowX:auto` pattern (league-detail:799) and my-team:822 pattern are the proven fix but are not applied to All-Time Standings (316), Champion Roster (1003), Field Ranking (836), free-agency market grid (1131).
9. **Standalone HTML pages re-declare divergent palettes** — landing/login/onboarding/gift/reset/admin/draft-warroom/free-agency/trade-calculator each define their own `:root` with `#0A0A0A`/`#C0C0C0`/Inter, three different silvers, off-brand greens/blues. Plus `user-scalable=no` on three shells disabling zoom fallback.

## 4. Prioritized Fix Plan

### Wave 1 — High-severity iPad breakage (must fix; 36 high findings)
- **draft/styles.js + command-center.js (CC grid):** add a `tablet` bucket at 768 in `bpBucket` so 768-1023 routes to the existing `isTablet` branch (4097), gate MobileFeed to `<768`. *Unblocks all drafting on iPad.* **Visual judgment** — exercises a path currently only seen at 1024+.
- **league-detail.js Big Board (2422):** JS-driven column drop/merge below 1024 (template is inline, CSS can't touch it). **Visual judgment.**
- **league-detail.js (316/1003), my-team (Field Ranking 836), free-agency (1131):** wrap fixed-px grids/tables in `overflowX:auto` mirroring the proven chronicles (799) / my-team (822) pattern. **Mostly mechanical**, verify column min-widths.
- **command-center StagedOfferRow (4983/5018):** flex-wrap the 5 action buttons AND enlarge them to 44px together (must be paired — enlarging without reflow overflows the 320px band). **Visual judgment.**
- **Touch-target highs (mechanical, additive):** settings gear (440/957/821 — also add touch path for hover-gated widget gear/remove 957/976), `.wr-module-nav` (204/192), Big Board reorder arrows (2547) + edit controls (big-board.js 558/575/315), `.empire-back`/filter/sort (782/795/838), strategy-editor pills/X (200/571), calendar add/remove (209/243), saved-views bar (160), Decision-History/Settings chips (1240/1414/1424), flash-brief CTAs (340/295 — also fix undefined `var(--accent)`), trade-modal/proposer close X (113/339), PlayerInlineCard X (components.js:98), roster acq-date font (league-detail 1893).
- **onboarding.html (139/499):** remove inline `grid-template-columns:1fr 1fr 1fr` (line 499) — it overrides even the existing phone collapse, so plan cards *never* stack (live bug); add tablet reflow.

### Wave 2 — Touch targets (remaining) + breakpoint unification
- **Move `760`/`767` layout/nav/sidebar rules to `1023`:** league-detail nav+sidebar (2727/2754/2650/1837), Flash Brief (index.html:1595), Empire (command-center 865/860/800), hub (874), free-agency.html (96/424 non-monotonic), trade-calculator (435/1150), landing/login/onboarding/admin breakpoints. **Visual judgment** per surface — phone-tuned rules inside the same block must stay at 767.
- **Sidebar auto-collapse:** for `<1024` default to the existing 72px collapsed rail or drawer (reuses current state, non-breaking).
- **Remaining medium touch targets** (~50): player-card.js modal/tab/tag buttons (517/527/548/558), all the per-file filter/sort/action chips, FAAB/number inputs, static HTML `.nav-btn`/`.auth-tab`/`.tab-btn`/`.price-btn` (42→44px). All additive/non-breaking under coarse-pointer.
- **Inline grids → auto-fit** where a CSS class can own it: trade inbox (3209), owner KPI grid (1898), league top section (226), duel/field grids (1282/1313/1158/1205), strategy priorities (331), free-agency column picker (1105), platform card grid (app.js:839). **Mostly mechanical** (matches sibling auto-fit patterns).

### Wave 3 — Spacing / formatting token migration (mechanical, non-breaking)
- **1:1 color swaps** (exact token matches only): `--good/--bad/--warn/--info/--purple/--gold` across league-detail, analytics, free-agency, my-team, trade-*, mock-draft, primitives, hub-overview, power-rankings, my-trophies, competitive-tiers, strategy-editor, draft/styles.js. **Skip** alpha-concat sites (move to `color-mix`/`rgba`) and near-match colors.
- **Font-family literals → tokens** (zero visual change): every `'Rajdhani'`/`'JetBrains Mono'`/`'DM Sans'` literal → `var(--font-*)` or `FONT_*` constants.
- **Spacing/radius/border token swaps** where exact: `--space-*`, `--card-pad*`, `--card-radius*`, `--card-border`. Fix wrong fallbacks (analytics.js:82, league-detail 1953, my-team 661). Normalize the three dashboard-card border alphas to 0.2.
- **Type-scale floor:** bump sub-11px label/caption text to `--text-micro`. **Needs judgment** in dense tables/boards (worst: live-analytics 0.42rem, Big Board, power-rankings, trade panels).

### Wave 4 — Low nits
- Remove dead code (`goldBadge` league-detail:171, display:none legacy blocks).
- WR.* primitive migrations (opportunistic, gated on bundle availability).
- Static HTML palette consolidation (one silver `#BDB8AD`, one black, Rajdhani/DM Sans across landing/login/onboarding/gift/reset/admin) + drop `user-scalable=no` on the three draft/FA/trade shells.
- Off-canon breakpoint cleanup where no layout impact (1180→1024, 980→1024, 520/440 phone standardization).
- Tokenize one-off paddings/radii with no exact match (advisory, round-to-nearest with review).

## 5. Risks

The codebase passed a **prior desktop zero-scroll audit**, so several fixes can regress carefully-tuned layouts and **must** be verified via the Playwright browser-QA suite at iPad viewports (portrait 768/810/820/834/1024; landscape 1024/1080/1180/1194/1366; phone floor 390):

- **Type-scale floor bumps** are the highest regression risk: raising every sub-11px value reflows dense tables (Big Board 2422, my-team roster, live-analytics panels, power-rankings tiles). Scope to labels/chips, retest density.
- **Touch-target 44px in fixed-height tiles:** `player-tags.js` lg tile (6 rows × 44px overflows the 320px no-scroll tile), `power-rankings`/`competitive-tiers` compact headers, `roster-pulse` xxl mini-roster — a naive 44px breaks these; use hit-padding only.
- **Spacing/radius normalization:** mapping `6px` gap→`--space-sm` (8px), `8px`/`12px`/`14px`→`--card-radius`(10), or `2px`/`0.3` borders→`--card-border` are *visible* changes, not no-ops — verify hero cards (product-card 521, trophy cardStyle 169, auth `.login-container`) still read as intended.
- **Breakpoint moves (760/767→1024):** the Empire 1180 tier and free-agency non-monotonic 768 rule interact; moving the stack point can conflict with the intermediate tier — verify 768-1023 renders the intended single/2-column at each iPad width and that nothing that *did* fit at desktop now wraps.
- **MobileFeed→isTablet routing (Wave 1):** the `isTablet` draft branch and live-sync header (4123/4170) currently only render at 1024+; routing 768-834 there may surface the header flex-wrap at narrow widths — verify the full draft cockpit at all iPad portrait widths before shipping.
- **Color near-match swaps:** any accidental swap of `#3498DB`/`#7C6BF8`/`#34D399`/`#C0C0C0`/`#D0D0D0` to a token changes the rendered color — these are the false-positive traps; keep them literal or introduce new tokens.

Key files driving implementation: `index.html` (`:root` tokens, `.wr-module-nav`, sidebar/nav media queries, Flash Brief @760), `js/draft/styles.js` (`bpBucket`, breakpoints, `panelCard`), `js/draft/command-center.js` (CC grid, Empire, StagedOfferRow, panel mounts), `js/league-detail.js` (Big Board, All-Time tables, sidebar), `js/my-team.js`, `js/free-agency.js`, `js/components/wr-primitives.js` + `components.js` + `player-card.js` (shared primitives), the trade/mock/strategy/calendar/saved-views modules, the dashboard widgets, and the standalone HTML pages (landing/login/onboarding/gift/reset/admin/draft-warroom/free-agency/trade-calculator).
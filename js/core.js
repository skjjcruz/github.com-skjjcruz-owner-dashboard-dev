// ══════════════════════════════════════════════════════════════════
// core.js — Tier system, access control, fetch helpers
// Must load FIRST — all other modules depend on these.
// ══════════════════════════════════════════════════════════════════
//
// ── WINDOW GLOBAL CONTRACT ────────────────────────────────────────
// Cross-module communication goes through window.*. All contracts
// are listed here so load-order bugs and implicit deps are visible.
// DO NOT add new globals without updating this block.
//
// window.App  (object)
//   Set by:  ReconAI CDN (dhq-engine.js) before any War Room script loads.
//   Extended by: core.js (this file) with War Room constants.
//   Required: yes — app fails silently if missing.
//   Key fields:
//     .LI              — League Intel: { playerScores, playerMeta, playerTrends,
//                        playerPeaks, championships, dhqPickValueFn }
//     .LI_LOADED       — boolean; true once loadLeagueIntel() resolves
//     .loadLeagueIntel()— async fn; fetches and populates .LI
//     .calcOptimalPPG(roster, scoring) — from ReconAI
//     .peakWindows     — { QB:[lo,hi], RB:[lo,hi], … } — set by ReconAI CDN;
//                        core.js provides fallback default via PEAK_WINDOWS_DEFAULT
//     .POS_COLORS      — { QB:'#E74C3C', … }  (set by core.js)
//     .POS_GROUPS      — { DB:[…], DL:[…], LB:[…] }  (set by core.js)
//     .PEAK_WINDOWS_DEFAULT — frozen copy of fallback values  (set by core.js)
//     .normPos(pos)    — canonical position normalizer  (set by core.js)
//     .calcRawPts(stats, scoring) — fantasy pts calculation  (set by core.js)
//     .calcPPG(stats, scoring)    — pts/game  (set by core.js)
//     .WR_KEYS         — localStorage key registry  (set by core.js)
//     .WrStorage       — localStorage/sessionStorage abstraction  (set by core.js)
//
// window.S  (object)
//   Set by:  ReconAI CDN; mutated by league-detail.js inside useEffect.
//   Required: no — War Room degrades gracefully if absent.
//   Key fields (written by league-detail.js):
//     .season          — active year string e.g. '2025'
//     .playerStats     — { [pid]: { prevTotal, prevAvg, prevRawStats } }
//     ._timeContextTs  — Date.now() of last stats sync
//   Key fields (read from ReconAI):
//     .rosters         — all league rosters array
//     .myRosterId      — current user's roster_id
//     .leagues         — array of league objects (used for scoring_settings)
//     .tradedPicks     — traded picks array
//     .apiKey          — AI provider API key
//     .aiProvider      — 'gemini' | 'anthropic'
//
// window.OD  (object)
//   Set by:  ReconAI CDN (supabase-client.js).
//   Required: no — features degrade; cloud sync is disabled when absent.
//   Key methods (all async, all optional-chained before calling):
//     .loadDisplayName() → string | null
//     .saveDisplayName(name)
//     .loadTargets(leagueId) → { targets, startingBudget }
//     .loadPlayerTags(leagueId) → { [pid]: tag }
//     .checkUsersAccess(usernames[]) → Set<string>
//     .createGiftUser({ … })
//     .verifySupabasePassword(username, pw)
//     .updatePassword(username, pw)
//
// window.wrLog(context, err)
//   Set by:  core.js (this file).
//   Required: no — all callers guard with window.wrLog?.()
//   Purpose:  unified error logger; swap body here to route to a reporting svc.
//
// window._wrSelectPlayer(pid)
//   Set by:  league-detail.js (resets on every render of LeagueDetail).
//   Read by: components, ReconAI card, any cross-tab "open player" action.
//   Risk:    stale closure if held across renders — always call at event time.
//
// window._wrGmStrategy  (object)
//   Set by:  league-detail.js when GM strategy changes.
//   Read by: ReconAI AI context builder for personalised responses.
//
// window._playerTags  (object)
//   Set by:  league-detail.js after OD.loadPlayerTags resolves.
//   Read by: player card rendering throughout the app.
//
// window._liLoading  (boolean)
//   Set by:  league-detail.js to prevent duplicate loadLeagueIntel() calls.
//
// ── ReconAI bridge functions (set by CDN scripts, optional) ──────
// window.assessTeamFromGlobal(rosterId) → assessment | null
// window.assessAllTeamsFromGlobal()     → assessment[]
// window.dynastyValue(pid, age, pos, stats, scoring, peakWindows) → number
// window.getPlayerAction(pid)           → { label, color }
// window.Sleeper.fetchTrending(type, hours, limit) → async array
// window.DraftHistory.syncDraftDNA(leagueId)       → async Map
// window.DraftHistory.loadDraftDNA(leagueId)        → Map (sync, cached)
// ─────────────────────────────────────────────────────────────────
const { useState, useEffect, useMemo, useRef, useCallback } = React;

    // ─── Error Logger ──────────────────────────────────────────────────────────
    // Thin wrapper so failures show up in the console with a consistent prefix.
    // Replace the body here to route to an error reporting service in the future.
    function wrLog(context, err) {
        if (typeof console !== 'undefined') console.warn('[WarRoom]', context, err);
    }
    window.wrLog = wrLog; // expose for cross-module access

    // ── Field Log Writer ───────────────────────────────────────────────────
    // Mirrors Scout's addFieldLogEntry format so both apps write to the same
    // localStorage key and Supabase table. Only logs deliberate user decisions.
    var _wrFlKey = 'scout_field_log_v1';
    function wrLogAction(icon, text, category, meta) {
        try {
            var entry = {
                id: 'wrfl_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
                icon: icon || '📋',
                text: text || '',
                category: category || 'note',
                ts: Date.now(),
                syncStatus: 'pending',
                source: 'warroom',
                players: meta?.players || [],
                context: meta?.context || null,
                leagueId: meta?.leagueId || window.S?.currentLeagueId || null,
                actionType: meta?.actionType || null,
            };
            // Append to localStorage
            var raw = localStorage.getItem(_wrFlKey);
            var log = raw ? JSON.parse(raw) : [];
            log.unshift(entry);
            // Keep max 200 entries locally
            if (log.length > 200) log.length = 200;
            localStorage.setItem(_wrFlKey, JSON.stringify(log));
            // Async sync to Supabase (fire-and-forget)
            if (window.OD?.saveFieldLogEntry) {
                window.OD.saveFieldLogEntry(entry).catch(function(e) { wrLog('wrLogAction.sync', e); });
            }
        } catch (e) { wrLog('wrLogAction', e); }
    }
    window.wrLogAction = wrLogAction;
    // ──────────────────────────────────────────────────────────────────────────

    // ===== PRODUCT TIER SYSTEM =====
    // Tiers: free → scout → warroom ($9.99) → pro ($12.99) → commissioner ($14.99)
    //
    // Delegates to shared/tier.js (window.getTier) for canonical paid/free detection,
    // then resolves War Room's granular level from the profile tier field.
    // Falls back to local logic if shared/tier.js failed to load.
    function getUserTier() {
        // shared/tier.js returns 'free' | 'trial' | 'paid'
        const sharedTier = typeof window.getTier === 'function' ? window.getTier() : null;

        if (sharedTier === 'paid') {
            // Shared confirms paid — resolve the specific War Room level from profile
            try {
                const p = JSON.parse(localStorage.getItem(window.STORAGE_KEYS?.OD_PROFILE || 'od_profile_v1') || '{}');
                if (p.tier === 'commissioner') return 'commissioner';
                if (p.tier === 'pro' || p.tier === 'power') return 'pro';
                if (p.tier === 'warroom') return 'warroom';
                if (p.tier === 'scout' || p.tier === 'reconai') return 'scout';
            } catch(e) { wrLog('getUserTier.parse', e); }
            // Dev mode returns 'paid' from shared — give full local access
            if (new URLSearchParams(window.location.search).has('dev') || ['localhost', '127.0.0.1'].includes(window.location.hostname)) return 'pro';
            return 'scout'; // paid but unrecognized profile tier → minimum paid level
        }

        // Trial users get free-tier access in War Room (no trial concept here)
        if (sharedTier === 'trial') return 'free';

        // Fallback: shared/tier.js not loaded — use local logic directly
        if (sharedTier === null) {
            try {
                const p = JSON.parse(localStorage.getItem('od_profile_v1') || '{}');
                if (p.tier === 'commissioner') return 'commissioner';
                if (p.tier === 'pro' || p.tier === 'power') return 'pro';
                if (p.tier === 'warroom') return 'warroom';
                if (p.tier === 'scout' || p.tier === 'reconai') return 'scout';
            } catch(e) { wrLog('getUserTier.parse', e); }
            if (new URLSearchParams(window.location.search).has('dev') || ['localhost', '127.0.0.1'].includes(window.location.hostname)) return 'pro';
        }

        return 'free';
    }

    const WR_FEATURES = new Set(['trade-finder', 'deal-analyzer', 'owner-dna', 'league-map', 'command-view', 'projections',
        'fa-decision-engine', 'big-board', 'draft-simulation', 'analytics-full', 'intelligence-full']);
    const PRO_FEATURES = new Set(['global-dashboard', 'cross-league-ai', 'unified-trophy-room', 'synced-calendar',
        'premium-reporting', 'season-recap', 'enhanced-ai', 'player-exposure']);

    const TIER_FEATURES = {
        free: new Set(['my-roster-basic', 'player-cards-basic', 'team-diagnosis-basic', 'ai-1-per-day', 'draft-rankings']),
        scout: new Set(['my-roster-basic', 'player-cards-basic', 'team-diagnosis-basic', 'ai-1-per-day', 'draft-rankings',
            'ai-unlimited', 'player-cards-full', 'team-diagnosis-full', 'waiver-targets', 'trade-quick-check']),
        warroom: new Set([...new Set(['my-roster-basic', 'player-cards-basic', 'team-diagnosis-basic', 'ai-1-per-day', 'draft-rankings',
            'ai-unlimited', 'player-cards-full', 'team-diagnosis-full', 'waiver-targets', 'trade-quick-check']),
            ...WR_FEATURES]),
        pro: new Set([...new Set(['my-roster-basic', 'player-cards-basic', 'team-diagnosis-basic', 'ai-1-per-day', 'draft-rankings',
            'ai-unlimited', 'player-cards-full', 'team-diagnosis-full', 'waiver-targets', 'trade-quick-check']),
            ...WR_FEATURES, ...PRO_FEATURES]),
        commissioner: new Set([...new Set(['my-roster-basic', 'player-cards-basic', 'team-diagnosis-basic', 'ai-1-per-day', 'draft-rankings',
            'ai-unlimited', 'player-cards-full', 'team-diagnosis-full', 'waiver-targets', 'trade-quick-check']),
            ...WR_FEATURES, ...PRO_FEATURES,
            'league-chronicles', 'rule-simulator', 'trade-auditor', 'league-health', 'opus-analysis']),
    };

    // Save shared canAccess reference (from shared/tier.js) before War Room overlay.
    // NOTE: window.canAccess is unreliable here — core.js's own `function canAccess`
    // declaration hoists and overwrites window.canAccess before this line executes.
    // index.html captures the shared ref into window._sharedCanAccess between
    // tier.js and core.js (inline <script>), which runs before Babel compiles core.js.
    const _sharedCanAccess = window._sharedCanAccess || null;

    function canAccess(feature) {
        // War Room's granular feature matrix is the primary gate
        const tier = getUserTier();
        if (TIER_FEATURES[tier]?.has(feature)) return true;
        // Fall back to shared tier.js canAccess for features not in War Room's matrix
        // (covers shared FEATURES enum values used by ReconAI modules)
        return _sharedCanAccess ? _sharedCanAccess(feature) : false;
    }

    function isPro() { const t = getUserTier(); return t === 'pro' || t === 'commissioner'; }
    function isCommissioner() { return getUserTier() === 'commissioner'; }
    window.isPro = isPro;
    window.isCommissioner = isCommissioner;

    // One-time taste tracking
    function useTaste() {
        if (WrStorage.get(WR_KEYS.TASTE_USED)) return false;
        WrStorage.set(WR_KEYS.TASTE_USED, '1');
        return true; // first time = allow
    }
    function hasTasteLeft() { return !WrStorage.get(WR_KEYS.TASTE_USED); }

    // AI daily limit for scout tier
    function canUseAI() {
        // If server AI is available (authenticated user), let the Edge Function handle rate limiting
        if (typeof hasServerAI === 'function' && hasServerAI()) return true;
        const tier = getUserTier();
        if (tier !== 'scout') return true;
        const key = WR_KEYS.AI_DAILY(new Date().toISOString().split('T')[0]);
        return parseInt(WrStorage.get(key, '0')) < 1;
    }
    function trackAIUse() {
        const key = WR_KEYS.AI_DAILY(new Date().toISOString().split('T')[0]);
        const count = parseInt(WrStorage.get(key, '0'));
        WrStorage.set(key, String(count + 1));
    }


    function handleLogout() {
        if (confirm('Are you sure you want to logout?')) {
            localStorage.removeItem((window.STORAGE_KEYS?.OD_AUTH    || 'od_auth_v1'));
            localStorage.removeItem((window.STORAGE_KEYS?.FW_SESSION || 'fw_session_v1'));
            window.location.href = 'landing.html';
        }
    }


    // ===== SLEEPER API =====
    // ── Shared platform connectors (HIGH #10) ─────────────────────────────────
    // The following shared connectors are available via CDN (loaded in index.html):
    //   window.Sleeper — shared/sleeper-api.js  (preferred for new Sleeper features)
    //   window.ESPN    — shared/espn-api.js     (ESPN league support)
    //   window.MFL     — shared/mfl-api.js      (MFL league support)
    //   window.Yahoo   — shared/yahoo-api.js    (Yahoo league support)
    // War Room's local Sleeper fetchers below are kept as a stable fallback.
    // Multi-platform support for new features should use the shared connectors.
    // ─────────────────────────────────────────────────────────────────────────
    const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

    async function fetchJSON(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
    }

    async function fetchSleeperUser(username) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/user/${encodeURIComponent(username)}`);
    }

    async function fetchUserLeagues(userId, season) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/user/${userId}/leagues/nfl/${season}`);
    }

    async function fetchLeagueRosters(leagueId) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/league/${leagueId}/rosters`);
    }

    async function fetchLeagueUsers(leagueId) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/league/${leagueId}/users`);
    }

    async function fetchLeagueInfo(leagueId) {
        return await fetchJSON(`${SLEEPER_BASE_URL}/league/${leagueId}`);
    }

    let _wrPlayersCache = null;
    async function fetchAllPlayers() {
        if (_wrPlayersCache) return _wrPlayersCache;
        // Check sessionStorage first (avoid re-fetching 10k players on every load)
        const cached = WrStorage.getSession(WR_KEYS.PLAYERS_CACHE);
        // 12-hour TTL — player data barely changes during a session. The old 1-hour
        // TTL caused unnecessary 10k-player refetches on league switches.
        if (cached && Date.now() - cached.ts < 43200000) { _wrPlayersCache = cached.data; return cached.data; }
        _wrPlayersCache = await fetchJSON(`${SLEEPER_BASE_URL}/players/nfl`);
        WrStorage.setSession(WR_KEYS.PLAYERS_CACHE, { data: _wrPlayersCache, ts: Date.now() });
        return _wrPlayersCache;
    }

    // ─── Shared Constants ──────────────────────────────────────────────────────
    // window.App is populated by ReconAI CDN scripts before this file loads.
    // We extend it here with War Room constants all tabs need in one place.
    window.App = window.App || {};

    // Position colors — single source of truth (was copy-pasted across 6 locations)
    window.App.POS_COLORS = window.App.POS_COLORS || {
        QB:'#E74C3C', RB:'#2ECC71', WR:'#3498DB', TE:'#F0A500',
        K:'#9B59B6',  DL:'#E67E22', LB:'#1ABC9C', DB:'#E91E63'
    };

    // Position groups — canonical arrays for normPos (was inline in 20+ locations)
    window.App.POS_GROUPS = window.App.POS_GROUPS || {
        DB: ['DB','CB','S','SS','FS'],
        DL: ['DL','DE','DT','NT','IDL','EDGE'],
        LB: ['LB','OLB','ILB','MLB'],
    };

    // Age curves default - fallback only; shared/constants.js is the primary source.
    window.App.AGE_CURVE_WINDOWS_DEFAULT = window.App.AGE_CURVE_WINDOWS_DEFAULT || {
        QB:{build:[23,27],peak:[28,34],decline:[35,38]},
        RB:{build:[21,22],peak:[23,25],decline:[26,28]},
        WR:{build:[22,24],peak:[25,28],decline:[29,31]},
        TE:{build:[23,25],peak:[26,29],decline:[30,32]},
        DL:{build:[22,24],peak:[25,29],decline:[30,32]},
        EDGE:{build:[22,24],peak:[25,29],decline:[30,32]},
        LB:{build:[22,23],peak:[24,28],decline:[29,31]},
        DB:{build:[21,23],peak:[24,27],decline:[28,30]},
        K:{build:[23,27],peak:[28,35],decline:[36,40]},
    };
    window.App.ageCurveWindows = window.App.ageCurveWindows || window.App.AGE_CURVE_WINDOWS_DEFAULT;

    // Peak windows default - elite portion of the curve.
    window.App.PEAK_WINDOWS_DEFAULT = window.App.PEAK_WINDOWS_DEFAULT || {
        QB:[28,34], RB:[23,25], WR:[25,28], TE:[26,29],
        DL:[25,29], EDGE:[25,29], LB:[24,28], DB:[24,27], K:[28,35]
    };
    // Set only if ReconAI CDN hasn't provided them
    window.App.peakWindows = window.App.peakWindows || window.App.PEAK_WINDOWS_DEFAULT;
    window.App.getAgeCurve = window.App.getAgeCurve || function getAgeCurve(pos) {
        const p = pos === 'DE' || pos === 'DT' || pos === 'NT' || pos === 'EDGE' ? 'DL'
            : pos === 'CB' || pos === 'S' || pos === 'SS' || pos === 'FS' ? 'DB'
            : pos === 'OLB' || pos === 'ILB' || pos === 'MLB' ? 'LB'
            : pos;
        return window.App.ageCurveWindows?.[p] || { build: [22, 24], peak: window.App.peakWindows?.[p] || [24, 29], decline: [30, 32] };
    };
    window.App.getValueWindowEnd = window.App.getValueWindowEnd || function getValueWindowEnd(pos) {
        return window.App.getAgeCurve(pos).decline[1];
    };

    // tradeValueTier — player value bracket label/color (owned by reconai/shared/constants.js)
    // Fallback with CDN-matching thresholds in case constants.js hasn't loaded yet.
    window.App.tradeValueTier = window.App.tradeValueTier || function(val) {
        if (val >= 7000) return { tier: 'Elite',   col: 'var(--green)' };
        if (val >= 4000) return { tier: 'Starter',  col: 'var(--accent)' };
        if (val >= 2000) return { tier: 'Depth',    col: 'var(--text2)' };
        if (val > 0)     return { tier: 'Stash',    col: 'var(--text3)' };
        return { tier: '—', col: 'var(--text3)' };
    };
    window.tradeValueTier = window.App.tradeValueTier;

    // normPos — canonical position normalizer (was identical in draft-room, free-agency, trade-calc)
    window.App.normPos = window.App.normPos || function normPos(pos) {
        if (!pos) return null;
        for (const [canonical, variants] of Object.entries(window.App.POS_GROUPS)) {
            if (variants.includes(pos)) return canonical;
        }
        return pos;
    };

    // calcPosGrades — league-relative position group grades
    // Sums DHQ per position for every team, ranks, and assigns A-F.
    // Returns [{ pos, rank, totalTeams, mySum, grade, col, pct }]
    window.App.calcPosGrades = window.App.calcPosGrades || function calcPosGrades(myRosterId, rosters, playersData) {
        const scores = window.App?.LI?.playerScores || {};
        const normPos = window.App.normPos || (p => p);
        const posOrder = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
        const totalTeams = (rosters || []).length || 1;
        return posOrder.map(pos => {
            const byTeam = (rosters || []).map(r => {
                const sum = (r.players || []).reduce((s, pid) => {
                    const p = playersData?.[pid];
                    if (p && normPos(p.position) === pos) return s + (scores[pid] || 0);
                    return s;
                }, 0);
                return { rosterId: r.roster_id, sum };
            }).sort((a, b) => b.sum - a.sum);
            const mySum = byTeam.find(t => t.rosterId === myRosterId)?.sum || 0;
            const rank = byTeam.findIndex(t => t.rosterId === myRosterId) + 1;
            let grade, col;
            const pct = totalTeams > 1 ? Math.round((1 - (rank - 1) / totalTeams) * 100) : 50;
            if (rank <= Math.ceil(totalTeams * 0.2)) { grade = 'A'; col = '#2ECC71'; }
            else if (rank <= Math.ceil(totalTeams * 0.4)) { grade = 'B'; col = '#D4AF37'; }
            else if (rank <= Math.ceil(totalTeams * 0.6)) { grade = 'C'; col = '#F0A500'; }
            else if (rank <= Math.ceil(totalTeams * 0.8)) { grade = 'D'; col = '#F0A500'; }
            else { grade = 'F'; col = '#E74C3C'; }
            return { pos, rank, totalTeams, mySum, grade, col, pct };
        });
    };

    // calcRawPts — fantasy points from stats + scoring settings
    // (replaces diverging implementations in trade-calc, free-agency, league-detail, components)
    window.App.calcRawPts = window.App.calcRawPts || function calcRawPts(stats, scoring) {
        if (!stats) return null;
        if (scoring) {
            let total = 0;
            for (const [field, weight] of Object.entries(scoring)) {
                if (typeof weight !== 'number') continue;
                if (stats[field] != null) total += Number(stats[field]) * weight;
            }
            return total;
        }
        const pre = stats.pts_half_ppr ?? stats.pts_ppr ?? stats.pts_std ?? null;
        return pre !== null ? Number(pre) : null;
    };

    // calcPPG — points per game, derived from calcRawPts
    window.App.calcPPG = window.App.calcPPG || function calcPPG(stats, scoring) {
        const raw = window.App.calcRawPts(stats, scoring);
        if (raw === null) return 0;
        const gp = stats?.gp || 0;
        return gp > 0 ? Math.max(0, raw / gp) : 0;
    };

    // ─── Storage Keys & Abstraction ───────────────────────────────────────────
    // Centralised registry of all War Room-owned localStorage/sessionStorage keys.
    // od_ / dhq_ / dynastyhq_ prefixed keys are ReconAI-owned — access them directly.
    const WR_KEYS = {
        // User preferences
        TASTE_USED:       'wr_taste_used',
        AI_DAILY:         (date) => `wr_ai_daily_${date}`,
        ALEX_AVATAR:      'wr_alex_avatar',
        // League navigation
        LAST_LEAGUE_ID:   'wr_last_league_id',
        LAST_LEAGUE_NAME: 'wr_last_league_name',
        DEMO_MODE:        'wr_demo_mode',
        // League-level state
        TIME_YEAR:        'wr_time_year',
        ROSTER_COLS:      'wr_roster_cols',
        KPI_SELECTION:    (leagueId) => `wr_kpi_selection_${leagueId}`,
        GM_STRATEGY:      (leagueId) => `wr_gm_strategy_${leagueId}`,
        CHAT:             (leagueId) => `wr_chat_${leagueId}`,
        SAVED_TRADES:     (leagueId) => `wr_saved_trades_${leagueId}`,
        WELCOMED:         (leagueId) => `wr_welcomed_v2_${leagueId}`,
        // Draft
        BIGBOARD:         (leagueId) => `wr_bigboard_${leagueId}`,
        // Session cache (sessionStorage, not localStorage)
        PLAYERS_CACHE:    'fw_players_cache',
        // SOS engine caches (sessionStorage, 24hr TTL — managed by sos-engine.js)
        SOS_DEF_CACHE:   (season) => `wr_sos_def_${season}`,
        SOS_SCHED_CACHE: (season) => `wr_sos_sch_${season}`,
        SOS_WEEK_CACHE:  (season, week) => `wr_sos_wk_${season}_${week}`,
    };

    // WrStorage — thin wrappers that handle JSON serialisation and call wrLog on errors.
    // All War Room localStorage reads/writes should go through here.
    const WrStorage = {
        get(key, fallback = null) {
            try {
                const v = localStorage.getItem(key);
                if (v === null) return fallback;
                try { return JSON.parse(v); } catch { return v; } // raw string if not JSON
            } catch(e) { wrLog('storage.get:' + key, e); return fallback; }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            } catch(e) { wrLog('storage.set:' + key, e); }
        },
        remove(key) {
            try { localStorage.removeItem(key); } catch(e) { wrLog('storage.remove:' + key, e); }
        },
        getSession(key, fallback = null) {
            try {
                const v = sessionStorage.getItem(key);
                if (v === null) return fallback;
                try { return JSON.parse(v); } catch { return v; }
            } catch(e) { wrLog('storage.getSession:' + key, e); return fallback; }
        },
        setSession(key, value) {
            try {
                sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
            } catch(e) {
                if (e.name === 'QuotaExceededError') {
                    try { sessionStorage.clear(); sessionStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value)); } catch(e2) { /* give up silently */ }
                } else { wrLog('storage.setSession:' + key, e); }
            }
        },
        removeSession(key) {
            try { sessionStorage.removeItem(key); } catch(e) { wrLog('storage.removeSession:' + key, e); }
        },
    };

    window.App.WR_KEYS  = WR_KEYS;
    window.App.WrStorage = WrStorage;
    window.App.fetchAllPlayers = fetchAllPlayers;

    // ── Normalize traded picks: owner_id can be roster_id OR user_id ─
    // Sleeper's /traded_picks API is ambiguous — detect which type and
    // convert to roster_id so all downstream code can compare safely.
    window.App.normalizeTradedPicks = function normalizeTradedPicks(rosters, tps) {
      if (!tps?.length || !rosters?.length) return tps || [];
      const rosterIds = new Set(rosters.map(r => String(r.roster_id)));
      const userIds   = new Set(rosters.map(r => String(r.owner_id)));
      let rH = 0, uH = 0;
      for (const tp of tps) { const o = String(tp.owner_id ?? ''); if (rosterIds.has(o)) rH++; if (userIds.has(o)) uH++; }
      if (rH >= uH) return tps;
      const u2r = {}; for (const r of rosters) u2r[String(r.owner_id)] = String(r.roster_id);
      return tps.map(tp => { const rid = u2r[String(tp.owner_id ?? '')]; return rid ? { ...tp, owner_id: rid } : tp; });
    };
    // ──────────────────────────────────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────────────────

    const STATS_YEAR = '2025'; // Most recent completed season — used until Sleeper publishes projections

    let _wrStatsCache = {};
    async function fetchSeasonStats(season) {
        if (_wrStatsCache[season]) return _wrStatsCache[season];
        try {
            _wrStatsCache[season] = await fetchJSON(`${SLEEPER_BASE_URL}/stats/nfl/regular/${season}`);
        } catch (e) {
            console.warn('Stats fetch failed:', e);
            _wrStatsCache[season] = {};
        }
        return _wrStatsCache[season];
    }

    let _projectionsCache = {};
    async function fetchSeasonProjections(season) {
        if (_projectionsCache[season]) return _projectionsCache[season];
        try {
            _projectionsCache[season] = await fetchJSON(`${SLEEPER_BASE_URL}/projections/nfl/regular/${season}`);
        } catch (e) {
            console.warn('Projections fetch failed:', e);
            _projectionsCache[season] = {};
        }
        return _projectionsCache[season];
    }

    // ── SeasonContext ────────────────────────────────────────────────────────
    // Reactive bridge between league-detail.js and tab components.
    // Provides: season, playerStats, tradedPicks, rosters, myRosterId, lastUpdated, selectPlayer
    // write-through: window.S remains intact for ReconAI CDN bridge compatibility.
    window.App.SeasonContext = React.createContext(null);

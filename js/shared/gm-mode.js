// ══════════════════════════════════════════════════════════════════
// gm-mode.js — Canonical GM Mode system (Phase 1)
//
// Three first-class presets: Rebuild / Compete / Win Now. Selecting a preset
// auto-bundles every downstream variable (aggression, draftStyle,
// marketPosture, timeline, personality). Custom mode unlocks individual
// sliders in the Strategy Editor.
//
// This module is the single source of truth for mode. It:
//   - Normalizes legacy mode labels from both my-team.js and strategy-editor.js
//   - Bundles preset configurations
//   - Persists to BOTH the GMStrategy CDN store AND the local WrStorage key
//     so existing consumers (my-team panel, strategy editor) both see it
//   - Exposes a descriptor consumable by engines (Alex prompts, trade
//     proposer, CPU draft) via window.WR.GmMode.describe(mode)
//
// Exposes: window.WR.GmMode
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const WR_KEYS = window.App && window.App.WR_KEYS;
    const WrStorage = window.App && window.App.WrStorage;

    // ── Canonical presets ─────────────────────────────────────────
    const PRESETS = {
        rebuild: {
            id: 'rebuild',
            label: 'Rebuild',
            badgeColor: '#3498DB',
            tagline: 'Youth, picks, and patience. Tear it down to build the next dynasty.',
            config: {
                aggression: 'conservative',
                draftStyle: 'accumulate',
                marketPosture: 'sell_high',
                timeline: 'dynasty_long',
                alexPersonality: 'value_hunter',
                targetPositions: [],
                sellPositions: [],
            },
            prompt: 'You are in REBUILD mode: prioritize youth, accumulate picks, sell aging veterans for picks and 24-and-under assets. Decline short-term win-now trades. Push back on panic moves.',
            tradeWeights: { futureYearBias: 1.35, vetPenalty: 0.75, ageCutoff: 27 },
            draftWeights: { bpaBias: 0.85, youthPremium: 1.2, needBias: 0.7 },
        },
        compete: {
            id: 'compete',
            label: 'Compete',
            badgeColor: '#D4AF37',
            tagline: 'Build for long-term success while staying competitive.',
            config: {
                aggression: 'medium',
                draftStyle: 'bpa',
                marketPosture: 'hold',
                timeline: '2_3_years',
                alexPersonality: 'balanced',
                targetPositions: [],
                sellPositions: [],
            },
            prompt: 'You are in COMPETE mode: balance present and future. Prioritize players ages 24-27 with 3+ peak years left. Trade aging assets only at peak value. Take the best player available in drafts.',
            tradeWeights: { futureYearBias: 1.0, vetPenalty: 1.0, ageCutoff: 30 },
            draftWeights: { bpaBias: 1.0, youthPremium: 1.0, needBias: 1.0 },
        },
        win_now: {
            id: 'win_now',
            label: 'Win Now',
            badgeColor: '#E74C3C',
            tagline: 'Championship window is open. Spend everything to win this year.',
            config: {
                aggression: 'aggressive',
                draftStyle: 'consolidate',
                marketPosture: 'buy_low',
                timeline: '1_year',
                alexPersonality: 'aggressive',
                targetPositions: [],
                sellPositions: [],
            },
            prompt: 'You are in WIN NOW mode: trade away future picks and young depth for proven starters. Target immediate upgrades. Accept short-term wins over long-term balance. Push aggressive trades that move the needle in the next 1-2 years.',
            tradeWeights: { futureYearBias: 0.65, vetPenalty: 1.35, ageCutoff: 32 },
            draftWeights: { bpaBias: 0.8, youthPremium: 0.6, needBias: 1.3 },
        },
        custom: {
            id: 'custom',
            label: 'Custom',
            badgeColor: '#7C6BF8',
            tagline: 'Hand-tuned — every variable set manually.',
            config: null, // caller keeps existing settings
            prompt: 'You are running a CUSTOM strategy — follow the user-defined aggression, draft style, market posture, and timeline as configured.',
            tradeWeights: { futureYearBias: 1.0, vetPenalty: 1.0, ageCutoff: 30 },
            draftWeights: { bpaBias: 1.0, youthPremium: 1.0, needBias: 1.0 },
        },
    };

    // Map legacy mode strings from existing stores to canonical ids.
    const LEGACY_MAP = {
        'rebuild':           'rebuild',
        'balanced_rebuild':  'rebuild',
        'retool':            'compete',
        'balanced':          'compete',
        'compete':           'compete',
        'contend':           'win_now',
        'win_now':           'win_now',
        'custom':            'custom',
    };

    function normalize(mode) {
        return LEGACY_MAP[mode] || 'compete';
    }

    function getMode(leagueId) {
        // Priority: strategy-editor CDN store → my-team store (WrStorage GM_STRATEGY) → default
        try {
            if (window.GMStrategy && typeof window.GMStrategy.getStrategy === 'function') {
                const s = window.GMStrategy.getStrategy(leagueId);
                if (s && s.mode) return normalize(s.mode);
            }
        } catch (e) { /* ignore */ }
        try {
            if (WrStorage && WR_KEYS && typeof WR_KEYS.GM_STRATEGY === 'function') {
                const s = WrStorage.get(WR_KEYS.GM_STRATEGY(leagueId));
                if (s && s.mode) return normalize(s.mode);
            }
        } catch (e) { /* ignore */ }
        return 'compete';
    }

    function describe(mode) {
        const id = normalize(mode);
        const preset = PRESETS[id] || PRESETS.compete;
        return {
            id,
            label: preset.label,
            badgeColor: preset.badgeColor,
            tagline: preset.tagline,
            prompt: preset.prompt,
            tradeWeights: preset.tradeWeights,
            draftWeights: preset.draftWeights,
        };
    }

    function getPreset(mode) {
        return PRESETS[normalize(mode)] || PRESETS.compete;
    }

    // Apply a preset to the canonical strategy object. Persists to both stores.
    function applyPreset(leagueId, mode, extras) {
        const preset = getPreset(mode);
        // Merge preset.config into the existing strategy so user's custom fields
        // (untouchable, sellRules, targetPositions/sellPositions if set) survive.
        let existing = {};
        try {
            if (window.GMStrategy && typeof window.GMStrategy.getStrategy === 'function') {
                existing = window.GMStrategy.getStrategy(leagueId) || {};
            }
        } catch (e) { /* ignore */ }
        const merged = {
            ...existing,
            ...(preset.config || {}),
            ...(extras || {}),
            mode: preset.id,
            lastSyncedFrom: 'warroom',
            leagueId,
        };
        // Persist — best-effort, swallow errors
        try {
            if (window.GMStrategy && typeof window.GMStrategy.saveStrategy === 'function') {
                window.GMStrategy.saveStrategy(merged);
            }
        } catch (e) { /* ignore */ }
        try {
            if (WrStorage && WR_KEYS && typeof WR_KEYS.GM_STRATEGY === 'function') {
                WrStorage.set(WR_KEYS.GM_STRATEGY(leagueId), merged);
            }
        } catch (e) { /* ignore */ }
        window._wrGmStrategy = merged;
        window.dispatchEvent(new CustomEvent('wr:gm-mode-changed', { detail: { mode: preset.id, strategy: merged } }));
        return merged;
    }

    // Subscribe convenience: returns unsubscribe fn
    function onChange(fn) {
        const h = (e) => fn(e.detail);
        window.addEventListener('wr:gm-mode-changed', h);
        return () => window.removeEventListener('wr:gm-mode-changed', h);
    }

    window.WR = window.WR || {};
    window.WR.GmMode = {
        PRESETS,
        normalize,
        getMode,
        getPreset,
        describe,
        applyPreset,
        onChange,
        // List of mode ids excluding custom — for the preset picker
        list: () => ['rebuild', 'compete', 'win_now'],
    };
})();

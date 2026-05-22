// ══════════════════════════════════════════════════════════════════
// js/shared/alex-settings.js — WR.AlexSettings
//
// Single source of truth for Alex's behavioral-insight tuning. Written
// by the Alex Insights Model Settings sub-tab. Read by every surface
// that surfaces an Alex voice (Alex Insights Overview, Alex drawer,
// Flash Brief, Transaction Ticker, dashboard widgets).
//
// Consumers should go through this module rather than reading the raw
// localStorage key so cross-surface filtering stays consistent. A
// `wr:alex-settings-changed` event fires on every save so live
// surfaces can re-render without refresh.
//
// Schema (localStorage key: wr_alex_settings):
//   alertThreshold:    0-100  minimum confidence % to surface an insight
//   maxAlertsPerWeek:  1-20   cap on surfaced insight count
//   minPointsDelta:    0-10   reserved — not yet enforced (lineup-scope)
//   focus: {
//     startSit:  bool
//     trades:    bool
//     waivers:   bool
//     draft:     bool
//     injury:    bool
//     streaming: bool
//     gmStyle:   bool
//   }
//   channel: { inApp, email, push }  bool triple
// ══════════════════════════════════════════════════════════════════

(function () {
    const KEY = 'wr_alex_settings';
    const EVENT_NAME = 'wr:alex-settings-changed';

    const DEFAULTS = {
        alertThreshold: 70,
        maxAlertsPerWeek: 6,
        minPointsDelta: 2.5,
        tradeAggression: 50,
        tradePriority: {
            positions: { QB: false, RB: false, WR: false, TE: false, DL: false, LB: false, DB: false, K: false },
            picks: { '2026': true, '2027': true, '2028': false },
            faab: true,
        },
        focus: { startSit: true, trades: true, waivers: true, draft: true, injury: false, streaming: false, gmStyle: false },
        channel: { inApp: true, email: false, push: false },
    };

    let _cache = null;

    function load() {
        if (_cache) return _cache;
        try {
            const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
            if (raw && typeof raw === 'object') {
                const rawTP = raw.tradePriority || {};
                _cache = {
                    ...DEFAULTS,
                    ...raw,
                    focus: { ...DEFAULTS.focus, ...(raw.focus || {}) },
                    channel: { ...DEFAULTS.channel, ...(raw.channel || {}) },
                    tradePriority: {
                        positions: { ...DEFAULTS.tradePriority.positions, ...(rawTP.positions || {}) },
                        picks: { ...DEFAULTS.tradePriority.picks, ...(rawTP.picks || {}) },
                        faab: rawTP.faab !== undefined ? rawTP.faab : DEFAULTS.tradePriority.faab,
                    },
                };
                return _cache;
            }
        } catch (_) { /* fall through to defaults */ }
        _cache = { ...DEFAULTS, focus: { ...DEFAULTS.focus }, channel: { ...DEFAULTS.channel } };
        return _cache;
    }

    function save(next) {
        _cache = next;
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (_) {}
        try { window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next })); } catch (_) {}
    }

    function get() { return load(); }

    // Test an insight against the user's settings. Insights come through
    // with shape { severity, confidence?, focus? (string) }. Returns true
    // when the user wants to see it given current thresholds + focus.
    function shouldShow(insight) {
        if (!insight) return false;
        const s = load();
        if (insight.confidence != null && insight.confidence < (s.alertThreshold || 0)) return false;
        // No focus tag => always allowed (infrastructural insight without a
        // domain, e.g., AI-generated novel finds). Tagged insights must have
        // their focus area enabled.
        if (insight.focus && s.focus && s.focus[insight.focus] === false) return false;
        return true;
    }

    // Apply `shouldShow` + `maxAlertsPerWeek` to an ordered array of
    // insights. Priority ordering is preserved from the input.
    function filterInsights(list) {
        const s = load();
        const cap = Math.max(1, s.maxAlertsPerWeek || 6);
        return (list || []).filter(shouldShow).slice(0, cap);
    }

    // Invalidate the in-memory cache (call after external writes, e.g.,
    // server sync). Consumers should prefer save() which keeps the cache
    // hot automatically.
    function invalidate() { _cache = null; }

    // Subscribe to setting changes. Returns an unsubscribe fn.
    function subscribe(fn) {
        const handler = (e) => fn(e.detail);
        window.addEventListener(EVENT_NAME, handler);
        return () => window.removeEventListener(EVENT_NAME, handler);
    }

    window.WR = window.WR || {};
    window.WR.AlexSettings = {
        DEFAULTS,
        EVENT_NAME,
        get,
        save,
        shouldShow,
        filterInsights,
        invalidate,
        subscribe,
    };
})();

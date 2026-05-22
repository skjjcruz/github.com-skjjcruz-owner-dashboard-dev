// ══════════════════════════════════════════════════════════════════
// js/draft/cpu-engine.js — Thin wrapper around shared/mock-engine.js
//
// Delegates to the canonical shared MockEngine for all pick logic.
// Keeps the DraftCC.cpuEngine namespace for backward compat.
//
// Depends on: reconai/shared/mock-engine.js (loaded via CDN)
// Exposes:    window.DraftCC.cpuEngine.{ personaPick, computePredictions }
// ══════════════════════════════════════════════════════════════════

(function() {

    function personaPick(persona, available, round, pickNumber, ctx) {
        // Delegate to shared canonical engine
        if (window.App?.MockEngine?.personaPick) {
            return window.App.MockEngine.personaPick(persona, available, round, pickNumber, ctx);
        }
        // Emergency BPA fallback
        if (!available || !available.length) return null;
        const best = available.reduce((a, b) => ((b.dhq || b.val || 0) > (a.dhq || a.val || 0) ? b : a), available[0]);
        return { player: best, confidence: 0.5, reasoning: { primary: 'BPA fallback', baseVal: best.dhq || best.val || 0, nudges: [], bpaFloorTriggered: true } };
    }

    function computePredictions(persona, pool, round, pickNumber) {
        if (window.App?.MockEngine?.computePredictions) {
            return window.App.MockEngine.computePredictions(persona, pool, round, pickNumber);
        }
        return { willReach: [], willPassOn: [], likelyPick: null };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.cpuEngine = {
        personaPick,
        computePredictions,
    };
})();

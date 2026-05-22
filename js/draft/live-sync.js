// ══════════════════════════════════════════════════════════════════
// js/draft/live-sync.js — Live Sync mode (mirror a real Sleeper draft)
//
// Polls fetchDraftPicks(draftId) every 5s during an active Sleeper draft.
// Mirrors new picks into draftState by dispatching MAKE_PICK for each
// pick that's present in the Sleeper response but not yet in state.picks.
//
// SAFETY: read-only. Never writes picks back to Sleeper. Zero risk to a
// real draft.
//
// Phase 5 ships a functional poll loop + start/stop controls. The full
// "predict what SHOULD happen next" overlay is deferred to post-5.
//
// Depends on: window.Sleeper.fetchDraftPicks, state.js
// Exposes:    window.DraftCC.liveSync.{ start, stop, isRunning }
// ══════════════════════════════════════════════════════════════════

(function() {
    const POLL_INTERVAL_MS = 5000;
    let _pollTimer = null;
    let _lastPickNo = 0;

    function isRunning() {
        return !!_pollTimer;
    }

    /**
     * start — begin polling a Sleeper draft. On each new pick detected,
     * calls onNewPick(sleeperPick) with the raw Sleeper pick object.
     *
     * @param {string} draftId
     * @param {(pick: object) => void} onNewPick
     */
    function start(draftId, onNewPick) {
        if (_pollTimer) stop();
        if (!draftId || typeof onNewPick !== 'function') return;

        _lastPickNo = 0;
        const poll = async () => {
            try {
                let picks = null;
                if (window.Sleeper?.fetchDraftPicks) {
                    picks = await window.Sleeper.fetchDraftPicks(draftId);
                } else {
                    const resp = await fetch('https://api.sleeper.app/v1/draft/' + draftId + '/picks');
                    if (resp.ok) picks = await resp.json();
                }
                if (!Array.isArray(picks)) return;
                const sorted = picks.sort((a, b) => (a.pick_no || 0) - (b.pick_no || 0));
                for (const p of sorted) {
                    if ((p.pick_no || 0) > _lastPickNo) {
                        _lastPickNo = p.pick_no;
                        onNewPick(p);
                    }
                }
            } catch (e) {
                if (window.wrLog) window.wrLog('liveSync.poll', e);
            }
        };

        // Fire immediately then on interval
        poll();
        _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }

    function stop() {
        if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
        _lastPickNo = 0;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.liveSync = {
        POLL_INTERVAL_MS,
        start,
        stop,
        isRunning,
    };
})();

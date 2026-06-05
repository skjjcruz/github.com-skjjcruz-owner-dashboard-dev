// ══════════════════════════════════════════════════════════════════
// js/draft/live-sync.js — Live Sync mode (mirror a real Sleeper draft)
//
// Polls Sleeper every 5s during an active Sleeper draft. Mirrors only
// newly observed picks and reports poll health/status back to draftState.
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
    const STALE_AFTER_MS = POLL_INTERVAL_MS * 3;
    let _pollTimer = null;
    let _lastPickNo = 0;
    let _seenPickKeys = new Set();
    let _lastSuccessAt = 0;

    function isRunning() {
        return !!_pollTimer;
    }

    /**
     * start — begin polling a Sleeper draft. On each poll, reports status;
     * when new picks are detected, calls onNewPicks(newPicks, snapshot).
     *
     * @param {string} draftId
     * @param {(picks: object[], snapshot: object) => void} onNewPicks
     * @param {Object} opts — { initialPickNo, seenPickKeys, onStatus }
     */
    function start(draftId, onNewPicks, opts = {}) {
        if (_pollTimer) stop();
        if (!draftId || typeof onNewPicks !== 'function') return;

        _lastPickNo = Number(opts.initialPickNo || 0);
        _seenPickKeys = new Set(opts.seenPickKeys || []);
        _lastSuccessAt = 0;
        const onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : null;
        const poll = async () => {
            try {
                let picks = null;
                let meta = null;
                if (window.Sleeper?.fetchDraftPicks) {
                    picks = await window.Sleeper.fetchDraftPicks(draftId);
                } else {
                    const resp = await fetch('https://api.sleeper.app/v1/draft/' + draftId + '/picks');
                    if (resp.ok) picks = await resp.json();
                }
                try {
                    if (window.Sleeper?.fetchDraft) {
                        meta = await window.Sleeper.fetchDraft(draftId);
                    } else {
                        const metaResp = await fetch('https://api.sleeper.app/v1/draft/' + draftId);
                        if (metaResp.ok) meta = await metaResp.json();
                    }
                } catch (_) {}
                if (picks == null) {
                    // Distinguish a dead/missing draft (null/404 from the fetch) from
                    // a valid empty pre-draft feed ([]). A silent return here would
                    // freeze the mirror on last-known state with no signal that the
                    // draft id is wrong or the draft was deleted.
                    if (onStatus) onStatus({
                        status: 'error',
                        error: 'Sleeper returned no draft for this draft id — check the draft id.',
                        lastPollAt: _lastSuccessAt || null,
                        stale: true,
                    });
                    if (window.wrLog) window.wrLog('liveSync.poll', 'null picks for draft ' + draftId);
                    return;
                }
                if (!Array.isArray(picks)) return;
                const snapshot = reconcilePicks(picks, {
                    initialPickNo: _lastPickNo,
                    seenPickKeys: _seenPickKeys,
                    draftStatus: meta?.status,
                });
                _lastPickNo = Math.max(_lastPickNo, snapshot.lastPickNo || 0);
                _seenPickKeys = new Set(snapshot.seenPickKeys || []);
                _lastSuccessAt = Date.now();

                const staleReason = liveSyncStaleReason(snapshot);
                if (onStatus) onStatus({
                    status: staleReason
                        ? 'stale'
                        : statusFor(meta?.status, snapshot.remotePickCount),
                    draftStatus: meta?.status || '',
                    lastPollAt: _lastSuccessAt,
                    lastPickNo: snapshot.lastPickNo,
                    remoteMaxPickNo: snapshot.remoteMaxPickNo,
                    remotePickCount: snapshot.remotePickCount,
                    duplicateCount: snapshot.duplicateCount,
                    missedPickCount: snapshot.gapCount,
                    missingPickNos: snapshot.missingPickNos,
                    conflictCount: snapshot.conflictCount,
                    conflictPickNos: snapshot.conflictPickNos,
                    invalidPickCount: snapshot.invalidPickCount,
                    remoteBehind: snapshot.remoteBehind,
                    stale: !!staleReason,
                    error: staleReason,
                });
                if (snapshot.newPicks.length) onNewPicks(snapshot.newPicks, snapshot);
            } catch (e) {
                const now = Date.now();
                const stale = !_lastSuccessAt || now - _lastSuccessAt >= STALE_AFTER_MS;
                if (onStatus) onStatus({
                    status: stale ? 'stale' : 'error',
                    lastPollAt: _lastSuccessAt || null,
                    stale,
                    error: e?.message || 'Live sync poll failed.',
                });
                if (window.wrLog) window.wrLog('liveSync.poll', e);
            }
        };

        // Fire immediately then on interval
        poll();
        _pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    }

    function pickKey(pick) {
        if (!pick) return '';
        if (pick.pick_id) return 'id:' + pick.pick_id;
        if (pick.pick_no) return 'no:' + pick.pick_no;
        return [pick.round, pick.draft_slot, pick.roster_id, pick.player_id].filter(Boolean).join(':');
    }

    function statusFor(draftStatus, remotePickCount) {
        if (draftStatus === 'complete') return 'complete';
        if (draftStatus === 'drafting') return 'mirroring';
        if (remotePickCount > 0) return 'mirroring';
        return 'waiting';
    }

    function liveSyncStaleReason(snapshot) {
        if (!snapshot) return null;
        if (snapshot.remoteBehind) return 'Sleeper returned fewer picks than Dynasty HQ has already mirrored.';
        if (snapshot.conflictPickNos?.length) {
            return 'Sleeper returned conflicting records for pick ' + snapshot.conflictPickNos.join(', ') + '. Dynasty HQ paused before applying the wrong player.';
        }
        if (snapshot.missingPickNos?.length) return 'Sleeper feed is missing pick ' + snapshot.missingPickNos.join(', ') + '.';
        if (snapshot.invalidPickCount > 0) {
            return 'Sleeper returned ' + snapshot.invalidPickCount + ' invalid pick record' + (snapshot.invalidPickCount === 1 ? '' : 's') + ' without enough player data.';
        }
        return null;
    }

    function reconcilePicks(picks, opts = {}) {
        const initialPickNo = Number(opts.initialPickNo || 0);
        const seen = new Set(opts.seenPickKeys || []);
        const rawSorted = (Array.isArray(picks) ? picks : [])
            .slice()
            .sort((a, b) => (Number(a.pick_no) || 0) - (Number(b.pick_no) || 0));
        const invalidPicks = [];
        const identityByPickNo = new Map();
        const conflictPickNosSet = new Set();
        rawSorted.forEach(pick => {
            const pickNo = Number(pick?.pick_no || 0);
            if (!pickNo || !pick?.player_id) {
                invalidPicks.push(pick);
                return;
            }
            const identity = [pick.player_id, pick.roster_id || '', pick.draft_slot || '', pick.picked_by || ''].join('|');
            const prev = identityByPickNo.get(pickNo);
            if (prev && prev !== identity) conflictPickNosSet.add(pickNo);
            else identityByPickNo.set(pickNo, identity);
        });
        const conflictPickNos = Array.from(conflictPickNosSet).sort((a, b) => a - b);
        const sorted = rawSorted.filter(pick => {
            const pickNo = Number(pick?.pick_no || 0);
            return pickNo > 0 && pick?.player_id && !conflictPickNosSet.has(pickNo);
        });
        const newPicks = [];
        let duplicateCount = 0;
        let lastPickNo = initialPickNo;
        const remotePickNos = rawSorted
            .map(pick => Number(pick.pick_no || 0))
            .filter(pickNo => pickNo > 0);
        const remotePickNoSet = new Set(remotePickNos);
        const remoteMaxPickNo = remotePickNos.length ? Math.max(...remotePickNos) : 0;
        const remoteBehind = remoteMaxPickNo > 0 && remoteMaxPickNo < initialPickNo;
        const missingPickNos = [];
        if (!remoteBehind && remoteMaxPickNo > initialPickNo + 1) {
            for (let pickNo = initialPickNo + 1; pickNo < remoteMaxPickNo; pickNo += 1) {
                if (!remotePickNoSet.has(pickNo)) missingPickNos.push(pickNo);
            }
        }

        // Emit ONLY the contiguous run starting at initialPickNo + 1. If Sleeper's
        // feed has a gap (a slot still showing player_id=null while a manager is on
        // the clock or autodrafting, or picks arriving out of order), stop at the
        // gap and do NOT mark later picks seen or advance the cursor past it.
        //
        // The reducer applies live-sync picks strictly in sequence (pick_no must ===
        // currentIdx+1). Emitting past a gap gets those later picks hard-rejected
        // while leaving them flagged "seen" here — so when the missing pick finally
        // arrives it is treated as old and never applied, losing 3+ picks forever and
        // freezing the mirror for the rest of the draft. Stopping at the gap lets the
        // run self-heal once the feed fills in. missingPickNos (computed above) still
        // raises the stale banner while we wait.
        let expected = initialPickNo + 1;
        for (const pick of sorted) {
            const pickNo = Number(pick.pick_no || 0);
            const key = pickKey(pick);
            if (pickNo < expected) {
                // Already mirrored in a prior poll — count duplicates, keep cursor.
                if (key && seen.has(key)) duplicateCount += 1;
                else if (key) seen.add(key);
                lastPickNo = Math.max(lastPickNo, pickNo);
                continue;
            }
            if (pickNo > expected) break; // gap — stop; do NOT mark later picks seen
            if (key) seen.add(key);
            lastPickNo = Math.max(lastPickNo, pickNo);
            newPicks.push(pick);
            expected += 1;
        }

        return {
            newPicks,
            duplicateCount,
            lastPickNo,
            remoteMaxPickNo,
            remotePickCount: sorted.length,
            missingPickNos,
            gapCount: missingPickNos.length,
            conflictPickNos,
            conflictCount: conflictPickNos.length,
            invalidPickCount: invalidPicks.length,
            remoteBehind,
            seenPickKeys: Array.from(seen),
            draftStatus: opts.draftStatus || '',
        };
    }

    function stop() {
        if (_pollTimer) {
            clearInterval(_pollTimer);
            _pollTimer = null;
        }
        _lastPickNo = 0;
        _seenPickKeys = new Set();
        _lastSuccessAt = 0;
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.liveSync = {
        POLL_INTERVAL_MS,
        STALE_AFTER_MS,
        start,
        stop,
        isRunning,
        _private: {
            pickKey,
            reconcilePicks,
            statusFor,
            liveSyncStaleReason,
        },
    };
})();

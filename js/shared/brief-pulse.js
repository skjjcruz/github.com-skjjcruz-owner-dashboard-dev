// ══════════════════════════════════════════════════════════════════
// brief-pulse.js — the command brief's "what changed" line (WR.BriefPulse)
//
// Phase 2 of the AI Conductor. Adds ONE line at the top of the command
// brief that reacts to what actually happened in your league since your
// last visit — the environment-awareness the template can't provide.
//
// Design (matches the owner's "make it react, but never let it break"):
//   • FLOOR (deterministic, always works): computeChange() diffs the last
//     saved snapshot against the current Situation Room state and writes a
//     plain-English line ("Since your last visit: you added J. Downs (WR),
//     and you're now 7-2."). No AI, no network, cannot fail.
//   • ENHANCE (AI, best-effort): when something changed, Alex rewrites that
//     line in his voice with the "why it matters." Cached per fingerprint
//     (one call per real change), and if the AI is slow/limited/offline the
//     deterministic line stays. The line NEVER disappears and never blocks.
//   • GATED: renders nothing unless WR.SituationRoom.enabled() — owner QA
//     account only for now. Flag off ⇒ the component returns null and no
//     AI call is ever made. The existing template is 100% untouched.
//
// Only material events count — a trade/add-drop, a record change, a tier
// flip, the draft completing. A bare NFL-week rollover is NOT a change
// (nothing happened in your league), so no line appears for it.
//
// Plain JS (no JSX): the Line component uses window.React.createElement and
// hooks, the dashboard-digest.js pattern. Load AFTER situation-room.js.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    var SNAP_KEY = 'dhq_brief_pulse_v1:';   // + leagueId → last acknowledged snapshot
    var LINE_KEY = 'dhq_brief_pulse_line_v1:'; // + fingerprint → cached AI line

    // ── Snapshot persistence ─────────────────────────────────────────
    function loadSnapshot(leagueId) {
        try {
            var raw = localStorage.getItem(SNAP_KEY + (leagueId || '_'));
            return raw ? JSON.parse(raw) : null;
        } catch (_) { return null; }
    }
    function saveSnapshot(leagueId, snap) {
        try { localStorage.setItem(SNAP_KEY + (leagueId || '_'), JSON.stringify(snap)); } catch (_) { /* storage full/blocked — non-fatal */ }
    }

    // The minimal snapshot we diff on, distilled from a Situation Room state.
    function snapshotFromState(state) {
        if (!state) return null;
        return {
            fingerprint: state.fingerprint || '',
            players: (state.players || []).slice(),
            record: state.record || '',
            tier: state.tier || '',
            draftPhase: (state.draft && state.draft.phase) || '',
        };
    }

    // ── Deterministic diff (the floor) ───────────────────────────────
    function _name(id, playersData) {
        try {
            var p = playersData && playersData[id];
            if (!p) return null;
            return p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || null;
        } catch (_) { return null; }
    }
    function _pos(id, playersData) {
        try {
            var p = playersData && playersData[id];
            var pos = p && (p.position || (p.fantasy_positions && p.fantasy_positions[0]));
            return pos || '';
        } catch (_) { return ''; }
    }
    function _label(id, playersData) {
        var n = _name(id, playersData);
        if (!n) return null;                       // no metadata → skip naming it
        var pos = _pos(id, playersData);
        return pos ? (n + ' (' + pos + ')') : n;
    }
    function _list(ids, playersData, max) {
        var out = [];
        for (var i = 0; i < ids.length && out.length < (max || 2); i++) {
            var l = _label(ids[i], playersData);
            if (l) out.push(l);
        }
        var extra = ids.length - out.length;
        var joined = out.join(' and ');
        if (out.length && extra > 0) joined += ' and ' + extra + ' more';
        return joined;
    }
    function _wins(record) {
        var m = /^(\d+)-(\d+)/.exec(String(record || ''));
        return m ? { w: +m[1], l: +m[2] } : null;
    }

    // computeChange(prev, curr, playersData) → { material, changes:[{type,text}], line }
    // prev/curr are snapshots. First-ever visit (no prev) is intentionally
    // NON-material — we can't say what changed with nothing to compare to.
    function computeChange(prev, curr, playersData) {
        var empty = { material: false, changes: [], line: '' };
        if (!prev || !curr) return empty;

        var changes = [];
        var prevSet = {}, currSet = {};
        (prev.players || []).forEach(function (id) { prevSet[id] = true; });
        (curr.players || []).forEach(function (id) { currSet[id] = true; });
        var added = (curr.players || []).filter(function (id) { return !prevSet[id]; });
        var removed = (prev.players || []).filter(function (id) { return !currSet[id]; });

        if (added.length) {
            var a = _list(added, playersData, 2);
            changes.push({ type: 'add', text: a ? ('you added ' + a) : ('you added ' + added.length + ' player' + (added.length > 1 ? 's' : '')) });
        }
        if (removed.length) {
            var r = _list(removed, playersData, 2);
            changes.push({ type: 'drop', text: r ? ('you moved on from ' + r) : ('you dropped ' + removed.length + ' player' + (removed.length > 1 ? 's' : '')) });
        }

        if (prev.record !== curr.record && curr.record) {
            var pw = _wins(prev.record), cw = _wins(curr.record);
            var verb = '';
            if (pw && cw) {
                if (cw.w > pw.w) verb = 'picked up a win';
                else if (cw.l > pw.l) verb = 'took a loss';
            }
            changes.push({ type: 'record', text: (verb ? verb + ' — now ' : "you're now ") + curr.record });
        }

        if (prev.tier && curr.tier && prev.tier !== curr.tier) {
            changes.push({ type: 'tier', text: 'your team shifted from ' + prev.tier + ' to ' + curr.tier });
        }

        if (prev.draftPhase !== curr.draftPhase &&
            (prev.draftPhase === 'pre') && (curr.draftPhase === 'drafted' || curr.draftPhase === 'in-season')) {
            changes.push({ type: 'draft', text: 'your draft is complete' });
        }

        if (!changes.length) return empty;

        // Deterministic line: "Since your last visit — X, and Y."
        var phrases = changes.map(function (c) { return c.text; });
        var joined = phrases.length > 1
            ? phrases.slice(0, -1).join(', ') + ', and ' + phrases[phrases.length - 1]
            : phrases[0];
        var line = 'Since your last visit — ' + joined.charAt(0).toLowerCase() + joined.slice(1) + '.';
        return { material: true, changes: changes, line: line };
    }

    // ── AI enhancement (best-effort) ─────────────────────────────────
    function loadCachedLine(fp) {
        try { return localStorage.getItem(LINE_KEY + fp) || null; } catch (_) { return null; }
    }
    function saveCachedLine(fp, line) {
        try { localStorage.setItem(LINE_KEY + fp, line); } catch (_) { /* non-fatal */ }
    }
    function _trim(text) {
        var t = String(text || '').trim().replace(/^["'\s]+|["'\s]+$/g, '');
        // Alex sometimes greets — strip a leading "Good morning," etc.
        t = t.replace(/^(good (morning|afternoon|evening)[,.!]?\s*)/i, '');
        // First 1–2 sentences, hard cap so the brief never gets a paragraph.
        var m = t.match(/^[\s\S]*?[.!?](\s+[\s\S]*?[.!?])?/);
        if (m) t = m[0].trim();
        if (t.length > 180) t = t.slice(0, 177).replace(/\s+\S*$/, '') + '…';
        return t;
    }
    // Returns an Alex-voice line, or null on any failure. Never throws.
    async function enhance(change, state) {
        try {
            if (typeof window.dhqAI !== 'function') return null;
            var context = JSON.stringify({
                changes: change.changes.map(function (c) { return c.text; }),
                team: {
                    tier: state && state.tier,
                    record: state && state.record,
                    needs: (state && state.needs || []).map(function (n) { return (n && (n.pos || n.position)) || n; }),
                },
            });
            var msg = 'In ONE short sentence (max 22 words), tell me what just changed in my dynasty league and why it matters for my next move. '
                + 'Be specific and useful. No greeting, no preamble, no lists.';
            var reply = await window.dhqAI('home-chat', msg, context);
            var line = _trim(reply);
            return line && line.length > 4 ? line : null;
        } catch (_) { return null; }
    }

    // ── The rendered line (thin React glue over the pure fns) ────────
    function Line(props) {
        var React = window.React;
        if (!React) return null;
        var h = React.createElement;

        var league = props && props.league;
        var roster = props && props.roster;
        var playersData = (props && props.playersData) || null;
        var tight = !!(props && props.tight);

        // Gate: owner/flag only, and we need a league + roster + the Room.
        var active = !!(window.WR && window.WR.SituationRoom &&
            typeof window.WR.SituationRoom.enabled === 'function' && window.WR.SituationRoom.enabled() &&
            league && roster);

        // Current state + change are pure and cheap — compute every render.
        var curr = null, change = { material: false, changes: [], line: '' }, leagueId = null;
        if (active) {
            try {
                var got = window.WR.SituationRoom.get(league, roster);
                curr = snapshotFromState(got && got.state);
                leagueId = (got && got.state && got.state.leagueId) || null;
                var prev = loadSnapshot(leagueId);
                change = computeChange(prev, curr, playersData);
                // The state carries needs for the AI context.
                if (got && got.state) curr._needs = got.state.needs;
            } catch (_) { active = false; }
        }

        // Hooks are always called (stable order): line text starts at the
        // deterministic floor, then an effect may upgrade it via AI.
        var ref = React.useState(change.material ? change.line : null);
        var line = ref[0], setLine = ref[1];

        React.useEffect(function () {
            if (!active || !change.material || !curr) return;
            var alive = true;
            // Show the deterministic line immediately.
            setLine(change.line);
            // Save the snapshot so this change is "acknowledged" — next visit
            // diffs from here (the line flashes once per real change).
            saveSnapshot(leagueId, { fingerprint: curr.fingerprint, players: curr.players, record: curr.record, tier: curr.tier, draftPhase: curr.draftPhase });
            // AI enhancement: cached per fingerprint, best-effort.
            var cached = loadCachedLine(curr.fingerprint);
            if (cached) { setLine(cached); return; }
            enhance(change, { tier: curr.tier, record: curr.record, needs: curr._needs })
                .then(function (aiLine) {
                    if (!alive || !aiLine) return;
                    saveCachedLine(curr.fingerprint, aiLine);
                    setLine(aiLine);
                });
            return function () { alive = false; };
        }, [active, curr && curr.fingerprint]);

        if (!active || !change.material || !line) return null;

        return h('div', {
            style: {
                display: 'flex', alignItems: 'flex-start', gap: '7px',
                margin: tight ? '4px 0 0' : '8px 0 0',
                padding: tight ? '5px 8px' : '7px 10px',
                background: 'rgba(212,175,55,0.07)',
                borderLeft: '2px solid var(--gold, #d4af37)',
                borderRadius: '3px',
                fontSize: tight ? '0.74rem' : '0.82rem',
                lineHeight: 1.4, color: 'var(--white, #e8ebef)',
            },
        },
            h('span', { 'aria-hidden': 'true', style: { color: 'var(--gold, #d4af37)', flex: '0 0 auto' } }, '⟳'),
            h('span', { style: { flex: 1 } }, line),
        );
    }

    window.WR.BriefPulse = {
        loadSnapshot: loadSnapshot,
        saveSnapshot: saveSnapshot,
        snapshotFromState: snapshotFromState,
        computeChange: computeChange,
        Line: Line,
    };
})();

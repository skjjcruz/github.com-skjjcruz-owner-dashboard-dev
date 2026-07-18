#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// tests/brief-pulse-contract.js
// Contract for js/shared/brief-pulse.js (WR.BriefPulse) — the command
// brief's "what changed" line (AI Conductor Phase 2).
//
// Proves the deterministic FLOOR (the part that must never fail):
//   1. First-ever visit is NOT a change (nothing to compare to).
//   2. No diff → not material → no line (the common case).
//   3. Each material event produces a line: add, drop, record (win/loss),
//      tier flip, draft completing.
//   4. A bare NFL-week rollover with no roster/record change is NOT material.
//   5. Snapshots round-trip through localStorage.
//   6. The Line component returns null when the Situation Room flag is off
//      (inert — no AI, no render), and when React is absent.
//
// The AI enhancement is best-effort and network-bound, so it is NOT unit
// tested here — by design the line falls back to the deterministic text,
// which IS fully tested.
//
// Node built-ins + a vm sandbox, matching the other *-contract.js tests.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
    try { fn(); passed++; process.stdout.write('.'); }
    catch (err) { failed++; failures.push(`  FAIL: ${name}\n        ${err.message}`); process.stdout.write('F'); }
}
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }
function eq(a, b, label) { if (a !== b) throw new Error(`${label || 'mismatch'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function match(s, re, label) { if (!re.test(String(s))) throw new Error(`${label || 'no match'}: ${JSON.stringify(s)} !~ ${re}`); }

function makeStorage() {
    const store = {};
    return {
        getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
        _store: store,
    };
}

// Load brief-pulse.js into a sandbox. opts.react / opts.roomEnabled control
// the Line-component environment.
function load(opts) {
    opts = opts || {};
    const ctx = {
        console, Date, Math, JSON, Object, Array, Number, String, Boolean,
        Set, Map, parseInt, parseFloat, isNaN, RegExp,
        localStorage: makeStorage(),
        window: null,
    };
    ctx.window = ctx;
    ctx.window.React = opts.react || null;
    ctx.window.WR = {
        SituationRoom: {
            enabled: () => !!opts.roomEnabled,
            get: (league, roster) => ({ state: opts.roomState || null }),
        },
    };
    const code = fs.readFileSync(path.join(ROOT, 'js/shared/brief-pulse.js'), 'utf8');
    vm.runInNewContext(code, ctx, { filename: 'brief-pulse.js' });
    ok(ctx.window.WR.BriefPulse, 'WR.BriefPulse defined');
    return { BP: ctx.window.WR.BriefPulse, ctx };
}

// A tiny players metadata table.
const PLAYERS = {
    '1001': { full_name: 'Jaylen Downs', position: 'WR' },
    '1002': { full_name: 'Cam Rivers', position: 'RB' },
    '9999': { full_name: 'Theo Vance', position: 'TE' },
};
function snap(over) {
    return Object.assign({ fingerprint: 'fp', players: ['1001', '1002'], record: '6-2', tier: 'CONTENDER', draftPhase: 'in-season' }, over || {});
}

// ── Deterministic diff ──────────────────────────────────────────────
test('first-ever visit (no prev) is not material', () => {
    const { BP } = load();
    const c = BP.computeChange(null, snap(), PLAYERS);
    eq(c.material, false, 'no prior snapshot → nothing to report');
    eq(c.line, '', 'no line');
});

test('identical snapshots produce no change', () => {
    const { BP } = load();
    const c = BP.computeChange(snap(), snap(), PLAYERS);
    eq(c.material, false, 'no diff → not material');
});

test('adding a player is a material change with a name', () => {
    const { BP } = load();
    const c = BP.computeChange(snap(), snap({ players: ['1001', '1002', '9999'] }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /Theo Vance/, 'names the added player');
    match(c.line, /added/i, 'says added');
    match(c.line, /^Since your last visit —/, 'lead phrasing');
});

test('dropping a player is a material change', () => {
    const { BP } = load();
    const c = BP.computeChange(snap(), snap({ players: ['1001'] }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /Cam Rivers/, 'names the removed player');
});

test('a win is detected and phrased', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ record: '6-2' }), snap({ record: '7-2' }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /win/i, 'calls it a win');
    match(c.line, /7-2/, 'shows new record');
});

test('a loss is detected and phrased', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ record: '6-2' }), snap({ record: '6-3' }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /loss/i, 'calls it a loss');
});

test('a tier flip is a material change', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ tier: 'CONTENDER' }), snap({ tier: 'CROSSROADS' }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /CONTENDER to CROSSROADS/, 'names the shift');
});

test('draft completing (pre → drafted) is a material change', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ draftPhase: 'pre', players: [] }), snap({ draftPhase: 'drafted', players: ['1001', '1002'] }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /draft is complete/i, 'mentions the draft');
});

test('a bare NFL-week rollover (no roster/record change) is NOT material', () => {
    const { BP } = load();
    // Same roster, record, tier, draft — only the fingerprint differs (week).
    const c = BP.computeChange(snap({ fingerprint: 'w3' }), snap({ fingerprint: 'w4' }), PLAYERS);
    eq(c.material, false, 'week-only change reports nothing');
    eq(c.line, '', 'no line for a quiet week');
});

test('multiple simultaneous changes are joined into one line', () => {
    const { BP } = load();
    const c = BP.computeChange(snap(), snap({ players: ['1001', '1002', '9999'], record: '7-2' }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /Theo Vance/, 'has the add');
    match(c.line, /7-2/, 'has the record');
    match(c.line, /, and /, 'joined with "and"');
});

test('added player with no metadata degrades to a count, no throw', () => {
    const { BP } = load();
    const c = BP.computeChange(snap(), snap({ players: ['1001', '1002', 'unknown_id'] }), {});
    eq(c.material, true, 'still material');
    match(c.line, /added 1 player/i, 'falls back to a count');
});

// ── League-wide trade radar + rank (Phase 2b) ───────────────────────
const TRADE = { id: 'txn1', when: 'last night', involvesMe: false, headline: "iMacduff landed Cam Rivers; MangaMaw landed a 2026 R1 pick" };

test('a fresh league trade leads the brief and sets the eyes flag — no prev needed', () => {
    const { BP } = load();
    const c = BP.computeChange(null, snap({ _trade: TRADE }), PLAYERS);
    eq(c.material, true, 'a live trade is material even on a first visit');
    eq(c.eyes, true, 'eyes flag drives the 👀 icon');
    match(c.line, /Huge trade last night/, 'leads with the trade headline');
    match(c.line, /iMacduff landed Cam Rivers/, 'names the teams and marquee pieces');
});

test('a league trade anchors to your current power rank', () => {
    const { BP } = load();
    const c = BP.computeChange(null, snap({ _trade: TRADE, rank: 8 }), PLAYERS);
    eq(c.eyes, true, 'still trade-led');
    match(c.line, /#8/, 'mentions where you now sit');
});

test('a trade you are in reads "Big trade", not "Huge trade"', () => {
    const { BP } = load();
    const c = BP.computeChange(null, snap({ _trade: Object.assign({}, TRADE, { involvesMe: true }) }), PLAYERS);
    match(c.line, /Big trade last night/, 'your own deal is phrased as yours');
});

test('a power-rank drop is named with the from/to', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ rank: 5 }), snap({ rank: 8 }), PLAYERS);
    eq(c.material, true, 'material');
    match(c.line, /slipped from #5 to #8/, 'names the drop');
});

test('a power-rank climb is phrased as a climb', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ rank: 8 }), snap({ rank: 4 }), PLAYERS);
    match(c.line, /climbed from #8 to #4/, 'names the climb');
});

test('no trade + no rank move stays the plain "since your last visit" voice', () => {
    const { BP } = load();
    const c = BP.computeChange(snap({ rank: 8 }), snap({ players: ['1001', '1002', '9999'], rank: 8 }), PLAYERS);
    eq(c.eyes, false, 'no eyes without a trade');
    match(c.line, /^Since your last visit —/, 'keeps the original lead');
});

// recentLeagueTrade reads live transactions + DHQ scores to build the headline.
function txnCtx(ctx, scores, txn) {
    ctx.window.App = { LI: { playerScores: scores } };
    ctx.window.S = { transactions: { '5': [txn] } };
}
const TRADE_PLAYERS = {
    KW: { full_name: 'Kenneth Walker' }, ME: { full_name: 'Mike Evans' },
    SCRUB: { full_name: 'Practice Squad Guy' }, SA: { full_name: 'Star A' }, SB: { full_name: 'Star B' },
};
const LEAGUE2 = {
    league_id: 'L1',
    rosters: [{ roster_id: 2, owner_id: 'u2' }, { roster_id: 3, owner_id: 'u3' }],
    users: [{ user_id: 'u2', display_name: 'CovidFacemasks' }, { user_id: 'u3', display_name: 'Big Loco' }],
};

test('a lopsided trade headlines the two highest-DHQ players and who got them', () => {
    const { BP, ctx } = load();
    txnCtx(ctx, { KW: 7200, ME: 6800, SCRUB: 900 }, {
        type: 'trade', status: 'complete', transaction_id: 'T1', status_updated: Date.now() - 3 * 3600 * 1000,
        roster_ids: [2, 3], adds: { KW: 2, ME: 2, SCRUB: 3 }, draft_picks: [],
    });
    const t = BP.recentLeagueTrade(LEAGUE2, { roster_id: 9 }, TRADE_PLAYERS);
    ok(t, 'a fresh trade is found');
    match(t.headline, /CovidFacemasks got Kenneth Walker and Mike Evans from Big Loco/, 'winner + top-2 studs by DHQ + sender');
});

test('an even trade names each side\'s biggest piece instead', () => {
    const { BP, ctx } = load();
    txnCtx(ctx, { SA: 5000, SB: 4800 }, {
        type: 'trade', status: 'complete', transaction_id: 'T2', status_updated: Date.now() - 3 * 3600 * 1000,
        roster_ids: [2, 3], adds: { SA: 2, SB: 3 }, draft_picks: [],
    });
    const t = BP.recentLeagueTrade(LEAGUE2, { roster_id: 9 }, TRADE_PLAYERS);
    match(t.headline, /CovidFacemasks landed Star A; Big Loco landed Star B/, 'per-side when the values are close');
});

test('a trade older than the ~36h window is not surfaced', () => {
    const { BP, ctx } = load();
    txnCtx(ctx, { SA: 5000 }, {
        type: 'trade', status: 'complete', transaction_id: 'T3', status_updated: Date.now() - 72 * 3600 * 1000,
        roster_ids: [2, 3], adds: { SA: 2 }, draft_picks: [],
    });
    eq(BP.recentLeagueTrade(LEAGUE2, { roster_id: 9 }, TRADE_PLAYERS), null, 'stale trade → null');
});

// ── Snapshot helpers ────────────────────────────────────────────────
test('snapshotFromState distills the fields we diff', () => {
    const { BP } = load();
    const s = BP.snapshotFromState({ fingerprint: 'abc', players: ['1001'], record: '5-1', tier: 'ELITE', draft: { phase: 'in-season' }, rank: 3, extra: 'ignored' });
    eq(s.fingerprint, 'abc', 'fingerprint');
    eq(s.tier, 'ELITE', 'tier');
    eq(s.draftPhase, 'in-season', 'draft phase flattened');
    eq(s.rank, 3, 'carries power rank');
    ok(!('extra' in s), 'drops unrelated fields');
});
test('snapshotFromState(null) is null', () => {
    const { BP } = load();
    eq(BP.snapshotFromState(null), null, 'null-safe');
});

test('snapshots round-trip through localStorage', () => {
    const { BP } = load();
    eq(BP.loadSnapshot('L1'), null, 'nothing stored yet');
    BP.saveSnapshot('L1', snap());
    const back = BP.loadSnapshot('L1');
    ok(back && back.record === '6-2', 'loads what was saved');
    eq(BP.loadSnapshot('L2'), null, 'scoped per league');
});

// ── Component inertness ─────────────────────────────────────────────
test('Line returns null when React is absent', () => {
    const { BP } = load({ react: null });
    eq(BP.Line({ league: {}, roster: {} }), null, 'no React → null');
});

test('Line returns null when the Situation Room flag is OFF', () => {
    // Minimal React mock: hooks must be callable, createElement returns a marker.
    const react = {
        createElement: (t) => ({ _el: t }),
        useState: (init) => [init, () => {}],
        useEffect: () => {},
    };
    const { BP } = load({ react, roomEnabled: false, roomState: { leagueId: 'L1', fingerprint: 'fp', players: ['1001'], record: '6-2', tier: 'CONTENDER', draft: { phase: 'in-season' } } });
    eq(BP.Line({ league: { league_id: 'L1' }, roster: { roster_id: 1 }, playersData: PLAYERS }), null, 'flag off → inert null');
});

// ── Report ──────────────────────────────────────────────────────────
process.stdout.write('\n\n');
if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`\nBrief Pulse contract: ${passed} passed, ${failed} FAILED\n`);
    process.exit(1);
} else {
    console.log(`Brief Pulse contract: ${passed} passed\n`);
    process.exit(0);
}

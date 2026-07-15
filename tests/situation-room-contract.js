#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// tests/situation-room-contract.js
// Contract for js/shared/situation-room.js (WR.SituationRoom).
//
// Proves the Phase-1 guarantees the whole "AI Conductor" rests on:
//   1. Assembles a canonical team-state object from mocked globals
//      without throwing, even when dependencies are absent.
//   2. The fingerprint is STABLE when nothing material changed.
//   3. The fingerprint CHANGES on the events the owner named:
//      a trade/add-drop (roster players move), the draft occurring
//      (players + draft phase move), a record shift, a strategy edit,
//      the NFL week turning.
//   4. get() reports changed=false on first sight, changed=true only
//      when a league's fingerprint actually moves; switching leagues
//      is not a "change".
//   5. The module is inert when flagged off (no throw, no event) and
//      never takes a page down.
//
// No npm dependencies — Node built-ins + a vm sandbox, matching the
// other *-contract.js tests.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
    try {
        fn();
        passed++;
        process.stdout.write('.');
    } catch (err) {
        failed++;
        failures.push(`  FAIL: ${name}\n        ${err.message}`);
        process.stdout.write('F');
    }
}

function ok(value, label) {
    if (!value) throw new Error(label || 'expected truthy value');
}
function eq(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label || 'mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}
function ne(actual, expected, label) {
    if (actual === expected) {
        throw new Error(`${label || 'expected difference'}: both were ${JSON.stringify(actual)}`);
    }
}

function makeStorage() {
    const store = {};
    return {
        getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: k => { delete store[k]; },
        _store: store,
    };
}

// Fresh sandbox per scenario so module state (_byLeague) never leaks
// between tests. Returns the sandbox's WR.SituationRoom plus hooks to
// mutate the mocked globals it reads.
function loadRoom(opts) {
    opts = opts || {};
    const localStorage = makeStorage();
    const events = [];
    const ctx = {
        console, Date, Math, JSON, Object, Array, Number, String, Boolean,
        Set, Map, parseInt, parseFloat, isNaN, localStorage,
        window: null,
        CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    };
    ctx.window = ctx;
    ctx.window.dispatchEvent = (ev) => { events.push(ev); return true; };

    // Mocked app globals the Room reads (all optional / fail-safe).
    ctx.window.__DHQ_SITUATION_ROOM = opts.flagOn === true ? true
        : opts.flagOff === true ? false : undefined;
    ctx.window.OD = { getCurrentUsername: () => opts.username || '' };
    ctx.window.S = { nflState: { week: opts.week != null ? opts.week : 3 }, currentWeek: opts.week != null ? opts.week : 3, myUserId: opts.myUserId || null };
    ctx.window.WR = {
        AIContext: {
            detectFormat: () => ({ isSuperFlex: true, numQBSlots: 2, scoringType: 'ppr' }),
            buildStructuredBase: (league, a, roster) => ({ leagueId: league && (league.league_id || league.id), stateHash: 'x' }),
        },
        GmMode: { promptBlock: () => opts.gmStrategy || '' },
    };
    ctx.window.assessTeamFromGlobal = () => opts.assessment || { tier: 'contender', window: 'win-now', healthScore: 82, needs: [{ pos: 'RB' }] };

    const code = fs.readFileSync(path.join(ROOT, 'js/shared/situation-room.js'), 'utf8');
    vm.runInNewContext(code, ctx, { filename: 'situation-room.js' });

    ok(ctx.window.WR.SituationRoom, 'WR.SituationRoom must be defined');
    return { SR: ctx.window.WR.SituationRoom, events, ctx };
}

// A baseline Sleeper-ish league + roster.
function league(over) {
    return Object.assign({
        league_id: 'L1', name: 'Dynasty League',
        roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'FLEX'],
        scoring_settings: { rec: 1 },
    }, over || {});
}
function roster(over) {
    return Object.assign({
        roster_id: 4,
        players: ['1001', '1002', '1003', '1004'],
        settings: { wins: 6, losses: 2, ties: 0 },
    }, over || {});
}

// ── 1. Assembles without throwing, even bare ────────────────────────
test('assemble returns a shaped object from full globals', () => {
    const { SR } = loadRoom();
    const st = SR.assemble(league(), roster());
    eq(st.schemaVersion, 1, 'schemaVersion');
    eq(st.leagueId, 'L1', 'leagueId');
    eq(st.record, '6-2', 'record');
    eq(st.tier, 'contender', 'tier');
    ok(Array.isArray(st.players) && st.players.length === 4, 'players carried');
    ok(st.structured && st.structured.leagueId === 'L1', 'structured base reused');
    ok(Array.isArray(st.injuries), 'injuries field present (placeholder)');
    ok(st.draft && typeof st.draft.phase === 'string', 'draft signal present');
});

test('assemble never throws when every dependency is missing', () => {
    const { SR, ctx } = loadRoom();
    // Strip all optional globals.
    ctx.window.assessTeamFromGlobal = undefined;
    ctx.window.WR.AIContext = undefined;
    ctx.window.WR.GmMode = undefined;
    ctx.window.S = undefined;
    const st = SR.assemble(null, null);
    ok(st && st.schemaVersion === 1, 'still returns a state object');
    eq(st.leagueId, null, 'null league tolerated');
    eq(st.tier, '', 'missing assessor degrades to empty tier');
    ok(Array.isArray(st.players) && st.players.length === 0, 'no players, no throw');
});

// ── 2. Fingerprint stable when nothing changed ──────────────────────
test('fingerprint identical for identical state', () => {
    const { SR } = loadRoom();
    const a = SR.fingerprint(SR.assemble(league(), roster()));
    const b = SR.fingerprint(SR.assemble(league(), roster()));
    eq(a, b, 'same inputs → same fingerprint');
});

test('fingerprint is order-independent for the roster', () => {
    const { SR } = loadRoom();
    const a = SR.fingerprint(SR.assemble(league(), roster({ players: ['1001', '1002', '1003', '1004'] })));
    const b = SR.fingerprint(SR.assemble(league(), roster({ players: ['1004', '1002', '1001', '1003'] })));
    eq(a, b, 'reordered identical roster → same fingerprint');
});

// ── 3. Fingerprint changes on the owner's named events ──────────────
test('fingerprint changes on a trade / roster move', () => {
    const { SR } = loadRoom();
    const before = SR.fingerprint(SR.assemble(league(), roster()));
    const after = SR.fingerprint(SR.assemble(league(), roster({ players: ['1001', '1002', '1003', '9999'] })));
    ne(before, after, 'swapping a player must move the fingerprint');
});

test('fingerprint changes when the draft occurs', () => {
    const { SR } = loadRoom();
    // Pre-draft: no games, no players.
    const pre = SR.fingerprint(SR.assemble(league(), roster({ players: [], settings: { wins: 0, losses: 0, ties: 0 } })));
    // Drafted: rookies now on the roster.
    const post = SR.fingerprint(SR.assemble(league(), roster({ players: ['r1', 'r2', 'r3'], settings: { wins: 0, losses: 0, ties: 0 } })));
    ne(pre, post, 'draft filling the roster must move the fingerprint');
});

test('fingerprint changes on a record shift', () => {
    const { SR } = loadRoom();
    const a = SR.fingerprint(SR.assemble(league(), roster({ settings: { wins: 6, losses: 2, ties: 0 } })));
    const b = SR.fingerprint(SR.assemble(league(), roster({ settings: { wins: 7, losses: 2, ties: 0 } })));
    ne(a, b, 'a win must move the fingerprint');
});

test('fingerprint changes on a strategy edit', () => {
    const base = loadRoom();
    const edited = loadRoom({ gmStrategy: 'SELL: aging RBs. BUY: young WRs.' });
    const a = base.SR.fingerprint(base.SR.assemble(league(), roster()));
    const b = edited.SR.fingerprint(edited.SR.assemble(league(), roster()));
    ne(a, b, 'a GM strategy change must move the fingerprint');
});

test('fingerprint changes when the NFL week turns', () => {
    const w3 = loadRoom({ week: 3 });
    const w4 = loadRoom({ week: 4 });
    const a = w3.SR.fingerprint(w3.SR.assemble(league(), roster()));
    const b = w4.SR.fingerprint(w4.SR.assemble(league(), roster()));
    ne(a, b, 'week rollover must move the fingerprint');
});

// ── 4. get(): change detection per league ───────────────────────────
test('get() reports first=true, changed=false on first sight', () => {
    const { SR } = loadRoom();
    const r = SR.get(league(), roster());
    eq(r.first, true, 'first sighting');
    eq(r.changed, false, 'nothing to compare against yet');
    ok(r.fingerprint && r.state, 'returns state + fingerprint');
});

test('get() reports changed=false when re-run with no change', () => {
    const { SR } = loadRoom();
    SR.get(league(), roster());
    const r2 = SR.get(league(), roster());
    eq(r2.first, false, 'seen before');
    eq(r2.changed, false, 'identical state is not a change');
});

test('get() reports changed=true after a material change', () => {
    const { SR } = loadRoom();
    SR.get(league(), roster());
    const r2 = SR.get(league(), roster({ players: ['1001', '1002', '1003', '9999'] }));
    eq(r2.changed, true, 'roster move flips changed');
});

test('get() does not treat switching leagues as a change', () => {
    const { SR } = loadRoom();
    SR.get(league({ league_id: 'L1' }), roster());
    const other = SR.get(league({ league_id: 'L2' }), roster({ players: ['a', 'b'] }));
    eq(other.first, true, 'a different league is first-seen, not changed');
    eq(other.changed, false, 'cross-league is never a change');
});

test('peek() returns the last snapshot without recompute', () => {
    const { SR } = loadRoom();
    ok(SR.peek('L1') === null, 'nothing cached before get()');
    SR.get(league(), roster());
    const p = SR.peek('L1');
    ok(p && p.leagueId === 'L1', 'peek returns cached state');
});

// ── 5. Flag behavior + event emission ───────────────────────────────
test('enabled() is false by default, true with force flag / owner', () => {
    eq(loadRoom().SR.enabled(), false, 'off for everyone by default');
    eq(loadRoom({ flagOn: true }).SR.enabled(), true, 'window force-on');
    eq(loadRoom({ username: 'BigLoco' }).SR.enabled(), true, 'QA owner account on (case-insensitive)');
    eq(loadRoom({ username: 'skjjcruz' }).SR.enabled(), true, 'app owner account on');
    eq(loadRoom({ username: 'SKJJCRUZ' }).SR.enabled(), true, 'app owner account on (case-insensitive)');
    eq(loadRoom({ username: 'someone_else' }).SR.enabled(), false, 'non-owner stays off');
    eq(loadRoom({ username: 'a_different_handle', myUserId: '540392203863576576' }).SR.enabled(), true, 'owner Sleeper user_id on even when the typed handle differs');
    eq(loadRoom({ username: 'nobody', myUserId: '111' }).SR.enabled(), false, 'non-owner user_id stays off');
    eq(loadRoom({ username: 'bigloco', flagOff: true }).SR.enabled(), false, 'explicit off overrides owner');
});

test('fires dhq:situation-changed ONLY when flag is on and state changed', () => {
    // Flag off: a real change must fire nothing.
    const off = loadRoom({ flagOff: true });
    off.SR.get(league(), roster());
    off.SR.get(league(), roster({ players: ['1001', '1002', '1003', '9999'] }));
    eq(off.events.length, 0, 'flagged off → inert, no event');

    // Flag on: a real change fires exactly one event with detail.
    const on = loadRoom({ flagOn: true });
    on.SR.get(league(), roster());
    on.SR.get(league(), roster({ players: ['1001', '1002', '1003', '9999'] }));
    eq(on.events.length, 1, 'flagged on → one change event');
    eq(on.events[0].type, 'dhq:situation-changed', 'event name');
    ok(on.events[0].detail && on.events[0].detail.fingerprint, 'event carries fingerprint');
});

test('no event on an unchanged re-run even with flag on', () => {
    const on = loadRoom({ flagOn: true });
    on.SR.get(league(), roster());
    on.SR.get(league(), roster());
    eq(on.events.length, 0, 'no change → no event');
});

// ── Report ──────────────────────────────────────────────────────────
process.stdout.write('\n\n');
if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`\nSituation Room contract: ${passed} passed, ${failed} FAILED\n`);
    process.exit(1);
} else {
    console.log(`Situation Room contract: ${passed} passed\n`);
    process.exit(0);
}

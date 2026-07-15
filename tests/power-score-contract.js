#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// tests/power-score-contract.js
// Contract for the blended Power Score in the assessment engine
// (team-assess.js assessAllTeams). This is the single "where you stand"
// number every surface reads — the command brief, the Power Rankings
// widget, the elites badge, and Alex — so it must be exact and stable.
//
// Proves:
//   1. Every assessment carries totalDHQ, assetScore, powerScore, powerRank.
//   2. assetScore = round(100 * totalDHQ / maxDHQ)  (0-100, league-scaled).
//   3. powerScore = round(0.6*healthScore + 0.4*assetScore).
//   4. powerRank is the deterministic order of powerScore (tiebreak DHQ, id).
//   5. Recomputing yields identical ranks (no flicker).
//
// Loads the vendored engine (reconai-shared/team-assess.js, present after
// build:preview) or falls back to the sibling DHQ-Shared source.
// ════════════════════════════════════════════════════════════════
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CANDIDATES = [
    path.join(ROOT, 'reconai-shared/team-assess.js'),
    path.join(ROOT, '../DHQ-Shared/team-assess.js'),
];
const enginePath = CANDIDATES.find(p => fs.existsSync(p));

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
    try { fn(); passed++; process.stdout.write('.'); }
    catch (e) { failed++; failures.push(`  FAIL: ${name}\n        ${e.message}`); process.stdout.write('F'); }
}
function ok(v, l) { if (!v) throw new Error(l || 'expected truthy'); }
function eq(a, b, l) { if (a !== b) throw new Error(`${l || 'mismatch'}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

function buildEngine() {
    const ctx = {
        console, Date, Math, JSON, Object, Array, Number, String, Boolean,
        Set, Map, parseInt, parseFloat, isNaN, RegExp, window: null,
    };
    ctx.window = ctx;
    const players = {}, scores = {};
    function team(rid, ids, perVal) {
        ids.forEach((pid, i) => {
            players[pid] = { player_id: pid, position: ['QB', 'RB', 'WR', 'TE'][i % 4], full_name: pid, active: true, team: 'X' };
            scores[pid] = perVal;
        });
        return { roster_id: rid, owner_id: 'u' + rid, players: ids, settings: { wins: 5, losses: 5, ties: 0 } };
    }
    const rosters = [
        team(1, ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'], 2000), // 12000
        team(2, ['b1', 'b2', 'b3', 'b4', 'b5', 'b6'], 1500), // 9000
        team(3, ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], 1000), // 6000
        team(4, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'], 500),  // 3000
    ];
    ctx.window.dynastyValue = pid => scores[pid] || 0;
    ctx.window.App = { LI: { playerScores: scores, builtAt: 't1', ownerProfiles: {} } };
    ctx.window.S = {
        rosters, players, playerStats: {},
        leagueUsers: rosters.map(r => ({ user_id: r.owner_id, display_name: 'T' + r.roster_id })),
        currentLeagueId: 'L1', tradedPicks: [], myRosterId: 1, nflState: { week: 1 }, currentWeek: 1,
        leagues: [{ league_id: 'L1', name: 'L', roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX'], scoring_settings: { rec: 1 } }],
    };
    vm.runInNewContext(fs.readFileSync(enginePath, 'utf8'), ctx, { filename: 'team-assess.js' });
    return ctx.window;
}

if (!enginePath) {
    console.log('\nPower Score contract: SKIPPED (team-assess.js not found — run after build:preview)\n');
    process.exit(0);
}

const win = buildEngine();
const all = win.assessAllTeamsFromGlobal();
const maxDHQ = Math.max(...all.map(a => a.totalDHQ || 0));

test('every assessment carries the blended fields', () => {
    ok(all.length === 4, 'four teams');
    all.forEach(a => {
        ok(typeof a.totalDHQ === 'number', 'totalDHQ');
        ok(typeof a.assetScore === 'number', 'assetScore');
        ok(typeof a.powerScore === 'number', 'powerScore');
        ok(typeof a.powerRank === 'number' && a.powerRank >= 1, 'powerRank');
    });
});

test('assetScore = round(100 * totalDHQ / maxDHQ)', () => {
    all.forEach(a => eq(a.assetScore, Math.round(100 * a.totalDHQ / maxDHQ), 'asset rid ' + a.rosterId));
});

test('powerScore = round(0.6*health + 0.4*asset)', () => {
    all.forEach(a => eq(a.powerScore, Math.round(0.6 * (a.healthScore || 0) + 0.4 * a.assetScore), 'power rid ' + a.rosterId));
});

test('powerRank is the deterministic powerScore order', () => {
    const byScore = [...all].sort((x, y) =>
        (y.powerScore - x.powerScore) || (y.totalDHQ - x.totalDHQ) || String(x.rosterId).localeCompare(String(y.rosterId)));
    byScore.forEach((a, i) => eq(a.powerRank, i + 1, 'rank position ' + i));
});

test('every rank is unique (1..N)', () => {
    const ranks = all.map(a => a.powerRank).sort((x, y) => x - y);
    eq(JSON.stringify(ranks), JSON.stringify([1, 2, 3, 4]), 'ranks');
});

test('recompute yields identical ranks (no flicker)', () => {
    const again = win.assessAllTeamsFromGlobal();
    const map = {}; again.forEach(a => { map[a.rosterId] = a.powerRank; });
    all.forEach(a => eq(map[a.rosterId], a.powerRank, 'stable rid ' + a.rosterId));
});

process.stdout.write('\n\n');
if (failures.length) {
    console.log(failures.join('\n'));
    console.log(`\nPower Score contract: ${passed} passed, ${failed} FAILED\n`);
    process.exit(1);
} else {
    console.log(`Power Score contract: ${passed} passed\n`);
    process.exit(0);
}

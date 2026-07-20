#!/usr/bin/env node
'use strict';
// tests/player-brief-contract.js
// Contract for js/shared/player-brief.js (WR.PlayerBrief) — the DHQ Composer,
// Phase 1 of the Player Summary initiative. The one promise that matters:
// EVERY player — starter, rookie, kicker, injured vet, name-only stub —
// composes to a readable, current paragraph with no 'undefined'/'NaN' leaks.
// Pure module, so it runs in a bare VM sandbox (brief-pulse pattern).

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg) {
    if (cond) { passed++; process.stdout.write('.'); }
    else { failed++; console.error('\nFAIL: ' + msg); }
}
function match(text, re, msg) { ok(re.test(text), msg + ' — got: ' + String(text).slice(0, 160)); }
function noLeaks(text, msg) { ok(!/undefined|NaN|\[object/.test(text), msg + ' (no undefined/NaN) — got: ' + String(text).slice(0, 160)); }
function test(name, fn) { try { fn(); } catch (e) { failed++; console.error('\nFAIL (threw): ' + name + ' — ' + e.message); } }

function load() {
    const ctx = { console, JSON, Object, Array, Number, String, Boolean, Math, isFinite, window: null };
    ctx.window = ctx;
    const code = fs.readFileSync(path.join(ROOT, 'js/shared/player-brief.js'), 'utf8');
    vm.runInNewContext(code, ctx, { filename: 'player-brief.js' });
    ok(ctx.window.WR && ctx.window.WR.PlayerBrief, 'WR.PlayerBrief defined');
    return ctx.window.WR.PlayerBrief;
}
const PB = load();

// ── The universal guarantee ─────────────────────────────────────────
test('full starter composes a detailed multi-sentence paragraph', () => {
    const r = PB.compose({
        player: { full_name: 'Puka Nacua', last_name: 'Nacua', team: 'LAR', position: 'WR', age: 25, years_exp: 3, college: 'BYU', depth_chart_order: 1 },
        pos: 'WR', dhq: 6877, ppg: 18.2,
        meta: { careerPPG: 15.9, trend: 14, starterSeasons: 3, recentGP: 16, roleLabel: 'Locked-in starter' },
        posRank: 3, posTotal: 279, phaseLabel: 'Prime', peakYrs: 3,
    });
    ok(r.text.length >= 300, 'detailed (≥300 chars) — got ' + r.text.length);
    ok(r.sentences.length >= 4, 'multi-sentence — got ' + r.sentences.length);
    match(r.text, /Puka Nacua/, 'names the player');
    match(r.text, /WR1/, 'depth slot is 1-based (starter = WR1, not WR2)');
    match(r.text, /18\.2/, 'current PPG');
    match(r.text, /6,877/, 'DHQ value formatted');
    match(r.text, /WR3 of 279/, 'position rank');
    match(r.text, /prime/i, 'age-curve phase');
    noLeaks(r.text, 'starter paragraph clean');
});

test('kicker gets the streamable framing, never asset hype', () => {
    const r = PB.compose({
        player: { full_name: 'Ryan Fitzgerald', team: 'CAR', position: 'K', age: 24, years_exp: 1, depth_chart_order: 1 },
        pos: 'K', dhq: 43, ppg: 9.1, meta: {}, phaseLabel: 'Rising', peakYrs: 5,
    });
    match(r.text, /stream/i, 'says streamable');
    match(r.text, /don.t spend trade capital/i, 'warns off trade capital');
    noLeaks(r.text, 'kicker paragraph clean');
});

test('injured player surfaces status, body part, and notes', () => {
    const r = PB.compose({
        player: { full_name: 'Test Vet', team: 'DAL', position: 'RB', age: 27, years_exp: 5, injury_status: 'Questionable', injury_body_part: 'Hamstring', injury_notes: 'Limited in Wednesday practice' },
        pos: 'RB', dhq: 4100, ppg: 12.4, meta: { careerPPG: 13.0 }, phaseLabel: 'Prime', peakYrs: 2,
    });
    match(r.text, /Questionable/, 'injury status');
    match(r.text, /hamstring/, 'body part lowercased');
    match(r.text, /Limited in Wednesday practice/, 'practice notes');
    noLeaks(r.text, 'injured paragraph clean');
});

test('rookie with no production leans on pedigree, still a paragraph', () => {
    const r = PB.compose({
        player: { full_name: 'Fresh Rookie', team: 'CHI', position: 'WR', age: 22, years_exp: 0, college: 'Ohio State', depth_chart_order: 4 },
        pos: 'WR', dhq: 1200, meta: {}, phaseLabel: 'Rising', peakYrs: 7,
    });
    match(r.text, /rookie season/i, 'rookie framing');
    match(r.text, /Ohio State/, 'college for young players');
    match(r.text, /no meaningful NFL production/i, 'honest no-data line');
    ok(r.sentences.length >= 3, 'still ≥3 sentences');
    noLeaks(r.text, 'rookie paragraph clean');
});

test('name-and-position stub still composes a readable paragraph', () => {
    const r = PB.compose({ player: { full_name: 'Deep Stash', position: 'LB' }, pos: 'LB' });
    ok(r.text.length >= 150, 'stub still ≥150 chars — got ' + r.text.length);
    ok(r.sentences.length >= 3, 'stub still ≥3 sentences');
    match(r.text, /free agent/i, 'no team → unsigned framing');
    match(r.text, /no market value|off the trade radar/i, 'no DHQ → honest zero-value line');
    noLeaks(r.text, 'stub paragraph clean');
});

test('totally empty input never throws and still writes something', () => {
    const r = PB.compose({});
    ok(r.text.length >= 100, 'empty input ≥100 chars — got ' + r.text.length);
    noLeaks(r.text, 'empty-input paragraph clean');
});

// ── Voice + phrasing branches ───────────────────────────────────────
test('post-window vet gets win-now rental framing', () => {
    const r = PB.compose({
        player: { full_name: 'Old Guard', team: 'KC', position: 'RB', age: 31, years_exp: 9, depth_chart_order: 2 },
        pos: 'RB', dhq: 900, ppg: 8.0, meta: { careerPPG: 14.5 }, phaseLabel: 'Post-Window', peakYrs: 0,
    });
    match(r.text, /production-only|win-now rental/i, 'post-window verdict');
    ok(!/peak years left/.test(r.text), 'no peak-years claim past the window');
    noLeaks(r.text, 'vet paragraph clean');
});

test('a rising depth-chart STARTER never reads as a stash (Abdul Carter case)', () => {
    const r = PB.compose({
        player: { full_name: 'Abdul Carter', team: 'NYG', position: 'DL', age: 22, years_exp: 1, college: 'Penn State', depth_chart_order: 1 },
        pos: 'DL', dhq: 1656, ppg: 5.2, meta: { roleLabel: 'ROLB1' }, posRank: 18, posTotal: 400, phaseLabel: 'Rising', peakYrs: 7,
    });
    match(r.text, /already a starting piece/i, 'ascending-starter framing');
    ok(!/developmental stash|if the role comes/i.test(r.text), 'no stash contradiction for a starter');
    noLeaks(r.text, 'starter verdict clean');
});

test('a rising backup still reads as a developmental stash', () => {
    const r = PB.compose({
        player: { full_name: 'Bench Kid', team: 'NYG', position: 'DL', age: 22, years_exp: 1, depth_chart_order: 3 },
        pos: 'DL', dhq: 900, ppg: 2.0, meta: {}, phaseLabel: 'Rising', peakYrs: 7,
    });
    match(r.text, /developmental stash/i, 'backup keeps stash framing');
});

test('starter detection works from the role label alone — and WR11 is not WR1', () => {
    const viaRole = PB.compose({ player: { full_name: 'No Slot', team: 'KC', position: 'LB' }, pos: 'LB', dhq: 1200, ppg: 6, meta: { roleLabel: 'MLB1' }, phaseLabel: 'Rising', peakYrs: 5 });
    match(viaRole.text, /already a starting piece/i, 'MLB1 role → starter');
    const deep = PB.compose({ player: { full_name: 'Deep Wideout', team: 'KC', position: 'WR' }, pos: 'WR', dhq: 400, ppg: 1, meta: { roleLabel: 'WR11' }, phaseLabel: 'Rising', peakYrs: 6 });
    ok(!/already a starting piece/i.test(deep.text), 'WR11 does not trip the starter branch');
});

test('opportunity blockers are named in the outlook', () => {
    const r = PB.compose({
        player: { full_name: 'Backup Talent', team: 'SF', position: 'RB', age: 23, years_exp: 1, depth_chart_order: 2 },
        pos: 'RB', dhq: 2100, ppg: 5.5, meta: { opportunityBlockers: ['Christian McCaffrey'] }, phaseLabel: 'Rising', peakYrs: 5,
    });
    match(r.text, /path runs through Christian McCaffrey/, 'blocker named');
    noLeaks(r.text, 'blocker paragraph clean');
});

test('engine status reason leads the verdict when present', () => {
    const r = PB.compose({
        player: { full_name: 'Suspended Guy', team: 'NYJ', position: 'WR', age: 26, years_exp: 4 },
        pos: 'WR', dhq: 1500, ppg: 0, meta: { statusReason: 'Suspended 6 games — value capped until reinstatement' }, phaseLabel: 'Prime', peakYrs: 3,
    });
    match(r.text, /Suspended 6 games/, 'status reason surfaced');
    noLeaks(r.text, 'status paragraph clean');
});

// ── Market pulse (Phase 3) ──────────────────────────────────────────
test('a real 30-day market move is written as a percentage', () => {
    const base = { player: { full_name: 'Market Mover', team: 'CIN', position: 'WR', age: 24, years_exp: 2, depth_chart_order: 1 }, pos: 'WR', dhq: 5000, ppg: 14, meta: {}, phaseLabel: 'Rising', peakYrs: 5 };
    const up = PB.compose({ ...base, market: { value: 8000, trend30Day: 400 } });
    match(up.text, /up about 5% over the last 30 days/, 'upward move → +5%');
    const down = PB.compose({ ...base, market: { value: 8000, trend30Day: -960 } });
    match(down.text, /down about 12% over the last 30 days/, 'downward move → −12%');
    noLeaks(up.text, 'market paragraph clean');
});

test('a flat market reads as holding steady; absent market adds nothing', () => {
    const base = { player: { full_name: 'Steady Eddie', team: 'GB', position: 'TE', age: 25, years_exp: 3, depth_chart_order: 1 }, pos: 'TE', dhq: 3000, ppg: 9, meta: {}, phaseLabel: 'Prime', peakYrs: 3 };
    const flat = PB.compose({ ...base, market: { value: 5000, trend30Day: 10 } });
    match(flat.text, /holding steady over the last 30 days/, 'sub-1% move → steady');
    const none = PB.compose(base);
    ok(!/30 days/.test(none.text), 'no market data → no market sentence');
});

test('deterministic: same input, same paragraph', () => {
    const input = { player: { full_name: 'Same Guy', team: 'MIA', position: 'TE', age: 24, years_exp: 2, depth_chart_order: 1 }, pos: 'TE', dhq: 3000, ppg: 10, meta: {}, phaseLabel: 'Rising', peakYrs: 4 };
    ok(PB.compose(input).text === PB.compose(input).text, 'byte-identical across calls');
});

// ── posRank helper ──────────────────────────────────────────────────
test('posRank ranks within normalized position only', () => {
    const playersData = { a: { position: 'WR' }, b: { position: 'WR' }, c: { position: 'RB' }, d: { position: 'WR' } };
    const scores = { a: 5000, b: 7000, c: 9000, d: 100 };
    const r = PB.posRank('a', playersData, scores, null);
    ok(r && r.rank === 2 && r.total === 3, 'WR a is 2 of 3 (RB excluded) — got ' + JSON.stringify(r));
    ok(PB.posRank('missing', playersData, scores, null) === null, 'unknown pid → null');
    ok(PB.posRank('d', { d: { position: 'WR' } }, { d: 0 }, null) === null, 'zero value → null (no rank without value)');
});

console.log('\n\nPlayer Brief contract: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);

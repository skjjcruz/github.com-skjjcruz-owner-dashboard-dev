#!/usr/bin/env node
'use strict';
// tests/player-wire-contract.js
// Contract for js/shared/player-wire.js (WR.PlayerWire) — Phase 2, the
// journalism layer. Promises under test: correct extraction of the Rotowire
// paragraph, espn_id resolution with the FantasyCalc crosswalk backfill,
// 24h/6h caching (positive/negative), retry-on-network-failure, and the
// fail-safe: every failure path resolves to null, never a throw.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function ok(cond, msg) {
    if (cond) { passed++; process.stdout.write('.'); }
    else { failed++; console.error('\nFAIL: ' + msg); }
}
async function test(name, fn) { try { await fn(); } catch (e) { failed++; console.error('\nFAIL (threw): ' + name + ' — ' + e.message); } }

function load() {
    const ctx = { console, JSON, Object, Array, Number, String, Boolean, Math, Date, isNaN, Promise, setTimeout, window: null, fetch: () => Promise.reject(new Error('unstubbed fetch')), localStorage: null };
    ctx.window = ctx;
    const code = fs.readFileSync(path.join(ROOT, 'js/shared/player-wire.js'), 'utf8');
    vm.runInNewContext(code, ctx, { filename: 'player-wire.js' });
    const PW = ctx.window.WR.PlayerWire;
    ok(!!PW, 'WR.PlayerWire defined');
    // Injected environment: in-memory store, scripted fetch, controllable clock.
    const calls = [];
    const mem = {};
    let nowMs = 1000000;
    PW._env.fetchJson = (url) => { calls.push(url); const h = handlers.find(x => url.includes(x.match)); return Promise.resolve(h ? h.reply(url) : null); };
    PW._env.store = { get: k => (k in mem ? JSON.parse(mem[k]) : null), set: (k, v) => { mem[k] = JSON.stringify(v); } };
    PW._env.now = () => nowMs;
    const handlers = [];
    return { PW, calls, mem, handlers, tick: ms => { nowMs += ms; } };
}

const OVERVIEW = { statistics: {}, news: {}, rotowire: {
    headline: 'Nacua is heading into the final season of his rookie contract…',
    story: 'Nacua has delivered elite production since entering the NFL, racking up 4,191 receiving yards through three regular seasons with the Rams, but some off-field concerns could be giving the Rams pause about extending the star wide receiver long-term.',
    description: 'short description',
    published: 'Fri Jul 17 08:16:46 PDT 2026',
} };

(async () => {

await test('extract pulls the story with attribution + date label', () => {
    const { PW } = load();
    const r = PW.extract(OVERVIEW);
    ok(r && r.story.startsWith('Nacua has delivered'), 'story extracted');
    ok(r.source === 'Rotowire via ESPN', 'attribution fixed');
    ok(r.dateLabel === 'Jul 17', 'date label — got ' + (r && r.dateLabel));
});

await test('extract rejects fragments and caps essays', () => {
    const { PW } = load();
    ok(PW.extract({ rotowire: { story: 'Too short.' } }) === null, 'short fragment → null');
    ok(PW.extract({}) === null, 'no rotowire → null');
    ok(PW.extract(null) === null, 'null overview → null');
    const long = PW.extract({ rotowire: { story: 'x'.repeat(60) + ' word '.repeat(600), published: '' } });
    ok(long && long.story.length <= 1400, 'story capped — got ' + (long && long.story.length));
});

await test('fetchRead resolves via the record espn_id and caches 24h', async () => {
    const { PW, calls, handlers } = load();
    handlers.push({ match: '/athletes/999/overview', reply: () => OVERVIEW });
    const pd = { p1: { espn_id: 999 } };
    const r1 = await PW.fetchRead('p1', pd);
    ok(r1 && r1.story.startsWith('Nacua'), 'first read fetched');
    const before = calls.length;
    const r2 = await PW.fetchRead('p1', pd);
    ok(r2 && r2.story === r1.story, 'second read identical');
    ok(calls.length === before, 'served from cache — no second network call');
});

await test('cache expires after 24h and refetches', async () => {
    const { PW, calls, handlers, tick } = load();
    handlers.push({ match: '/athletes/999/overview', reply: () => OVERVIEW });
    const pd = { p1: { espn_id: 999 } };
    await PW.fetchRead('p1', pd);
    tick(25 * 60 * 60 * 1000);
    const before = calls.length;
    await PW.fetchRead('p1', pd);
    ok(calls.length === before + 1, 'expired cache refetches');
});

await test('crosswalk backfills a missing espn_id from FantasyCalc', async () => {
    const { PW, calls, handlers } = load();
    handlers.push({ match: 'fantasycalc.com', reply: () => ([{ player: { sleeperId: '9493', espnId: '4426515' } }]) });
    handlers.push({ match: '/athletes/4426515/overview', reply: () => OVERVIEW });
    const pd = { 9493: { full_name: 'Puka Nacua', espn_id: null } };
    const r = await PW.fetchRead('9493', pd);
    ok(r && r.story.startsWith('Nacua'), 'crosswalk-resolved read');
    ok(calls.some(u => u.includes('fantasycalc')), 'crosswalk fetched');
    // Crosswalk is cached: a second unknown pid must not refetch it.
    const before = calls.filter(u => u.includes('fantasycalc')).length;
    await PW.fetchRead('unknown_pid', { unknown_pid: {} });
    ok(calls.filter(u => u.includes('fantasycalc')).length === before, 'crosswalk cached');
});

await test('no id anywhere → null without hitting the overview endpoint', async () => {
    const { PW, calls, handlers } = load();
    handlers.push({ match: 'fantasycalc.com', reply: () => ([]) });
    const r = await PW.fetchRead('nobody', { nobody: {} });
    ok(r === null, 'unresolvable → null');
    ok(!calls.some(u => u.includes('/overview')), 'overview never called');
});

await test('no coverage → negative-cached 6h, then retried', async () => {
    const { PW, calls, handlers, tick } = load();
    handlers.push({ match: '/athletes/7/overview', reply: () => ({ statistics: {} }) });   // real payload, no rotowire
    const pd = { p: { espn_id: 7 } };
    ok(await PW.fetchRead('p', pd) === null, 'no coverage → null');
    const before = calls.length;
    ok(await PW.fetchRead('p', pd) === null, 'still null');
    ok(calls.length === before, 'negative-cached — no refetch inside 6h');
    tick(7 * 60 * 60 * 1000);
    await PW.fetchRead('p', pd);
    ok(calls.length === before + 1, 'retried after 6h');
});

await test('network failure → null and NOT negative-cached (next open retries)', async () => {
    const { PW, calls, handlers } = load();
    // no handler for the overview → fetchJson resolves null (network failure path)
    const pd = { p: { espn_id: 55 } };
    ok(await PW.fetchRead('p', pd) === null, 'failure → null, no throw');
    const before = calls.length;
    await PW.fetchRead('p', pd);
    ok(calls.length === before + 1, 'immediately retried on next open');
});

await test('dateLabel is defensive', () => {
    const { PW } = load();
    ok(PW.dateLabel('Fri Jul 17 08:16:46 PDT 2026') === 'Jul 17', 'ESPN format');
    ok(PW.dateLabel('') === '', 'empty → empty');
    ok(PW.dateLabel('garbage') === '', 'garbage → empty, no throw');
});

console.log('\n\nPlayer Wire contract: ' + passed + ' passed' + (failed ? ', ' + failed + ' FAILED' : ''));
process.exit(failed ? 1 : 0);
})();

#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// warroom/tests/run.js  — Core calculation regression tests
// Usage: node tests/run.js
// No npm dependencies required — uses only Node.js built-ins.
//
// Loads core.js and player-value.js into a sandboxed vm context
// with mocked globals (window, localStorage, React).
// Extracts computeWeightedDNA from trade-calc.js via string parsing
// (avoids JSX syntax errors — the rest of that file uses Babel/JSX).
// ════════════════════════════════════════════════════════════════
'use strict';

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// ── Mini test runner ──────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (e) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${e.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

// Assertion helpers
function eq(a, b, label) {
  if (a !== b) throw new Error(`${label || ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function near(a, b, tol, label) {
  if (Math.abs(a - b) > tol) throw new Error(`${label || ''}: expected ≈${b} (±${tol}), got ${a}`);
}
function ok(v, label) {
  if (!v) throw new Error(label || `expected truthy, got ${JSON.stringify(v)}`);
}

// ── Mock localStorage ─────────────────────────────────────────────
function makeStorage() {
  const s = {};
  return {
    getItem:    k => Object.prototype.hasOwnProperty.call(s, k) ? s[k] : null,
    setItem:    (k, v) => { s[k] = String(v); },
    removeItem: k => { delete s[k]; },
    clear:      () => { for (const k of Object.keys(s)) delete s[k]; },
    _store:     s,
  };
}

// ── vm context ────────────────────────────────────────────────────
// Mirrors the browser globals that core.js and player-value.js rely on.
function buildCtx() {
  const ls  = makeStorage();
  const ss  = makeStorage();
  const loc = { search: '', hostname: 'test.warroom', href: 'http://test.warroom/' };
  const ctx = {
    // React — only the API surface that core.js touches at module scope
    React: {
      createContext:  () => ({ Provider: null, Consumer: null }),
      useState:       () => [null, () => {}],
      useEffect:      () => {},
      useMemo:        () => null,
      useRef:         () => ({ current: null }),
      useCallback:    f  => f,
    },
    // Browser globals (location set via ctx.location below)
    localStorage:  ls,
    sessionStorage: ss,
    console,
    // JS builtins needed by the scripts
    Date, Math, Object, Array, Number, String, Boolean, JSON,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    URLSearchParams,
    Set, Map, Promise, Error,
    // Stubs for async / UI calls
    setTimeout:   fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
    fetch:        async () => ({ ok: true, json: async () => ({}) }),
    confirm:      () => false,
  };
  ctx.location   = loc;
  ctx.window     = ctx;   // window === global in browser
  ctx.self       = ctx;
  return vm.createContext(ctx);
}

// ── Script loader ─────────────────────────────────────────────────
function loadScript(ctx, relPath) {
  const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(code, ctx);
}

// ── Extract a top-level function by signature (brace-counted) ─────
// Scans forward from `sig`, counting { } to find the matching close.
function extractFunction(source, sig) {
  const idx = source.indexOf(sig);
  if (idx === -1) throw new Error(`extractFunction: "${sig}" not found in source`);
  let depth = 0, i = idx, opened = false;
  while (i < source.length) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(idx, i + 1); }
    i++;
  }
  throw new Error(`extractFunction: no matching close for "${sig}"`);
}

// ══════════════════════════════════════════════════════════════════
// Bootstrap: load scripts into sandboxed context
// ══════════════════════════════════════════════════════════════════
const ctx = buildCtx();
const ls  = ctx.localStorage;

process.stdout.write('  Loading core.js … ');
loadScript(ctx, 'js/core.js');
process.stdout.write('OK\n');

process.stdout.write('  Loading player-value.js … ');
loadScript(ctx, 'js/utils/player-value.js');
process.stdout.write('OK\n');

// trade-calc.js uses JSX throughout; extract only the pure function
process.stdout.write('  Extracting computeWeightedDNA … ');
const tradeCalcSrc = fs.readFileSync(path.join(ROOT, 'js/trade-calc.js'), 'utf8');
const dnaFnSrc = extractFunction(tradeCalcSrc, 'function computeWeightedDNA(rosterId)');
// `allRosters` is a React state variable in the enclosing component scope;
// stub it here so the frequency ratio never crashes when we override via LI.rosters.
vm.runInContext(`var allRosters = []; ${dnaFnSrc}`, ctx);
process.stdout.write('OK\n\n');

process.stdout.write('  Extracting buildEmpirePortfolioModel … ');
const globalViewSrc = fs.readFileSync(path.join(ROOT, 'js/tabs/global-view.js'), 'utf8');
const empireModelSrc = extractFunction(globalViewSrc, 'function buildEmpirePortfolioModel(input)');
vm.runInContext(empireModelSrc, ctx);
process.stdout.write('OK\n\n');

// ── Grab references from context ──────────────────────────────────
const { normPos, calcRawPts, calcPPG }                         = ctx.App;
const { getPickValue, projectPlayerValue, PICK_VALUES }        = ctx.App.PlayerValue;
const computeWeightedDNA                                       = ctx.computeWeightedDNA;
const buildEmpirePortfolioModel                                = ctx.buildEmpirePortfolioModel;
// getUserTier / canAccess are top-level function declarations in core.js
const getUserTier = ctx.getUserTier;
const canAccess   = ctx.canAccess;

// ══════════════════════════════════════════════════════════════════
// 1. normPos
// ══════════════════════════════════════════════════════════════════
group('normPos');
test('null → null',            () => eq(normPos(null),      null));
test('undefined → null',       () => eq(normPos(undefined), null));
test('empty string → null',    () => eq(normPos(''),        null));
// DB group
test('CB → DB',                () => eq(normPos('CB'),  'DB'));
test('S  → DB',                () => eq(normPos('S'),   'DB'));
test('SS → DB',                () => eq(normPos('SS'),  'DB'));
test('FS → DB',                () => eq(normPos('FS'),  'DB'));
test('DB → DB (canonical)',     () => eq(normPos('DB'),  'DB'));
// DL group
test('DE → DL',                () => eq(normPos('DE'),   'DL'));
test('DT → DL',                () => eq(normPos('DT'),   'DL'));
test('NT → DL',                () => eq(normPos('NT'),   'DL'));
test('IDL → DL',               () => eq(normPos('IDL'),  'DL'));
test('EDGE → DL',              () => eq(normPos('EDGE'), 'DL'));
test('DL → DL (canonical)',     () => eq(normPos('DL'),   'DL'));
// LB group
test('OLB → LB',               () => eq(normPos('OLB'), 'LB'));
test('ILB → LB',               () => eq(normPos('ILB'), 'LB'));
test('MLB → LB',               () => eq(normPos('MLB'), 'LB'));
test('LB → LB (canonical)',     () => eq(normPos('LB'),  'LB'));
// Skill positions pass through unchanged
test('QB passthrough',          () => eq(normPos('QB'),      'QB'));
test('RB passthrough',          () => eq(normPos('RB'),      'RB'));
test('WR passthrough',          () => eq(normPos('WR'),      'WR'));
test('TE passthrough',          () => eq(normPos('TE'),      'TE'));
test('K  passthrough',          () => eq(normPos('K'),       'K'));
test('unknown passthrough',     () => eq(normPos('UNKNOWN'), 'UNKNOWN'));

// ══════════════════════════════════════════════════════════════════
// 2. calcRawPts
// ══════════════════════════════════════════════════════════════════
group('calcRawPts');
test('null stats → null',
  () => eq(calcRawPts(null, null), null));
test('custom scoring: rush TD only',
  () => eq(calcRawPts({ rush_td: 2 }, { rush_td: 6 }), 12));
test('custom scoring: multi-stat (pass yds + TDs + INT)',
  () => {
    // 300 * 0.04 = 12 pts, 2 TDs * 4 = 8 pts, 1 INT * -2 = -2 pts → 18
    eq(calcRawPts({ pass_yd: 300, pass_td: 2, pass_int: 1 },
                  { pass_yd: 0.04, pass_td: 4, pass_int: -2 }), 18);
  });
test('custom scoring: non-numeric weight is skipped',
  () => eq(calcRawPts({ rush_yd: 100 }, { rush_yd: 'ten', pass_td: 4 }), 0));
test('custom scoring: missing stat field contributes 0',
  () => eq(calcRawPts({ rush_td: 1 }, { rush_td: 6, rec_td: 6 }), 6));
test('custom scoring: zero stat value contributes 0',
  () => eq(calcRawPts({ rush_td: 0, rec_td: 1 }, { rush_td: 6, rec_td: 6 }), 6));
test('fallback: uses pts_half_ppr',
  () => eq(calcRawPts({ pts_half_ppr: 22.5 }, null), 22.5));
test('fallback: pts_ppr when half_ppr absent',
  () => eq(calcRawPts({ pts_ppr: 20 }, null), 20));
test('fallback: pts_std when ppr absent',
  () => eq(calcRawPts({ pts_std: 18 }, null), 18));
test('fallback: all pre-calc absent → null',
  () => eq(calcRawPts({ rush_yd: 100 }, null), null));
test('fallback: pts_half_ppr preferred over pts_ppr',
  () => eq(calcRawPts({ pts_half_ppr: 22, pts_ppr: 25 }, null), 22));

// ══════════════════════════════════════════════════════════════════
// 3. calcPPG
// ══════════════════════════════════════════════════════════════════
group('calcPPG');
test('basic: raw ÷ gp',
  () => {
    // 200 yds * 0.04 = 8 pts over 4 games → 2 PPG
    eq(calcPPG({ pass_yd: 200, gp: 4 }, { pass_yd: 0.04 }), 2);
  });
test('gp = 0 → 0',
  () => eq(calcPPG({ pts_half_ppr: 100, gp: 0 }, null), 0));
test('gp absent → 0',
  () => eq(calcPPG({ pts_half_ppr: 100 }, null), 0));
test('null raw pts → 0',
  () => eq(calcPPG({ gp: 10 }, null), 0));
test('negative raw clamped to 0',
  () => ok(calcPPG({ pts_half_ppr: -10, gp: 5 }, null) === 0));
test('16-game season: 320 pts → 20 PPG',
  () => eq(calcPPG({ pts_half_ppr: 320, gp: 16 }, null), 20));

// ══════════════════════════════════════════════════════════════════
// 4. getUserTier + canAccess
// ══════════════════════════════════════════════════════════════════
group('getUserTier');
test('no profile → free',
  () => { ls.clear(); eq(getUserTier(), 'free'); });
test('tier = warroom → warroom',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom' })); eq(getUserTier(), 'warroom'); ls.clear(); });
test('tier = commissioner → commissioner',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'commissioner' })); eq(getUserTier(), 'commissioner'); ls.clear(); });
test('tier = power → pro',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'power' })); eq(getUserTier(), 'pro'); ls.clear(); });
test('tier = pro → pro',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'pro' })); eq(getUserTier(), 'pro'); ls.clear(); });
test('tier = scout → scout',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'scout' })); eq(getUserTier(), 'scout'); ls.clear(); });
test('tier = reconai → scout (legacy rename)',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'reconai' })); eq(getUserTier(), 'scout'); ls.clear(); });
test('malformed JSON profile → free',
  () => { ls.setItem('od_profile_v1', '{bad json{{'); eq(getUserTier(), 'free'); ls.clear(); });

group('canAccess');
test('free: my-roster-basic accessible',
  () => { ls.clear(); ok(canAccess('my-roster-basic')); });
test('free: draft-rankings accessible',
  () => { ls.clear(); ok(canAccess('draft-rankings')); });
test('free: ai-unlimited blocked',
  () => { ls.clear(); ok(!canAccess('ai-unlimited')); });
test('free: trade-finder blocked',
  () => { ls.clear(); ok(!canAccess('trade-finder')); });
test('free: owner-dna blocked',
  () => { ls.clear(); ok(!canAccess('owner-dna')); });
test('scout: ai-unlimited accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'scout' })); ok(canAccess('ai-unlimited')); ls.clear(); });
test('scout: waiver-targets accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'scout' })); ok(canAccess('waiver-targets')); ls.clear(); });
test('scout: trade-finder blocked',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'scout' })); ok(!canAccess('trade-finder')); ls.clear(); });
test('scout: owner-dna blocked',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'scout' })); ok(!canAccess('owner-dna')); ls.clear(); });
test('warroom: trade-finder accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom' })); ok(canAccess('trade-finder')); ls.clear(); });
test('warroom: owner-dna accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom' })); ok(canAccess('owner-dna')); ls.clear(); });
test('warroom: projections accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom' })); ok(canAccess('projections')); ls.clear(); });
test('warroom: analytics-full accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom' })); ok(canAccess('analytics-full')); ls.clear(); });
test('warroom: intelligence-full accessible',
  () => { ls.setItem('od_profile_v1', JSON.stringify({ tier: 'warroom' })); ok(canAccess('intelligence-full')); ls.clear(); });

// ══════════════════════════════════════════════════════════════════
// 5. getPickValue
// ══════════════════════════════════════════════════════════════════
group('getPickValue (fallback values, no DHQ engine)');
// Ensure no dhqPickValueFn is present so we hit the fallback table
ctx.App.LI = null;
test('round 1 → 6250',   () => eq(getPickValue(2025, 1, 12), 6250));
test('round 2 → 3150',   () => eq(getPickValue(2025, 2, 12), 3150));
test('round 3 → 1650',   () => eq(getPickValue(2025, 3, 12), 1650));
test('round 4 → 850',    () => eq(getPickValue(2025, 4, 12), 850));
test('round 5 → 450',    () => eq(getPickValue(2025, 5, 12), 450));
test('round 6 → 225',    () => eq(getPickValue(2025, 6, 12), 225));
test('round 7 → 125',    () => eq(getPickValue(2025, 7, 12), 125));
test('unknown round → 100', () => eq(getPickValue(2025, 9, 12), 100));
test('values are strictly decreasing by round', () => {
  for (let r = 1; r < 7; r++) {
    ok(getPickValue(2025, r, 12) > getPickValue(2025, r + 1, 12),
      `round ${r} should be worth more than round ${r + 1}`);
  }
});
test('dhqPickValueFn overrides fallback when present', () => {
  ctx.App.LI = { dhqPickValueFn: () => 9999 };
  eq(getPickValue(2025, 1, 12), 9999);
  ctx.App.LI = null;
});

// ══════════════════════════════════════════════════════════════════
// 6. projectPlayerValue
// ══════════════════════════════════════════════════════════════════
group('projectPlayerValue');
// Clear LI so isElitePlayer falls back to baseDhq >= 7000
ctx.App.LI = null;

test('delta = 0 → unchanged',
  () => eq(projectPlayerValue('p1', 5000, 25, 'WR', 0), 5000));
test('baseDhq = 0 → returns 0 (falsy guard)',
  () => eq(projectPlayerValue('p1', 0, 25, 'WR', 1), 0));
test('baseAge = 0 → returns baseDhq unchanged',
  () => eq(projectPlayerValue('p1', 5000, 0, 'WR', 1), 5000));

test('pre-peak player grows in value (WR age 19)',
  () => {
	    // WR peak: 25-28. Age 19 is pre-peak and should appreciate.
    const future = projectPlayerValue('p1', 4000, 19, 'WR', 1);
    ok(future > 4000, `pre-peak WR (${future}) should grow above 4000`);
  });

test('post-peak player declines in value (RB age 35)',
  () => {
	    // RB peak: 23-25, value band through 28. Age 35 is well past peak.
    const future = projectPlayerValue('p1', 4000, 35, 'RB', 1);
    ok(future < 4000, `post-peak RB (${future}) should decline below 4000`);
  });

test('RB decays faster than QB (same base, same post-peak age)',
  () => {
	    // RB post-window decay is steeper than QB post-window decay.
    const rbFuture = projectPlayerValue('p1', 5000, 35, 'RB', 1);
    const qbFuture = projectPlayerValue('p1', 5000, 35, 'QB', 1);
    ok(rbFuture < qbFuture,
      `RB (${rbFuture}) should decay more than QB (${qbFuture})`);
  });

test('WR decays faster than QB (same base, same post-peak age)',
  () => {
	    // WR post-window decay is steeper than QB post-window decay.
    const wrFuture = projectPlayerValue('p1', 5000, 35, 'WR', 1);
    const qbFuture = projectPlayerValue('p1', 5000, 35, 'QB', 1);
    ok(wrFuture < qbFuture,
      `WR (${wrFuture}) should decay more than QB (${qbFuture})`);
  });

test('projection ceiling is never exceeded (QB ceiling = 12000)',
  () => {
    // Project an elite young QB up from near ceiling
    for (let yr = 1; yr <= 5; yr++) {
      const result = projectPlayerValue('p1', 11000, 22, 'QB', yr);
      ok(result <= 12000, `year ${yr}: ${result} exceeds QB ceiling 12000`);
    }
  });

test('result is always a non-negative integer',
  () => {
    const cases = [
      ['p1', 5000, 25, 'WR',  1],
      ['p1', 5000, 35, 'RB',  2],
      ['p1', 8000, 28, 'QB',  3],
      ['p1', 3000, 40, 'TE',  1],
    ];
    for (const args of cases) {
      const v = projectPlayerValue(...args);
      ok(Number.isInteger(v) && v >= 0, `${JSON.stringify(args)} → ${v} is not a non-negative integer`);
    }
  });

test('historical retrojection: post-peak player worth more when younger (RB delta -2)',
  () => {
    // Age 35 RB was worth more 2 years ago (age 33 = closer to peak)
    const retro = projectPlayerValue('p1', 3000, 35, 'RB', -2);
    ok(retro > 3000, `retro (${retro}) should exceed current value`);
  });

test('position variants normalized: DE treated same as DL',
  () => {
    const de = projectPlayerValue('p1', 5000, 30, 'DE', 1);
    const dl = projectPlayerValue('p1', 5000, 30, 'DL', 1);
    eq(de, dl, 'DE and DL should produce identical projections');
  });

test('position variants normalized: CB treated same as DB',
  () => {
    const cb = projectPlayerValue('p1', 5000, 28, 'CB', 2);
    const db = projectPlayerValue('p1', 5000, 28, 'DB', 2);
    eq(cb, db, 'CB and DB should produce identical projections');
  });

test('position variants normalized: OLB treated same as LB',
  () => {
    const olb = projectPlayerValue('p1', 5000, 28, 'OLB', 2);
    const lb  = projectPlayerValue('p1', 5000, 28, 'LB',  2);
    eq(olb, lb, 'OLB and LB should produce identical projections');
  });

// ══════════════════════════════════════════════════════════════════
// 7. DHQ-Weighted average age formula
//    Source: league-detail.js (inline, not a named export)
//    Testing the formula directly to catch any copy/rounding regressions.
// ══════════════════════════════════════════════════════════════════
group('DHQ-weighted average age formula');
test('equal DHQ weights → arithmetic mean age',
  () => {
    const players = [
      { age: 24, dhq: 5000 },
      { age: 28, dhq: 5000 },
      { age: 32, dhq: 5000 },
    ];
    const totalDhq   = players.reduce((s, p) => s + p.dhq, 0);
    const weightedAge = players.reduce((s, p) => s + p.age * p.dhq, 0);
    const avg = totalDhq > 0 ? weightedAge / totalDhq : 26;
    near(avg, 28, 0.001, 'should equal arithmetic mean when all DHQ equal');
  });

test('high-DHQ player pulls weighted average toward their age',
  () => {
    // P1 age 22 DHQ 8000 — P2 age 30 DHQ 1000
    // Arithmetic mean = 26; weighted mean should be < 26 (biased toward 22)
    const players = [
      { age: 22, dhq: 8000 },
      { age: 30, dhq: 1000 },
    ];
    const totalDhq   = players.reduce((s, p) => s + p.dhq, 0);
    const weightedAge = players.reduce((s, p) => s + p.age * p.dhq, 0);
    const avg = weightedAge / totalDhq;
    ok(avg < 26, `weighted avg (${avg.toFixed(1)}) should be < arithmetic mean (26)`);
    near(avg, 22.89, 0.1, 'weighted average should be ≈22.9');
  });

test('totalDhq = 0 → fallback to 26',
  () => {
    const totalDhq = 0, weightedAge = 0;
    const avg = totalDhq > 0 ? weightedAge / totalDhq : 26;
    eq(avg, 26);
  });

test('missing age defaults to 26 (from source: playersData[pid]?.age || 26)',
  () => {
    const age = (undefined || 26);
    eq(age, 26);
  });

// ══════════════════════════════════════════════════════════════════
// 8. computeWeightedDNA
// ══════════════════════════════════════════════════════════════════
group('computeWeightedDNA');

// In trade data, sides[ownerId] = the assets that owner RECEIVES.
// sides[otherId] = the assets the other owner receives = what ownerId GIVES UP.
function makeTrade(rid1, rid2, side1, side2, week) {
  return {
    roster_ids: [rid1, rid2],
    week: week || 1,
    sides: { [rid1]: side1, [rid2]: side2 },
  };
}
function setupLI(overrides) {
  ctx.App.LI = Object.assign({
    tradeHistory:  [],
    ownerProfiles: {},
    rosters:       Array(10).fill({}),  // leagueSize = 10
    playerScores:  {},
  }, overrides);
}

test('fewer than 2 trades for roster → null',
  () => {
    setupLI({
      tradeHistory:  [makeTrade(1, 2, { players: [], picks: [] }, { players: [], picks: [] })],
      ownerProfiles: { 1: {} },
    });
    eq(computeWeightedDNA(1), null);
  });

test('no trades for roster → null',
  () => {
    setupLI({ tradeHistory: [makeTrade(2, 3, {}, {})] });
    eq(computeWeightedDNA(1), null);
  });

test('FLEECER: high win rate + high trade volume',
  () => {
    // 8 trades for roster 1 vs avgTrades = (8/10) = 0.8 → ratio 10 > 1.75 → FLEECER+3
    // Win rate 80% (8/10) > 0.55 → FLEECER+5; avgDiff 500 > 400 → FLEECER+4
    const trades = Array(8).fill(null).map((_, i) =>
      makeTrade(1, 2 + i, { players: [], picks: [] }, { players: [], picks: [] })
    );
    setupLI({
      tradeHistory:  trades,
      ownerProfiles: { 1: { tradesWon: 8, tradesLost: 0, tradesFair: 2, avgValueDiff: 500 } },
    });
    const r = computeWeightedDNA(1);
    ok(r !== null, 'should produce a DNA result');
    eq(r.key, 'FLEECER', `expected FLEECER, got ${r?.key}`);
    ok(r.confidence > 0 && r.confidence <= 92, `confidence ${r.confidence} out of [0,92]`);
    ok(typeof r.reasoning === 'string' && r.reasoning.length > 0, 'reasoning should be non-empty');
  });

test('STALWART: low trade volume + balanced value + fair trades',
  () => {
    // 2 trades for roster 1; 48 for others → avgTrades = 50/10 = 5, ratio = 2/5 = 0.4 < 0.5 → STALWART+4
    // fairRate 3/4 = 0.75 > 0.55 → STALWART+2; avgDiff 50, |50| ≤ 150 → STALWART+2
    const myTrades = [
      makeTrade(1, 2, { players: [], picks: [] }, { players: [], picks: [] }),
      makeTrade(1, 3, { players: [], picks: [] }, { players: [], picks: [] }),
    ];
    const otherTrades = Array(48).fill(null).map(() =>
      makeTrade(2, 3, {}, {})
    );
    setupLI({
      tradeHistory:  [...myTrades, ...otherTrades],
      ownerProfiles: { 1: { tradesWon: 1, tradesLost: 0, tradesFair: 3, avgValueDiff: 50 } },
    });
    const r = computeWeightedDNA(1);
    ok(r !== null, 'should produce a DNA result');
    eq(r.key, 'STALWART', `expected STALWART, got ${r?.key}`);
  });

test('DESPERATE: sells elite players + losing trades',
  () => {
    // sides[2].players = elite assets that the OTHER OWNER receives = what roster 1 gives up
    // → elitePlayersSent = 2 ≥ 2, elitePlayersReceived = 0 → DESPERATE+4
    // profile: lossRate 100% → ACCEPTOR+2, DESPERATE+2; avgDiff −600 < −300 → DESPERATE+3, ACCEPTOR+1
    const ep1 = 'elite1', ep2 = 'elite2';
    const t1 = makeTrade(1, 2,
      { players: [],  picks: [], totalValue: 1000 },   // roster 1 receives: minimal
      { players: [ep1, ep2], picks: [], totalValue: 11000 }, // roster 1 gives up: 2 elites
      12  // week ≥ 10 + theirValue (11000) > myValue (1000) × 1.15 → lateSeasonLoss
    );
    const t2 = makeTrade(1, 3,
      { players: [], picks: [], totalValue: 800 },
      { players: [], picks: [], totalValue: 800 },
      3
    );
    const otherTrades = Array(18).fill(null).map(() => makeTrade(2, 3, {}, {}));
    setupLI({
      tradeHistory:  [t1, t2, ...otherTrades],
      ownerProfiles: { 1: { tradesWon: 0, tradesLost: 2, tradesFair: 0, avgValueDiff: -600 } },
      playerScores:  { [ep1]: 6000, [ep2]: 7500 },
    });
    const r = computeWeightedDNA(1);
    ok(r !== null, 'should produce a DNA result');
    eq(r.key, 'DESPERATE', `expected DESPERATE, got ${r?.key}`);
  });

test('confidence always in [0, 92]',
  () => {
    // Run against multiple archetypes and verify bound
    const configs = [
      { tradeHistory: Array(8).fill(null).map((_, i) => makeTrade(1, 2 + i, {}, {})),
        ownerProfiles: { 1: { tradesWon: 7, tradesLost: 1, tradesFair: 0, avgValueDiff: 400 } } },
      { tradeHistory: [makeTrade(1, 2, {}, {}), makeTrade(1, 3, {}, {}), ...Array(18).fill(null).map(() => makeTrade(2,3,{},{}))],
        ownerProfiles: { 1: { tradesWon: 0, tradesLost: 2, tradesFair: 0, avgValueDiff: -400 } } },
    ];
    for (const cfg of configs) {
      setupLI(cfg);
      const r = computeWeightedDNA(1);
      if (r) ok(r.confidence >= 0 && r.confidence <= 92, `confidence ${r.confidence} out of [0,92]`);
    }
  });

test('source integrity: computeWeightedDNA signature unchanged in trade-calc.js',
  () => ok(tradeCalcSrc.includes('function computeWeightedDNA(rosterId)'),
           'function signature not found — update this test if function was renamed'));

// ══════════════════════════════════════════════════════════════════
// 9. buildEmpirePortfolioModel
// ══════════════════════════════════════════════════════════════════
group('buildEmpirePortfolioModel');

function empireFixture(overrides) {
  const base = {
    sleeperUserId: 'u1',
    nowYear: 2026,
    normPos,
    posColors: { QB: '#E74C3C', RB: '#2ECC71', WR: '#3498DB', TE: '#F0A500' },
    scores: { p1: 8000, p2: 5000, p3: 1000, p4: 2200 },
    playersData: {
      p1: { full_name: 'Jalen Hurts', position: 'QB', age: 30, team: 'PHI' },
      p2: { full_name: 'Bijan Robinson', position: 'RB', age: 24, team: 'ATL' },
      p3: { full_name: 'Veteran Tight End', position: 'TE', age: 34, team: 'FA' },
      p4: { full_name: 'Rookie Wideout', position: 'WR', age: 22, team: 'NYG' },
    },
    getAgeCurve: pos => ({
      QB: { build: [23, 27], peak: [28, 34], decline: [35, 38] },
      RB: { build: [21, 22], peak: [23, 25], decline: [26, 28] },
      WR: { build: [22, 24], peak: [25, 28], decline: [29, 31] },
      TE: { build: [23, 25], peak: [26, 29], decline: [30, 32] },
    }[pos] || { build: [22, 24], peak: [24, 29], decline: [30, 32] }),
    tradeValueTier: val => {
      if (val >= 7000) return { tier: 'Elite', col: '#2ECC71' };
      if (val >= 4000) return { tier: 'Starter', col: '#3498DB' };
      if (val >= 2000) return { tier: 'Depth', col: '#D4AF37' };
      if (val > 0) return { tier: 'Stash', col: 'rgba(255,255,255,0.58)' };
      return { tier: 'Unscored', col: 'rgba(255,255,255,0.38)' };
    },
    assessTeam: rid => rid === 1
      ? { healthScore: 82, tier: 'CONTENDER', needs: [{ pos: 'WR' }], strengths: ['QB'] }
      : { healthScore: 34, tier: 'REBUILDING', needs: ['RB'], strengths: ['Picks'] },
    allLeagues: [
      {
        id: 'l1',
        name: 'Alpha',
        season: '2026',
        settings: { draft_rounds: 4 },
        rosters: [
          { roster_id: 1, owner_id: 'u1', players: ['p1', 'p2', 'p3'], settings: { wins: 8, losses: 3 } },
          { roster_id: 2, owner_id: 'u2', players: [], settings: { wins: 3, losses: 8 } },
        ],
        tradedPicks: [
          { season: '2026', round: 1, roster_id: 1, owner_id: 2 },
          { season: '2026', round: 2, roster_id: 2, owner_id: 1 },
        ],
      },
      {
        id: 'l2',
        name: 'Beta',
        season: '2026',
        settings: { draft_rounds: 4 },
        rosters: [
          { roster_id: 3, owner_id: 'u1', players: ['p1', 'p4'], settings: { wins: 1, losses: 10 } },
          { roster_id: 4, owner_id: 'u3', players: [], settings: { wins: 10, losses: 1 } },
        ],
        tradedPicks: [],
      },
    ],
    liLoaded: true,
  };
  return Object.assign({}, base, overrides || {});
}

test('counts multi-league exposure by player',
  () => {
    const m = buildEmpirePortfolioModel(empireFixture());
    const hurts = m.exposure.find(p => p.pid === 'p1');
    ok(hurts, 'expected Jalen Hurts exposure row');
    eq(hurts.count, 2);
    eq(hurts.exposurePct, 100);
    eq(m.totals.exposureCount, 1);
  });

test('allocates positions by DHQ share when values are loaded',
  () => {
    const m = buildEmpirePortfolioModel(empireFixture());
    const qb = m.positionAllocation.find(p => p.key === 'QB');
    const rb = m.positionAllocation.find(p => p.key === 'RB');
    ok(qb && rb, 'expected QB and RB allocation rows');
    eq(qb.dhq, 16000);
    near(qb.share, 66, 1, 'QB share should use DHQ, not count');
    near(rb.share, 21, 1, 'RB share should reflect DHQ share');
  });

test('places assets into build, peak, and post-window buckets',
  () => {
    const m = buildEmpirePortfolioModel(empireFixture());
    const build = m.ageAllocation.find(a => a.key === 'build');
    const peak = m.ageAllocation.find(a => a.key === 'peak');
    const post = m.ageAllocation.find(a => a.key === 'post');
    ok(build && peak && post, 'expected build, peak, and post age buckets');
    eq(build.count, 1);
    eq(peak.count, 3);
    eq(post.count, 1);
  });

test('summarizes own, acquired, and premium draft capital',
  () => {
    const m = buildEmpirePortfolioModel(empireFixture());
    const alpha = m.provinces.find(p => p.id === 'l1');
    ok(alpha, 'expected Alpha league');
    eq(alpha.pickCount, 12);
    eq(alpha.ownPickCount, 11);
    eq(alpha.acquiredPickCount, 1);
    eq(alpha.premiumPickCount, 6);
    eq(m.pickCapital.byYear.find(y => y.year === 2026).premium, 4);
  });

test('marks DHQ as degraded when LI loaded but owned assets are unvalued',
  () => {
    const m = buildEmpirePortfolioModel(empireFixture({ scores: {} }));
    const dhq = m.dataQuality.items.find(i => i.key === 'dhq');
    ok(dhq, 'expected DHQ quality item');
    eq(dhq.status, 'degraded');
    eq(m.totals.useValueShare, false);
  });

// ══════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════
console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? '✗' : '✓';
console.log(`${status} ${passed + failed} tests — ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

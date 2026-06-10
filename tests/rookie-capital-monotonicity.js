#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// warroom/tests/rookie-capital-monotonicity.js
// Regression guard for offense (QB/RB/WR/TE) rookie dynasty value.
//
// BUG (confirmed live): rookies have no NFL stats, so their league score
// (fcVal = App.LI.playerScores[pid]) is 0. In draft-room.js the "rookies"
// memo therefore routes every drafted offense rookie to dhq = csv.dynastyValue,
// which computeStartupValue() sets to:
//     scoutVal = ladderValueAt(veteranLadder, rookiePosRank + offset)
// using ONLY in-class position rank — ignoring overall rank AND NFL draft
// capital. Position ladders are shallow and rookie classes are thin per
// position, so a late-round / low-ranked rookie gets a small rookiePosRank
// and lands on a rosterable veteran's score (e.g. Garrett Nussmeier, QB R7
// pick 249, base 190 → dyn 3859).
//
// IDP positions (DL/LB/DB) already got a capital-aware fix (the IDP_* blend).
// Offense did not. This test drives computeStartupValue() through the public
// getProspects() path (which calls enrichWithDynastyValue → computeStartupValue)
// against a realistic veteran ladder, and asserts:
//   (a) capital-monotonicity: within a position, a later-NFL-round rookie does
//       not out-value an earlier-round one with comparable-or-better scouting;
//   (b) an absolute ceiling: a late-round (R6-R7) / low-overall-rank rookie
//       cannot exceed a sane cap well below mid-tier veteran value.
//
// Loads the canonical reconai/shared/rookie-data.js (the same resolver the
// existing tests/rookie-data.js uses) into a sandboxed vm context with a
// mocked window/App, then seeds RookieData._cache with prospect fixtures.
//
// Usage: node tests/rookie-capital-monotonicity.js
// No npm dependencies — Node built-ins only.
// ════════════════════════════════════════════════════════════════
'use strict';

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ── Locate the canonical rookie-data.js (mirrors tests/rookie-data.js) ──
function resolveRookieDataPath() {
  const sharedSource = process.env.RECONAI_SHARED_SOURCE;
  const roots = [
    sharedSource && path.resolve(sharedSource, '..'),
    path.resolve(ROOT, '..', 'reconai'),
    path.resolve(ROOT, 'reconai-shared'),
  ].filter(Boolean);
  for (const root of roots) {
    const nested = path.join(root, 'shared', 'rookie-data.js');
    if (fs.existsSync(nested)) return nested;
    const flat = path.join(root, 'rookie-data.js');
    if (fs.existsSync(flat)) return flat;
  }
  return null;
}

// ── Mini test runner (matches tests/rookie-data.js style) ──────────
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

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

console.log('\nRookie capital-monotonicity tests');

const rookieDataPath = resolveRookieDataPath();
if (!rookieDataPath) {
  throw new Error('Unable to locate canonical rookie-data.js from RECONAI_SHARED_SOURCE, ../reconai, or reconai-shared/');
}

// ── Build a sandbox with a mocked window/App, load rookie-data.js ──
// rookie-data.js is a browser IIFE that hangs RookieData off window and reads
// window.App.LI.{playerScores,playerMeta} to build veteran position ladders.
function buildSandbox() {
  const ctx = {
    console,
    Math, Object, Array, Number, String, Boolean, JSON, Set, Map, Promise, Error,
    parseInt, parseFloat, isNaN, isFinite,
    encodeURIComponent, decodeURIComponent,
    URLSearchParams,
    fetch: async () => ({ ok: false, text: async () => '' }),
    setTimeout: fn => { if (typeof fn === 'function') fn(); return 0; },
    clearTimeout: () => {},
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.location = { search: '', href: 'http://test.warroom/', hostname: 'test.warroom' };
  ctx.App = {};
  vm.createContext(ctx);
  const code = fs.readFileSync(rookieDataPath, 'utf8');
  vm.runInContext(code, ctx);
  return ctx;
}

// ── Synthetic veteran ladders ──────────────────────────────────────
// Per-position descending score arrays standing in for the league's scored
// veterans (App.LI.playerScores). Depth/shape mirror what the live engine
// produces: a steep top, a long rosterable middle, a shallow tail. These are
// the ladders computeStartupValue() steps a rookie's posRank down.
//   - QB ladder is shallow (top guys ~9-10k, ~95 scored) — this shallowness is
//     exactly why an in-class-rank-only mapping inflates late-round QBs.
function buildLadder(top, count, floor) {
  // Geometric-ish decay from `top` down toward `floor` across `count` slots.
  const arr = [];
  for (let i = 0; i < count; i++) {
    const t = i / Math.max(1, count - 1);
    const v = Math.round(top * Math.pow(floor / top, t));
    arr.push(v);
  }
  return arr;
}

const VET_LADDERS = {
  QB: buildLadder(10200, 95, 120),
  RB: buildLadder(9300, 170, 60),
  WR: buildLadder(9000, 220, 40),
  TE: buildLadder(7600, 110, 50),
};

// Install the ladders as App.LI.playerScores + playerMeta. The ladder builder
// reads scores[pid] and meta[pid].pos, sorts desc per position — so insertion
// order does not matter, only the multiset of values per position.
function installVeteranPool(ctx) {
  const playerScores = {};
  const playerMeta = {};
  let pid = 1;
  Object.entries(VET_LADDERS).forEach(([pos, ladder]) => {
    ladder.forEach(score => {
      const key = `vet_${pid++}`;
      playerScores[key] = score;
      playerMeta[key] = { pos };
    });
  });
  ctx.App.LI = {
    playerScores,
    playerMeta,
    starterCounts: { QB: 1, RB: 2, WR: 3, TE: 1 },
  };
  // Single-QB league context (no superflex) — matches the live default that
  // produced the reported inflated numbers (uses VET_OFFSETS_ONE_QB).
  ctx.App.S = { currentLeagueId: 'L', leagues: [{ league_id: 'L', total_rosters: 12, roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'FLEX', 'BN'] }] };
}

// ── Prospect fixtures (from confirmed GROUND TRUTH) ────────────────
// Each fixture mirrors the shape buildProspect() emits and that
// computeStartupValue() reads: mappedPos, rookiePosRank (in-class rank),
// rank (overall board rank), draftRound/draftPick (NFL capital),
// baseDynastyValue (capital-aware floor) and the dynastyValue seed.
//   name, pos, rank(overall), rpr(in-class posRank), rd(NFL round),
//   pk(NFL pick), base(baseDynastyValue)
const ELITES = [
  { name: 'Fernando Mendoza', pos: 'QB', rank: 4,  rpr: 1,  rd: 1, pk: 1,  base: 8621 },
  { name: 'Jeremiyah Love',   pos: 'RB', rank: 3,  rpr: 1,  rd: 1, pk: 3,  base: 7745 },
  { name: 'Carnell Tate',     pos: 'WR', rank: 8,  rpr: 1,  rd: 1, pk: 4,  base: 6737 },
];

const INFLATED = [
  { name: 'Garrett Nussmeier',  pos: 'QB', rank: 79,  rpr: 3,  rd: 7, pk: 249, base: 190 },
  { name: 'Carson Beck',        pos: 'QB', rank: 100, rpr: 4,  rd: 3, pk: 65,  base: 551 },
  { name: 'Athan Kaliakmanis',  pos: 'QB', rank: 238, rpr: 10, rd: 7, pk: 223, base: 21 },
  { name: 'Jadarian Price',     pos: 'RB', rank: 40,  rpr: 2,  rd: 1, pk: 32,  base: 1405 },
  { name: 'Mike Washington Jr.',pos: 'RB', rank: 64,  rpr: 3,  rd: 4, pk: 122, base: 359 },
  { name: 'Jam Miller',         pos: 'RB', rank: 180, rpr: 15, rd: 7, pk: 245, base: 32 },
  { name: 'Germie Bernard',     pos: 'WR', rank: 43,  rpr: 7,  rd: 2, pk: 47,  base: 1109 },
  { name: 'Reggie Virgil',      pos: 'WR', rank: 101, rpr: 22, rd: 5, pk: 143, base: 174 },
  { name: 'Lewis Bond',         pos: 'WR', rank: 194, rpr: 31, rd: 6, pk: 204, base: 43 },
  { name: 'Eli Stowers',        pos: 'TE', rank: 50,  rpr: 2,  rd: 2, pk: 54,  base: 728 },
  { name: 'Max Klare',          pos: 'TE', rank: 47,  rpr: 3,  rd: 2, pk: 61,  base: 680 },
];

function makeProspect(f) {
  const key = f.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return {
    id: f.rank,
    pid: `csv_${key}`,
    name: f.name,
    pos: f.pos,
    rawPos: f.pos,
    mappedPos: f.pos,
    position: f.pos,
    rank: f.rank,
    consensusRank: f.rank,
    avgRank: f.rank,
    rookiePosRank: f.rpr,
    draftRound: f.rd,
    draftPick: f.pk,
    isUDFA: false,
    nflTeam: 'TM',
    fantasyMultiplier: 1,
    fantasyMult: 1,
    rankValue: f.base,
    draftCapitalValue: f.base,
    baseDynastyValue: f.base,
    dynastyValue: f.base,
    draftScore: 1,
  };
}

// Seed RookieData._cache so getProspects() returns our fixtures, each enriched
// in place by enrichWithDynastyValue → computeStartupValue (the function under
// test). normName mirrors the module's own keying.
function seedCache(ctx, fixtures) {
  const cache = ctx.RookieData._cache;
  const normName = ctx.RookieData._internals.normName;
  const prospects = fixtures.map(makeProspect);
  cache.prospects = {};
  cache.byName = {};
  prospects.forEach(p => {
    const k = normName(p.name);
    cache.prospects[k] = p;
    cache.byName[k] = p;
  });
  cache.order = prospects;
  cache.count = prospects.length;
  cache.loaded = true;
  return prospects;
}

// Compute the live dynastyValue for every fixture via the public surface.
function computeDynastyValues(ctx, fixtures) {
  installVeteranPool(ctx);
  seedCache(ctx, fixtures);
  const enriched = ctx.RookieData.getProspects();
  const byName = {};
  enriched.forEach(p => { byName[p.name] = p.dynastyValue; });
  return byName;
}

// Absolute ceiling for a late-round / low-overall-rank offense rookie. Mid-tier
// veteran starter value sits well above this; a R6-R7 / rank-150+ rookie that
// lands above it has inherited rosterable-veteran value through the in-class-
// rank-only mapping. Kept generous so the test targets the *inflation*, not a
// tight numeric fit.
const LATE_ROUND_CEILING = 1500;

// ── Tests ──────────────────────────────────────────────────────────

group('capital ceiling (late-round / low-rank offense rookies)');

test('R6-R7 or rank-150+ offense rookies stay below the late-round ceiling', () => {
  const ctx = buildSandbox();
  const vals = computeDynastyValues(ctx, [...ELITES, ...INFLATED]);
  // Players that should be capped: late NFL round (>= 6) OR deep board rank.
  const capped = INFLATED.filter(f => f.rd >= 6 || f.rank >= 150);
  ok(capped.length > 0, 'fixture set should include late-round/low-rank rookies');
  capped.forEach(f => {
    const v = vals[f.name];
    ok(typeof v === 'number', `${f.name} should have a numeric dynastyValue`);
    ok(
      v <= LATE_ROUND_CEILING,
      `${f.name} (${f.pos} rank ${f.rank}, R${f.rd} pk ${f.pk}, base ${f.base}) ` +
      `dynastyValue ${v} exceeds late-round ceiling ${LATE_ROUND_CEILING} ` +
      `— in-class posRank mapping is inheriting rosterable-veteran value`
    );
  });
});

// Per-round absolute caps (capital descends with round). A capital-aware value
// keeps each round's rookies under its cap; the in-class-posRank-only bug pushes
// late-round rookies up onto rosterable-veteran slots, far above these caps.
// Tuned to sit comfortably between the fixed-code values and the buggy inflation
// (e.g. R7 fixed <=330, buggy ~2100-5100 → cap 1200).
const ROUND_VALUE_CAP = { 4: 3200, 5: 2200, 6: 1500, 7: 1200 };

test('mid-to-late-round offense rookies stay under their per-round capital cap', () => {
  // Absolute, base-independent guard: a drafted rookie's value must respect the
  // descending value of its NFL draft capital. Using an absolute per-round cap
  // (not a base multiple) keeps the assertion robust for rookies whose base is
  // tiny — those are exactly the players the bug inflated the most.
  const ctx = buildSandbox();
  const vals = computeDynastyValues(ctx, [...ELITES, ...INFLATED]);
  const checked = INFLATED.filter(f => ROUND_VALUE_CAP[f.rd] != null);
  ok(checked.length > 0, 'fixture set should include R4+ rookies');
  checked.forEach(f => {
    const v = vals[f.name];
    const cap = ROUND_VALUE_CAP[f.rd];
    ok(
      v <= cap,
      `${f.name} (${f.pos} R${f.rd} pk ${f.pk}, base ${f.base}) dynastyValue ${v} ` +
      `exceeds the R${f.rd} capital cap ${cap} — late-round rookie inflated off in-class rank`
    );
  });
});

group('capital monotonicity (within position)');

test('a later-NFL-round rookie does not out-value an earlier-round one with a higher capital floor', () => {
  // Core capital-monotonicity invariant. Within a position, if A was drafted
  // EARLIER (better round) AND carries a higher capital-aware base
  // (baseDynastyValue, the round/pick-driven floor), then A must be valued >= B.
  // The bug ranks on in-class posRank alone, so a later-round rookie with a
  // marginally better in-class rank leapfrogs an earlier-round, higher-capital
  // teammate — e.g. Garrett Nussmeier (QB R7, base 190) out-valuing Carson Beck
  // (QB R3, base 551) on the pre-fix engine.
  const ctx = buildSandbox();
  const vals = computeDynastyValues(ctx, [...ELITES, ...INFLATED]);
  const all = [...ELITES, ...INFLATED];

  const byPos = {};
  all.forEach(f => { (byPos[f.pos] = byPos[f.pos] || []).push(f); });

  let comparisons = 0;
  Object.values(byPos).forEach(group => {
    for (let i = 0; i < group.length; i++) {
      for (let j = 0; j < group.length; j++) {
        if (i === j) continue;
        const a = group[i]; // earlier round, higher capital floor
        const b = group[j];
        if (a.rd < b.rd && a.base > b.base) {
          comparisons++;
          const va = vals[a.name];
          const vb = vals[b.name];
          ok(
            va >= vb,
            `${b.pos}: later-round ${b.name} (R${b.rd}, base ${b.base}) value ${vb} ` +
            `exceeds earlier-round higher-capital ${a.name} (R${a.rd}, base ${a.base}) value ${va} ` +
            `— capital monotonicity violated`
          );
        }
      }
    }
  });
  ok(comparisons > 0, 'expected at least one earlier-vs-later capital comparison');
});

test('elite R1 rookies out-value same-position late-round rookies by a capital-proportional margin', () => {
  // Separation invariant that fails on the current bug: the in-class-posRank-only
  // mapping compresses everyone onto adjacent veteran-ladder slots, so an elite
  // R1 #1-overall pick barely edges a same-position R5+ pick (live: QB 1.5x, RB
  // 1.5x). A capital-aware value pulls the late-round rookie far down its
  // capital-anchored slot, restoring a wide, capital-proportional gap. Require
  // the elite to be worth >= ELITE_OVER_LATE_MULT x the late-round rookie.
  const ELITE_OVER_LATE_MULT = 2.5;
  const ctx = buildSandbox();
  const vals = computeDynastyValues(ctx, [...ELITES, ...INFLATED]);
  let pairs = 0;
  ELITES.forEach(elite => {
    INFLATED
      .filter(f => f.pos === elite.pos && f.rd >= 5)
      .forEach(late => {
        pairs++;
        const ve = vals[elite.name];
        const vl = vals[late.name];
        ok(
          ve >= vl * ELITE_OVER_LATE_MULT,
          `${elite.pos}: elite ${elite.name} (R1, rank ${elite.rank}) value ${ve} ` +
          `is only ${(ve / Math.max(1, vl)).toFixed(1)}x late-round ${late.name} ` +
          `(R${late.rd}, rank ${late.rank}) value ${vl} — capital separation too compressed ` +
          `(want >= ${ELITE_OVER_LATE_MULT}x)`
        );
      });
  });
  ok(pairs > 0, 'expected at least one elite-vs-late-round same-position pair');
});

// Elites stay anchored to their veteran-ladder (scouting) slot, NOT raised to their
// synthetic baseDynastyValue. The chosen fix CAPS scoutVal by a capital ceiling; it
// never floors at base, because an elite's base can exceed the league's #1 scored
// veteran (e.g. QB base 8621 > the live QB1 ~8111), and pricing a rookie above the
// best real asset would violate "values feed off the league's own scoring". So the
// guard here is non-collapse: an elite R1 must stay comfortably above the late-round
// tier (it should land on a top-of-ladder veteran slot, never get capped down).
const ELITE_ABS_FLOOR = LATE_ROUND_CEILING * 1.5; // 2250

test('elite R1 rookies stay high (capped at their veteran slot, never collapsed)', () => {
  const ctx = buildSandbox();
  const vals = computeDynastyValues(ctx, [...ELITES, ...INFLATED]);
  ELITES.forEach(elite => {
    const v = vals[elite.name];
    ok(
      v >= ELITE_ABS_FLOOR,
      `${elite.pos}: elite ${elite.name} (R1 pk ${elite.pk}, base ${elite.base}) ` +
      `dynastyValue ${v} fell below the elite floor ${ELITE_ABS_FLOOR} ` +
      `— a top-overall R1 pick should hold a top-of-ladder veteran slot`
    );
  });
});

// ── Summary ────────────────────────────────────────────────────────
console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

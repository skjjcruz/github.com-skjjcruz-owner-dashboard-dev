#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
// warroom/tests/rookie-fields.js
// Contract guard for the shared rookie-field resolver window.App.RookieFields
// (defined in js/core.js). It is consumed by THREE surfaces — Free Agency,
// Trade Center, and My Roster — to join a Sleeper player to its rookie-data
// prospect record by normalized NAME and surface college / NFL draft slot /
// drafted team / consensus rank / tier / size-speed profile, plus power the
// "Rookies" filters. A regression here breaks all three at once.
//
// js/core.js is a browser bundle that destructures React at module top, so we
// extract ONLY the self-contained RookieFields IIFE (delimited by the comment
// anchors below) and run it in a vm sandbox with a mocked window/App and a
// stub rookie-data layer (window.getProspects / window.findProspect).
//
// Usage: node tests/rookie-fields.js   (Node built-ins only)
// ════════════════════════════════════════════════════════════════
'use strict';

const vm   = require('vm');
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CORE = path.join(ROOT, 'js', 'core.js');

// ── Mini runner (matches tests/rookie-data.js style) ──
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; process.stdout.write('.'); }
  catch (err) { failed++; failures.push(`  FAIL: ${name}\n        ${err.message}`); process.stdout.write('F'); }
}
function group(label) { process.stdout.write(`\n  ${label}  `); }
function eq(a, b, label) { if (a !== b) throw new Error((label || 'eq') + `: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, label) { if (!v) throw new Error(label || 'expected truthy'); }

console.log('\nRookie fields (shared resolver) tests');

// ── Extract the RookieFields IIFE from core.js by its comment anchors ──
const coreSrc = fs.readFileSync(CORE, 'utf8');
const startMarker = '// ── Shared rookie/prospect field resolver';
const endMarker = '// computeNFLFit';
const startIdx = coreSrc.indexOf(startMarker);
const endIdx = coreSrc.indexOf(endMarker, startIdx);
if (startIdx === -1 || endIdx === -1) {
  throw new Error('Could not locate the RookieFields block in js/core.js (anchors changed?)');
}
const iifeBlock = coreSrc.slice(startIdx, endIdx);

// ── Prospect fixtures + stub rookie-data layer ──
const PROSPECTS = [
  { name: 'Marvin Receiver', pos: 'WR', mappedPos: 'WR', college: 'Ohio State', school: 'Ohio State',
    nflTeam: 'NYG', draftRound: 1, draftPick: 5, isUDFA: false, consensusRank: 1.8, avgRank: 1.8,
    rank: 2, tier: 1, tierNum: 1, tierLabel: 'ELITE', grade: 9.2, size: "6'4", weight: '241', speed: '4.46', dynastyValue: 9000 },
  { name: 'Undrafted Back', pos: 'RB', mappedPos: 'RB', college: 'Iowa', school: 'Iowa',
    nflTeam: 'KC', draftRound: null, draftPick: null, isUDFA: true, consensusRank: 999, avgRank: 999,
    rank: 999, tier: 7, tierNum: 7, tierLabel: 'UDFA', grade: 4, size: '', weight: '', speed: '', dynastyValue: 300 },
];
function stubNorm(s) {
  return String(s || '').toLowerCase().replace(/['‘’`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
}
function stubFindProspect(name) {
  const k = stubNorm(name);
  return PROSPECTS.find(p => stubNorm(p.name) === k) || null;
}

// ── Build sandbox: mocked window/App + stub rookie-data, then run the IIFE ──
function buildEnv(opts = {}) {
  const ctx = { console, Math, Object, Array, Number, String, Boolean, JSON, Set, Map };
  ctx.window = ctx;
  ctx.App = {
    normPos: p => {
      const s = String(p || '').toUpperCase();
      if (['DE','DT','NT','IDL','EDGE'].includes(s)) return 'DL';
      if (['OLB','ILB','MLB'].includes(s)) return 'LB';
      if (['CB','S','SS','FS'].includes(s)) return 'DB';
      return s || null;
    },
    formatNFLDraftSlot: (round, overallPick) => {
      const rd = Number(round) || 0, overall = Number(overallPick) || 0;
      if (rd <= 0) return overall > 0 ? '#' + overall : '';
      if (overall <= 0) return 'R' + rd;
      const pickInRound = Math.max(1, overall - (rd - 1) * 32);
      return 'R' + rd + '.' + String(pickInRound).padStart(2, '0');
    },
  };
  ctx.window.App = ctx.App;
  if (!opts.noData) {
    ctx.window.RookieData = { findProspect: stubFindProspect, getProspects: () => PROSPECTS.slice() };
    ctx.window.findProspect = stubFindProspect;
    ctx.window.getProspects = () => PROSPECTS.slice();
  }
  vm.createContext(ctx);
  vm.runInContext(iifeBlock, ctx);
  return ctx.App.RookieFields;
}

const RF = buildEnv();
ok(RF, 'RookieFields exposed on window.App');

group('buildIndex + lookup');
const idx = RF.buildIndex();
test('index has both fixtures', () => eq(idx.size, 2, 'index size'));
test('lookup resolves by full_name', () => {
  const pr = RF.lookup(idx, { full_name: 'Marvin Receiver', position: 'WR' });
  ok(pr && pr.college === 'Ohio State', 'resolved prospect');
});
test('lookup resolves by first/last + suffix strip', () => {
  const pr = RF.lookup(idx, { first_name: 'Marvin', last_name: 'Receiver Jr.', position: 'WR' });
  ok(pr && pr.nflTeam === 'NYG', 'suffix-stripped match');
});
test('lookup miss returns null', () => eq(RF.lookup(idx, { full_name: 'Nobody Here' }), null, 'miss'));
test('posGuard rejects cross-position name collision', () => {
  const pr = RF.lookup(idx, { full_name: 'Marvin Receiver', position: 'QB' }, { posGuard: true });
  eq(pr, null, 'QB player must not match WR prospect');
});
test('posGuard off (default) allows position-blind match', () => {
  const pr = RF.lookup(idx, { full_name: 'Marvin Receiver', position: 'QB' });
  ok(pr, 'no posGuard → matches');
});

group('fields()');
const f = RF.fields(RF.lookup(idx, { full_name: 'Marvin Receiver', position: 'WR' }));
test('fields null-safe', () => eq(RF.fields(null), null, 'fields(null)'));
test('college', () => eq(f.college, 'Ohio State'));
test('nflTeam', () => eq(f.nflTeam, 'NYG'));
test('draftSlot R1.05', () => eq(f.draftSlot, 'R1.05'));
test('consensusRank', () => eq(f.consensusRank, 1.8));
test('tier number', () => eq(f.tier, 1));
test('tierLabel', () => eq(f.tierLabel, 'ELITE'));
test('profile ht·wt·speed', () => eq(f.profile, "6'4 · 241lb · 4.46"));
test('isUDFA false for drafted', () => eq(f.isUDFA, false));

const fu = RF.fields(RF.lookup(idx, { full_name: 'Undrafted Back', position: 'RB' }));
test('UDFA draftSlot label', () => eq(fu.draftSlot, 'UDFA'));
test('UDFA profile empty (no stray separators)', () => eq(fu.profile, ''));
test('UDFA isUDFA true', () => eq(fu.isUDFA, true));

group('draftSlot()');
test('draftSlot UDFA', () => eq(RF.draftSlot({ isUDFA: true }), 'UDFA'));
test('draftSlot pre-draft empty', () => eq(RF.draftSlot({ draftRound: null, draftPick: null, isUDFA: false }), ''));
test('draftSlot R2.40', () => eq(RF.draftSlot({ draftRound: 2, draftPick: 40 }), 'R2.08'));
test('draftSlot null prospect', () => eq(RF.draftSlot(null), ''));

group('resolve() one-shot');
test('resolve matches', () => {
  const pr = RF.resolve({ full_name: 'Marvin Receiver', position: 'WR' });
  ok(pr && pr.tierLabel === 'ELITE', 'resolve hit');
});
test('resolve posGuard default on → rejects mismatch', () => {
  eq(RF.resolve({ full_name: 'Marvin Receiver', position: 'QB' }), null, 'resolve rejects cross-pos');
});

group('isRookie()');
test('prospect-resolved → rookie', () => eq(RF.isRookie({ full_name: 'x', years_exp: 5 }, PROSPECTS[0]), true));
test('years_exp 0 + no stats → rookie', () => eq(RF.isRookie({ player_id: 'p1', years_exp: 0 }, null, { cur: {}, prev: {} }), true));
test('veteran (years_exp 5) → not rookie', () => eq(RF.isRookie({ years_exp: 5 }, null), false));
test('years_exp 0 but has stats → not rookie', () => eq(RF.isRookie({ player_id: 'p1', years_exp: 0 }, null, { cur: { p1: { gp: 9 } }, prev: {} }), false));

group('graceful degradation (rookie CSV not loaded)');
test('buildIndex empty when getProspects missing', () => {
  const RF2 = buildEnv({ noData: true });
  const i2 = RF2.buildIndex();
  eq(i2.size, 0, 'empty index');
  eq(RF2.resolve({ full_name: 'Marvin Receiver' }), null, 'resolve null without finder');
});

// ── Report ──
console.log('\n');
if (failures.length) { console.log(failures.join('\n')); }
console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

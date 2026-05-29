#!/usr/bin/env node
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

function makeStorage() {
  const store = {};
  return {
    getItem: k => Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
    _store: store,
  };
}

function buildCtx() {
  const localStorage = makeStorage();
  const ctx = {
    console,
    Date,
    Math,
    JSON,
    Object,
    Array,
    Number,
    String,
    Boolean,
    Set,
    Map,
    localStorage,
    window: null,
    wrLog: () => {},
  };
  ctx.window = ctx;
  ctx.App = {
    WR_KEYS: {
      BIGBOARD: leagueId => `wr_bigboard_${leagueId}`,
      BIGBOARD_DRAFT: (leagueId, draftType) => `wr_bigboard_${leagueId}_${draftType || 'draft'}`,
    },
    WrStorage: {
      get(key, fallback = null) {
        const v = localStorage.getItem(key);
        if (v == null) return fallback;
        try { return JSON.parse(v); } catch (_) { return v; }
      },
      set(key, value) {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      },
    },
  };
  ctx.DraftCC = {};
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/analyst-mock.js');

const pool = [
  { pid: 'wr1', name: 'Alpha WR', pos: 'WR', dhq: 9500, consensusRank: 1, tier: 1 },
  { pid: 'qb1', name: 'Beta QB', pos: 'QB', dhq: 9000, consensusRank: 2, tier: 1 },
  { pid: 'rb1', name: 'Gamma RB', pos: 'RB', dhq: 7600, consensusRank: 3, tier: 2 },
  { pid: 'te1', name: 'Delta TE', pos: 'TE', dhq: 7200, consensusRank: 4, tier: 2 },
  { pid: 'wr2', name: 'Echo WR', pos: 'WR', dhq: 6500, consensusRank: 5, tier: 3 },
];

const pickOrder = [
  { round: 1, slot: 1, overall: 1, teamIdx: 0, rosterId: 1, ownerName: 'Owner 1' },
  { round: 1, slot: 2, overall: 2, teamIdx: 1, rosterId: 2, ownerName: 'RB Hunter' },
  { round: 1, slot: 3, overall: 3, teamIdx: 2, rosterId: 3, ownerName: 'Owner 3' },
  { round: 1, slot: 4, overall: 4, teamIdx: 3, rosterId: 4, ownerName: 'Owner 4' },
];

const baseState = {
  leagueId: 'L1',
  variant: 'startup',
  rounds: 1,
  leagueSize: 4,
  draftType: 'linear',
  userRosterId: 3,
  userSlot: 3,
  pool,
  draftTuning: { ownerDna: 70, classValue: 65, needFit: 60, tradeActivity: 50, variance: 45 },
  personas: {
    1: { draftDna: { posPct: { WR: 45 } }, assessment: { needs: [{ pos: 'WR', urgency: 'thin' }] } },
    2: {
      draftDna: { label: 'RB Hunter', posPct: { RB: 90 }, r1Positions: ['RB', 'RB', 'RB'] },
      assessment: { needs: [{ pos: 'RB', urgency: 'deficit' }] },
      ownerIntel: { reasonCodes: [{ code: 'draft_position_bias', detail: 'Historically pushes RB early.' }] },
    },
    3: { draftDna: { posPct: { QB: 50 } }, assessment: { needs: [{ pos: 'QB', urgency: 'thin' }] } },
    4: { draftDna: { posPct: { TE: 50 } }, assessment: { needs: [{ pos: 'TE', urgency: 'thin' }] } },
  },
};

console.log('\nWar Room draft analyst mock contract');

test('generateProjectedMock creates explainable pick-by-pick reports', () => {
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  eq(report.schemaVersion, 'draft-analyst-mock-v2', 'schema');
  eq(report.picks.length, 4, 'pick count');
  ok(report.picks.every(p => p.note && p.drivers && p.drivers.length), 'each pick has drivers and note');
  ok(report.picks.every(p => p.alexCommentary && p.alexCommentary.summary && p.alexCommentary.teamImpact), 'each pick has Alex commentary');
  ok(report.picks[0].alexCommentary.summary.includes('Owner 1'), 'Alex commentary names the picking team');
  ok(report.summary.driverCounts.value || report.summary.driverCounts.owner_history || report.summary.driverCounts.need, 'driver summary exists');
  ok(report.summary.reportBrief?.headline, 'report brief generated');
  ok(report.summary.reportBrief?.teamSummaries?.length >= 4, 'team summaries generated');
  ok(report.summary.reportBrief?.roundSummaries?.length === 1, 'round summary generated');
  ok(report.assumptions.tuning.ownerDna >= 80, 'preset tuning applied');
});

test('owner-history projection can materially differ from chalk', () => {
  const chalk = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'chalk',
    roundLimit: 1,
  });
  const history = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  eq(chalk.picks[1].pos, 'QB', 'chalk takes board value at pick 2');
  eq(history.picks[1].pos, 'RB', 'owner-history takes RB at pick 2');
  ok(history.picks[1].drivers.some(d => d.code === 'owner_history'), 'owner-history driver cited');
});

test('My Board basis honors saved user board order', () => {
  ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD_DRAFT('L1', 'startup'), {
    myOrder: ['te1', 'rb1', 'wr1', 'qb1', 'wr2'],
  });
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'my-board',
    roundLimit: 1,
  });
  eq(report.basis, 'my', 'basis');
  eq(report.picks[0].pid, 'te1', 'my board first pick');
  ok(report.picks[0].drivers.some(d => d.code === 'user_board'), 'user board driver cited');
});

test('applyProjectedScenario stages picks before the user turn', () => {
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  const scenario = ctx.DraftCC.analystMock.applyProjectedScenario(baseState, pool, pickOrder, report);
  eq(scenario.prePicks.length, 2, 'pre-user picks staged');
  eq(scenario.prePicks[0].overall, 1, 'first staged pick');
  ok(scenario.prePicks[0].alexCommentary?.summary, 'staged pick carries Alex commentary');
  ok(!scenario.pool.some(p => p.pid === scenario.prePicks[0].pid), 'staged player removed from pool');
  ok(scenario.narrative.includes('ANALYST MOCK SCENARIO'), 'scenario narrative');
});

test('applyReportFilters supports report workbench filters', () => {
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  const myPicks = ctx.DraftCC.analystMock.applyReportFilters(report, { focus: 'my' }, baseState);
  eq(myPicks.length, 1, 'my pick filter');
  eq(myPicks[0].rosterId, 3, 'my roster pick');
  const rbPicks = ctx.DraftCC.analystMock.applyReportFilters(report, { pos: 'RB' }, baseState);
  ok(rbPicks.every(p => p.pos === 'RB'), 'position filter');
  const ownerHistory = ctx.DraftCC.analystMock.applyReportFilters(report, { focus: 'owner_history' }, baseState);
  ok(ownerHistory.some(p => p.ownerName === 'RB Hunter'), 'owner history focus');
});

test('compareReports highlights volatility, target risk, and team grades', () => {
  const chalk = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'chalk',
    roundLimit: 1,
  });
  const history = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  const comparison = ctx.DraftCC.analystMock.compareReports([history, chalk], {
    ...baseState,
    draftContext: {
      boardContext: {
        entries: {
          rb1: { pid: 'rb1', tag: 'target' },
          te1: { pid: 'te1', tag: 'must' },
        },
      },
    },
  });
  eq(comparison.schemaVersion, 'draft-analyst-compare-v1', 'schema');
  eq(comparison.ready, true, 'comparison ready');
  ok(comparison.changedPickCount > 0, 'changed picks detected');
  ok(comparison.targetAvailability.length >= 1, 'target window evaluated');
  eq(comparison.teamGrades.length, 4, 'team grades emitted');
  ok(comparison.summary.volatility > 0, 'volatility computed');
});

test('league-history projection constrains impossible early IDP runs', () => {
  const idpPool = [];
  ['DL', 'LB', 'DB'].forEach((pos, groupIdx) => {
    for (let i = 1; i <= 10; i++) {
      const overall = groupIdx * 10 + i;
      idpPool.push({ pid: 'idp' + overall, name: pos + ' Defender ' + i, pos, dhq: 10500 - overall * 20, consensusRank: overall, tier: 1 });
    }
  });
  ['WR', 'RB', 'QB', 'TE'].forEach((pos, groupIdx) => {
    for (let i = 1; i <= 8; i++) {
      const overall = groupIdx * 8 + i;
      idpPool.push({ pid: 'off' + pos + i, name: pos + ' Prospect ' + i, pos, dhq: 9200 - overall * 25, consensusRank: 30 + overall, tier: overall <= 8 ? 1 : 2 });
    }
  });
  const idpPickOrder = Array.from({ length: 24 }, (_, idx) => ({
    round: Math.floor(idx / 12) + 1,
    slot: (idx % 12) + 1,
    overall: idx + 1,
    teamIdx: idx % 12,
    rosterId: (idx % 12) + 1,
    ownerName: 'Team ' + ((idx % 12) + 1),
  }));
  const personas = {};
  for (let rid = 1; rid <= 12; rid++) {
    personas[rid] = {
      draftDna: {
        label: 'Offense First',
        posPct: { WR: 34, RB: 28, QB: 14, TE: 14, EDGE: 4, LB: 3, CB: 2, S: 1 },
        r1Positions: ['WR', 'RB', 'WR', 'QB'],
        earlyDefPct: 4,
        overallDefPct: 10,
        picksAnalyzed: 64,
      },
      assessment: { needs: [{ pos: 'WR', urgency: 'thin' }] },
    };
  }
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: {
      ...baseState,
      leagueSize: 12,
      rounds: 2,
      userRosterId: 6,
      userSlot: 6,
      pool: idpPool,
      personas,
    },
    pickOrder: idpPickOrder,
    presetId: 'league-history',
    roundLimit: 2,
  });
  const idpCount = report.picks.slice(0, 24).filter(p => ['DL', 'LB', 'DB'].includes(p.pos)).length;
  ok(idpCount <= 4, 'early IDP count follows league history instead of raw rankings');
  ok(report.assumptions.historicalPace.ready, 'historical pace metadata included');
});

test('early projected mocks do not chase specialists over real roster value', () => {
  const specialistPool = [
    { pid: 'k1', name: 'Boom Leg', pos: 'K', dhq: 9800, consensusRank: 1, tier: 1 },
    { pid: 'wr1', name: 'Alpha WR', pos: 'WR', dhq: 7800, consensusRank: 2, tier: 1 },
    { pid: 'rb1', name: 'Gamma RB', pos: 'RB', dhq: 7200, consensusRank: 3, tier: 2 },
    { pid: 'qb1', name: 'Beta QB', pos: 'QB', dhq: 7000, consensusRank: 4, tier: 2 },
    { pid: 'te1', name: 'Delta TE', pos: 'TE', dhq: 6800, consensusRank: 5, tier: 2 },
  ];
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: {
      ...baseState,
      leagueSize: 4,
      rounds: 1,
      pool: specialistPool,
      personas: {
        1: { assessment: { needs: [{ pos: 'K', urgency: 'deficit' }] }, draftDna: { posPct: { K: 90 } } },
        2: { assessment: { needs: [{ pos: 'K', urgency: 'deficit' }] }, draftDna: { posPct: { K: 90 } } },
        3: { assessment: { needs: [{ pos: 'K', urgency: 'deficit' }] }, draftDna: { posPct: { K: 90 } } },
        4: { assessment: { needs: [{ pos: 'K', urgency: 'deficit' }] }, draftDna: { posPct: { K: 90 } } },
      },
    },
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  ok(report.picks.slice(0, 4).every(p => p.pos !== 'K'), 'round one should not spend premium picks on specialists');
});

test('formatAlexSlackBrief emits Slack-style pick value lines', () => {
  const report = ctx.DraftCC.analystMock.generateProjectedMock({
    state: baseState,
    pickOrder,
    presetId: 'league-history',
    roundLimit: 1,
  });
  const brief = ctx.DraftCC.analystMock.formatAlexSlackBrief(report, baseState, { maxLines: 2 });
  eq(brief.author, 'Alex Ingram', 'author');
  ok(brief.headline.includes('1 round'), 'round count in headline');
  eq(brief.pickLines.length, 2, 'line limit respected');
  ok(brief.pickLines[0].dhq, 'DHQ shown');
  ok(brief.pickLines[0].value, 'value phrase shown');
  ok(brief.userPath.includes('1.03'), 'user path summarized');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

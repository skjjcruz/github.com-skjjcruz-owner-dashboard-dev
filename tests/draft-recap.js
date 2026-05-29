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
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    _store: store,
  };
}

function buildCtx() {
  const localStorage = makeStorage();
  const ctx = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    Date,
    JSON,
    localStorage,
    wrLog: () => {},
    window: null,
  };
  ctx.window = ctx;
  ctx.DraftCC = {};
  ctx.App = {
    LI: {
      ownerBehaviorProfiles: {
        2: { inferences: ['active-trader'] },
      },
      playerScores: {
        c1: 70,
        c2: 30,
      },
    },
  };
  ctx.S = {
    players: {
      c1: { full_name: 'Current WR', position: 'WR' },
      c2: { full_name: 'Current RB', position: 'RB' },
    },
  };
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/state.js');

console.log('\nWar Room draft recap contract');

function buildState() {
  const originalPool = [
    { pid: 'p1', name: 'Alpha QB', pos: 'QB', dhq: 1000, consensusRank: 1 },
    { pid: 'p2', name: 'Beta TE', pos: 'TE', dhq: 650, consensusRank: 2 },
    { pid: 'p4', name: 'Delta WR', pos: 'WR', dhq: 620, consensusRank: 3 },
    { pid: 'p5', name: 'Echo WR', pos: 'WR', dhq: 610, consensusRank: 4 },
    { pid: 'p6', name: 'Foxtrot TE', pos: 'TE', dhq: 430, consensusRank: 8 },
    { pid: 'p3', name: 'Gamma RB', pos: 'RB', dhq: 500, consensusRank: 20 },
  ];
  return {
    id: 'draft-test',
    phase: 'complete',
    leagueId: 'L1',
    season: 2026,
    mode: 'solo',
    variant: 'startup',
    userRosterId: 1,
    userSlot: 1,
    originalPool,
    personas: {
      1: { teamName: 'User Team', assessment: { needs: [{ pos: 'TE' }] } },
      2: { teamName: 'Opponent Team' },
    },
    draftContext: {
      boardContext: {
        entries: {
          p4: { target: true, tag: 'target', myRank: 2, note: 'Priority WR target.' },
        },
      },
      teamContext: { needs: [{ pos: 'TE' }], currentRoster: ['c1', 'c2'] },
    },
    picks: [
      { round: 1, slot: 1, overall: 1, pickInRound: 1, rosterId: 1, pid: 'p1', name: 'Alpha QB', pos: 'QB', dhq: 1000, consensusRank: 1 },
      { round: 1, slot: 2, overall: 2, pickInRound: 2, rosterId: 2, ownerName: 'Opponent Team', pid: 'p4', name: 'Delta WR', pos: 'WR', dhq: 620, consensusRank: 3 },
      { round: 1, slot: 1, overall: 3, pickInRound: 1, rosterId: 1, pid: 'p3', name: 'Gamma RB', pos: 'RB', dhq: 500, consensusRank: 20 },
      { round: 1, slot: 2, overall: 4, pickInRound: 2, rosterId: 2, ownerName: 'Opponent Team', pid: 'p2', name: 'Beta TE', pos: 'TE', dhq: 650, consensusRank: 2 },
    ],
    completedTrades: [{
      id: 't1',
      fromRosterId: 2,
      userInitiated: true,
      myGiveDHQ: 600,
      myGainDHQ: 1000,
      likelihood: 74,
      grade: { grade: 'B+' },
      acceptedAt: 2,
    }],
  };
}

test('buildDraftRecap creates P4 strategic user and league outputs', () => {
  const state = buildState();
  const recap = ctx.DraftCC.state.buildDraftRecap(state);
  eq(recap.schemaVersion, 'draft-recap-v3', 'schema');
  eq(recap.bestPick.name, 'Alpha QB', 'best pick');
  eq(recap.biggestReach.name, 'Gamma RB', 'reach');
  eq(recap.missedTarget.name, 'Delta WR', 'missed target');
  eq(recap.bestAlternative.alternative.name, 'Beta TE', 'best alternative');
  eq(recap.tradeImpact.netDHQ, 400, 'trade net');
  ok(recap.actionPlan.some(item => item.type === 'target_followup'), 'target action generated');
  ok(recap.actionPlan.some(item => item.type === 'trade_audit'), 'trade action generated');
  ok(recap.actionPlan.some(item => item.type === 'waiver_followup'), 'waiver action generated');
  ok(recap.postDraftMoves.waiverTargets.some(p => p.name === 'Foxtrot TE'), 'waiver target generated');
  ok(recap.postDraftMoves.tradeTargets.some(t => t.pos === 'TE'), 'trade target generated');
  ok(recap.postDraftMoves.cutCandidates.length > 0, 'cut review generated');
  ok(recap.teamRecaps.length >= 2, 'team recaps generated');
  ok(recap.leagueStorylines.length >= 2, 'league storylines generated');
  ok(recap.ownerLearning['2'].reasonCodes.length > 0, 'owner learning reason codes');
});

test('saveDraftLearning feeds owner behavior profiles without dropping existing intel', () => {
  const recap = ctx.DraftCC.state.buildDraftRecap(buildState());
  const saved = ctx.DraftCC.state.saveDraftLearning(recap);
  ok(Array.isArray(saved) && saved.length === 1, 'learning saved');
  eq(ctx.App.LI.ownerBehaviorProfiles['2'].inferences[0], 'active-trader', 'existing profile preserved');
  eq(ctx.App.LI.ownerBehaviorProfiles['2'].draftRecapLearning.buildLabel, 'WR-led build', 'profile enriched');
  ok(ctx.App.LI.ownerDraftLearning['2'], 'owner draft learning map exposed');
});

test('draft recap archive can list, export, delete, and create future mock defaults', () => {
  const recap = ctx.DraftCC.state.saveDraftRecap(buildState(), { id: 'recap-p4b' });
  const archive = ctx.DraftCC.state.listDraftRecaps('L1');
  ok(archive.some(row => row.id === recap.id), 'recap archived');
  const report = ctx.DraftCC.state.formatDraftShareReport(recap);
  ok(report.includes('# War Room Draft Recap'), 'share report title');
  ok(report.includes('## Next Moves'), 'share report next moves');
  ok(report.includes('Owner Learning Signals'), 'share report learning signals');

  const defaults = ctx.DraftCC.state.buildRecapLearningDefaults('L1', {
    variant: 'startup',
    baseTuning: { ownerDna: 70, classValue: 65, needFit: 60, tradeActivity: 50, variance: 45 },
  });
  ok(defaults.sampleSize >= 1, 'learning defaults sample');
  ok(defaults.suggestedTuning.ownerDna > 70, 'owner DNA default lifted');
  ok(defaults.suggestedTuning.tradeActivity > 50, 'trade default lifted');

  const afterDelete = ctx.DraftCC.state.deleteDraftRecap('L1', recap.id);
  ok(!afterDelete.some(row => row.id === recap.id), 'recap deleted from archive');
});

test('formatDraftRecapText includes action plan and team grades', () => {
  const recap = ctx.DraftCC.state.buildDraftRecap(buildState());
  const text = ctx.DraftCC.state.formatDraftRecapText(recap);
  ok(text.includes('Action plan:'), 'action plan section');
  ok(text.includes('League recap:'), 'league recap section');
  ok(text.includes('Team grades:'), 'team grades section');
  ok(text.includes('Alpha QB - QB'), 'pick line preserved');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

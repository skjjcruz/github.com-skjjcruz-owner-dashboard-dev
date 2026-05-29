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
      playerScores: {
        vet1: 4321,
      },
    },
    PlayerValue: {
      DRAFT_ROUNDS: 7,
      getPickValue(_season, round, teams, slot) {
        return Number(round) * 1000 + Number(slot || Math.ceil(Number(teams || 12) / 2));
      },
    },
  };
  ctx.RookieData = {
    findProspect: name => {
      if (name === 'Fallback Rookie') return { dynastyValue: 3210, baseDynastyValue: 3100, draftCapitalValue: 2800 };
      if (name === 'Rookie Two') return { dynastyValue: 2222, baseDynastyValue: 2100, draftCapitalValue: 1900 };
      return null;
    },
  };
  ctx.WR = {
    GmMode: {
      getMode: () => 'win_now',
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
const state = ctx.DraftCC.state;

console.log('\nWar Room draft strategy studio contract');

test('strategy studio exposes first-class mock presets', () => {
  const presets = state.getDraftStrategyPresets();
  const visible = presets.filter(p => !p.hidden);
  eq(visible.length, 3, 'three smart templates visible');
  ok(visible.some(p => p.id === 'front-office-blend'), 'league blend preset');
  ok(visible.some(p => p.id === 'owner-dna-mirror'), 'owner DNA preset');
  ok(visible.some(p => p.id === 'class-scout'), 'board scout preset');
  ok(presets.some(p => p.id === 'no-trades' && p.hidden), 'no trades preset stays available for saved profiles');
});

test('buildDraftStrategyProfile blends GM mode and recap learning', () => {
  const profile = state.buildDraftStrategyProfile({
    leagueId: 'L1',
    presetId: 'front-office-blend',
    gmMode: 'win_now',
    recapLearning: {
      sampleSize: 2,
      suggestedTuning: { ownerDna: 90, classValue: 80, needFit: 90, tradeActivity: 70, variance: 20 },
    },
  });
  eq(profile.schemaVersion, 'draft-strategy-profile-v1', 'schema');
  eq(profile.gmMode, 'win_now', 'gm mode');
  ok(profile.tuning.needFit > 70, 'win-now need fit lifted');
  ok(profile.tuning.tradeActivity > 55, 'trade activity lifted');
  eq(profile.aiSignals.tradeMode, 'normal', 'signal label');
});

test('no-trades preset hard-locks trade activity', () => {
  const profile = state.buildDraftStrategyProfile({
    leagueId: 'L1',
    presetId: 'no-trades',
    gmMode: 'win_now',
    recapLearning: {
      sampleSize: 1,
      suggestedTuning: { tradeActivity: 100 },
    },
    tuning: { tradeActivity: 100 },
  });
  eq(profile.tuning.tradeActivity, 0, 'trade activity locked');
  eq(profile.aiSignals.tradeMode, 'off', 'trade signal off');
});

test('saved draft strategy profile round-trips by league', () => {
  const profile = state.buildDraftStrategyProfile({
    leagueId: 'L1',
    presetId: 'custom-studio',
    tuning: { ownerDna: 81, classValue: 44, needFit: 73, tradeActivity: 12, variance: 9 },
    label: 'Custom Studio',
  });
  const saved = state.saveDraftStrategyProfile('L1', profile);
  ok(saved.saved, 'saved flag');
  const loaded = state.loadDraftStrategyProfile('L1');
  eq(loaded.leagueId, 'L1', 'league id');
  eq(loaded.presetId, 'custom-studio', 'preset id');
  eq(loaded.tuning.ownerDna, 81, 'owner DNA');
  eq(loaded.tuning.tradeActivity, 12, 'trade activity');
});

test('initial draft state can carry strategy profile tuning', () => {
  const profile = state.loadDraftStrategyProfile('L1');
  const tuning = state.applyDraftStrategyProfileToTuning(profile, state.DEFAULT_DRAFT_TUNING);
  const draftState = state.initialDraftState({ leagueId: 'L1', draftTuning: tuning, strategyProfile: profile });
  eq(draftState.strategyProfile.presetId, 'custom-studio', 'profile carried');
  eq(draftState.draftTuning.needFit, 73, 'tuning applied');
});

test('mock player values resolve from existing DHQ and rookie data sources', () => {
  eq(state.resolvePlayerDhq({ pid: 'vet1', dhq: 10 }).value, 4321, 'veteran LI score wins');
  eq(state.resolvePlayerDhq({ name: 'Rookie One', csv: { dynastyValue: 2450, draftScore: 9 } }).value, 2450, 'rookie dynasty value wins');
  eq(state.resolvePlayerDhq({ name: 'Fallback Rookie', csv: { draftScore: 9 } }).value, 3210, 'rookie-data lookup fills value');
});

test('Sleeper draft variant detection respects redraft all-player drafts', () => {
  eq(
    state.detectDraftVariant({
      league: { settings: { type: 0 } },
      draft: { settings: { player_type: 0, rounds: 15 }, type: 'snake' },
    }),
    'redraft',
    'redraft all-player draft'
  );
  eq(
    state.detectDraftVariant({
      league: { settings: { type: 2 } },
      draft: { settings: { player_type: 1, rounds: 4 }, type: 'snake' },
    }),
    'rookie',
    'explicit rookie draft'
  );
  eq(
    state.detectDraftVariant({
      league: { settings: { type: 2 } },
      draft: { settings: { player_type: 0, rounds: 4 }, type: 'snake' },
    }),
    'startup',
    'explicit all-player dynasty draft is not inferred as rookie by short rounds'
  );
});

test('redraft pool includes veterans and rookies from the all-player pool', () => {
  const pool = state.buildPool({
    variant: 'redraft',
    maxSize: 10,
    playersData: {
      vet1: { full_name: 'Veteran One', first_name: 'Veteran', last_name: 'One', position: 'RB', status: 'Active', years_exp: 5, team: 'KC' },
      rook2: { full_name: 'Rookie Two', first_name: 'Rookie', last_name: 'Two', position: 'WR', status: 'Active', years_exp: 0, team: 'NYG' },
      BAL: { first_name: 'Baltimore', last_name: 'Ravens', position: 'DEF', status: 'Active', team: 'BAL' },
    },
  });
  ok(pool.some(p => p.pid === 'vet1'), 'redraft pool includes veteran');
  ok(pool.some(p => p.pid === 'rook2'), 'redraft pool includes rookie');
  ok(pool.some(p => p.pid === 'BAL' && p.pos === 'DEF'), 'redraft pool includes D/ST baseline rows');
  eq(pool.find(p => p.pid === 'rook2').isRookie, true, 'rookie flag preserved');
});

test('mock pick order stores canonical slot pick values', () => {
  const order = state.buildPickOrder(2, 4, 'snake');
  eq(order[0].value, 1001, '1.01 value uses exact slot');
  eq(order[3].value, 1004, '1.04 value uses exact slot');
  eq(order[4].value, 2004, 'snake round two first pick uses exact original slot');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

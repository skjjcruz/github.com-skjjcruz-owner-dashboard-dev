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
    parseInt,
    parseFloat,
    localStorage,
    window: null,
    wrLog: () => {},
  };
  ctx.window = ctx;
  ctx.App = {
    WR_KEYS: {
      BIGBOARD: leagueId => `wr_bigboard_${leagueId}`,
      BIGBOARD_DRAFT: (leagueId, draftType) => `wr_bigboard_${leagueId}_${draftType || 'draft'}`,
      GM_STRATEGY: leagueId => `wr_gm_strategy_${leagueId}`,
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
    LI: {
      ownerProfiles: {},
      tradeHistory: [],
      draftOutcomes: [],
      ownerBehaviorProfiles: {
        2: {
          sample: { trades: 7, draftPicks: 9, faabTransactions: 4 },
          inferences: ['pick-collector', 'value-hunter'],
          scores: { liquidity: 82, pickAppetite: 0.62 },
          strategy: { offerFrame: 'Lead with picks.' },
          observedFacts: [{ code: 'trade_volume', label: 'Trade volume', detail: '7 trades on file.' }],
          confidence: 'high',
        },
      },
    },
    Intelligence: {
      buildLeagueProfile: () => ({ schemaVersion: 'test', flags: ['superflex'] }),
      buildOwnerBehaviorProfile: input => ({
        sample: { trades: 3, draftPicks: 4, faabTransactions: 1 },
        inferences: ['fallback-profile'],
        scores: { liquidity: 55 },
        strategy: { offerFrame: 'Keep it clean.' },
        observedFacts: [{ code: 'fallback', label: 'Fallback', detail: `Roster ${input.rosterId}` }],
        confidence: 'medium',
      }),
    },
  };
  ctx.DraftCC = {
    tradeHelpers: {
      DNA_TYPES: {
        FLEECER: { label: 'Fleecer', color: '#f00', taxes: [{ key: 'value', impact: -10 }], strategy: 'Needs surplus.' },
      },
      calcOwnerPosture: () => ({ key: 'BUYER', label: 'Buyer', color: '#0f0', desc: 'Buying.' }),
    },
  };
  ctx.S = {
    rosters: [
      { roster_id: 1, owner_id: 'u1', players: ['p1'] },
      { roster_id: 2, owner_id: 'u2', players: ['p2'] },
    ],
    leagueUsers: [
      { user_id: 'u1', display_name: 'User One', metadata: { team_name: 'You' } },
      { user_id: 'u2', display_name: 'User Two', metadata: { team_name: 'Opponent' } },
    ],
    tradedPicks: [],
    leagues: [{ league_id: 'L1' }],
  };
  ctx.window._tcDnaMap = { 2: 'FLEECER' };
  ctx.assessTeamFromGlobal = rosterId => ({
    rosterId,
    healthScore: rosterId === 2 ? 72 : 61,
    tier: rosterId === 2 ? 'CONTENDER' : 'CROSSROADS',
    window: rosterId === 2 ? 'CONTENDING' : 'CROSSROADS',
    needs: rosterId === 2 ? [{ pos: 'RB', urgency: 'deficit' }] : [{ pos: 'WR' }],
    strengths: rosterId === 2 ? ['QB'] : [],
  });
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/context.js');
load(ctx, 'js/draft/persona.js');

console.log('\nWar Room draft context contract');

const league = {
  id: 'fallback-id',
  league_id: 'L1',
  season: '2026',
  settings: { num_teams: 12, best_ball: 1 },
  roster_positions: ['QB', 'RB', 'WR', 'WR', 'TE', 'SUPER_FLEX', 'BN'],
  scoring_settings: { rec: 1, pass_td: 4, bonus_rec_te: 0.5 },
  rosters: ctx.S.rosters,
};

const pool = [
  { pid: 'p1', name: 'Alpha WR', pos: 'WR', dhq: 9000, age: 23, tier: 1 },
  { pid: 'p2', name: 'Beta RB', pos: 'RB', dhq: 8700, age: 22, tier: 1 },
  { pid: 'p3', name: 'Gamma QB', pos: 'QB', dhq: 8200, age: 24, tier: 2 },
];

ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD('L1'), {
  myOrder: ['p3', 'p1', 'p2'],
  tags: { p1: 'target' },
  notes: { p1: 'Priority if WR tier holds.' },
  tiers: { p3: 2 },
  drafted: ['p2'],
  activeLane: 'my',
  lineage: { source: 'test', seededFrom: 'ai', userLastEditedAt: '2026-05-16T00:00:00.000Z' },
});

test('buildLeagueFormat detects football format flags', () => {
  const format = ctx.DraftCC.context.buildLeagueFormat({ currentLeague: league, state: { variant: 'startup' }, draftType: 'best_ball' });
  eq(format.sport, 'football', 'sport');
  eq(format.flags.superflex, true, 'superflex');
  eq(format.flags.bestBall, true, 'best ball');
  eq(format.scoring.ppr, 'ppr', 'ppr');
  eq(format.scoring.tePremium, true, 'te premium');
});

test('format adapters tune bestball and redraft draft contexts', () => {
  const bestballFormat = ctx.DraftCC.context.buildLeagueFormat({ currentLeague: league, draftType: 'best_ball' });
  const bestball = ctx.DraftCC.context.getDraftFormatAdapter({ draftType: 'best_ball', leagueFormat: bestballFormat });
  eq(bestball.id, 'best_ball', 'bestball adapter');
  ok(bestball.positionMultipliers.WR > 1, 'bestball WR ceiling boost');
  ok(bestball.positionMultipliers.TE >= 1.08, 'TE premium compounds for bestball');

  const redraft = ctx.DraftCC.context.getDraftFormatAdapter({ draftType: 'redraft', leagueFormat: bestballFormat });
  eq(redraft.id, 'redraft', 'redraft adapter');
  eq(redraft.projectionYears, 1, 'redraft projection horizon');

  const board = ctx.DraftCC.context.buildBoardContext({
    leagueId: 'L6',
    currentLeague: league,
    draftType: 'best_ball',
    pool,
  });
  eq(board.formatAdapter.id, 'best_ball', 'board carries format adapter');
  eq(ctx.DraftCC.context.buildPlayerUniverse({ draftType: 'redraft', pool }).mode, 'seasonal_pool', 'redraft universe mode');
  eq(ctx.DraftCC.context.buildPlayerUniverse({ draftType: 'best_ball', pool }).mode, 'best_ball_pool', 'bestball universe mode');
});

test('buildBoardContext exposes DHQ, AI, and user-owned board lanes', () => {
  const board = ctx.DraftCC.context.buildBoardContext({
    currentLeague: league,
    pool,
    userAssessment: { needs: [{ pos: 'RB' }] },
  });
  eq(board.leagueId, 'L1', 'league id');
  eq(board.activeLane, 'my', 'active lane');
  eq(board.lanes.dhq.order[0], 'p1', 'dhq leader');
  eq(board.lanes.my.order[0], 'p3', 'manual my board leader');
  eq(board.lanes.my.source, 'user_manual', 'my board source');
  eq(board.entries.p1.note, 'Priority if WR tier holds.', 'note carried');
  eq(board.entries.p2.drafted, true, 'drafted carried');
});

test('buildBoardContext seeds My Board from AI when no manual board exists', () => {
  ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD('L2'), {});
  const board = ctx.DraftCC.context.buildBoardContext({
    leagueId: 'L2',
    pool,
    userAssessment: { needs: [{ pos: 'RB' }] },
  });
  eq(board.lanes.my.source, 'seeded_from_ai', 'my board seed source');
  eq(board.lanes.my.order.join('|'), board.lanes.ai.order.join('|'), 'my seeded from ai');
  eq(board.canSeedMyBoardFromAi, true, 'can seed flag');
});

test('AI board regenerates from current value context and does not float low-DHQ players to the top', () => {
  ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD_DRAFT('L2B', 'rookie'), {
    aiOrder: ['low', 'elite'],
    activeLane: 'ai',
  });
  const board = ctx.DraftCC.context.buildBoardContext({
    leagueId: 'L2B',
    draftType: 'rookie',
    currentLeague: league,
    pool: [
      { pid: 'elite', name: 'Elite WR', pos: 'WR', dhq: 6200, age: 22, tier: 1 },
      { pid: 'low', name: 'Need LB', pos: 'LB', dhq: 1450, age: 22, tier: 1 },
    ],
    userAssessment: { needs: [{ pos: 'LB', urgency: 'deficit' }] },
  });
  eq(board.lanes.ai.order[0], 'elite', 'high-DHQ player remains AI board leader');
  ok(board.entries.low.aiRank > board.entries.elite.aiRank, 'low-DHQ need fit stays below top value');
});

test('draft-type board storage overrides legacy board without losing fallback data', () => {
  ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD('L3'), {
    notes: { p1: 'legacy note' },
    tags: { p1: 'target' },
    myOrder: ['p1', 'p2', 'p3'],
  });
  ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD_DRAFT('L3', 'rookie'), {
    notes: { p2: 'rookie note' },
    tags: { p1: 'fade' },
    activeLane: 'ai',
  });
  const board = ctx.DraftCC.context.buildBoardContext({
    leagueId: 'L3',
    draftType: 'rookie',
    pool,
  });
  eq(board.activeLane, 'ai', 'typed active lane');
  ok(board.lanes.ai.order.length === pool.length, 'ai board generated when typed board omits aiOrder');
  ok(board.entries.p1.aiRank > 0, 'ai rank generated');
  eq(board.entries.p1.tag, 'fade', 'typed tag overrides legacy');
  eq(board.entries.p1.note, 'legacy note', 'legacy note remains');
  eq(board.entries.p2.note, 'rookie note', 'typed note added');
  eq(board.lanes.my.order[0], 'p1', 'legacy my order fallback remains');
});

test('saveBoardPatch and applyBoardPatchToContext preserve user-owned My Board edits', () => {
  const saved = ctx.DraftCC.context.saveBoardPatch('L4', 'startup', {
    myOrder: ['p2', 'p1', 'p3'],
    tags: { p2: 'must' },
    notes: { p2: 'Do not let this fall.' },
    activeLane: 'my',
  });
  ok(saved.myOrder[0] === 'p2', 'saved order');
  const draftContext = ctx.DraftCC.context.buildDraftContext({
    state: { leagueId: 'L4', variant: 'startup', pool, pickOrder: [], personas: {} },
    currentLeague: { ...league, league_id: 'L4' },
    pool,
    personas: {},
  });
  const next = ctx.DraftCC.context.applyBoardPatchToContext(draftContext, {
    notes: { p2: 'Updated note.' },
    tags: { p2: 'fade' },
    activeLane: 'my',
  });
  eq(next.boardContext.activeLane, 'my', 'active lane patched');
  eq(next.boardContext.entries.p2.note, 'Updated note.', 'note patched');
  eq(next.boardContext.entries.p2.tag, 'fade', 'tag patched');
  eq(next.boardContext.lanes.my.source, 'user_manual', 'manual fork preserved');
  eq(next.simulation.activeBoardLane, 'my', 'simulation lane patched');

  const ranked = ctx.DraftCC.context.applyBoardPatchToContext(next, {
    myOrder: ['p3', 'p2', 'p1'],
    tiers: { p2: 4 },
    activeLane: 'my',
  });
  eq(ranked.boardContext.lanes.my.order[0], 'p3', 'manual rank moved');
  eq(ranked.boardContext.entries.p3.myRank, 1, 'manual rank recomputed');
  eq(ranked.boardContext.entries.p2.myRank, 2, 'moved player rank recomputed');
  eq(ranked.boardContext.entries.p2.tier, 4, 'manual tier patched');

  const cleared = ctx.DraftCC.context.applyBoardPatchToContext(ranked, {
    tiers: { p2: 0 },
    activeLane: 'my',
  });
  eq(cleared.boardContext.entries.p2.tier, null, 'manual tier can be cleared');
});

test('buildBoardContext keeps explicit cleared tier overrides distinct from source tiers', () => {
  ctx.App.WrStorage.set(ctx.App.WR_KEYS.BIGBOARD_DRAFT('L5', 'startup'), {
    tiers: { p1: 0, p2: 4 },
    myOrder: ['p1', 'p2', 'p3'],
  });
  const board = ctx.DraftCC.context.buildBoardContext({
    leagueId: 'L5',
    draftType: 'startup',
    pool,
  });
  eq(board.entries.p1.tier, null, 'source tier cleared by user override');
  eq(board.entries.p2.tier, 4, 'manual tier override applied');
  eq(board.lanes.my.source, 'user_manual', 'manual board source');
});

test('composePersona enriches existing Owner DNA into Owner Intel', () => {
  const persona = ctx.DraftCC.persona.composePersona({
    rosterId: 2,
    leagueId: 'L1',
    draftDnaMap: {
      2: {
        label: 'RB-Hunter',
        posPct: { RB: 44, WR: 22 },
        r1Positions: ['RB', 'RB', 'WR'],
        picksAnalyzed: 18,
      },
    },
  });
  ok(persona.ownerIntel, 'owner intel exists');
  eq(persona.tradeDna.key, 'FLEECER', 'owner dna preserved');
  eq(persona.ownerIntel.confidence.areas.draft, 'high', 'draft confidence');
  eq(persona.ownerIntel.confidence.areas.trade, 'high', 'trade confidence');
  ok(persona.ownerIntel.reasonCodes.some(r => r.code === 'draft_position_bias'), 'position bias reason');
  ok(persona.ownerIntel.reasonCodes.some(r => r.code === 'behavior_profile'), 'behavior reason');
});

test('buildDraftContext joins board, owner, team, valuation, and evidence', () => {
  const personas = ctx.DraftCC.persona.composeAllPersonas('L1', {
    2: { label: 'RB-Hunter', posPct: { RB: 44 }, r1Positions: ['RB'], picksAnalyzed: 18 },
  });
  const state = {
    id: 'draft1',
    leagueId: 'L1',
    season: 2026,
    phase: 'drafting',
    variant: 'startup',
    mode: 'solo',
    draftType: 'snake',
    leagueSize: 12,
    userRosterId: 1,
    userSlot: 1,
    pool,
    pickOrder: [{ round: 1, slot: 1, overall: 1, rosterId: 1 }],
    picks: [],
    personas,
    draftTuning: { ownerDna: 90 },
  };
  const draftContext = ctx.DraftCC.context.buildDraftContext({
    state,
    currentLeague: league,
    myRoster: ctx.S.rosters[0],
    pool,
    pickOrder: state.pickOrder,
    personas,
  });
  eq(draftContext.schemaVersion, 'draft-context-v1', 'version');
  eq(draftContext.boardContext.lanes.my.order[0], 'p3', 'board carried');
  ok(draftContext.ownerContext['2'].reasonCodes.length > 0, 'owner intel carried');
  eq(draftContext.teamContext.userRosterId, 1, 'team context');
  ok(draftContext.valuationContext.scarcityByPosition.WR.length > 0, 'valuation context');
  ok(draftContext.evidence.some(e => e.source === 'manual_board' && e.present), 'manual board evidence');
});

test('applyPickToContext marks drafted players and updates runtime', () => {
  const base = ctx.DraftCC.context.buildDraftContext({
    state: { leagueId: 'L1', pool, pickOrder: [], personas: {} },
    currentLeague: league,
    pool,
    personas: {},
  });
  const next = ctx.DraftCC.context.applyPickToContext(
    base,
    { pid: 'p1', name: 'Alpha WR', isUser: true },
    { currentIdx: 1, picks: [{ pid: 'p1', isUser: true }], pool: pool.slice(1), tradedAssets: {} }
  );
  eq(next.runtime.currentIdx, 1, 'current idx');
  eq(next.runtime.remainingPoolSize, 2, 'pool size');
  eq(next.boardContext.entries.p1.drafted, true, 'entry drafted');
  ok(next.boardContext.drafted.includes('p1'), 'drafted list');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

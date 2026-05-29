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

function buildCtx() {
  const ctx = {
    console,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    window: null,
  };
  ctx.window = ctx;
  ctx.App = {
    PlayerValue: {
      getPickValue(_season, round, teams, slot) {
        const overall = (Number(round) - 1) * Number(teams) + Number(slot || 1);
        return Math.max(1000, 10000 - (overall - 1) * 650);
      },
    },
    LI: {
      playerScores: {
        wr1: 9200,
        wr2: 5200,
        rb1: 6800,
        te1: 4800,
      },
    },
  };
  ctx.S = {
    players: {
      wr1: { full_name: 'Alpha WR', position: 'WR' },
      wr2: { full_name: 'Beta WR', position: 'WR' },
      rb1: { full_name: 'Gamma RB', position: 'RB' },
      te1: { full_name: 'Delta TE', position: 'TE' },
    },
    rosters: [
      { roster_id: 1, players: ['wr1', 'wr2'] },
      { roster_id: 2, players: ['rb1', 'te1'] },
      { roster_id: 3, players: [] },
    ],
  };
  ctx.DraftCC = {};
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/trade-helpers.js');
load(ctx, 'js/draft/trade-simulator.js');

const pickOrder = [
  { round: 1, slot: 1, overall: 1, teamIdx: 0, rosterId: 1 },
  { round: 1, slot: 2, overall: 2, teamIdx: 1, rosterId: 2 },
  { round: 1, slot: 3, overall: 3, teamIdx: 2, rosterId: 3 },
  { round: 1, slot: 4, overall: 4, teamIdx: 3, rosterId: 4 },
  { round: 2, slot: 1, overall: 5, teamIdx: 0, rosterId: 1 },
  { round: 2, slot: 2, overall: 6, teamIdx: 1, rosterId: 2 },
  { round: 2, slot: 3, overall: 7, teamIdx: 2, rosterId: 3 },
  { round: 2, slot: 4, overall: 8, teamIdx: 3, rosterId: 4 },
  { round: 3, slot: 1, overall: 9, teamIdx: 0, rosterId: 1 },
  { round: 3, slot: 2, overall: 10, teamIdx: 1, rosterId: 2 },
  { round: 3, slot: 3, overall: 11, teamIdx: 2, rosterId: 3 },
  { round: 3, slot: 4, overall: 12, teamIdx: 3, rosterId: 4 },
];

const baseState = {
  phase: 'drafting',
  season: 2026,
  leagueSize: 4,
  rounds: 3,
  currentIdx: 0,
  userRosterId: 1,
  draftTuning: { tradeActivity: 50 },
  pickOrder,
  personas: {
    1: {
      rosterId: 1,
      teamName: 'User Team',
      assessment: { strengths: ['WR'], needs: ['QB'], window: 'CONTENDING' },
      tradeDna: { key: 'NONE', label: 'Balanced' },
      posture: { key: 'NEUTRAL', label: 'Neutral' },
    },
    2: {
      rosterId: 2,
      teamName: 'Acceptor Team',
      assessment: { strengths: ['RB'], needs: [{ pos: 'WR', urgency: 'deficit' }], window: 'REBUILDING' },
      tradeDna: { key: 'ACCEPTOR', label: 'The Acceptor' },
      posture: { key: 'SELLER', label: 'Active Seller' },
      ownerIntel: {
        behavior: { scores: { liquidity: 82 } },
        reasonCodes: [{ code: 'behavior_profile', detail: 'active-trader, soft-market' }],
      },
    },
    3: {
      rosterId: 3,
      teamName: 'Locked Team',
      assessment: { strengths: ['WR'], needs: [], window: 'CONTENDING' },
      tradeDna: { key: 'STALWART', label: 'The Stalwart' },
      posture: { key: 'LOCKED', label: 'Locked In' },
    },
  },
};

console.log('\nWar Room draft trade simulator contract');

test('realistic owner accepts package that clears buyer line', () => {
  const result = ctx.DraftCC.tradeSimulator.evaluateUserProposal(baseState, {
    targetRosterId: 2,
    myGivePlayers: ['wr1'],
    theirGive: [pickOrder[9]],
  });
  ok(result.likelihood >= result.acceptanceLine, 'likelihood clears buyer line');
  ok(result.accepted, 'accepted');
  ok(result.modifiers.some(m => m.label === 'Need fulfillment'), 'need fit modifier included');
  ok(result.rawDhqDelta > 0, 'raw DHQ remains separate and positive for buyer');
});

test('near miss produces a counter instead of a binary decline', () => {
  const result = ctx.DraftCC.tradeSimulator.evaluateUserProposal(baseState, {
    targetRosterId: 2,
    myGive: [pickOrder[8]],
    theirGive: [pickOrder[5]],
  });
  eq(result.accepted, false, 'not accepted');
  eq(result.verdict, 'countered', 'counter verdict');
  ok(result.counterOffer, 'counter offer exists');
  ok(result.counterOffer.myGive.length > 1 || result.counterOffer.myGiveFaab > 0, 'counter asks for a sweetener');
  ok(result.negotiationRead.message.includes('close') || result.negotiationRead.message.includes('light'), 'counter has human negotiation read');
});

test('locked roster declines regardless of surface value', () => {
  const result = ctx.DraftCC.tradeSimulator.evaluateUserProposal(baseState, {
    targetRosterId: 3,
    myGivePlayers: ['wr1'],
    theirGive: [pickOrder[10]],
  });
  eq(result.accepted, false, 'locked decline');
  eq(result.verdict, 'declined', 'declined');
  ok(result.likelihood <= 20, 'locked likelihood capped');
});

test('trade activity tuning changes buyer line and odds', () => {
  const low = ctx.DraftCC.tradeSimulator.evaluateUserProposal({
    ...baseState,
    draftTuning: { tradeActivity: 10 },
  }, {
    targetRosterId: 2,
    myGive: [pickOrder[8]],
    theirGive: [pickOrder[5]],
  });
  const high = ctx.DraftCC.tradeSimulator.evaluateUserProposal({
    ...baseState,
    draftTuning: { tradeActivity: 95 },
  }, {
    targetRosterId: 2,
    myGive: [pickOrder[8]],
    theirGive: [pickOrder[5]],
  });
  ok(high.likelihood > low.likelihood, 'high activity increases odds');
  ok(high.acceptanceLine < low.acceptanceLine, 'high activity lowers buyer line');
});

test('forced CPU offer uses buyer-line evaluation', () => {
  const offer = ctx.DraftCC.tradeSimulator.maybeGenerateTradeOffer(baseState, 2, {
    force: true,
    lastOfferPickIdx: -99,
  });
  ok(offer, 'offer generated');
  eq(offer.fromRosterId, 2, 'from target');
  ok(offer.acceptanceLine, 'buyer line exposed');
  ok(Array.isArray(offer.modifiers), 'modifiers exposed');
});

test('CPU offer probability is fully gated by historical draft-pick trade activity when present', () => {
  const noHistoryState = {
    ...baseState,
    draftTuning: { tradeActivity: 100 },
    draftContext: { tradedPicks: [] },
  };
  eq(ctx.DraftCC.tradeSimulator.cpuOfferRate(noHistoryState), 0, 'no historical pick trades means no CPU offers');
  const blocked = ctx.DraftCC.tradeSimulator.maybeGenerateTradeOffer(noHistoryState, 2, {
    force: true,
    lastOfferPickIdx: -99,
  });
  eq(blocked, null, 'forced offer still respects zero historical probability');

  const activeHistoryState = {
    ...baseState,
    draftTuning: { tradeActivity: 0 },
    draftContext: { tradedPicks: [{ season: 2026, round: 1, roster_id: 2, owner_id: 1 }] },
  };
  ok(ctx.DraftCC.tradeSimulator.cpuOfferRate(activeHistoryState) > 0, 'historical pick trades create CPU offer probability even when tuning is low');
  eq(ctx.DraftCC.tradeSimulator.historicalDraftPickTradeSignal(activeHistoryState).count, 1, 'historical moved-pick count');
});

test('trade desk partner intel exposes owner profile and tradable assets', () => {
  const profile = ctx.DraftCC.tradeSimulator.describeTradePartner(baseState, 2);
  eq(profile.teamName, 'Acceptor Team', 'team name');
  ok(profile.buyerLine < 70, 'seller acceptor buyer line is lower than neutral');
  ok(profile.needs.includes('WR'), 'needs normalized');
  ok(profile.tradablePlayers.some(p => p.pid === 'rb1'), 'tradable roster assets exposed');
  ok(profile.ownerIntelSummary.includes('active-trader'), 'historical owner intel summarized');
});

test('mock pick values use the canonical exact-slot value source', () => {
  eq(ctx.DraftCC.tradeSimulator.pickValueFor(baseState, pickOrder[0]), 10000, '1.01 exact slot');
  eq(ctx.DraftCC.tradeSimulator.pickValueFor(baseState, pickOrder[5]), 6750, '2.02 exact slot');
  eq(ctx.DraftCC.tradeSimulator.pickValueFor(baseState, { ...pickOrder[5], value: 2468 }), 2468, 'pre-resolved pick value respected');
});

test('trade desk suggestions build loadable packages with buyer-line reads', () => {
  const suggestions = ctx.DraftCC.tradeSimulator.buildTradeSuggestions(baseState, 2);
  ok(suggestions.length >= 3, 'multiple package ideas generated');
  ok(suggestions.some(s => s.id === 'sell-player'), 'sell player package generated from owner needs');
  ok(suggestions.every(s => String(s.proposal.targetRosterId) === '2'), 'all packages target selected partner');
  ok(suggestions.every(s => Number.isFinite(s.likelihood) && s.acceptanceLine), 'all packages expose live acceptance read');
});

test('trade desk sweetener suggestion loads likely counter shape', () => {
  const suggestions = ctx.DraftCC.tradeSimulator.buildTradeSuggestions(baseState, 2, {
    currentProposal: {
      targetRosterId: 2,
      myGive: [pickOrder[8]],
      theirGive: [pickOrder[5]],
    },
  });
  const sweetener = suggestions.find(s => s.id === 'sweetener');
  ok(sweetener, 'sweetener suggestion generated');
  ok((sweetener.proposal.myGive || []).length > 1 || sweetener.proposal.myGiveFaab > 0, 'sweetener improves user side');
});

test('impossible packages are blocked before negotiation odds', () => {
  const result = ctx.DraftCC.tradeSimulator.evaluateUserProposal(baseState, {
    targetRosterId: 2,
    myGive: [pickOrder[9]],
    theirGive: [pickOrder[9]],
    myGivePlayers: ['rb1'],
  });
  eq(result.accepted, false, 'not accepted');
  eq(result.verdict, 'declined', 'declined');
  ok(result.realism.blocked, 'blocked by realism guard');
  ok(result.realismFlags.some(flag => flag.code === 'same_pick_both_sides'), 'same pick flagged');
  ok(result.realismFlags.some(flag => flag.code === 'user_player_unavailable'), 'unavailable player flagged');
  ok(result.likelihood <= 2, 'likelihood capped');

  const direct = ctx.DraftCC.tradeSimulator.validateProposalRealism(baseState, {
    targetRosterId: 1,
    myGiveFaab: -5,
  });
  ok(direct.blocked, 'direct validator blocks self/negative package');
  ok(direct.flags.some(flag => flag.code === 'self_trade'), 'self trade flagged');
  ok(direct.flags.some(flag => flag.code === 'negative_faab'), 'negative FAAB flagged');
});

test('active offers expire when their pick window or assets are no longer live', () => {
  const offer = ctx.DraftCC.tradeSimulator.maybeGenerateTradeOffer(baseState, 2, {
    force: true,
    lastOfferPickIdx: -99,
  });
  ok(offer, 'offer generated');
  const live = ctx.DraftCC.tradeSimulator.validateActiveOffer(baseState, offer);
  ok(live.valid, 'offer is valid while target pick is still live');

  const expired = ctx.DraftCC.tradeSimulator.validateActiveOffer({
    ...baseState,
    currentIdx: Math.max(offer.targetPickOverall || 0, 1),
  }, offer);
  eq(expired.valid, false, 'offer expires after target pick passes');
  ok(expired.reason.includes('room has moved'), 'expired reason explains pick window');
});

test('live trade windows rank actionable upcoming owners', () => {
  const liveState = {
    ...baseState,
    mode: 'live-sync',
    currentIdx: 1,
  };
  const windows = ctx.DraftCC.tradeSimulator.buildLiveTradeWindows(liveState, { lookahead: 3 });
  ok(windows.length >= 1, 'at least one live window generated');
  eq(String(windows[0].rosterId), '2', 'upcoming acceptor ranked first');
  ok(windows[0].pickLabel, 'pick label exposed');
  ok(windows[0].suggestion, 'package suggestion attached');
  ok(Number.isFinite(windows[0].likelihood), 'likelihood exposed');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

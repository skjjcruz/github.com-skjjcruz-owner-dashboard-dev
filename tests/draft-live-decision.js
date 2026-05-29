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
    Date,
    window: null,
  };
  ctx.window = ctx;
  ctx.DraftCC = {};
  ctx.App = {
    PlayerValue: {
      projectPlayerValue: (_pid, dhq, _age, _pos, years) => Math.round(dhq * (1 + years * 0.08)),
    },
  };
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/live-decision-engine.js');

const pool = [
  { pid: 'rb1', name: 'Rocket Back', pos: 'RB', dhq: 5000, age: 21, tier: 1 },
  { pid: 'wr1', name: 'Safe Wideout', pos: 'WR', dhq: 4800, age: 24, tier: 1 },
  { pid: 'qb1', name: 'Risky Quarterback', pos: 'QB', dhq: 4700, age: 35, tier: 2 },
  { pid: 'te1', name: 'Tier Tight End', pos: 'TE', dhq: 4300, age: 22, tier: 1 },
];

const baseState = {
  mode: 'live-sync',
  currentIdx: 0,
  userRosterId: 7,
  userSlot: 7,
  draftedPids: {},
  pool,
  pickOrder: [
    { overall: 1, round: 1, slot: 1, rosterId: 1 },
    { overall: 2, round: 1, slot: 2, rosterId: 2 },
    { overall: 3, round: 1, slot: 3, rosterId: 3 },
    { overall: 4, round: 1, slot: 4, rosterId: 7 },
  ],
  personas: {
    1: {
      rosterId: 1,
      teamName: 'Owner One',
      ownerIntel: {
        confidence: { overall: 'high' },
        reasonCodes: [{ code: 'draft_position_bias', detail: 'Owner One has chased RB in early rounds.' }],
      },
    },
    7: {
      rosterId: 7,
      teamName: 'You',
      assessment: { needs: [{ pos: 'RB', urgency: 'critical' }] },
    },
  },
  draftContext: {
    boardContext: {
      activeLane: 'my',
      lanes: {
        dhq: { order: ['rb1', 'wr1', 'qb1', 'te1'] },
        ai: { order: ['rb1', 'te1', 'wr1', 'qb1'] },
        my: { order: ['wr1', 'rb1', 'qb1', 'te1'] },
      },
      entries: {
        rb1: { pid: 'rb1', myRank: 2, dhqRank: 1, tier: 1, tag: 'target', target: true },
        wr1: { pid: 'wr1', myRank: 1, dhqRank: 2, tier: 1 },
        qb1: { pid: 'qb1', myRank: 3, dhqRank: 3, tier: 2, tag: 'fade', fade: true },
        te1: { pid: 'te1', myRank: 4, dhqRank: 4, tier: 1 },
      },
    },
  },
};

console.log('\nWar Room live decision engine contract');

test('buildDecisionDeck returns live pick cards from board, need, and projection context', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState);
  eq(deck.schemaVersion, 'draft-live-decision-v1', 'schema');
  ok(deck.cards.find(c => c.kind === 'recommended'), 'recommended card');
  ok(deck.cards.find(c => c.kind === 'safe'), 'safe card');
  ok(deck.cards.find(c => c.kind === 'upside'), 'upside card');
  eq(deck.assumptions.boardLane, 'my', 'active board lane');
});

test('target survival and owner tendency alerts use live room context', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState);
  ok(deck.alerts.some(a => a.type === 'target_survival'), 'target survival alert');
  ok(deck.alerts.some(a => a.type === 'owner_tendency'), 'owner tendency alert');
});

test('avoid card respects user-board fade markers', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState);
  const avoid = deck.cards.find(c => c.kind === 'avoid');
  ok(avoid, 'avoid card');
  eq(avoid.player.pid, 'qb1', 'fade player selected');
  ok(avoid.detail.includes('User-board'), 'avoid reason');
});

test('trade window becomes a live trade card', () => {
  const deck = ctx.DraftCC.liveDecisionEngine.buildDecisionDeck(baseState, {
    tradeWindow: {
      rosterId: 2,
      teamName: 'Owner Two',
      likelihood: 71,
      acceptanceLine: 64,
    },
  });
  const trade = deck.cards.find(c => c.kind === 'trade_down');
  ok(trade, 'trade card');
  eq(trade.action, 'trade', 'trade action');
  ok(trade.detail.includes('Owner Two'), 'trade detail names partner');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

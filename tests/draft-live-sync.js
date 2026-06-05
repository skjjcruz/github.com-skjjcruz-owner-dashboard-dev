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
  ctx.App = {};
  return vm.createContext(ctx);
}

function load(ctx, relPath) {
  const source = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  vm.runInContext(source, ctx, { filename: relPath });
}

const ctx = buildCtx();
load(ctx, 'js/draft/live-sync.js');
load(ctx, 'js/draft/state.js');

const pickOrder = [
  { round: 1, slot: 1, overall: 1, teamIdx: 0, originalRosterId: 1, rosterId: 1 },
  { round: 1, slot: 2, overall: 2, teamIdx: 1, originalRosterId: 2, rosterId: 2 },
  { round: 1, slot: 3, overall: 3, teamIdx: 2, originalRosterId: 3, rosterId: 3 },
];

console.log('\nWar Room live draft sync contract');

test('live sync reconciliation skips already-seen picks and returns only new picks', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 2, player_id: 'p2', roster_id: 2 },
    { pick_no: 3, player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 1,
    seenPickKeys: ['no:1'],
    draftStatus: 'drafting',
  });
  eq(result.newPicks.length, 2, 'new pick count');
  eq(result.newPicks[0].pick_no, 2, 'first new pick');
  eq(result.duplicateCount, 1, 'duplicate count');
  eq(result.lastPickNo, 3, 'last pick no');
});

test('live sync reconciliation reports missing remote pick numbers', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 3, player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 0,
    seenPickKeys: [],
    draftStatus: 'drafting',
  });
  eq(result.missingPickNos[0], 2, 'missing pick');
  eq(result.gapCount, 1, 'gap count');
  eq(result.remoteBehind, false, 'not remote behind');
});

test('live sync reconciliation flags a remote feed behind the local mirror', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
  ], {
    initialPickNo: 2,
    seenPickKeys: ['no:1', 'no:2'],
    draftStatus: 'drafting',
  });
  ok(result.remoteBehind, 'remote behind flagged');
  eq(result.remoteMaxPickNo, 1, 'remote max pick');
  eq(result.missingPickNos.length, 0, 'missing pick list suppressed for rollback case');
});

test('live sync reconciliation flags conflicting pick records and withholds that slot', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 2, player_id: 'p2', roster_id: 2 },
    { pick_no: 2, player_id: 'pX', roster_id: 2 },
    { pick_no: 3, player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 1,
    seenPickKeys: ['no:1'],
    draftStatus: 'drafting',
  });
  eq(result.conflictPickNos[0], 2, 'conflicted pick number');
  eq(result.conflictCount, 1, 'conflict count');
  ok(!result.newPicks.some(p => Number(p.pick_no) === 2), 'conflicted slot withheld');
  ok(ctx.DraftCC.liveSync._private.liveSyncStaleReason(result).includes('conflicting records'), 'stale reason names conflict');
});

test('live sync reconciliation counts invalid Sleeper pick records', () => {
  const result = ctx.DraftCC.liveSync._private.reconcilePicks([
    { pick_no: 1, player_id: 'p1', roster_id: 1 },
    { pick_no: 2, roster_id: 2 },
    { player_id: 'p3', roster_id: 3 },
  ], {
    initialPickNo: 1,
    seenPickKeys: ['no:1'],
    draftStatus: 'drafting',
  });
  eq(result.invalidPickCount, 2, 'invalid pick records counted');
  eq(result.newPicks.length, 0, 'invalid records are not mirrored');
  ok(ctx.DraftCC.liveSync._private.liveSyncStaleReason(result).includes('invalid pick'), 'stale reason names invalid records');
});

test('state applies live picks in order without duplicating sleeper picks', () => {
  const initial = ctx.DraftCC.state.initialDraftState({
    mode: 'live-sync',
    leagueId: 'L1',
    userRosterId: 1,
  });
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: [{ pid: 'p1', name: 'One', pos: 'QB', dhq: 100 }, { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 }],
    pickOrder,
    personas: {},
    liveDraftStatus: 'drafting',
  });
  const once = ctx.DraftCC.state.reducer(started, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 1, player_id: 'p1', roster_id: 1, picked_by: 'u1' },
      player: { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    }],
    status: { status: 'mirroring', remotePickCount: 1, lastPollAt: 123 },
  });
  eq(once.currentIdx, 1, 'advanced one pick');
  eq(once.picks.length, 1, 'one pick applied');
  eq(once.picks[0].sleeperPickNo, 1, 'sleeper pick number stored');
  eq(once.liveSync.status, 'mirroring', 'live sync status');

  const duplicate = ctx.DraftCC.state.reducer(once, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 1, player_id: 'p1', roster_id: 1 },
      player: { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    }],
    status: { status: 'mirroring', remotePickCount: 1 },
  });
  eq(duplicate.currentIdx, 1, 'duplicate does not advance');
  eq(duplicate.picks.length, 1, 'duplicate does not append');
  eq(duplicate.liveSync.duplicateCount, 1, 'duplicate counted for current sync pass');
});

test('state flags a skipped live pick instead of applying it to the wrong slot', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: [{ pid: 'p3', name: 'Three', pos: 'WR', dhq: 80 }],
    pickOrder,
    personas: {},
    liveDraftStatus: 'drafting',
  });
  const next = ctx.DraftCC.state.reducer(started, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 3, player_id: 'p3', roster_id: 3 },
      player: { pid: 'p3', name: 'Three', pos: 'WR', dhq: 80 },
    }],
    status: { status: 'mirroring', remotePickCount: 3 },
  });
  eq(next.currentIdx, 0, 'gap does not advance');
  eq(next.picks.length, 0, 'gap does not append wrong slot');
  eq(next.liveSync.status, 'stale', 'gap marks stale');
  ok(next.liveSync.missedPickCount > 0, 'gap counted');
  eq(next.liveSync.missingPickNos[0], 1, 'expected local pick preserved');
});

test('state keeps live sync stale when Sleeper returns conflicting pick data', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: [{ pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 }],
    pickOrder,
    personas: {},
    liveDraftStatus: 'drafting',
  });
  const next = ctx.DraftCC.state.reducer(started, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{
      sleeperPick: { pick_no: 2, player_id: 'p2', roster_id: 2 },
      player: { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
    }],
    status: {
      status: 'stale',
      remotePickCount: 2,
      conflictCount: 1,
      conflictPickNos: [2],
      error: 'Sleeper returned conflicting records for pick 2. Dynasty HQ paused before applying the wrong player.',
    },
  });
  eq(next.currentIdx, 0, 'conflict does not advance current pick');
  eq(next.picks.length, 0, 'conflict does not append pick');
  eq(next.liveSync.status, 'stale', 'conflict status preserved');
  eq(next.liveSync.conflictPickNos[0], 2, 'conflict pick stored');
});

test('live-sync manual pick is tagged manual-live and is undoable', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT', pool, originalPool: pool, pickOrder, personas: {}, liveDraftStatus: 'drafting',
  });
  // On-clock board click records the pick with no explicit source (override off).
  const picked = ctx.DraftCC.state.reducer(started, { type: 'MAKE_PICK', player: started.pool[0], isUser: true });
  eq(picked.picks[0].source, 'manual-live', 'live-sync hand-entered pick tagged manual-live');
  const undone = ctx.DraftCC.state.reducer(picked, { type: 'UNDO_LAST_PICK', manualOnly: true });
  eq(undone.picks.length, 0, 'manual live pick can be undone');
  eq(undone.currentIdx, 0, 'index rewound after undo');
});

test('live sync overwrites a manual pick when the real pick differs', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
    { pid: 'p3', name: 'Three', pos: 'WR', dhq: 80 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT', pool, originalPool: pool, pickOrder, personas: {}, liveDraftStatus: 'drafting',
  });
  const guessed = ctx.DraftCC.state.reducer(started, { type: 'MAKE_PICK', player: started.pool[0] });
  eq(guessed.picks[0].pid, 'p1', 'manual guess recorded');
  eq(guessed.currentIdx, 1, 'manual guess advanced the clock');
  const reconciled = ctx.DraftCC.state.reducer(guessed, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{ sleeperPick: { pick_no: 1, player_id: 'p2', roster_id: 1, picked_by: 'u1' }, player: { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 } }],
    status: { status: 'mirroring' },
  });
  eq(reconciled.picks.length, 1, 'pick replaced in place, not appended');
  eq(reconciled.picks[0].pid, 'p2', 'manual pick overwritten with reality');
  eq(reconciled.picks[0].source, 'live-sync', 'overwritten pick marked authoritative');
  eq(reconciled.currentIdx, 1, 'overwrite does not change the clock');
  ok(reconciled.draftedPids.p2 && !reconciled.draftedPids.p1, 'drafted set reflects reality');
  ok(reconciled.pool.some(p => p.pid === 'p1'), 'displaced manual player returned to pool');
  ok(!reconciled.pool.some(p => p.pid === 'p2'), 'real pick removed from pool');
  eq(reconciled.liveSync.overwriteCount, 1, 'overwrite counted');
});

test('live sync confirms a manual pick that matched reality without duplicating it', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT', pool, originalPool: pool, pickOrder, personas: {}, liveDraftStatus: 'drafting',
  });
  const guessed = ctx.DraftCC.state.reducer(started, { type: 'MAKE_PICK', player: started.pool[0] });
  const reconciled = ctx.DraftCC.state.reducer(guessed, {
    type: 'APPLY_LIVE_SYNC_PICKS',
    picks: [{ sleeperPick: { pick_no: 1, player_id: 'p1', roster_id: 1, picked_by: 'u1' }, player: { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 } }],
    status: { status: 'mirroring' },
  });
  eq(reconciled.picks.length, 1, 'matching live pick does not duplicate');
  eq(reconciled.picks[0].pid, 'p1', 'pick unchanged');
  eq(reconciled.picks[0].source, 'live-sync', 'manual guess confirmed as live-sourced');
  eq(reconciled.picks[0].sleeperPickNo, 1, 'sleeper pick number stamped on confirm');
  eq(reconciled.currentIdx, 1, 'confirm does not advance the clock');
  eq(reconciled.liveSync.reconciledCount, 1, 'reconcile counted');
});

test('state stores staged live offers for handoff', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const withDrawer = ctx.DraftCC.state.reducer(initial, { type: 'OPEN_PROPOSER', targetRosterId: 2 });
  const staged = ctx.DraftCC.state.reducer(withDrawer, {
    type: 'STAGE_LIVE_OFFER',
    offer: {
      partnerName: 'Team Two',
      giveText: 'R1.01',
      getText: 'R1.02',
      copyText: 'Offer text',
      likelihood: 72,
      acceptanceLine: 64,
    },
  });
  eq(staged.stagedLiveOffers.length, 1, 'staged offer stored');
  eq(staged.proposerDrawer.status, 'planned', 'drawer planned state');
  ok(staged.stagedLiveOffers[0].copyText.includes('Offer'), 'copy text preserved');
});

test('live offer lifecycle tracks sent, accepted, and rejected states', () => {
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'live-sync', leagueId: 'L1', userRosterId: 1 });
  const withDrawer = ctx.DraftCC.state.reducer(initial, { type: 'OPEN_PROPOSER', targetRosterId: 2 });
  const staged = ctx.DraftCC.state.reducer(withDrawer, {
    type: 'STAGE_LIVE_OFFER',
    offer: { id: 'offer-1', partnerName: 'Team Two', copyText: 'Offer text' },
  });
  const pending = ctx.DraftCC.state.reducer(staged, {
    type: 'UPDATE_LIVE_OFFER_STATUS',
    offerId: 'offer-1',
    status: 'pending',
  });
  eq(pending.stagedLiveOffers[0].status, 'pending', 'pending status stored');
  eq(pending.proposerDrawer.status, 'pending', 'drawer pending');
  const accepted = ctx.DraftCC.state.reducer(pending, {
    type: 'UPDATE_LIVE_OFFER_STATUS',
    offerId: 'offer-1',
    status: 'accepted',
  });
  eq(accepted.stagedLiveOffers[0].status, 'accepted', 'accepted status stored');
  ok(accepted.stagedLiveOffers[0].resolvedAt, 'resolved timestamp stored');

  const second = ctx.DraftCC.state.reducer(accepted, {
    type: 'STAGE_LIVE_OFFER',
    offer: { id: 'offer-2', partnerName: 'Team Three', copyText: 'Second offer' },
  });
  const rejected = ctx.DraftCC.state.reducer(second, {
    type: 'UPDATE_LIVE_OFFER_STATUS',
    offerId: 'offer-2',
    status: 'rejected',
  });
  eq(rejected.stagedLiveOffers.find(o => o.id === 'offer-2').status, 'rejected', 'rejected status stored');
});

test('manual draft picks update recap ranking from flat pick records', () => {
  const initial = ctx.DraftCC.state.initialDraftState({
    mode: 'manual',
    leagueId: 'L1',
    userRosterId: 1,
    userSlot: 1,
  });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100, consensusRank: 1 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90, consensusRank: 2 },
    { pid: 'p3', name: 'Three', pos: 'WR', dhq: 80, consensusRank: 3 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool,
    originalPool: pool,
    pickOrder,
    personas: {},
  });
  const one = ctx.DraftCC.state.reducer(started, {
    type: 'MAKE_PICK',
    player: started.pool[0],
    source: 'manual-draft',
  });
  const two = ctx.DraftCC.state.reducer(one, {
    type: 'MAKE_PICK',
    player: one.pool.find(p => p.pid === 'p2'),
    source: 'manual-draft',
  });
  const recap = ctx.DraftCC.state.buildDraftRecap(two);
  eq(two.pickedByIdx[1].pid, 'p1', 'pickedByIdx maintained');
  eq(recap.leagueTotals['1'], 100, 'user total');
  eq(recap.leagueTotals['2'], 90, 'other total');
  eq(recap.rank, 1, 'recap rank');
  ok(ctx.DraftCC.state.formatDraftRecapText(recap).includes('One - QB'), 'text export uses flat pick data');
});

test('manual correction undo restores board order and derived draft state', () => {
  const initial = ctx.DraftCC.state.initialDraftState({
    mode: 'manual',
    leagueId: 'L1',
    userRosterId: 1,
    userSlot: 1,
  });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100 },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90 },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool,
    originalPool: pool,
    pickOrder,
    personas: {},
  });
  const picked = ctx.DraftCC.state.reducer(started, {
    type: 'MAKE_PICK',
    player: started.pool[0],
    source: 'manual-draft',
  });
  const withAlex = {
    ...picked,
    alex: {
      ...picked.alex,
      stream: [
        { id: 'ev1', relatedPickNo: 1, title: 'R1.01 - One' },
        { id: 'ev2', relatedPickNo: 99, title: 'Keep this' },
      ],
    },
  };
  const undone = ctx.DraftCC.state.reducer(withAlex, { type: 'UNDO_LAST_PICK', manualOnly: true });
  eq(undone.picks.length, 0, 'pick removed');
  eq(undone.currentIdx, 0, 'index rewound');
  eq(undone.pool[0].pid, 'p1', 'player restored to original board position');
  ok(!undone.pickedByIdx[1], 'pickedByIdx cleared');
  eq(undone.alex.stream.length, 1, 'pick-linked Alex event removed');
  eq(undone.alex.stream[0].id, 'ev2', 'unrelated Alex event retained');
  eq(undone.manualCorrections[0].type, 'undo', 'undo correction logged');
});

test('auto-resume persistence preserves original board baseline', () => {
  ctx.localStorage.clear();
  const initial = ctx.DraftCC.state.initialDraftState({ mode: 'manual', leagueId: 'L2', userRosterId: 1 });
  const pool = [
    { pid: 'p1', name: 'One', pos: 'QB', dhq: 100, source: 'DHQ_ENGINE' },
    { pid: 'p2', name: 'Two', pos: 'RB', dhq: 90, source: 'DHQ_ENGINE' },
  ];
  const started = ctx.DraftCC.state.reducer(initial, {
    type: 'START_DRAFT',
    pool: pool.slice(1),
    originalPool: pool,
    pickOrder,
    personas: {},
  });
  ctx.DraftCC.state.saveToLocal(started);
  const loaded = ctx.DraftCC.state.loadFromLocal('L2');
  eq(loaded.originalPool.length, 2, 'original pool preserved');
  eq(loaded.originalPool[0].pid, 'p1', 'original first board slot preserved');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

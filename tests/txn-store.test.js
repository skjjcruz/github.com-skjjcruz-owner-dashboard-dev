// Run with:  node --test tests/txn-store.test.js
// Storage-full fix (2026-11-04): the per-league transaction cache keeps
// routine moves for the last 8 weeks (trades and waiver claims for the whole
// season), and a save that hits a full storage drops the league's old copy
// instead of leaving it to block other saves.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load(opts) {
    const o = opts || {};
    const mem = Object.assign({}, o.mem);
    const win = { S: { nflState: { season: '2026', season_type: 'regular', week: o.week || 12 } }, App: {} };
    win.window = win;
    win.App.DhqStorage = {
        get: (k, f) => (k in mem ? JSON.parse(mem[k]) : f),
        set: (k, v) => { if (o.full) return false; mem[k] = JSON.stringify(v); return true; },
        remove: (k) => { delete mem[k]; },
    };
    // Weeks 1-12 of a busy league: a trade, a waiver claim, a failed bid and two free-agent moves each week
    win.fetchTransactions = async (lid, w) => (w < 1 || w > 12) ? [] : [
        { type: 'trade', status: 'complete', leg: w, transaction_id: 't' + w },
        { type: 'waiver', status: 'complete', leg: w, transaction_id: 'w' + w, settings: { waiver_bid: 10 } },
        { type: 'waiver', status: 'failed', leg: w, transaction_id: 'x' + w, settings: { waiver_bid: 5 } },
        { type: 'free_agent', status: 'complete', leg: w, transaction_id: 'f' + w },
        { type: 'commissioner', status: 'complete', leg: w, transaction_id: 'c' + w },
    ];
    const ctx = vm.createContext(Object.assign(win, { localStorage: { removeItem: k => { delete mem[k]; } }, console, setTimeout, Promise, Date, JSON, Math, Number, String, Array, Object }));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/shared/txn-store.js'), 'utf8'), ctx);
    return { T: win.WrTxns, mem };
}

test('routine moves older than 8 weeks are trimmed; trades and waiver claims stay all season', async () => {
    const { T, mem } = load({ week: 12 });
    const txns = await T.fetchLeagueTxns('L1');
    const ids = new Set(txns.map(t => t.transaction_id));
    for (let w = 1; w <= 12; w++) {
        assert.ok(ids.has('t' + w), 'trade week ' + w);
        assert.ok(ids.has('w' + w), 'waiver claim week ' + w);
        assert.equal(ids.has('f' + w), w > 4, 'free-agent move week ' + w);
        assert.equal(ids.has('c' + w), w > 4, 'commissioner move week ' + w);
    }
    const saved = JSON.parse(mem.dhq_txns_L1_2026);
    assert.equal(saved.txns.length, txns.length, 'what is cached is what was returned');
    assert.equal(saved.failedWaivers.length, 12, 'losing bids kept all season (the bid model reads them)');
    assert.deepEqual(T.getCached('L1').map(t => t.transaction_id), txns.map(t => t.transaction_id));
});

test('early in the season nothing is trimmed', async () => {
    const { T } = load({ week: 6 });
    const txns = await T.fetchLeagueTxns('L1');
    assert.equal(txns.filter(t => t.type === 'free_agent').length, 6);
});

test('a full storage drops the league\'s old copy instead of keeping it', async () => {
    const stale = JSON.stringify({ ts: 0, season: '2026', txns: [{ type: 'trade', transaction_id: 'old' }], failedWaivers: [] });
    const { T, mem } = load({ full: true, mem: { dhq_txns_L1_2026: stale, other_key: '"kept"' } });
    const txns = await T.fetchLeagueTxns('L1', { force: true });
    assert.ok(txns.length > 0, 'the page still gets this load\'s transactions');
    assert.equal(mem.dhq_txns_L1_2026, undefined, 'the stale copy no longer holds space');
    assert.equal(mem.other_key, '"kept"', 'nothing else is touched');
});

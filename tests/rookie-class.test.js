// reconai-shared/rookie-class.js: the page's rookie class comes from the
// engine server (dhq-league ?part=rookies) and each rookie's league value
// from the league's intel (Phase A7). Same answers as rookie-data.js gave.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'reconai-shared', 'rookie-class.js');
function load(prospects, fetchOk = true) {
    const ctx = { console: { log() {}, warn() {} }, Promise, JSON, Object, Array, String, Number, Set };
    ctx.window = ctx;
    ctx.fetch = async () => (fetchOk ? { ok: true, json: async () => ({ built_at: 'x', prospects }) } : { ok: false, status: 503 });
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx);
    return ctx;
}
const P = (name, rank, pos, dv) => ({ name, rank, consensusRank: rank, pos, mappedPos: pos, rawPos: pos, dynastyValue: dv });

test('loads the class, finds by name and alias, sorts by rank', { skip: !fs.existsSync(SRC) && 'run sync:shared' }, async () => {
    const W = load([P('Cam Ball', 2, 'RB', 900), P('Arvell Reese', 1, 'LB', 1000), P('David Bailey', 3, 'DL', 800)]);
    await W.RookieData.loadRookieProspects();
    assert.equal(W.RookieData.getProspects().map(p => p.name).join(','), 'Arvell Reese,Cam Ball,David Bailey');
    assert.equal(W.findProspect('arvell reese').rank, 1);
    assert.equal(W.findProspect('Cameron Ball').name, 'Cam Ball', 'a nickname whose first name starts the other');
    assert.equal(W.findProspect('Dominic Bailey'), null, 'a full first name never borrows another player');
    assert.equal(W.getIDPProspects().length, 2);
});

test("each rookie's value comes from the open league's intel", { skip: !fs.existsSync(SRC) && 'run sync:shared' }, async () => {
    const W = load([P('Arvell Reese', 1, 'LB', 1000), P('Cam Ball', 2, 'RB', 900)]);
    await W.RookieData.loadRookieProspects();
    assert.equal(W.findProspect('Arvell Reese').dynastyValue, 1000, 'no league open: the class value');
    W.App.LI = { playerScores: {}, rookieValues: { 'arvell reese': 1391 } };
    assert.equal(W.findProspect('Arvell Reese').dynastyValue, 1391);
    assert.equal(W.findProspect('Cam Ball').dynastyValue, 900, 'not in the league values: the class value');
    W.App.LI = { playerScores: {}, rookieValues: { 'arvell reese': 2000 } };
    assert.equal(W.getProspects()[0].dynastyValue, 2000, 'another league: its own value');
});

test('a failed load leaves an empty class, as before', { skip: !fs.existsSync(SRC) && 'run sync:shared' }, async () => {
    const W = load([], false);
    await W.RookieData.loadRookieProspects();
    assert.equal(W.RookieData._cache.loaded, true);
    assert.deepEqual(W.RookieData.getProspects(), []);
});

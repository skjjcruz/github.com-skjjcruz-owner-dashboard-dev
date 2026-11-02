// Run with:  node --test tests/sos-init-guard.test.js
// SOS.initialize called before the player list has loaded (a tab or card
// opening early) returns quietly: no 18-week fetch, no "No defense data
// accumulated" error. Mission Control error panel, 2026-11-02.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function load() {
    const fetches = [], logs = [];
    const store = {};
    const win = {
        App: {},
        wrLog: (ctx, e) => logs.push([ctx, String(e)]),
        fetch: (url) => { fetches.push(url); return Promise.resolve({ ok: true, json: () => Promise.resolve({}) }); },
    };
    win.window = win;
    const ctx = vm.createContext(Object.assign(win, {
        sessionStorage: { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } },
        localStorage: { getItem: () => null, setItem: () => {} },
        console, setTimeout, clearTimeout, Promise, Date, JSON, Math, Object, Array, String, Number,
    }));
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js/utils/sos-engine.js'), 'utf8'), ctx);
    return { SOS: win.App.SOS, fetches, logs };
}

test('no players yet: returns quietly, fetches nothing, logs nothing', async () => {
    const { SOS, fetches, logs } = load();
    for (const players of [{}, undefined, null, { a: {}, b: {} }]) await SOS.initialize('2026', players);
    assert.equal(fetches.length, 0);
    assert.deepEqual(logs, []);
    assert.ok(!SOS.ready);
});

test('with the player list loaded it fetches the season as before', async () => {
    const { SOS, fetches } = load();
    const players = {};
    for (let i = 0; i < 150; i++) players['p' + i] = { position: 'WR', team: 'BUF' };
    await SOS.initialize('2026', players);
    assert.ok(fetches.length >= 18, 'fetched ' + fetches.length);
});

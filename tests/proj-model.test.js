// The projection model's fingerprint must come out the same on the page and
// on the engine server (Phase A3, 2026-10-27): the app uses the server's DHQ
// projections only when they match, so a drift here would quietly send every
// phone back to computing its own.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const server = require('../server/engine/dhq-proj.js');

test('build-deploy.cjs and the engine server hash the same projection files the same way', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts/build-deploy.cjs'), 'utf8');
    const m = src.match(/const PROJ_MODEL_FILES = \[([\s\S]*?)\];/);
    assert.ok(m, 'PROJ_MODEL_FILES list in build-deploy.cjs');
    const pageFiles = [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]);
    assert.deepEqual(pageFiles, server.MODEL_FILES);
    const h = crypto.createHash('sha256');
    for (const f of pageFiles) h.update(f).update('\0').update(fs.readFileSync(path.join(ROOT, f))).update('\0');
    assert.equal(h.digest('hex').slice(0, 12), server.projModel());
});

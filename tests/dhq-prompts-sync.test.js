// The AI function's copy of the prompt text (supabase/functions/_shared/
// dhq-prompts.js) must match DHQ-Shared's when it's checked out next to this
// repo (scripts/sync-reconai-shared.cjs copies it), and every marker a page
// can send must expand to text (Phase A7).
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COPY = path.join(__dirname, '..', 'supabase', 'functions', '_shared', 'dhq-prompts.js');
const SRC = [process.env.DHQ_SHARED_SOURCE, path.join(__dirname, '..', '..', 'DHQ-Shared')].filter(Boolean).map(d => path.join(d, 'dhq-prompts.js')).find(f => fs.existsSync(f));

test('the AI function\'s prompt copy matches DHQ-Shared', { skip: !SRC && 'DHQ-Shared not checked out' }, () => {
    assert.equal(fs.readFileSync(COPY, 'utf8'), fs.readFileSync(SRC, 'utf8'), 'run: DHQ_SHARED_SOURCE=../DHQ-Shared npm run sync:shared');
});

test('every page marker expands to the prompt text', () => {
    const P = require(COPY);
    assert.ok(P.IDENTITY.length > 1000);
    for (const [type, p] of Object.entries(P.PROMPTS)) {
        assert.equal(P.expand('⟦dhq:system:' + type + '⟧'), p.system, type);
        if (p.instructions) assert.equal(P.expand('⟦dhq:instructions:' + type + '⟧'), p.instructions, type);
    }
    assert.equal(P.expand('[System: ⟦dhq:identity⟧]'), '[System: ' + P.IDENTITY + ']');
    assert.equal(P.expand('⟦dhq:system:no-such-type⟧'), '⟦dhq:system:no-such-type⟧');
});

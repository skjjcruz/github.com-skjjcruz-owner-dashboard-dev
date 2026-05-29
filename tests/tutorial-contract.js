#!/usr/bin/env node
// War Room assistant tutorial contract checks.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const tutorial = read('js/tutorial.js');
const index = read('index.html');
const settings = read('js/settings.js');
const sync = read('scripts/sync-reconai-shared.cjs');
const migration = read('supabase/migrations/20260503010000_tutorial_state.sql');
const baseMigration = read('supabase/migrations/20260317000000_app_users_and_subscriptions.sql');
const profileFn = read('supabase/functions/fw-profile/index.ts');
const security = read('supabase/functions/_shared/security.ts');
const deployWorkflow = read('.github/workflows/deploy-functions.yml');

let passed = 0;
let failed = 0;
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function test(name, fn) {
  try {
    fn();
    passed += 1;
    process.stdout.write('.');
  } catch (err) {
    failed += 1;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function hasEvery(source, fragments, label) {
  fragments.forEach(fragment => ok(source.includes(fragment), `${label}: missing ${fragment}`));
}

console.log('\nWar Room assistant tutorial contract tests');

test('War Room config uses shared tutorial engine and legacy key compatibility', () => {
  hasEvery(tutorial, [
    "productKey: 'warroom'",
    "version: 'gm-brief-v1'",
    "legacyKeys: ['wr_tutorial_done_v1']",
    'window.WR_TUTORIAL_CONFIG',
    'window.replayWRTutorial',
    'AssistantTutorial.start',
  ], 'War Room tutorial config');
});

test('War Room loads the shared tutorial engine and exposes replay in settings', () => {
  hasEvery(index, [
    "'assistant-tutorial.js'",
    'js/tutorial.js?v=20260503tutorial1',
  ], 'War Room index');
  ok(sync.includes("'assistant-tutorial.js'"), 'sync script must copy shared tutorial engine');
  ok(settings.includes('Replay GM Briefing'), 'settings replay control missing');
});

test('app account tutorial state remains server-mediated', () => {
  hasEvery(migration, [
    'add column if not exists tutorial_state jsonb',
    'app_users_tutorial_state_object',
  ], 'tutorial migration');
  ok(baseMigration.includes("add column if not exists tutorial_state jsonb not null default '{}'::jsonb"), 'base app_users migration tutorial_state missing');
  hasEvery(profileFn, [
    'requireActiveAppSession',
    "select('id, email, display_name, tutorial_state, platform_usernames')",
    'update.tutorial_state = tutorialState',
    'update.platform_usernames = platformUsernames',
    'sanitizeTutorialState',
    'sanitizePlatformUsernames',
    'auditEvent',
    'handleOptions',
  ], 'fw-profile');
  ok(!profileFn.includes("'Access-Control-Allow-Origin': '*'"), 'fw-profile must not use wildcard CORS');
  ok(security.includes("'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'"), 'shared CORS methods should support fw-profile');
});

test('Supabase deploy workflow ships tutorial state backend', () => {
  hasEvery(deployWorkflow, [
    '20260503010000_tutorial_state.sql',
    'deno check --node-modules-dir=auto "$fn"',
    'supabase functions deploy fw-profile',
    'if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then',
    'SUPABASE_ACCESS_TOKEN repo secret is required',
  ], 'deploy workflow');
});

console.log('\n');
if (failures.length) console.log(failures.join('\n') + '\n');
console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

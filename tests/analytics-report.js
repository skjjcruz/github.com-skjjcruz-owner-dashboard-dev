#!/usr/bin/env node
// Launch analytics report contract tests.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const RECON_ROOT = path.resolve(ROOT, '..', 'reconai');
const fn = read(ROOT, 'supabase/functions/admin-analytics-report/index.ts');
const admin = read(ROOT, 'admin.html');
const landing = read(ROOT, 'landing.html');
const permissionHardening = read(ROOT, 'supabase/migrations/20260508000000_supabase_permission_hardening.sql');
const rollup = [
  read(RECON_ROOT, 'supabase/migrations/016_analytics_rollups.sql'),
  read(ROOT, 'supabase/migrations/20260503020000_ai_margin_rollups.sql'),
].join('\n');
const bugCapture = read(RECON_ROOT, 'shared/bug-capture.js');
const analyticsClient = read(RECON_ROOT, 'shared/supabase-client.js');

let passed = 0;
let failed = 0;
const failures = [];

function read(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

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

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

console.log('\nWar Room launch analytics tests');

group('admin report');

test('admin analytics endpoint is admin-only and uses server rollup RPC', () => {
  [
    'requireActiveAppSession',
    'hasAdminRole',
    "admin.rpc('admin_analytics_report'",
    'auditEvent',
    'admin_analytics_report',
    'clampDays',
  ].forEach(fragment => ok(fn.includes(fragment), `missing ${fragment}`));
});

test('admin page renders the launch analytics report', () => {
  [
    'admin-analytics-report',
    'analytics-days',
    'analytics-totals',
    'analytics-funnel',
    'analytics-dropoffs',
    'analytics-modules',
    'analytics-ai-margin',
    'analytics-errors',
    'renderAnalytics',
    'formatUsd',
  ].forEach(fragment => ok(admin.includes(fragment), `missing ${fragment}`));
});

group('collection');

test('landing page tracks signup/signin funnel without sending email or password metadata', () => {
  [
    'trackLandingEvent',
    "'landing_viewed'",
    "'signup_started'",
    "'signup_succeeded'",
    "'signin_started'",
    "'signin_succeeded'",
    "'password_reset_requested'",
    'safeLandingMeta',
  ].forEach(fragment => ok(landing.includes(fragment), `missing ${fragment}`));
  ok(/email\|password\|token\|secret/.test(landing), 'landing metadata denylist missing');
  ok(landing.includes("db.from('analytics_events').insert"), 'landing should use insert-only analytics writes');
});

test('shared client supports anonymous funnel flushes and Sentry error correlation', () => {
  [
    'username || null',
    'window.OD.trackClientError',
    "'client_error'",
    'sentryEventId',
    'errorName',
  ].forEach(fragment => ok(analyticsClient.includes(fragment), `missing ${fragment}`));
  ok(bugCapture.includes('window.OD?.trackClientError'), 'Sentry client should forward error correlation');
});

test('database rollup stays service-role only', () => {
  [
    'create or replace function public.admin_analytics_report',
    'revoke all on function public.admin_analytics_report',
    'grant execute on function public.admin_analytics_report',
    "'dropoffs'",
    "'aiMargin'",
    "'errorRatePct'",
    "'ai_call_denied'",
    "'ai_call_failed'",
    "'errors'",
  ].forEach(fragment => ok(rollup.includes(fragment), `missing ${fragment}`));
});

test('anonymous analytics collection has an explicit insert-only grant', () => {
  [
    'revoke all on table public.analytics_events from anon, authenticated',
    'grant insert on table public.analytics_events to anon, authenticated',
  ].forEach(fragment => ok(permissionHardening.includes(fragment), `missing ${fragment}`));
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

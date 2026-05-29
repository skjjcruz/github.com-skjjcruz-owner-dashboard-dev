#!/usr/bin/env node
// Security baseline contract tests for auth/admin Edge Functions.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const migration = read('supabase/migrations/20260502020000_security_baseline.sql');
const permissionHardening = read('supabase/migrations/20260508000000_supabase_permission_hardening.sql');
const shared = read('supabase/functions/_shared/security.ts');
const signin = read('supabase/functions/fw-signin/index.ts');
const signup = read('supabase/functions/fw-signup/index.ts');
const adminList = read('supabase/functions/admin-list-users/index.ts');
const checkout = read('supabase/functions/fw-create-checkout/index.ts');
const aiAnalyze = read('supabase/functions/ai-analyze/index.ts');
const getSession = read('supabase/functions/get-session-token/index.ts');
const setPassword = read('supabase/functions/set-password/index.ts');
const resetRequest = read('supabase/functions/fw-request-password-reset/index.ts');
const resetConfirm = read('supabase/functions/fw-confirm-password-reset/index.ts');
const resetPage = read('reset-password.html');
const onboarding = read('onboarding.html');
const leagueDetail = read('js/league-detail.js');
const deployFunctionsWorkflow = read('.github/workflows/deploy-functions.yml');
const pagesWorkflow = read('.github/workflows/deploy.yml');

let passed = 0;
let failed = 0;
const failures = [];

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
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

function hasEvery(source, fragments, label) {
  for (const fragment of fragments) ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

console.log('\nWar Room security contract tests');

group('schema');

test('security baseline creates server-only security tables', () => {
  [
    'create table if not exists public.security_events',
    'create table if not exists public.auth_rate_limits',
    'create table if not exists public.password_reset_tokens',
    'create table if not exists public.app_user_roles',
    'add column if not exists session_version integer not null default 1',
    'create or replace function public.increment_app_user_session_version',
  ].forEach(fragment => ok(migration.includes(fragment), `missing ${fragment}`));
});

test('security tables deny all browser access via RLS', () => {
  [
    'security_events_deny_all',
    'auth_rate_limits_deny_all',
    'password_reset_tokens_deny_all',
    'app_user_roles_deny_all',
  ].forEach(policy => ok(migration.includes(policy), `missing ${policy}`));
});

test('production permission hardening keeps server-only RPCs off browser roles', () => {
  hasEvery(permissionHardening, [
    'grant insert on table public.analytics_events to anon, authenticated',
    'revoke execute on function public.add_ai_tokens_used(text, integer)',
    'grant execute on function public.add_ai_tokens_used(text, integer) to service_role',
    'alter function public.add_ai_tokens_used(text, integer) set search_path = public',
    'revoke execute on function public.increment_app_user_session_version(uuid)',
    'grant execute on function public.increment_app_user_session_version(uuid) to service_role',
    'alter function public.increment_app_user_session_version(uuid) set search_path = public',
  ], 'permission hardening');
  ok(permissionHardening.includes('from public, anon, authenticated'), 'server-only RPCs must revoke browser role execution');
});

group('shared helper');

test('shared security helper provides CORS, rate limits, audit, and admin role checks', () => {
  [
    'APP_ALLOWED_ORIGINS',
    'export function corsHeaders',
    'export function handleOptions',
    'export function json',
    'export async function auditEvent',
    'export async function checkRateLimit',
    'export async function hasAdminRole',
    'export async function verifyJwtPayload',
    'export async function requireActiveAppSession',
    'export async function requireSleeperSession',
  ].forEach(fragment => ok(shared.includes(fragment), `missing ${fragment}`));
  ok(!shared.includes("'Access-Control-Allow-Origin':  '*'"), 'shared CORS must not default to wildcard');
  ok(shared.includes('https://jcc100218.github.io'), 'GitHub Pages origin should be allowed by default');
  ok(shared.includes('https://warroom.skjjcruz.com'), 'custom War Room origin should be allowed by default');
  ok(shared.includes("['SUPABASE_JWT_SECRET', 'JWT_SECRET']"), 'Sleeper token verifier should allow the configured JWT_SECRET fallback');
});

group('auth functions');

test('signup and signin enforce rate limits and audit outcomes', () => {
  [signup, signin].forEach((source, idx) => {
    const label = idx === 0 ? 'signup' : 'signin';
    hasEvery(source, [
      'checkRateLimit',
      'auditEvent',
      'handleOptions',
      'session_version',
    ], label);
    ok(!source.includes("'Access-Control-Allow-Origin':  '*'"), `${label} must not use wildcard CORS`);
  });
});

test('legacy session and set-password endpoints enforce rate limits and audit outcomes', () => {
  [getSession, setPassword].forEach((source, idx) => {
    const label = idx === 0 ? 'get-session-token' : 'set-password';
    hasEvery(source, [
      'checkRateLimit',
      'auditEvent',
      'handleOptions',
    ], label);
    ok(!source.includes("'Access-Control-Allow-Origin': '*'"), `${label} must not use wildcard CORS`);
  });
  ok(getSession.includes("Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('JWT_SECRET')"), 'get-session-token must support JWT_SECRET fallback');
  ok(getSession.includes('passwordless_sleeper_disabled'), 'get-session-token must reject passwordless Sleeper username sessions');
  ok(!getSession.includes('https://api.sleeper.app/v1/user'), 'get-session-token must not mint JWTs from a username-only Sleeper lookup');
  ok(setPassword.includes('requireActiveAppSession'), 'set-password must allow app-session gift creation only through an active app session');
  ok(setPassword.includes('requireSleeperSession'), 'set-password must verify signed Sleeper session token');
  ok(setPassword.includes('target_mismatch'), 'set-password must block legacy callers from changing another Sleeper account');
  ok(setPassword.includes('target_already_password_backed'), 'set-password must not overwrite an existing password-backed account');
});

test('checkout endpoint enforces CORS helper, rate limits, and audit outcomes', () => {
  hasEvery(checkout, [
    'handleOptions',
    'requireActiveAppSession',
    'checkRateLimit',
    'auditEvent',
    'checkout_create',
    'validateCheckoutUrl',
    'allowedCheckoutOrigins',
    'invalid_redirect_url',
  ], 'fw-create-checkout');
  ok(!checkout.includes("'Access-Control-Allow-Origin':  '*'"), 'checkout must not use wildcard CORS');
});

test('signup validates product slugs and fails if initial subscription cannot be provisioned', () => {
  hasEvery(signup, [
    'const VALID_PRODUCT_SLUGS',
    'VALID_PRODUCT_SLUGS.has(productSlug)',
    'subscriptionErr',
    'subscription_insert_failed',
    "await admin.from('app_users').delete().eq('id', newUser.id)",
  ], 'fw-signup product provisioning');
});

test('AI endpoint uses shared CORS helper instead of wildcard CORS', () => {
  hasEvery(aiAnalyze, [
    'corsHeaders',
    'handleOptions',
    'const responseHeaders = corsHeaders(req);',
    'requireActiveAppSession',
    'requireSleeperSession',
    'Valid session token required.',
  ], 'ai-analyze CORS');
  ok(!aiAnalyze.includes("'Access-Control-Allow-Origin': '*'"), 'ai-analyze must not use wildcard CORS');
});

test('BYO AI keys are session-only and legacy localStorage keys are cleared', () => {
  hasEvery(onboarding, [
    'sessionStorage.setItem',
    'localStorage.removeItem(name)',
    'only for this browser session',
  ], 'onboarding BYO key handling');
  hasEvery(leagueDetail, [
    'sessionStorage.getItem',
    'localStorage.removeItem(name)',
    'BYO keys are session-only',
  ], 'league BYO key handling');
  ok(!onboarding.includes("localStorage.setItem('dynastyhq_ai_key'"), 'onboarding must not persist BYO key in localStorage');
});

test('admin list uses admin role table instead of static bearer secret', () => {
  hasEvery(adminList, [
    'hasAdminRole',
    'requireActiveAppSession',
    'auditEvent',
  ], 'admin-list-users');
  ok(!adminList.includes('ADMIN_SECRET'), 'admin-list-users should not use static ADMIN_SECRET');
});

group('deploy');

test('GitHub Actions deploy only production functions from main', () => {
  ok(!deployFunctionsWorkflow.includes('claude/*'), 'function deploy workflow must not run from claude/* branches');
  ok(deployFunctionsWorkflow.includes('branches: ["main"]'), 'function deploy workflow should be restricted to main');
});

test('GitHub Pages publishes a sanitized artifact instead of the repository root', () => {
  hasEvery(pagesWorkflow, [
    'mkdir -p pages-artifact',
    'rm -rf pages-artifact/**/.git pages-artifact/**/node_modules pages-artifact/**/supabase pages-artifact/**/tests',
    'path: "pages-artifact"',
  ], 'pages artifact scope');
  ok(!pagesWorkflow.includes('path: "."'), 'Pages upload must not publish the repository root');
});

group('password reset');

test('password reset endpoints store hashed tokens and rotate session version', () => {
  hasEvery(resetRequest, [
    'password_reset_tokens',
    'sha256Hex(resetToken)',
    'RESET_DEBUG_RETURN_TOKEN',
    'sendPasswordResetEmail',
    'RESEND_API_KEY',
    'https://api.resend.com/emails',
    'PASSWORD_RESET_FROM_EMAIL',
    'auditEvent',
    'checkRateLimit',
  ], 'reset request');
  hasEvery(resetConfirm, [
    "req.method === 'GET'",
    'Response.redirect',
    'PASSWORD_RESET_URL',
    'password_reset_tokens',
    'sha256Hex(String(token))',
    'increment_app_user_session_version',
    'password_changed_at',
    'auditEvent',
    'checkRateLimit',
  ], 'reset confirm');
  hasEvery(resetPage, [
    'fw-confirm-password-reset',
    'new URLSearchParams(window.location.search).get',
    'autocomplete="new-password"',
    'Return to Sign In',
  ], 'reset password page');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

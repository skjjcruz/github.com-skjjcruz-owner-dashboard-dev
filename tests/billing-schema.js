#!/usr/bin/env node
// Billing schema contract tests for Stripe checkout and webhook functions.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260317000000_app_users_and_subscriptions.sql'),
  'utf8'
);
const repairMigration = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260502000000_billing_schema_repair.sql'),
  'utf8'
);
const rlsMigration = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260502010000_billing_rls_lockdown.sql'),
  'utf8'
);
const checkoutSource = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'fw-create-checkout', 'index.ts'),
  'utf8'
);
const webhookSource = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'fw-stripe-webhook', 'index.ts'),
  'utf8'
);
const signupSource = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'fw-signup', 'index.ts'),
  'utf8'
);
const landingSource = fs.readFileSync(path.join(ROOT, 'landing.html'), 'utf8');
const dhqMigration = fs.readFileSync(
  path.join(ROOT, 'supabase', 'migrations', '20260710000000_dhq_pro_billing.sql'),
  'utf8'
);
const rcWebhookSource = fs.readFileSync(
  path.join(ROOT, 'supabase', 'functions', 'fw-revenuecat-webhook', 'index.ts'),
  'utf8'
);
const onboardingSource = fs.readFileSync(path.join(ROOT, 'onboarding.html'), 'utf8');
const configToml = fs.readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
const deployWorkflow = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'deploy-functions.yml'),
  'utf8'
);

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

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function hasEvery(source, needles, label) {
  for (const needle of needles) {
    ok(source.includes(needle), `${label}: missing ${needle}`);
  }
}

console.log('\nWar Room billing schema contract tests');

group('app_users');

test('app_users exposes Stripe customer columns used by checkout', () => {
  hasEvery(migration, [
    'stripe_customer_id text',
    'app_users_stripe_customer_id_key unique (stripe_customer_id)',
    'app_users_stripe_customer_id_idx',
  ], 'app_users billing contract');
  hasEvery(repairMigration, [
    'add column if not exists stripe_customer_id text',
    'app_users_stripe_customer_id_key unique (stripe_customer_id)',
  ], 'app_users repair contract');
  hasEvery(checkoutSource, [
    ".select('stripe_customer_id')",
    '.update({ stripe_customer_id: customerId })',
  ], 'checkout customer contract');
});

group('products');

test('products table seeds every billable product slug used by functions', () => {
  hasEvery(migration, [
    'create table if not exists public.products',
    "('war_room'",
    "('dynast_hq'",
    "('bundle'",
  ], 'product seed contract');
  hasEvery(checkoutSource, [
    'war_room:',
    'dynast_hq:',
    'bundle:',
  ], 'checkout product map');
  hasEvery(webhookSource, [
    "normalizeProductSlug(subscription.metadata.product_slug ?? 'war_room')",
  ], 'webhook product contract');
});

test('signup and checkout normalize legacy product slug aliases before writes', () => {
  hasEvery(signupSource, [
    'function normalizeProductSlug',
    "'war-room': 'war_room'",
    'const productSlug = normalizeProductSlug(rawProductSlug);',
    'product_slug: productSlug',
  ], 'signup product normalization');
  hasEvery(checkoutSource, [
    'function normalizeProductSlug',
    "'war-room': 'war_room'",
    'const productSlug = normalizeProductSlug(rawProductSlug);',
    'product_slug: productSlug',
  ], 'checkout product normalization');
  hasEvery(webhookSource, [
    'function normalizeProductSlug',
    "'war-room': 'war_room'",
    "const productSlug  = normalizeProductSlug(subscription.metadata.product_slug ?? 'war_room');",
    'product_slug:          productSlug',
  ], 'webhook product normalization');
  ok(!landingSource.includes("productSlug: 'war-room'"), 'landing signup should not send legacy war-room slug');
});

test('billing migrations normalize legacy product rows before adding product FK', () => {
  hasEvery(migration, [
    "when product_slug in ('war-room', 'warroom') then 'war_room'",
    "when product_slug in ('recon-ai', 'recon_ai', 'dynasty-hq', 'dynasty_hq', 'scout') then 'dynast_hq'",
    "when product_slug = 'pro' then 'bundle'",
  ], 'base legacy product normalization');
  hasEvery(repairMigration, [
    "when product_slug in ('war-room', 'warroom') then 'war_room'",
    "when product_slug in ('recon-ai', 'recon_ai', 'dynasty-hq', 'dynasty_hq', 'scout') then 'dynast_hq'",
    "when product_slug = 'pro' then 'bundle'",
  ], 'repair legacy product normalization');
});

group('subscriptions');

test('subscriptions exposes Stripe lifecycle fields used by webhook', () => {
  hasEvery(migration, [
    'stripe_subscription_id text',
    'stripe_price_id text',
    'current_period_start timestamptz',
    'current_period_end timestamptz',
    'cancel_at_period_end boolean not null default false',
    'updated_at timestamptz not null default now()',
  ], 'subscription lifecycle columns');
  hasEvery(repairMigration, [
    'add column if not exists stripe_subscription_id text',
    'add column if not exists stripe_price_id text',
    'add column if not exists current_period_start timestamptz',
    'add column if not exists current_period_end timestamptz',
    'add column if not exists cancel_at_period_end boolean not null default false',
  ], 'subscription repair columns');
  hasEvery(webhookSource, [
    'stripe_subscription_id: subscription.id',
    'stripe_price_id:',
    'current_period_start:',
    'current_period_end:',
    'cancel_at_period_end:',
  ], 'webhook lifecycle writes');
});

test('subscriptions supports webhook upsert on user_id and product_slug', () => {
  hasEvery(migration, [
    'subscriptions_user_id_product_slug_key unique (user_id, product_slug)',
  ], 'upsert schema contract');
  ok(webhookSource.includes("onConflict: 'user_id,product_slug'"), 'webhook must upsert on user_id,product_slug');
});

test('subscriptions constrains tier and status values used by functions', () => {
  hasEvery(migration, [
    "check (tier in ('free', 'pro'))",
    "check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'))",
  ], 'subscription check constraints');
  ['active', 'past_due', 'canceled'].forEach(status => {
    ok(webhookSource.includes(status), `webhook status missing from allowed values: ${status}`);
  });
});

test('webhook does not grant paid access for unknown Stripe statuses', () => {
  hasEvery(webhookSource, [
    "case 'incomplete':",
    "console.warn('[stripe-webhook] Unknown subscription status:', stripeStatus);",
    "return 'incomplete';",
    "(status === 'active' || status === 'trialing') ? 'pro' : 'free'",
  ], 'webhook status safety');
  ok(!webhookSource.includes("default:\n      return 'active'"), 'unknown Stripe status must not default to active');
});

group('dynasty hq pro (live product line)');

test('dhq product is seeded with billing metadata columns and constraints', () => {
  hasEvery(dhqMigration, [
    "('dhq', 'Dynasty HQ Pro'",
    'add column if not exists billing_period text',
    'add column if not exists store text',
    'add column if not exists rc_app_user_id text',
    'add column if not exists rc_product_id text',
    "check (billing_period is null or billing_period in ('monthly', 'annual'))",
    "check (store is null or store in ('stripe', 'app_store', 'play_store', 'promotional'))",
    'subscriptions_rc_app_user_id_idx',
  ], 'dhq billing migration');
  hasEvery(deployWorkflow, [
    "'20260710000000': 'supabase/migrations/20260710000000_dhq_pro_billing.sql'",
  ], 'dhq migration deploy allowlist');
  const occurrences = deployWorkflow.split('20260710000000').length - 1;
  ok(occurrences >= 2, '20260710000000 should be in both the apply allowlist and the verification list');
});

test('checkout sells dhq monthly/annual with the App Store trial parity', () => {
  hasEvery(checkoutSource, [
    'STRIPE_PRICE_DHQ_MONTHLY',
    'STRIPE_PRICE_DHQ_ANNUAL',
    'dhq_${billingPeriod}',
    'trial_period_days: DHQ_TRIAL_DAYS',
    'billing_period: billingPeriod',
    'https://dhqfootball.com',
    'https://skjjcruz.github.io',
  ], 'dhq checkout contract');
  ok(checkoutSource.includes("new Set([...defaults.split(','), ...configured])"),
    'APP_ALLOWED_ORIGINS must widen the checkout redirect allowlist, never replace it');
  ok(signupSource.includes("'dhq'"), 'signup should accept the dhq product slug');
});

test('stripe webhook records billing period, store, and truthful trial status', () => {
  hasEvery(webhookSource, [
    'function billingPeriodFor',
    "if (interval === 'year') return 'annual'",
    "if (interval === 'month') return 'monthly'",
    "store:                 'stripe'",
    'billing_period:        billingPeriodFor(subscription)',
    'status:                mapStripeStatus(subscription.status)',
  ], 'stripe webhook billing contract');
});

test('revenuecat webhook mirrors App Store entitlements into subscriptions', () => {
  hasEvery(rcWebhookSource, [
    'REVENUECAT_WEBHOOK_AUTH',
    'timingSafeEqual',
    'if (!WEBHOOK_AUTH) return false',
    "case 'INITIAL_PURCHASE':",
    "case 'RENEWAL':",
    "case 'UNCANCELLATION':",
    "case 'PRODUCT_CHANGE':",
    "case 'CANCELLATION':",
    "case 'EXPIRATION':",
    "case 'BILLING_ISSUE':",
    "tier: 'pro'",
    "tier: 'free', status: 'canceled'",
    "onConflict: 'user_id,product_slug'",
    "const PRODUCT_SLUG = 'dhq'",
    'Purchases.logIn',
  ], 'revenuecat webhook contract');
  ok(rcWebhookSource.includes("'trialing' : 'active'"), 'RC trials must land as trialing, not active');
  ok(configToml.includes('[functions.fw-revenuecat-webhook]'), 'rc webhook must pin verify_jwt in config.toml');
  ok(deployWorkflow.includes('supabase functions deploy fw-revenuecat-webhook'), 'rc webhook must be in the deploy list');
});

test('new accounts route through the onboarding plan funnel', () => {
  const oauthSync = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'fw-oauth-sync', 'index.ts'),
    'utf8'
  );
  ok(oauthSync.includes('isNew,'), 'fw-oauth-sync must expose isNew so clients can route first sign-ins');
  hasEvery(landingSource, [
    'handedIsNew',
    'const freshStart = signup || data.isNew === true;',
    "freshStart ? 'onboarding.html'",
    "appSession.isNew === true) ? 'onboarding.html'",
    "handedIsNew) { window.location.replace('onboarding.html')",
  ], 'landing new-user routing');
  const signinSource = fs.readFileSync(
    path.join(ROOT, 'supabase', 'functions', 'fw-signin', 'index.ts'),
    'utf8'
  );
  ok(signinSource.includes('testResetEmails().has(normalizedEmail)'),
    'fw-signin must reset QA accounts on sign-in');
  ok(signinSource.indexOf('testResetEmails().has(normalizedEmail)') > signinSource.indexOf('await verifyPassword(password'),
    'QA reset must only run after password verification succeeds');
});

test('onboarding requests the live dhq product with a billing period', () => {
  hasEvery(onboardingSource, [
    "productSlug: 'dhq'",
    "billing:     selectedProBilling === 'annual' ? 'annual' : 'monthly'",
  ], 'onboarding checkout payload');
  ok(!onboardingSource.includes("productSlug: 'bundle'"), 'onboarding must not sell the legacy bundle product');
});

group('security');

test('billing tables keep RLS enabled with user-scoped read policies', () => {
  hasEvery(migration, [
    'alter table public.app_users enable row level security;',
    'alter table public.products enable row level security;',
    'alter table public.subscriptions enable row level security;',
    'create policy "app_users_read_own"',
    'create policy "products_read_all"',
    'create policy "subscriptions_read_own"',
  ], 'RLS contract');
  hasEvery(rlsMigration, [
    'create policy "app_users_read_own"',
    'on public.app_users for select',
    'create policy "subscriptions_read_own"',
    'on public.subscriptions for select',
  ], 'billing RLS lockdown');
  ok(!/create policy "app_users_own"[\s\S]*for all/i.test(rlsMigration), 'app_users must not be client-writable');
  ok(!/create policy "subscriptions_own"[\s\S]*for all/i.test(rlsMigration), 'subscriptions must not be client-writable');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

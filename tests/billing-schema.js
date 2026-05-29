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

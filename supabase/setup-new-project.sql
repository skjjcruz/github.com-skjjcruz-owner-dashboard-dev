-- ============================================================================
-- Dynasty HQ / War Room — one-shot database setup for a fresh Supabase project
--
-- Paste this whole file into the Supabase SQL Editor and click "Run".
-- It builds every table/function/policy the app needs AND records each
-- migration so the GitHub deploy check passes.
--
-- Safe to run more than once (every step is idempotent).
-- Generated from supabase/migrations/*.sql
-- ============================================================================

-- Let SQL functions that reference Vault be created even before Vault data exists.
set check_function_bodies = off;

-- Enable Supabase Vault (provides vault.decrypted_secrets used by get_app_secret).
create extension if not exists supabase_vault;

-- Migration bookkeeping table (the "filing cabinet" the deploy check looks for).
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text not null primary key,
  statements text[],
  name       text
);

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260317000000_app_users_and_subscriptions
-- ─────────────────────────────────────────────────────────────────────────
-- Dynasty HQ: core user account, product, and subscription tables.
--
-- This migration is intentionally idempotent and additive. Early local
-- versions created only a thin app_users/subscriptions shape, while billing
-- Edge Functions expect Stripe customer/subscription columns and a
-- user_id+product_slug upsert target.

-- ── app_users ─────────────────────────────────────────────────
create table if not exists public.app_users (
  id            uuid        primary key default gen_random_uuid(),
  email         text        not null unique,
  password_hash text        not null,
  display_name  text,
  created_at    timestamptz not null default now()
);

alter table public.app_users
  add column if not exists avatar_url text,
  add column if not exists email_verified boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists tutorial_state jsonb not null default '{}'::jsonb,
  add column if not exists platform_usernames jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_users_stripe_customer_id_key'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_stripe_customer_id_key unique (stripe_customer_id);
  end if;
end $$;

create index if not exists app_users_email_idx
  on public.app_users (email);

create index if not exists app_users_stripe_customer_id_idx
  on public.app_users (stripe_customer_id);

create index if not exists app_users_platform_usernames_idx
  on public.app_users using gin (platform_usernames);

-- ── products ──────────────────────────────────────────────────
create table if not exists public.products (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  name        text        not null,
  description text        not null default '',
  created_at  timestamptz not null default now()
);

insert into public.products (slug, name, description)
values
  ('war_room', 'Dynasty HQ War Room', 'Dynasty fantasy football command center: trades, free agency, AI analysis, and draft boards.'),
  ('dynast_hq', 'Dynasty HQ Scout', 'Dynasty-specific roster building, prospect tracking, and player intelligence.'),
  ('bundle', 'Dynasty HQ Bundle', 'Combined access to War Room and Scout products.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

-- ── subscriptions ─────────────────────────────────────────────
create table if not exists public.subscriptions (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references public.app_users (id) on delete cascade,
  product_slug text        not null,
  tier         text        not null default 'free',
  status       text        not null default 'active',
  created_at   timestamptz not null default now()
);

alter table public.subscriptions
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.subscriptions
set product_slug = case
  when product_slug in ('war-room', 'warroom') then 'war_room'
  when product_slug in ('recon-ai', 'recon_ai', 'dynasty-hq', 'dynasty_hq', 'scout') then 'dynast_hq'
  when product_slug = 'pro' then 'bundle'
  else product_slug
end
where product_slug in ('war-room', 'warroom', 'recon-ai', 'recon_ai', 'dynasty-hq', 'dynasty_hq', 'scout', 'pro');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_product_slug_fkey'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_product_slug_fkey
      foreign key (product_slug) references public.products(slug);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_user_id_product_slug_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_user_id_product_slug_key unique (user_id, product_slug);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_stripe_subscription_id_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_stripe_subscription_id_key unique (stripe_subscription_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_tier_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_tier_check
      check (tier in ('free', 'pro'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_status_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'));
  end if;
end $$;

create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);

create index if not exists subscriptions_status_idx
  on public.subscriptions (status);

create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);

create index if not exists subscriptions_user_product_idx
  on public.subscriptions (user_id, product_slug);

-- ── updated_at trigger ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

-- ── RLS ───────────────────────────────────────────────────────
alter table public.app_users enable row level security;
alter table public.products enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read own row" on public.app_users;
drop policy if exists "Users can update own row" on public.app_users;
drop policy if exists "app_users_own" on public.app_users;
drop policy if exists "app_users_read_own" on public.app_users;
drop policy if exists "products_read_all" on public.products;
drop policy if exists "Users can read own subscriptions" on public.subscriptions;
drop policy if exists "subscriptions_own" on public.subscriptions;
drop policy if exists "subscriptions_read_own" on public.subscriptions;

create policy "app_users_read_own"
  on public.app_users for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = id::text);

create policy "products_read_all"
  on public.products for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') is not null);

create policy "subscriptions_read_own"
  on public.subscriptions for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = user_id::text);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260317000000', 'app_users_and_subscriptions')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260502000000_billing_schema_repair
-- ─────────────────────────────────────────────────────────────────────────
-- Repair billing schema for projects that already ran the early thin
-- app_users/subscriptions migration before Stripe columns were added.

alter table public.app_users
  add column if not exists avatar_url text,
  add column if not exists email_verified boolean not null default false,
  add column if not exists stripe_customer_id text,
  add column if not exists platform_usernames jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'app_users_stripe_customer_id_key'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_stripe_customer_id_key unique (stripe_customer_id);
  end if;
end $$;

create table if not exists public.products (
  id          uuid        primary key default gen_random_uuid(),
  slug        text        not null unique,
  name        text        not null,
  description text        not null default '',
  created_at  timestamptz not null default now()
);

insert into public.products (slug, name, description)
values
  ('war_room', 'Dynasty HQ War Room', 'Dynasty fantasy football command center: trades, free agency, AI analysis, and draft boards.'),
  ('dynast_hq', 'Dynasty HQ Scout', 'Dynasty-specific roster building, prospect tracking, and player intelligence.'),
  ('bundle', 'Dynasty HQ Bundle', 'Combined access to War Room and Scout products.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

alter table public.subscriptions
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists current_period_start timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists updated_at timestamptz not null default now();

update public.subscriptions
set product_slug = case
  when product_slug in ('war-room', 'warroom') then 'war_room'
  when product_slug in ('recon-ai', 'recon_ai', 'dynasty-hq', 'dynasty_hq', 'scout') then 'dynast_hq'
  when product_slug = 'pro' then 'bundle'
  else product_slug
end
where product_slug in ('war-room', 'warroom', 'recon-ai', 'recon_ai', 'dynasty-hq', 'dynasty_hq', 'scout', 'pro');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_product_slug_fkey'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_product_slug_fkey
      foreign key (product_slug) references public.products(slug);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_user_id_product_slug_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_user_id_product_slug_key unique (user_id, product_slug);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_stripe_subscription_id_key'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_stripe_subscription_id_key unique (stripe_subscription_id);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_tier_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_tier_check
      check (tier in ('free', 'pro'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_status_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('active', 'trialing', 'past_due', 'canceled', 'unpaid', 'incomplete'));
  end if;
end $$;

create index if not exists app_users_stripe_customer_id_idx
  on public.app_users (stripe_customer_id);

create index if not exists app_users_platform_usernames_idx
  on public.app_users using gin (platform_usernames);

create index if not exists subscriptions_stripe_subscription_id_idx
  on public.subscriptions (stripe_subscription_id);

create index if not exists subscriptions_user_product_idx
  on public.subscriptions (user_id, product_slug);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at on public.app_users;
create trigger trg_app_users_updated_at
  before update on public.app_users
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.set_updated_at();

alter table public.app_users enable row level security;
alter table public.products enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read own row" on public.app_users;
drop policy if exists "Users can update own row" on public.app_users;
drop policy if exists "app_users_own" on public.app_users;
drop policy if exists "app_users_read_own" on public.app_users;
drop policy if exists "products_read_all" on public.products;
drop policy if exists "Users can read own subscriptions" on public.subscriptions;
drop policy if exists "subscriptions_own" on public.subscriptions;
drop policy if exists "subscriptions_read_own" on public.subscriptions;

create policy "app_users_read_own"
  on public.app_users for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = id::text);

create policy "products_read_all"
  on public.products for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') is not null);

create policy "subscriptions_read_own"
  on public.subscriptions for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = user_id::text);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260502000000', 'billing_schema_repair')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260502010000_billing_rls_lockdown
-- ─────────────────────────────────────────────────────────────────────────
-- Billing/account RLS lockdown.
--
-- app_users and subscriptions are server-owned for writes. Client sessions
-- may read their own rows, but account creation, password/customer updates,
-- checkout creation, and Stripe webhook updates must go through Edge
-- Functions with the service-role key.

alter table public.app_users enable row level security;
alter table public.products enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "Users can read own row" on public.app_users;
drop policy if exists "Users can update own row" on public.app_users;
drop policy if exists "app_users_own" on public.app_users;
drop policy if exists "app_users_read_own" on public.app_users;

drop policy if exists "products_read_all" on public.products;

drop policy if exists "Users can read own subscriptions" on public.subscriptions;
drop policy if exists "subscriptions_own" on public.subscriptions;
drop policy if exists "subscriptions_read_own" on public.subscriptions;

create policy "app_users_read_own"
  on public.app_users for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = id::text);

create policy "products_read_all"
  on public.products for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') is not null);

create policy "subscriptions_read_own"
  on public.subscriptions for select
  using ((auth.jwt() -> 'app_metadata' ->> 'user_id') = user_id::text);

insert into supabase_migrations.schema_migrations (version, name)
values ('20260502010000', 'billing_rls_lockdown')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260502020000_security_baseline
-- ─────────────────────────────────────────────────────────────────────────
-- Security baseline for paid launch readiness.
--
-- Server-owned tables:
--   security_events, auth_rate_limits, password_reset_tokens, app_user_roles
--
-- Browser clients must not read or write these tables. Edge Functions use the
-- service-role key for audit, rate limiting, reset-token lifecycle, and admin
-- authorization.

alter table public.app_users
  add column if not exists session_version integer not null default 1,
  add column if not exists last_sign_in_at timestamptz,
  add column if not exists password_changed_at timestamptz;

create table if not exists public.security_events (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,
  outcome        text not null default 'success',
  actor_user_id  uuid,
  actor_email    text,
  actor_username text,
  ip_address     text,
  user_agent     text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

create index if not exists security_events_type_ts_idx
  on public.security_events(event_type, created_at desc);

create index if not exists security_events_actor_ts_idx
  on public.security_events(actor_user_id, created_at desc);

create index if not exists security_events_email_ts_idx
  on public.security_events(actor_email, created_at desc);

create table if not exists public.auth_rate_limits (
  scope         text not null,
  identifier    text not null,
  window_start  timestamptz not null default now(),
  attempt_count integer not null default 0,
  locked_until  timestamptz,
  updated_at    timestamptz not null default now(),
  primary key (scope, identifier)
);

create index if not exists auth_rate_limits_locked_until_idx
  on public.auth_rate_limits(locked_until);

create table if not exists public.password_reset_tokens (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.app_users(id) on delete cascade,
  token_hash     text not null unique,
  requested_ip   text,
  requested_user_agent text,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists password_reset_tokens_user_created_idx
  on public.password_reset_tokens(user_id, created_at desc);

create index if not exists password_reset_tokens_expires_idx
  on public.password_reset_tokens(expires_at);

create table if not exists public.app_user_roles (
  user_id    uuid not null references public.app_users(id) on delete cascade,
  role       text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create index if not exists app_user_roles_role_idx
  on public.app_user_roles(role);

alter table public.security_events enable row level security;
alter table public.auth_rate_limits enable row level security;
alter table public.password_reset_tokens enable row level security;
alter table public.app_user_roles enable row level security;

drop policy if exists security_events_deny_all on public.security_events;
drop policy if exists auth_rate_limits_deny_all on public.auth_rate_limits;
drop policy if exists password_reset_tokens_deny_all on public.password_reset_tokens;
drop policy if exists app_user_roles_deny_all on public.app_user_roles;

create policy security_events_deny_all
  on public.security_events for all to public
  using (false)
  with check (false);

create policy auth_rate_limits_deny_all
  on public.auth_rate_limits for all to public
  using (false)
  with check (false);

create policy password_reset_tokens_deny_all
  on public.password_reset_tokens for all to public
  using (false)
  with check (false);

create policy app_user_roles_deny_all
  on public.app_user_roles for all to public
  using (false)
  with check (false);

create or replace function public.increment_app_user_session_version(p_user_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  v_version integer;
begin
  update public.app_users
  set session_version = session_version + 1,
      updated_at = now()
  where id = p_user_id
  returning session_version into v_version;

  return coalesce(v_version, 0);
end;
$$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260502020000', 'security_baseline')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260503000000_ai_usage_controls
-- ─────────────────────────────────────────────────────────────────────────
-- Server-side AI usage controls for launch.
-- Client-side limits are only UX hints; these counters are enforced by Edge
-- Functions before provider calls are made.

create table if not exists public.ai_usage_daily (
  id                  uuid primary key default gen_random_uuid(),
  usage_date          date not null default current_date,
  identifier          text not null,
  user_id             uuid references public.app_users(id) on delete cascade,
  username            text,
  tier                text not null default 'free',
  request_count       integer not null default 0,
  tokens_used         integer not null default 0,
  estimated_cost_usd  numeric(12,6) not null default 0,
  reserved_cost_usd   numeric(12,6) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (identifier, usage_date)
);

create table if not exists public.ai_usage_monthly (
  id                  uuid primary key default gen_random_uuid(),
  month_start         date not null default date_trunc('month', current_date)::date,
  identifier          text not null,
  user_id             uuid references public.app_users(id) on delete cascade,
  username            text,
  tier                text not null default 'free',
  request_count       integer not null default 0,
  tokens_used         integer not null default 0,
  estimated_cost_usd  numeric(12,6) not null default 0,
  reserved_cost_usd   numeric(12,6) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (identifier, month_start)
);

alter table public.ai_usage_daily enable row level security;
alter table public.ai_usage_monthly enable row level security;

create index if not exists ai_usage_daily_date_idx
  on public.ai_usage_daily (usage_date);

create index if not exists ai_usage_daily_user_idx
  on public.ai_usage_daily (user_id, usage_date);

create index if not exists ai_usage_monthly_month_idx
  on public.ai_usage_monthly (month_start);

create index if not exists ai_usage_monthly_user_idx
  on public.ai_usage_monthly (user_id, month_start);

create or replace function public.reserve_ai_usage(
  p_identifier text,
  p_user_id uuid,
  p_username text,
  p_tier text,
  p_daily_request_limit integer,
  p_monthly_request_limit integer,
  p_daily_cost_limit numeric,
  p_monthly_cost_limit numeric,
  p_estimated_request_cost_usd numeric,
  p_global_daily_cost_limit numeric default null,
  p_global_monthly_cost_limit numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identifier text := left(nullif(btrim(coalesce(p_identifier, '')), ''), 300);
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_daily public.ai_usage_daily%rowtype;
  v_monthly public.ai_usage_monthly%rowtype;
  v_reserved numeric := greatest(coalesce(p_estimated_request_cost_usd, 0), 0);
  v_global_daily numeric := 0;
  v_global_monthly numeric := 0;
begin
  if v_identifier is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_identifier');
  end if;

  if coalesce(p_daily_request_limit, 0) <= 0 or coalesce(p_monthly_request_limit, 0) <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'plan_disabled');
  end if;

  insert into public.ai_usage_daily (usage_date, identifier, user_id, username, tier)
  values (v_today, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'))
  on conflict (identifier, usage_date) do nothing;

  insert into public.ai_usage_monthly (month_start, identifier, user_id, username, tier)
  values (v_month, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'))
  on conflict (identifier, month_start) do nothing;

  select * into v_daily
  from public.ai_usage_daily
  where identifier = v_identifier and usage_date = v_today
  for update;

  select * into v_monthly
  from public.ai_usage_monthly
  where identifier = v_identifier and month_start = v_month
  for update;

  if v_daily.request_count >= p_daily_request_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_requests',
      'dailyRequests', v_daily.request_count,
      'dailyRequestLimit', p_daily_request_limit,
      'monthlyRequests', v_monthly.request_count,
      'monthlyRequestLimit', p_monthly_request_limit
    );
  end if;

  if v_monthly.request_count >= p_monthly_request_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_requests',
      'dailyRequests', v_daily.request_count,
      'dailyRequestLimit', p_daily_request_limit,
      'monthlyRequests', v_monthly.request_count,
      'monthlyRequestLimit', p_monthly_request_limit
    );
  end if;

  if coalesce(p_daily_cost_limit, 0) > 0
     and (v_daily.estimated_cost_usd + v_daily.reserved_cost_usd + v_reserved) > p_daily_cost_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_cost',
      'dailyCostUsd', v_daily.estimated_cost_usd + v_daily.reserved_cost_usd,
      'dailyCostLimitUsd', p_daily_cost_limit
    );
  end if;

  if coalesce(p_monthly_cost_limit, 0) > 0
     and (v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd + v_reserved) > p_monthly_cost_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_cost',
      'monthlyCostUsd', v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd,
      'monthlyCostLimitUsd', p_monthly_cost_limit
    );
  end if;

  if coalesce(p_global_daily_cost_limit, 0) > 0 then
    select coalesce(sum(estimated_cost_usd + reserved_cost_usd), 0)
      into v_global_daily
      from public.ai_usage_daily
      where usage_date = v_today;
    if v_global_daily + v_reserved > p_global_daily_cost_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'global_daily_cost',
        'globalDailyCostUsd', v_global_daily,
        'globalDailyCostLimitUsd', p_global_daily_cost_limit
      );
    end if;
  end if;

  if coalesce(p_global_monthly_cost_limit, 0) > 0 then
    select coalesce(sum(estimated_cost_usd + reserved_cost_usd), 0)
      into v_global_monthly
      from public.ai_usage_monthly
      where month_start = v_month;
    if v_global_monthly + v_reserved > p_global_monthly_cost_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'global_monthly_cost',
        'globalMonthlyCostUsd', v_global_monthly,
        'globalMonthlyCostLimitUsd', p_global_monthly_cost_limit
      );
    end if;
  end if;

  update public.ai_usage_daily
  set request_count = request_count + 1,
      reserved_cost_usd = reserved_cost_usd + v_reserved,
      user_id = coalesce(p_user_id, user_id),
      username = coalesce(p_username, username),
      tier = coalesce(nullif(p_tier, ''), tier),
      updated_at = now()
  where identifier = v_identifier and usage_date = v_today
  returning * into v_daily;

  update public.ai_usage_monthly
  set request_count = request_count + 1,
      reserved_cost_usd = reserved_cost_usd + v_reserved,
      user_id = coalesce(p_user_id, user_id),
      username = coalesce(p_username, username),
      tier = coalesce(nullif(p_tier, ''), tier),
      updated_at = now()
  where identifier = v_identifier and month_start = v_month
  returning * into v_monthly;

  return jsonb_build_object(
    'allowed', true,
    'dailyRequests', v_daily.request_count,
    'dailyRequestLimit', p_daily_request_limit,
    'monthlyRequests', v_monthly.request_count,
    'monthlyRequestLimit', p_monthly_request_limit,
    'dailyCostUsd', v_daily.estimated_cost_usd + v_daily.reserved_cost_usd,
    'dailyCostLimitUsd', p_daily_cost_limit,
    'monthlyCostUsd', v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd,
    'monthlyCostLimitUsd', p_monthly_cost_limit,
    'reservedCostUsd', v_reserved
  );
end;
$$;

create or replace function public.record_ai_usage_result(
  p_identifier text,
  p_user_id uuid,
  p_username text,
  p_tier text,
  p_tokens integer,
  p_estimated_cost_usd numeric,
  p_reserved_cost_usd numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identifier text := left(nullif(btrim(coalesce(p_identifier, '')), ''), 300);
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_daily public.ai_usage_daily%rowtype;
  v_monthly public.ai_usage_monthly%rowtype;
  v_tokens integer := greatest(coalesce(p_tokens, 0), 0);
  v_actual numeric := greatest(coalesce(p_estimated_cost_usd, 0), 0);
  v_reserved numeric := greatest(coalesce(p_reserved_cost_usd, 0), 0);
begin
  if v_identifier is null then
    return jsonb_build_object('recorded', false, 'reason', 'invalid_identifier');
  end if;

  insert into public.ai_usage_daily (
    usage_date, identifier, user_id, username, tier, tokens_used, estimated_cost_usd
  )
  values (
    v_today, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'), v_tokens, v_actual
  )
  on conflict (identifier, usage_date)
  do update set
    tokens_used = public.ai_usage_daily.tokens_used + v_tokens,
    estimated_cost_usd = public.ai_usage_daily.estimated_cost_usd + v_actual,
    reserved_cost_usd = greatest(public.ai_usage_daily.reserved_cost_usd - v_reserved, 0),
    user_id = coalesce(p_user_id, public.ai_usage_daily.user_id),
    username = coalesce(p_username, public.ai_usage_daily.username),
    tier = coalesce(nullif(p_tier, ''), public.ai_usage_daily.tier),
    updated_at = now()
  returning * into v_daily;

  insert into public.ai_usage_monthly (
    month_start, identifier, user_id, username, tier, tokens_used, estimated_cost_usd
  )
  values (
    v_month, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'), v_tokens, v_actual
  )
  on conflict (identifier, month_start)
  do update set
    tokens_used = public.ai_usage_monthly.tokens_used + v_tokens,
    estimated_cost_usd = public.ai_usage_monthly.estimated_cost_usd + v_actual,
    reserved_cost_usd = greatest(public.ai_usage_monthly.reserved_cost_usd - v_reserved, 0),
    user_id = coalesce(p_user_id, public.ai_usage_monthly.user_id),
    username = coalesce(p_username, public.ai_usage_monthly.username),
    tier = coalesce(nullif(p_tier, ''), public.ai_usage_monthly.tier),
    updated_at = now()
  returning * into v_monthly;

  return jsonb_build_object(
    'recorded', true,
    'dailyRequests', v_daily.request_count,
    'monthlyRequests', v_monthly.request_count,
    'dailyTokens', v_daily.tokens_used,
    'monthlyTokens', v_monthly.tokens_used,
    'dailyCostUsd', v_daily.estimated_cost_usd + v_daily.reserved_cost_usd,
    'monthlyCostUsd', v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd
  );
end;
$$;

revoke all on table public.ai_usage_daily from anon, authenticated;
revoke all on table public.ai_usage_monthly from anon, authenticated;
grant select, insert, update on table public.ai_usage_daily to service_role;
grant select, insert, update on table public.ai_usage_monthly to service_role;

revoke execute on function public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric
) to service_role;

revoke execute on function public.record_ai_usage_result(
  text, uuid, text, text, integer, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.record_ai_usage_result(
  text, uuid, text, text, integer, numeric, numeric
) to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260503000000', 'ai_usage_controls')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260503010000_tutorial_state
-- ─────────────────────────────────────────────────────────────────────────
-- Account-synced assistant tutorial completion state.
--
-- app_users is server-writable through fw-profile. Legacy public.users fallback
-- is browser-writable only under the existing owner-scoped RLS policy.

alter table public.app_users
  add column if not exists tutorial_state jsonb not null default '{}'::jsonb;

alter table if exists public.users
  add column if not exists tutorial_state jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'app_users_tutorial_state_object'
      and conrelid = 'public.app_users'::regclass
  ) then
    alter table public.app_users
      add constraint app_users_tutorial_state_object
      check (jsonb_typeof(tutorial_state) = 'object');
  end if;

  if to_regclass('public.users') is not null and not exists (
    select 1
    from pg_constraint
    where conname = 'users_tutorial_state_object'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_tutorial_state_object
      check (jsonb_typeof(tutorial_state) = 'object');
  end if;
end $$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260503010000', 'tutorial_state')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260503020000_ai_margin_rollups
-- ─────────────────────────────────────────────────────────────────────────
-- Internal AI margin rollups for the launch analytics dashboard.
-- Replaces the shared admin_analytics_report function with AI cost,
-- latency, model mix, fallback, downgrade, and denial metrics.

create or replace function public.admin_analytics_report(
  p_since timestamptz default now() - interval '7 days'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with scoped as (
  select *
  from public.analytics_events
  where event_ts >= p_since
),
ai_completed as (
  select
    event_id,
    session_id,
    username,
    coalesce(metadata->>'callType', metadata->>'originalType', widget, 'unknown') as route,
    coalesce(metadata->>'model', 'unknown') as model,
    coalesce(metadata->>'provider', 'unknown') as provider,
    coalesce(metadata->>'routeTier', 'unknown') as route_tier,
    coalesce(nullif(metadata->>'estimatedCostUsd', '')::numeric, 0) as cost_usd,
    coalesce(duration_ms, nullif(metadata->>'latencyMs', '')::integer, 0) as latency_ms,
    coalesce((metadata->>'providerFallback')::boolean, false) as provider_fallback,
    coalesce((metadata->>'routeDowngraded')::boolean, false) as route_downgraded
  from scoped
  where event_name = 'ai_call_completed'
),
ai_denied as (
  select
    event_id,
    session_id,
    coalesce(metadata->>'reason', 'unknown') as reason
  from scoped
  where event_name = 'ai_call_denied'
),
ai_failed as (
  select
    event_id,
    session_id,
    coalesce(metadata->>'reason', 'unknown') as reason
  from scoped
  where event_name = 'ai_call_failed'
),
funnel_steps(ord, event_name, label) as (
  values
    (1, 'landing_viewed', 'Landing viewed'),
    (2, 'signup_started', 'Signup started'),
    (3, 'signup_succeeded', 'Signup succeeded'),
    (4, 'checkout_started', 'Checkout started'),
    (5, 'module_viewed', 'Product opened'),
    (6, 'alex_prompt_sent', 'AI prompt sent')
),
funnel_counts as (
  select
    fs.ord,
    fs.event_name,
    fs.label,
    count(s.event_id) as events,
    count(distinct s.session_id) as sessions,
    count(distinct s.username) filter (where s.username is not null) as users
  from funnel_steps fs
  left join scoped s on s.event_name = fs.event_name
  group by fs.ord, fs.event_name, fs.label
),
funnel_dropoffs as (
  select
    a.ord,
    a.event_name as from_event,
    b.event_name as to_event,
    a.sessions as from_sessions,
    b.sessions as to_sessions,
    case
      when a.sessions = 0 then null
      else round(((a.sessions - b.sessions)::numeric / a.sessions::numeric) * 100, 1)
    end as dropoff_pct
  from funnel_counts a
  join funnel_counts b on b.ord = a.ord + 1
)
select jsonb_build_object(
  'since', p_since,
  'generatedAt', now(),
  'totals', (
    select jsonb_build_object(
      'events', count(*),
      'sessions', count(distinct session_id),
      'knownUsers', count(distinct username) filter (where username is not null),
      'anonymousSessions', count(distinct session_id) filter (where username is null),
      'clientErrors', count(*) filter (where event_name = 'client_error'),
      'sentryLinkedErrors', count(*) filter (
        where event_name = 'client_error'
          and coalesce(metadata->>'sentryEventId', '') <> ''
      )
    )
    from scoped
  ),
  'aiMargin', jsonb_build_object(
    'calls', (select count(*) from ai_completed),
    'errors', (select count(*) from ai_failed),
    'quotaDenials', (select count(*) from ai_denied),
    'totalCostUsd', coalesce((select round(sum(cost_usd), 4) from ai_completed), 0),
    'avgCostUsd', coalesce((select round(avg(cost_usd), 6) from ai_completed), 0),
    'errorRatePct', coalesce((
      select round(((select count(*) from ai_failed)::numeric / nullif((select count(*) from ai_completed) + (select count(*) from ai_failed), 0)) * 100, 1)
    ), 0),
    'fallbackRatePct', coalesce((
      select round((count(*) filter (where provider_fallback)::numeric / nullif(count(*), 0)) * 100, 1)
      from ai_completed
    ), 0),
    'downgradeRatePct', coalesce((
      select round((count(*) filter (where route_downgraded)::numeric / nullif(count(*), 0)) * 100, 1)
      from ai_completed
    ), 0),
    'p50LatencyMs', coalesce((
      select percentile_cont(0.50) within group (order by latency_ms)::integer
      from ai_completed
      where latency_ms > 0
    ), 0),
    'p95LatencyMs', coalesce((
      select percentile_cont(0.95) within group (order by latency_ms)::integer
      from ai_completed
      where latency_ms > 0
    ), 0),
    'byRoute', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route', route,
        'calls', calls,
        'costUsd', cost_usd,
        'avgLatencyMs', avg_latency_ms
      ) order by cost_usd desc)
      from (
        select
          route,
          count(*) as calls,
          round(sum(cost_usd), 4) as cost_usd,
          round(avg(nullif(latency_ms, 0)))::integer as avg_latency_ms
        from ai_completed
        group by route
        order by sum(cost_usd) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'byModel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'model', model,
        'provider', provider,
        'tier', route_tier,
        'calls', calls,
        'costUsd', cost_usd
      ) order by cost_usd desc)
      from (
        select
          model,
          provider,
          route_tier,
          count(*) as calls,
          round(sum(cost_usd), 4) as cost_usd
        from ai_completed
        group by model, provider, route_tier
        order by sum(cost_usd) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'denials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', reason,
        'events', events,
        'sessions', sessions
      ) order by events desc)
      from (
        select reason, count(*) as events, count(distinct session_id) as sessions
        from ai_denied
        group by reason
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'failures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', reason,
        'events', events,
        'sessions', sessions
      ) order by events desc)
      from (
        select reason, count(*) as events, count(distinct session_id) as sessions
        from ai_failed
        group by reason
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb)
  ),
  'funnel', coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventName', event_name,
      'label', label,
      'events', events,
      'sessions', sessions,
      'users', users
    ) order by ord)
    from funnel_counts
  ), '[]'::jsonb),
  'dropoffs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'from', from_event,
      'to', to_event,
      'fromSessions', from_sessions,
      'toSessions', to_sessions,
      'dropoffPct', dropoff_pct
    ) order by ord)
    from funnel_dropoffs
  ), '[]'::jsonb),
  'topEvents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventName', event_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select event_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by event_name
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topModules', coalesce((
    select jsonb_agg(jsonb_build_object(
      'module', module_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(module, 'unknown') as module_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by coalesce(module, 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topWidgets', coalesce((
    select jsonb_agg(jsonb_build_object(
      'widget', widget_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(widget, 'unknown') as widget_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      where event_name in ('ui_clicked', 'widget_clicked')
      group by coalesce(widget, 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topRoutes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'route', route,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(metadata->>'route', 'unknown') as route, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by coalesce(metadata->>'route', 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'errors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'source', source,
      'errorName', error_name,
      'events', event_count,
      'sessions', sessions,
      'sentryIssues', sentry_issues,
      'lastSeen', last_seen
    ) order by event_count desc)
    from (
      select
        coalesce(metadata->>'source', 'unknown') as source,
        coalesce(metadata->>'errorName', 'Error') as error_name,
        count(*) as event_count,
        count(distinct session_id) as sessions,
        count(distinct (metadata->>'sentryEventId')) filter (
          where coalesce(metadata->>'sentryEventId', '') <> ''
        ) as sentry_issues,
        max(event_ts) as last_seen
      from scoped
      where event_name = 'client_error'
      group by coalesce(metadata->>'source', 'unknown'), coalesce(metadata->>'errorName', 'Error')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb)
);
$$;

revoke all on function public.admin_analytics_report(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_analytics_report(timestamptz) to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260503020000', 'ai_margin_rollups')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260508000000_supabase_permission_hardening
-- ─────────────────────────────────────────────────────────────────────────
-- Close live production permission gaps found during the desktop QA audit.
--
-- The browser can insert sanitized funnel events, while server-owned AI and
-- password-reset accounting functions remain callable only from Edge Functions
-- using the Supabase service role.

do $$
begin
  if to_regclass('public.analytics_events') is not null then
    revoke all on table public.analytics_events from anon, authenticated;
    grant insert on table public.analytics_events to anon, authenticated;
    grant select, insert, update, delete on table public.analytics_events to service_role;
  end if;
end $$;

do $$
begin
  if to_regclass('public.ai_rate_limits') is not null then
    revoke insert, update, delete, truncate, references, trigger
      on table public.ai_rate_limits from anon, authenticated;
    grant select on table public.ai_rate_limits to anon, authenticated;
    grant select, insert, update, delete on table public.ai_rate_limits to service_role;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.add_ai_tokens_used(text, integer)') is not null then
    revoke execute on function public.add_ai_tokens_used(text, integer)
      from public, anon, authenticated;
    grant execute on function public.add_ai_tokens_used(text, integer) to service_role;
    alter function public.add_ai_tokens_used(text, integer) set search_path = public;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.increment_app_user_session_version(uuid)') is not null then
    revoke execute on function public.increment_app_user_session_version(uuid)
      from public, anon, authenticated;
    grant execute on function public.increment_app_user_session_version(uuid) to service_role;
    alter function public.increment_app_user_session_version(uuid) set search_path = public;
  end if;
end $$;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260508000000', 'supabase_permission_hardening')
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- Migration: 20260517000000_ai_provider_vault_fallback
-- ─────────────────────────────────────────────────────────────────────────
-- Let Edge Functions read encrypted AI provider keys from Supabase Vault when
-- project-level Edge Function secrets are unavailable to the deploy account.

create or replace function public.get_app_secret(secret_name text)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret
  from vault.decrypted_secrets
  where name = secret_name
  order by updated_at desc
  limit 1
$$;

revoke all on function public.get_app_secret(text) from public;
revoke all on function public.get_app_secret(text) from anon;
revoke all on function public.get_app_secret(text) from authenticated;
grant execute on function public.get_app_secret(text) to service_role;

insert into supabase_migrations.schema_migrations (version, name)
values ('20260517000000', 'ai_provider_vault_fallback')
on conflict (version) do nothing;

-- ============================================================================
-- Done. Confirm the recorded migrations:
select version, name from supabase_migrations.schema_migrations order by version;

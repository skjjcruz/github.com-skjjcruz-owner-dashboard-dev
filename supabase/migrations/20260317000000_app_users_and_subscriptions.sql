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

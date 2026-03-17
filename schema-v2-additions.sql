-- ============================================================
-- Fantasy Wars — Schema V2 Additions
-- Run this in Supabase SQL Editor AFTER the original schema.sql
-- Adds: email auth, subscriptions, product access
-- ============================================================

-- ── APP USERS (email-based, parallel to legacy sleeper users) ─
-- This is the new primary user table for Fantasy Wars sign-ups.
-- Legacy Sleeper-username users continue to use the existing
-- `users` table and are unaffected.
create table if not exists public.app_users (
    id                  uuid primary key default gen_random_uuid(),
    email               text unique not null,
    password_hash       text not null,          -- bcrypt, 12 rounds (hashed in Edge Function)
    display_name        text,
    avatar_url          text,
    email_verified      boolean default false,
    stripe_customer_id  text unique,

    -- ── Platform usernames ────────────────────────────────────
    -- Users connect their accounts from any supported fantasy platform.
    -- Stored as a flat JSONB object: { "sleeper": "...", "yahoo": "...", etc. }
    -- Supported platform keys:
    --   sleeper, yahoo, espn, draftkings, mfl, fantrax, cbs, nfl, fleaflicker, underdog
    platform_usernames  jsonb default '{}'::jsonb,

    created_at          timestamptz default now(),
    updated_at          timestamptz default now()
);

-- ── PRODUCTS ───────────────────────────────────────────────────
-- Seed once; reference by slug in subscriptions.
insert into public.products (slug, name, description, created_at)
values
    ('war_room',   'Fantasy War Room', 'Fantasy football command center — trades, FA, AI analysis, draft boards', now()),
    ('dynast_hq',  'Dynast HQ',        'Dynasty-specific tools — long-term roster building, prospect tracking, dynasty rankings', now())
on conflict (slug) do nothing;

create table if not exists public.products (
    id          uuid primary key default gen_random_uuid(),
    slug        text unique not null,           -- 'war_room' | 'dynast_hq'
    name        text not null,
    description text default '',
    created_at  timestamptz default now()
);

-- Re-run insert after table exists (Supabase runs top-to-bottom; use a DO block for safety)
do $$
begin
    insert into public.products (slug, name, description)
    values
        ('war_room',  'Fantasy War Room', 'Fantasy football command center — trades, FA, AI analysis, draft boards'),
        ('dynast_hq', 'Dynast HQ',        'Dynasty-specific tools — long-term roster building, prospect tracking, dynasty rankings')
    on conflict (slug) do nothing;
end$$;

-- ── SUBSCRIPTIONS ─────────────────────────────────────────────
create table if not exists public.subscriptions (
    id                      uuid primary key default gen_random_uuid(),
    user_id                 uuid not null references public.app_users(id) on delete cascade,
    product_slug            text not null references public.products(slug),
    tier                    text not null default 'free',   -- 'free' | 'pro'
    status                  text not null default 'active', -- 'active' | 'canceled' | 'past_due' | 'trialing'
    stripe_subscription_id  text unique,
    stripe_price_id         text,
    current_period_start    timestamptz,
    current_period_end      timestamptz,
    cancel_at_period_end    boolean default false,
    created_at              timestamptz default now(),
    updated_at              timestamptz default now(),
    unique (user_id, product_slug)
);

-- ── RLS FOR NEW TABLES ────────────────────────────────────────
alter table public.app_users    enable row level security;
alter table public.products     enable row level security;
alter table public.subscriptions enable row level security;

-- Drop if re-running
drop policy if exists "app_users_own"         on public.app_users;
drop policy if exists "products_read_all"     on public.products;
drop policy if exists "subscriptions_own"     on public.subscriptions;

-- app_users: each user reads/writes only their own row
-- Auth JWT carries user_id in app_metadata
create policy "app_users_own" on public.app_users
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'user_id')::uuid = id)
    with check ((auth.jwt() -> 'app_metadata' ->> 'user_id')::uuid = id);

-- products: anyone authenticated can read
create policy "products_read_all" on public.products
    for select
    using ((auth.jwt() -> 'app_metadata' ->> 'user_id') is not null);

-- subscriptions: each user sees only their own
create policy "subscriptions_own" on public.subscriptions
    for all
    using  ((auth.jwt() -> 'app_metadata' ->> 'user_id')::uuid = user_id)
    with check ((auth.jwt() -> 'app_metadata' ->> 'user_id')::uuid = user_id);

-- ── INDEXES ───────────────────────────────────────────────────
create index if not exists idx_app_users_email         on public.app_users (email);
create index if not exists idx_app_users_stripe        on public.app_users (stripe_customer_id);
-- GIN index allows efficient lookup by any platform key inside the JSONB
create index if not exists idx_app_users_platforms     on public.app_users using gin (platform_usernames);
create index if not exists idx_subscriptions_user      on public.subscriptions (user_id);
create index if not exists idx_subscriptions_stripe_id on public.subscriptions (stripe_subscription_id);
create index if not exists idx_subscriptions_status    on public.subscriptions (status);

-- ── UPDATED_AT TRIGGER ────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists trg_app_users_updated_at    on public.app_users;
drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;

create trigger trg_app_users_updated_at
    before update on public.app_users
    for each row execute function public.set_updated_at();

create trigger trg_subscriptions_updated_at
    before update on public.subscriptions
    for each row execute function public.set_updated_at();

-- ── DONE ──────────────────────────────────────────────────────
-- After running this file:
--   1. Set Stripe secrets in Supabase:
--        supabase secrets set STRIPE_SECRET_KEY=sk_live_...
--        supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
--   2. Set Stripe Price IDs (from Stripe Dashboard → Products):
--        supabase secrets set STRIPE_PRICE_WAR_ROOM_PRO=price_...   ($9.99/mo)
--        supabase secrets set STRIPE_PRICE_DYNAST_HQ_PRO=price_...  ($9.99/mo, when live)
--        supabase secrets set STRIPE_PRICE_BUNDLE_PRO=price_...
--   3. Deploy new Edge Functions:
--        supabase functions deploy fw-signup
--        supabase functions deploy fw-signin
--        supabase functions deploy fw-create-checkout
--        supabase functions deploy fw-stripe-webhook

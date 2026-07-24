-- ── Gift grants: owner-reserved Pro by email ──────────────────
-- Mission Control lets the owner reserve Pro for an email before (or after)
-- that person has an account. Gifts live on their own product slug
-- ('dhq_gift', store 'promotional') so a later real Stripe/Apple 'dhq'
-- subscription can never overwrite one, and a cancellation can never wipe a
-- lifetime gift. Season gifts expire via subscriptions.expires_at, which
-- _shared/entitlements.ts honors at token-mint time.
-- Safe to re-run: every statement is guarded (workflow applies it via the
-- Management API allowlist).

insert into public.products (slug, name, description)
values
  ('dhq_gift', 'Dynasty HQ Pro (Gift)', 'Owner-granted Pro access: same entitlements as Dynasty HQ Pro, granted from Mission Control.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

-- Nullable expiry honored by the entitlement reader; null means no expiry.
alter table public.subscriptions
  add column if not exists expires_at timestamptz;

create table if not exists public.gift_grants (
  id               uuid        primary key default gen_random_uuid(),
  email            text        not null,
  kind             text        not null,
  status           text        not null default 'pending',
  expires_at       timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid,
  redeemed_at      timestamptz,
  redeemed_user_id uuid
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'gift_grants_kind_check'
      and conrelid = 'public.gift_grants'::regclass
  ) then
    alter table public.gift_grants
      add constraint gift_grants_kind_check
      check (kind in ('season', 'lifetime'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'gift_grants_status_check'
      and conrelid = 'public.gift_grants'::regclass
  ) then
    alter table public.gift_grants
      add constraint gift_grants_status_check
      check (status in ('pending', 'redeemed', 'revoked'));
  end if;
end $$;

-- Server-only table: RLS on with no policies (deny-all to clients), same
-- posture as bug_reports / feature_requests. Edge functions use service role.
alter table public.gift_grants enable row level security;

-- One outstanding reservation per email.
create unique index if not exists gift_grants_pending_email_idx
  on public.gift_grants (lower(email))
  where status = 'pending';

create index if not exists gift_grants_status_idx
  on public.gift_grants (status);

-- Auto-apply at signup: when an app_users row appears with a reserved email,
-- grant the promotional subscription and mark the gift redeemed. Wrapped in
-- an exception guard so a gifting failure can never break account creation.
create or replace function public.apply_gift_grant_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  grant_row public.gift_grants%rowtype;
begin
  select * into grant_row
  from public.gift_grants
  where lower(email) = lower(new.email)
    and status = 'pending'
  order by created_at
  limit 1;

  if grant_row.id is null then
    return new;
  end if;

  insert into public.subscriptions
    (user_id, product_slug, tier, status, store,
     current_period_start, current_period_end, expires_at, updated_at)
  values
    (new.id, 'dhq_gift', 'pro', 'active', 'promotional',
     now(), grant_row.expires_at, grant_row.expires_at, now())
  on conflict (user_id, product_slug) do update
    set tier = 'pro',
        status = 'active',
        store = 'promotional',
        current_period_end = excluded.current_period_end,
        expires_at = excluded.expires_at,
        updated_at = now();

  update public.gift_grants
  set status = 'redeemed',
      redeemed_at = now(),
      redeemed_user_id = new.id
  where id = grant_row.id;

  return new;
exception when others then
  raise warning 'apply_gift_grant_on_signup failed for %: %', new.email, sqlerrm;
  return new;
end;
$$;

drop trigger if exists apply_gift_grant_on_signup on public.app_users;
create trigger apply_gift_grant_on_signup
  after insert on public.app_users
  for each row
  execute function public.apply_gift_grant_on_signup();

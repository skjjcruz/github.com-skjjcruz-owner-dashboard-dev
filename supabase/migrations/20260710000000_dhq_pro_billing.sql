-- ── Dynasty HQ Pro billing wiring ─────────────────────────────
-- The live product line is a single Pro subscription sold two ways:
--   App Store (via RevenueCat): com.dhqfootball.app.dhq.monthly / .annual
--   Stripe (web checkout):      Pro Monthly $9.99 / Pro Annual $99.99
-- Both funnels land on one product slug ('dhq') so entitlement checks stay
-- uniform; billing_period differentiates the 10/day (monthly) vs 15/day
-- (annual) AI allowance that the plan boards advertise.

-- New product row (legacy war_room / dynast_hq / bundle rows are kept for
-- existing subscribers; nothing sells them anymore).
insert into public.products (slug, name, description)
values
  ('dhq', 'Dynasty HQ Pro', 'Full Dynasty HQ access: every league tool, 10-15 AI calls per day, web-search-backed player intel.')
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description;

-- Billing metadata shared by the Stripe and RevenueCat webhooks.
alter table public.subscriptions
  add column if not exists billing_period text,
  add column if not exists store text,
  add column if not exists rc_app_user_id text,
  add column if not exists rc_product_id text,
  add column if not exists rc_last_event_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_billing_period_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_billing_period_check
      check (billing_period is null or billing_period in ('monthly', 'annual'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'subscriptions_store_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_store_check
      check (store is null or store in ('stripe', 'app_store', 'play_store', 'promotional'));
  end if;
end $$;

-- RevenueCat events arrive keyed by the app user id the SDK was logged in
-- with (the Supabase user uuid); the webhook looks rows up by it on renewal
-- events that may not repeat the original product context.
create index if not exists subscriptions_rc_app_user_id_idx
  on public.subscriptions (rc_app_user_id)
  where rc_app_user_id is not null;

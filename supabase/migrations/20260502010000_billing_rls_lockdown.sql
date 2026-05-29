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

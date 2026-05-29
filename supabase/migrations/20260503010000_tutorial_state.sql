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

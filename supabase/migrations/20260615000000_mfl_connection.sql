-- Cross-device sync of a user's connected MFL league + team selection.
-- Stored on the legacy Sleeper `users` row (keyed by sleeper_username),
-- mirroring display_name / tutorial_state so the connection follows the
-- account across devices the way Sleeper leagues do via the username.
-- Shape: { leagueId, year, franchiseId }. No secrets — private-league API
-- keys stay client-side (sessionStorage) and are never synced here.
-- Idempotent / safe to re-run (applied via the Management API allowlist).

alter table if exists public.users
  add column if not exists mfl_connection jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.users') is not null and not exists (
    select 1
    from pg_constraint
    where conname = 'users_mfl_connection_object'
      and conrelid = 'public.users'::regclass
  ) then
    alter table public.users
      add constraint users_mfl_connection_object
      check (jsonb_typeof(mfl_connection) = 'object');
  end if;
end $$;

-- 20260608000000_add_mock_drafts_table
--
-- Merge prep: port the War-Room-only `mock_drafts` table onto the Scout project
-- (sxshiqyxhhifvtfqawbq), which is the surviving primary backend for the
-- Scout + War Room merge. The table was empty in War Room (0 rows), so this is
-- schema parity only — no data migration.
--
-- Adapted to Scout's dual-identity RLS convention (current_app_user_id() for
-- app users, current_dhq_username() for legacy sleeper sessions):
--   * adds user_id -> app_users(id) ON DELETE CASCADE (War Room's copy lacked it)
--   * sleeper_username relaxed to NULLABLE so app-user-owned rows carry user_id only
--   * dual policies (_account_own + _own) plus public-by-slug read for share links

create table if not exists public.mock_drafts (
  id              uuid primary key default gen_random_uuid(),
  sleeper_username text,
  user_id         uuid references public.app_users(id) on delete cascade,
  league_id       text,
  template_name   text,
  mode            text default 'solo',
  draft_state     jsonb not null,
  share_slug      text unique,
  is_public       boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index if not exists mock_drafts_username_idx on public.mock_drafts (sleeper_username);
create index if not exists mock_drafts_league_idx   on public.mock_drafts (league_id);

alter table public.mock_drafts enable row level security;

-- Matches the table-privilege convention of sibling tables (e.g. draft_boards);
-- real access control is enforced by the RLS policies below.
grant all on public.mock_drafts to anon, authenticated, service_role;

create policy mock_drafts_account_own on public.mock_drafts
  for all
  using (user_id is not null and user_id = current_app_user_id())
  with check (user_id = current_app_user_id() and sleeper_username is null);

create policy mock_drafts_own on public.mock_drafts
  for all
  using (sleeper_username = current_dhq_username())
  with check (sleeper_username = current_dhq_username());

create policy mock_drafts_public_read on public.mock_drafts
  for select
  using (is_public = true);

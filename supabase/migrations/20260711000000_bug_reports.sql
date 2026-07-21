-- Bug reports capture.
--
-- Backing store for the report-bug edge function. Two feeds land here:
--   • kind='user'  — a person clicked "Report a bug"
--   • kind='crash' — an uncaught error / unhandled promise rejection
-- The function also mirrors each row to a private Discord staff channel;
-- this table is the durable copy + a queryable backlog.
--
-- Access model matches ai_feedback: RLS on, no anon/authenticated grants,
-- the edge function reaches it with the service role only.

create table if not exists public.bug_reports (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null default 'user' check (kind in ('user', 'crash')),
  identifier     text not null,                 -- 'app:<uuid>' | 'sleeper:<username>' | 'ip:<addr>'
  user_id        uuid references public.app_users(id) on delete set null,
  username       text,
  reporter_label text,                          -- human-friendly label used in the Discord embed
  title          text,
  message        text not null,
  severity       text not null default 'normal' check (severity in ('low', 'normal', 'high', 'blocker')),
  status         text not null default 'open'   check (status in ('open', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate')),
  url            text,
  league_id      text,
  tier           text,
  platform       text,
  app_version    text,
  user_agent     text,
  stack          text,
  screenshot_url text,
  ip_address     text,
  admin_note     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

alter table public.bug_reports enable row level security;

create index if not exists bug_reports_created_idx on public.bug_reports (created_at desc);
create index if not exists bug_reports_status_idx  on public.bug_reports (status, created_at desc);
create index if not exists bug_reports_kind_idx    on public.bug_reports (kind, created_at desc);

-- keep updated_at fresh on status changes
create or replace function public.touch_bug_reports_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_bug_reports_touch on public.bug_reports;
create trigger trg_bug_reports_touch
  before update on public.bug_reports
  for each row execute function public.touch_bug_reports_updated_at();

-- Lock it down: only the service role (edge function / admin tooling) touches it.
revoke all on table public.bug_reports from anon, authenticated;
grant select, insert, update on table public.bug_reports to service_role;

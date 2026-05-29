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

begin;

-- All three operations below are server-only. App principals must never
-- supply their own actor or rate-limit key through PostgREST.
create or replace function public.consume_auth_rate_limit(
  p_scope text, p_identifier text, p_limit integer,
  p_window_seconds integer, p_lockout_seconds integer default 0
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.auth_rate_limits%rowtype;
  stamp timestamptz;
  next_count integer;
  retry integer;
begin
  if p_scope is null or p_identifier is null or p_limit is null or p_window_seconds is null
     or p_lockout_seconds is null or p_limit < 1 or p_window_seconds < 1 or p_lockout_seconds < 0 then
    raise exception 'Invalid rate limit';
  end if;
  insert into public.auth_rate_limits(scope, identifier, attempt_count)
    values(p_scope, p_identifier, 0) on conflict(scope, identifier) do nothing;
  select * into strict r from public.auth_rate_limits
    where scope = p_scope and identifier = p_identifier for update;
  stamp := clock_timestamp();
  if r.locked_until > stamp then
    return jsonb_build_object('allowed', false, 'count', r.attempt_count,
      'retryAfterSeconds', greatest(1, ceil(extract(epoch from r.locked_until - stamp))::integer));
  end if;
  if r.window_start + make_interval(secs => p_window_seconds) <= stamp then
    r.window_start := stamp;
    r.attempt_count := 0;
  end if;
  next_count := least(r.attempt_count + 1, p_limit + 1);
  r.locked_until := case when next_count > p_limit and p_lockout_seconds > 0
    then stamp + make_interval(secs => p_lockout_seconds) else null end;
  update public.auth_rate_limits set attempt_count = next_count, window_start = r.window_start,
    locked_until = r.locked_until, updated_at = stamp
    where scope = p_scope and identifier = p_identifier;
  retry := greatest(1, ceil(extract(epoch from
    coalesce(r.locked_until, r.window_start + make_interval(secs => p_window_seconds)) - stamp))::integer);
  return jsonb_build_object('allowed', next_count <= p_limit, 'count', next_count,
    'retryAfterSeconds', case when next_count > p_limit then retry else 0 end);
end;
$$;

create or replace function public.provision_gift_password(
  p_actor uuid, p_username text, p_password_hash text, p_display_name text
) returns boolean language plpgsql security definer set search_path = public as $$
declare changed integer;
begin
  if not exists(select 1 from public.app_user_roles where user_id = p_actor and role in ('admin', 'owner')) then
    raise exception 'Administrator required' using errcode = '42501';
  end if;
  if p_username is null or btrim(p_username) = '' or p_password_hash is null or p_password_hash = '' then
    raise exception 'Username and password hash required';
  end if;
  insert into public.users(sleeper_username, password_hash, display_name, is_gifted)
    values(p_username, p_password_hash, p_display_name, true)
    on conflict(sleeper_username) do update
      set password_hash = excluded.password_hash, display_name = excluded.display_name, is_gifted = true
      where public.users.password_hash is null or public.users.password_hash = '';
  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

create table if not exists public.yahoo_oauth_states (
  state_hash text primary key,
  owner_key text not null,
  return_url text not null,
  session_version integer,
  browser_hash text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists yahoo_oauth_states_expiry_idx on public.yahoo_oauth_states(expires_at);
alter table public.yahoo_oauth_states enable row level security;
revoke all on public.yahoo_oauth_states from public, anon, authenticated;
grant all on public.yahoo_oauth_states to service_role;

revoke all on function public.consume_auth_rate_limit(text,text,integer,integer,integer),
  public.provision_gift_password(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.consume_auth_rate_limit(text,text,integer,integer,integer),
  public.provision_gift_password(uuid,text,text,text) to service_role;

commit;

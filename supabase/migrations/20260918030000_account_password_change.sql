-- Authenticated app-account rotation. The Edge handler verifies the current
-- password; this service-only function rechecks its exact account snapshot.
begin;
create or replace function public.change_app_password(
  p_user_id uuid,
  p_expected_version integer,
  p_expected_hash text,
  p_password_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_version integer;
  v_now timestamptz;
begin
  if p_user_id is null or p_expected_version is null or p_expected_version < 1
     or p_expected_hash is null
     or p_password_hash is null or p_password_hash !~ '^[0-9a-f]{32}:[0-9a-f]{64}$' then
    raise exception 'Invalid password change arguments' using errcode = '22023';
  end if;
  -- Same account-first lock order as reset links: concurrent changes and resets
  -- serialize and never rotate a password verified against an obsolete snapshot.
  select u.password_hash, u.session_version into v_hash, v_version
  from public.app_users u where u.id = p_user_id for update;
  if not found or v_version <> p_expected_version or v_hash <> p_expected_hash then
    return false;
  end if;
  v_now := clock_timestamp();
  update public.app_users
  set password_hash = p_password_hash, session_version = session_version + 1,
      password_changed_at = v_now, updated_at = v_now
  where id = p_user_id;
  update public.password_reset_tokens set used_at = v_now
  where user_id = p_user_id and used_at is null;
  return true;
end;
$$;
revoke all on function public.change_app_password(uuid, integer, text, text) from public, anon, authenticated;
grant execute on function public.change_app_password(uuid, integer, text, text) to service_role;
commit;

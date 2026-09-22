-- Password rotation, session revocation, and token consumption must commit
-- together. Additive and safe to replay; existing reset links remain usable.
begin;
create or replace function public.confirm_app_password_reset(
  p_token_hash text,
  p_password_hash text
)
returns table(user_id uuid, email text, session_version integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_token_id uuid;
  v_now timestamptz;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_password_hash is null or p_password_hash !~ '^[0-9a-f]{32}:[0-9a-f]{64}$' then
    raise exception 'Invalid password reset arguments' using errcode = '22023';
  end if;

  select t.user_id into v_user_id
  from public.password_reset_tokens t where t.token_hash = p_token_hash;
  if not found then return; end if;

  -- Serialize by account before locking any token, including competing reset
  -- links for the same account. This order avoids cross-token deadlocks.
  perform 1 from public.app_users u where u.id = v_user_id for update;
  if not found then return; end if;

  -- Recheck after waiting for the account lock. Wall time matters if the link
  -- expired during that wait; transaction-start now() would accept it.
  v_now := clock_timestamp();
  select t.id into v_token_id
  from public.password_reset_tokens t
  where t.token_hash = p_token_hash and t.user_id = v_user_id
    and t.used_at is null and t.expires_at > v_now
  for update;
  if not found then return; end if;

  update public.app_users u
  set password_hash = p_password_hash,
      session_version = u.session_version + 1,
      password_changed_at = v_now,
      updated_at = v_now
  where u.id = v_user_id;

  -- A completed reset also invalidates other already-issued links for this
  -- account. No prior link should change the newly chosen password again.
  update public.password_reset_tokens t set used_at = v_now
  where t.user_id = v_user_id and t.used_at is null;

  return query select u.id, u.email, u.session_version
  from public.app_users u where u.id = v_user_id;
end;
$$;

revoke all on function public.confirm_app_password_reset(text, text) from public, anon, authenticated;
grant execute on function public.confirm_app_password_reset(text, text) to service_role;
commit;

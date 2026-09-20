-- Password resets revoke direct database access as well as Edge requests.
-- Existing ownership policies still decide which rows an active caller sees.
begin;

create or replace function public.current_app_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_claims jsonb := auth.jwt();
  v_user_id uuid;
  v_version integer;
begin
  begin
    v_user_id := (v_claims -> 'app_metadata' ->> 'user_id')::uuid;
    v_version := (v_claims -> 'app_metadata' ->> 'session_version')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return null;
  end;
  if v_user_id is null or v_version is null or v_version < 1 then return null; end if;

  -- Definer access avoids recursion through app_users' own RLS policy. No
  -- caller-supplied ID argument or account data is exposed by this helper.
  return (select u.id from public.app_users u
          where u.id = v_user_id and u.session_version = v_version);
end;
$$;

revoke all on function public.current_app_user_id() from public, anon, authenticated;
grant execute on function public.current_app_user_id() to anon, authenticated, service_role;

-- A restrictive policy adds a revocation gate; it never grants access. Cover
-- raw-claim and legacy-subject policies too, not just current_app_user_id().
-- Legacy Sleeper and OAuth sessions without an app-user claim retain their
-- existing policies. The service role retains its existing RLS bypass.
do $$
declare
  v_table record;
begin
  for v_table in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
  loop
    execute format('drop policy if exists active_app_session on public.%I', v_table.relname);
    execute format(
      'create policy active_app_session on public.%I as restrictive for all to anon, authenticated '
      || 'using ((select auth.jwt() -> ''app_metadata'' ->> ''user_id'') is null or (select public.current_app_user_id()) is not null) '
      || 'with check ((select auth.jwt() -> ''app_metadata'' ->> ''user_id'') is null or (select public.current_app_user_id()) is not null)',
      v_table.relname
    );
  end loop;
end;
$$;

commit;

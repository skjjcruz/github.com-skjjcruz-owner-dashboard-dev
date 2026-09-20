-- Exact existing shared-schema identity helper/policy installer from
-- C2-Football/WarRoom 0a704ac legacy migration 020; fixture only, never deployed.
create or replace function public.current_app_user_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(auth.jwt() -> 'app_metadata' ->> 'user_id', '');
  if raw is null then
    return null;
  end if;
  begin
    return raw::uuid;
  exception when others then
    return null;
  end;
end;
$$;

-- ── Policy installer: add the parallel account policy ─────────────
create or replace function public._add_account_owner_policy(p_table text, p_owner_col text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_table);
  execute format('drop policy if exists %I on public.%I', p_table || '_account_own', p_table);
  execute format(
    'create policy %I on public.%I for all to public '
    || 'using (user_id is not null and user_id = public.current_app_user_id()) '
    || 'with check (user_id = public.current_app_user_id() and %I is null)',
    p_table || '_account_own', p_table, p_owner_col
  );
  -- Account tokens use the `authenticated` Postgres role; make sure it has
  -- table privileges (RLS still restricts rows). anon kept for legacy.
  execute format('grant select, insert, update, delete on public.%I to authenticated, anon', p_table);
end;
$$;


-- ── gm_strategy:

-- Security hardening: pin search_path on flagged functions.
--
-- Supabase security advisor (lint 0011_function_search_path_mutable) flagged
-- these functions as having a role-mutable search_path. They are all
-- SECURITY INVOKER and only reference schema-qualified objects (auth.jwt())
-- or pg_catalog built-ins (now/nullif/coalesce/uuid cast), so pinning to an
-- empty search_path is safe and removes the advisory.
--
-- Guarded per-function so this migration is idempotent and applies cleanly to
-- any project that has a subset of these functions.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.current_app_user_id()',
    'public.current_dhq_username()',
    'public.set_updated_at()',
    'public.update_updated_at_column()',
    'public.update_mock_drafts_updated_at()'
  ]
  loop
    if to_regprocedure(fn) is not null then
      execute format('alter function %s set search_path = %L', fn, '');
    end if;
  end loop;
end;
$$;

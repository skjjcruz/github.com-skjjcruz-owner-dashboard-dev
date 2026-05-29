-- Close live production permission gaps found during the desktop QA audit.
--
-- The browser can insert sanitized funnel events, while server-owned AI and
-- password-reset accounting functions remain callable only from Edge Functions
-- using the Supabase service role.

do $$
begin
  if to_regclass('public.analytics_events') is not null then
    revoke all on table public.analytics_events from anon, authenticated;
    grant insert on table public.analytics_events to anon, authenticated;
    grant select, insert, update, delete on table public.analytics_events to service_role;
  end if;
end $$;

do $$
begin
  if to_regclass('public.ai_rate_limits') is not null then
    revoke insert, update, delete, truncate, references, trigger
      on table public.ai_rate_limits from anon, authenticated;
    grant select on table public.ai_rate_limits to anon, authenticated;
    grant select, insert, update, delete on table public.ai_rate_limits to service_role;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.add_ai_tokens_used(text, integer)') is not null then
    revoke execute on function public.add_ai_tokens_used(text, integer)
      from public, anon, authenticated;
    grant execute on function public.add_ai_tokens_used(text, integer) to service_role;
    alter function public.add_ai_tokens_used(text, integer) set search_path = public;
  end if;
end $$;

do $$
begin
  if to_regprocedure('public.increment_app_user_session_version(uuid)') is not null then
    revoke execute on function public.increment_app_user_session_version(uuid)
      from public, anon, authenticated;
    grant execute on function public.increment_app_user_session_version(uuid) to service_role;
    alter function public.increment_app_user_session_version(uuid) set search_path = public;
  end if;
end $$;

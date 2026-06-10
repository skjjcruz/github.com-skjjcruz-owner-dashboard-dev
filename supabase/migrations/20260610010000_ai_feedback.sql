-- AI feedback learning loop.
--
-- Captures per-user reactions to AI recommendations (thumbs up/down,
-- acted-on, dismissed) across surfaces. The rollup function condenses the
-- last 90 days into a compact preference summary that ai-analyze injects
-- into system prompts, so the AI stops repeating advice an owner keeps
-- rejecting and leans into what they act on.

create table if not exists public.ai_feedback (
  id          uuid primary key default gen_random_uuid(),
  identifier  text not null,            -- 'app:<uuid>' | 'sleeper:<username>' (same scheme as ai_usage_*)
  user_id     uuid references public.app_users(id) on delete cascade,
  username    text,
  league_id   text,
  surface     text not null,            -- trade_verdict | team_diagnosis | insight | dashboard_digest | fa_targets
  rec_id      text not null,            -- insight id / cache key / deal key
  action      text not null check (action in ('up', 'down', 'acted', 'dismissed')),
  subject     jsonb,                    -- e.g. {player, pos, age, moveType, title}
  created_at  timestamptz not null default now(),
  unique (identifier, rec_id, action)
);

alter table public.ai_feedback enable row level security;

create index if not exists ai_feedback_identifier_idx
  on public.ai_feedback (identifier, created_at desc);

create or replace function public.get_ai_preference_summary(
  p_identifier text,
  p_league_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identifier text := left(nullif(btrim(coalesce(p_identifier, '')), ''), 300);
  v_since timestamptz := now() - interval '90 days';
  v_up integer := 0;
  v_down integer := 0;
  v_acted integer := 0;
  v_dismissed integer := 0;
  v_total integer := 0;
  v_accept numeric := null;
  v_surfaces jsonb := '{}'::jsonb;
  v_recent_downs jsonb := '[]'::jsonb;
  v_recent_acted jsonb := '[]'::jsonb;
begin
  if v_identifier is null then
    return jsonb_build_object('total', 0);
  end if;

  select
    count(*) filter (where action = 'up'),
    count(*) filter (where action = 'down'),
    count(*) filter (where action = 'acted'),
    count(*) filter (where action = 'dismissed'),
    count(*)
  into v_up, v_down, v_acted, v_dismissed, v_total
  from public.ai_feedback
  where identifier = v_identifier
    and created_at >= v_since
    and (p_league_id is null or league_id = p_league_id);

  if v_total = 0 then
    return jsonb_build_object('total', 0);
  end if;

  if (v_up + v_acted + v_down) > 0 then
    v_accept := round((v_up + v_acted)::numeric / (v_up + v_acted + v_down), 2);
  end if;

  select coalesce(jsonb_object_agg(surface, counts), '{}'::jsonb)
  into v_surfaces
  from (
    select surface, jsonb_build_object(
      'up', count(*) filter (where action = 'up'),
      'down', count(*) filter (where action = 'down'),
      'acted', count(*) filter (where action = 'acted')
    ) as counts
    from public.ai_feedback
    where identifier = v_identifier
      and created_at >= v_since
      and (p_league_id is null or league_id = p_league_id)
    group by surface
  ) s;

  select coalesce(jsonb_agg(subject), '[]'::jsonb)
  into v_recent_downs
  from (
    select subject
    from public.ai_feedback
    where identifier = v_identifier
      and created_at >= v_since
      and action = 'down'
      and subject is not null
      and (p_league_id is null or league_id = p_league_id)
    order by created_at desc
    limit 5
  ) d;

  select coalesce(jsonb_agg(subject), '[]'::jsonb)
  into v_recent_acted
  from (
    select subject
    from public.ai_feedback
    where identifier = v_identifier
      and created_at >= v_since
      and action = 'acted'
      and subject is not null
      and (p_league_id is null or league_id = p_league_id)
    order by created_at desc
    limit 5
  ) a;

  return jsonb_build_object(
    'total', v_total,
    'upCount', v_up,
    'downCount', v_down,
    'actedCount', v_acted,
    'dismissedCount', v_dismissed,
    'acceptRate', v_accept,
    'surfaceCounts', v_surfaces,
    'recentDownSubjects', v_recent_downs,
    'recentActedSubjects', v_recent_acted
  );
end;
$$;

revoke all on table public.ai_feedback from anon, authenticated;
grant select, insert on table public.ai_feedback to service_role;

revoke execute on function public.get_ai_preference_summary(text, text)
  from public, anon, authenticated;
grant execute on function public.get_ai_preference_summary(text, text)
  to service_role;

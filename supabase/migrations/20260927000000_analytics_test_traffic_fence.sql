-- Test-traffic fence (owner ask 2026-09-27: "filter out test traffic").
--
-- Mission Control already reports only production doors (dhqfootball.com and
-- the native app). Inside those doors, two kinds of traffic are not real
-- people and now leave every production number:
--   * robots: automated browsers (QA sweeps, crash checks) — the client stamps
--     metadata.internal = 'automated' when navigator.webdriver is set;
--   * the owners: any session carrying an owner/admin account, an owner's
--     Sleeper handle, or a device the client has marked as an owner device
--     (metadata.internal = 'owner').
-- A session is test traffic when ANY of its events is, so a landing view on an
-- owner device goes with the rest of that visit. Hidden traffic is still
-- counted, under 'testTraffic', so nothing vanishes silently.
--
-- Idempotent (create or replace) — safe to re-run from deploy-functions.yml.

create or replace function public.analytics_test_sessions(p_since timestamptz)
returns table(session_id text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with owners as (
    select u.id as uid, lower(nullif(u.platform_usernames->>'sleeper', '')) as handle
    from public.app_user_roles r
    join public.app_users u on u.id = r.user_id
    where r.role in ('admin', 'owner')
  ),
  handles as (
    select handle from owners where handle is not null
    union
    select 'skjjcruz'
  )
  select distinct e.session_id
  from public.analytics_events e
  where e.event_ts >= p_since
    and e.session_id is not null
    and (
      coalesce(e.metadata->>'internal', '') <> ''
      or e.user_id in (select uid from owners)
      or lower(e.username) in (select handle from handles)
      or lower(e.metadata->>'sleeper') in (select handle from handles)
      or lower(e.metadata->>'sleeperUsername') in (select handle from handles)
    );
$function$;

revoke all on function public.analytics_test_sessions(timestamptz) from public, anon, authenticated;
grant execute on function public.analytics_test_sessions(timestamptz) to service_role;

create or replace function public.admin_analytics_report(p_since timestamp with time zone default (now() - '7 days'::interval))
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with raw as (
  select *
  from public.analytics_events
  where event_ts >= p_since
),
test_sessions as (
  select t.session_id from public.analytics_test_sessions(p_since) t
),
session_class as (
  select
    session_id,
    coalesce(bool_or(
      coalesce(metadata->>'host','') = 'dhqfootball.com'
      or coalesce(metadata->>'surface','') = 'ios_app'
    ), false) as is_prod,
    coalesce(session_id like 'edge\_app:%', false) as is_edge,
    coalesce(session_id in (select ts.session_id from test_sessions ts), false) as is_test
  from raw
  group by session_id
),
-- Production client traffic: sessions that touched the real website or native
-- app, minus robots and the owners (test traffic).
scoped as (
  select r.*
  from raw r
  join session_class sc on sc.session_id is not distinct from r.session_id
  where sc.is_prod and not sc.is_test
),
-- AI service lane: production client traffic plus server-logged AI events.
ai_scope as (
  select r.*
  from raw r
  join session_class sc on sc.session_id is not distinct from r.session_id
  where (sc.is_prod or sc.is_edge) and not sc.is_test
),
-- Robots and the owners, counted apart so nothing vanishes silently.
test_traffic as (
  select r.*
  from raw r
  join session_class sc on sc.session_id is not distinct from r.session_id
  where sc.is_test
),
-- Everything else: sandbox, local dev, previews, lab.
noise as (
  select r.*
  from raw r
  join session_class sc on sc.session_id is not distinct from r.session_id
  where not sc.is_prod and not sc.is_edge and not sc.is_test
),
identity_links as (
  select lower(username) as uname, min(user_id::text) as account_id
  from scoped
  where username is not null and user_id is not null
  group by lower(username)
),
persons as (
  select
    s.*,
    coalesce(s.user_id::text, il.account_id, lower(s.username)) as person_key
  from scoped s
  left join identity_links il
    on s.username is not null and lower(s.username) = il.uname
),
ai_completed as (
  select
    event_id,
    session_id,
    username,
    coalesce(metadata->>'callType', metadata->>'originalType', widget, 'unknown') as route,
    coalesce(metadata->>'model', 'unknown') as model,
    coalesce(metadata->>'provider', 'unknown') as provider,
    coalesce(metadata->>'routeTier', 'unknown') as route_tier,
    coalesce(nullif(metadata->>'estimatedCostUsd', '')::numeric, 0) as cost_usd,
    coalesce(duration_ms, nullif(metadata->>'latencyMs', '')::integer, 0) as latency_ms,
    coalesce((metadata->>'providerFallback')::boolean, false) as provider_fallback,
    coalesce((metadata->>'routeDowngraded')::boolean, false) as route_downgraded
  from ai_scope
  where event_name = 'ai_call_completed'
),
ai_denied as (
  select
    event_id,
    session_id,
    coalesce(metadata->>'reason', 'unknown') as reason
  from ai_scope
  where event_name = 'ai_call_denied'
),
ai_failed as (
  select
    event_id,
    session_id,
    coalesce(metadata->>'reason', 'unknown') as reason
  from ai_scope
  where event_name = 'ai_call_failed'
),
funnel_steps(ord, event_name, label) as (
  values
    (1, 'landing_viewed', 'Landing viewed'),
    (2, 'signup_started', 'Signup started'),
    (3, 'signup_succeeded', 'Signup succeeded'),
    (4, 'checkout_started', 'Checkout started'),
    (5, 'module_viewed', 'Product opened'),
    (6, 'alex_prompt_sent', 'AI prompt sent')
),
funnel_counts as (
  select
    fs.ord,
    fs.event_name,
    fs.label,
    count(s.event_id) as events,
    count(distinct s.session_id) as sessions,
    count(distinct s.person_key) filter (where s.person_key is not null) as users
  from funnel_steps fs
  left join persons s on s.event_name = fs.event_name
  group by fs.ord, fs.event_name, fs.label
),
funnel_dropoffs as (
  select
    a.ord,
    a.event_name as from_event,
    b.event_name as to_event,
    a.sessions as from_sessions,
    b.sessions as to_sessions,
    case
      when a.sessions = 0 then null
      else round(((a.sessions - b.sessions)::numeric / a.sessions::numeric) * 100, 1)
    end as dropoff_pct
  from funnel_counts a
  join funnel_counts b on b.ord = a.ord + 1
)
select jsonb_build_object(
  'since', p_since,
  'generatedAt', now(),
  'scope', 'production',
  'totals', (
    select jsonb_build_object(
      'events', count(*),
      'sessions', count(distinct session_id),
      'knownUsers', count(distinct person_key) filter (where person_key is not null),
      'anonymousSessions', count(distinct session_id) filter (where person_key is null),
      'clientErrors', count(*) filter (where event_name = 'client_error'),
      'sentryLinkedErrors', count(*) filter (
        where event_name = 'client_error'
          and coalesce(metadata->>'sentryEventId', '') <> ''
      )
    )
    from persons
  ),
  'devSandbox', (
    select jsonb_build_object(
      'events', count(*),
      'sessions', count(distinct session_id),
      'clientErrors', count(*) filter (where event_name = 'client_error')
    )
    from noise
  ),
  'testTraffic', (
    select jsonb_build_object(
      'events', count(*),
      'sessions', count(distinct session_id),
      'aiCalls', count(*) filter (where event_name = 'ai_call_completed'),
      'aiCostUsd', coalesce(round(sum(coalesce(nullif(metadata->>'estimatedCostUsd', '')::numeric, 0))
        filter (where event_name = 'ai_call_completed'), 4), 0)
    )
    from test_traffic
  ),
  'aiMargin', jsonb_build_object(
    'calls', (select count(*) from ai_completed),
    'errors', (select count(*) from ai_failed),
    'quotaDenials', (select count(*) from ai_denied),
    'totalCostUsd', coalesce((select round(sum(cost_usd), 4) from ai_completed), 0),
    'avgCostUsd', coalesce((select round(avg(cost_usd), 6) from ai_completed), 0),
    'errorRatePct', coalesce((
      select round(((select count(*) from ai_failed)::numeric / nullif((select count(*) from ai_completed) + (select count(*) from ai_failed), 0)) * 100, 1)
    ), 0),
    'fallbackRatePct', coalesce((
      select round((count(*) filter (where provider_fallback)::numeric / nullif(count(*), 0)) * 100, 1)
      from ai_completed
    ), 0),
    'downgradeRatePct', coalesce((
      select round((count(*) filter (where route_downgraded)::numeric / nullif(count(*), 0)) * 100, 1)
      from ai_completed
    ), 0),
    'p50LatencyMs', coalesce((
      select percentile_cont(0.50) within group (order by latency_ms)::integer
      from ai_completed
      where latency_ms > 0
    ), 0),
    'p95LatencyMs', coalesce((
      select percentile_cont(0.95) within group (order by latency_ms)::integer
      from ai_completed
      where latency_ms > 0
    ), 0),
    'byRoute', coalesce((
      select jsonb_agg(jsonb_build_object(
        'route', route,
        'calls', calls,
        'costUsd', cost_usd,
        'avgLatencyMs', avg_latency_ms
      ) order by cost_usd desc)
      from (
        select
          route,
          count(*) as calls,
          round(sum(cost_usd), 4) as cost_usd,
          round(avg(nullif(latency_ms, 0)))::integer as avg_latency_ms
        from ai_completed
        group by route
        order by sum(cost_usd) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'byModel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'model', model,
        'provider', provider,
        'tier', route_tier,
        'calls', calls,
        'costUsd', cost_usd
      ) order by cost_usd desc)
      from (
        select
          model,
          provider,
          route_tier,
          count(*) as calls,
          round(sum(cost_usd), 4) as cost_usd
        from ai_completed
        group by model, provider, route_tier
        order by sum(cost_usd) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'denials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', reason,
        'events', events,
        'sessions', sessions
      ) order by events desc)
      from (
        select reason, count(*) as events, count(distinct session_id) as sessions
        from ai_denied
        group by reason
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb),
    'failures', coalesce((
      select jsonb_agg(jsonb_build_object(
        'reason', reason,
        'events', events,
        'sessions', sessions
      ) order by events desc)
      from (
        select reason, count(*) as events, count(distinct session_id) as sessions
        from ai_failed
        group by reason
        order by count(*) desc
        limit 10
      ) t
    ), '[]'::jsonb)
  ),
  'funnel', coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventName', event_name,
      'label', label,
      'events', events,
      'sessions', sessions,
      'users', users
    ) order by ord)
    from funnel_counts
  ), '[]'::jsonb),
  'dropoffs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'from', from_event,
      'to', to_event,
      'fromSessions', from_sessions,
      'toSessions', to_sessions,
      'dropoffPct', dropoff_pct
    ) order by ord)
    from funnel_dropoffs
  ), '[]'::jsonb),
  'topEvents', coalesce((
    select jsonb_agg(jsonb_build_object(
      'eventName', event_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select event_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by event_name
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topModules', coalesce((
    select jsonb_agg(jsonb_build_object(
      'module', module_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(module, 'unknown') as module_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by coalesce(module, 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topWidgets', coalesce((
    select jsonb_agg(jsonb_build_object(
      'widget', widget_name,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(widget, 'unknown') as widget_name, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      where event_name in ('ui_clicked', 'widget_clicked')
      group by coalesce(widget, 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'topRoutes', coalesce((
    select jsonb_agg(jsonb_build_object(
      'route', route,
      'events', event_count,
      'sessions', sessions
    ) order by event_count desc)
    from (
      select coalesce(metadata->>'route', 'unknown') as route, count(*) as event_count, count(distinct session_id) as sessions
      from scoped
      group by coalesce(metadata->>'route', 'unknown')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb),
  'errors', coalesce((
    select jsonb_agg(jsonb_build_object(
      'source', source,
      'errorName', error_name,
      'events', event_count,
      'sessions', sessions,
      'sentryIssues', sentry_issues,
      'lastSeen', last_seen
    ) order by event_count desc)
    from (
      select
        coalesce(metadata->>'source', 'unknown') as source,
        coalesce(metadata->>'errorName', 'Error') as error_name,
        count(*) as event_count,
        count(distinct session_id) as sessions,
        count(distinct (metadata->>'sentryEventId')) filter (
          where coalesce(metadata->>'sentryEventId', '') <> ''
        ) as sentry_issues,
        max(event_ts) as last_seen
      from scoped
      where event_name = 'client_error'
      group by coalesce(metadata->>'source', 'unknown'), coalesce(metadata->>'errorName', 'Error')
      order by event_count desc
      limit 20
    ) t
  ), '[]'::jsonb)
);
$function$;

create or replace function public.admin_doors_surfaces(p_since timestamp with time zone)
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with test_sessions as (
    select t.session_id from public.analytics_test_sessions(p_since) t
  ),
  scoped as (
    select
      coalesce(nullif(metadata->>'surface',''), 'unknown') as surface,
      session_id, event_name, metadata,
      -- Same production fence the rollup uses: the live website or the app
      -- shell. Everything else (lab, localhost, rig) is sandbox noise.
      (metadata->>'host' = 'dhqfootball.com' or metadata->>'surface' = 'ios_app') as is_prod,
      (session_id like 'edge\_app:%') as is_server,
      -- Robots and the owners (owner ask 2026-09-27: filter out test traffic).
      coalesce(session_id in (select ts.session_id from test_sessions ts), false) as is_test
    from analytics_events
    where event_ts >= p_since
  )
  select jsonb_build_object(
    'surfaces', coalesce((
      select jsonb_object_agg(surface, jsonb_build_object('events', ev, 'sessions', ss))
      from (
        select surface, count(*) as ev, count(distinct session_id) as ss
        from scoped where is_prod and not is_test group by surface
      ) s
    ), '{}'::jsonb),
    'signups', coalesce((
      select jsonb_object_agg(surface, n)
      from (
        select surface, count(*) as n from scoped
        where is_prod and not is_test and (event_name = 'signup_succeeded'
              or (event_name = 'oauth_succeeded' and metadata->>'isNew' = 'true'))
        group by surface
      ) g
    ), '{}'::jsonb),
    'devSandbox', (
      select jsonb_build_object('events', count(*), 'sessions', count(distinct session_id))
      from scoped where not is_prod and not is_server and not is_test
    ),
    'testTraffic', (
      select jsonb_build_object('events', count(*), 'sessions', count(distinct session_id))
      from scoped where is_test
    ),
    'serverEvents', (select count(*) from scoped where is_server and not is_test)
  );
$function$;

revoke all on function public.admin_analytics_report(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_analytics_report(timestamptz) to service_role;
revoke all on function public.admin_doors_surfaces(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_doors_surfaces(timestamptz) to service_role;

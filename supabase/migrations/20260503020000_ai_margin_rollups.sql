-- Internal AI margin rollups for the launch analytics dashboard.
-- Replaces the shared admin_analytics_report function with AI cost,
-- latency, model mix, fallback, downgrade, and denial metrics.

create or replace function public.admin_analytics_report(
  p_since timestamptz default now() - interval '7 days'
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
with scoped as (
  select *
  from public.analytics_events
  where event_ts >= p_since
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
  from scoped
  where event_name = 'ai_call_completed'
),
ai_denied as (
  select
    event_id,
    session_id,
    coalesce(metadata->>'reason', 'unknown') as reason
  from scoped
  where event_name = 'ai_call_denied'
),
ai_failed as (
  select
    event_id,
    session_id,
    coalesce(metadata->>'reason', 'unknown') as reason
  from scoped
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
    count(distinct s.username) filter (where s.username is not null) as users
  from funnel_steps fs
  left join scoped s on s.event_name = fs.event_name
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
  'totals', (
    select jsonb_build_object(
      'events', count(*),
      'sessions', count(distinct session_id),
      'knownUsers', count(distinct username) filter (where username is not null),
      'anonymousSessions', count(distinct session_id) filter (where username is null),
      'clientErrors', count(*) filter (where event_name = 'client_error'),
      'sentryLinkedErrors', count(*) filter (
        where event_name = 'client_error'
          and coalesce(metadata->>'sentryEventId', '') <> ''
      )
    )
    from scoped
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
$$;

revoke all on function public.admin_analytics_report(timestamptz) from public, anon, authenticated;
grant execute on function public.admin_analytics_report(timestamptz) to service_role;

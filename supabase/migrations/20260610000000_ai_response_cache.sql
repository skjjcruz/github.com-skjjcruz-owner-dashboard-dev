-- Server-side AI response cache + ambient (uncounted) usage reservation.
--
-- Ambient insight surfaces (dashboard digest, GM insights, team diagnosis)
-- run on cheap models and are cached by context hash so repeat views cost
-- nothing. Cached hits bypass usage reservation entirely; fresh ambient
-- calls reserve COST budgets but do not consume the plan's daily/monthly
-- request allowance (p_count_request = false).

create table if not exists public.ai_response_cache (
  cache_key   text primary key,
  type        text not null,
  identifier  text,
  league_id   text,
  model       text,
  analysis    text not null,
  usage       jsonb,
  hit_count   integer not null default 0,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

alter table public.ai_response_cache enable row level security;

create index if not exists ai_response_cache_expires_idx
  on public.ai_response_cache (expires_at);

create index if not exists ai_response_cache_identifier_idx
  on public.ai_response_cache (identifier, type);

-- reserve_ai_usage gains p_count_request: when false, cost caps are still
-- enforced and reserved, but request-count limits are neither checked nor
-- incremented. The old 11-arg function is dropped (not overloaded) because
-- PostgREST named-argument resolution would be ambiguous against the new
-- default parameter; existing callers resolve to this function via the
-- default value.
drop function if exists public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric
);

create or replace function public.reserve_ai_usage(
  p_identifier text,
  p_user_id uuid,
  p_username text,
  p_tier text,
  p_daily_request_limit integer,
  p_monthly_request_limit integer,
  p_daily_cost_limit numeric,
  p_monthly_cost_limit numeric,
  p_estimated_request_cost_usd numeric,
  p_global_daily_cost_limit numeric default null,
  p_global_monthly_cost_limit numeric default null,
  p_count_request boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_identifier text := left(nullif(btrim(coalesce(p_identifier, '')), ''), 300);
  v_today date := current_date;
  v_month date := date_trunc('month', current_date)::date;
  v_daily public.ai_usage_daily%rowtype;
  v_monthly public.ai_usage_monthly%rowtype;
  v_reserved numeric := greatest(coalesce(p_estimated_request_cost_usd, 0), 0);
  v_count boolean := coalesce(p_count_request, true);
  v_global_daily numeric := 0;
  v_global_monthly numeric := 0;
begin
  if v_identifier is null then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_identifier');
  end if;

  if coalesce(p_daily_request_limit, 0) <= 0 or coalesce(p_monthly_request_limit, 0) <= 0 then
    return jsonb_build_object('allowed', false, 'reason', 'plan_disabled');
  end if;

  insert into public.ai_usage_daily (usage_date, identifier, user_id, username, tier)
  values (v_today, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'))
  on conflict (identifier, usage_date) do nothing;

  insert into public.ai_usage_monthly (month_start, identifier, user_id, username, tier)
  values (v_month, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'))
  on conflict (identifier, month_start) do nothing;

  select * into v_daily
  from public.ai_usage_daily
  where identifier = v_identifier and usage_date = v_today
  for update;

  select * into v_monthly
  from public.ai_usage_monthly
  where identifier = v_identifier and month_start = v_month
  for update;

  if v_count and v_daily.request_count >= p_daily_request_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_requests',
      'dailyRequests', v_daily.request_count,
      'dailyRequestLimit', p_daily_request_limit,
      'monthlyRequests', v_monthly.request_count,
      'monthlyRequestLimit', p_monthly_request_limit
    );
  end if;

  if v_count and v_monthly.request_count >= p_monthly_request_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_requests',
      'dailyRequests', v_daily.request_count,
      'dailyRequestLimit', p_daily_request_limit,
      'monthlyRequests', v_monthly.request_count,
      'monthlyRequestLimit', p_monthly_request_limit
    );
  end if;

  if coalesce(p_daily_cost_limit, 0) > 0
     and (v_daily.estimated_cost_usd + v_daily.reserved_cost_usd + v_reserved) > p_daily_cost_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_cost',
      'dailyCostUsd', v_daily.estimated_cost_usd + v_daily.reserved_cost_usd,
      'dailyCostLimitUsd', p_daily_cost_limit
    );
  end if;

  if coalesce(p_monthly_cost_limit, 0) > 0
     and (v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd + v_reserved) > p_monthly_cost_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'monthly_cost',
      'monthlyCostUsd', v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd,
      'monthlyCostLimitUsd', p_monthly_cost_limit
    );
  end if;

  if coalesce(p_global_daily_cost_limit, 0) > 0 then
    select coalesce(sum(estimated_cost_usd + reserved_cost_usd), 0)
      into v_global_daily
      from public.ai_usage_daily
      where usage_date = v_today;
    if v_global_daily + v_reserved > p_global_daily_cost_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'global_daily_cost',
        'globalDailyCostUsd', v_global_daily,
        'globalDailyCostLimitUsd', p_global_daily_cost_limit
      );
    end if;
  end if;

  if coalesce(p_global_monthly_cost_limit, 0) > 0 then
    select coalesce(sum(estimated_cost_usd + reserved_cost_usd), 0)
      into v_global_monthly
      from public.ai_usage_monthly
      where month_start = v_month;
    if v_global_monthly + v_reserved > p_global_monthly_cost_limit then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'global_monthly_cost',
        'globalMonthlyCostUsd', v_global_monthly,
        'globalMonthlyCostLimitUsd', p_global_monthly_cost_limit
      );
    end if;
  end if;

  update public.ai_usage_daily
  set request_count = request_count + (case when v_count then 1 else 0 end),
      reserved_cost_usd = reserved_cost_usd + v_reserved,
      user_id = coalesce(p_user_id, user_id),
      username = coalesce(p_username, username),
      tier = coalesce(nullif(p_tier, ''), tier),
      updated_at = now()
  where identifier = v_identifier and usage_date = v_today
  returning * into v_daily;

  update public.ai_usage_monthly
  set request_count = request_count + (case when v_count then 1 else 0 end),
      reserved_cost_usd = reserved_cost_usd + v_reserved,
      user_id = coalesce(p_user_id, user_id),
      username = coalesce(p_username, username),
      tier = coalesce(nullif(p_tier, ''), tier),
      updated_at = now()
  where identifier = v_identifier and month_start = v_month
  returning * into v_monthly;

  return jsonb_build_object(
    'allowed', true,
    'requestCounted', v_count,
    'dailyRequests', v_daily.request_count,
    'dailyRequestLimit', p_daily_request_limit,
    'monthlyRequests', v_monthly.request_count,
    'monthlyRequestLimit', p_monthly_request_limit,
    'dailyCostUsd', v_daily.estimated_cost_usd + v_daily.reserved_cost_usd,
    'dailyCostLimitUsd', p_daily_cost_limit,
    'monthlyCostUsd', v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd,
    'monthlyCostLimitUsd', p_monthly_cost_limit,
    'reservedCostUsd', v_reserved
  );
end;
$$;

revoke all on table public.ai_response_cache from anon, authenticated;
grant select, insert, update, delete on table public.ai_response_cache to service_role;

revoke execute on function public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric, boolean
) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric, boolean
) to service_role;

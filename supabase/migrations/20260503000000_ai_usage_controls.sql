-- Server-side AI usage controls for launch.
-- Client-side limits are only UX hints; these counters are enforced by Edge
-- Functions before provider calls are made.

create table if not exists public.ai_usage_daily (
  id                  uuid primary key default gen_random_uuid(),
  usage_date          date not null default current_date,
  identifier          text not null,
  user_id             uuid references public.app_users(id) on delete cascade,
  username            text,
  tier                text not null default 'free',
  request_count       integer not null default 0,
  tokens_used         integer not null default 0,
  estimated_cost_usd  numeric(12,6) not null default 0,
  reserved_cost_usd   numeric(12,6) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (identifier, usage_date)
);

create table if not exists public.ai_usage_monthly (
  id                  uuid primary key default gen_random_uuid(),
  month_start         date not null default date_trunc('month', current_date)::date,
  identifier          text not null,
  user_id             uuid references public.app_users(id) on delete cascade,
  username            text,
  tier                text not null default 'free',
  request_count       integer not null default 0,
  tokens_used         integer not null default 0,
  estimated_cost_usd  numeric(12,6) not null default 0,
  reserved_cost_usd   numeric(12,6) not null default 0,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (identifier, month_start)
);

alter table public.ai_usage_daily enable row level security;
alter table public.ai_usage_monthly enable row level security;

create index if not exists ai_usage_daily_date_idx
  on public.ai_usage_daily (usage_date);

create index if not exists ai_usage_daily_user_idx
  on public.ai_usage_daily (user_id, usage_date);

create index if not exists ai_usage_monthly_month_idx
  on public.ai_usage_monthly (month_start);

create index if not exists ai_usage_monthly_user_idx
  on public.ai_usage_monthly (user_id, month_start);

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
  p_global_monthly_cost_limit numeric default null
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

  if v_daily.request_count >= p_daily_request_limit then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_requests',
      'dailyRequests', v_daily.request_count,
      'dailyRequestLimit', p_daily_request_limit,
      'monthlyRequests', v_monthly.request_count,
      'monthlyRequestLimit', p_monthly_request_limit
    );
  end if;

  if v_monthly.request_count >= p_monthly_request_limit then
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
  set request_count = request_count + 1,
      reserved_cost_usd = reserved_cost_usd + v_reserved,
      user_id = coalesce(p_user_id, user_id),
      username = coalesce(p_username, username),
      tier = coalesce(nullif(p_tier, ''), tier),
      updated_at = now()
  where identifier = v_identifier and usage_date = v_today
  returning * into v_daily;

  update public.ai_usage_monthly
  set request_count = request_count + 1,
      reserved_cost_usd = reserved_cost_usd + v_reserved,
      user_id = coalesce(p_user_id, user_id),
      username = coalesce(p_username, username),
      tier = coalesce(nullif(p_tier, ''), tier),
      updated_at = now()
  where identifier = v_identifier and month_start = v_month
  returning * into v_monthly;

  return jsonb_build_object(
    'allowed', true,
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

create or replace function public.record_ai_usage_result(
  p_identifier text,
  p_user_id uuid,
  p_username text,
  p_tier text,
  p_tokens integer,
  p_estimated_cost_usd numeric,
  p_reserved_cost_usd numeric default 0
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
  v_tokens integer := greatest(coalesce(p_tokens, 0), 0);
  v_actual numeric := greatest(coalesce(p_estimated_cost_usd, 0), 0);
  v_reserved numeric := greatest(coalesce(p_reserved_cost_usd, 0), 0);
begin
  if v_identifier is null then
    return jsonb_build_object('recorded', false, 'reason', 'invalid_identifier');
  end if;

  insert into public.ai_usage_daily (
    usage_date, identifier, user_id, username, tier, tokens_used, estimated_cost_usd
  )
  values (
    v_today, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'), v_tokens, v_actual
  )
  on conflict (identifier, usage_date)
  do update set
    tokens_used = public.ai_usage_daily.tokens_used + v_tokens,
    estimated_cost_usd = public.ai_usage_daily.estimated_cost_usd + v_actual,
    reserved_cost_usd = greatest(public.ai_usage_daily.reserved_cost_usd - v_reserved, 0),
    user_id = coalesce(p_user_id, public.ai_usage_daily.user_id),
    username = coalesce(p_username, public.ai_usage_daily.username),
    tier = coalesce(nullif(p_tier, ''), public.ai_usage_daily.tier),
    updated_at = now()
  returning * into v_daily;

  insert into public.ai_usage_monthly (
    month_start, identifier, user_id, username, tier, tokens_used, estimated_cost_usd
  )
  values (
    v_month, v_identifier, p_user_id, p_username, coalesce(nullif(p_tier, ''), 'free'), v_tokens, v_actual
  )
  on conflict (identifier, month_start)
  do update set
    tokens_used = public.ai_usage_monthly.tokens_used + v_tokens,
    estimated_cost_usd = public.ai_usage_monthly.estimated_cost_usd + v_actual,
    reserved_cost_usd = greatest(public.ai_usage_monthly.reserved_cost_usd - v_reserved, 0),
    user_id = coalesce(p_user_id, public.ai_usage_monthly.user_id),
    username = coalesce(p_username, public.ai_usage_monthly.username),
    tier = coalesce(nullif(p_tier, ''), public.ai_usage_monthly.tier),
    updated_at = now()
  returning * into v_monthly;

  return jsonb_build_object(
    'recorded', true,
    'dailyRequests', v_daily.request_count,
    'monthlyRequests', v_monthly.request_count,
    'dailyTokens', v_daily.tokens_used,
    'monthlyTokens', v_monthly.tokens_used,
    'dailyCostUsd', v_daily.estimated_cost_usd + v_daily.reserved_cost_usd,
    'monthlyCostUsd', v_monthly.estimated_cost_usd + v_monthly.reserved_cost_usd
  );
end;
$$;

revoke all on table public.ai_usage_daily from anon, authenticated;
revoke all on table public.ai_usage_monthly from anon, authenticated;
grant select, insert, update on table public.ai_usage_daily to service_role;
grant select, insert, update on table public.ai_usage_monthly to service_role;

revoke execute on function public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(
  text, uuid, text, text, integer, integer, numeric, numeric, numeric, numeric, numeric
) to service_role;

revoke execute on function public.record_ai_usage_result(
  text, uuid, text, text, integer, numeric, numeric
) from public, anon, authenticated;
grant execute on function public.record_ai_usage_result(
  text, uuid, text, text, integer, numeric, numeric
) to service_role;

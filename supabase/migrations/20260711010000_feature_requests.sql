-- Feature request voting board.
--
-- Users submit ideas; anyone (logged in) upvotes; staff move status
-- Open -> Planned -> In Progress -> Shipped (or Declined). Backs the
-- feature-requests edge function. Same access model as ai_feedback /
-- bug_reports: RLS on, service_role only, no direct anon/authenticated
-- table grants. Vote mutations go through a SECURITY DEFINER RPC so the
-- denormalized vote_count stays exact and atomic.

create table if not exists public.feature_requests (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  category         text,
  status           text not null default 'open'
                     check (status in ('open', 'planned', 'in_progress', 'shipped', 'declined')),
  author_identifier text not null,              -- 'app:<uuid>' | 'sleeper:<username>'
  author_user_id    uuid references public.app_users(id) on delete set null,
  author_username   text,
  vote_count        integer not null default 0,
  pinned            boolean not null default false,
  admin_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.feature_votes (
  id          uuid primary key default gen_random_uuid(),
  feature_id  uuid not null references public.feature_requests(id) on delete cascade,
  identifier  text not null,                    -- one vote per identity per feature
  user_id     uuid references public.app_users(id) on delete set null,
  username    text,
  created_at  timestamptz not null default now(),
  unique (feature_id, identifier)
);

alter table public.feature_requests enable row level security;
alter table public.feature_votes    enable row level security;

create index if not exists feature_requests_status_idx  on public.feature_requests (status, vote_count desc, created_at desc);
create index if not exists feature_requests_votes_idx   on public.feature_requests (vote_count desc);
create index if not exists feature_votes_feature_idx    on public.feature_votes (feature_id);
create index if not exists feature_votes_identifier_idx on public.feature_votes (identifier);

create or replace function public.touch_feature_requests_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_feature_requests_touch on public.feature_requests;
create trigger trg_feature_requests_touch
  before update on public.feature_requests
  for each row execute function public.touch_feature_requests_updated_at();

-- ── Toggle a vote atomically; returns the new count + whether the caller
--    now has an active vote. p_vote=true means "cast", false means "remove".
create or replace function public.toggle_feature_vote(
  p_feature_id uuid,
  p_identifier text,
  p_user_id    uuid,
  p_username   text,
  p_vote       boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ident text := left(nullif(btrim(coalesce(p_identifier, '')), ''), 300);
  v_count integer := 0;
  v_voted boolean := false;
begin
  if v_ident is null or p_feature_id is null then
    return jsonb_build_object('ok', false, 'error', 'bad_args');
  end if;
  if not exists (select 1 from public.feature_requests where id = p_feature_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_vote then
    insert into public.feature_votes (feature_id, identifier, user_id, username)
    values (p_feature_id, v_ident, p_user_id, p_username)
    on conflict (feature_id, identifier) do nothing;
  else
    delete from public.feature_votes
    where feature_id = p_feature_id and identifier = v_ident;
  end if;

  select count(*) into v_count from public.feature_votes where feature_id = p_feature_id;
  update public.feature_requests set vote_count = v_count where id = p_feature_id;
  select exists (
    select 1 from public.feature_votes where feature_id = p_feature_id and identifier = v_ident
  ) into v_voted;

  return jsonb_build_object('ok', true, 'voteCount', v_count, 'myVote', v_voted);
end;
$$;

-- ── List board with per-caller vote state. p_identifier may be null (anon view).
create or replace function public.list_feature_requests(
  p_identifier text default null,
  p_status     text default null,
  p_limit      integer default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ident text := left(nullif(btrim(coalesce(p_identifier, '')), ''), 300);
  v_rows  jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  into v_rows
  from (
    select
      fr.id,
      fr.title,
      fr.description,
      fr.category,
      fr.status,
      fr.author_username,
      fr.vote_count,
      fr.pinned,
      fr.admin_note,
      fr.created_at,
      case when v_ident is null then false
           else exists (select 1 from public.feature_votes fv
                        where fv.feature_id = fr.id and fv.identifier = v_ident)
      end as my_vote
    from public.feature_requests fr
    where (p_status is null or fr.status = p_status)
    order by fr.pinned desc, fr.vote_count desc, fr.created_at desc
    limit greatest(1, least(coalesce(p_limit, 200), 500))
  ) t;

  return v_rows;
end;
$$;

-- Lock down: tables + RPCs reachable only via the service role.
revoke all on table public.feature_requests from anon, authenticated;
revoke all on table public.feature_votes    from anon, authenticated;
grant select, insert, update on table public.feature_requests to service_role;
grant select, insert, delete on table public.feature_votes    to service_role;

revoke execute on function public.toggle_feature_vote(uuid, text, uuid, text, boolean) from public, anon, authenticated;
grant  execute on function public.toggle_feature_vote(uuid, text, uuid, text, boolean) to service_role;
revoke execute on function public.list_feature_requests(text, text, integer) from public, anon, authenticated;
grant  execute on function public.list_feature_requests(text, text, integer) to service_role;

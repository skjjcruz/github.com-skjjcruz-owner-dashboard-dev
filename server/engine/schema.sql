-- DHQ engine store (the vacant Supabase project). Idempotent: the builder
-- runs this on every pass. Row-level security is on with no policies, so
-- only the service role (the builder and, later, the server endpoint) can
-- read or write — nothing here is reachable with the public key.

create table if not exists public.connect_leagues (
  league_id        text primary key,
  platform         text not null default 'sleeper',
  sleeper_user_id  text,
  label            text,
  active           boolean not null default true,
  added_at         timestamptz not null default now()
);
alter table public.connect_leagues enable row level security;

create table if not exists public.league_intel (
  league_id        text primary key,
  season           text,
  name             text,
  platform         text not null default 'sleeper',
  built_at         timestamptz not null,
  engine_version   text,
  build_ms         integer,
  intel            jsonb not null,
  assessments      jsonb not null,
  dna              jsonb,
  snapshot         jsonb not null,
  error            text
);
alter table public.league_intel enable row level security;

create table if not exists public.engine_cache (
  key              text primary key,
  data             jsonb not null,
  updated_at       timestamptz not null default now()
);
alter table public.engine_cache enable row level security;

create table if not exists public.engine_runs (
  id               bigint generated always as identity primary key,
  started_at       timestamptz not null,
  finished_at      timestamptz,
  engine_version   text,
  leagues_ok       integer default 0,
  leagues_failed   integer default 0,
  notes            text
);
alter table public.engine_runs enable row level security;

-- The owner's leagues, so the first scheduled run has something to build.
-- Members' leagues are added here by the connect flow later.
insert into public.connect_leagues (league_id, sleeper_user_id, label) values
  ('1312100327931019264', '540392203863576576', 'The Psycho League: Year VI'),
  ('1356311207652360192', '540392203863576576', 'CTB The One - Year 15'),
  ('1369584118731386880', '540392203863576576', 'FG Invitational 8'),
  ('1389388885716385792', '540392203863576576', 'CTB Shootout League Year 6'),
  ('1402444299487985664', '540392203863576576', 'DHQ')
on conflict (league_id) do nothing;

-- Account deletion must clean up the newer social tables (owner ask 2026-09-19).
--
-- admin-delete-user removes the app_users row and relies on ON DELETE rules to
-- clear everything that hangs off it. Time leagues and campaign rooms shipped
-- with NO ACTION references, so deleting any account that had joined a time
-- league or opened a campaign room failed with a foreign-key error (found
-- while removing two QA test accounts).
--
-- Rules:
--   membership and action rows go with the account            -> CASCADE
--   a league / room someone else still plays in survives       -> SET NULL on created_by
--   a league / room whose last member is gone is swept         -> trigger

alter table public.time_league_members
  drop constraint if exists time_league_members_user_id_fkey,
  add constraint time_league_members_user_id_fkey
    foreign key (user_id) references public.app_users(id) on delete cascade;

alter table public.duat_campaign_members
  drop constraint if exists duat_campaign_members_user_id_fkey,
  add constraint duat_campaign_members_user_id_fkey
    foreign key (user_id) references public.app_users(id) on delete cascade;

alter table public.duat_campaign_actions
  drop constraint if exists duat_campaign_actions_user_id_fkey,
  add constraint duat_campaign_actions_user_id_fkey
    foreign key (user_id) references public.app_users(id) on delete cascade;

alter table public.time_leagues
  alter column created_by drop not null,
  drop constraint if exists time_leagues_created_by_fkey,
  add constraint time_leagues_created_by_fkey
    foreign key (created_by) references public.app_users(id) on delete set null;

alter table public.duat_campaigns
  alter column created_by drop not null,
  drop constraint if exists duat_campaigns_created_by_fkey,
  add constraint duat_campaigns_created_by_fkey
    foreign key (created_by) references public.app_users(id) on delete set null;

-- Sweep a league or room once its last member is gone.
create or replace function public.sweep_empty_time_league()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.time_leagues l
   where l.id = old.league_id
     and not exists (select 1 from public.time_league_members m where m.league_id = l.id);
  return null;
end $$;

drop trigger if exists time_league_members_sweep on public.time_league_members;
create trigger time_league_members_sweep
  after delete on public.time_league_members
  for each row execute function public.sweep_empty_time_league();

create or replace function public.sweep_empty_duat_campaign()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.duat_campaigns c
   where c.id = old.room_id
     and not exists (select 1 from public.duat_campaign_members m where m.room_id = c.id);
  return null;
end $$;

drop trigger if exists duat_campaign_members_sweep on public.duat_campaign_members;
create trigger duat_campaign_members_sweep
  after delete on public.duat_campaign_members
  for each row execute function public.sweep_empty_duat_campaign();

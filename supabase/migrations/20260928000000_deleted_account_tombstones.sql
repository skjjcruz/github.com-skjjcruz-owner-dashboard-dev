-- Deleted-account tombstones (identity lifecycle audit 2026-09-28, SHOULD-FIX 3).
--
-- Problem: fw-oauth-sync upserts app_users BY EMAIL, and landing re-syncs on any
-- load that still holds a Supabase (Google/Apple) session. fw-delete-account
-- never deleted the Supabase Auth user (it passed app_users.id, a different id
-- space), so a device that kept its Google session silently RECREATED an
-- account the owner had deleted.
--
-- fw-delete-account now deletes the auth user by email and writes a row here;
-- fw-oauth-sync refuses (410 account_deleted) to recreate an account from an
-- auth user created BEFORE a deletion in the last 30 days, and removes that
-- stale auth user. A sign-in made after the deletion is a new auth user and
-- signs up normally (its tombstone is then cleared).
--
-- Privacy: only the SHA-256 of the normalized (trimmed, lower-cased) email is
-- kept — never the address. Service role only (RLS on, no policies).
--
-- The edge functions tolerate this table being absent (writes and reads are
-- best-effort, the check fails open), so functions may deploy before this is
-- applied. NOT in the deploy workflow's auto-apply allowlist: apply by hand.
-- Safe to re-run.

create table if not exists public.deleted_account_tombstones (
  email_sha256 text        primary key check (email_sha256 ~ '^[0-9a-f]{64}$'),
  deleted_at   timestamptz not null default now(),
  source       text        not null default 'self_service'
);

create index if not exists deleted_account_tombstones_deleted_at_idx
  on public.deleted_account_tombstones (deleted_at);

alter table public.deleted_account_tombstones enable row level security;
revoke all on table public.deleted_account_tombstones from anon, authenticated;
grant select, insert, update, delete on table public.deleted_account_tombstones to service_role;

-- Backfill: self-service deletions made before this fix left their auth users
-- alive, so those are exactly the accounts a lingering Google session can
-- resurrect today. security_events.actor_email holds the deleted address.
-- (admin-delete-user deletions are deliberately NOT tombstoned: that tool is
-- used to give a customer a clean re-signup.)
insert into public.deleted_account_tombstones (email_sha256, deleted_at, source)
select encode(sha256(convert_to(lower(btrim(actor_email)), 'UTF8')), 'hex'),
       max(created_at),
       'backfill_self_service'
  from public.security_events
 where event_type = 'fw_delete_account'
   and outcome = 'success'
   and coalesce(actor_email, '') <> ''
 group by 1
on conflict (email_sha256) do update
  set deleted_at = greatest(public.deleted_account_tombstones.deleted_at, excluded.deleted_at);

-- A deleted address that has since signed up again (new app_users row) is
-- not a tombstone any more.
delete from public.deleted_account_tombstones t
 using public.app_users u
 where t.email_sha256 = encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex')
   and u.created_at > t.deleted_at;

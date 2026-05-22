-- ══════════════════════════════════════════════════════════════════
-- mock_drafts table — Phase 5 persistence (Tier 3: Supabase)
--
-- Run this migration manually on the Supabase instance via the SQL
-- editor or CLI. The War Room Draft Command Center ships with
-- localStorage-only persistence by default (see js/draft/persistence.js).
-- This table is an optional upgrade that enables cross-device templates
-- and share-by-slug URLs.
--
-- Companion: when this table exists, extend
-- js/draft-war-room/supabase-draft-client.js with:
--   - saveMockDraft(state, opts)
--   - loadMockDraft(slug)
--   - listMockDraftsByUsername(username)
--   - deleteMockDraft(id)
-- using the same pattern as saveDraftBoard / loadDraftBoardBySleeperDraftId.
-- ══════════════════════════════════════════════════════════════════

create table if not exists mock_drafts (
    id                uuid primary key default gen_random_uuid(),
    sleeper_username  text not null,
    league_id         text,
    created_at        timestamptz default now(),
    updated_at        timestamptz default now(),
    template_name     text,
    mode              text default 'solo',  -- 'solo' | 'ghost' | 'scenario' | 'live-sync'
    draft_state       jsonb not null,       -- full draftState snapshot
    share_slug        text unique,          -- short code for shareable URL
    is_public         boolean default false
);

-- Index for fast per-username listings
create index if not exists mock_drafts_username_idx on mock_drafts (sleeper_username);
create index if not exists mock_drafts_league_idx on mock_drafts (league_id);
create index if not exists mock_drafts_slug_idx on mock_drafts (share_slug);

-- Row-level security: users can only read/write their own templates,
-- but share_slug lookups bypass RLS for public templates.
alter table mock_drafts enable row level security;

create policy "Users read own mock drafts"
    on mock_drafts for select
    using (sleeper_username = auth.jwt() ->> 'sleeper_username');

create policy "Users read public mock drafts by slug"
    on mock_drafts for select
    using (is_public = true);

create policy "Users write own mock drafts"
    on mock_drafts for insert
    with check (sleeper_username = auth.jwt() ->> 'sleeper_username');

create policy "Users update own mock drafts"
    on mock_drafts for update
    using (sleeper_username = auth.jwt() ->> 'sleeper_username');

create policy "Users delete own mock drafts"
    on mock_drafts for delete
    using (sleeper_username = auth.jwt() ->> 'sleeper_username');

-- Trigger: auto-update updated_at on any change
create or replace function update_mock_drafts_updated_at()
returns trigger as $$
begin
    new.updated_at := now();
    return new;
end;
$$ language plpgsql;

create trigger mock_drafts_updated_at
    before update on mock_drafts
    for each row
    execute procedure update_mock_drafts_updated_at();

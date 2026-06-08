-- 20260608010000_drop_legacy_ai_rate_limits
--
-- Quota-collapse step of the Scout + War Room merge. Retire the legacy
-- username-keyed AI throttle (`ai_rate_limits` + the `increment_rate_limit`
-- SECURITY DEFINER incrementer). Superseded months ago by the cost-based
-- `ai_usage_daily` / `ai_usage_monthly` system, which the deployed ai-analyze
-- (v112) uses exclusively.
--
-- Pre-checks performed (read-only):
--   * deployed ai-analyze references neither `ai_rate_limits` nor
--     `increment_rate_limit` (only the unrelated `auth_rate_limits`)
--   * no frontend runtime code in either repo calls them
--   * the 4 stale rows (zero tokens, Mar/Apr 2026) are preserved in
--     backups/2026-06-08-scout-pre-merge-snapshot.json and were NOT backfilled
--     (old-dated request counters add noise, not value, to the live cost ledger)
--
-- Side benefit: clears advisor lints 0028/0029 (anon/authenticated-executable
-- SECURITY DEFINER) for increment_rate_limit.

drop function if exists public.increment_rate_limit(text, integer);
drop table if exists public.ai_rate_limits;  -- its RLS policies drop with the table

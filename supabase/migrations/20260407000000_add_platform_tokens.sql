-- ============================================================
-- Add platform_tokens column to app_users
-- Stores OAuth tokens for connected fantasy platforms.
--
-- Shape: {
--   "yahoo": {
--     "access_token":  "...",
--     "refresh_token": "...",
--     "expires_at":    1712345678000,   -- ms since epoch
--     "guid":          "ABCDE1234..."
--   }
-- }
-- ============================================================

ALTER TABLE public.app_users
  ADD COLUMN IF NOT EXISTS platform_tokens jsonb DEFAULT '{}'::jsonb;

-- GIN index for efficient token lookups by platform key
CREATE INDEX IF NOT EXISTS idx_app_users_platform_tokens
  ON public.app_users USING gin (platform_tokens);

// ══════════════════════════════════════════════════════════════════
// mfl-proxy — Supabase Edge Function
// Proxies requests to the MyFantasyLeague API to bypass CORS.
// MFL blocks all cross-origin browser requests; this function
// relays them server-side.
//
// AUTH: requires a valid app session token (same gate as fw-profile).
//   Without it the relay is an open, unauthenticated proxy that anyone
//   could abuse for bandwidth/quota, so callers MUST send the user's
//   session token: Authorization: Bearer <fw_session_v1 token>.
//
// POST body: { url: string }   — must be a myfantasyleague.com URL
//
// DEPLOY (in-function auth, matches the other functions):
//   supabase functions deploy mfl-proxy --use-api --no-verify-jwt
// ══════════════════════════════════════════════════════════════════

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  corsHeaders,
  handleOptions,
  json,
  requireActiveAppSession,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 60;
const rateBuckets = new Map<string, { bucket: number; count: number }>();

function isValidMflUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'api.myfantasyleague.com' ||
        parsed.hostname === 'myfantasyleague.com' ||
        parsed.hostname.endsWith('.myfantasyleague.com'))
    );
  } catch {
    return false;
  }
}

// Per-identity sliding-window limit. Keyed by app user id (not a spoofable
// IP header), so a single account can't burn the shared proxy quota.
function checkRateLimit(id: string): boolean {
  const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS);
  const current = rateBuckets.get(id);
  if (!current || current.bucket !== bucket) {
    rateBuckets.set(id, { bucket, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= RATE_LIMIT_MAX;
}

Deno.serve(async (req: Request) => {
  const options = handleOptions(req);
  if (options) return options;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Auth gate: only signed-in app users may use the relay. This closes the
  // open-proxy abuse vector (the relay touches no user data and uses no
  // service_role privileges for the fetch itself, but an unauthenticated
  // endpoint could still be abused for bandwidth/invocation quota).
  const session = await requireActiveAppSession(admin, req);
  if (!session) {
    await auditEvent(admin, req, 'mfl_proxy', 'blocked', {}, { reason: 'invalid_session' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  if (!checkRateLimit(session.userId)) {
    return json(req, { error: 'Proxy rate limit exceeded. Try again shortly.' }, 429);
  }

  try {
    const body = await req.json();
    const { url } = body || {};

    if (!url || !isValidMflUrl(url)) {
      return json(req, { error: 'Invalid URL — only myfantasyleague.com URLs are allowed.' }, 400);
    }

    const mflRes = await fetch(url, {
      headers: {
        'User-Agent': 'FantasyWarRoom/1.0',
        'Accept': 'application/json',
      },
    });

    if (!mflRes.ok) {
      const status = mflRes.status;
      let msg = `MFL API error ${status}`;
      if (status === 401 || status === 403) {
        msg = 'This MFL league is private. Provide your API key to connect.';
      } else if (status === 404) {
        msg = 'MFL league not found. Check your League ID and year.';
      } else if (status === 429) {
        msg = 'MFL rate limit reached. Wait a moment and try again.';
      }
      return json(req, { error: msg }, status);
    }

    const data = await mflRes.text();
    return new Response(data, {
      status: 200,
      headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[mfl-proxy] Error:', err);
    return json(req, { error: (err as Error).message || 'Proxy error' }, 500);
  }
});

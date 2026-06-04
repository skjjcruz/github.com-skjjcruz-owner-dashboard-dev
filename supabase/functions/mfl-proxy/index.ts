// ══════════════════════════════════════════════════════════════════
// mfl-proxy — Supabase Edge Function
// Proxies requests to the MyFantasyLeague API to bypass CORS.
// MFL blocks all cross-origin browser requests; this function
// relays them server-side.
//
// POST body: { url: string }   — must be a myfantasyleague.com URL
//
// DEPLOY:
//   supabase functions deploy mfl-proxy
// ══════════════════════════════════════════════════════════════════

import { corsHeaders, handleOptions, json } from '../_shared/security.ts';

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

function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    req.headers.get('X-Real-IP') ||
    'unknown'
  );
}

function checkRateLimit(req: Request): boolean {
  const id = clientIp(req);
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

  if (!checkRateLimit(req)) {
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

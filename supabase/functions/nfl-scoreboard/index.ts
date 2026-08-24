// nfl-scoreboard — server-side relay + shared cache for ESPN's public NFL
// scoreboard (schedule, odds, weather in one call).
//
// Browsers are CORS-blocked from site.api.espn.com, so js/shared/nfl-context.js
// reads through a proxy: /api/nfl-scoreboard in dev (serve-static.cjs), and —
// until this function existed — NOTHING in production, which silently degraded
// every deployed projection to neutral (no Vegas, no weather, no future-week
// opponents). This is the prod half the nfl-context header always promised.
//
// GET ?week=N&season=YYYY&seasontype=2 — same params as the dev proxy; the
// upstream mapping (season → dates=) is mirrored from serve-static.cjs so the
// two environments stay interchangeable. Responses are cached in
// nfl_week_context so one fetch serves every user for hours: Vegas lines drift
// slowly and schedules are static. Serving N users costs ~6 ESPN calls/day
// instead of N×weeks.
//
// CORS is a deliberate wildcard, NOT the _shared/security.ts allowlist: this
// relay serves public, read-only league data with no cookies or auth, and the
// original deploy's bundled allowlist predated dhqfootball.com, which silently
// blocked every deployed browser from reading the response (the 2026-08-22
// "scoreboard 404" storm's server half). Per-IP rate limiting below is the
// abuse control.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3h — odds move, but not minute-to-minute
const RATE_LIMIT = 40;                   // per IP per window (a full-season sweep is 18)
const RATE_WINDOW_MS = 5 * 60 * 1000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const CORS: HeadersInit = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    req.headers.get('X-Real-IP') ||
    'unknown'
  );
}

// In-isolate IP rate limit — resets on cold start, which is fine: the point is
// stopping a tight client loop from turning into an ESPN hammer, not perfect
// global accounting (the cache absorbs honest traffic anyway).
const hits = new Map<string, { count: number; start: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.start > RATE_WINDOW_MS) { hits.set(ip, { count: 1, start: now }); return false; }
  h.count += 1;
  return h.count > RATE_LIMIT;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405);
  if (rateLimited(clientIp(req))) return json({ error: 'Rate limit exceeded. Try again shortly.' }, 429);

  const u = new URL(req.url);
  const week = parseInt(u.searchParams.get('week') || '0', 10) || 0;
  const season = parseInt(u.searchParams.get('season') || '0', 10) || 0;
  const seasontype = parseInt(u.searchParams.get('seasontype') || '2', 10) || 2;
  if (week < 0 || week > 22 || (season && (season < 2020 || season > 2100)) || seasontype < 1 || seasontype > 4) {
    return json({ error: 'Invalid week/season/seasontype' }, 400);
  }

  const admin = (SUPABASE_URL && SERVICE_KEY) ? createClient(SUPABASE_URL, SERVICE_KEY) : null;

  // 1. Cache read. season 0 = "ESPN's current default" — cached under 0 so the
  // common no-param call still shares one entry.
  if (admin) {
    try {
      const { data: row } = await admin
        .from('nfl_week_context')
        .select('payload, updated_at')
        .eq('season', season).eq('seasontype', seasontype).eq('week', week)
        .maybeSingle();
      if (row && row.payload && Date.now() - Date.parse(row.updated_at) < CACHE_TTL_MS) {
        return new Response(JSON.stringify(row.payload), {
          status: 200,
          headers: { ...CORS, 'Content-Type': 'application/json', 'X-Wr-Cache': 'hit' },
        });
      }
    } catch (_) { /* cache miss path below */ }
  }

  // 2. Upstream fetch — param mapping mirrored from serve-static.cjs exactly.
  let api = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';
  const qp = ['seasontype=' + seasontype];
  if (week > 0) qp.push('week=' + week);
  if (season > 0) qp.push('dates=' + season);
  api += '?' + qp.join('&');

  let payload: unknown;
  try {
    const r = await fetch(api, { headers: { 'User-Agent': 'FantasyWarRoom/1.0', 'Accept': 'application/json' } });
    if (!r.ok) return json({ error: 'ESPN scoreboard error ' + r.status }, 502);
    payload = await r.json();
  } catch (_) {
    return json({ error: 'ESPN scoreboard unreachable' }, 502);
  }

  // 3. Cache write (best effort — a failed upsert must not fail the response).
  if (admin) {
    try {
      await admin.from('nfl_week_context').upsert(
        { season, seasontype, week, payload, updated_at: new Date().toISOString() },
        { onConflict: 'season,seasontype,week' },
      );
    } catch (_) { /* non-fatal */ }
  }

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'X-Wr-Cache': 'miss' },
  });
});

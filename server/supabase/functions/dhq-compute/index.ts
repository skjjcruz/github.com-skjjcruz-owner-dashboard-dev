// dhq-compute — values for a league the engine server hasn't built (Phase A6,
// 2026-10-28). Pages no longer carry the value formula: for an ESPN or MFL
// league, or a Sleeper league the server didn't take, the page gathers the
// league's data as it always has and posts it here; a standby builder on the
// engine server (server/engine/run.js) computes the values in seconds and
// the page asks for them by id. Public, no sign-in: what comes back is the
// values for the data sent, which the page would otherwise have computed
// itself.
//
//   POST /functions/v1/dhq-compute  body: { league_key, platform, payload }
//   → { id }
//   GET  /functions/v1/dhq-compute?id=<id>
//   → { status: pending | building | done | failed, intel?, error? }
//
// Guards: payload at most 4 MB, at most 40 requests per caller per hour and
// 100 waiting overall.
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
// The values (about 1 MB of text) go out gzipped when the page takes it.
function gzipped(req: Request, text: string) {
  if (!/\bgzip\b/.test(req.headers.get('accept-encoding') || '')) return json(text);
  const gz = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(gz, { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', ...CORS } });
}

const MAX_BYTES = 4 * 1024 * 1024, PER_HOUR = 40, QUEUE_CAP = 100;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    ...init,
    headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error('rest ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  try {
    if (req.method === 'GET') {
      const id = new URL(req.url).searchParams.get('id') || '';
      if (!ID.test(id)) return json({ error: 'id required' }, 400);
      const row = ((await rest('compute_requests?select=status,error,result_json&id=eq.' + id)) as Array<{ status: string; error: string | null; result_json: string | null }>)[0];
      if (!row) return json({ error: 'unknown id' }, 404);
      if (row.status === 'done' && row.result_json) return gzipped(req, '{"status":"done","intel":' + row.result_json + '}');
      return json({ status: row.status, error: row.error || undefined });
    }
    if (req.method !== 'POST') return json({ error: 'GET or POST' }, 405);
    const text = await req.text();
    if (text.length > MAX_BYTES) return json({ error: 'payload too large' }, 413);
    let body: { league_key?: unknown; platform?: unknown; payload?: unknown } = {};
    try { body = JSON.parse(text); } catch { return json({ error: 'JSON body required' }, 400); }
    const key = String(body.league_key || '').trim();
    const platform = String(body.platform || 'sleeper').toLowerCase();
    const p = body.payload as Record<string, unknown> | undefined;
    if (!/^[a-z0-9_]{3,80}$/i.test(key) || !/^(sleeper|espn|mfl|yahoo)$/.test(platform) || !p || typeof p !== 'object' || !p.league || !Array.isArray(p.rosters) || !p.gathered) {
      return json({ error: 'league_key, platform and payload { league, rosters, gathered } required' }, 400);
    }
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const ipHash = await sha('dhq-compute:' + ip);
    const since = new Date(Date.now() - 3600e3).toISOString();
    const [mine, waiting] = await Promise.all([
      rest('compute_requests?select=id&ip_hash=eq.' + ipHash + '&requested_at=gte.' + since + '&limit=' + (PER_HOUR + 1)) as Promise<unknown[]>,
      rest('compute_requests?select=id&status=eq.pending&limit=' + (QUEUE_CAP + 1)) as Promise<unknown[]>,
    ]);
    if (mine.length >= PER_HOUR || waiting.length >= QUEUE_CAP) return json({ error: 'busy: try later' }, 429);
    const rows = await rest('compute_requests?select=id', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ league_key: key, platform, payload: p, ip_hash: ipHash }]),
    }) as Array<{ id: string }>;
    return json({ id: rows[0].id });
  } catch (e) {
    return json({ error: 'not available', detail: String((e as Error).message || e) }, 503);
  }
});

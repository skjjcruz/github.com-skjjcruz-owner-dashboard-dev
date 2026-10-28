// dhq-league — one league's server-built DHQ numbers for the app (transition
// step 3, owner go-ahead 2026-10-18; Lab first). Public, no sign-in: Sleeper
// league data is public by id and these values already show to every app
// user. Only built leagues exist here; nothing about any DHQ member.
//
//   GET /functions/v1/dhq-league?league=1312100327931019264
//   → { league_id, season, built_at, engine_version, intel, dhq_proj, assess }
//   404 when the league hasn't been built (never cached: a new league's build
//   may land seconds later, and the app asks again), with its place in the
//   build queue: { error, league_id, queue: pending | building | … | null }.
//
// intel is the engine's full LeagueIntel minus sourceSnapshots (upstream
// URLs); dhq_proj is the week's projections. The row's error text, the
// snapshot (Sleeper data the app already has) and everything else stay out.
//
// assess (Phase A1, 2026-10-27): the build's team assessments and owner DNA,
// with each roster's players and record at build time so the app can tell
// whether the league has moved since (a trade, an add, a scored week) and
// compute on the device until the next build. Only from headless-6 on: older
// builds assessed with unscored stats and the wrong pick years.
//
// brain (Phase A2, headless-7 on): the points ledger, intent reads and the
// engine's one brain, so the app doesn't download the projection feeds.
//
// part=proj (Phase A3): just { league_id, season, built_at, engine_version,
// dhq_proj }, for an app that loaded the league's values from its own cache
// and only needs this week's DHQ projections (dhq_proj.app: each player's
// result as the app's own projection code holds it).
// part=later: { league_id, built_at, dhq_later }, later weeks' projections
// for every rostered player (built at most every 12 hours).
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

async function respond(req: Request, body: unknown, status: number, cache: string) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Cache-Control': cache, Vary: 'Accept-Encoding', ...CORS };
  if (/\bgzip\b/.test(req.headers.get('accept-encoding') || '') && text.length > 2048) {
    const gz = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Response(gz, { status, headers: { ...headers, 'Content-Encoding': 'gzip' } });
  }
  return new Response(text, { status, headers });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return respond(req, { error: 'GET only' }, 405, 'no-store');
  const id = new URL(req.url).searchParams.get('league') || '';
  if (!/^\d{10,20}$/.test(id)) return respond(req, { error: 'league=<Sleeper league id> required' }, 400, 'no-store');
  try {
    if (new URL(req.url).searchParams.get('part') === 'later') {
      const rl = await fetch(SUPABASE_URL + '/rest/v1/league_intel?select=league_id,built_at,dhq_later:snapshot->dhq_later&error=is.null&league_id=eq.' + id, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
      if (!rl.ok) throw new Error('rest ' + rl.status);
      const l = ((await rl.json()) as Array<Record<string, unknown>>)[0];
      if (!l || !l.dhq_later) return respond(req, { error: 'not built', league_id: id }, 404, 'no-store');
      return respond(req, { league_id: id, built_at: l.built_at, dhq_later: l.dhq_later }, 200, 'public, max-age=300');
    }
    if (new URL(req.url).searchParams.get('part') === 'proj') {
      const rp = await fetch(SUPABASE_URL + '/rest/v1/league_intel?select=league_id,season,built_at,engine_version,dhq_proj:snapshot->dhq_proj&error=is.null&league_id=eq.' + id, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
      if (!rp.ok) throw new Error('rest ' + rp.status);
      const p = ((await rp.json()) as Array<Record<string, unknown>>)[0];
      if (!p || !p.dhq_proj) return respond(req, { error: 'not built', league_id: id }, 404, 'no-store');
      return respond(req, { league_id: id, season: p.season, built_at: p.built_at, engine_version: p.engine_version, dhq_proj: p.dhq_proj }, 200, 'public, max-age=60');
    }
    // A build that stored its exact text (run.js app_*_json) is served as
    // that text, key order and all; older rows fall back to the columns.
    const exact = 'league_intel?select=league_id,season,built_at,engine_version,dhq_proj:snapshot->dhq_proj,intel_json:snapshot->>app_intel_json,assess_json:snapshot->>app_assess_json,brain_json:snapshot->>app_brain_json&error=is.null&league_id=eq.' + id;
    const r0 = await fetch(SUPABASE_URL + '/rest/v1/' + exact, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
    if (!r0.ok) throw new Error('rest ' + r0.status);
    const row0 = ((await r0.json()) as Array<Record<string, unknown>>)[0];
    if (row0 && typeof row0.intel_json === 'string' && row0.intel_json.length > 2) {
      const ver0 = Number((String(row0.engine_version || '').match(/^headless-(\d+)$/) || [])[1] || 0);
      const assessText = ver0 >= 6 && typeof row0.assess_json === 'string' ? row0.assess_json : 'null';
      const head = JSON.stringify({ league_id: id, season: row0.season, built_at: row0.built_at, engine_version: row0.engine_version, dhq_proj: row0.dhq_proj || null });
      const brainText = ver0 >= 7 && typeof row0.brain_json === 'string' && row0.brain_json.length > 2 ? row0.brain_json : 'null';
      return respond(req, head.slice(0, -1) + ',"intel":' + row0.intel_json + ',"assess":' + assessText + ',"brain":' + brainText + '}', 200, 'public, max-age=60');
    }
    const q = 'league_intel?select=league_id,season,built_at,engine_version,intel,assessments,dna,dhq_proj:snapshot->dhq_proj,rosters:snapshot->rosters&error=is.null&league_id=eq.' + id;
    const r = await fetch(SUPABASE_URL + '/rest/v1/' + q, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
    if (!r.ok) throw new Error('rest ' + r.status);
    const rows = await r.json() as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row || !row.intel) {
      // Where it is in the build queue (pending | building | built | failed,
      // or null when never asked for): the app waits only on a league that
      // is being built (Phase A6).
      const rq = await fetch(SUPABASE_URL + '/rest/v1/build_requests?select=status&league_id=eq.' + id, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } }).catch(() => null);
      const queue = rq && rq.ok ? (((await rq.json()) as Array<{ status: string }>)[0] || {}).status || null : null;
      return respond(req, { error: 'not built', league_id: id, queue }, 404, 'no-store');
    }
    const intel = { ...(row.intel as Record<string, unknown>) };
    delete intel.sourceSnapshots;
    const ver = Number((String(row.engine_version || '').match(/^headless-(\d+)$/) || [])[1] || 0);
    const assess = ver >= 6 && Array.isArray(row.assessments) && row.assessments.length ? {
      assessments: row.assessments,
      dna: row.dna || {},
      rosters: ((row.rosters as Array<Record<string, any>>) || []).map(r => ({
        roster_id: r.roster_id, players: r.players || [],
        settings: { wins: r.settings?.wins || 0, losses: r.settings?.losses || 0, ties: r.settings?.ties || 0, fpts: r.settings?.fpts || 0 },
      })),
    } : null;
    return respond(req, { league_id: id, season: row.season, built_at: row.built_at, engine_version: row.engine_version, intel, dhq_proj: row.dhq_proj || null, assess }, 200, 'public, max-age=60');
  } catch (e) {
    return respond(req, { error: 'league unavailable', detail: String((e as Error).message || e) }, 503, 'no-store');
  }
});

// dhq-news — read-only player news for the app (engine project).
//
// The engine build links every NFL story to the players it touches
// (server/engine/news.js → player_news). This hands those links to the app
// and the member's AI: public NFL news only, nothing about any league or
// member, so it needs no sign-in.
//
//   GET /functions/v1/dhq-news?players=4034,6794&days=14
//   → { as_of, players: { "4034": [ { kind, link, why, headline, summary,
//        url, source, published_at } ] } }
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};
const json = (body: unknown, status = 200, cache = 'public, max-age=300') =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache, ...CORS } });

async function rest(path: string) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY } });
  if (!r.ok) throw new Error('rest ' + r.status);
  return r.json();
}

// Per player: newest first, at most this many, his own news before team news.
const PER_PLAYER = 6;
const RANK: Record<string, number> = { direct: 0, report: 0, teammate: 1, team: 1 };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'GET') return json({ error: 'GET only' }, 405, 'no-store');
  const u = new URL(req.url);
  const ids = [...new Set((u.searchParams.get('players') || '').split(',').map(s => s.trim()).filter(s => /^[A-Za-z0-9]{1,12}$/.test(s)))].slice(0, 80);
  const days = Math.min(30, Math.max(1, Number(u.searchParams.get('days')) || 14));
  if (!ids.length) return json({ error: 'players=… required (Sleeper ids, comma-separated, up to 80)' }, 400, 'no-store');
  try {
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const [rows, meta] = await Promise.all([
      rest('player_news?select=player_id,kind,link,why,headline,summary,url,source,published_at&player_id=in.(' + ids.join(',') + ')&published_at=gte.' + since + '&order=published_at.desc&limit=2000'),
      rest('engine_cache?select=data&key=eq.news_index'),
    ]);
    const players: Record<string, unknown[]> = {};
    ids.forEach(id => { players[id] = []; });
    (rows as Array<Record<string, string>>)
      .sort((a, b) => (RANK[a.link] ?? 2) - (RANK[b.link] ?? 2) || Date.parse(b.published_at) - Date.parse(a.published_at))
      .forEach(r => {
        const list = players[r.player_id];
        if (!list || list.length >= PER_PLAYER) return;
        const { player_id: _pid, ...item } = r;
        list.push(item);
      });
    Object.values(players).forEach(list => (list as Array<Record<string, string>>).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at)));
    const asOf = (meta as Array<{ data?: { fetched_at?: string } }>)[0]?.data?.fetched_at || null;
    return json({ as_of: asOf, days, players });
  } catch (e) {
    return json({ error: 'news unavailable', detail: String((e as Error).message || e) }, 503, 'no-store');
  }
});

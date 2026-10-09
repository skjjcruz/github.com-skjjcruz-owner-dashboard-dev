// Live bits from Sleeper, fetched at answer time.
//
// The engine rebuilds every two hours, which is fine for dynasty values and
// stale for game day. Three small public feeds fill the gap: this week's
// NFL scoreboard (has a game started, is it over), the league's matchups
// (lineup as set right now, live points per player) and per-player lookups
// (injury designation, depth chart). Every call is short, memoised for a
// few seconds inside the function, and never fails a tool: if Sleeper is
// slow, the cached value is used and live_as_of says so.
const APP = 'https://api.sleeper.app/v1';

export type GameLive = { opp: string; home: boolean; started: boolean; in_progress: boolean; over: boolean; kick: number; score?: string; clock?: string };
export type MatchupRow = { roster_id: number; matchup_id: number | null; points: number; starters: string[]; players: string[]; players_points: Record<string, number> };
export type PlayerFresh = { inj: string | null; injp: string | null; st: string | null; dc: string | null; dco: number | null; t: string | null; news_updated: number | null };
export type LiveState = { at: string; scores?: Record<string, GameLive>; matchups: Record<string, MatchupRow[]>; injuries: Record<string, PlayerFresh>; failed: string[] };

const memo = new Map<string, { at: number; v: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.v as Promise<T>;
  const v = fn();
  memo.set(key, { at: Date.now(), v });
  return v;
}
async function getJson(url: string, ms = 1500): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}

// This week's games by team: {DAL: {opp: 'TB', started, over, ...}, TB: {...}}
export function liveScores(season: string, week: number): Promise<Record<string, GameLive>> {
  return cached('scores/' + season + '/' + week, 15_000, async () => {
    const games = await getJson(APP + '/scores/nfl/regular/' + season + '/' + week) as Array<{ status: string; start_time: number; metadata: Record<string, unknown> }>;
    const out: Record<string, GameLive> = {};
    for (const g of games || []) {
      const m = g.metadata || {};
      const h = String(m.home_team || ''), a = String(m.away_team || '');
      if (!h || !a) continue;
      const started = !!m.has_started || (!!g.status && g.status !== 'pre_game');
      const base = { started, in_progress: !!m.is_in_progress, over: !!m.is_over, kick: Number(g.start_time) || 0 };
      const score = started ? h + ' ' + (m.home_score ?? 0) + '–' + a + ' ' + (m.away_score ?? 0) : undefined;
      const clock = base.in_progress ? 'Q' + (m.quarter_num || '?') + ' ' + (m.time_remaining || '') : undefined;
      out[h] = { ...base, opp: a, home: true, score, clock };
      out[a] = { ...base, opp: h, home: false, score, clock };
    }
    return out;
  });
}

// The league's matchups right now: lineup as set, live points per player.
export function liveMatchups(leagueId: string, week: number): Promise<MatchupRow[]> {
  return cached('matchups/' + leagueId + '/' + week, 30_000, async () => (await getJson(APP + '/league/' + leagueId + '/matchups/' + week) as MatchupRow[]) || []);
}

// Fresh injury designation and depth chart for a handful of players.
export async function livePlayers(pids: string[]): Promise<Record<string, PlayerFresh>> {
  const out: Record<string, PlayerFresh> = {};
  const want = [...new Set(pids)].filter(p => /^\d+$/.test(p)).slice(0, 24);
  let i = 0;
  const worker = async () => {
    while (i < want.length) {
      const pid = want[i++];
      try {
        const p = await cached('player/' + pid, 120_000, () => getJson(APP + '/players/nfl/' + pid, 1200)) as Record<string, unknown> | null;
        if (p && typeof p === 'object') out[pid] = { inj: (p.injury_status as string) || null, injp: (p.injury_body_part as string) || null, st: (p.status as string) || null, dc: (p.depth_chart_position as string) || null, dco: p.depth_chart_order == null ? null : Number(p.depth_chart_order), t: (p.team as string) || null, news_updated: p.news_updated == null ? null : Number(p.news_updated) };
      } catch { /* keep the cached row for this player */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, want.length) }, worker));
  return out;
}

// Pull everything a game-day answer needs, in parallel, into one state.
export async function fetchLive(prev: LiveState | undefined, leagueId: string | null, season: string, week: number, pids: string[]): Promise<LiveState> {
  const live: LiveState = prev || { at: new Date().toISOString(), matchups: {}, injuries: {}, failed: [] };
  const jobs: Array<Promise<void>> = [];
  if (!live.scores && !live.failed.includes('scores')) jobs.push(liveScores(season, week).then(s => { live.scores = s; }, () => { live.failed.push('scores'); }));
  if (leagueId && !live.matchups[leagueId] && !live.failed.includes('matchups:' + leagueId)) jobs.push(liveMatchups(leagueId, week).then(m => { live.matchups[leagueId] = m; }, () => { live.failed.push('matchups:' + leagueId); }));
  const need = pids.filter(p => !(p in live.injuries));
  if (need.length) jobs.push(livePlayers(need).then(f => { Object.assign(live.injuries, f); }, () => { live.failed.push('players'); }));
  await Promise.allSettled(jobs);
  return live;
}

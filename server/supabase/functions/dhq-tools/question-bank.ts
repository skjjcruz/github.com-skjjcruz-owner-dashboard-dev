// The question bank: real questions members ask, each with the facts a good
// answer must contain. Runs the tools over the builder's dry-run output and
// fails the deploy when a required fact is missing. Add a question every
// time an answer goes wrong, so the same mistake cannot ship twice.
//
//   LEAGUES=1312100327931019264 node server/engine/run.js --dry
//   deno run --allow-read --allow-env --allow-net server/supabase/functions/dhq-tools/question-bank.ts
import './vendor/trade-engine.js';
import { runTool, type Ctx, type LeagueRow } from './tools.ts';

const OUT = new URL('../../../engine/out/', import.meta.url);
const rd = (n: string) => { try { return JSON.parse(Deno.readTextFileSync(new URL(n, OUT))); } catch { return undefined; } };
const files = [...Deno.readDirSync(OUT)].map(e => e.name).filter(n => /^\d+\.json$/.test(n));
if (!files.length) { console.error('no dry-run output in server/engine/out'); Deno.exit(1); }
const rows: LeagueRow[] = files.map(n => JSON.parse(Deno.readTextFileSync(new URL(n, OUT))));
const memberId = Deno.env.get('MEMBER') || '540392203863576576';
// deno-lint-ignore no-explicit-any
const te = (globalThis as any).App.TradeEngine;
const ctx: Ctx = {
  memberId, leagues: rows.filter(L => L.snapshot.rosters.some(r => r.owner_id === memberId)), players: rd('players.json') || {},
  nflState: rows[0].snapshot.nfl_state, trending: [], nflWeek: rd('nfl_week.json'), news: rd('news.json'), te,
  loadLeague: async id => rows.find(L => L.league_id === id) || null,
};
const L = ctx.leagues.find(x => x.league_id === '1312100327931019264') || ctx.leagues[0];
const lid = L.league_id;
const wk = Number(L.snapshot.proj_week) || 0;
// deno-lint-ignore no-explicit-any
type Any = any;
type Q = { q: string; tool: string; args: Record<string, unknown>; must: (r: Any) => string[] };
const miss = (cond: unknown, what: string) => (cond ? [] : [what]);
const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);

// A player on a team that already played this week, and one still to play,
// picked from the data so the bank keeps working as the season moves on.
const playedTeam = Object.entries(ctx.nflWeek?.games || {}).find(([, g]) => g.played)?.[0];
const upcomingTeam = Object.entries(ctx.nflWeek?.games || {}).find(([, g]) => !g.played)?.[0];
const starterOn = (team: string | undefined) => {
  if (!team) return undefined;
  const all = L.snapshot.rosters.flatMap(r => (r.starters || []).concat(r.players || [])).map(String);
  const onTeam = all.filter(pid => ctx.players[pid] && ctx.players[pid].t === team);
  return onTeam.find(pid => ((L.snapshot.games || {})[pid] || [])[wk - 1] != null) || onTeam.find(pid => L.snapshot.proj && L.snapshot.proj[pid] != null);
};
const playedPid = starterOn(playedTeam), upcomingPid = starterOn(upcomingTeam);

const BANK: Q[] = [
  { q: 'Which leagues am I in?', tool: 'list_leagues', args: {}, must: r => [
    ...miss(Array.isArray(r.leagues) && r.leagues.length >= 1, 'lists at least one league'),
    ...miss(r.leagues.some((l: Any) => l.league_id === lid), 'includes the test league'),
    ...miss(r.leagues.every((l: Any) => l.format && l.my_team), 'each league shows format and my team'),
  ] },
  { q: 'Tell me about a player (dynasty and this season must be separate numbers)', tool: 'get_player', args: { player: 'Chig Okonkwo', league_id: lid }, must: r => [
    ...miss(num(r.dhq_value), 'dhq_value present'),
    ...miss(r.ppg === undefined, 'no bare "ppg" field (it was mistaken for current form)'),
    ...miss('proj_this_week' in r || 'scored_this_week' in r, 'this week shown as projection or actual'),
    ...miss(typeof r.game_log === 'string' || r.season_games === undefined, 'game log present when games exist'),
    ...miss(r.nfl_opponent !== undefined, 'NFL opponent or BYE shown'),
    ...miss(r.team_news === undefined || Array.isArray(r.team_news), 'team news is a list'),
  ] },
  { q: 'Projections for several players, including one who already played', tool: 'get_weekly_projections', args: { league_id: lid, players: [playedPid, upcomingPid].filter(Boolean) }, must: r => {
    const played = r.players.find((p: Any) => p.id === playedPid), up = r.players.find((p: Any) => p.id === upcomingPid);
    return [
      ...miss(r.week === wk, 'week matches the NFL week'),
      ...miss(typeof r.before_you_answer === 'string' && /news/i.test(r.before_you_answer), 'tells the AI to read the news first'),
      ...miss(!playedPid || (played && played.proj_this_week === undefined && /ALREADY PLAYED|DID NOT PLAY/.test(played.this_week || '')), 'a player whose game happened shows actual points and is locked, not a projection'),
      ...miss(!upcomingPid || (up && (up.proj_this_week === null || num(up.proj_this_week)) && up.game_status === 'upcoming'), 'a player still to play shows a projection and upcoming status'),
      ...miss(r.players.every((p: Any) => p.nfl_opponent !== undefined), 'every player shows his NFL opponent'),
    ];
  } },
  { q: 'My matchup this week', tool: 'get_my_matchup', args: { league_id: lid }, must: r => [
    ...miss(r.opponent && r.my_lineup && r.my_lineup.length > 0, 'opponent and my lineup present'),
    ...miss(num(r.my_projected_total) && num(r.their_projected_total), 'both totals present'),
    ...miss(!r.bench_projected_above_a_starter_at_same_position.some((b: Any) => b.scored_this_week != null), 'bench suggestions never include a locked player'),
    ...miss(/actual points/.test(r.totals_note || ''), 'totals note explains actual vs projected'),
  ] },
  { q: 'Grade a trade', tool: 'evaluate_trade', args: { league_id: lid, give: ['Jonathan Taylor'], get: ['Puka Nacua'] }, must: r => [
    ...miss(typeof r.fairness === 'string' && r.fairness.length > 0, 'a fairness verdict is stated'),
    ...miss(num(r.acceptance_chance_pct), 'acceptance chance stated'),
    ...miss(r.their_posture && r.my_needs, 'partner posture and my needs considered'),
    ...miss(JSON.stringify(r).includes('Taylor') && JSON.stringify(r).includes('Nacua'), 'both players named'),
  ] },
  { q: 'Who is a good waiver add at RB?', tool: 'get_waiver_options', args: { league_id: lid, position: 'RB', limit: 5 }, must: r => [
    ...miss(Array.isArray(r.best_available) && r.best_available.length > 0, 'a list of the best available'),
    ...miss(r.best_available.every((p: Any) => p.pos === 'RB'), 'only the asked position'),
    ...miss(num(r.faab_left), 'FAAB left stated'),
  ] },
  { q: 'What are this league\'s pick values?', tool: 'get_pick_values', args: { league_id: lid }, must: r => [
    ...miss(r.value_by_round && Object.keys(r.value_by_round).length > 0, 'values by round'),
  ] },
  { q: 'An unknown league is refused clearly', tool: 'get_team', args: { league_id: 'nope' }, must: () => ['should have thrown'] },
];

let failed = 0;
for (const t of BANK) {
  let r: Any, errMsg = '';
  try { r = await runTool(ctx, t.tool, t.args); } catch (e) { errMsg = (e as Error).message; }
  const problems = errMsg ? (t.must.toString().includes("'should have thrown'") ? [] : ['tool error: ' + errMsg]) : t.must(r);
  if (problems.length) { failed++; console.log('✗ ' + t.q + '  [' + t.tool + ']'); problems.forEach(p => console.log('    missing: ' + p)); }
  else console.log('✓ ' + t.q);
}
console.log('\n' + (BANK.length - failed) + '/' + BANK.length + ' questions answered with every required fact' + (playedPid ? '' : ' (no team has played yet this week, so the locked-player check was skipped)'));
if (failed) Deno.exit(1);

// Local check for the tools over the builder's dry-run output:
//   LEAGUES=<id> node server/engine/run.js --dry     (writes server/engine/out/*.json)
//   deno run --allow-read server/supabase/functions/dhq-tools/local-test.ts
// Needs vendor/trade-engine.js (see engine-deploy.yml for how it is made).
import './vendor/trade-engine.js';
import { TOOL_DEFS, runTool, type Ctx, type LeagueRow } from './tools.ts';

const OUT = new URL('../../../engine/out/', import.meta.url);
const files = [...Deno.readDirSync(OUT)].map(e => e.name).filter(n => /^\d+\.json$/.test(n));
if (!files.length) { console.error('no dry-run output in server/engine/out'); Deno.exit(1); }
const rows: LeagueRow[] = files.map(n => JSON.parse(Deno.readTextFileSync(new URL(n, OUT))));
const players = JSON.parse(Deno.readTextFileSync(new URL('players.json', OUT)));
const memberId = Deno.env.get('MEMBER') || '540392203863576576';
// deno-lint-ignore no-explicit-any
const te = (globalThis as any).App.TradeEngine;
const ctx: Ctx = {
  memberId, leagues: rows.filter(L => L.snapshot.rosters.some(r => r.owner_id === memberId)), players, nflState: rows[0].snapshot.nfl_state, trending: [], te,
  loadLeague: async id => rows.find(L => L.league_id === id) || null,
};
const psycho = ctx.leagues.find(L => L.league_id === '1312100327931019264') || ctx.leagues[0];
const lid = psycho.league_id;
const calls: Array<[string, Record<string, unknown>]> = [
  ['list_leagues', {}], ['get_league', { league_id: lid }], ['get_team', { league_id: lid }], ['get_team', { league_id: lid, roster_id: 7 }],
  ['find_players', { name: 'puka', league_id: lid }], ['get_player', { player: 'Jonathan Taylor', league_id: lid }],
  ['evaluate_trade', { league_id: lid, give: ['Jonathan Taylor', '2027 1st'], get: ['Puka Nacua'] }],
  ['get_owner_profile', { league_id: lid, roster_id: 7 }], ['get_recent_trades', { league_id: lid, days: 14 }],
  ['get_waiver_options', { league_id: lid, position: 'RB', limit: 5 }], ['get_pick_values', { league_id: lid, roster_id: psycho.snapshot.rosters.find(r => r.owner_id === memberId)!.roster_id }],
  ['get_player', { player: 'Chig Okonkwo', league_id: lid }],
  ['get_weekly_projections', { league_id: lid, players: ['Chig Okonkwo', 'Jonathan Taylor', 'nobody here'] }],
  ['get_my_matchup', { league_id: lid }],
  ['get_team', { league_id: 'nope' }],
];
console.log('tools:', TOOL_DEFS.map(t => t.name).join(', '));
for (const [name, args] of calls) {
  const t0 = performance.now();
  try {
    const r = await runTool(ctx, name, args);
    const s = JSON.stringify(r);
    console.log('\n== ' + name + ' ' + JSON.stringify(args) + ' → ' + s.length + ' chars in ' + (performance.now() - t0).toFixed(0) + 'ms\n' + s.slice(0, 700));
  } catch (e) { console.log('\n== ' + name + ' ' + JSON.stringify(args) + ' → ERROR ' + (e as Error).message); }
}

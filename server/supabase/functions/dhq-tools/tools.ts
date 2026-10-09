// dhq-tools/tools.ts — the DHQ tools, computed over what the engine builder
// stored (league_intel, engine_cache). Pure: everything comes in through
// `Ctx`, nothing here talks to the network, so it is testable with the
// builder's dry-run JSON. The trade math is the engine's own trade-engine.js
// (vendored at deploy time), passed in as `te`.

export interface PlayerSlim { n: string; pos: string; fp?: string[]; t: string | null; age: number | null; yrs: number | null; st: string | null; inj: string | null; injp: string | null; dc: string | null; dco: number | null; col: string | null; num: number | null; act: boolean }
export interface Roster { roster_id: number; owner_id: string; co_owners: string[] | null; players: string[]; starters: string[]; reserve: string[]; taxi: string[]; settings: Record<string, number>; metadata: { team_name?: string } | null }
export interface User { user_id: string; display_name: string; avatar: string | null; team_name: string | null; team_avatar: string | null }
export interface Pick { year: number; round: number; from: number; value: number }
export interface LeagueRow {
  league_id: string; season: string; name: string; built_at: string; engine_version: string;
  intel: Record<string, any>; assessments: any[]; dna: Record<string, any>;
  snapshot: { league: any; rosters: Roster[]; users: User[]; traded_picks: any[]; matchups: any[]; nfl_state: any; picks?: Record<string, Pick[]>; games?: Record<string, Array<number | null>>; proj?: Record<string, number>; proj_week?: number };
}
export interface TradeEngine {
  fairnessGrade(give: number, get: number): { grade: string; label: string };
  calcOwnerPosture(assessment: any, dnaKey: string): { key: string; label: string; desc: string };
  calcPsychTaxes(mine: any, theirs: any, dnaKey: string, posture: any): Array<{ name: string; impact: number; desc: string }>;
  calcAcceptanceLikelihood(give: number, get: number, dnaKey: string, taxes: any[], mine: any, theirs: any, opts: any): number;
  calcComplementarity(mine: any, theirs: any): number;
}
export interface Ctx {
  memberId: string;                       // Sleeper user id behind the key
  leagues: LeagueRow[];                   // every stored league this member is in (intel may be omitted for listing)
  loadLeague(id: string): Promise<LeagueRow | null>;
  players: Record<string, PlayerSlim>;
  nflState: any;
  trending: Array<{ player_id: string; count: number }>;
  nflWeek?: { week: number; games: Record<string, { opp: string; date: string | null }> };   // who each NFL team plays this week
  te: TradeEngine;
}

export class ToolError extends Error {}

const round1 = (n: unknown) => Math.round(Number(n || 0) * 10) / 10;
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ord = (n: number) => n + (['th', 'st', 'nd', 'rd'][(n % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th');

// ── league helpers ─────────────────────────────────────────────────
function myRoster(L: LeagueRow, memberId: string): Roster | null {
  return L.snapshot.rosters.find(r => r.owner_id === memberId || (r.co_owners || []).includes(memberId)) || null;
}
function rosterOf(L: LeagueRow, rid: unknown): Roster | null {
  return L.snapshot.rosters.find(r => String(r.roster_id) === String(rid)) || null;
}
function userOf(L: LeagueRow, r: Roster | null): User | null {
  return r ? (L.snapshot.users.find(u => u.user_id === r.owner_id) || null) : null;
}
function teamName(L: LeagueRow, rid: unknown): string {
  const r = rosterOf(L, rid); const u = userOf(L, r);
  return (r && r.metadata && r.metadata.team_name) || (u && (u.team_name || u.display_name)) || ('Team ' + rid);
}
function ownerName(L: LeagueRow, rid: unknown): string { const u = userOf(L, rosterOf(L, rid)); return u ? u.display_name : ''; }
function dhq(L: LeagueRow, pid: string): number { const v = (L.intel.playerScores || {})[pid]; return v > 0 ? Math.round(v) : 0; }
function whoRosters(L: LeagueRow, pid: string): number | null { const r = L.snapshot.rosters.find(x => (x.players || []).includes(pid)); return r ? r.roster_id : null; }
function assessOf(L: LeagueRow, rid: unknown) { return (L.assessments || []).find(a => String(a.rosterId) === String(rid)) || null; }
function assessBrief(a: any) {
  if (!a) return null;
  return {
    tier: a.tier, window: a.window, health_score: a.healthScore, power_rank: a.powerRank,
    needs: (a.needs || []).map((n: any) => n.pos + (n.urgency ? ' (' + n.urgency + ')' : '')),
    strengths: a.strengths || [], faab_left: a.faabRemaining ?? undefined,
  };
}
function leagueFormat(L: LeagueRow) {
  const lg = L.snapshot.league; const sc = lg.scoring_settings || {}; const pos: string[] = lg.roster_positions || [];
  const starters = pos.filter(p => !['BN', 'IR', 'TAXI'].includes(p));
  return {
    superflex: pos.includes('SUPER_FLEX'), ppr: Number(sc.rec || 0), te_premium: Number(sc.bonus_rec_te || 0),
    idp: starters.some(p => /^(DL|LB|DB|IDP_FLEX|DE|DT|CB|S)$/.test(p)), starting_slots: starters, teams: L.snapshot.rosters.length,
    faab_budget: Number((lg.settings || {}).waiver_budget || 0) || null, playoff_teams: Number((lg.settings || {}).playoff_teams || 0) || null,
    playoff_week_start: Number((lg.settings || {}).playoff_week_start || 0) || null, taxi_slots: Number((lg.settings || {}).taxi_slots || 0) || 0,
    draft_rounds: Number((lg.settings || {}).draft_rounds || 0) || null,
  };
}
function standings(L: LeagueRow, memberId: string) {
  const me = myRoster(L, memberId);
  return L.snapshot.rosters.map(r => {
    const s = r.settings || {}; const a = assessOf(L, r.roster_id);
    return { roster_id: r.roster_id, team: teamName(L, r.roster_id), owner: ownerName(L, r.roster_id), wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0, points_for: round1((s.fpts || 0) + (s.fpts_decimal || 0) / 100), tier: a ? a.tier : undefined, power_rank: a ? a.powerRank : undefined, mine: me && me.roster_id === r.roster_id ? true : undefined };
  }).sort((a, b) => b.wins - a.wins || b.points_for - a.points_for).map((t, i) => ({ standing: i + 1, ...t }));
}
function playerRow(ctx: Ctx, L: LeagueRow | null, pid: string, extra?: Record<string, unknown>) {
  const p = ctx.players[pid] || ({} as Partial<PlayerSlim>); const m = L ? ((L.intel.playerMeta || {})[pid] || {}) : {};
  const row: Record<string, unknown> = { id: pid, name: p.n || pid, pos: m.pos || p.pos || '', nfl_team: p.t || 'FA', age: p.age ?? m.age ?? null };
  if (L) row.dhq_value = dhq(L, pid);
  if (m.ppg != null) row.dhq_rate_ppg = round1(m.ppg);
  if (L) Object.assign(row, seasonBits(L, pid));
  if (m.peakYrsLeft != null) row.peak_years_left = m.peakYrsLeft;
  if (m.ageCurvePhase) row.age_phase = m.ageCurvePhase;
  if (m.trend) row.value_trend_pct = m.trend;
  if (m.roleLabel) row.role = m.roleLabel;
  if (p.inj) row.injury = p.inj + (p.injp ? ' (' + p.injp + ')' : '');
  if (p.dc && p.dco != null) row.depth_chart = p.dc + ' #' + p.dco;
  Object.assign(row, gameBits(ctx, p.t));
  return Object.assign(row, extra || {});
}
// This week's NFL game for a team: opponent and date, or BYE.
function gameBits(ctx: Ctx, team: string | null | undefined): { nfl_opponent?: string; game_date?: string | null } {
  if (!ctx.nflWeek || !team) return {};
  const g = ctx.nflWeek.games[team];
  return g ? { nfl_opponent: g.opp, game_date: g.date } : { nfl_opponent: 'BYE' };
}
// This season so far and this week, in the league's scoring.
function seasonBits(L: LeagueRow, pid: string) {
  const out: Record<string, unknown> = {};
  const log = (L.snapshot.games || {})[pid];
  if (log) {
    const played = log.filter((x): x is number => x != null);
    out.season_games = played.length;
    out.season_avg = played.length ? round1(played.reduce((t, x) => t + x, 0) / played.length) : null;
    out.game_log = log.map((x, i) => 'W' + (i + 1) + ' ' + (x == null ? 'DNP' : round1(x))).join(', ');
  }
  const pr = (L.snapshot.proj || {})[pid];
  if (pr != null) out.proj_this_week = round1(pr);
  else if (L.snapshot.proj_week) out.proj_this_week = null;
  return out;
}
function compactRow(x: Record<string, any>): string {
  return [
    x.name + ' ' + x.pos + ' ' + x.nfl_team, x.age != null ? 'age ' + x.age : '',
    x.dhq_value != null ? 'DHQ ' + x.dhq_value + (x.league_rank ? ' (#' + x.league_rank + ', ' + x.pos + x.pos_rank + ')' : '') : '',
    x.nfl_opponent ? (x.nfl_opponent === 'BYE' ? 'BYE this wk' : 'vs ' + x.nfl_opponent) : '',
    x.proj_this_week != null ? 'this wk proj ' + x.proj_this_week : (x.proj_this_week === null ? 'this wk: no projection' : ''),
    x.season_games != null ? 'season ' + x.season_avg + ' avg (' + x.season_games + ' gp)' : 'season: no games',
    x.peak_years_left != null ? x.peak_years_left + ' peak yrs, ' + (x.age_phase || '') : '',
    x.value_trend_pct ? 'trend ' + (x.value_trend_pct > 0 ? '+' : '') + x.value_trend_pct + '%' : '', x.injury ? 'INJ ' + x.injury : '', x.slot || '',
  ].filter(Boolean).join(' | ');
}
function leagueRank(L: LeagueRow, pid: string) {
  const rostered = new Set<string>(); L.snapshot.rosters.forEach(r => r.players.forEach(x => rostered.add(x)));
  const all = Object.entries(L.intel.playerScores || {}).filter(([id]) => rostered.has(id)).sort((a, b) => (b[1] as number) - (a[1] as number));
  const overall = all.findIndex(([id]) => id === pid) + 1;
  const pos = ((L.intel.playerMeta || {})[pid] || {}).pos;
  const posRank = all.filter(([id]) => ((L.intel.playerMeta || {})[id] || {}).pos === pos).findIndex(([id]) => id === pid) + 1;
  return overall ? { overall, pos: posRank } : null;
}
function findPlayers(ctx: Ctx, L: LeagueRow | null, q: unknown, limit = 5): string[] {
  const s = String(q || '').trim(); if (!s) return [];
  if (/^\d+$/.test(s) && ctx.players[s]) return [s];
  const n = norm(s);
  const rostered = new Set<string>(); if (L) L.snapshot.rosters.forEach(r => r.players.forEach(x => rostered.add(x)));
  const hits: Array<{ pid: string; score: number; ros: number; v: number }> = [];
  for (const pid in ctx.players) {
    const p = ctx.players[pid]; const full = norm(p.n); if (!full) continue;
    const last = norm(p.n.split(' ').slice(-1)[0]);
    let score = 0;
    if (full === n) score = 3; else if (full.startsWith(n) || last === n) score = 2; else if (n.length >= 4 && full.includes(n)) score = 1;
    if (score) hits.push({ pid, score, ros: rostered.has(pid) ? 1 : 0, v: L ? dhq(L, pid) : (p.act ? 1 : 0) });
  }
  hits.sort((a, b) => b.score - a.score || b.ros - a.ros || b.v - a.v);
  return hits.slice(0, limit).map(h => h.pid);
}
const resolveOne = (ctx: Ctx, L: LeagueRow | null, q: unknown) => findPlayers(ctx, L, q, 1)[0] || null;
function pickLabel(pk: Pick, holder: number, L: LeagueRow) { return pk.year + ' ' + ord(pk.round) + (pk.from !== holder ? ' (from ' + teamName(L, pk.from) + ')' : ''); }

// Which league a tool means: the given id, else the member's only league.
async function league(ctx: Ctx, args: any): Promise<LeagueRow> {
  const id = args && args.league_id != null ? String(args.league_id) : '';
  if (id) {
    const row = await ctx.loadLeague(id);
    if (!row) throw new ToolError('No league ' + id + ' is connected for you. Call list_leagues.');
    return row;
  }
  if (ctx.leagues.length === 1) return (await ctx.loadLeague(ctx.leagues[0].league_id))!;
  throw new ToolError('Which league? Pass league_id — call list_leagues to see them.');
}

// ── the tools ──────────────────────────────────────────────────────
export const TOOL_DEFS = [
  def('list_leagues', 'The member\'s connected leagues: id, name, format, their team and record, and when the DHQ numbers were last refreshed. Call this first when league_id is unknown.', {}),
  def('get_league', 'League basics: scoring format (superflex, PPR, TE premium, IDP), starting slots, FAAB, playoff setup, NFL week, and full standings with each team\'s DHQ tier and power rank.', { league_id: S('League id') }),
  def('get_team', 'A team\'s roster with each player\'s DHQ dynasty value, league rank, age, points per game, peak years left, injury and lineup slot; their draft picks with values; record, tier, window, needs, strengths and FAAB. Omit roster_id for the member\'s own team.', { league_id: S('League id'), roster_id: N('Roster id from standings; omit for my team') }),
  def('find_players', 'Search NFL players by name. Returns ids, position, team, DHQ value in the league and who rosters them.', { name: S('Full or partial name'), league_id: S('League id (optional, for values)') }, ['name']),
  def('get_player', 'One player in depth: bio, NFL team, depth chart, injury, DHQ value and trend, age curve, role, league rank, who rosters him, and his trade history in this league.', { player: S('Player name or id'), league_id: S('League id') }, ['player']),
  def('evaluate_trade', 'Grade a trade with the DHQ trade engine. Sides take players (names/ids) and picks written like "2027 1st". Returns each piece\'s value, totals, fairness grade, the chance the other owner accepts (their DNA and needs), the psychology behind it, and roster fit.', { league_id: S('League id'), give: A('What the member sends'), get: A('What the member receives'), partner_roster_id: N('Other team\'s roster id (optional; inferred from the players received)') }, ['give', 'get']),
  def('get_owner_profile', 'An owner\'s trading personality from the league\'s full trade history: DNA type and why, trade count, value wins/losses, positions bought and sold, favorite partners, timing, and recent deals.', { league_id: S('League id'), roster_id: N('Roster id') }, ['roster_id']),
  def('get_recent_trades', 'Completed trades in the league, newest first, with what each side got and who won on DHQ value.', { league_id: S('League id'), days: N('Look-back window in days (default 30)'), roster_id: N('Only trades involving this roster (optional)') }),
  def('get_waiver_options', 'Best available free agents by DHQ value, Sleeper\'s trending adds, the member\'s FAAB left, and what this league usually pays by position.', { league_id: S('League id'), position: S('QB, RB, WR, TE, K, DL, LB, DB (optional)'), limit: N('How many (default 8, max 15)') }),
  def('get_pick_values', 'What draft picks are worth in this league (DHQ pick values by round and slot), plus who owns which picks.', { league_id: S('League id'), roster_id: N('Only this roster\'s picks (optional)') }),
  def('get_weekly_projections', 'START/SIT: this week\'s Sleeper projection for each player in this league\'s scoring, with injury status and this season\'s game log. Use this (not dynasty value or long-run rates) to decide who to start, and always include every player being compared so you never have to send the member elsewhere for a number. Then search the web for the last week of news on each player and his team (play-caller, coaching or QB changes, teammate injuries, role changes, weather) and lead with the biggest item.', { league_id: S('League id'), players: A('Player names or ids (up to 20)') }, ['players']),
  def('get_my_matchup', 'This week\'s head-to-head matchup for the member: opponent, both set lineups with each starter\'s projection and injury, projected totals, and the bench players projected higher than a starter. Then search the web for the last week of news on the players in question and lead with the biggest item.', { league_id: S('League id') }),
];
function def(name: string, description: string, properties: Record<string, unknown>, required: string[] = []) {
  return { name, description, inputSchema: { type: 'object', properties, required }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
}
function S(d: string) { return { type: 'string', description: d }; }
function N(d: string) { return { type: 'number', description: d }; }
function A(d: string) { return { type: 'array', items: { type: 'string' }, description: d }; }

export async function runTool(ctx: Ctx, name: string, args: any): Promise<unknown> {
  args = args || {};
  switch (name) {
    case 'list_leagues': return listLeagues(ctx);
    case 'get_league': return getLeague(ctx, await league(ctx, args));
    case 'get_team': return getTeam(ctx, await league(ctx, args), args);
    case 'find_players': return findPlayersTool(ctx, args);
    case 'get_player': return getPlayer(ctx, args);
    case 'evaluate_trade': return evaluateTrade(ctx, await league(ctx, args), args);
    case 'get_owner_profile': return ownerProfile(ctx, await league(ctx, args), args);
    case 'get_recent_trades': return recentTrades(ctx, await league(ctx, args), args);
    case 'get_waiver_options': return waiverOptions(ctx, await league(ctx, args), args);
    case 'get_pick_values': return pickValues(ctx, await league(ctx, args), args);
    case 'get_weekly_projections': return weeklyProjections(ctx, await league(ctx, args), args);
    case 'get_my_matchup': return myMatchup(ctx, await league(ctx, args));
    default: throw new ToolError('Unknown tool ' + name);
  }
}

function listLeagues(ctx: Ctx) {
  return {
    member_sleeper_user_id: ctx.memberId, nfl_week: ctx.nflState?.display_week || ctx.nflState?.week,
    leagues: ctx.leagues.map(L => {
      const me = myRoster(L, ctx.memberId); const s = (me && me.settings) || {}; const f = leagueFormat(L); const a = me ? assessOf(L, me.roster_id) : null;
      return { league_id: L.league_id, name: L.name, season: L.season, teams: f.teams, format: [f.superflex ? 'superflex' : '1QB', f.ppr ? f.ppr + ' PPR' : 'standard', f.te_premium ? 'TE premium' : '', f.idp ? 'IDP' : ''].filter(Boolean).join(', '), status: L.snapshot.league.status,
        my_team: me ? teamName(L, me.roster_id) : null, my_roster_id: me ? me.roster_id : null, record: me ? (s.wins || 0) + '-' + (s.losses || 0) + (s.ties ? '-' + s.ties : '') : null, tier: a ? a.tier : undefined, power_rank: a ? a.powerRank : undefined, numbers_as_of: L.built_at };
    }),
  };
}
function getLeague(ctx: Ctx, L: LeagueRow) {
  const me = myRoster(L, ctx.memberId);
  return { league_id: L.league_id, league: L.name, season: L.season, status: L.snapshot.league.status, nfl_week: L.snapshot.nfl_state?.week, format: leagueFormat(L), my_roster_id: me ? me.roster_id : null, my_team: me ? teamName(L, me.roster_id) : null, standings: standings(L, ctx.memberId), numbers_as_of: L.built_at };
}
function getTeam(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  const rid = args.roster_id != null ? args.roster_id : (me ? me.roster_id : null);
  const r = rosterOf(L, rid);
  if (!r) throw new ToolError('No roster ' + rid + ' in ' + L.name + '. Use get_league for roster ids.');
  const starters = new Set(r.starters || []), ir = new Set(r.reserve || []), taxi = new Set(r.taxi || []);
  const rows = (r.players || []).map(pid => { const lr = leagueRank(L, pid); return playerRow(ctx, L, pid, { slot: starters.has(pid) ? 'starter' : ir.has(pid) ? 'IR' : taxi.has(pid) ? 'taxi' : 'bench', league_rank: lr ? lr.overall : undefined, pos_rank: lr ? lr.pos : undefined }); })
    .sort((a: any, b: any) => b.dhq_value - a.dhq_value);
  const picks = ((L.snapshot.picks || {})[String(r.roster_id)] || []).map(pk => pickLabel(pk, r.roster_id, L) + ' · DHQ ' + pk.value);
  const s = r.settings || {}; const a = assessOf(L, r.roster_id);
  return {
    league_id: L.league_id, roster_id: r.roster_id, team: teamName(L, r.roster_id), owner: ownerName(L, r.roster_id), is_mine: !!(me && me.roster_id === r.roster_id),
    record: (s.wins || 0) + '-' + (s.losses || 0) + (s.ties ? '-' + s.ties : ''), points_for: round1((s.fpts || 0) + (s.fpts_decimal || 0) / 100),
    assessment: assessBrief(a), total_dhq_value: rows.reduce((t: number, p: any) => t + p.dhq_value, 0),
    players_key: 'name pos NFL-team | age | DHQ dynasty value (league rank, position rank) | this week\'s NFL opponent (or BYE) | this week\'s Sleeper projection in this league\'s scoring | this season\'s average and games played | peak years left, age phase | value trend | injury | slot',
    players: rows.map(compactRow), picks, numbers_as_of: L.built_at,
  };
}
async function findPlayersTool(ctx: Ctx, args: any) {
  const L = args.league_id ? await ctx.loadLeague(String(args.league_id)) : (ctx.leagues.length === 1 ? await ctx.loadLeague(ctx.leagues[0].league_id) : null);
  return findPlayers(ctx, L, args.name, 6).map(pid => { const rid = L ? whoRosters(L, pid) : null; return playerRow(ctx, L, pid, { rostered_by: L ? (rid ? teamName(L, rid) + ' (roster ' + rid + ')' : 'free agent') : undefined }); });
}
async function getPlayer(ctx: Ctx, args: any) {
  const L = args.league_id ? await ctx.loadLeague(String(args.league_id)) : (ctx.leagues.length === 1 ? await ctx.loadLeague(ctx.leagues[0].league_id) : null);
  const pid = resolveOne(ctx, L, args.player);
  if (!pid) throw new ToolError('No player matches "' + args.player + '". Try find_players.');
  const p = ctx.players[pid]; const m = L ? ((L.intel.playerMeta || {})[pid] || {}) : {};
  const rid = L ? whoRosters(L, pid) : null; const lr = L ? leagueRank(L, pid) : null;
  const trades = L ? (L.intel.tradeHistory || []).filter((t: any) => Object.values(t.sides || {}).some((s: any) => (s.players || []).includes(pid))).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)).slice(0, 5) : [];
  return Object.assign(playerRow(ctx, L, pid), {
    rostered_by: L ? (rid ? teamName(L, rid) + ' (roster ' + rid + ')' : 'free agent') : undefined, league_rank: lr ? lr.overall : undefined, pos_rank: lr ? lr.pos : undefined,
    years_exp: p.yrs, college: p.col, status: p.st, last_season_ppg: m.lastYearPPG != null ? round1(m.lastYearPPG) : undefined, career_ppg: m.careerPPG != null ? round1(m.careerPPG) : undefined, games_recent: m.recentGP, status_note: m.statusReason || undefined,
    traded_in_this_league: L ? trades.map((t: any) => ({ date: t.ts ? new Date(t.ts).toISOString().slice(0, 10) : t.season, to: Object.entries(t.sides || {}).filter(([, s]: any) => (s.players || []).includes(pid)).map(([r]) => teamName(L, r))[0], value_then: Object.values(t.sides || {}).find((s: any) => (s.players || []).includes(pid)) && (Object.values(t.sides || {}).find((s: any) => (s.players || []).includes(pid)) as any).totalValue })) : undefined,
    numbers_as_of: L ? L.built_at : undefined,
  });
}
function evaluateTrade(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const picks = L.snapshot.picks || {}; const notes: string[] = [];
  const parsePick = (s: string) => { const m = String(s).match(/(20\d\d)\s*(?:round\s*|rd\s*|r)?(\d)(?:st|nd|rd|th)?/i); return m ? { year: Number(m[1]), round: Number(m[2]) } : null; };
  const side = (list: unknown[], holder: number | null) => (list || []).map(q => {
    const qs = String(q); const pk = /20\d\d/.test(qs) && !(/^\d+$/.test(qs) && ctx.players[qs]) ? parsePick(qs) : null;
    if (pk) {
      const own = holder != null ? (picks[String(holder)] || []).filter(x => x.year === pk.year && x.round === pk.round) : [];
      const use = own.find(x => x.from === holder) || own[0];
      if (!use) notes.push((holder != null ? teamName(L, holder) : 'That team') + ' does not own a ' + pk.year + ' ' + ord(pk.round) + '.');
      const value = use ? use.value : roundMidValue(L, pk.round);
      return { piece: use && holder != null ? pickLabel(use, holder, L) : pk.year + ' ' + ord(pk.round), type: 'pick', dhq_value: value };
    }
    const pid = resolveOne(ctx, L, qs);
    if (!pid) { notes.push('Could not find "' + qs + '".'); return null; }
    const owner = whoRosters(L, pid);
    if (holder != null && owner !== holder) notes.push(ctx.players[pid].n + ' is not on ' + teamName(L, holder) + (owner ? ' (he is on ' + teamName(L, owner) + ')' : ' (free agent)') + '.');
    return { piece: ctx.players[pid].n, type: 'player', pos: ctx.players[pid].pos, age: ctx.players[pid].age, dhq_value: dhq(L, pid) };
  }).filter(Boolean) as Array<{ piece: string; type: string; dhq_value: number }>;
  let partner: number | null = args.partner_roster_id != null ? Number(args.partner_roster_id) : null;
  if (partner == null) for (const q of (args.get || [])) { const pid = resolveOne(ctx, L, q); const o = pid ? whoRosters(L, pid) : null; if (o && o !== me.roster_id) { partner = o; break; } }
  const give = side(args.give, me.roster_id), get = side(args.get, partner);
  const giveV = give.reduce((t, x) => t + x.dhq_value, 0), getV = get.reduce((t, x) => t + x.dhq_value, 0);
  const out: Record<string, unknown> = { league_id: L.league_id, partner: partner != null ? teamName(L, partner) + ' (roster ' + partner + ')' : 'unknown', you_give: give, you_get: get, total_give: giveV, total_get: getV, net_for_you: getV - giveV, value_basis: 'Straight sum of DHQ values; the in-app Trade Builder also adjusts for roster spots and pick slots, so its grade can differ slightly.' };
  const fg = ctx.te.fairnessGrade(giveV, getV); out.fairness = fg.grade + ' — ' + fg.label;
  if (partner != null) {
    const mine = assessOf(L, me.roster_id), theirs = assessOf(L, partner), dna = (L.dna || {})[String(partner)];
    const key = dna && dna.key ? dna.key : 'NONE';
    const posture = ctx.te.calcOwnerPosture(theirs, key); const taxes = ctx.te.calcPsychTaxes(mine, theirs, key, posture) || [];
    out.their_dna = dna ? key + ' (' + dna.confidence + '% confidence): ' + (dna.reasoning || '') : 'Not enough trades to read their DNA.';
    out.their_posture = posture && posture.label ? posture.label + ' — ' + posture.desc : undefined;
    out.acceptance_chance_pct = ctx.te.calcAcceptanceLikelihood(giveV, getV, key, taxes, mine, theirs, { totalPieces: give.length + get.length });
    out.psychology = taxes.filter(t => t.impact).map(t => t.name + ' (' + (t.impact > 0 ? '+' : '') + t.impact + '): ' + t.desc);
    out.roster_fit_0_100 = ctx.te.calcComplementarity(mine, theirs);
    out.my_needs = assessBrief(mine)?.needs; out.their_needs = assessBrief(theirs)?.needs;
  }
  if (notes.length) out.notes = notes;
  out.numbers_as_of = L.built_at;
  return out;
}
function ownerProfile(ctx: Ctx, L: LeagueRow, args: any) {
  const rid = args.roster_id; if (!rosterOf(L, rid)) throw new ToolError('No roster ' + rid + ' in ' + L.name + '.');
  const pr = (L.intel.ownerProfiles || {})[String(rid)]; const dna = (L.dna || {})[String(rid)];
  const out: Record<string, unknown> = { league_id: L.league_id, roster_id: Number(rid), team: teamName(L, rid), owner: ownerName(L, rid) };
  if (dna) out.dna = { type: dna.key, confidence_pct: dna.confidence, why: dna.reasoning };
  if (pr) Object.assign(out, { style: pr.dna, trades_total: pr.trades, trades_won: pr.tradesWon, trades_lost: pr.tradesLost, trades_fair: pr.tradesFair, avg_value_edge: pr.avgValueDiff, favorite_target_pos: pr.targetPos, positions_bought: pr.posAcquired, positions_sold: pr.posSold, picks_bought: pr.picksAcquired, picks_sold: pr.picksSold, top_partners: Object.entries(pr.partners || {}).sort((a: any, b: any) => b[1] - a[1]).slice(0, 4).map(([r, n]) => teamName(L, r) + ' x' + n), week_timing: pr.weekTiming, season_activity: pr.seasonActivity });
  out.recent_trades = (recentTrades(ctx, L, { days: 400, roster_id: rid }) as any).trades.slice(0, 5);
  out.team_now = assessBrief(assessOf(L, rid));
  return out;
}
function recentTrades(ctx: Ctx, L: LeagueRow, args: any) {
  const days = Math.max(1, Math.min(1500, Number(args.days) || 30)); const since = Date.now() - days * 86400000;
  const rid = args.roster_id != null ? Number(args.roster_id) : null;
  const list = (L.intel.tradeHistory || []).filter((t: any) => (t.ts || 0) >= since && (rid == null || (t.roster_ids || []).includes(rid))).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0)).slice(0, 15);
  return { league_id: L.league_id, days, count: list.length, trades: list.map((t: any) => ({ date: t.ts ? new Date(t.ts).toISOString().slice(0, 10) : t.season + ' wk ' + t.week, sides: Object.entries(t.sides || {}).map(([r, s]: any) => ({ team: teamName(L, r), got: (s.players || []).map((pid: string) => (ctx.players[pid] || {}).n || pid).concat((s.picks || []).map((p: any) => p.season + ' ' + ord(p.round))), value_got: s.totalValue })), winner: t.winner != null ? teamName(L, t.winner) : 'even', value_gap_pct: t.valueDiffPct != null ? Math.round(t.valueDiffPct) : undefined })) };
}
function waiverOptions(ctx: Ctx, L: LeagueRow, args: any) {
  const pos = String(args.position || '').toUpperCase(); const limit = Math.max(1, Math.min(15, Number(args.limit) || 8));
  const rostered = new Set<string>(); L.snapshot.rosters.forEach(r => r.players.forEach(x => rostered.add(x)));
  const posOf = (pid: string) => ((L.intel.playerMeta || {})[pid] || {}).pos || (ctx.players[pid] || {}).pos;
  const pool = Object.keys(L.intel.playerScores || {}).filter(pid => !rostered.has(pid) && ctx.players[pid] && ctx.players[pid].t && ctx.players[pid].act).filter(pid => !pos || posOf(pid) === pos || (ctx.players[pid].fp || []).includes(pos)).sort((a, b) => dhq(L, b) - dhq(L, a)).slice(0, limit);
  const trending = (ctx.trending || []).map(x => String(x.player_id)).filter(pid => !rostered.has(pid) && ctx.players[pid] && (!pos || posOf(pid) === pos)).slice(0, 8).map(pid => ({ name: ctx.players[pid].n, pos: posOf(pid), nfl_team: ctx.players[pid].t, dhq_value: dhq(L, pid), adds_24h: ((ctx.trending || []).find(x => String(x.player_id) === pid) || { count: 0 }).count }));
  const me = myRoster(L, ctx.memberId); const a = me ? assessOf(L, me.roster_id) : null;
  const market = Object.fromEntries(Object.entries(L.intel.faabByPos || {}).map(([p, m]: any) => [p, { typical_bid: m.median, avg: Math.round(m.avg), p75: m.p75, bids_seen: m.count }]));
  return { league_id: L.league_id, faab_left: a ? a.faabRemaining : undefined, faab_min_bid: a ? a.faabMinBid : undefined, best_available: pool.map(pid => playerRow(ctx, L, pid)), trending_adds_on_sleeper: trending, what_this_league_pays_by_position: market, numbers_as_of: L.built_at };
}
// intel.dhqPickValues is keyed by OVERALL slot (1 = first pick of the draft).
function slotValue(L: LeagueRow, slot: number): number { return Math.round((((L.intel.dhqPickValues || {})[String(slot)] || {}).value) || 0); }
function roundMidValue(L: LeagueRow, round: number): number {
  const teams = L.snapshot.rosters.length || 12;
  return slotValue(L, (round - 1) * teams + Math.ceil(teams / 2));
}
function pickValues(ctx: Ctx, L: LeagueRow, args: any) {
  const teams = L.snapshot.rosters.length || 12; const rounds = leagueFormat(L).draft_rounds || 4;
  const byRound: Record<string, unknown> = {};
  for (let rd = 1; rd <= rounds; rd++) byRound[ord(rd) + ' round'] = { early: slotValue(L, (rd - 1) * teams + 1), mid: roundMidValue(L, rd), late: slotValue(L, rd * teams) };
  const top = []; for (let s = 1; s <= Math.min(12, teams); s++) top.push({ pick: '1.' + String(s).padStart(2, '0'), value: slotValue(L, s) });
  const rid = args.roster_id != null ? Number(args.roster_id) : null;
  const owned = Object.entries(L.snapshot.picks || {}).filter(([r]) => rid == null || Number(r) === rid).map(([r, list]) => ({ team: teamName(L, r), roster_id: Number(r), picks: (list as Pick[]).map(pk => pickLabel(pk, Number(r), L) + ' · ' + pk.value) }));
  return { league_id: L.league_id, teams, draft_rounds: rounds, value_by_round: byRound, first_round_by_slot: top, picks_owned: owned, note: 'Values for the next draft; later years are discounted 12% per year. A pick\'s slot comes from Sleeper\'s draft order when known, else the owner\'s standing.' };
}

const NEWS_STEP = 'Before you answer: if you can search the web, search the last 7 days of news for EACH of these players and his NFL team (new play-caller or head coach, quarterback change, teammate trade or injury that shifts targets or carries, role or snap-share change, practice status, weather) and lead with the biggest item for each side. A coaching or play-calling change outranks a cold stretch of box scores. Never tell the member to go check something themselves.';
type ProjLine = { id: string; name: string; pos: string; nfl_team: string; nfl_opponent?: string; game_date?: string | null; injury?: string; proj_this_week?: number | null; season_games?: number; season_avg?: number | null; game_log?: string };
function projLine(ctx: Ctx, L: LeagueRow, pid: string): ProjLine {
  const p = ctx.players[pid] || ({} as Partial<PlayerSlim>);
  const bits = seasonBits(L, pid) as Partial<ProjLine>;
  return { id: pid, name: p.n || pid, pos: ((L.intel.playerMeta || {})[pid] || {}).pos || p.pos || '?', nfl_team: p.t || 'FA', ...gameBits(ctx, p.t), injury: p.inj ? p.inj + (p.injp ? ' (' + p.injp + ')' : '') : undefined, ...bits };
}
function weeklyProjections(ctx: Ctx, L: LeagueRow, args: any) {
  const ids: string[] = [], unknown: string[] = [];
  (args.players || []).slice(0, 20).forEach((q: unknown) => { const pid = resolveOne(ctx, L, q); if (pid) ids.push(pid); else unknown.push(String(q)); });
  return { league_id: L.league_id, week: L.snapshot.proj_week, scoring: 'this league\'s scoring', before_you_answer: NEWS_STEP, note: 'proj_this_week is Sleeper\'s projection; game_log is points scored each week this season (DNP = did not play). A null projection means Sleeper is not projecting him this week.', players: ids.map(pid => projLine(ctx, L, pid)), not_found: unknown.length ? unknown : undefined, numbers_as_of: L.built_at };
}
function myMatchup(ctx: Ctx, L: LeagueRow) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const rows = L.snapshot.matchups || [];
  const mine = rows.find(m => String(m.roster_id) === String(me.roster_id));
  if (!mine || mine.matchup_id == null) return { league_id: L.league_id, week: L.snapshot.proj_week, note: 'No head-to-head matchup for you this week (bye or playoffs).' };
  const opp = rows.find(m => m.matchup_id === mine.matchup_id && String(m.roster_id) !== String(me.roster_id));
  const oppR = opp ? rosterOf(L, opp.roster_id) : null;
  const proj = L.snapshot.proj || {};
  const lineup = (r: Roster | null) => (r ? (r.starters || []).filter(x => x && x !== '0') : []).map(pid => projLine(ctx, L, pid));
  const total = (list: Array<{ proj_this_week?: unknown }>) => round1(list.reduce((t, x) => t + (Number(x.proj_this_week) || 0), 0));
  const myLine = lineup(me), oppLine = lineup(oppR);
  const starters = new Set(me.starters || []);
  const benchBetter = (me.players || []).filter(pid => !starters.has(pid) && !(me.reserve || []).includes(pid) && !(me.taxi || []).includes(pid) && proj[pid] != null)
    .map(pid => projLine(ctx, L, pid)).filter(b => myLine.some(s => s.pos === b.pos && (Number(s.proj_this_week) || 0) < (Number(b.proj_this_week) || 0)))
    .sort((a, b) => (Number(b.proj_this_week) || 0) - (Number(a.proj_this_week) || 0)).slice(0, 6);
  return {
    league_id: L.league_id, week: L.snapshot.proj_week, opponent: opp ? teamName(L, opp.roster_id) + ' (roster ' + opp.roster_id + ')' : 'unknown',
    live_score: mine.points || (opp && opp.points) ? { me: round1(mine.points), them: round1(opp && opp.points) } : undefined,
    my_projected_total: total(myLine), their_projected_total: total(oppLine),
    my_lineup: myLine, their_lineup: oppLine,
    bench_projected_above_a_starter_at_same_position: benchBetter,
    before_you_answer: NEWS_STEP,
    note: 'Projections are Sleeper\'s, in this league\'s scoring. Lineups are as set in Sleeper right now.',
    numbers_as_of: L.built_at,
  };
}

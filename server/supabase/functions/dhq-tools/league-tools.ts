// dhq-tools/league-tools.ts — the league-wide lookups: rules and scoring,
// standings with luck, a team's schedule, league history, head-to-head,
// transactions, draft results and league-wide player rankings. Same names
// and output shapes as the in-app AI's lookups (js/shared/ask-tools-*.js),
// so the member's ChatGPT/Claude and the in-app assistant answer alike.
//
// Everything here reads what the engine build stored: snapshot.weeks (every
// regular-season week's matchup rows this season, future weeks = pairings),
// snapshot.history (past seasons' owners and scores), snapshot.txns (this
// season's waiver/FA moves), intel.tradeHistory / ownerProfiles /
// championships / bracketData / draftOutcomes / hitRateByRound. No network.
// deno-lint-ignore-file no-explicit-any
import {
  type Ctx, type LeagueRow, type Roster, type Pick, ToolError,
  myRoster, rosterOf, teamName, ownerName, dhq, whoRosters, assessOf, round1, norm, ord, pickLabel,
  resolveOne, slotValue, roundMidValue, seasonBits, fresh,
} from './tools.ts';

// ── shared helpers ──────────────────────────────────────────────────────
const num = (v: unknown) => (v == null || v === '' || isNaN(Number(v)) ? null : Number(v));
const wlt = (w: number, l: number, t: number) => w + '-' + l + (t ? '-' + t : '');
const isoDate = (ts: unknown) => (Number(ts) > 0 ? new Date(Number(ts)).toISOString().slice(0, 10) : null);
const pts = (r: Roster, k: 'fpts' | 'fpts_against' | 'ppts') => round1((Number((r.settings || {})[k]) || 0) + (Number((r.settings || {})[k + '_decimal']) || 0) / 100);
const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.max(lo, Math.min(hi, n)) : dflt; };

export function lastRegWeek(L: LeagueRow): number {
  return Number(L.snapshot.last_reg_week) || Math.max(1, Math.min(18, (num(((L.snapshot.league || {}).settings || {}).playoff_week_start) || 15) - 1));
}
function seasonOver(L: LeagueRow): boolean {
  const st = L.snapshot.nfl_state || {}; const status = (L.snapshot.league || {}).status;
  if (status === 'complete') return true;
  if (status === 'pre_draft' || status === 'drafting') return false;
  return st.season_type === 'post' || (st.season_type === 'off' && String(st.season) === String(L.season));
}
// Last completed regular-season week this season (0 = none yet).
export function playedThrough(L: LeagueRow): number {
  const status = (L.snapshot.league || {}).status;
  if (status === 'pre_draft' || status === 'drafting') return 0;
  const last = lastRegWeek(L);
  if (seasonOver(L)) return last;
  return Math.max(0, Math.min((Number((L.snapshot.nfl_state || {}).week) || 1) - 1, last));
}
type WeekRow = { roster_id: number; matchup_id: number | null; points: number };
const weeksOf = (L: LeagueRow): Record<string, WeekRow[]> => (L.snapshot.weeks || {}) as Record<string, WeekRow[]>;
// One team's game in a week: its row and the opponent's (null on a bye / no pairing).
function gameIn(rows: WeekRow[] | undefined, rid: number | string) {
  const me = (rows || []).find(r => String(r.roster_id) === String(rid));
  if (!me || me.matchup_id == null) return null;
  const opp = (rows || []).find(r => r.matchup_id === me.matchup_id && String(r.roster_id) !== String(rid)) || null;
  return { me, opp };
}

// A team argument: roster id, "me", team name or owner name. Default: the member's team.
export function teamArg(ctx: Ctx, L: LeagueRow, q: unknown, rid?: unknown, what = 'team'): Roster {
  if (rid != null && rid !== '') { const r = rosterOf(L, rid); if (r) return r; throw new ToolError('No roster ' + rid + ' in ' + L.name + '. Use get_standings for roster ids.'); }
  const s = q == null ? '' : String(q).trim();
  if (!s || /^(me|my|mine|my team|myself|i)$/i.test(s)) {
    const me = myRoster(L, ctx.memberId);
    if (!me) throw new ToolError('You do not have a team in ' + L.name + '; say which team (' + what + ').');
    return me;
  }
  if (/^\d{1,3}$/.test(s)) { const r = rosterOf(L, s); if (r) return r; }
  const n = norm(s);
  const scored = L.snapshot.rosters.map(r => {
    const t = norm(teamName(L, r.roster_id)), o = norm(ownerName(L, r.roster_id));
    const score = t === n || o === n ? 3 : (t.startsWith(n) || o.startsWith(n)) ? 2 : (n.length >= 3 && (t.includes(n) || o.includes(n))) ? 1 : 0;
    return { r, score };
  }).filter(x => x.score).sort((a, b) => b.score - a.score);
  if (!scored.length) throw new ToolError('No team in ' + L.name + ' matches "' + s + '" (' + what + '). Teams: ' + L.snapshot.rosters.map(r => teamName(L, r.roster_id) + ' (' + ownerName(L, r.roster_id) + ', roster ' + r.roster_id + ')').join('; '));
  return scored[0].r;
}
const label = (L: LeagueRow, rid: unknown) => teamName(L, rid) + (ownerName(L, rid) && ownerName(L, rid) !== teamName(L, rid) ? ' (' + ownerName(L, rid) + ')' : '');

// A past season's roster id → that season's manager, named as they are now
// when still in the league, else by their name that season.
function ownerIn(L: LeagueRow, season: string, rid: unknown): string | null {
  if (String(season) === String(L.season)) { const r = rosterOf(L, rid); return r ? r.owner_id : null; }
  const h = (L.snapshot.history || []).find((x: any) => String(x.season) === String(season));
  return h ? ((h.owners || {})[String(rid)] || null) : null;
}
function ownerLabel(L: LeagueRow, ownerId: string | null, season?: string): string | null {
  if (!ownerId) return null;
  const cur = L.snapshot.rosters.find(r => r.owner_id === ownerId || (r.co_owners || []).includes(ownerId));
  if (cur) return label(L, cur.roster_id);
  const hist = L.intel.leagueUsersHistory || {};
  const seasons = season ? [season, ...Object.keys(hist).reverse()] : Object.keys(hist).reverse();
  for (const s of seasons) { const u = (hist[s] || []).find((x: any) => x.user_id === ownerId); if (u) return u.display_name + ' (no longer in the league)'; }
  return 'a former manager';
}
// Name for a roster id in a given season (falls back to the roster's current team).
export function nameIn(L: LeagueRow, season: string, rid: unknown): string {
  const o = ownerIn(L, season, rid);
  return (o && ownerLabel(L, o, season)) || (rosterOf(L, rid) ? label(L, rid) : 'roster ' + rid);
}

// ── get_league additions: rules and scoring ─────────────────────────────
const SCORING_GROUPS: Array<[string, RegExp]> = [
  ['passing', /^pass_/], ['rushing', /^rush_/], ['receiving', /^rec/], ['bonuses', /^bonus_/],
  ['kicking', /^(fg|xp)/], ['idp', /^idp_/], ['special_teams', /^(st_|kr_|pr_)/], ['fumbles', /^fum/],
  ['team_defense', /^(def_|pts_allow|yds_allow|sack$|int$|ff$|safe$|blk_kick)/],
];
export function groupScoring(sc: Record<string, unknown>) {
  const out: Record<string, Record<string, number>> = {};
  Object.keys(sc || {}).sort().forEach(k => {
    const v = Number(sc[k]); if (!v || isNaN(v)) return;
    const g = (SCORING_GROUPS.find(x => x[1].test(k)) || ['other'])[0];
    (out[g] = out[g] || {})[k] = Math.round(v * 1000) / 1000;
  });
  return out;
}
const ROUND_TYPE: Record<number, string> = { 0: 'one week per round', 1: 'one week per round, two-week championship', 2: 'two weeks per round' };
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export function rulesOf(L: LeagueRow) {
  const lg = L.snapshot.league || {}; const st = lg.settings || {};
  const has = (k: string) => st[k] != null && st[k] !== '';
  const r: Record<string, unknown> = {};
  r.league_type = ({ 0: 'redraft', 1: 'keeper', 2: 'dynasty' } as Record<number, string>)[num(st.type) ?? -1] || (Number(st.best_ball) === 1 ? 'best ball' : 'unknown');
  if (Number(st.best_ball) === 1) r.best_ball = true;
  if (has('trade_deadline')) r.trade_deadline_week = (num(st.trade_deadline) || 0) >= 99 ? 'none' : num(st.trade_deadline);
  if (has('disable_trades')) r.trades_disabled = Number(st.disable_trades) === 1;
  if (has('trade_review_days')) r.trade_review_days = num(st.trade_review_days);
  if (has('pick_trading')) r.pick_trading = Number(st.pick_trading) === 1;
  const veto: Record<string, unknown> = {};
  if (has('veto_votes_needed')) veto.votes_needed = num(st.veto_votes_needed);
  if (has('veto_auto_poll')) veto.auto_poll = Number(st.veto_auto_poll) === 1;
  if (has('veto_show_votes')) veto.votes_shown = Number(st.veto_show_votes) === 1;
  if (Object.keys(veto).length) r.veto = veto;
  const po: Record<string, unknown> = {};
  if (has('playoff_teams')) po.teams = num(st.playoff_teams);
  if (has('playoff_week_start')) po.start_week = num(st.playoff_week_start);
  po.regular_season_ends_week = lastRegWeek(L);
  if (has('playoff_round_type')) po.rounds = ROUND_TYPE[num(st.playoff_round_type) ?? -1] || st.playoff_round_type;
  if (has('playoff_type')) po.bracket_type_code = num(st.playoff_type);
  if (has('playoff_seed_type')) po.seeding = num(st.playoff_seed_type) === 0 ? 'default: record, then points for (division winners first when divisions are on)' : 're-seed / custom (Sleeper code ' + st.playoff_seed_type + ')';
  r.playoffs = po;
  const wv: Record<string, unknown> = {};
  if (has('waiver_type')) wv.type = ({ 0: 'rolling waivers', 1: 'reverse-standings waivers', 2: 'FAAB (blind bidding)' } as Record<number, string>)[num(st.waiver_type) ?? -1] || st.waiver_type;
  if (has('waiver_budget') && Number(st.waiver_type) === 2) wv.faab_budget = num(st.waiver_budget);
  if (has('waiver_bid_min')) wv.min_bid = num(st.waiver_bid_min);
  if (has('waiver_clear_days')) wv.clear_days = num(st.waiver_clear_days);
  if (has('daily_waivers')) wv.daily_waivers = Number(st.daily_waivers) === 1;
  if (has('waiver_day_of_week') && Number(st.daily_waivers) !== 1) wv.process_day = DAYS[num(st.waiver_day_of_week) ?? 0] || st.waiver_day_of_week;
  if (has('offseason_adds')) wv.offseason_adds = Number(st.offseason_adds) === 1;
  if (Object.keys(wv).length) r.waivers = wv;
  const taxi: Record<string, unknown> = {};
  if (has('taxi_slots')) taxi.slots = num(st.taxi_slots);
  if (has('taxi_years')) taxi.max_years_in_league = num(st.taxi_years);
  if (has('taxi_deadline')) taxi.deadline_week = num(st.taxi_deadline) || 'none';
  if (has('taxi_allow_vets')) taxi.vets_allowed = Number(st.taxi_allow_vets) === 1;
  if (Object.keys(taxi).length && taxi.slots !== 0) r.taxi = taxi;
  const ir: Record<string, unknown> = {};
  if (has('reserve_slots')) ir.slots = num(st.reserve_slots);
  Object.keys(st).filter(k => /^reserve_allow_/.test(k)).forEach(k => { ir['allows_' + k.replace('reserve_allow_', '')] = Number(st[k]) === 1; });
  if (Object.keys(ir).length && ir.slots !== 0) r.ir = ir;
  if (has('max_keepers') && Number(st.type) === 1) r.max_keepers = num(st.max_keepers);
  if (has('draft_rounds')) r.draft_rounds = num(st.draft_rounds);
  if (num(st.divisions)) r.divisions = { count: num(st.divisions), names: lg.division_names || undefined };
  if (has('league_average_match')) r.median_game = Number(st.league_average_match) === 1;
  if (has('bench_lock')) r.bench_lock = Number(st.bench_lock) === 1;
  return r;
}
export function rosterSlots(L: LeagueRow) {
  const slots: Record<string, number> = {};
  ((L.snapshot.league || {}).roster_positions || []).forEach((p: string) => { slots[p] = (slots[p] || 0) + 1; });
  return slots;
}

// ── standings, luck ─────────────────────────────────────────────────────
const winsOf = (r: Roster) => (Number((r.settings || {}).wins) || 0) + (Number((r.settings || {}).ties) || 0) / 2;
function standingsOrder(L: LeagueRow) {
  const rs = L.snapshot.rosters.slice().sort((a, b) => winsOf(b) - winsOf(a) || pts(b, 'fpts') - pts(a, 'fpts'));
  const nDiv = num(((L.snapshot.league || {}).settings || {}).divisions) || 0;
  const useDiv = nDiv >= 2 && rs.every(r => (num((r.settings || {}).division) || 0) > 0);
  let seeds = rs;
  if (useDiv) {
    const seen: Record<string, boolean> = {}; const leaders: Roster[] = [];
    rs.forEach(r => { const d = String((r.settings || {}).division); if (!seen[d]) { seen[d] = true; leaders.push(r); } });
    seeds = leaders.concat(rs.filter(r => !leaders.includes(r)));
  }
  return { byRecord: rs, seeds, usedDivisions: useDiv };
}
// All-play record, expected wins and luck from the played weeks' scores.
export function luckTable(L: LeagueRow) {
  const through = playedThrough(L); const W = weeksOf(L);
  const out: Record<string, { apW: number; apL: number; apT: number; exp: number; w: number; l: number; t: number; pf: number; pa: number; weeks: number; high: number; low: number }> = {};
  let weeks = 0;
  for (let w = 1; w <= through; w++) {
    const rows = (W[w] || []).filter(r => r.matchup_id != null);
    if (rows.length < 2 || !rows.some(r => r.points > 0)) continue;
    weeks++;
    rows.forEach(r => {
      const o = out[r.roster_id] = out[r.roster_id] || { apW: 0, apL: 0, apT: 0, exp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, weeks: 0, high: -1, low: 1e9 };
      let beat = 0;
      rows.forEach(x => { if (x === r) return; if (r.points > x.points) { o.apW++; beat++; } else if (r.points < x.points) o.apL++; else { o.apT++; beat += 0.5; } });
      o.exp += beat / (rows.length - 1);
      const g = gameIn(rows, r.roster_id);
      if (g && g.opp) { o.pa += g.opp.points; if (r.points > g.opp.points) o.w++; else if (r.points < g.opp.points) o.l++; else o.t++; }
      o.pf += r.points; o.weeks++; o.high = Math.max(o.high, r.points); o.low = Math.min(o.low, r.points);
    });
  }
  return { through, weeks, rows: out };
}
export function standingsTool(ctx: Ctx, L: LeagueRow, args: any) {
  const st = (L.snapshot.league || {}).settings || {};
  const { byRecord, seeds, usedDivisions } = standingsOrder(L);
  const spots = num(st.playoff_teams) || 0;
  const seedOf: Record<string, number> = {};
  seeds.slice(0, spots).forEach((r, i) => { seedOf[String(r.roster_id)] = i + 1; });
  const lk = args.include_luck === false ? null : luckTable(L);
  const me = myRoster(L, ctx.memberId);
  const divNames = (L.snapshot.league || {}).division_names || {};
  const isFaab = Number(st.waiver_type) === 2 && Number(st.waiver_budget) > 0;
  const teams = byRecord.map((r, i) => {
    const s = r.settings || {}; const a = assessOf(L, r.roster_id); const x = lk && lk.rows[r.roster_id];
    const div = num(s.division);
    return {
      rank: i + 1, team: teamName(L, r.roster_id), owner: ownerName(L, r.roster_id), roster_id: r.roster_id, mine: me && me.roster_id === r.roster_id ? true : undefined,
      record: wlt(Number(s.wins) || 0, Number(s.losses) || 0, Number(s.ties) || 0), points_for: pts(r, 'fpts'), points_against: pts(r, 'fpts_against'), max_points: pts(r, 'ppts') || undefined,
      division: div ? (divNames[div] ? divNames[div] + ' (' + div + ')' : div) : undefined, playoff_seed: seedOf[String(r.roster_id)],
      power_rank: a ? a.powerRank : undefined, tier: a ? a.tier : undefined, window: a ? a.window : undefined, total_dhq_value: a && a.totalDHQ != null ? Math.round(a.totalDHQ) : undefined,
      faab_left: isFaab ? Math.max(0, Number(st.waiver_budget) - (Number(s.waiver_budget_used) || 0)) : undefined, waiver_position: num(s.waiver_position) || undefined,
      all_play: x ? wlt(x.apW, x.apL, x.apT) : undefined, expected_wins: x ? round1(x.exp) : undefined, luck: x ? round1(x.w + x.t / 2 - x.exp) : undefined,
    };
  });
  const out: Record<string, unknown> = {
    league_id: L.league_id, season: L.season, week: (L.snapshot.nfl_state || {}).week,
    order: 'wins, then points for' + (usedDivisions ? '; playoff seeds put division leaders first' : ''), playoff_spots: spots || undefined,
    teams, numbers_as_of: L.built_at,
  };
  if (lk) out.luck_note = lk.weeks ? 'all_play = record if you played every team every week (through week ' + lk.through + '); luck = actual wins minus expected (all-play) wins; positive = lucky schedule.' : 'All-play and luck need completed weeks; none yet.';
  out.max_points_note = 'max_points is the best possible lineup\'s points (Sleeper\'s "potential points").';
  return out;
}

// ── schedule ────────────────────────────────────────────────────────────
export function scheduleTool(ctx: Ctx, L: LeagueRow, args: any) {
  const r = teamArg(ctx, L, args.team, args.roster_id);
  const W = weeksOf(L); const through = playedThrough(L); const cur = Number((L.snapshot.nfl_state || {}).week) || 0; const last = lastRegWeek(L);
  if (!Object.keys(W).length) throw new ToolError('This league\'s weekly matchups are not in the build yet (they arrive with the next two-hourly refresh).');
  let w = 0, l = 0, t = 0;
  const weeks = [];
  for (let wk = 1; wk <= last; wk++) {
    const g = gameIn(W[wk], r.roster_id);
    if (!g) { weeks.push({ week: wk, opponent: W[wk] ? 'BYE / no matchup' : 'not posted yet' }); continue; }
    const row: Record<string, unknown> = { week: wk, opponent: g.opp ? teamName(L, g.opp.roster_id) : 'unknown', opponent_roster_id: g.opp ? g.opp.roster_id : undefined };
    if (wk <= through) {
      const a = g.me.points, b = g.opp ? g.opp.points : 0;
      row.result = a > b ? 'W' : a < b ? 'L' : 'T'; row.score = round1(a) + '-' + round1(b); row.status = 'played';
      if (a > b) w++; else if (a < b) l++; else t++;
    } else {
      row.status = wk === cur ? 'this week' : 'upcoming';
      if (wk === cur && (g.me.points || (g.opp && g.opp.points))) row.score_so_far = round1(g.me.points) + '-' + round1(g.opp ? g.opp.points : 0);
      if (g.opp) { const o = rosterOf(L, g.opp.roster_id)!; const a = assessOf(L, g.opp.roster_id); row.opponent_record = wlt(Number(o.settings.wins) || 0, Number(o.settings.losses) || 0, Number(o.settings.ties) || 0); if (a) { row.opponent_power_rank = a.powerRank; row.opponent_tier = a.tier; } }
    }
    weeks.push(row);
  }
  const upcoming = weeks.filter((x: any) => x.status !== 'played' && x.opponent_roster_id != null);
  const ranks = upcoming.map((x: any) => Number(x.opponent_power_rank)).filter(n => n > 0);
  const s = r.settings || {};
  return {
    league_id: L.league_id, team: label(L, r.roster_id), roster_id: r.roster_id, current_week: cur, record: wlt(Number(s.wins) || 0, Number(s.losses) || 0, Number(s.ties) || 0),
    record_from_scores: through ? wlt(w, l, t) : undefined, regular_season_ends_week: last, playoffs_start_week: last + 1,
    remaining_games: upcoming.length, remaining_avg_opponent_power_rank: ranks.length ? round1(ranks.reduce((a, b) => a + b, 0) / ranks.length) : undefined,
    weeks,
    note: 'Win chances and a projected final record are not computed here; opponents\' power rank and tier show how hard the rest of the schedule is (1 = strongest).',
  };
}

// ── league history ──────────────────────────────────────────────────────
function bracketLines(L: LeagueRow, season: string, games: any[]) {
  const PLACE: Record<number, string> = { 1: 'Championship', 3: '3rd place', 5: '5th place', 7: '7th place' };
  return (games || []).filter(g => g && g.t1 != null && g.t2 != null).sort((x, y) => (x.r || 0) - (y.r || 0) || (x.m || 0) - (y.m || 0)).map(g => {
    const tag = PLACE[g.p] || ('Round ' + (g.r || '?'));
    if (g.w == null) return tag + ': ' + nameIn(L, season, g.t1) + ' vs ' + nameIn(L, season, g.t2) + ' (not played yet)';
    return tag + ': ' + nameIn(L, season, g.w) + ' beat ' + nameIn(L, season, g.l != null ? g.l : (String(g.w) === String(g.t1) ? g.t2 : g.t1));
  }).slice(0, 16);
}
// Every season's regular-season scores (past seasons + this one), by roster id.
function allSeasons(L: LeagueRow): Array<{ season: string; weeks: Record<string, WeekRow[]>; through: number; current: boolean }> {
  const cur = { season: String(L.season), weeks: weeksOf(L), through: playedThrough(L), current: true };
  const past = (L.snapshot.history || []).map((h: any) => ({ season: String(h.season), weeks: h.weeks || {}, through: Number(h.last_reg_week) || 14, current: false }));
  return [cur, ...past];
}
export function historyTool(_ctx: Ctx, L: LeagueRow, args: any) {
  const want = args.season != null && String(args.season).trim() ? String(args.season).trim() : null;
  const champs = L.intel.championships || {}; const brackets = L.intel.bracketData || {};
  const seasonsKnown = [...new Set(Object.keys(champs).concat(Object.keys(brackets)).concat((L.snapshot.history || []).map((h: any) => String(h.season))))].sort((a, b) => Number(b) - Number(a));
  if (!seasonsKnown.length) throw new ToolError('No league history in the build (no past seasons found for this league on Sleeper).');
  if (want && !seasonsKnown.includes(want)) throw new ToolError('No history for season ' + want + '. Seasons known: ' + seasonsKnown.join(', '));
  const seasons = seasonsKnown.filter(s => !want || s === want).slice(0, 12).map(s => {
    const c = champs[s] || {}; const b = (brackets[s] || {}).winners || [];
    const row: Record<string, unknown> = { season: s };
    if (c.champion != null) { row.champion = nameIn(L, s, c.champion); row.runner_up = c.runnerUp != null ? nameIn(L, s, c.runnerUp) : undefined; if (c.semiFinals && c.semiFinals.length) row.semifinalists = c.semiFinals.map((x: unknown) => nameIn(L, s, x)); }
    else row.champion = s === String(L.season) ? 'in progress' : 'unknown';
    // The current season's bracket before any playoff game is only Sleeper's placeholder, not the seeding.
    if (b.length && b.some((g: any) => g && g.w != null)) row.bracket = bracketLines(L, s, b);
    return row;
  });
  // Per-manager records across seasons, counted by owner (a roster slot that changed hands does not carry over).
  type Rec = { seasons: Set<string>; w: number; l: number; t: number; pf: number; titles: string[]; runner_ups: number; playoffs: number; season_rows: Record<string, { w: number; l: number; t: number; pf: number }> };
  const by: Record<string, Rec> = {};
  const rec = (o: string) => by[o] = by[o] || { seasons: new Set(), w: 0, l: 0, t: 0, pf: 0, titles: [], runner_ups: 0, playoffs: 0, season_rows: {} };
  allSeasons(L).forEach(S => {
    if (want && S.season !== want) return;
    for (let wk = 1; wk <= S.through; wk++) {
      const rows = (S.weeks[wk] || []).filter(r => r.matchup_id != null);
      if (!rows.some(r => r.points > 0)) continue;
      rows.forEach(r => {
        const o = ownerIn(L, S.season, r.roster_id); if (!o) return;
        const g = gameIn(rows, r.roster_id); const x = rec(o); x.seasons.add(S.season);
        const sr = x.season_rows[S.season] = x.season_rows[S.season] || { w: 0, l: 0, t: 0, pf: 0 };
        sr.pf += r.points; x.pf += r.points;
        if (g && g.opp) { if (r.points > g.opp.points) { x.w++; sr.w++; } else if (r.points < g.opp.points) { x.l++; sr.l++; } else { x.t++; sr.t++; } }
      });
    }
    const c = champs[S.season] || {};
    if (c.champion != null) { const o = ownerIn(L, S.season, c.champion); if (o) rec(o).titles.push(S.season); }
    if (c.runnerUp != null) { const o = ownerIn(L, S.season, c.runnerUp); if (o) rec(o).runner_ups++; }
    const ids = new Set<string>(); ((brackets[S.season] || {}).winners || []).forEach((g: any) => { if (g.t1 != null) ids.add(String(g.t1)); if (g.t2 != null) ids.add(String(g.t2)); });
    ids.forEach(rid => { const o = ownerIn(L, S.season, rid); if (o) rec(o).playoffs++; });
  });
  const managers = Object.entries(by).map(([o, x]) => {
    const games = x.w + x.l + x.t;
    const base: Record<string, unknown> = { manager: ownerLabel(L, o, want || undefined) };
    if (want) { const sr = x.season_rows[want]; return Object.assign(base, { record: sr ? wlt(sr.w, sr.l, sr.t) : undefined, points_for: sr ? Math.round(sr.pf) : undefined, champion: x.titles.includes(want) || undefined }); }
    return Object.assign(base, { seasons: x.seasons.size, record: wlt(x.w, x.l, x.t), win_pct: games ? round1((x.w + x.t / 2) / games * 100) : null, points_for: Math.round(x.pf), titles: x.titles.length, title_seasons: x.titles.length ? x.titles.sort() : undefined, runner_ups: x.runner_ups, playoff_trips: x.playoffs });
  }).sort((a: any, b: any) => (b.titles || 0) - (a.titles || 0) || (b.win_pct || 0) - (a.win_pct || 0)).slice(0, 32);
  return {
    league_id: L.league_id, league: L.name, seasons_on_record: seasonsKnown,
    seasons, [want ? 'season_records' : 'all_time']: managers,
    note: 'Records are regular-season games (the current season through the last completed week), counted by manager. Playoff trips count winners-bracket appearances.',
  };
}

// ── head to head ────────────────────────────────────────────────────────
export function headToHeadTool(ctx: Ctx, L: LeagueRow, args: any) {
  const ra = teamArg(ctx, L, args.team_a, args.roster_id_a, 'team_a');
  if ((args.team_b == null || String(args.team_b).trim() === '') && args.roster_id_b == null) throw new ToolError('Say which team to compare against (team_b).');
  const rb = teamArg(ctx, L, args.team_b, args.roster_id_b, 'team_b');
  if (ra.roster_id === rb.roster_id) throw new ToolError('Those are the same team; pick two different teams.');
  const W = weeksOf(L); const through = playedThrough(L);
  const meetings: Array<{ week: number; a: number; b: number }> = []; const upcoming: number[] = [];
  for (let wk = 1; wk <= lastRegWeek(L); wk++) {
    const g = gameIn(W[wk], ra.roster_id);
    if (!g || !g.opp || String(g.opp.roster_id) !== String(rb.roster_id)) continue;
    if (wk <= through) meetings.push({ week: wk, a: g.me.points, b: g.opp.points }); else upcoming.push(wk);
  }
  const tally = (gs: Array<{ a: number; b: number }>) => { let w = 0, l = 0, t = 0, pa = 0, pb = 0; gs.forEach(g => { if (g.a > g.b) w++; else if (g.a < g.b) l++; else t++; pa += g.a; pb += g.b; }); return { record: wlt(w, l, t), pa: round1(pa), pb: round1(pb) }; };
  const out: Record<string, unknown> = { league_id: L.league_id, team_a: label(L, ra.roster_id), team_b: label(L, rb.roster_id) };
  const ts = tally(meetings);
  out.this_season = { season: L.season, through_week: through, record_for_team_a: ts.record, meetings: meetings.map(g => ({ week: g.week, score: round1(g.a) + '-' + round1(g.b), winner: g.a > g.b ? 'team_a' : g.a < g.b ? 'team_b' : 'tie' })), still_to_play_weeks: upcoming.length ? upcoming : undefined };
  // All-time, by manager.
  const oa = ra.owner_id, ob = rb.owner_id;
  const notes: string[] = [];
  if (!oa || !ob) notes.push('One of the teams has no manager on record, so past seasons can\'t be matched.');
  else {
    const reg: Array<{ season: string; week: number; a: number; b: number }> = meetings.map(g => ({ season: String(L.season), ...g }));
    const po: Array<{ season: string; round: number; place?: number; won: boolean }> = []; const covered: string[] = [];
    (L.snapshot.history || []).forEach((h: any) => {
      const owners = h.owners || {};
      const A = Object.keys(owners).find(k => owners[k] === oa), B = Object.keys(owners).find(k => owners[k] === ob);
      if (!A || !B) return;
      covered.push(String(h.season));
      for (let wk = 1; wk <= (Number(h.last_reg_week) || 14); wk++) {
        const g = gameIn((h.weeks || {})[wk], A);
        if (g && g.opp && String(g.opp.roster_id) === B && (g.me.points > 0 || g.opp.points > 0)) reg.push({ season: String(h.season), week: wk, a: g.me.points, b: g.opp.points });
      }
      (((L.intel.bracketData || {})[h.season] || {}).winners || []).forEach((g: any) => {
        if (!g || g.w == null) return;
        const ids = [String(g.t1), String(g.t2)];
        if (ids.includes(A) && ids.includes(B)) po.push({ season: String(h.season), round: g.r, place: g.p || undefined, won: String(g.w) === A });
      });
    });
    const ta = tally(reg); const poW = po.filter(g => g.won).length;
    out.all_time = {
      regular_season_record_for_team_a: ta.record, points: { team_a: ta.pa, team_b: ta.pb },
      playoff_record_for_team_a: wlt(poW, po.length - poW, 0),
      playoff_meetings: po.slice(0, 10).map(g => ({ season: g.season, round: g.round, game: g.place === 1 ? 'championship' : g.place ? 'place ' + g.place : undefined, winner: g.won ? 'team_a' : 'team_b' })),
      past_seasons_both_in_league: covered.sort(),
      recent: reg.sort((x, y) => Number(y.season) - Number(x.season) || y.week - x.week).slice(0, 10).map(g => ({ season: g.season, week: g.week, score: round1(g.a) + '-' + round1(g.b) })),
    };
    if (!(L.snapshot.history || []).length) notes.push('No earlier seasons of this league are in the build, so all-time is this season only.');
    notes.push('Counted by manager: seasons before either manager joined do not count; this season\'s playoff games are not included.');
  }
  out.note = notes.join(' ');
  return out;
}

// ── transactions ────────────────────────────────────────────────────────
const pname = (ctx: Ctx, pid: string) => (ctx.players[pid] && ctx.players[pid].n) || pid;
const ppos = (ctx: Ctx, L: LeagueRow, pid: string) => ((L.intel.playerMeta || {})[pid] || {}).pos || (ctx.players[pid] || {}).pos || '';
const pline = (ctx: Ctx, L: LeagueRow, pid: string) => pname(ctx, pid) + ' ' + ppos(ctx, L, pid) + (dhq(L, pid) ? ' (DHQ ' + dhq(L, pid) + ')' : '');
function tradeRow(ctx: Ctx, L: LeagueRow, t: any) {
  const season = String(t.season || L.season);
  const rids: string[] = (t.roster_ids || Object.keys(t.sides || {})).map(String);
  const pct = t.valueDiffPct != null ? Number(t.valueDiffPct) : null;
  return {
    date: isoDate(t.ts) || season + ' wk ' + t.week, season, week: t.week ?? null, type: 'trade',
    sides: rids.map(rid => { const s = (t.sides || {})[rid] || {}; return { team: nameIn(L, season, rid), got: (s.players || []).map((pid: string) => pline(ctx, L, pid)).concat((s.picks || []).map((p: any) => p.season + ' ' + ord(Number(p.round)))), value_now: Math.round(s.totalValue || 0) }; }),
    winner: pct != null && pct <= 15 ? 'fair (within 15%)' : t.winner != null ? nameIn(L, season, t.winner) : 'even',
    margin_pct: pct ?? undefined,
    _rids: rids, _winner: t.winner != null ? String(t.winner) : null, _pct: pct, _ts: Number(t.ts) || 0, _pids: rids.flatMap(r => (((t.sides || {})[r] || {}).players || []).map(String)),
  };
}
function moveRows(ctx: Ctx, L: LeagueRow, includeFailed: boolean) {
  const txns = (L.snapshot.txns || []) as any[];
  // Losing bids on the same player in the same waiver run: "who else bid".
  const lost: Record<string, Array<{ team: string; bid: number }>> = {};
  txns.filter(t => t.type === 'waiver' && t.status === 'failed').forEach(t => Object.keys(t.adds || {}).forEach(pid => {
    (lost[pid + '|' + t.leg] = lost[pid + '|' + t.leg] || []).push({ team: teamName(L, (t.roster_ids || [])[0] ?? t.adds[pid]), bid: Number((t.settings || {}).waiver_bid) || 0 });
  }));
  return txns.filter(t => includeFailed || t.status !== 'failed').map(t => {
    const rids = [...new Set([...(t.roster_ids || []), ...Object.values(t.adds || {}), ...Object.values(t.drops || {})].map(String))];
    const adds = Object.keys(t.adds || {}); const drops = Object.keys(t.drops || {});
    const row: Record<string, any> = {
      date: isoDate(t.created), season: String(L.season), week: t.leg ?? null, type: t.type + (t.status === 'failed' ? ' (failed claim)' : ''),
      team: rids.map(r => teamName(L, r)).join(' / '), adds: adds.map(pid => pline(ctx, L, pid)), drops: drops.map(pid => pname(ctx, pid) + ' ' + ppos(ctx, L, pid)),
      faab_bid: t.type === 'waiver' ? (Number((t.settings || {}).waiver_bid) || 0) : undefined,
      _rids: rids, _ts: Number(t.created) || 0, _pids: adds.concat(drops), _type: t.type,
    };
    if (t.type === 'waiver' && t.status !== 'failed') { const o = adds.flatMap(pid => lost[pid + '|' + t.leg] || []).sort((a, b) => b.bid - a.bid).slice(0, 5); if (o.length) row.outbid = o; }
    return row;
  });
}
const strip = (row: Record<string, any>) => { const o: Record<string, unknown> = {}; for (const k in row) if (k[0] !== '_' && row[k] !== undefined) o[k] = row[k]; return o; };
export function transactionsTool(ctx: Ctx, L: LeagueRow, args: any) {
  const type = ['trade', 'waiver', 'free_agent'].includes(args.type) ? args.type : 'all';
  const limit = clampInt(args.limit, 1, 50, 20);
  const team = (args.team != null && args.team !== '') || args.roster_id != null ? teamArg(ctx, L, args.team, args.roster_id) : null;
  let pid: string | null = null;
  if (args.player) { pid = resolveOne(ctx, L, args.player); if (!pid) throw new ToolError('No player matches "' + args.player + '". Try find_players.'); }
  const wantSeason = args.season ? String(args.season) : null;
  const weeks = args.weeks ? clampInt(args.weeks, 1, 30, 1) : null;
  const curWeek = Number((L.snapshot.nfl_state || {}).week) || 0;
  const notes: string[] = [];
  let rows: Array<Record<string, any>> = [];
  const curOk = !wantSeason || wantSeason === String(L.season);
  if (type !== 'trade' && curOk) rows.push(...moveRows(ctx, L, !!args.include_failed).filter(r => type === 'all' || r._type === type));
  if (wantSeason && !curOk && type !== 'trade') notes.push('Waiver and free-agent moves are kept for the current season only; past seasons show trades.');
  if (type === 'all' || type === 'trade') rows.push(...(L.intel.tradeHistory || []).map((t: any) => tradeRow(ctx, L, t)));
  if (wantSeason) rows = rows.filter(r => String(r.season) === wantSeason);
  if (weeks) rows = rows.filter(r => String(r.season) === String(L.season) && Number(r.week) >= curWeek - weeks + 1);
  if (team) rows = rows.filter(r => r._rids.includes(String(team.roster_id)));
  if (pid) rows = rows.filter(r => r._pids.includes(pid));
  rows.sort((x, y) => (y._ts || 0) - (x._ts || 0) || Number(y.season) - Number(x.season) || (y.week || 0) - (x.week || 0));
  const out: Record<string, unknown> = { league_id: L.league_id, filters: strip({ type, team: team ? teamName(L, team.roster_id) : undefined, player: pid ? pname(ctx, pid) : undefined, season: wantSeason || undefined, weeks: weeks || undefined }), total_found: rows.length };
  if (team) {
    const rid = String(team.roster_id); const rec = { won: 0, lost: 0, fair: 0 };
    rows.filter(r => r.type === 'trade' && r._rids.length === 2).forEach(r => { const res = r._pct != null && r._pct <= 15 ? 'fair' : r._winner === rid ? 'won' : r._winner ? 'lost' : 'fair'; rec[res as 'won']++; r.result_for_team = res; });
    if (rec.won + rec.lost + rec.fair) out.trade_record_for_team = rec;
    const mv = rows.filter(r => r.type === 'waiver' || r.type === 'free_agent');
    if (mv.length) out.this_season_moves_for_team = { waiver_claims_won: mv.filter(r => r.type === 'waiver').length, free_agent_adds: mv.filter(r => r.type === 'free_agent').length, faab_spent: mv.reduce((t, r) => t + (r.faab_bid || 0), 0) };
  }
  out.rows = rows.slice(0, limit).map(strip);
  if (rows.length > limit) out.more = rows.length - limit;
  if (rows.some(r => r.type === 'trade')) notes.push('Trade values are today\'s DHQ values, not the values on the day of the trade. A trade within 15% is graded fair.');
  if (rows.some(r => r.outbid)) notes.push('outbid lists the losing FAAB bids on the same player in the same waiver run.');
  if (notes.length) out.notes = notes;
  return out;
}

// ── owner profile additions ─────────────────────────────────────────────
export function tradeBrief(ctx: Ctx, L: LeagueRow, t: any, rid: number | string) {
  if (!t) return null;
  const season = String(t.season || L.season);
  const rids: string[] = (t.roster_ids || Object.keys(t.sides || {})).map(String);
  const other = rids.find(x => x !== String(rid));
  const side = (r?: string) => { const s = (t.sides || {})[r || ''] || {}; return { list: (s.players || []).map((pid: string) => pname(ctx, pid)).concat((s.picks || []).map((p: any) => p.season + ' ' + ord(Number(p.round)))), v: Number(s.totalValue) || 0 }; };
  const got = side(String(rid)), gave = side(other);
  return { date: isoDate(t.ts) || season + ' wk ' + t.week, season, week: t.week ?? null, with: other ? nameIn(L, season, other) : null, got: got.list, gave: gave.list, net_value_now: Math.round(got.v - gave.v) };
}
export function ownerExtras(ctx: Ctx, L: LeagueRow, rid: number) {
  const pr = (L.intel.ownerProfiles || {})[String(rid)] || null;
  const out: Record<string, unknown> = {};
  const topBy = (ids: string[]) => [...new Set((ids || []).map(String))].sort((a, b) => dhq(L, b) - dhq(L, a)).slice(0, 6).map(pid => pline(ctx, L, pid));
  if (pr) {
    out.biggest_win = tradeBrief(ctx, L, pr.biggestWin, rid) || undefined;
    out.biggest_loss = tradeBrief(ctx, L, pr.biggestLoss, rid) || undefined;
    out.players_acquired = { count: (pr.playersAcquired || []).length, most_valuable_now: topBy(pr.playersAcquired) };
    out.players_sold = { count: (pr.playersSold || []).length, most_valuable_now: topBy(pr.playersSold) };
  }
  const me = myRoster(L, ctx.memberId);
  if (me && me.roster_id !== rid) {
    const withMe = (L.intel.tradeHistory || []).filter((t: any) => { const r = (t.roster_ids || []).map(String); return r.includes(String(rid)) && r.includes(String(me.roster_id)); }).sort((a: any, b: any) => (b.ts || 0) - (a.ts || 0));
    const rec = { they_won: 0, you_won: 0, fair: 0 };
    withMe.forEach((t: any) => { if (t.valueDiffPct != null && t.valueDiffPct <= 15) rec.fair++; else if (String(t.winner) === String(rid)) rec.they_won++; else if (String(t.winner) === String(me.roster_id)) rec.you_won++; else rec.fair++; });
    out.trades_with_me = { count: withMe.length, record: rec, recent: withMe.slice(0, 5).map((t: any) => tradeBrief(ctx, L, t, rid)) };
  }
  const mine = ((L.snapshot.txns || []) as any[]).filter(t => (t.roster_ids || []).map(String).includes(String(rid)));
  if (mine.length) {
    const won = mine.filter(t => t.type === 'waiver' && t.status === 'complete');
    out.this_season_activity = {
      waiver_claims_won: won.length, waiver_claims_failed: mine.filter(t => t.type === 'waiver' && t.status === 'failed').length,
      free_agent_adds: mine.filter(t => t.type === 'free_agent' && t.status === 'complete').length,
      faab_spent: won.reduce((s, t) => s + (Number((t.settings || {}).waiver_bid) || 0), 0),
      biggest_bids: won.filter(t => Number((t.settings || {}).waiver_bid) > 0).sort((a, b) => Number(b.settings.waiver_bid) - Number(a.settings.waiver_bid)).slice(0, 3).map(t => Object.keys(t.adds || {}).map(pid => pname(ctx, pid)).join(', ') + ' $' + t.settings.waiver_bid + ' (wk ' + t.leg + ')'),
      recent_adds: mine.filter(t => t.status === 'complete').sort((a, b) => (b.created || 0) - (a.created || 0)).slice(0, 5).map(t => Object.keys(t.adds || {}).map(pid => pname(ctx, pid)).join(', ') + ' (wk ' + t.leg + ')').filter(s => !/^ \(/.test(s)),
    };
  }
  return out;
}

// ── draft info ──────────────────────────────────────────────────────────
export function draftInfoTool(ctx: Ctx, L: LeagueRow, args: any) {
  const sec = ['picks', 'values', 'results', 'hit_rates'].includes(args.section) ? args.section : 'all';
  const want = (s: string) => sec === 'all' || sec === s;
  const limit = clampInt(args.limit, 1, 60, 25);
  const team = (args.team != null && args.team !== '') || args.roster_id != null ? teamArg(ctx, L, args.team, args.roster_id) : null;
  const rd = args.round ? Number(args.round) : null;
  const n = L.snapshot.rosters.length || 12; const rounds = Number(((L.snapshot.league || {}).settings || {}).draft_rounds) || 4;
  const out: Record<string, unknown> = { league_id: L.league_id, teams: n, rounds }; const notes: string[] = [];
  if (want('picks')) {
    const own = L.snapshot.picks || {};
    const one = (rid: number) => ((own[String(rid)] || []) as Pick[]).filter(p => !rd || p.round === rd).map(p => ({ pick: pickLabel(p, rid, L), value: p.value }));
    if (team) { const list = one(team.roster_id); out.picks = { team: teamName(L, team.roster_id), count: list.length, total_value: list.reduce((s, x) => s + x.value, 0), picks: list.slice(0, 40) }; }
    else out.picks_by_team = L.snapshot.rosters.map(r => { const list = one(r.roster_id); return { team: teamName(L, r.roster_id), roster_id: r.roster_id, count: list.length, total_value: list.reduce((s, x) => s + x.value, 0), picks: list.map(x => x.pick).slice(0, 30) }; }).sort((x, y) => y.total_value - x.total_value);
  }
  if (want('values')) {
    const dpv = L.intel.dhqPickValues || {};
    out.pick_values_next_draft = [];
    for (let r = 1; r <= rounds; r++) {
      if (rd && r !== rd) continue;
      const mid = (r - 1) * n + Math.ceil(n / 2); const hist = dpv[String(mid)] || {};
      (out.pick_values_next_draft as unknown[]).push({ round: r, early: slotValue(L, (r - 1) * n + 1), mid: roundMidValue(L, r), late: slotValue(L, r * n), league_hit_rate_mid_pct: hist.hitRate ?? undefined, league_starter_rate_mid_pct: hist.starterRate ?? undefined });
    }
  }
  if (want('results')) {
    const outs = (L.intel.draftOutcomes || []) as any[];
    if (!outs.length) notes.push('No past rookie drafts on record for this league.');
    else {
      const rows = outs.filter(d => (!args.season || String(d.season) === String(args.season)) && (!rd || Number(d.round) === rd) && (!team || String(d.roster_id) === String(team.roster_id)))
        .sort((x, y) => Number(y.season) - Number(x.season) || (x.pick_no || 0) - (y.pick_no || 0));
      const res: Record<string, unknown> = {
        found: rows.length,
        rows: rows.slice(0, limit).map(d => {
          const slot = d.pick_no ? ((d.pick_no - 1) % n) + 1 : null;
          return { season: String(d.season), pick: d.round + '.' + String(slot || '?').padStart(2, '0'), overall: d.pick_no || null, team: nameIn(L, String(d.season), d.roster_id), player: String(d.name || pname(ctx, d.pid)).trim(), pos: d.pos, value_now: d.pid ? dhq(L, String(d.pid)) : null, now_on: d.pid ? (whoRosters(L, String(d.pid)) != null ? teamName(L, whoRosters(L, String(d.pid))) : 'free agent') : undefined, result: d.isHit ? 'hit (elite season)' : d.isStarter ? 'starter' : (d.seasonsAvailable || 0) < 1 ? 'too early to tell' : 'miss', best_season_pts: d.bestTotal ? round1(d.bestTotal) : 0 };
        }),
      };
      if (rows.length > limit) res.more = rows.length - limit;
      if (!rows.length) notes.push('No draft picks match. Rookie drafts on record: ' + [...new Set(outs.map(d => String(d.season)))].sort().join(', ') + '.');
      if (team) { const g = rows.filter(d => (d.seasonsAvailable || 0) >= 1); res.team_summary = { picks: rows.length, graded: g.length, starters: g.filter(d => d.isStarter).length, hits: g.filter(d => d.isHit).length }; }
      out.draft_results = res;
    }
  }
  if (want('hit_rates')) {
    const hr = L.intel.hitRateByRound || {};
    const keys = Object.keys(hr).filter(k => !rd || Number(k) === rd);
    if (keys.length) out.hit_rates_by_round = keys.map(k => { const x = hr[k] || {}; return { round: Number(k), picks_graded: x.total || 0, starter_rate_pct: x.rate || 0, elite_rate_pct: x.eliteRate || 0, best_positions: (x.bestPos || []).slice(0, 3).map((p: any) => p.pos + ' ' + p.rate + '% (' + p.starters + '/' + p.total + ')') }; });
    else notes.push('No hit-rate history yet for this league.');
  }
  notes.push('Pick values are DHQ values for the next draft (later years discounted 12% a year). "starter" = the pick produced a starter-level season; "hit" = an elite season.');
  out.notes = notes;
  out.numbers_as_of = L.built_at;
  return out;
}

// ── search players ──────────────────────────────────────────────────────
const POS_ALL = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
const POS_GROUP: Record<string, string[]> = { FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'], IDP: ['DL', 'LB', 'DB'], IDP_FLEX: ['DL', 'LB', 'DB'] };
const POS_NORM: Record<string, string> = { DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL', OLB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', PK: 'K', DST: 'DEF', 'D/ST': 'DEF' };
const normPos = (p: string) => { const u = String(p || '').toUpperCase(); return POS_NORM[u] || u; };
export function searchPlayersTool(ctx: Ctx, L: LeagueRow, args: any) {
  const q = args.position ? String(args.position).toUpperCase().replace(/[\s-]/g, '_') : '';
  const want = q ? (POS_GROUP[q] || [normPos(q)]) : null;
  if (want && !want.every(p => POS_ALL.includes(p))) throw new ToolError('Unknown position "' + args.position + '". Use QB, RB, WR, TE, K, DEF, DL, LB, DB, FLEX, SUPER_FLEX or IDP.');
  const avail = String(args.availability || 'all').toLowerCase().replace(/[\s-]/g, '_');
  const sort = ['value', 'this_week', 'ppg', 'age', 'season_avg'].includes(String(args.sort)) ? String(args.sort) : 'value';
  const nflTeam = args.nfl_team ? String(args.nfl_team).toUpperCase().trim() : null;
  const limit = clampInt(args.limit, 1, 40, 15);
  const rostered = new Map<string, number>(); L.snapshot.rosters.forEach(r => (r.players || []).forEach(pid => rostered.set(String(pid), r.roster_id)));
  const me = myRoster(L, ctx.memberId); const mine = new Set((me && me.players) || []);
  const meta = L.intel.playerMeta || {}; const scores = L.intel.playerScores || {};
  const posOf = (pid: string) => normPos(meta[pid] && meta[pid].pos || (ctx.players[pid] || {}).pos || '');
  const pool = new Set<string>(Object.keys(scores).filter(pid => Number(scores[pid]) > 0));
  rostered.forEach((_, pid) => pool.add(pid));
  if (avail === 'free_agents' && (sort === 'this_week' || (want && want.some(p => p === 'K' || p === 'DEF')))) for (const pid in ctx.players) { const p = ctx.players[pid]; if (p.t && p.act && (!want || want.includes(normPos(p.pos)))) pool.add(pid); }
  const wk = Number(L.snapshot.proj_week) || 0;
  const weekPts = (pid: string): number | null => { const log = (L.snapshot.games || {})[pid]; const played = log && wk ? log[wk - 1] : null; if (played != null) return played; const pr = (L.snapshot.proj || {})[pid]; return pr != null ? pr : null; };
  const seasonAvg = (pid: string) => { const log = ((L.snapshot.games || {})[pid] || []).filter((x): x is number => x != null); return log.length ? log.reduce((a, b) => a + b, 0) / log.length : null; };
  let ids = [...pool].filter(pid => {
    const p = ctx.players[pid]; if (!p) return false;
    if (want && !want.includes(posOf(pid))) return false;
    if (avail === 'free_agents' && (rostered.has(pid) || !p.t || !p.act)) return false;
    if (avail === 'rostered' && !rostered.has(pid)) return false;
    if (avail === 'mine' && !mine.has(pid)) return false;
    if (nflTeam && String(p.t || '').toUpperCase() !== nflTeam) return false;
    if (args.min_age != null && !(Number(p.age) >= Number(args.min_age))) return false;
    if (args.max_age != null && !(Number(p.age) > 0 && Number(p.age) <= Number(args.max_age))) return false;
    return true;
  });
  const key: Record<string, (pid: string) => number> = {
    value: pid => dhq(L, pid), this_week: pid => weekPts(pid) ?? -1e9, ppg: pid => Number((meta[pid] || {}).ppg) || 0,
    season_avg: pid => seasonAvg(pid) ?? -1e9, age: pid => -(Number((ctx.players[pid] || {}).age) || 99),
  };
  if (sort === 'this_week') ids = ids.filter(pid => weekPts(pid) != null);
  if (sort === 'season_avg') ids = ids.filter(pid => seasonAvg(pid) != null);
  ids.sort((x, y) => key[sort](y) - key[sort](x) || dhq(L, y) - dhq(L, x));
  // Position rank across every valued player in the league's pool.
  const posRank: Record<string, number> = {}; const cnt: Record<string, number> = {};
  Object.keys(scores).filter(pid => Number(scores[pid]) > 0).sort((a, b) => scores[b] - scores[a]).forEach(pid => { const p = posOf(pid); cnt[p] = (cnt[p] || 0) + 1; posRank[pid] = cnt[p]; });
  const rows = ids.slice(0, limit).map((pid, i) => {
    const p = fresh(ctx, pid); const b = seasonBits(ctx, L, pid) as Record<string, any>;
    const rid = rostered.get(pid);
    return strip({
      rank: i + 1, name: p.n || pid, pos: posOf(pid), nfl_team: p.t || 'FA', age: p.age ?? undefined, dhq_value: dhq(L, pid), pos_rank: posRank[pid] ? posOf(pid) + posRank[pid] : undefined,
      dhq_rate_ppg: (meta[pid] || {}).ppg != null ? round1(meta[pid].ppg) : undefined,
      proj_this_week: b.proj_this_week ?? undefined, scored_this_week: b.scored_this_week, season_avg: b.season_avg ?? undefined, season_games: b.season_games,
      injury: p.inj ? p.inj + (p.injp ? ' (' + p.injp + ')' : '') : undefined, rostered_by: rid != null ? (me && me.roster_id === rid ? 'you' : teamName(L, rid)) : 'free agent',
    });
  });
  return {
    league_id: L.league_id, filters: strip({ position: args.position, availability: avail, sort, nfl_team: nflTeam || undefined, min_age: args.min_age, max_age: args.max_age }),
    matches: ids.length, players: rows,
    note: 'dhq_value and dhq_rate_ppg are dynasty numbers; proj_this_week, scored_this_week and season_avg are this season in this league\'s scoring. pos_rank is league-wide by DHQ value.',
    numbers_as_of: L.built_at,
  };
}

// ── definitions ─────────────────────────────────────────────────────────
const S = (d: string) => ({ type: 'string', description: d });
const N = (d: string) => ({ type: 'number', description: d });
const B = (d: string) => ({ type: 'boolean', description: d });
const E = (vals: string[], d: string) => ({ type: 'string', enum: vals, description: d });
const TEAM = 'Team name, owner name, roster id, or "me"';
const def = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) => ({ name, description, inputSchema: { type: 'object', properties: { league_id: S('League id'), ...properties }, required }, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } });
export const LEAGUE_DEFS = [
  def('get_standings', 'The league standings: every team\'s rank, record, points for and against, max (potential) points, division, playoff seed, power rank, tier and window, total DHQ value, FAAB left, waiver order, and (once weeks are played) all-play record, expected wins and schedule luck.', { include_luck: B('Add all-play record, expected wins and luck (default true).') }),
  def('get_schedule', 'One team\'s regular-season schedule (default: mine): every week\'s opponent, result and score for played weeks, this week\'s live score, and future opponents with their record, power rank and tier.', { team: S(TEAM + ' (default: me).'), roster_id: N('Roster id (alternative to team).') }),
  def('get_league_history', 'This league\'s past: champion, runner-up and semifinalists every season, playoff brackets, and all-time records per manager (seasons, W-L, points, titles, runner-ups, playoff trips). Pass a season for one year.', { season: S('One season, e.g. "2024" (default: all).') }),
  def('get_head_to_head', 'Head-to-head between two teams (default: me vs team_b): this season\'s meetings with scores and any still to play, and the all-time regular-season and playoff record between the two managers across past seasons.', { team_a: S(TEAM + ' (default: me).'), team_b: S(TEAM + ' — the opponent.'), roster_id_a: N('Roster id for team_a (optional)'), roster_id_b: N('Roster id for team_b (optional)') }),
  def('get_transactions', 'League moves: trades (every season, today\'s DHQ value per side and who won), waiver claims with FAAB bids (and who they outbid), and free-agent adds/drops this season. Filter by type, team, player, recent weeks or season.', { type: E(['all', 'trade', 'waiver', 'free_agent'], 'Default all.'), team: S(TEAM), roster_id: N('Roster id (alternative to team)'), player: S('Only moves involving this player'), weeks: N('Only the last N weeks of this season'), season: S('Only this season, e.g. "2025" (past seasons: trades only)'), include_failed: B('Also list failed waiver claims (default false)'), limit: N('Max rows (default 20, max 50)') }),
  def('get_draft_info', 'Draft picks: who owns which future picks (every team or one), what picks are worth by round and slot, past rookie draft results (who took whom, value now, hit or miss), and hit rates by round in this league.', { team: S(TEAM + ' (default: every team).'), roster_id: N('Roster id (alternative to team)'), section: E(['all', 'picks', 'values', 'results', 'hit_rates'], 'Default all.'), season: S('Past draft season for results, e.g. "2024"'), round: N('Only this round'), limit: N('Max result rows (default 25, max 60)') }),
  def('search_players', 'League-wide player rankings and filters: by position (or FLEX / SUPER_FLEX / IDP), availability (all, free_agents, rostered, mine), NFL team and age, sorted by DHQ dynasty value, this week\'s projection, season average, DHQ points per game, or age. Answers "top 20 WRs in my league", "best available RB", "youngest QBs".', { position: S('QB, RB, WR, TE, K, DEF, DL, LB, DB, FLEX, SUPER_FLEX or IDP (omit for all)'), availability: E(['all', 'free_agents', 'rostered', 'mine'], 'Default all.'), sort: E(['value', 'this_week', 'season_avg', 'ppg', 'age'], 'value (dynasty, default), this_week (projection or points scored), season_avg (this season), ppg (DHQ dynasty rate), age (youngest first).'), nfl_team: S('NFL team abbreviation, e.g. DEN'), min_age: N('Minimum age'), max_age: N('Maximum age'), limit: N('Rows (default 15, max 40)') }),
];
export const LEAGUE_NAMES = new Set(LEAGUE_DEFS.map(d => d.name));
export function runLeagueTool(ctx: Ctx, L: LeagueRow, name: string, args: any): unknown {
  switch (name) {
    case 'get_standings': return standingsTool(ctx, L, args);
    case 'get_schedule': return scheduleTool(ctx, L, args);
    case 'get_league_history': return historyTool(ctx, L, args);
    case 'get_head_to_head': return headToHeadTool(ctx, L, args);
    case 'get_transactions': return transactionsTool(ctx, L, args);
    case 'get_draft_info': return draftInfoTool(ctx, L, args);
    case 'search_players': return searchPlayersTool(ctx, L, args);
  }
  throw new ToolError('Unknown tool ' + name);
}

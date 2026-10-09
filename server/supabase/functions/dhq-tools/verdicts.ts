// dhq-tools/verdicts.ts — the tools where DHQ decides and the AI narrates.
//
// Each tool here runs the same method the app runs (the lineup solver, the
// team assessor's numbers, the player-action chain, the FAAB bid model) over
// the stored league and the live game-day facts, and returns a verdict with
// its reasons. The AI's job is to explain it, add the news angle, and say
// what to do in Sleeper, not to reassemble the parts. Every result carries
// `method`, the plain-English DHQ method it followed (also served as an MCP
// prompt), so the AI can quote it.
// deno-lint-ignore-file no-explicit-any
import {
  type Ctx, type LeagueRow, type Roster, type ProjLine, ToolError,
  myRoster, rosterOf, teamName, ownerName, dhq, whoRosters, assessOf, leagueRank, round1, pickLabel,
  playerRow, projLine, fresh, teamPlayed, goLive, latestBlurbs, teamNews, resolveOne, NEWS_STEP,
} from './tools.ts';
import { skillText } from './skills.ts';

const engines = () => (globalThis as any).App || {};
const OUT_SET = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'DNP', 'COV']);
const BENCH = new Set(['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'RES']);
const CLOSE_CALL_PTS = 0.5;   // the app's toss-up line (startsit-verdict.js)
const name = (ctx: Ctx, pid: string) => (ctx.players[pid] && ctx.players[pid].n) || pid;
const posOf = (ctx: Ctx, L: LeagueRow, pid: string) => String(((L.intel.playerMeta || {})[pid] || {}).pos || (ctx.players[pid] || {}).pos || '').toUpperCase();

// ── 1. Start / sit and the whole lineup ──────────────────────────────────
// The app's rule, exactly: one number per player (Sleeper's projection in
// this league's scoring), Out/IR/Doubtful and bye players are unavailable,
// players whose game has started are locked where they are, then the
// solver fills the open slots greedily, narrowest slot first. The verdict
// is the biggest swap; under half a point is a toss-up.
type Line = ProjLine & { pts: number | null; available: boolean; locked: boolean; why_unavailable?: string };
function lineFor(ctx: Ctx, L: LeagueRow, pid: string): Line {
  const p = projLine(ctx, L, pid);
  const inj = String((fresh(ctx, pid).inj || '')).toUpperCase();
  const locked = p.scored_this_week != null;
  let available = true, why: string | undefined;
  if (p.nfl_opponent === 'BYE') { available = false; why = 'bye week'; }
  else if (OUT_SET.has(inj) || /^OUT/.test(inj)) { available = false; why = 'ruled ' + (fresh(ctx, pid).inj || 'out'); }
  else if (inj === 'DOUBTFUL' || inj === 'D') { available = false; why = 'Doubtful: DHQ treats doubtful as out (he misses far more often than he plays)'; }
  else if (!locked && p.proj_this_week == null) { available = false; why = 'Sleeper is not projecting him this week'; }
  const pts = locked ? Number(p.scored_this_week) : (available ? Number(p.proj_this_week) : null);
  return { ...p, pts, available, locked, why_unavailable: why };
}
export async function startSit(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  const rid = args.roster_id != null ? Number(args.roster_id) : (me ? me.roster_id : null);
  const r = rosterOf(L, rid);
  if (!r) throw new ToolError('No roster to set a lineup for in ' + L.name + '.');
  const SS = engines().StartSit;
  if (!SS) throw new Error('lineup solver not loaded');
  const named: string[] = [], unknown: string[] = [];
  (args.players || []).slice(0, 6).forEach((q: unknown) => { const pid = resolveOne(ctx, L, q); if (pid) named.push(pid); else unknown.push(String(q)); });
  const pool = (r.players || []).filter(pid => !(r.reserve || []).includes(pid) && !(r.taxi || []).includes(pid));
  const liveAt = await goLive(ctx, L, pool.concat(named));
  const liveRow = ctx.live && ctx.live.matchups[L.league_id] && ctx.live.matchups[L.league_id].find(m => String(m.roster_id) === String(r.roster_id));
  const slotNames: string[] = ((L.snapshot.league && L.snapshot.league.roster_positions) || []).filter((s: string) => !BENCH.has(String(s).toUpperCase()));
  const current: string[] = ((liveRow && liveRow.starters) || r.starters || []).slice(0, slotNames.length).map((x: string) => (x && x !== '0' ? String(x) : ''));
  const lines: Record<string, Line> = {};
  for (const pid of new Set(pool.concat(current.filter(Boolean), named))) lines[pid] = lineFor(ctx, L, pid);
  const val = (pid: string) => (pid && lines[pid] && lines[pid].pts != null ? Number(lines[pid].pts) : 0);
  // Locked starters keep their slot; everything else is solved.
  const lockedSlots = new Set<number>();
  current.forEach((pid, i) => { if (pid && lines[pid] && lines[pid].locked) lockedSlots.add(i); });
  const openSlots = slotNames.map((s, i) => ({ s, i })).filter(x => !lockedSlots.has(x.i));
  const candidates = pool.filter(pid => lines[pid] && !lines[pid].locked && lines[pid].available)
    .map(pid => ({ pid, pos: posOf(ctx, L, pid), positions: (fresh(ctx, pid).fp || [posOf(ctx, L, pid)]).map((x: string) => String(x).toUpperCase()), available: true, pts: val(pid) }));
  const solved = SS.optimalLineupWeekly(candidates, openSlots.map(x => x.s)) as { total: number; starters: Array<{ pid: string; slot: string; pts: number; pos: string }>; slots: Array<{ slot: string; pid: string | null }> };
  const lockedTotal = [...lockedSlots].reduce((t, i) => t + val(current[i]), 0);
  const currentTotal = round1(current.reduce((t, pid) => t + (pid && lines[pid] && (lines[pid].locked || lines[pid].available) ? val(pid) : 0), 0));
  const optimalTotal = round1(lockedTotal + (solved.total || 0));
  const optimalSet = new Set<string>([...lockedSlots].map(i => current[i]).concat(solved.starters.map(s => s.pid)));
  const currentSet = new Set(current.filter(Boolean));
  const outs = current.map((pid, i) => ({ pid, slot: slotNames[i] })).filter(x => x.pid && !lockedSlots.has(slotNames.indexOf(x.slot)) && !optimalSet.has(x.pid));
  const ins = solved.starters.filter(s => !currentSet.has(s.pid));
  const swaps = ins.map((s, i) => { const o = outs.find(x => SS.normSlot(x.slot) === SS.normSlot(s.slot)) || outs[i]; return { slot: s.slot, start: name(ctx, s.pid), start_pts: round1(s.pts), sit: o ? name(ctx, o.pid) : null, sit_pts: o ? round1(val(o.pid)) : 0, gain: round1(s.pts - (o ? val(o.pid) : 0)), sit_reason: o && lines[o.pid] && !lines[o.pid].available ? lines[o.pid].why_unavailable : undefined }; })
    .sort((a, b) => b.gain - a.gain);
  const empty = current.filter(Boolean).length === 0;
  const left = round1(optimalTotal - currentTotal);
  let verdict: string;
  if (empty) verdict = 'Your starting slots are empty: fill them before kickoff.';
  else if (!swaps.length || left <= 0.05) verdict = 'Start who is in: your lineup is already optimal' + (lockedSlots.size ? ' (' + lockedSlots.size + ' slot' + (lockedSlots.size > 1 ? 's are' : ' is') + ' locked)' : '') + '.';
  else {
    const top = swaps[0];
    if (top.sit && top.gain < CLOSE_CALL_PTS) verdict = 'TOSS-UP: ' + top.start + ' vs ' + top.sit + ' at ' + top.slot + ' are within ' + top.gain + ' points (' + top.start_pts + ' vs ' + top.sit_pts + '). Your call; lean to the healthier player and the better news.';
    else verdict = 'THE CALL: start ' + top.start + (top.sit ? ' over ' + top.sit : ' in your empty slot') + ' at ' + top.slot + ' (' + top.start_pts + ' vs ' + top.sit_pts + ', +' + top.gain + ')' + (swaps.length > 1 ? '; ' + (swaps.length - 1) + ' more swap' + (swaps.length > 2 ? 's' : '') + ', +' + left + ' in all.' : '.');
  }
  // Head to head, when the member named players.
  let head_to_head: Record<string, unknown> | undefined;
  if (named.length >= 2) {
    const rows = named.map(pid => lines[pid]);
    const open = rows.filter(x => x.available && !x.locked);
    let call: string;
    if (!open.length) call = 'None of them can be started: ' + rows.map(x => x.name + ' (' + (x.locked ? 'locked, ' + x.this_week : x.why_unavailable) + ')').join('; ') + '.';
    else {
      const best = [...open].sort((a, b) => Number(b.pts) - Number(a.pts));
      const a = best[0], b = best[1];
      const others = rows.filter(x => !open.includes(x)).map(x => x.name + ' is ' + (x.locked ? 'locked (' + x.this_week + ')' : 'not startable: ' + x.why_unavailable));
      if (!b) call = 'Start ' + a.name + ' (' + a.pts + ' projected). ' + others.join('. ') + '.';
      else if (Number(a.pts) - Number(b.pts) < CLOSE_CALL_PTS) call = 'TOSS-UP between ' + a.name + ' (' + a.pts + ') and ' + b.name + ' (' + b.pts + '): under half a point apart. Decide on health and the news.' + (others.length ? ' ' + others.join('. ') + '.' : '');
      else call = 'Start ' + a.name + ' over ' + b.name + ': ' + a.pts + ' vs ' + b.pts + ' projected (+' + round1(Number(a.pts) - Number(b.pts)) + ')' + (a.injury ? '; note ' + a.name + ' is ' + a.injury : '') + '.' + (others.length ? ' ' + others.join('. ') + '.' : '');
    }
    const blurbs = await latestBlurbs(ctx, named);
    head_to_head = { call, players: rows.map(x => ({ ...x, in_optimal_lineup: optimalSet.has(x.id), on_my_roster: pool.includes(x.id) || (r.reserve || []).includes(x.id), latest_news: blurbs[x.id], team_news: teamNews(ctx, x.nfl_team) })) };
  }
  const slotOf = (pid: string) => { const i = current.indexOf(pid); return i >= 0 ? slotNames[i] : 'bench'; };
  const lineup = (pids: Array<{ pid: string; slot: string }>) => pids.map(x => ({ slot: x.slot, player: x.pid ? name(ctx, x.pid) : '(empty)', pos: x.pid ? posOf(ctx, L, x.pid) : undefined, pts: x.pid ? round1(val(x.pid)) : 0, status: x.pid && lines[x.pid] ? (lines[x.pid].locked ? lines[x.pid].this_week : lines[x.pid].available ? 'projected' : 'NOT STARTABLE: ' + lines[x.pid].why_unavailable) : undefined, injury: x.pid && lines[x.pid] ? lines[x.pid].injury : undefined }));
  const optimalByIndex = slotNames.map((s, i) => lockedSlots.has(i) ? { pid: current[i], slot: s } : null);
  const openOrder = openSlots.map(x => x.i);
  solved.slots.forEach((sl, k) => { const idx = openOrder[k]; if (idx != null) optimalByIndex[idx] = { pid: sl.pid || '', slot: slotNames[idx] }; });
  return {
    league_id: L.league_id, week: L.snapshot.proj_week, team: teamName(L, r.roster_id), is_mine: !!(me && me.roster_id === r.roster_id),
    verdict, head_to_head,
    points_left_on_bench: left, lineup_is_optimal: left <= 0.05, current_total: currentTotal, optimal_total: optimalTotal,
    swaps,
    current_lineup: lineup(current.map((pid, i) => ({ pid, slot: slotNames[i] }))),
    optimal_lineup: lineup(optimalByIndex.map((x, i) => x || { pid: '', slot: slotNames[i] })),
    bench: pool.filter(pid => !currentSet.has(pid)).map(pid => ({ player: name(ctx, pid), pos: posOf(ctx, L, pid), pts: lines[pid].pts, status: lines[pid].locked ? lines[pid].this_week : lines[pid].available ? 'projected' : 'not startable: ' + lines[pid].why_unavailable, injury: lines[pid].injury, slot_now: slotOf(pid) })).sort((a, b) => Number(b.pts || 0) - Number(a.pts || 0)),
    not_found: unknown.length ? unknown : undefined,
    before_you_answer: NEWS_STEP, method: skillText('start_sit'), live_as_of: liveAt, numbers_as_of: L.built_at,
  };
}

// ── 2. Roster needs ───────────────────────────────────────────────────────
export function rosterNeeds(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  const rid = args.roster_id != null ? Number(args.roster_id) : (me ? me.roster_id : null);
  const r = rosterOf(L, rid); const a = r ? assessOf(L, r.roster_id) : null;
  if (!r || !a) throw new ToolError('No assessment for roster ' + rid + ' in ' + L.name + '.');
  const positions = Object.entries(a.posAssessment || {}).map(([pos, x]: [string, any]) => ({
    pos, status: x.status, bodies: x.actual, ideal_bodies: x.ideal, quality_starters: x.nflStarters, quality_needed: x.minQuality, starting_slots: x.startingReq,
    top_players: (x.sortedIds || []).slice(0, Math.max(1, (x.startingReq || 1) + 1)).map((pid: string) => name(ctx, pid) + ' (DHQ ' + dhq(L, pid) + ((x.nflStarterIds || []).includes(pid) ? ', quality starter' : '') + ')'),
    read: x.status === 'deficit' ? 'No quality starter here: this is the hole.' : x.status === 'thin' ? (x.nflStarters < x.minQuality ? 'Short of quality starters (' + x.nflStarters + ' of ' + x.minQuality + ').' : 'Enough quality, not enough bodies (' + x.actual + ' of ' + x.ideal + ').') : x.status === 'surplus' ? 'More quality than the lineup needs: tradeable.' : 'Covered.',
  }));
  const needs = (a.needs || []).map((n: any) => n.pos + ' (' + n.urgency + ')');
  const strengths = a.strengths || [];
  const pk = a.picksAssessment || {};
  const todo: string[] = [];
  (a.needs || []).forEach((n: any) => { const x = (a.posAssessment || {})[n.pos] || {}; todo.push((n.urgency === 'deficit' ? 'Priority: ' : '') + 'Add a quality ' + n.pos + ' (you have ' + (x.nflStarters || 0) + ' of the ' + (x.minQuality || 1) + ' the lineup needs). Use find_trade_targets for teams with ' + n.pos + ' surplus, and get_waiver_options position=' + n.pos + '.'); });
  strengths.forEach((pos: string) => { const x = (a.posAssessment || {})[pos] || {}; todo.push(pos + ' is a tradeable surplus: ' + x.nflStarters + ' quality starters for ' + x.minQuality + ' slots. Sell from the back of that room, not the front.'); });
  if (pk.status === 'deficit' || pk.status === 'thin') todo.push('Draft capital is ' + pk.status + ' (' + pk.totalPicks + ' picks over the next ' + (pk.pickYears || []).length + ' drafts, ' + pk.roundsMissing + ' rounds with none). A rebuilding team should fix this first; a contender can live with it.');
  if (a.window === 'CONTENDING') todo.push('Window: contending. Spend future picks and youth for starters who score now.');
  else if (a.window === 'REBUILDING') todo.push('Window: rebuilding. Sell veterans with 1-2 peak years left for picks and players 25 and under.');
  else todo.push('Window: transitioning. Do not pay for both now and later; pick a lane before the deadline.');
  return {
    league_id: L.league_id, team: teamName(L, r.roster_id), owner: ownerName(L, r.roster_id), is_mine: !!(me && me.roster_id === r.roster_id),
    record: (a.wins || 0) + '-' + (a.losses || 0) + (a.ties ? '-' + a.ties : ''), tier: a.tier, tier_basis: a.tierBasis, window: a.window, health_score: a.healthScore, panic_0_to_5: a.panic, power_rank: a.powerRank,
    optimal_lineup_ppg: round1(a.weeklyPts), needs, strengths, positions,
    picks: { status: pk.status, total: pk.totalPicks, ideal: pk.idealTotal, by_year: pk.pickCountByYear, rounds_missing: pk.roundsMissing },
    faab_left: a.faabRemaining, what_to_do: todo, method: skillText('roster_needs'), numbers_as_of: L.built_at,
  };
}

// ── 3. Player outlook (buy / sell / hold) ────────────────────────────────
export async function playerOutlook(ctx: Ctx, L: LeagueRow, args: any) {
  const pid = resolveOne(ctx, L, args.player);
  if (!pid) throw new ToolError('No player matches "' + args.player + '". Try find_players.');
  const m = (L.intel.playerMeta || {})[pid] || {};
  const value = dhq(L, pid); const lr = leagueRank(L, pid);
  const me = myRoster(L, ctx.memberId); const holder = whoRosters(L, pid);
  const owned = !!(me && holder === me.roster_id);
  const peak = Number(m.peakYrsLeft ?? 0), trend = Number(m.trend ?? 0), age = Number(m.age ?? (ctx.players[pid] || {}).age ?? 0);
  const valueYrs = m.declineEnd != null && age ? Number(m.declineEnd) - age : null;
  const pos = posOf(ctx, L, pid);
  const elite = value >= 7000 || (lr != null && lr.pos != null && lr.pos <= 5);
  const idpStarter = /^(DL|LB|DB)$/.test(pos) && Number(fresh(ctx, pid).dco) === 1;
  const pastPeak = m.ageCurvePhase === 'decline' || m.ageCurvePhase === 'post_decline' || (peak <= 0 && m.ageCurvePhase !== 'peak');
  const inBand = pastPeak && valueYrs != null && valueYrs > 0;
  const pastBand = pastPeak && valueYrs != null && valueYrs <= 0;
  let action: string, label: string, reason: string;
  const tp = (trend > 0 ? '+' : '') + trend + '%';
  if (m.source === 'FC_ROOKIE') { action = 'STASH'; label = 'Stash'; reason = 'Incoming rookie: hold and develop.'; }
  else if (elite && peak >= 3) { action = 'CORE'; label = 'Build around'; reason = 'Elite value (DHQ ' + value + ') with ' + peak + ' peak years ahead.'; }
  else if (peak >= 4 && trend >= 10 && !owned) { action = 'BUY'; label = 'Buy'; reason = 'Trending up (' + tp + ') with ' + peak + ' peak years ahead.'; }
  else if (peak >= 4 && trend >= 10) { action = 'HOLD'; label = 'Hold'; reason = 'Rising asset: trending ' + tp + ' with ' + peak + ' peak years ahead. Keep and ride it.'; }
  else if (peak === 1 && value >= 3000) { action = 'SELL_HIGH'; label = 'Sell high'; reason = 'One peak year left at starter value; the market still pays for the name.'; }
  else if (inBand && trend <= -10) { action = 'SELL_HIGH'; label = 'Sell high'; reason = 'In the veteran decline band and production is slipping (' + tp + ').'; }
  else if (inBand) { action = 'HOLD'; label = 'Hold'; reason = valueYrs + ' value year' + (valueYrs === 1 ? '' : 's') + ' left in the veteran band; still useful, not a sell-for-pennies.'; }
  else if (pastBand && idpStarter) { action = 'HOLD'; label = 'Hold'; reason = 'Past the age window but a depth-chart starter: live production outruns the curve.'; }
  else if (pastBand && trend <= -10) { action = 'SELL'; label = 'Sell'; reason = 'Past the value window and declining (' + tp + ').'; }
  else if (pastBand) { action = 'SELL'; label = 'Sell'; reason = 'Past the value window.'; }
  else if (peak <= 2 && trend <= -10) { action = 'SELL_HIGH'; label = 'Sell high'; reason = 'Window closing (' + peak + ' peak years) and production declining (' + tp + ').'; }
  else if (peak >= 2 && value >= 4000) { action = 'HOLD'; label = 'Hold'; reason = peak + ' peak years left at starter value.'; }
  else if (value < 2000 && peak >= 3) { action = 'STASH'; label = 'Stash'; reason = 'Cheap with ' + peak + ' peak years ahead: a roster-spot bet, not a starter.'; }
  else if (!owned && peak >= 2 && value < 5000) { action = 'BUY'; label = 'Buy'; reason = 'Undervalued: ' + peak + ' peak years left under DHQ 5,000.'; }
  else if (peak >= 1) { action = 'HOLD'; label = 'Hold'; reason = peak + ' peak year' + (peak === 1 ? '' : 's') + ' left.'; }
  else { action = 'SELL'; label = 'Sell'; reason = 'Past prime.'; }
  const windowLabel = m.ageCurvePhase === 'peak' ? 'Prime' : (m.ageCurvePhase === 'build' || m.ageCurvePhase === 'developmental') ? 'Rising' : m.ageCurvePhase === 'decline' ? 'Veteran' : m.ageCurvePhase === 'post_decline' ? 'Post-window' : 'Unknown';
  const [blurbs, liveAt] = await Promise.all([latestBlurbs(ctx, [pid]), goLive(ctx, L, [pid])]);
  const row = playerRow(ctx, L, pid);
  return {
    ...row, league_rank: lr ? lr.overall : undefined, pos_rank: lr ? lr.pos : undefined,
    rostered_by: holder ? teamName(L, holder) + (owned ? ' (you)' : '') : 'free agent',
    outlook: { action, label, reason, window: windowLabel, peak_years_left: peak, value_years_left: valueYrs, trend_pct: trend, elite, from_your_side: owned ? 'you own him' : 'you do not own him' },
    inputs_note: 'The outlook is the app\'s own player-action chain: value tier, peak years left, value years left, production trend and ownership. It does not read injuries or news; read latest_news and injury before you repeat it.',
    last_season_ppg: m.lastYearPPG != null ? round1(m.lastYearPPG) : undefined, career_ppg: m.careerPPG != null ? round1(m.careerPPG) : undefined,
    latest_news: blurbs[pid], team_news: teamNews(ctx, fresh(ctx, pid).t),
    method: skillText('player_outlook'), live_as_of: liveAt, numbers_as_of: L.built_at,
  };
}

// ── 4. Compare players ───────────────────────────────────────────────────
export async function comparePlayers(ctx: Ctx, L: LeagueRow, args: any) {
  const ids: string[] = [], unknown: string[] = [];
  (args.players || []).slice(0, 6).forEach((q: unknown) => { const pid = resolveOne(ctx, L, q); if (pid && !ids.includes(pid)) ids.push(pid); else if (!pid) unknown.push(String(q)); });
  if (ids.length < 2) throw new ToolError('Name at least two players to compare.' + (unknown.length ? ' Not found: ' + unknown.join(', ') : ''));
  const liveAt = await goLive(ctx, L, ids);
  const rows = ids.map(pid => { const lr = leagueRank(L, pid); const holder = whoRosters(L, pid); return { ...playerRow(ctx, L, pid), league_rank: lr ? lr.overall : undefined, pos_rank: lr ? lr.pos : undefined, rostered_by: holder ? teamName(L, holder) : 'free agent' } as Record<string, any>; });
  const metrics: Array<{ key: string; label: string; higher: boolean }> = [
    { key: 'dhq_value', label: 'DHQ dynasty value', higher: true }, { key: 'peak_years_left', label: 'peak years left', higher: true }, { key: 'age', label: 'youth', higher: false },
    { key: 'proj_this_week', label: 'this week\'s projection', higher: true }, { key: 'season_avg', label: 'season average', higher: true }, { key: 'dhq_rate_ppg', label: 'long-run rate', higher: true },
  ];
  const leads: Record<string, number> = {}; ids.forEach(pid => { leads[pid] = 0; });
  const by_metric = metrics.map(mt => {
    const have = rows.filter(r => typeof r[mt.key] === 'number');
    if (have.length < 2) return { metric: mt.label, leader: null };
    const best = have.reduce((a, b) => (mt.higher ? b[mt.key] > a[mt.key] : b[mt.key] < a[mt.key]) ? b : a);
    const tie = have.filter(r => r[mt.key] === best[mt.key]).length > 1;
    if (!tie) leads[best.id]++;
    return { metric: mt.label, leader: tie ? 'tie' : best.name, values: Object.fromEntries(have.map(r => [r.name, r[mt.key]])) };
  });
  const byValue = [...rows].sort((a, b) => (b.dhq_value || 0) - (a.dhq_value || 0));
  const top = byValue[0], second = byValue[1];
  const gapPct = top.dhq_value ? Math.round(((top.dhq_value - (second.dhq_value || 0)) / top.dhq_value) * 100) : 0;
  const runway = (r: any) => Number(r.peak_years_left ?? 0);
  let verdict: string;
  if (gapPct >= 10) verdict = top.name + ' is the better dynasty asset: DHQ ' + top.dhq_value + ' vs ' + second.dhq_value + ' (' + gapPct + '% gap)' + (runway(second) - runway(top) >= 2 ? ', though ' + second.name + ' has the longer runway (' + runway(second) + ' vs ' + runway(top) + ' peak years)' : '') + '.';
  else if (runway(top) !== runway(second) && Math.abs(runway(top) - runway(second)) >= 2) { const longer = runway(top) > runway(second) ? top : second; verdict = 'Close on value (DHQ ' + top.dhq_value + ' vs ' + second.dhq_value + '); ' + longer.name + ' has the longer runway (' + runway(longer) + ' peak years), which tips it for a dynasty roster.'; }
  else verdict = 'Too close to call on dynasty value (DHQ ' + top.dhq_value + ' vs ' + second.dhq_value + ') and runway. For a lineup decision use get_start_sit; for a trade, the one who fits the roster need wins.';
  return { league_id: L.league_id, verdict, leads: Object.fromEntries(ids.map(pid => [name(ctx, pid), leads[pid]])), by_metric, players: rows, not_found: unknown.length ? unknown : undefined, method: skillText('compare_players'), live_as_of: liveAt, numbers_as_of: L.built_at };
}

// ── 5. Find trade targets ────────────────────────────────────────────────
// The Trade Center's partner board, from stored intel: roster fit, mutual
// need, their panic, their pick capital, their trade activity, their DNA,
// and whether your windows line up. Then the specific players on each
// partner's roster that fill your needs, and the chips you can pay with.
export function findTradeTargets(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const mine = assessOf(L, me.roster_id);
  if (!mine) throw new ToolError('No assessment for your team yet.');
  const te = ctx.te;
  const want: string[] = args.position ? [String(args.position).toUpperCase()] : (mine.needs || []).map((n: any) => n.pos);
  const DNA_SCORE: Record<string, number> = { FLEECER: -15, DOMINATOR: -18, STALWART: 4, ACCEPTOR: 8, DESPERATE: 10 };
  const partners = (L.snapshot.rosters || []).filter(r => r.roster_id !== me.roster_id).map(r => {
    const them = assessOf(L, r.roster_id); if (!them) return null;
    const dna = (L.dna || {})[String(r.roster_id)] || null; const dnaKey = dna ? dna.key : 'NONE'; const conf = dna ? Number(dna.confidence || 0) / 100 : 0;
    const compat = Number(te.calcComplementarity(mine, them)) || 0;
    const mutual = (them.needs || []).filter((n: any) => (mine.strengths || []).includes(n.pos)).length;
    const theyHave = (mine.needs || []).filter((n: any) => (them.strengths || []).includes(n.pos)).length;
    const panicScore = Math.min(8, Number(them.panic || 0) * 2);
    const pickCapital = ((L.snapshot.picks || {})[String(r.roster_id)] || []).reduce((t, p) => t + (Number(p.value) || 0), 0);
    const pickCapitalScore = Math.min(5, Math.round(pickCapital / 4200));
    const trades = Number(((L.intel.ownerProfiles || {})[String(r.roster_id)] || {}).trades || 0);
    const posture = te.calcOwnerPosture(them, dnaKey);
    const fit = (mine.window === 'CONTENDING' && them.window === 'REBUILDING') || (mine.window === 'REBUILDING' && them.window === 'CONTENDING') ? 14 : 3;
    const dnaScore = (DNA_SCORE[dnaKey] || 0) * conf;
    const raw = compat * 0.62 + mutual * 13 + theyHave * 10 + panicScore + pickCapitalScore + Math.min(7, trades) + fit + dnaScore + (posture.key === 'LOCKED' ? -18 : 0);
    const cap = compat >= 80 ? 99 : compat >= 65 ? 94 : compat >= 50 ? 88 : compat >= 35 ? 78 : 68;
    const score = Math.max(0, Math.min(cap, Math.round(raw)));
    const tag = score >= 85 ? 'Attack' : score >= 68 ? 'Prime' : score >= 48 ? 'Possible' : Number(them.panic || 0) >= 3 ? 'Monitor' : 'Long shot';
    const targets = want.flatMap(pos => (((them.posAssessment || {})[pos] || {}).sortedIds || []).filter((pid: string) => dhq(L, pid) >= (/^(DL|LB|DB|K|DEF)$/.test(pos) ? 500 : 2000)).slice(0, 2).map((pid: string) => ({ player: name(ctx, pid), pos, dhq_value: dhq(L, pid), age: (ctx.players[pid] || {}).age, their_status_at_pos: ((them.posAssessment || {})[pos] || {}).status })));
    const reasons: string[] = [];
    if (mutual) reasons.push('your surplus matches ' + mutual + ' of their needs');
    if (theyHave) reasons.push('they have surplus at ' + theyHave + ' of your needs');
    reasons.push(compat + '% roster fit');
    if (dna) reasons.push(dnaKey.toLowerCase() + ' DNA (' + Math.round(conf * 100) + '% sure): ' + String(dna.reasoning || '').slice(0, 120));
    if (Number(them.panic || 0) >= 3) reasons.push('panic ' + them.panic + ' of 5: a hurting team deals');
    if (posture.key === 'LOCKED') reasons.push('locked roster: elite and calm, hard to move');
    if (fit === 14) reasons.push('your windows line up (' + mine.window.toLowerCase() + ' vs ' + them.window.toLowerCase() + ')');
    return { roster_id: r.roster_id, team: teamName(L, r.roster_id), owner: ownerName(L, r.roster_id), score, tag, tier: them.tier, window: them.window, posture: posture.label, their_needs: (them.needs || []).map((n: any) => n.pos + ' (' + n.urgency + ')'), their_strengths: them.strengths || [], pick_capital_dhq: Math.round(pickCapital), trades_made: trades, targets_for_you: targets, reasons };
  }).filter(Boolean).sort((a: any, b: any) => b.score - a.score) as any[];
  const chips = (mine.strengths || []).flatMap((pos: string) => { const x = (mine.posAssessment || {})[pos] || {}; return (x.sortedIds || []).slice(Math.max(1, x.minQuality || 1)).slice(0, 2).map((pid: string) => ({ player: name(ctx, pid), pos, dhq_value: dhq(L, pid), why: 'beyond the ' + x.minQuality + ' quality ' + pos + ' your lineup needs' })); });
  const myPicks = ((L.snapshot.picks || {})[String(me.roster_id)] || []).map(pk => pickLabel(pk, me.roster_id, L) + ' · DHQ ' + pk.value);
  return {
    league_id: L.league_id, my_team: teamName(L, me.roster_id), my_window: mine.window, my_needs: (mine.needs || []).map((n: any) => n.pos + ' (' + n.urgency + ')'), looking_for: want,
    partners: partners.slice(0, Number(args.limit) || 6),
    my_chips: chips, my_picks: myPicks,
    how_to_use: 'Pick a partner, build a package from targets_for_you and my_chips or my_picks, then run evaluate_trade for the grade and acceptance chance. Pay rebuilders in picks and youth; pay contenders in starters.',
    method: skillText('trade_targets'), numbers_as_of: L.built_at,
  };
}

// ── 6. Draft board (the league's next rookie draft) ──────────────────────
export function draftBoard(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  const picks = L.snapshot.picks || {};
  const years = [...new Set(Object.values(picks).flat().map(p => Number(p.year)))].sort();
  const year = args.year ? Number(args.year) : years[0];
  if (!year) throw new ToolError('No upcoming draft picks are stored for ' + L.name + ' yet.');
  const rounds = Number((L.snapshot.league && L.snapshot.league.settings && L.snapshot.league.settings.draft_rounds) || 0) || undefined;
  const byTeam = (L.snapshot.rosters || []).map(r => {
    const mine = (picks[String(r.roster_id)] || []).filter(p => Number(p.year) === year).sort((a, b) => a.round - b.round);
    return { roster_id: r.roster_id, team: teamName(L, r.roster_id), is_mine: !!(me && me.roster_id === r.roster_id), tier: (assessOf(L, r.roster_id) || {}).tier, picks: mine.map(p => pickLabel(p, r.roster_id, L) + ' · DHQ ' + p.value), capital_dhq: Math.round(mine.reduce((t, p) => t + (Number(p.value) || 0), 0)) };
  }).sort((a, b) => b.capital_dhq - a.capital_dhq);
  const hit = L.intel.hitRateByRound || {};
  const hitRates = Object.entries(hit).map(([rd, x]: [string, any]) => ({ round: Number(rd), picks_seen: x.total, became_starter_pct: x.rate, became_elite_pct: x.eliteRate, best_positions: (x.bestPos || []).slice(0, 3).map((b: any) => b.pos + ' ' + b.rate + '%') }));
  const adp = L.intel.adpByPos || {};
  const tendencies = Object.entries(adp).map(([pos, x]: [string, any]) => ({ pos, avg_pick: x.avgPick, drafted: x.count, first_taken_in_round: x.topRound }));
  return {
    league_id: L.league_id, draft_year: year, rounds, teams: (L.snapshot.rosters || []).length,
    order_note: 'Slots come from Sleeper\'s draft order when it is set, otherwise from the team\'s waiver position (a stand-in for finishing order). Values are DHQ pick values for this league, discounted 12% per year out.',
    picks_by_team: byTeam, my_picks: byTeam.find(t => t.is_mine) || null,
    this_league_hit_rates_by_round: hitRates, what_this_league_drafts_early: tendencies,
    prospects: 'Prospect rankings are not served here yet; this is the league\'s pick picture. Use get_pick_values for a slot\'s worth.',
    method: skillText('draft_board'), numbers_as_of: L.built_at,
  };
}

// ── 7. FAAB bid ──────────────────────────────────────────────────────────
// The Free Agency screen's bid model: what this league pays for a player of
// this strength, which rivals need the position and how hard they bid, and
// the smallest bid that clears 60% of them.
export function waiverBid(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const pid = resolveOne(ctx, L, args.player);
  if (!pid) throw new ToolError('No player matches "' + args.player + '". Try find_players.');
  const F = engines().Faab;
  if (!F) throw new Error('bid model not loaded');
  if (!L.snapshot.txns) throw new ToolError('This league\'s waiver history is not stored yet; the bid model will work after the next engine build (within two hours).');
  const playersData: Record<string, any> = {};
  for (const [id, p] of Object.entries(ctx.players)) { const f = fresh(ctx, id); playersData[id] = { player_id: id, position: p.pos, fantasy_positions: p.fp || [p.pos], injury_status: f.inj, team: f.t, status: f.st }; }
  const league = { settings: (L.snapshot.league && L.snapshot.league.settings) || {}, rosters: L.snapshot.rosters, roster_positions: (L.snapshot.league && L.snapshot.league.roster_positions) || [], users: L.snapshot.users };
  const pos = posOf(ctx, L, pid);
  const est = F.estimate({ league, myRosterId: me.roster_id, txns: L.snapshot.txns, playersData, targetPid: pid, targetPos: pos, dhq: dhq(L, pid), playerValue: (id: string) => dhq(L, id) });
  if (!est) throw new ToolError('No bid estimate: this is not a FAAB league, or the budget is spent.');
  const an = est.analysis || {};
  const pays = (L.intel.faabByPos || {})[pos];
  return {
    league_id: L.league_id, player: name(ctx, pid), pos, dhq_value: dhq(L, pid), rostered_by: whoRosters(L, pid) ? teamName(L, whoRosters(L, pid)) + ' (not a free agent)' : 'free agent',
    suggested_bid: est.sug, range: { low: est.lo, high: est.hi, high_capped_by_budget: !!est.hiCapped }, win_chance_pct_at_suggested: est.winPct != null ? Math.round(Number(est.winPct) * 100) : undefined, capped_by_spend_rule: !!est.capped,
    my_faab_left: est.myLeft, budget: est.budget, league_min_bid: est.minBid,
    cold_start: !!est.coldStart, bids_seen_this_season: est.sampleSize,
    rivals: (an.rivals || []).slice(0, 8), ladder: (an.ladder || []).map((x: any) => ({ bid: x.bid, win_pct: Math.round(Number(x.winPct) * 100) })),
    what_this_league_pays_at_pos: pays ? { typical: pays.median, average: pays.avg, p75: pays.p75, bids_seen: pays.count } : undefined,
    method: skillText('waiver_bid'), numbers_as_of: L.built_at,
  };
}

const S = (d: string) => ({ type: 'string', description: d });
const A = (d: string) => ({ type: 'array', items: { type: 'string' }, description: d });
const N = (d: string) => ({ type: 'number', description: d });
const def = (n: string, d: string, props: Record<string, unknown>, required: string[] = []) => ({ name: n, description: d, inputSchema: { type: 'object', properties: { league_id: S('League id'), ...props }, required } });
export const VERDICT_DEFS = [
  def('get_start_sit', 'DHQ\'s lineup verdict, the same call the app\'s Lineup screen makes: the optimal lineup for this week in this league\'s scoring, the swaps to get there, and THE CALL (the biggest one). Name two or more players to get a head-to-head call between them. Players whose game has started are locked; Out, Doubtful and bye players cannot start. Returns the method it followed. Use this for every "who do I start" question instead of comparing projections yourself.', { players: A('Optional: players to decide between (names or ids)'), roster_id: N('Optional: another roster in the league') }),
  def('get_roster_needs', 'DHQ\'s read of a team: tier, window, health, panic, every position\'s status (deficit, thin, ok, surplus) with the quality-starter counts behind it, draft capital, and what to do about it.', { roster_id: N('Optional: defaults to the member\'s team') }),
  def('get_player_outlook', 'DHQ\'s buy / sell / hold call on one player for this league (the app\'s player-action chain over value tier, peak years, value years, trend and ownership), with the latest news and this season\'s line.', { player: S('Player name or id') }, ['player']),
  def('compare_players', 'Side by side for 2-6 players in this league: dynasty value, peak years, age, this week, season average, long-run rate, who leads each, and a verdict.', { players: A('Player names or ids (2-6)') }, ['players']),
  def('find_trade_targets', 'The Trade Center\'s partner board for the member: which owners to call and why (roster fit, mutual need, panic, pick capital, DNA, windows), the specific players on their rosters that fill your needs, and the chips you can pay with. Follow up with evaluate_trade on a package.', { position: S('Optional: a position you are shopping for'), limit: N('Partners to return (default 6)') }),
  def('get_draft_board', 'The league\'s next rookie draft: every team\'s picks and their DHQ worth, your picks, this league\'s hit rates by round and what it drafts early. Prospect rankings are not included yet.', { year: N('Optional draft year (default: the next draft)') }),
  def('get_waiver_bid', 'A FAAB bid for a free agent from the Free Agency screen\'s model: what this league pays, which rivals need the position and how hard they bid, the smallest bid that clears 60% of them, and the range.', { player: S('Free agent name or id') }, ['player']),
];
export async function runVerdict(ctx: Ctx, L: LeagueRow, name: string, args: any): Promise<unknown> {
  switch (name) {
    case 'get_start_sit': return startSit(ctx, L, args);
    case 'get_roster_needs': return rosterNeeds(ctx, L, args);
    case 'get_player_outlook': return playerOutlook(ctx, L, args);
    case 'compare_players': return comparePlayers(ctx, L, args);
    case 'find_trade_targets': return findTradeTargets(ctx, L, args);
    case 'get_draft_board': return draftBoard(ctx, L, args);
    case 'get_waiver_bid': return waiverBid(ctx, L, args);
  }
  throw new ToolError('Unknown tool: ' + name);
}
export const VERDICT_NAMES = new Set(VERDICT_DEFS.map(d => d.name));
export type { Roster };

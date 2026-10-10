// dhq-tools/decide-roster.ts — roster spots, cuts, IR/taxi and the waiver
// decision, shared by roster_plan and get_waiver_plan (and the in-season bid
// history get_waiver_bid reads).
//
// Ported from the Lab (v6-hub js/shared/ask-tools-roster.js and
// ask-tools-players.js get_waiver_plan, 2026-10-10).
//
// THE ONE DROP RULE (both tools use it):
//   1. Only ACTIVE roster players can be drops (taxi and IR free no spot).
//   2. Never a starter, a player whose game has started, a handcuff to the
//      member's own starting RB/QB, a young riser (≤1 year in the league, or
//      ≤24 with 3+ peak years; not kickers), the last healthy active body at
//      a dedicated slot, an injured player worth 500+ (a stash), or anyone
//      whose 0 is an engine gap while he holds an NFL role.
//   3. No NFL team goes first (a dead roster spot), then lowest keep score:
//      value + 50 × this week's projection + 300 upside (dynasty; kickers get
//      no upside); projection only in redraft.
// (The Lab also honours the member's own player tags; the connector can't
// see them, so they are not applied here.)
//
// IR / INACTIVE FALLBACK VALUE: Sleeper marks injured-reserve players
// status 'Inactive', and the engine caps an Inactive player's value to 0.
// The engine still keeps his dynasty points per game (playerMeta.ppg), age
// and position, so his healthy-equivalent value is the MEDIAN DHQ value of
// the five active players at his position closest to him in dynasty ppg
// (relative gap) and age (gap ÷ 6), labeled value_source 'ir_fallback' with
// the peers named. No ppg → 'unknown'. A player the engine never scored is
// 'unscored': value unknown, never 0.
//
// WAIVER BIDS are in-season only: Sleeper files every March–September
// offseason claim under week 1, which dragged the Psycho League's bid
// percentiles down by half. Claims made before the regular-season start are
// left out.
// deno-lint-ignore-file no-explicit-any
import { type Ctx, type LeagueRow, type Roster, ToolError, myRoster, assessOf, dhq, fresh, round1 } from './tools.ts';
import { normPos, metaOf, posOf, pname, valueOf, label, holderOf, injuryText, weekPts, gameStarted, weekNow, leaguePositions, posSet, POS_ALL } from './decide-common.ts';
import { skillText } from './skills.ts';

const engines = () => (globalThis as any).App || {};
const PEERS = 5, MIN_PEERS = 3, AGE_SPAN = 6;
const STASH_VALUE = 500;
const UPSIDE_BONUS = 300, PROJ_WEIGHT = 50;
const INJ_OUT = new Set(['OUT', 'DOUBTFUL', 'IR', 'PUP', 'SUS', 'NA', 'COV', 'DNR']);
const IR_KEYS: Record<string, string> = { OUT: 'reserve_allow_out', DOUBTFUL: 'reserve_allow_doubtful', SUS: 'reserve_allow_sus', NA: 'reserve_allow_na', COV: 'reserve_allow_cov', DNR: 'reserve_allow_dnr' };
const settingsOf = (L: LeagueRow): Record<string, any> => ((L.snapshot.league || {}).settings || {});
const injOf = (ctx: Ctx, pid: string) => String(fresh(ctx, pid).inj || '').toUpperCase();
const isDynasty = (L: LeagueRow) => Number(settingsOf(L).type) !== 0;   // Sleeper: 0 redraft, 1 keeper, 2 dynasty
const noUndef = (o: Record<string, any>) => { Object.keys(o).forEach(k => { if (o[k] === undefined || o[k] === null || o[k] === '') delete o[k]; }); return o; };

// ── Value with the IR fallback ───────────────────────────────────────────
function isInactive(ctx: Ctx, L: LeagueRow, pid: string) {
  const st = String(fresh(ctx, pid).st || '');
  if (st.toLowerCase() === 'retired') return false;
  return /inactive/i.test(st) || metaOf(L, pid).statusCode === 'inactive';
}
export function peerValue(ctx: Ctx, L: LeagueRow, pid: string) {
  const m = metaOf(L, pid);
  const pos = posOf(ctx, L, pid);
  const ppg = Number(m.ppg) || 0;
  const age = Number(m.age || (ctx.players[pid] || {}).age) || 0;
  if (!(ppg > 0) || !(age > 0) || !pos) return null;
  const sc = L.intel.playerScores || {}, meta = L.intel.playerMeta || {};
  const rows: Array<{ pid: string; v: number; d: number }> = [];
  for (const q in sc) {
    const v = Number(sc[q]);
    if (!(v > 0) || q === String(pid)) continue;
    const mq = meta[q];
    if (!mq || (mq.statusCode && mq.statusCode !== 'active')) continue;
    if (posOf(ctx, L, q) !== pos) continue;
    const qp = Number(mq.ppg) || 0, qa = Number(mq.age || (ctx.players[q] || {}).age) || 0;
    if (!(qp > 0) || !(qa > 0)) continue;
    rows.push({ pid: q, v, d: Math.abs(qp - ppg) / Math.max(1, ppg) + Math.abs(qa - age) / AGE_SPAN });
  }
  if (rows.length < MIN_PEERS) return null;
  rows.sort((a, b) => a.d - b.d || b.v - a.v);
  const near = rows.slice(0, PEERS);
  const vals = near.map(r => r.v).sort((a, b) => a - b);
  const mid = vals.length % 2 ? vals[(vals.length - 1) / 2] : Math.round((vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2);
  return { value: Math.round(mid), ppg: round1(ppg), age, peers: near.map(r => pname(ctx, r.pid) + ' ' + Math.round(r.v)) };
}
// { value, value_source: 'dhq' | 'ir_fallback' | 'unknown' | 'unscored', basis? }
export function valueRead(ctx: Ctx, L: LeagueRow, pid: string): { value: number | null; value_source: string; basis?: string } {
  pid = String(pid);
  const sc = L.intel.playerScores || {};
  const v = Math.round(Number(sc[pid]) || 0);
  if (v > 0) return { value: v, value_source: 'dhq' };
  if (isInactive(ctx, L, pid)) {
    const f = peerValue(ctx, L, pid);
    if (f) return { value: f.value, value_source: 'ir_fallback', basis: 'engine shows 0 because Sleeper lists him Inactive (IR); healthy-equivalent = median of the ' + f.peers.length + ' active ' + posOf(ctx, L, pid) + 's closest in dynasty ppg (' + f.ppg + ') and age (' + f.age + '): ' + f.peers.join(', ') };
    return { value: null, value_source: 'unknown', basis: 'engine shows 0 because Sleeper lists him Inactive (IR), and there is no production on file to rebuild a value from' };
  }
  if (!(pid in sc)) return { value: null, value_source: 'unscored', basis: 'the value engine has no number for him (not scored), which is not the same as worthless' };
  return { value: 0, value_source: 'dhq' };
}

// ── League rules ─────────────────────────────────────────────────────────
export function irEligibility(ctx: Ctx, L: LeagueRow, pid: string): { eligible: boolean | null; why: string } {
  const st = settingsOf(L);
  const s = injOf(ctx, pid);
  if (s === 'IR') return { eligible: true, why: 'Listed IR' };
  if (IR_KEYS[s]) {
    const ok = Number(st[IR_KEYS[s]]) === 1;
    return { eligible: ok, why: ok ? 'League allows ' + s + ' on IR' : s + ' is not IR-eligible in this league (' + IR_KEYS[s] + ' = 0)' };
  }
  if (s === 'PUP') return { eligible: null, why: 'PUP: IR eligibility on Sleeper not verified' };
  return { eligible: false, why: s ? 'Listed ' + fresh(ctx, pid).inj + ', not an IR designation' : 'Healthy' };
}
export function rosterCounts(L: LeagueRow, r: Roster) {
  const st = settingsOf(L);
  const all = (r.players || []).map(String), taxi = (r.taxi || []).map(String), ir = (r.reserve || []).map(String);
  const active = all.filter(pid => !taxi.includes(pid) && !ir.includes(pid));
  const max = (((L.snapshot.league || {}).roster_positions || []) as string[]).filter(s => !/^(IR|TAXI)$/i.test(String(s))).length || null;
  return { active: active.length, max, open: max != null ? max - active.length : null, taxi: taxi.length, taxi_max: Number(st.taxi_slots) || 0, ir: ir.length, ir_max: Number(st.reserve_slots) || 0, activeIds: active, taxiIds: taxi, irIds: ir };
}
// Dedicated starting slots per position (FLEX slots never make a player the "last body").
export function dedicatedSlots(L: LeagueRow) {
  const out: Record<string, number> = {};
  (((L.snapshot.league || {}).roster_positions || []) as string[]).forEach(s => {
    const k = String(s).toUpperCase();
    if (/FLEX|^BN$|^IR$|^TAXI$/.test(k)) return;
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

// ── Handcuffs: the NFL backup to each of the member's starting RBs / QBs ──
let depthMemo: { src: unknown; L: unknown; map: Record<string, string[]> } | null = null;
function depthIndex(ctx: Ctx, L: LeagueRow) {
  if (depthMemo && depthMemo.src === ctx.players && depthMemo.L === L) return depthMemo.map;
  const map: Record<string, string[]> = {};
  for (const pid in ctx.players) {
    const p = ctx.players[pid];
    if (!p || !p.t || p.act === false || p.dco == null) continue;
    const pos = posOf(ctx, L, pid);
    if (pos !== 'RB' && pos !== 'QB') continue;
    const k = p.t + '|' + pos + '|' + Number(p.dco);
    (map[k] = map[k] || []).push(pid);
  }
  depthMemo = { src: ctx.players, L, map };
  return map;
}
export function handcuffs(ctx: Ctx, L: LeagueRow, r: Roster) {
  const me = myRoster(L, ctx.memberId);
  const out: Array<{ starter: string; backup: string; pos: string; nfl_team: string; owner: string }> = [];
  const idx = depthIndex(ctx, L);
  (r.starters || []).map(String).filter(x => x && x !== '0').forEach(sid => {
    const p = fresh(ctx, sid), pos = posOf(ctx, L, sid);
    if ((pos !== 'RB' && pos !== 'QB') || !p.t || Number(p.dco) !== 1) return;
    (idx[p.t + '|' + pos + '|2'] || []).forEach(bid => {
      const holder = holderOf(L, bid);
      out.push({ starter: sid, backup: bid, pos, nfl_team: String(p.t), owner: holder ? (me && holder.roster_id === me.roster_id ? 'me' : label(L, holder.roster_id)) : 'free agent' });
    });
  });
  return out;
}

// ── The one drop list ────────────────────────────────────────────────────
export function keepScore(ctx: Ctx, L: LeagueRow, pid: string, vr: { value: number | null }) {
  const proj = Number(weekPts(ctx, L, pid)) || 0;
  if (!isDynasty(L)) return round1(proj * 100);
  const m = metaOf(L, pid), p = ctx.players[pid] || ({} as any);
  const upside = posOf(ctx, L, pid) !== 'K' && (Number(p.yrs) <= 1 || Number(m.peakYrsLeft) >= 3) ? UPSIDE_BONUS : 0;
  return Math.round((vr.value || 0) + proj * PROJ_WEIGHT + upside);
}
function youngRiser(ctx: Ctx, L: LeagueRow, pid: string) {
  const p = ctx.players[pid] || ({} as any), m = metaOf(L, pid);
  if (posOf(ctx, L, pid) === 'K') return false;
  return Number(p.yrs) <= 1 || (Number(p.age) > 0 && Number(p.age) <= 24 && Number(m.peakYrsLeft) >= 3);
}
function row(ctx: Ctx, L: LeagueRow, pid: string, extra?: Record<string, unknown>) {
  const vr = valueRead(ctx, L, pid);
  return Object.assign({ player: pname(ctx, pid), pos: posOf(ctx, L, pid), nfl_team: fresh(ctx, pid).t || 'FA', value: vr.value, value_source: vr.value_source }, vr.basis ? { value_basis: vr.basis } : {}, extra || {});
}
type Cand = Record<string, any> & { pid: string; rank_key: number; keep_score: number };
export function cutPlan(ctx: Ctx, L: LeagueRow, r: Roster) {
  const counts = rosterCounts(L, r);
  const starters = new Set((r.starters || []).map(String));
  const cuffs = handcuffs(ctx, L, r).filter(c => c.owner === 'me');
  const cuffOf: Record<string, string> = {};
  cuffs.forEach(c => { cuffOf[c.backup] = c.starter; });
  const A: any = assessOf(L, r.roster_id) || {};
  const contending = /CONTEND/i.test(String(A.window || ''));
  const slots = dedicatedSlots(L);
  const healthyAt: Record<string, number> = {};
  counts.activeIds.forEach(pid => { if (!INJ_OUT.has(injOf(ctx, pid))) { const pos = posOf(ctx, L, pid); healthyAt[pos] = (healthyAt[pos] || 0) + 1; } });
  const candidates: Cand[] = [], keep: Array<Record<string, any>> = [];
  counts.activeIds.forEach(pid => {
    const vr = valueRead(ctx, L, pid);
    const p = fresh(ctx, pid);
    const proj = weekPts(ctx, L, pid);
    const inj = injOf(ctx, pid);
    const keepIf = (reason: string) => { keep.push(Object.assign({ pid }, row(ctx, L, pid, { reason }))); };
    if (!p.t) return candidates.push(Object.assign({ pid, rank_key: -2, keep_score: keepScore(ctx, L, pid, vr) }, row(ctx, L, pid, { why: 'No NFL team' + (inj ? ' (' + p.inj + ')' : '') + ': a dead roster spot.', keep_score: keepScore(ctx, L, pid, vr) })));
    if (starters.has(pid)) return;                                         // starters are never drops
    if (gameStarted(ctx, pid)) return keepIf('His game has started; he can\'t be dropped until it ends.');
    if (cuffOf[pid]) return keepIf('Handcuff: backs up your starter ' + pname(ctx, cuffOf[pid]) + ' (' + p.t + ' ' + posOf(ctx, L, pid) + '2)' + (contending ? '; you\'re contending, so keep the insurance.' : '.'));
    if (vr.value_source === 'ir_fallback' || vr.value_source === 'unknown') {
      const el = irEligibility(ctx, L, pid);
      return keepIf('Injured stash (' + (p.inj || 'Inactive') + '): the engine\'s 0 is an IR gap, not his worth' + (el.eligible ? '; move him to IR instead of cutting.' : '.'));
    }
    if (vr.value_source === 'unscored' && (Number(p.dco) === 1 || (proj != null && proj >= 3))) {
      return keepIf('No engine value, but he has an NFL role (' + p.t + (p.dco != null ? ' depth #' + p.dco : '') + (proj != null ? ', projects ' + round1(proj) : '') + '). Unknown value is not zero.');
    }
    if (youngRiser(ctx, L, pid)) return keepIf('Young upside (age ' + ((ctx.players[pid] || {}).age || '?') + ', ' + ((ctx.players[pid] || {}).yrs != null ? (ctx.players[pid] || {}).yrs + ' yrs in the NFL' : 'rookie') + ').');
    if (INJ_OUT.has(inj) && (vr.value || 0) >= STASH_VALUE) { const el = irEligibility(ctx, L, pid); return keepIf('Injured (' + p.inj + ') but worth ' + vr.value + ': hold him through it' + (el.eligible === false ? ' (' + el.why + ').' : '.')); }
    const pos = posOf(ctx, L, pid);
    if (slots[pos] && !INJ_OUT.has(inj) && (healthyAt[pos] || 0) - 1 < slots[pos]) return keepIf('Last healthy active ' + pos + ' for your ' + slots[pos] + ' ' + pos + ' slot' + (slots[pos] > 1 ? 's' : '') + '.');
    const why: string[] = [];
    if (vr.value_source === 'unscored') why.push('no engine value and no NFL role');
    else why.push('value ' + (vr.value || 0));
    why.push(proj != null ? (gameStarted(ctx, pid) ? 'scored ' : 'projects ') + round1(proj) + ' this week' : 'no projection this week');
    if (Number(metaOf(L, pid).trend) <= -30) why.push('trend ' + metaOf(L, pid).trend + '%');
    if (inj) why.push(String(p.inj));
    candidates.push(Object.assign({ pid, rank_key: 0, keep_score: keepScore(ctx, L, pid, vr) }, row(ctx, L, pid, { why: why.join(', ') + '.', keep_score: keepScore(ctx, L, pid, vr) })));
  });
  candidates.sort((a, b) => a.rank_key - b.rank_key || a.keep_score - b.keep_score);
  return { candidates, keep, counts, cuffs, window: A.window || null };
}
const strip = (x: Record<string, any>) => { const o = Object.assign({}, x); delete o.pid; delete o.rank_key; return o; };

// ── roster_plan ──────────────────────────────────────────────────────────
export function rosterPlan(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  void args;
  const st = settingsOf(L);
  const plan = cutPlan(ctx, L, me);
  const c = plan.counts;
  const wk = weekNow(L);
  // IR moves: active players who can go to IR now, and IR players who must come off before Sleeper allows any add.
  const ir_moves: Array<Record<string, any>> = [];
  const irRoom = c.ir_max - c.ir;
  c.activeIds.forEach(pid => {
    if (!INJ_OUT.has(injOf(ctx, pid))) return;
    const el = irEligibility(ctx, L, pid);
    const room = irRoom > 0;
    ir_moves.push(Object.assign(row(ctx, L, pid), { to: 'IR', eligible: el.eligible === true ? room : el.eligible, why: el.why + (el.eligible === true ? (room ? '; frees an active spot' : '; but IR is full (' + c.ir + '/' + c.ir_max + ')') : '') + '.' }));
  });
  c.irIds.forEach(pid => {
    const el = irEligibility(ctx, L, pid);
    if (el.eligible === false) ir_moves.push(Object.assign(row(ctx, L, pid), { to: 'active', eligible: true, why: 'On IR but no longer IR-eligible (' + el.why + '): Sleeper blocks adds until he is activated or dropped.' }));
  });
  // Taxi: young bench players who could stash there.
  const taxi_moves: Array<Record<string, any>> = [];
  const deadline = Number(st.taxi_deadline) || 0;
  const years = Number(st.taxi_years) || 0;
  const taxiRoom = c.taxi_max - c.taxi;
  const pastDeadline = deadline > 0 && wk > deadline;
  const starters = new Set((me.starters || []).map(String));
  c.activeIds.filter(pid => !starters.has(pid)).forEach(pid => {
    const yrs = Number((ctx.players[pid] || {}).yrs);
    const yrsOk = years > 0 ? yrs < years : false;
    if (!c.taxi_max || !yrsOk) return;
    const eligible = yrsOk && taxiRoom > 0 && !pastDeadline;
    taxi_moves.push(Object.assign(row(ctx, L, pid), { to: 'taxi', eligible, why: (pastDeadline ? 'Taxi deadline was week ' + deadline + ' (now week ' + wk + '), so no new taxi stashes' : taxiRoom <= 0 ? 'Taxi is full (' + c.taxi + '/' + c.taxi_max + ')' : 'Fits the taxi rules (' + yrs + ' yrs, limit under ' + years + ') and frees an active spot') + '.' }));
  });
  // Keep despite low value: active keeps under 1,000 or with a non-engine value, plus IR stashes and taxi players (no active spot).
  const keep = plan.keep.filter(k => k.value == null || k.value < 1000 || k.value_source !== 'dhq').map(strip);
  c.irIds.forEach(pid => { const r = row(ctx, L, pid) as Record<string, any>; if (r.value == null || r.value < 1000 || r.value_source !== 'dhq') keep.push(Object.assign(r, { reason: 'IR stash: he uses an IR slot, not an active spot' + (r.value_source === 'ir_fallback' ? '; the engine\'s 0 is an IR gap (healthy-equivalent ' + r.value + ')' : '') + '.' })); });
  c.taxiIds.forEach(pid => { const r = row(ctx, L, pid) as Record<string, any>; if (r.value == null || r.value < 1000) keep.push(Object.assign(r, { reason: 'Taxi: he uses a taxi slot, not an active spot; cutting him frees nothing on the active roster' + (fresh(ctx, pid).t ? '' : ' (no NFL team: cut him if you need the taxi slot)') + '.' })); });
  const cuts = plan.candidates.slice(0, 8).map(strip);
  const fixIR = ir_moves.filter(m => m.to === 'active');
  const toIR = ir_moves.filter(m => m.to === 'IR' && m.eligible === true);
  let decision: string, recommendation: string;
  const first = cuts[0];
  if (fixIR.length) { decision = 'activate_from_ir'; recommendation = 'Activate ' + fixIR.map(m => m.player).join(', ') + ' from IR first: Sleeper won\'t process adds while an ineligible player sits there.'; }
  else if (c.max != null && c.open! < 0) { decision = 'cut_now'; recommendation = 'You\'re ' + (-c.open!) + ' over the active limit (' + c.active + '/' + c.max + ')' + (toIR.length ? ': move ' + toIR.map(m => m.player).join(', ') + ' to IR' : '') + (first ? (toIR.length ? ', then cut ' : ': cut ') + first.player + ' (' + String(first.why).replace(/\.$/, '') + ')' : '') + '.'; }
  else if (toIR.length) { decision = 'use_ir_first'; recommendation = 'Move ' + toIR.map(m => m.player).join(', ') + ' to IR to free ' + (toIR.length > 1 ? toIR.length + ' active spots' : 'an active spot') + ' before cutting anyone.'; }
  else if (c.max != null && c.open === 0) { decision = 'full'; recommendation = 'Your active roster is full (' + c.active + '/' + c.max + '), so any add needs a drop' + (first ? '; the first safe drop is ' + first.player + ' (' + String(first.why).replace(/\.$/, '') + ').' : ', and nobody on it is a safe cut right now.'); }
  else if (c.max != null) { decision = 'open_spots'; recommendation = 'You have ' + c.open + ' open active spot' + (c.open! > 1 ? 's' : '') + ' (' + c.active + '/' + c.max + '): no cut needed to add.'; }
  else { decision = 'unknown_limit'; recommendation = 'This league\'s roster limit isn\'t in the settings, so check the cut list only if you need a spot.'; }
  const depth: Record<string, { slots: number; active_healthy: number }> = {};
  const slots = dedicatedSlots(L);
  Object.keys(slots).forEach(pos => { depth[pos] = { slots: slots[pos], active_healthy: c.activeIds.filter(pid => posOf(ctx, L, pid) === pos && !INJ_OUT.has(injOf(ctx, pid))).length }; });
  const evidence = [
    'Active ' + c.active + '/' + (c.max != null ? c.max : '?') + ', taxi ' + c.taxi + '/' + c.taxi_max + ', IR ' + c.ir + '/' + c.ir_max + '.',
    'IR allows: IR' + Object.keys(IR_KEYS).filter(k => Number(st[IR_KEYS[k]]) === 1).map(k => ', ' + k).join('') + '. Not allowed: ' + (Object.keys(IR_KEYS).filter(k => Number(st[IR_KEYS[k]]) !== 1).join(', ') || 'none') + '.',
    deadline ? 'Taxi: ' + c.taxi_max + ' slots, players under ' + years + ' years in the league, deadline week ' + deadline + '.' : 'No taxi deadline set.',
    'Depth counts active, healthy players only (taxi and IR are not depth).',
  ];
  if (plan.window) evidence.push('Team window: ' + plan.window + '.');
  return {
    league_id: L.league_id, team: label(L, me.roster_id),
    decision, confidence: c.max != null ? 'high' : 'low', recommendation,
    cut_candidates: cuts,
    keep_despite_low_value: keep.slice(0, 15),
    ir_moves, taxi_moves: taxi_moves.slice(0, 8),
    roster_count: { active: c.active, max: c.max, open: c.open, taxi: c.taxi, taxi_max: c.taxi_max, ir: c.ir, ir_max: c.ir_max },
    depth,
    evidence,
    rules_applied: [
      'Only active-roster players are drops; taxi and IR never are (they don\'t free an active spot).',
      'Free moves (IR, activation) before any cut.',
      'IR eligibility follows this league\'s reserve_allow_* settings; IR status is always eligible.',
      'Never cut: starters, players whose game has started, handcuffs to your own starters, young risers, injured players worth ' + STASH_VALUE + '+, the last healthy body at a slot, or a 0 that is an engine gap.',
      'Engine 0 for an Inactive (IR) player is replaced by a healthy-equivalent peer value (value_source ir_fallback); a player the engine never scored is unknown, not 0.',
      isDynasty(L) ? 'Dynasty keep score = value + 50 x this week\'s projection + 300 upside (rookie/2nd year or 3+ peak years; not kickers).' : 'Redraft: keep score = this week\'s projection only.',
      'Taxi deadline read as: no new taxi moves after that week (Sleeper\'s exact rule not verified).',
      'Your own player tags (untouchable, cut) are not visible to the connector; say so if the member has tagged players.',
    ],
    method: skillText('roster_plan'), numbers_as_of: L.built_at,
  };
}

// ── In-season bid history ────────────────────────────────────────────────
// The regular season's first day: nfl_state.season_start_date when the
// season type is regular/post, else the Wednesday after Labor Day.
export function seasonStartMs(ctx: Ctx, L: LeagueRow): number {
  const ns = ctx.nflState || {};
  const yr = Number(L.season) || new Date().getUTCFullYear();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ns.season_start_date || ''));
  if (m && (ns.season_type === 'regular' || ns.season_type === 'post') && Number(m[1]) === yr) return Date.UTC(yr, Number(m[2]) - 1, Number(m[3]));
  const dow = new Date(Date.UTC(yr, 8, 1)).getUTCDay();
  return Date.UTC(yr, 8, 1 + ((8 - dow) % 7) + 2);
}
// Waiver bids made on or after the season start; offseason claims out. A
// bid with no timestamp counts only from week 2 on (Sleeper files the
// offseason under week 1).
export function inSeason(ctx: Ctx, L: LeagueRow, txns: any[]) {
  const start = seasonStartMs(ctx, L);
  let excluded = 0;
  const kept = (txns || []).filter(t => {
    if (!t || t.type !== 'waiver' || !(Number(t.settings && t.settings.waiver_bid) > 0)) return true;
    const ok = Number(t.created) > 0 ? Number(t.created) >= start : Number(t.leg) >= 2;
    if (!ok) excluded++;
    return ok;
  });
  return { txns: kept, excluded, start: new Date(start).toISOString().slice(0, 10) };
}
const quant = (sorted: number[], p: number) => (engines().Faab && engines().Faab.quantile ? engines().Faab.quantile(sorted, p) : sorted[Math.round((sorted.length - 1) * p)]);
export function bidStats(txns: any[]) {
  const bids = (txns || []).filter(t => t && t.type === 'waiver' && Number(t.settings && t.settings.waiver_bid) > 0).map(t => Number(t.settings.waiver_bid)).sort((x, y) => x - y);
  if (!bids.length) return { count: 0 } as Record<string, number>;
  return { count: bids.length, p50: Math.round(quant(bids, 0.5)), p75: Math.round(quant(bids, 0.75)), p90: Math.round(quant(bids, 0.9)) };
}
// In-season WINNING bids at one position, newest first.
export function posComps(ctx: Ctx, L: LeagueRow, txns: any[], pos: string, limit = 6) {
  return (txns || []).filter(t => t && t.type === 'waiver' && t.status !== 'failed' && Number(t.settings && t.settings.waiver_bid) > 0 && t.adds && posOf(ctx, L, Object.keys(t.adds)[0]) === pos)
    .sort((x, y) => (Number(y.created) || 0) - (Number(x.created) || 0))
    .slice(0, limit)
    .map(t => ({ player: pname(ctx, Object.keys(t.adds)[0]), bid: Number(t.settings.waiver_bid), week: Number(t.leg) || undefined }));
}
export function compSummary(comps: Array<{ bid: number }>) {
  const b = (comps || []).map(c => c.bid).sort((x, y) => x - y);
  return b.length ? { wins: b.length, median: Math.round(quant(b, 0.5)), p75: Math.round(quant(b, 0.75)), max: b[b.length - 1] } : undefined;
}
// The FAAB bid model's inputs, built once per call. Positions go in already
// normalised (CB/S → DB, DE/DT → DL): the model counts each rival's healthy
// players at the position with App.normPos, which the app and the Lab define
// and the edge function does not, so raw Sleeper positions made every rival
// look empty at DB/DL/LB and over-priced IDP bids.
export function faabInputs(ctx: Ctx, L: LeagueRow, me: Roster) {
  const playersData: Record<string, any> = {};
  for (const [id, p] of Object.entries(ctx.players)) { const f = fresh(ctx, id); playersData[id] = { player_id: id, position: normPos(p.pos), fantasy_positions: p.fp || [normPos(p.pos)], injury_status: f.inj, team: f.t, status: f.st }; }
  const league = { settings: settingsOf(L), rosters: L.snapshot.rosters, roster_positions: (L.snapshot.league && L.snapshot.league.roster_positions) || [], users: L.snapshot.users };
  return { league, myRosterId: me.roster_id, playersData };
}
export function estimateFor(ctx: Ctx, L: LeagueRow, pid: string, txns: any[], base: ReturnType<typeof faabInputs>) {
  const F = engines().Faab;
  if (!F || !F.estimate) return null;
  return F.estimate({ ...base, txns, targetPid: pid, targetPos: posOf(ctx, L, pid), dhq: dhq(L, pid), playerValue: (id: string) => dhq(L, id) });
}
const isFaab = (L: LeagueRow) => { const st = settingsOf(L); return Number(st.waiver_budget) > 0 && (st.waiver_type == null || Number(st.waiver_type) === 2); };
const leftOf = (L: LeagueRow, r: Roster | null) => Math.max(0, (Number(settingsOf(L).waiver_budget) || 0) - (Number(((r || {} as Roster).settings || {}).waiver_budget_used) || 0));

// ── get_waiver_plan ──────────────────────────────────────────────────────
// Adds ranked by need-weighted value (value × 1.6 deficit / 1.3 thin / 0.6
// surplus at his position — a need counts only if he'd start there — + 35 ×
// this week's projection); free-agent backups to my own starting RB/QB go
// first. Every add is paired with a drop from the one drop list (active
// roster only), and only when the add's keep score beats that drop's by
// ADD_MARGIN (a no-NFL-team drop always qualifies). Open spots are used first.
const FIT: Record<string, number> = { deficit: 1.6, thin: 1.3, surplus: 0.6 };
const ADD_MARGIN = 100, CUFF_BONUS = 300, STASH_BID_VALUE = 500, MAX_ADDS = 5;
export function waiverPlan(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const startable = leaguePositions(L);
  let want = startable;
  if (args.position) {
    const ps = posSet(args.position);
    if (!ps || !ps.every(p => POS_ALL.includes(p))) throw new ToolError('Unknown position "' + args.position + '". Use QB, RB, WR, TE, K, DL, LB, DB or FLEX.');
    want = ps.filter(p => startable.includes(p));
    if (!want.length) return { league_id: L.league_id, decision: 'no_slot', confidence: 'high', recommendation: 'Don\'t add a ' + ps.join('/') + ': this league has no ' + ps.join('/') + ' slot, so he can\'t score for you.', adds: [], do_not_add: [{ player: 'any ' + ps.join('/'), why: 'No ' + ps.join('/') + ' slot. This league starts ' + startable.join(', ') + '.' }], rules_applied: ['Only positions this league can start.'], method: skillText('waiver_plan') };
  }
  const st = settingsOf(L);
  const F = engines().Faab;
  const faabOn = isFaab(L) && !!(F && F.estimate);
  const fa = isFaab(L) ? { budget: Number(st.waiver_budget), left: leftOf(L, me), min_bid: Number(st.waiver_bid_min != null ? st.waiver_bid_min : st.waiver_budget_min) || 1 } : null;
  const wk = weekNow(L);
  const lastReg = Number(st.playoff_week_start) > 1 ? Number(st.playoff_week_start) - 1 : null;
  const weeksLeft = lastReg ? Math.max(1, lastReg - wk) : null;
  const left = fa ? fa.left : 0, minBid = fa ? fa.min_bid : 0;
  let cap = fa ? Math.max(minBid, Math.round(left * Math.min(0.65, Math.max(0.15, 1.5 / (weeksLeft || 10))))) : 0;
  const pct = Number(args.budget_pct);
  if (fa && pct > 0) cap = Math.min(cap, Math.max(minBid, Math.round(left * Math.min(100, pct) / 100)));
  if (fa) cap = Math.min(cap, left);
  const ins = faabOn ? inSeason(ctx, L, (L.snapshot.txns || []) as any[]) : { txns: [] as any[], excluded: 0, start: null as string | null };
  const A: any = assessOf(L, me.roster_id) || {};
  const needOf: Record<string, string> = {};
  (A.strengths || []).forEach((p: string) => { needOf[p] = 'surplus'; });
  (A.needs || []).forEach((n: any) => { needOf[n.pos] = n.urgency; });
  const contending = /CONTEND/i.test(String(A.window || ''));
  const rostered = new Set<string>(); L.snapshot.rosters.forEach(r => (r.players || []).forEach(x => rostered.add(String(x))));
  // A need only counts for a player who would start there: his projection beats my weakest starter's at that position.
  const starterProj: Record<string, number> = {};
  (me.starters || []).map(String).filter(x => x && x !== '0').forEach(sid => { const ps = posOf(ctx, L, sid); const v = Number(weekPts(ctx, L, sid)) || 0; starterProj[ps] = starterProj[ps] == null ? v : Math.min(starterProj[ps], v); });
  const fitOf = (pid: string): { mult: number; fills?: string; short?: string; vs?: number; pr?: number | null } => {
    const pos = posOf(ctx, L, pid), need = needOf[pos];
    if (need === 'surplus') return { mult: FIT.surplus };
    if (need !== 'deficit' && need !== 'thin') return { mult: 1 };
    const pr = weekPts(ctx, L, pid);
    if (starterProj[pos] == null || (pr != null && pr > starterProj[pos])) return { mult: FIT[need], fills: need };
    return { mult: 1, short: need, vs: starterProj[pos], pr };
  };
  const addScore = (pid: string) => Math.round(dhq(L, pid) * fitOf(pid).mult + (Number(weekPts(ctx, L, pid)) || 0) * 35);
  const fas = Object.keys(ctx.players).filter(pid => { const p = ctx.players[pid]; return !!(p && p.t && !rostered.has(pid) && p.act !== false && String(p.st || '') !== 'Retired' && !/inactive/i.test(String(p.st || '')) && want.includes(posOf(ctx, L, pid))); });
  const cuffs = handcuffs(ctx, L, me);
  const faSet = new Set(fas);
  const cuffFA = cuffs.filter(c => c.owner === 'free agent' && want.includes(c.pos) && faSet.has(c.backup));
  const cuffOf: Record<string, string> = {};
  cuffFA.forEach(c => { cuffOf[c.backup] = c.starter; });
  const ranked = fas.filter(pid => dhq(L, pid) > 0 || (Number(weekPts(ctx, L, pid)) || 0) > 0).sort((x, y) => addScore(y) - addScore(x)).slice(0, 40);
  const order = [...new Set(cuffFA.map(c => c.backup).concat(ranked))];
  const plan = cutPlan(ctx, L, me);
  const counts = plan.counts;
  let open = counts.open != null ? Math.max(0, counts.open) : 0;
  const drops = plan.candidates.slice();
  const adds: Array<Record<string, any>> = [], do_not_add: Array<{ player: string; why: string }> = [];
  const coldStarts: string[] = [];
  const filled = new Set<string>();
  const faabBase = faabOn ? faabInputs(ctx, L, me) : null;
  for (const pid of order) {
    if (adds.length >= MAX_ADDS) break;
    const vr = valueRead(ctx, L, pid);
    const isCuff = !!cuffOf[pid];
    const fit = fitOf(pid);
    const worth = keepScore(ctx, L, pid, vr) + (vr.value || 0) * (fit.mult - 1) + (isCuff && contending ? CUFF_BONUS : 0);
    let drop: Record<string, any>;
    if (open > 0) { open--; drop = { player: null, why: 'You have an open active spot (' + counts.active + '/' + counts.max + '); no drop needed.' }; }
    else {
      const i = drops.findIndex(d => d.rank_key < 0 || d.keep_score + ADD_MARGIN < worth);
      if (i < 0) {
        if (adds.length + do_not_add.length < 8) do_not_add.push({ player: pname(ctx, pid), why: 'Not an upgrade on anyone you can safely drop' + (drops[0] ? ' (lowest safe drop: ' + drops[0].player + ', keep score ' + drops[0].keep_score + ')' : ' (nobody on the active roster is a safe drop)') + '.' });
        continue;
      }
      const d = drops.splice(i, 1)[0];
      drop = { player: d.player, why: d.why, value: d.value, value_source: d.value_source };
    }
    const p = fresh(ctx, pid);
    const why: string[] = [];
    if (isCuff) why.push('Handcuff: backs up your starter ' + pname(ctx, cuffOf[pid]) + ' (' + p.t + ' ' + posOf(ctx, L, pid) + '2)');
    if (fit.fills) { filled.add(posOf(ctx, L, pid)); why.push('fills your ' + fit.fills + ' ' + posOf(ctx, L, pid) + ' spot'); }
    else if (fit.short) why.push(posOf(ctx, L, pid) + ' is ' + fit.short + ' for you, but he wouldn\'t start (projects ' + (fit.pr != null ? round1(fit.pr) : 'nothing') + ' vs your starter\'s ' + round1(fit.vs) + ')');
    why.push('value ' + (vr.value != null ? vr.value : 'unknown'));
    const pr = weekPts(ctx, L, pid);
    if (pr != null) why.push((gameStarted(ctx, pid) ? 'scored ' : 'projects ') + round1(pr) + ' this week');
    const inj = injuryText(ctx, pid); if (inj) why.push(inj);
    if (gameStarted(ctx, pid)) why.push('already played this week, so he helps from next week');
    let bid: Record<string, any> | null = null;
    if (faabOn && fa && faabBase) {
      const est = estimateFor(ctx, L, pid, ins.txns, faabBase);
      if (est) {
        if (est.coldStart) coldStarts.push(pid);
        const comps = posComps(ctx, L, ins.txns, posOf(ctx, L, pid), 999);
        const sum = compSummary(comps);
        // The position's in-season winning bids at the quantile the bid model uses for this player's strength.
        const qPos = 0.4 + 0.5 * (F.strengthOf ? F.strengthOf(vr.value || 0) : 0.5);
        const compBids = comps.map(c => c.bid).sort((x, y) => x - y);
        const compQ = compBids.length >= 3 ? Math.round(quant(compBids, qPos)) : 0;
        const stash = (vr.value || 0) < STASH_BID_VALUE;
        let openBid = stash ? minBid : est.sug;
        let max = stash ? Math.max(minBid, Math.min(est.lo, cap)) : Math.max(openBid, est.hi, compQ);
        max = Math.min(max, cap);
        openBid = Math.min(openBid, max);
        bid = noUndef({ open: openBid, max, win_chance_pct: est.winPct != null ? Math.round(est.winPct * 100) : undefined, comps: comps.slice(0, 5), comps_summary: sum, basis: stash ? 'stash-level add: open at the league minimum' : 'bid model ' + (est.coldStart ? '(few in-season bids: league defaults)' : '(in-season bids)') + (compQ ? '; in-season ' + posOf(ctx, L, pid) + ' wins at his strength: $' + compQ : '') + (max === cap ? '; max held to your pace cap $' + cap : '') });
      }
    }
    adds.push(noUndef({ player: noUndef({ name: pname(ctx, pid), pos: posOf(ctx, L, pid), nfl_team: p.t, age: (ctx.players[pid] || {}).age || undefined, value: vr.value, value_source: vr.value_source }), handcuff: isCuff || undefined, why: why.join('; ') + '.', bid: bid || (fa ? undefined : { note: 'This league uses ' + (Number(st.waiver_type) === 1 ? 'reverse-standings waivers' : Number(st.waiver_type) === 0 ? 'rolling waivers' : 'waivers') + ', not bids.' }), drop }));
  }
  // Needs the wire can't fill: a trade, not a claim.
  (A.needs || []).forEach((n: any) => {
    if (!want.includes(n.pos) || filled.has(n.pos)) return;
    const best = fas.filter(pid => posOf(ctx, L, pid) === n.pos).sort((x, y) => dhq(L, y) - dhq(L, x))[0];
    const why = n.pos + ' is ' + (n.urgency === 'deficit' ? 'a deficit' : n.urgency) + ' for you, but no free agent would start there' + (adds.some(x => x.player.pos === n.pos) ? ' (any ' + n.pos + ' above is a stash, not a fix)' : '') + ': trade for a starter (trade_plan or find_trade_targets).';
    const added = best && adds.some(x => x.player.name === pname(ctx, best));
    const seen = best && !added ? do_not_add.find(d => d.player === pname(ctx, best)) : null;
    const who = best && !added ? pname(ctx, best) + ' (best free-agent ' + n.pos + ', value ' + dhq(L, best) + ')' : 'a waiver claim as your ' + n.pos + ' fix';
    if (seen) { seen.player = who; seen.why = why; }
    else do_not_add.push({ player: who, why });
  });
  const ownedCuffs = cuffs.filter(c => c.owner !== 'free agent' && c.owner !== 'me');
  const rank = fa ? L.snapshot.rosters.map(r => leftOf(L, r)).sort((x, y) => y - x).indexOf(left) + 1 : null;
  const faab = fa ? noUndef({
    left, budget: fa.budget, min_bid: minBid,
    rank: rank ? rank + ' of ' + L.snapshot.rosters.length + ' teams' : undefined,
    weeks_left: weeksLeft || undefined,
    per_week: weeksLeft ? Math.round(left / weeksLeft) : undefined,
    max_single_bid: cap,
    pace: weeksLeft ? '$' + left + ' over ' + weeksLeft + ' regular-season week' + (weeksLeft > 1 ? 's' : '') + ' (through week ' + lastReg + ') is about $' + Math.round(left / weeksLeft) + ' a week; no single claim above $' + cap + ' unless he changes your lineup for the title run. Unspent FAAB is worth nothing after the season.' : 'Playoff start week not set; no single claim above $' + cap + '.',
  }) : undefined;
  const first = adds[0];
  const recommendation = first
    ? 'Claim ' + first.player.name + (first.bid && first.bid.open != null ? ' (open $' + first.bid.open + ', max $' + first.bid.max + ')' : '') + (first.drop.player ? ' and drop ' + first.drop.player + '.' : ' into your open spot.')
    : 'Hold: nobody on the wire' + (args.position ? ' at ' + want.join('/') : '') + ' is an upgrade on a player you can safely drop.';
  const evidence = [
    'Active roster ' + counts.active + '/' + (counts.max != null ? counts.max : '?') + ' (taxi ' + counts.taxi + ', IR ' + counts.ir + ' not counted).',
    'Needs: ' + ((A.needs || []).map((n: any) => n.pos + ' ' + n.urgency).join(', ') || 'none') + (A.window ? '; window ' + A.window : '') + '.',
    'League starts: ' + startable.join(', ') + '.',
  ];
  if (faabOn) {
    const bs = bidStats(ins.txns);
    evidence.push(bs.count ? 'In-season bids since ' + ins.start + ': ' + bs.count + ' (median $' + bs.p50 + ', p75 $' + bs.p75 + ', p90 $' + bs.p90 + '); ' + ins.excluded + ' offseason claims left out.' : 'No in-season bids yet; ' + ins.excluded + ' offseason claims left out.');
  }
  ownedCuffs.forEach(c => evidence.push(pname(ctx, c.starter) + '\'s backup ' + pname(ctx, c.backup) + ' is on ' + c.owner + ': a trade, not a claim.'));
  cuffs.filter(c => c.owner === 'me').forEach(c => evidence.push(pname(ctx, c.starter) + '\'s backup ' + pname(ctx, c.backup) + ' is already yours.'));
  return noUndef({
    league_id: L.league_id,
    decision: first ? 'add' : 'hold',
    confidence: !faabOn ? (fa ? 'low' : 'medium') : coldStarts.length ? 'medium' : 'high',
    recommendation,
    adds,
    faab,
    do_not_add: do_not_add.length ? do_not_add : undefined,
    evidence,
    rules_applied: [
      'Only positions this league can start.',
      'Every add is paired with a drop from the active roster (never taxi or IR), unless an active spot is open.',
      'Drops come from the one roster drop list (same as roster_plan): no NFL team first, then lowest keep score; starters, handcuffs to your starters, young risers, injured stashes and engine-gap 0s are never drops.',
      'An add must beat its drop by ' + ADD_MARGIN + ' keep points (need-weighted' + (contending ? ', +' + CUFF_BONUS + ' for a handcuff while contending' : '') + ').',
      'Bid history is in-season only (offseason claims excluded).',
      'Max bid never above the pace cap (FAAB left x 1.5 / weeks left, between 15% and 65%)' + (pct > 0 ? ' or your ' + pct + '% limit' : '') + '.',
    ],
    method: skillText('waiver_plan'), numbers_as_of: L.built_at,
  });
}

// dhq-tools/decide-trade.ts — the trade decision, shared by evaluate_trade
// and trade_plan so the two can never disagree.
//
// Ported from the Lab (v6-hub js/shared/ask-tools-moves.js, 2026-10-10).
// The rules, in order of precedence: ownership > headliner > what the
// partner wants > raw value. The seven trade fixes:
//   1. A player his owner listed on the trade block costs that owner LESS
//      (15% off; a listed veteran at most half his value).
//   2. A pick whose holder can't be confirmed is never the member's.
//   3. Rebuild before panic: a rebuilding owner is a seller whatever his
//      panic (no "Desperate" posture, no Panic Premium).
//   4. Veterans by position-aware age cliffs: RB 27+, WR 29+, TE 29+, QB 32+
//      (anything else 30+).
//   5. A pick in the NEXT draft is priced at its slot projected from today's
//      standings (worst team picks 1st) with no year discount; later drafts
//      are mid-round, less 12% a year. A rebuilder prefers nearer picks.
//   6. Acceptance runs on what the package is worth TO THE PARTNER against
//      what he gives up as he sees it (minus 8 points per extra player he
//      must roster, capped at 10% without the headliner).
//   7. One value scale: 7,000+ elite, 4,000+ starter, 2,000+ depth.
// Plus the headliner rule (a young starter costs one real headline piece:
// a 1st, or a young player worth 70%+; a young starting QB in superflex a
// 1st at minimum) and balance (a rebuilder never gives picks back).
//
// Server data: picks owned come from the build (snapshot.picks), the
// owner's moves from intel.tradeHistory (this season), DNA from the build's
// computeWeightedDNA, the trade block from Sleeper's league_players feed
// (live), and the trade engine (posture, psychology, acceptance, grade) is
// the vendored DHQ-Shared trade-engine.js (ctx.te).
// deno-lint-ignore-file no-explicit-any
import { type Ctx, type LeagueRow, type Roster, ToolError, myRoster, rosterOf, assessOf, resolveOne, fresh, slotValue, round1, ord } from './tools.ts';
import { tradeBlockRows } from './league-tools.ts';
import { SCALE, SCALE_NOTE, metaOf, posOf, pname, ageOf, valueOf, label, isMe, holderOf, injuryText, findTeam, weekNow } from './decide-common.ts';
import { skillText } from './skills.ts';

// ── Who counts as a veteran (fix 4) ──────────────────────────────────────
const VET_AGE: Record<string, number> = { QB: 32, RB: 27, WR: 29, TE: 29 };
export const vetAge = (pos: unknown) => VET_AGE[String(pos || '').toUpperCase()] || 30;
export const isVet = (pos: unknown, age: unknown) => Number(age) > 0 && Number(age) >= vetAge(pos);
const VET_RULE = 'veterans past their age cliff (RB 27+, WR 29+, TE 29+, QB 32+)';
const isSF = (L: LeagueRow) => { const rp: string[] = (L.snapshot.league || {}).roster_positions || []; return rp.some(x => /SUPER_FLEX|SUPERFLEX/i.test(x)) || rp.filter(x => x === 'QB').length >= 2; };
const teams = (L: LeagueRow) => L.snapshot.rosters.length || Number(((L.snapshot.league || {}).settings || {}).num_teams) || 12;
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th'];
const roundName = (rd: number) => ORD[rd] || ('R' + rd);
const teamLabel = (L: LeagueRow, rid: unknown) => (rosterOf(L, rid) ? label(L, rid) : 'Team ' + rid);
const isoDate = (ts: unknown) => (Number(ts) > 0 ? new Date(Number(ts)).toISOString().slice(0, 10) : null);

// ── Pick values (fix 5) ──────────────────────────────────────────────────
// The league-calibrated DHQ slot curve (intel.dhqPickValues, by overall
// slot), else a fixed round table.
function rawPickValue(L: LeagueRow, round: number, slot: number | null) {
  const n = teams(L), s = slot || Math.ceil(n / 2);
  const v = slotValue(L, (round - 1) * n + s);
  return v > 0 ? v : ({ 1: 7000, 2: 3500, 3: 1800, 4: 800 } as Record<number, number>)[round] || 400;
}
// Picks owned by each roster, from the build: { rid: [{ year, round, originalOwnerRid }] }. Null when not stored.
export function picksByOwner(L: LeagueRow): Record<string, Array<{ year: number; round: number; originalOwnerRid: number }>> | null {
  const p = L.snapshot.picks;
  if (!p || !Object.keys(p).length) return null;
  const out: Record<string, Array<{ year: number; round: number; originalOwnerRid: number }>> = {};
  for (const rid in p) out[rid] = (p[rid] || []).map(x => ({ year: Number(x.year), round: Number(x.round), originalOwnerRid: Number(x.from) }));
  return out;
}
// The next draft still to be held: the first year the build lists picks for
// (it already rolls past a finished draft), else from the league status.
export function nextDraftYear(L: LeagueRow): number {
  const own = picksByOwner(L);
  if (own) { const ys = Object.values(own).flat().map(x => Number(x.year)).filter(Boolean); if (ys.length) return Math.min(...ys); }
  const yr = parseInt(String(L.season), 10) || new Date().getFullYear();
  const st = String((L.snapshot.league || {}).status || '');
  if (/^(pre_draft|drafting)$/.test(st)) return yr;
  return (weekNow(L) >= 1 || /^(in_season|post_season|complete)$/.test(st)) ? yr + 1 : yr;
}
// Current standings, worst team first (win %, then fewest points for). Null before anyone has played.
function standingsWorstFirst(L: LeagueRow): string[] | null {
  const rs = L.snapshot.rosters.slice();
  const g = (r: Roster) => { const st = r.settings || {}; return (st.wins || 0) + (st.losses || 0) + (st.ties || 0); };
  if (!rs.some(r => g(r) > 0)) return null;
  const pct = (r: Roster) => { const st = r.settings || {}; return g(r) ? ((st.wins || 0) + 0.5 * (st.ties || 0)) / g(r) : 0.5; };
  const pf = (r: Roster) => { const st = r.settings || {}; return (st.fpts || 0) + (st.fpts_decimal || 0) / 100; };
  return rs.sort((a, b) => pct(a) - pct(b) || pf(a) - pf(b)).map(r => String(r.roster_id));
}
// Projected slot of a team's pick in the NEXT draft (worst team picks 1st). Later drafts: null (mid-round).
export function projectedSlot(L: LeagueRow, year: unknown, origRid: unknown): number | null {
  if (origRid == null || Number(year) !== nextDraftYear(L)) return null;
  const order = standingsWorstFirst(L);
  if (!order) return null;
  const i = order.indexOf(String(origRid));
  return i < 0 ? null : i + 1;
}
// A pick's value: slot (given, else projected for the next draft, else mid);
// no discount for the next draft, 12% a year for each draft after it.
export function pickValue(L: LeagueRow, year: unknown, round: unknown, slot: number | null, fromRid?: unknown) {
  const rd = Number(round);
  const s = slot != null ? Number(slot) : projectedSlot(L, year, fromRid);
  const ahead = Math.max(0, (parseInt(String(year), 10) || 0) - nextDraftYear(L));
  return Math.round(rawPickValue(L, rd, s) * Math.pow(0.88, ahead));
}

// "2027 1st", "2027 round 2", "2027 R1", "2026 1.03", "Gas's 2027 1st",
// "2027 1st from Gas", "next year's 2nd", "early 2027 1st". Null if not a pick.
const WORD_ROUND: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 };
export function parsePick(ctx: Ctx, L: LeagueRow, text: unknown): { year: number | null; round: number; slot: number | null; from: number | null } | null {
  const raw = String(text || '');
  const t = ' ' + raw.toLowerCase().replace(/[’']s\b/g, '').replace(/[(),]/g, ' ') + ' ';
  let year: string | number | undefined = (t.match(/\b(20\d\d)\b/) || [])[1];
  let round: number | null = null, slot: number | null = null, m: RegExpMatchArray | null;
  if ((m = t.match(/\b([1-7])\.(\d{1,2})\b/))) { round = +m[1]; slot = +m[2]; }
  else if ((m = t.match(/\b([1-7])(?:st|nd|rd|th)\b/))) round = +m[1];
  else if ((m = t.match(/\bround\s*([1-7])\b/) || t.match(/\b(?:r|rd)\s?([1-7])\b/))) round = +m[1];
  else if ((m = t.match(/\b(first|second|third|fourth|fifth|sixth|seventh)\b/))) round = WORD_ROUND[m[1]];
  if (!round) return null;
  if (!year && !/\b(pick|picks|rounder|round)\b/.test(t)) return null;
  const yrNow = parseInt(String(L.season), 10) || new Date().getFullYear();
  if (!year) year = /\bnext year\b/.test(t) ? yrNow + 1 : undefined;
  if (/\bearly\b/.test(t) && slot == null) slot = 2;
  else if (/\blate\b/.test(t) && slot == null) slot = Math.max(1, teams(L) - 1);
  // Whatever is left may name the original owner ("from Gas", "Gas 2027 1st").
  const rest = t.replace(/\b20\d\d\b|\b[1-7]\.\d{1,2}\b|\b[1-7](st|nd|rd|th)\b|\bround\s*[1-7]\b|\b(r|rd)\s?[1-7]\b|\b(first|second|third|fourth|fifth|sixth|seventh)\b|\b(pick|picks|rounder|round|from|via|the|a|an|next|year|early|mid|middle|late|my|own|their|his|projected)\b/g, ' ').replace(/\s+/g, ' ').trim();
  let from: number | null = null;
  if (rest && rest.length >= 2) { const r = /^(me|mine|i)$/.test(rest) ? myRoster(L, ctx.memberId) : findTeam(ctx, L, rest); if (r) from = r.roster_id; }
  if (/\bmy\b|\bmine\b|\bown\b/.test(t) && from == null) { const me = myRoster(L, ctx.memberId); if (me) from = me.roster_id; }
  return { year: year ? Number(year) : null, round, slot, from };
}

// ── Owner DNA and psychology ─────────────────────────────────────────────
const DNA_META: Record<string, { label: string; strategy: string }> = {
  FLEECER: { label: 'The Fleecer', strategy: 'Hunts lopsided value. Lead with clean surplus; the math still has to work.' },
  DOMINATOR: { label: 'The Dominator', strategy: 'Needs to feel like the winner. Frame the offer as handing them the better side.' },
  STALWART: { label: 'The Stalwart', strategy: 'Attached to his roster and slow to move. Lead with clear value, never lowball.' },
  ACCEPTOR: { label: 'The Acceptor', strategy: 'Sells current players for futures. Offer picks and young upside.' },
  DESPERATE: { label: 'The Desperate', strategy: 'Urgency from injuries or a playoff push. Find his empty slot and move fast.' },
  NONE: { label: 'No DNA read', strategy: 'Not enough trades to read him. Offer fair value and watch for tells.' },
};
function dnaBrief(L: LeagueRow, rid: unknown) {
  const d = (L.dna || {})[String(rid)];
  const key = d && d.key ? String(d.key) : 'NONE';
  const m = DNA_META[key] || DNA_META.NONE;
  return { key, label: m.label, confidence_pct: d ? d.confidence ?? null : null, signals: d ? d.reasoning || 'Based on trade patterns' : 'Not enough trades to read', how_to_deal: m.strategy };
}
const PLAIN: Record<string, string> = {
  'Endowment Effect': 'they value their own players above the market', 'Panic Premium': 'they are hurting and more willing to deal',
  'Status Tax': 'they hate losing a trade', 'Loss Aversion': 'they fear giving up a familiar player',
  'Rebuilding Discount': 'they discount current starters while rebuilding', 'Need Fulfillment': 'your surplus fills a position they need',
  'Window Alignment': 'your windows fit (one buying now, one building)', 'Window Friction': 'you are both chasing the same window',
  'Locked Roster Tax': 'their roster is set and they rarely move', 'Seller Momentum': 'they are actively selling',
};
const psychLines = (taxes: any[]) => (taxes || []).slice(0, 6).map(x => ({ factor: x.name, effect: (Number(x.impact) || 0) > 0 ? 'helps' : 'hurts', impact: Number(x.impact) || 0, means: PLAIN[x.name] || x.desc || String(x.name).toLowerCase() }));

// Owner posture with the rebuild read first (fix 3). The engine checks
// panic >= 4 before a rebuild, so a 1-3 team selling vets for picks read
// "Desperate" and got the Panic Premium; a middling team with panic >= 2
// read "Active Buyer". Here a rebuilding owner is a seller whatever his
// panic, and "buyer" needs a contending read.
const POSTURE = {
  SELLER: { key: 'SELLER', label: 'Active Seller', desc: 'Moving assets for futures. Buy at a discount.' },
  NEUTRAL: { key: 'NEUTRAL', label: 'Neutral', desc: 'No strong directional push. Fair offers only.' },
};
export function postureFor(ctx: Ctx, theirA: any, dnaKey: string, intent: any) {
  if (intent && intent.mode === 'REBUILDING') return POSTURE.SELLER;
  let p: any = null;
  try { const te: any = ctx.te; p = te && te.calcOwnerPosture ? te.calcOwnerPosture(theirA, dnaKey) : null; } catch { p = null; }
  if (p && p.key === 'BUYER' && !(intent && intent.mode === 'CONTENDING')) return POSTURE.NEUTRAL;
  if (p && p.key === 'SELLER' && intent && intent.mode === 'CONTENDING') return POSTURE.NEUTRAL;
  return p;
}
type Read = { posture: any; accept_pct: number | null; psychology: any[]; dna: any; _taxes: any[]; _mineA: any; _theirA: any };
function dealRead(ctx: Ctx, L: LeagueRow, me: Roster | null, partner: Roster | null, giveTotal: number, getTotal: number, pieces: number, intent: any): Read {
  const out: Read = { posture: null, accept_pct: null, psychology: [], dna: null, _taxes: [], _mineA: null, _theirA: null };
  if (!partner) return out;
  out.dna = dnaBrief(L, partner.roster_id);
  const E: any = ctx.te, mineA = me ? assessOf(L, me.roster_id) : null, theirA = assessOf(L, partner.roster_id);
  out._mineA = mineA; out._theirA = theirA;
  if (!E || !mineA || !theirA) return out;
  try {
    const posture = postureFor(ctx, theirA, out.dna.key, intent);
    let taxes: any[] = E.calcPsychTaxes ? (E.calcPsychTaxes(mineA, theirA, out.dna.key, posture) || []) : [];
    if (intent && intent.mode === 'REBUILDING') taxes = taxes.filter(t => t.name !== 'Panic Premium');
    out._taxes = taxes;
    out.posture = posture ? { key: posture.key, label: posture.label, means: posture.desc } : null;
    out.psychology = psychLines(taxes);
    if (E.calcAcceptanceLikelihood) out.accept_pct = E.calcAcceptanceLikelihood(giveTotal, getTotal, out.dna.key, taxes, mineA, theirA, { totalPieces: pieces });
  } catch { /* acceptance is a bonus */ }
  return out;
}
// Acceptance on what the partner VALUES (fix 6): the engine's curve on
// worth-to-them against their cost as they see it; each extra player they
// must roster costs 8 points. Same 5-95 curve when the engine isn't there.
function acceptFor(ctx: Ctx, read: Read, toThem: number, theirCost: number, pieces: number, extraPlayers: number) {
  const E: any = ctx.te;
  let pct: number | null = null;
  try { if (E && E.calcAcceptanceLikelihood && read && read._mineA && read._theirA) pct = E.calcAcceptanceLikelihood(toThem, theirCost, (read.dna || {}).key || 'NONE', read._taxes || [], read._mineA, read._theirA, { totalPieces: pieces }); } catch { pct = null; }
  if (pct == null) { const mx = Math.max(toThem, theirCost, 1); pct = Math.max(5, Math.min(95, 50 + Math.round((toThem - theirCost) / mx * 200))); }
  return Math.max(1, Math.round(pct - 8 * Math.max(0, extraPlayers || 0)));
}

// ── What an owner is trying to do right now (owner ruling 2026-10-10) ────
// The evidence (record, this season's trades, the trade block) read into a
// plain mode; every piece is then priced the way THAT owner sees it.
function tradesThisSeason(L: LeagueRow, rid?: unknown) {
  return ((L.intel.tradeHistory || []) as any[]).filter(t => String(t.season) === String(L.season) && (rid == null || (t.roster_ids || []).map(String).includes(String(rid))))
    .sort((a, b) => (Number(b.ts) || 0) - (Number(a.ts) || 0));
}
// Players this roster listed on Sleeper's trade block (throws when the block can't be read).
async function listedBy(L: LeagueRow, rid: unknown): Promise<string[]> {
  const rows = await tradeBlockRows(L);
  return rows.filter(x => x && x.settings && x.settings.otb && !String(x.player_id).includes(',') && String((holderOf(L, String(x.player_id)) || {} as any).roster_id) === String(rid)).map(x => String(x.player_id));
}
export type Intent = { team: string; mode: 'REBUILDING' | 'CONTENDING' | 'NEUTRAL'; evidence: string[]; wants: string[]; avoids: string[]; signals: { selling: number; buying: number }; _listed: string[]; _vetsListed: string[]; _blockRead: boolean };
export async function ownerIntent(ctx: Ctx, L: LeagueRow, r: Roster): Promise<Intent> {
  const rid = String(r.roster_id), A: any = assessOf(L, r.roster_id) || {}, st = r.settings || {};
  const wins = Number(st.wins) || 0, losses = Number(st.losses) || 0;
  const ev: string[] = [];
  let picksIn = 0, picksOut = 0, valOut = 0, valIn = 0;
  const soldNames: string[] = [], boughtNames: string[] = [];
  tradesThisSeason(L, rid).forEach(t => Object.entries(t.sides || {}).forEach(([sid, side]: [string, any]) => {
    const players: string[] = (side.players || []).map(String), picks = side.picks || [];
    const v = players.reduce((n, pid) => n + valueOf(L, pid), 0);
    if (sid === rid) { picksIn += picks.length; valIn += v; players.forEach(pid => boughtNames.push(pname(ctx, pid))); }
    else { picksOut += picks.length; valOut += v; players.forEach(pid => soldNames.push(pname(ctx, pid))); }
  }));
  if (picksIn || soldNames.length) ev.push('this season traded away ' + (soldNames.length ? soldNames.slice(0, 5).join(', ') : 'no players') + ' and took in ' + picksIn + ' draft pick' + (picksIn === 1 ? '' : 's') + (boughtNames.length ? ' plus ' + boughtNames.slice(0, 4).join(', ') : ''));
  let blockRead = true;
  let listed: string[] = [];
  try { listed = await listedBy(L, rid); } catch { blockRead = false; }
  const vetsListed = listed.filter(pid => isVet(posOf(ctx, L, pid), ageOf(ctx, pid)) && valueOf(L, pid) >= 800);
  if (listed.length) ev.push(listed.length + ' on the trade block (' + listed.slice(0, 6).map(pid => pname(ctx, pid) + ' ' + (ageOf(ctx, pid) || '?')).join(', ') + ')' + (vetsListed.length ? '; veterans among them: ' + vetsListed.slice(0, 4).map(pid => pname(ctx, pid)).join(', ') : ''));
  ev.push('record ' + wins + '-' + losses + (A.powerRank ? ', power rank ' + A.powerRank : '') + (A.window ? ', app window ' + String(A.window).toLowerCase() : '') + (A.panic != null ? ', panic ' + A.panic + '/5' : ''));
  // The rebuild evidence is read first and wins over panic.
  let mode: Intent['mode'] = 'NEUTRAL';
  const sellingSignals = (picksIn >= 3 && valOut > valIn ? 2 : 0) + (vetsListed.length >= 2 ? 1 : 0) + (A.window === 'REBUILDING' ? 1 : 0) + (losses > wins + 1 ? 1 : 0);
  const buyingSignals = (picksOut >= 2 && valIn > valOut ? 2 : 0) + (A.window === 'CONTENDING' ? 1 : 0) + (wins > losses ? 1 : 0);
  if (sellingSignals >= 2 && sellingSignals > buyingSignals) mode = 'REBUILDING';
  else if (buyingSignals >= 2 && buyingSignals > sellingSignals) mode = 'CONTENDING';
  const needs = (A.needs || []).map((n: any) => n.pos).join(', ') || 'none';
  const wants = mode === 'REBUILDING' ? ['draft picks (the nearer the better)', 'young players (about 24 or under) and rising players with 3+ peak years left']
    : mode === 'CONTENDING' ? ['proven starters who score now', 'help at their weak spots: ' + needs] : ['fair value', 'help at their weak spots: ' + needs];
  const avoids = mode === 'REBUILDING' ? [VET_RULE + ': little to no use to them, however good this week']
    : mode === 'CONTENDING' ? ['far-off picks and long-term projects that don\'t score this season'] : [];
  return { team: label(L, r.roster_id), mode, evidence: ev, wants, avoids, signals: { selling: sellingSignals, buying: buyingSignals }, _listed: listed, _vetsListed: vetsListed, _blockRead: blockRead };
}
// How much one piece is worth TO a team in that mode, as a share of its value.
export function appealFor(L: LeagueRow, mode: string, x: any): { mult: number; why: string } {
  if (mode === 'REBUILDING') {
    if (x.kind === 'pick') {
      const ahead = (Number(x.year) || 0) - nextDraftYear(L);
      if (ahead <= 0) return { mult: 1.15, why: 'a pick in the next draft is exactly what a rebuild wants' };
      if (ahead === 1) return { mult: 1, why: 'a pick a year further out' };
      return { mult: 0.85, why: 'a far-off pick: a rebuild wants nearer ones' };
    }
    const pk = x.peak_years_left, age = Number(x.age) || 0;
    if (age && age <= 24) return { mult: 1.15, why: 'young (' + age + ')' };
    if (isVet(x.pos, age)) {
      if (pk != null && pk >= 1) return { mult: 0.55, why: x.pos + ' at ' + age + ', past the age cliff (' + vetAge(x.pos) + '+); only ' + pk + ' peak year' + (pk === 1 ? '' : 's') + ' left' };
      if (pk == null && age < vetAge(x.pos) + 3) return { mult: 0.55, why: x.pos + ' at ' + age + ', past the age cliff (' + vetAge(x.pos) + '+)' };
      return { mult: 0.2, why: 'past his peak at ' + age + ': little use to a rebuild' };
    }
    if (pk == null || pk >= 3) return { mult: 1, why: 'still has peak years' };
    if (pk >= 1) return { mult: 0.55, why: 'only ' + pk + ' peak year' + (pk === 1 ? '' : 's') + ' left' };
    return { mult: 0.2, why: 'past his peak at ' + (age || '?') + ': little use to a rebuild' };
  }
  if (mode === 'CONTENDING') {
    if (x.kind === 'pick') return { mult: 0.8, why: 'a pick doesn\'t help them win now' };
    return { mult: 1, why: 'helps now if he starts for them' };
  }
  return { mult: 1, why: '' };
}

// ── Pieces ───────────────────────────────────────────────────────────────
type Piece = Record<string, any>;
function pickAsset(ctx: Ctx, L: LeagueRow, year: number, round: number, from: number | null, own: ReturnType<typeof picksByOwner>, slot: number | null): Piece {
  const projected = slot == null ? projectedSlot(L, year, from) : null;
  const v = pickValue(L, year, round, slot != null ? slot : null, from);
  let holder: string | null = null;
  if (own && from != null) { for (const rid in own) if ((own[rid] || []).some(x => Number(x.year) === Number(year) && Number(x.round) === Number(round) && String(x.originalOwnerRid) === String(from))) { holder = rid; break; } }
  const sl = slot != null ? slot : projected;
  return {
    kind: 'pick', label: year + ' ' + roundName(round) + (sl ? ' (' + (slot != null ? '' : 'projected ') + round + '.' + String(sl).padStart(2, '0') + ')' : '') + (from == null ? '' : isMe(ctx, L, rosterOf(L, from)) ? ' (own)' : ' (' + teamLabel(L, from) + '\'s)'),
    value: v, year: Number(year), round: Number(round), from, holder,
    slot_basis: slot != null ? 'slot given' : projected ? 'projected from current standings' : Number(year) === nextDraftYear(L) ? 'mid-round (no standings yet)' : 'mid-round (later draft)',
  };
}
function playerAsset(ctx: Ctx, L: LeagueRow, pid: string): Piece {
  pid = String(pid);
  const m = metaOf(L, pid), r = holderOf(L, pid);
  return { kind: 'player', pid, label: pname(ctx, pid), value: valueOf(L, pid), pos: posOf(ctx, L, pid), age: ageOf(ctx, pid), peak_years_left: m.peakYrsLeft != null ? m.peakYrsLeft : undefined, injury: injuryText(ctx, pid) || undefined, owner_rid: r ? String(r.roster_id) : null };
}
function resolvePiece(ctx: Ctx, L: LeagueRow, text: string, holderHint: Roster | null): Piece | null {
  const pk = parsePick(ctx, L, text);
  if (pk) {
    const own = picksByOwner(L);
    let year = pk.year;
    if (!year) { const yrs = own ? [...new Set(Object.values(own).flat().map(x => x.year))].sort() : []; year = yrs[0] || (parseInt(String(L.season), 10) || new Date().getFullYear()) + 1; }
    let from = pk.from;
    if (from == null && holderHint && own) {
      const list = own[String(holderHint.roster_id)] || [];
      const mineOrig = list.find(x => x.year === year && x.round === pk.round && String(x.originalOwnerRid) === String(holderHint.roster_id));
      const any = list.find(x => x.year === year && x.round === pk.round);
      // Neither: read it as their own original pick, so a pick they already dealt away is flagged.
      from = (mineOrig || any) ? (mineOrig || any)!.originalOwnerRid : holderHint.roster_id;
    }
    return pickAsset(ctx, L, year!, pk.round, from, own, pk.slot);
  }
  const pid = resolveOne(ctx, L, text);
  return pid ? playerAsset(ctx, L, pid) : null;
}
const pieceOut = (L: LeagueRow, x: Piece) => x.kind === 'player'
  ? { player: x.label, pos: x.pos, age: x.age, value: x.value, peak_years_left: x.peak_years_left, injury: x.injury, owner: x.owner_rid ? teamLabel(L, x.owner_rid) : 'free agent' }
  : { pick: x.label, value: x.value, slot_basis: x.slot_basis };
function fitFor(teamA: any, gets: Piece[], gives: Piece[]) {
  if (!teamA) return null;
  const needs = (teamA.needs || []).map((n: any) => n.pos), strengths = teamA.strengths || [];
  const pa = teamA.posAssessment || {};
  const lines: string[] = [];
  gets.filter(x => x.kind === 'player').forEach(x => { if (needs.includes(x.pos)) lines.push(x.label + ' fills a ' + x.pos + ' need'); else if (strengths.includes(x.pos)) lines.push(x.label + ' adds to a ' + x.pos + ' surplus'); });
  gives.filter(x => x.kind === 'player').forEach(x => {
    const p = pa[x.pos] || {};
    const starter = (p.nflStarterIds || []).map(String).includes(x.pid);
    if (needs.includes(x.pos)) lines.push('losing ' + x.label + ' deepens a ' + x.pos + ' hole');
    else if (starter && p.status !== 'surplus') lines.push('losing ' + x.label + ' costs a ' + x.pos + ' starter');
    else if (strengths.includes(x.pos)) lines.push(x.label + ' comes from a ' + x.pos + ' surplus');
  });
  if (gets.some(x => x.kind === 'pick') && teamA.window === 'REBUILDING') lines.push('picks suit a rebuild');
  if (gives.some(x => x.kind === 'pick') && teamA.window === 'CONTENDING') lines.push('spending picks fits a contender');
  return lines;
}

// ── The headliner rule and pricing ───────────────────────────────────────
// A young starter costs one real headline piece. Who counts (one value
// scale): any player 28 or under worth 4,000+, or in superflex / 2QB a QB 29
// or under who starts for his NFL team or is worth 4,000+. A QB costs a 1st
// at minimum (two 1sts when elite, 7,000+, in superflex); anyone else a 1st
// or one young player (28 or under) worth 70%+ of him.
export function headlinerRuleFor(ctx: Ctx, L: LeagueRow, x: Piece | null) {
  if (!x || x.kind !== 'player') return null;
  const age = Number(x.age) || 99, sf = isSF(L), qb = x.pos === 'QB';
  const nflStarter = Number(fresh(ctx, x.pid).dco) === 1;
  const anchor = (x.value >= SCALE.STARTER && age <= 28) || (qb && sf && age <= 29 && (nflStarter || x.value >= SCALE.STARTER));
  if (!anchor) return null;
  const firsts = qb && sf && x.value >= SCALE.ELITE ? 2 : 1;
  return {
    qb, sf, firsts, young_player_min_value: Math.round(x.value * 0.7),
    needed: (firsts === 2 ? 'two 1st-round picks' : 'a 1st-round pick') + (qb ? ', or a young QB of similar standing' : ', or one young player (28 or under) worth ' + Math.round(x.value * 0.7) + '+'),
    rule: qb ? 'A young starting QB costs at least ' + (firsts === 2 ? 'two 1st-round picks' : 'a 1st-round pick') + (sf ? ' in a superflex league' : '') + ', or a young QB of similar standing.'
      : 'A young starter costs one real headline piece: a 1st-round pick or a young player worth about 70%+ of him. Several lesser pieces don\'t add up to one.',
  };
}
// Only 1sts the member verifiably holds count (fix 2).
export function headlinerMet(rule: any, target: Piece, give: Piece[], meRid: unknown) {
  const firsts = give.filter(x => x.kind === 'pick' && x.round === 1 && x.holder != null && String(x.holder) === String(meRid));
  const big = give.filter(x => x.kind === 'player').sort((p, q) => q.value - p.value)[0];
  const playerOk = !!big && big.value >= target.value * 0.7 && (Number(big.age) || 99) <= 28;
  const ok = firsts.length >= rule.firsts || (playerOk && (!rule.qb || firsts.length >= 1 || big.pos === 'QB'));
  return { ok, firsts: firsts.length, via: firsts.length >= rule.firsts ? firsts.map(x => x.label).join(' + ') : ok ? big.label : null };
}
// What one piece the partner gives up costs THEM (fix 1): a listed piece
// takes 15% off, a listed veteran counts at most half his value.
const LISTED_DISCOUNT = 0.85, LISTED_VET_CAP = 0.5;
export function costToOwner(L: LeagueRow, mode: string, x: Piece, listed: boolean) {
  const ap = mode === 'REBUILDING' ? appealFor(L, 'REBUILDING', x) : { mult: 1, why: '' };
  const vet = x.kind === 'player' && isVet(x.pos, x.age);
  const mult = listed ? Math.min(ap.mult * LISTED_DISCOUNT, vet ? LISTED_VET_CAP : Infinity) : ap.mult;
  return { cost: Math.round(x.value * mult), mult: Math.round(mult * 100) / 100, why: [ap.why, listed ? 'on their trade block, so they want him moved' : ''].filter(Boolean).join('; ') };
}
function priceDeal(L: LeagueRow, intent: Intent | null, give: Piece[], get: Piece[]) {
  const mode = intent ? intent.mode : 'NEUTRAL', listed = new Set(intent ? intent._listed : []);
  const priced = give.map(x => { const ap = appealFor(L, mode, x); return { piece: x.label, value: x.value, worth_to_them: Math.round(x.value * ap.mult), why: ap.why || undefined }; });
  const toThem = priced.reduce((n, x) => n + x.worth_to_them, 0);
  const theirCost = get.reduce((n, x) => n + costToOwner(L, mode, x, !!x.pid && listed.has(x.pid)).cost, 0);
  return { priced, toThem, theirCost, ratio: theirCost > 0 ? toThem / theirCost : 1 };
}
// A rebuilder balances by adding veterans it wants gone (its block first), never picks.
function theirVetsToShed(ctx: Ctx, L: LeagueRow, partner: Roster, intent: Intent, exclude: Set<string>, gap: number) {
  const listedSet = new Set(intent ? intent._listed : []);
  return (partner.players || []).map(String).filter(pid => !exclude.has(pid))
    .filter(pid => { const m = metaOf(L, pid); return valueOf(L, pid) > 0 && ((m.peakYrsLeft != null && m.peakYrsLeft <= 1) || isVet(posOf(ctx, L, pid), ageOf(ctx, pid))); })
    .map(pid => ({ pid, v: valueOf(L, pid), listed: listedSet.has(pid) }))
    .sort((x, y) => (Number(y.listed) - Number(x.listed)) || Math.abs(x.v - gap) - Math.abs(y.v - gap)).slice(0, 4)
    .map(x => pname(ctx, x.pid) + ' (' + posOf(ctx, L, x.pid) + ', ' + (ageOf(ctx, x.pid) || '?') + ', value ' + x.v + (x.listed ? ', on their block' : '') + ')');
}
const MODE_WORD: Record<string, string> = { REBUILDING: 'rebuilding', CONTENDING: 'contending', NEUTRAL: 'middle' };
// One verdict, in a fixed order of precedence: ownership > headliner >
// what the partner wants > raw value. Raw value never overrules the headliner.
function reconcile(o: any) {
  const r = o.tt / Math.max(o.tg, 1);
  let decision: string, call: string;
  let market = o.headliner && o.headliner.ok ? 'At market: the headliner is the going rate, not an overpay'
    : r >= 1.15 ? 'You win on value' : r >= 0.95 ? 'Fair value' : r >= 0.85 ? 'Slight overpay' : 'Overpay';
  const who = o.partnerName || 'them';
  if (o.ownIssues.length) { decision = 'pass'; call = 'You can\'t send this as written: ' + o.ownIssues.join(' '); }
  else if (o.headliner && !o.headliner.ok) { decision = 'counter'; market = 'Below the going rate'; call = 'Missing the headliner. ' + o.headliner.rule + ' Lead with that piece, then balance.'; }
  else if (o.pv && o.pv.ratio < 0.8) { decision = 'counter'; call = 'Not appealing to ' + who + ' (' + MODE_WORD[o.mode] + '): your side is worth about ' + o.pv.toThem + ' to them against ' + o.pv.theirCost + ' for what they give up. Rebuild it around what they want.'; }
  else if (!o.headliner && r < 0.85) { decision = 'counter'; call = 'You give up more than you get (' + o.tg + ' for ' + o.tt + '). Trim what you send.'; }
  else if (o.pv && o.pv.ratio < 0.95) { decision = 'offer'; call = 'Close: send it, and be ready to add a small piece of the kind ' + who + ' values.'; }
  else { decision = 'offer'; call = o.headliner ? 'Send it: it meets the going rate for a young starter.' : 'Send it: it works for both sides.'; }
  if (decision === 'offer' && o.accept != null && o.accept < 20) { decision = 'counter'; call = 'The value works on paper, but the chance is low (' + o.accept + '%). ' + call; }
  return { decision, call, market_label: market };
}
const confidenceOf = (o: any) => (!o.partnerKnown || o.unknownHolders) ? 'low' : (o.mode === 'NEUTRAL' || !o.engine || !o.picksLoaded) ? 'medium' : 'high';
const assessSummary = (a: any) => a ? { tier: a.tier || null, window: a.window || null, health: a.healthScore != null ? Math.round(a.healthScore) : null, panic: a.panic != null ? a.panic : null, needs: (a.needs || []).map((n: any) => n.pos + (n.urgency ? ' (' + n.urgency + ')' : '')), strengths: a.strengths || [] } : null;
const VALUES_NOTE = SCALE_NOTE + ' A pick in the next draft is priced at its projected slot from current standings with no year discount; later drafts are mid-round, less 12% a year.';
const list = (v: unknown) => [].concat((v as never) || []).map(String).map(s => s.trim()).filter(Boolean);

// ── evaluate_trade ───────────────────────────────────────────────────────
export async function evaluateTrade(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const giveIn = list(args.give), getIn = list(args.get);
  if (!giveIn.length || !getIn.length) throw new ToolError('Name both sides of the trade: what you give and what you get.');
  let partner: Roster | null = null;
  if (args.partner_roster_id != null && args.partner_roster_id !== '') { partner = rosterOf(L, args.partner_roster_id); if (!partner) throw new ToolError('No roster ' + args.partner_roster_id + ' in ' + L.name + '.'); }
  else if (args.partner) { partner = findTeam(ctx, L, args.partner); if (!partner) throw new ToolError('No team in this league matches "' + args.partner + '".'); }
  if (partner && partner.roster_id === me.roster_id) throw new ToolError('That is your own team; name the other owner.');
  const notFound: string[] = [];
  const give = giveIn.map(t => { const x = resolvePiece(ctx, L, t, me); if (!x) notFound.push(t); return x; }).filter(Boolean) as Piece[];
  // Partner from what I get, before resolving their picks.
  if (!partner) {
    for (const t of getIn) { if (parsePick(ctx, L, t)) continue; const pid = resolveOne(ctx, L, t); const r = pid ? holderOf(L, pid) : null; if (r && r.roster_id !== me.roster_id) { partner = r; break; } }
  }
  const get = getIn.map(t => { const x = resolvePiece(ctx, L, t, partner); if (!x) notFound.push(t); return x; }).filter(Boolean) as Piece[];
  if (!partner) { const pk = get.find(x => x.kind === 'pick' && x.holder != null && String(x.holder) !== String(me.roster_id)); if (pk) partner = rosterOf(L, pk.holder); }
  if (!give.length || !get.length) throw new ToolError('Couldn\'t match: ' + notFound.join(', ') + '. Use full player names or picks like "2027 1st".');

  const tg = give.reduce((s, x) => s + x.value, 0), tt = get.reduce((s, x) => s + x.value, 0);
  const E: any = ctx.te;
  const fair = E && E.fairnessGrade ? E.fairnessGrade(tg, tt) : null;
  // ONE reading of the other owner feeds the mode, posture, pricing and windows.
  const intent = partner ? await ownerIntent(ctx, L, partner) : null;
  const read = dealRead(ctx, L, me, partner, tg, tt, give.length + get.length, intent);
  const mineA = read._mineA || assessOf(L, me.roster_id), theirA = partner ? (read._theirA || assessOf(L, partner.roster_id)) : null;
  const warnings: string[] = [], ownIssues: string[] = [];
  let unknownHolders = false;
  give.forEach(x => {
    if (x.kind === 'player' && x.owner_rid !== String(me.roster_id)) ownIssues.push('You don\'t own ' + x.label + '.');
    if (x.kind === 'pick' && x.holder != null && String(x.holder) !== String(me.roster_id)) ownIssues.push('You don\'t own ' + x.label + '; ' + teamLabel(L, x.holder) + ' does.');
    if (x.kind === 'pick' && x.holder == null) { unknownHolders = true; warnings.push('Couldn\'t confirm you own ' + x.label + ' (pick ownership not stored, or no such pick); it does not count as yours.'); }
  });
  warnings.push(...ownIssues);
  if (partner) get.forEach(x => {
    if (x.kind === 'player' && x.owner_rid !== String(partner!.roster_id)) warnings.push(x.label + ' is not on ' + label(L, partner!.roster_id) + ' (' + (x.owner_rid ? teamLabel(L, x.owner_rid) : 'free agent') + ').');
    if (x.kind === 'pick' && x.holder != null && String(x.holder) !== String(partner!.roster_id)) warnings.push(x.label + ' belongs to ' + teamLabel(L, x.holder) + ', not ' + label(L, partner!.roster_id) + '.');
  });
  const net = tt - tg;
  let partnerView: Record<string, any> | null = null, acceptPct = read.accept_pct, pv: ReturnType<typeof priceDeal> | null = null;
  if (partner && intent) {
    pv = priceDeal(L, intent, give, get);
    const extraPlayers = Math.max(0, give.filter(x => x.kind === 'player').length - get.filter(x => x.kind === 'player').length);
    acceptPct = acceptFor(ctx, read, pv.toThem, pv.theirCost, give.length + get.length, extraPlayers);
    partnerView = {
      their_mode: intent.mode, evidence: intent.evidence, they_want: intent.wants, they_avoid: intent.avoids.length ? intent.avoids : undefined,
      your_package_to_them: pv.priced, worth_to_them: pv.toThem, what_they_give_up_as_they_see_it: pv.theirCost,
      verdict: pv.ratio >= 1 ? 'appealing to them' : pv.ratio >= 0.8 ? 'close, they may want a sweetener of the kind they value' : 'not appealing to them: rebuild the offer around what they want',
      listed_by_them: get.filter(x => x.pid && intent._listed.includes(x.pid)).map(x => x.label + ' is on their trade block'),
    };
    if (!partnerView.listed_by_them.length) delete partnerView.listed_by_them;
  }
  // The headliner rule.
  const anchors = get.map(x => ({ x, rule: headlinerRuleFor(ctx, L, x) })).filter(o => o.rule).sort((p, q) => q.x.value - p.x.value);
  let headliner: Record<string, any> | null = null;
  if (anchors.length) {
    const top = anchors[0].x, rule = anchors[0].rule!;
    const met = headlinerMet(rule, top, give, me.roster_id);
    headliner = { target: top.label + ' (' + top.pos + ', ' + (top.age || '?') + ', value ' + top.value + ')', rule: rule.rule, offer_has_it: met.ok, via: met.via || undefined };
    if (!met.ok) {
      if (acceptPct != null) acceptPct = Math.min(acceptPct, 10);
      warnings.push('No headliner: ' + rule.rule + ' This offer won\'t start the conversation.');
    } else headliner.market = 'This is the going rate: the headliner is the floor for a young starter. A value gap of this size is not an overpay to be clawed back.';
  }
  // Balance: a rebuilding seller never gives picks back; at market there's no gap to claw back.
  let balance: Record<string, any> | null = null;
  if (partner && partnerView && intent && net < 0 && !(headliner && !headliner.offer_has_it)) {
    const gap = Math.abs(net);
    const rebuilding = intent.mode === 'REBUILDING';
    const exclude = new Set(get.map(x => x.pid).filter(Boolean) as string[]);
    if (headliner && headliner.offer_has_it) {
      const opts = rebuilding ? theirVetsToShed(ctx, L, partner, intent, exclude, gap) : [];
      if (opts.length) balance = { optional: true, how: 'At market: no gap to claw back. If you want a throw-in, the only thing to ask a rebuilder for is a veteran they want gone:', options: opts };
    } else if (rebuilding) balance = { you_overpay_by: gap, how: 'A rebuilder won\'t give picks back. Ask them to add a veteran they want gone, ideally one from their trade block:', options: theirVetsToShed(ctx, L, partner, intent, exclude, gap) };
    else balance = { you_overpay_by: gap, how: 'Ask for a pick or a depth player back, or trim what you send.' };
  }
  const v = reconcile({ ownIssues, headliner: headliner ? { ok: headliner.offer_has_it, rule: headliner.rule } : null, pv, mode: intent ? intent.mode : 'NEUTRAL', tg, tt, accept: acceptPct, partnerName: partner ? label(L, partner.roster_id) : null });
  const out: Record<string, any> = {
    verdict: {
      decision: v.decision, confidence: confidenceOf({ partnerKnown: !!partner, unknownHolders, mode: intent ? intent.mode : 'NEUTRAL', engine: !!E, picksLoaded: !!picksByOwner(L) }),
      call: v.call, market_label: v.market_label, accept_chance_pct: acceptPct,
      partner_mode: intent ? MODE_WORD[intent.mode] : null,
      precedence: 'ownership > headliner > what the partner wants > raw value. The fairness grade below is raw value only and never overrules this.',
    },
    headliner: headliner || undefined,
    balance: balance || undefined,
    league_id: L.league_id,
    partner: partner ? label(L, partner.roster_id) + ' (roster ' + partner.roster_id + ')' : 'unknown',
    you_give: give.map(x => pieceOut(L, x)), you_get: get.map(x => pieceOut(L, x)),
    total_give: tg, total_get: tt, net_for_you: net, net_pct: round1(net / Math.max(tg, tt, 1) * 100),
    fairness: fair ? fair.grade + ' — ' + fair.label + ' (raw value totals only; see verdict)' : undefined,
    acceptance_chance_pct: acceptPct,
    acceptance_on_value_only_pct: acceptPct !== read.accept_pct ? read.accept_pct : undefined,
    partner_view: partnerView || undefined,
    their_dna: read.dna ? read.dna.key + (read.dna.confidence_pct != null ? ' (' + read.dna.confidence_pct + '% confidence)' : '') + ': ' + String(read.dna.signals).replace(/\.+$/, '') + '. ' + read.dna.how_to_deal : undefined,
    their_posture: read.posture ? read.posture.label + ' — ' + read.posture.means : undefined,
    psychology: read.psychology,
    my_needs: assessSummary(mineA)?.needs, their_needs: theirA ? assessSummary(theirA)?.needs : undefined,
    fit: { for_me: fitFor(mineA, get, give), for_them: theirA ? fitFor(theirA, give, get) : null },
    roster_fit_0_100: partner && E && E.calcComplementarity && mineA && theirA ? E.calcComplementarity(mineA, theirA) : undefined,
  };
  if (mineA && intent) out.windows = (mineA.window === 'CONTENDING' && intent.mode === 'REBUILDING') || (mineA.window === 'REBUILDING' && intent.mode === 'CONTENDING') ? 'opposite windows: a natural fit' : mineA.window === intent.mode ? 'same window: less natural motivation' : 'mixed';
  if (warnings.length) out.warnings = warnings;
  if (notFound.length) out.not_found = notFound;
  if (intent && !intent._blockRead) out.block_note = 'Sleeper\'s trade block could not be read just now, so listings were not counted.';
  out.values_note = VALUES_NOTE;
  out.how_to_use = 'Lead with verdict.call. To BUILD an offer instead of grading one, call trade_plan.';
  out.method = skillText('trade_evaluation');
  out.numbers_as_of = L.built_at;
  return out;
}

// ── trade_plan (verdict first) ───────────────────────────────────────────
// "How do I get X" / "what can I do with this team": the partner's mode with
// evidence, what I own (and only that), the going rate, up to three offers
// built from my assets and priced the way the partner sees them, what not
// to offer. Same rules as evaluate_trade (shared above).
const pieceKey = (x: Piece) => x.kind === 'pick' ? 'pk:' + x.year + ':' + x.round + ':' + x.from : 'pl:' + x.pid;
const pieceName = (x: Piece) => x.kind === 'pick' ? x.label : x.label + ' (' + x.pos + ', ' + (x.age || '?') + ')';
function comparablesFor(ctx: Ctx, L: LeagueRow, target: Piece | null, partner: Roster) {
  const near = (t: any) => target && target.kind === 'player' && Object.values(t.sides || {}).some((s: any) => (s.players || []).some((pid: string) => posOf(ctx, L, pid) === target.pos && valueOf(L, pid) >= target.value * 0.6 && valueOf(L, pid) <= target.value * 1.4));
  return tradesThisSeason(L).filter(t => near(t) || (t.roster_ids || []).map(String).includes(String(partner.roster_id))).slice(0, 3)
    .map(t => ({ date: isoDate(t.ts) || L.season + ' wk ' + t.week, sides: Object.entries(t.sides || {}).map(([rid, s]: [string, any]) => ({ team: teamLabel(L, rid), got: [...(s.players || []).map((pid: string) => pname(ctx, pid) + ' (' + posOf(ctx, L, pid) + ', ' + valueOf(L, pid) + ')'), ...(s.picks || []).map((p: any) => p.season + ' ' + ord(Number(p.round)))] })) }));
}
export async function tradePlan(ctx: Ctx, L: LeagueRow, args: any) {
  const me = myRoster(L, ctx.memberId);
  if (!me) throw new ToolError('You do not have a team in ' + L.name + '.');
  const meRid = String(me.roster_id);
  let partner: Roster | null = null;
  if (args.partner_roster_id != null && args.partner_roster_id !== '') { partner = rosterOf(L, args.partner_roster_id); if (!partner) throw new ToolError('No roster ' + args.partner_roster_id + ' in ' + L.name + '.'); }
  else if (args.partner) { partner = findTeam(ctx, L, args.partner); if (!partner) throw new ToolError('No team in this league matches "' + args.partner + '".'); }
  if (partner && partner.roster_id === me.roster_id) throw new ToolError('That\'s your own team; name the other owner.');
  let target: Piece | null = null;
  if (args.target) {
    target = resolvePiece(ctx, L, String(args.target), partner);
    if (!target) throw new ToolError('No player or pick matches "' + args.target + '".');
    if (target.kind === 'player') {
      if (target.owner_rid === meRid) throw new ToolError(target.label + ' is already yours.');
      if (!target.owner_rid) throw new ToolError(target.label + ' is a free agent: no trade needed.');
      if (partner && String(partner.roster_id) !== target.owner_rid) throw new ToolError(target.label + ' is on ' + teamLabel(L, target.owner_rid) + ', not ' + label(L, partner.roster_id) + '.');
      partner = partner || rosterOf(L, target.owner_rid);
    } else {
      if (target.holder == null) throw new ToolError('Couldn\'t confirm who holds ' + target.label + ' (pick ownership not stored).');
      if (String(target.holder) === meRid) throw new ToolError('You already hold ' + target.label + '.');
      if (partner && String(partner.roster_id) !== String(target.holder)) throw new ToolError(target.label + ' belongs to ' + teamLabel(L, target.holder) + ', not ' + label(L, partner.roster_id) + '.');
      partner = partner || rosterOf(L, target.holder);
    }
  }
  if (!partner) throw new ToolError('Name the player you want (target) or the team to deal with (partner).');
  const p = partner;
  const intent = await ownerIntent(ctx, L, p);
  const mode = intent.mode, listed = new Set(intent._listed);
  const read = dealRead(ctx, L, me, p, 0, 0, 0, intent);
  const evidence: string[] = [];
  if (!target) {
    const best = (p.players || []).map(String).filter(pid => listed.has(pid)).map(pid => playerAsset(ctx, L, pid)).filter(x => x.value > 0).sort((a, b) => b.value - a.value)[0];
    if (best) { target = best; evidence.push('No target named: using ' + best.label + ', the most valuable player on ' + label(L, p.roster_id) + '\'s trade block.'); }
  }
  // What I own: roster players, and picks the build says I hold. Nothing else is ever offered.
  const own = picksByOwner(L);
  const picksLoaded = !!own;
  const withAppeal = (x: Piece) => { const ap = appealFor(L, mode, x); return Object.assign({}, x, { to_them: Math.round(x.value * ap.mult), mult: ap.mult, why: ap.why }); };
  const myPlayers = (me.players || []).map(String).map(pid => playerAsset(ctx, L, pid)).filter(x => x.value > 0);
  const myPicks = own ? (own[meRid] || []).map(x => pickAsset(ctx, L, x.year, x.round, x.originalOwnerRid, own, null)).filter(x => String(x.holder) === meRid) : [];
  const assets = [...myPlayers, ...myPicks].map(withAppeal);
  const myFirstsAll = assets.filter(x => x.kind === 'pick' && x.round === 1);
  evidence.push(...intent.evidence);
  if (target && target.pid && listed.has(target.pid)) evidence.push(target.label + ' is on their trade block.');
  evidence.push(picksLoaded ? 'You hold ' + myFirstsAll.length + ' 1st-round pick' + (myFirstsAll.length === 1 ? '' : 's') + (myFirstsAll.length ? ': ' + myFirstsAll.map(x => x.label).join(', ') : '') + '.' : 'Pick ownership is not stored for this league, so no picks are offered.');
  if (!intent._blockRead) evidence.push('Sleeper\'s trade block could not be read just now, so listings were not counted.');

  // What not to offer.
  const doNot: Array<{ asset: string; reason: string }> = [], dnoKeys = new Set<string>();
  const addDno = (key: string, asset: string, reason: string) => { if (dnoKeys.has(key)) return; dnoKeys.add(key); doNot.push({ asset, reason }); };
  const relic = (x: any) => mode === 'REBUILDING' && x.mult <= 0.55;
  const lowLiquidity = (x: any) => x.kind === 'player' && /^(K|DEF)$/.test(x.pos);
  let userGive: any[] | null = null;
  const userIssues: string[] = [];
  const giveIn = list(args.give);
  if (giveIn.length) {
    userGive = [];
    giveIn.forEach(t => {
      const x = resolvePiece(ctx, L, t, me);
      if (!x) { addDno('t:' + t, t, 'couldn\'t match it to a player or pick'); userIssues.push(t + ' (not found)'); return; }
      if (x.kind === 'player' && x.owner_rid !== meRid) { addDno(pieceKey(x), x.label, 'not yours' + (x.owner_rid ? ': ' + teamLabel(L, x.owner_rid) + ' has him' : ': a free agent')); userIssues.push(x.label + ' is not yours'); return; }
      if (x.kind === 'pick' && (x.holder == null || String(x.holder) !== meRid)) { addDno(pieceKey(x), x.label, x.holder == null ? 'can\'t confirm you own it (pick ownership not stored, or no such pick)' : 'not yours: ' + teamLabel(L, x.holder) + ' holds it'); userIssues.push(x.label + ' is not yours'); return; }
      const w = withAppeal(x);
      if (relic(w)) addDno(pieceKey(w), pieceName(w), w.why + ' (worth about ' + w.to_them + ' to them, not ' + w.value + ')');
      if (lowLiquidity(w)) addDno(pieceKey(w), pieceName(w), 'kickers and defenses don\'t move trades');
      userGive!.push(w);
    });
  }
  assets.filter(x => relic(x) && x.value >= SCALE.DEPTH / 2).sort((a, b) => b.value - a.value).slice(0, 6)
    .forEach(x => addDno(pieceKey(x), pieceName(x), x.why + ' (worth about ' + x.to_them + ' to them, not ' + x.value + ')'));

  const partnerOut = {
    name: label(L, p.roster_id), roster_id: p.roster_id, mode: MODE_WORD[mode], why: intent.evidence, wants: intent.wants,
    wont_take: [...intent.avoids, ...assets.filter(x => relic(x) && x.value >= SCALE.DEPTH / 2).sort((a, b) => b.value - a.value).slice(0, 4).map(x => 'your ' + pieceName(x))],
    posture: read.posture ? read.posture.label : undefined, dna: read.dna ? read.dna.label : undefined,
  };
  const myAssetsOut = {
    picks: myPicks.map(withAppeal).sort((a, b) => a.year - b.year || a.round - b.round).map(x => ({ pick: x.label, year: x.year, round: x.round, original_owner: x.from != null ? teamLabel(L, x.from) : null, value: x.value, value_to_them: x.to_them, slot_basis: x.slot_basis })),
    players: myPlayers.map(withAppeal).sort((a, b) => b.value - a.value).slice(0, 15).map(x => ({ player: x.label, pos: x.pos, age: x.age, value: x.value, value_to_them: x.to_them, why: x.why || undefined })),
    more_players: Math.max(0, myPlayers.length - 15) || undefined,
    picks_note: picksLoaded ? undefined : 'Pick ownership is not stored for this league; no picks are listed or offered.',
  };
  const rulesApplied = [
    'Partner mode read once (record, this season\'s trades, trade block); the app window is evidence only. A rebuild read wins over panic.',
    'Only assets you verifiably own are listed or offered; a pick with an unknown holder is not yours.',
    'Pieces priced as the partner sees them. A rebuilder: next-draft picks x1.15, the draft after x1.0, later x0.85; players 24 or under x1.15; ' + VET_RULE + ' x0.55 or x0.2.',
    'A listed player costs his owner 15% less; a listed veteran at most half his value.',
    'Next draft: slot projected from current standings (worst team picks 1st), no year discount; later drafts mid-round, less 12% a year.',
    'Acceptance is estimated on value to them, minus 8 points per extra player they must roster; capped at 10% without the headliner.',
    'A rebuilder never gives picks back: balance with veterans they want gone.',
  ];
  const method = 'Read the partner, price each of your assets the way they see it, set the going rate for the target (headliner rule), build offers only from what you own, estimate acceptance on what they value. Precedence: ownership > headliner > what the partner wants > raw value. Lead with `recommendation`; never propose an asset that is not in my_assets.';
  const base = { league_id: L.league_id, partner: partnerOut, my_assets: myAssetsOut };

  if (!target) {
    return Object.assign({ decision: 'no_fit', confidence: 'medium', recommendation: label(L, p.roster_id) + ' has nothing on their trade block; name the player you want from them.' }, base, { price_floor: null, offers: [], do_not_offer: doNot, comparables: comparablesFor(ctx, L, null, p), evidence, rules_applied: rulesApplied, method, values_note: VALUES_NOTE, numbers_as_of: L.built_at });
  }
  const tgt = target;
  // The going rate.
  const rule = headlinerRuleFor(ctx, L, tgt);
  const tCost = costToOwner(L, mode, tgt, !!tgt.pid && listed.has(tgt.pid));
  const priceFloor = {
    target: tgt.label + (tgt.kind === 'player' ? ' (' + tgt.pos + ', ' + (tgt.age || '?') + ', value ' + tgt.value + ')' : ' (value ' + tgt.value + ')'),
    headliner_needed: rule ? rule.needed : 'none: not a young front-line starter',
    rule: rule ? rule.rule : 'Not a young front-line starter: match what he is worth to them.',
    their_price: tCost.cost, their_price_why: tCost.why || undefined,
    note: rule ? 'Meeting the headliner is the going rate, not an overpay.' : undefined,
  };
  if (rule) rulesApplied.unshift(rule.rule);

  // Offers, from my assets only.
  const pool = assets.filter(x => !relic(x) && !lowLiquidity(x) && x.to_them >= 150);
  const score = (pieces: any[], tag: string) => {
    const pv = priceDeal(L, intent, pieces, [tgt]);
    const hl = rule ? headlinerMet(rule, tgt, pieces, meRid) : null;
    const extra = Math.max(0, pieces.filter(x => x.kind === 'player').length - (tgt.kind === 'player' ? 1 : 0));
    let acc = acceptFor(ctx, read, pv.toThem, pv.theirCost, pieces.length + 1, extra);
    if (hl && !hl.ok) acc = Math.min(acc, 10);
    const rawGive = pieces.reduce((n, x) => n + x.value, 0);
    let balance: Record<string, unknown> | undefined;
    if (pv.toThem > pv.theirCost * 1.15) {
      if (mode === 'REBUILDING') { const opts = theirVetsToShed(ctx, L, p, intent, new Set([tgt.pid].filter(Boolean)), pv.toThem - pv.theirCost); if (opts.length) balance = { optional: true, ask_them_to_add: opts, never: 'Don\'t ask a rebuilder for picks back.' }; }
      else balance = { optional: true, ask_for: 'a pick or a depth player back, or trim what you send' };
    }
    const v = reconcile({ ownIssues: [], headliner: hl ? { ok: hl.ok, rule: rule!.rule } : null, pv, mode, tg: rawGive, tt: tgt.value, accept: acc, partnerName: label(L, p.roster_id) });
    return {
      tag, pieces, pv, hl, acc, rawGive,
      out: {
        give: pieces.map(pieceName), get: [tgt.label],
        accept_chance_pct: acc, headliner_met: hl ? hl.ok : undefined, market_label: v.market_label,
        value_you_send: rawGive, value_you_get: tgt.value, worth_to_them: pv.toThem, their_price: pv.theirCost,
        why: tag + '. Worth about ' + pv.toThem + ' to a ' + MODE_WORD[mode] + ' owner against ' + pv.theirCost + ' for ' + tgt.label + ' as they see him. ' + pv.priced.map(x => x.piece + ': ' + (x.why || 'full value')).join('; ') + '.',
        balance,
      } as Record<string, any>,
    };
  };
  const fill = (basePieces: any[]) => {
    const pieces = basePieces.slice(), used = new Set(pieces.map(pieceKey));
    const gap = () => tCost.cost - pieces.reduce((n, x) => n + x.to_them, 0);
    while (gap() > 0 && pieces.length < 3) {
      const cands = pool.filter(x => !used.has(pieceKey(x)));
      if (!cands.length) break;
      const g = gap();
      const next = cands.filter(x => x.to_them >= g).sort((a, b) => a.to_them - b.to_them)[0] || cands.sort((a, b) => b.to_them - a.to_them)[0];
      pieces.push(next); used.add(pieceKey(next));
    }
    return pieces;
  };
  const bases: Array<{ tag: string; base: any[] }> = [];
  if (rule) {
    // A rebuilder wants the nearest 1st; anyone else, the cheapest that does the job.
    const firsts = pool.filter(x => x.kind === 'pick' && x.round === 1).sort(mode === 'REBUILDING' ? (a, b) => b.to_them - a.to_them : (a, b) => a.value - b.value);
    if (firsts.length >= rule.firsts) {
      bases.push({ tag: 'Leads with ' + (rule.firsts === 2 ? 'two 1sts' : 'a 1st') + ', the headliner ' + (rule.qb ? 'a young starting QB needs' : 'a young starter needs'), base: firsts.slice(0, rule.firsts) });
      if (firsts.length > rule.firsts) bases.push({ tag: 'Leads with a different 1st', base: firsts.slice(1, 1 + rule.firsts) });
    }
    const heads = pool.filter(x => x.kind === 'player' && x.value >= tgt.value * 0.7 && (Number(x.age) || 99) <= 28 && (!rule.qb || x.pos === 'QB')).sort((a, b) => a.value - b.value);
    if (heads[0]) bases.push({ tag: 'Leads with a young ' + heads[0].pos + ' of similar standing', base: [heads[0]] });
  } else {
    const single = pool.filter(x => x.to_them >= tCost.cost).sort((a, b) => a.value - b.value)[0];
    if (single) bases.push({ tag: 'One piece that covers his price', base: [single] });
    const pk = pool.filter(x => x.kind === 'pick' && x !== single).sort((a, b) => Math.abs(a.to_them - tCost.cost) - Math.abs(b.to_them - tCost.cost))[0];
    if (pk) bases.push({ tag: 'Pick-led', base: [pk] });
    const yp = pool.filter(x => x.kind === 'player' && x !== single).sort((a, b) => Math.abs(a.to_them - tCost.cost) - Math.abs(b.to_them - tCost.cost))[0];
    if (yp) bases.push({ tag: 'Player-led', base: [yp] });
  }
  let scored = bases.map(b => score(fill(b.base), b.tag));
  // A lone headliner with a modest chance also gets a sweetened version.
  scored.slice().forEach(s => {
    if (s.pieces.length === 1 && s.acc < 60) {
      const add = pool.filter(x => pieceKey(x) !== pieceKey(s.pieces[0]) && !(x.kind === 'pick' && x.round === 1)).sort((a, b) => a.to_them - b.to_them).find(x => x.to_them >= 300);
      if (add) scored.push(score([s.pieces[0], add], s.tag + ', plus a sweetener'));
    }
  });
  const seen = new Set<string>();
  scored = scored.filter(s => { const k = s.pieces.map(pieceKey).sort().join('|'); if (seen.has(k)) return false; seen.add(k); return true; })
    .filter(s => !rule || (s.hl && s.hl.ok))
    .sort((a, b) => b.acc - a.acc || a.rawGive - b.rawGive).slice(0, 3);
  const best = scored[0] || null;

  // Their own package, if they named one.
  let yourOffer: Record<string, any> | undefined;
  let ys: ReturnType<typeof score> | null = null;
  if (userGive) {
    if (userIssues.length || !userGive.length) yourOffer = { give: giveIn, valid: false, problems: userIssues };
    else { ys = score(userGive, 'Your package'); yourOffer = Object.assign({ valid: true }, ys.out); }
  }
  const who = label(L, p.roster_id), mw = MODE_WORD[mode];
  const leadWith = mode === 'REBUILDING' ? ' They\'re rebuilding, so lead with picks and young players, not veterans.' : mode === 'CONTENDING' ? ' They\'re contending, so proven starters move them more than picks.' : '';
  let decision: string, recommendation: string;
  if (ys && (!rule || (ys.hl && ys.hl.ok)) && ys.acc >= 40 && ys.pv.ratio >= 0.95) {
    decision = 'offer';
    recommendation = 'Send your package (' + yourOffer!.give.join(' + ') + ') for ' + tgt.label + ': about ' + ys.acc + '% to be accepted.' + leadWith;
  } else if (!best) {
    decision = 'no_fit';
    recommendation = 'Nothing you own meets the price for ' + tgt.label + ': ' + (rule ? 'it takes ' + rule.needed + (picksLoaded ? '' : ', and your picks aren\'t stored') : 'nothing you own is worth enough to a ' + mw + ' owner') + '.';
  } else if (yourOffer) {
    decision = 'counter';
    const whyNot = !yourOffer.valid ? yourOffer.problems.join('; ') : (rule && !(ys!.hl && ys!.hl.ok)) ? 'no headliner: it takes ' + rule.needed : ys!.pv.ratio < 0.95 ? 'worth only about ' + ys!.pv.toThem + ' to ' + who + ' against ' + ys!.pv.theirCost : 'too little appeal';
    recommendation = 'Don\'t send ' + giveIn.join(' + ') + ' (' + whyNot + (yourOffer.valid ? '; about ' + ys!.acc + '% to be accepted' : '') + '). Offer ' + best.out.give.join(' + ') + ' instead: about ' + best.acc + '% to be accepted.' + leadWith;
  } else if (best.acc < 20) {
    decision = 'pass';
    recommendation = 'The best you can build is ' + best.out.give.join(' + ') + ' at about ' + best.acc + '%: not worth chasing ' + tgt.label + ' right now.';
  } else if (!rule && best.rawGive > tgt.value * 1.5) {
    decision = 'pass';
    recommendation = 'It would cost you about ' + best.rawGive + ' in value for ' + tgt.label + ' (worth ' + tgt.value + '): too steep.';
  } else {
    decision = 'offer';
    recommendation = 'Offer ' + best.out.give.join(' + ') + ' for ' + tgt.label + ': about ' + best.acc + '% to be accepted.' + leadWith;
  }
  const confidence = !picksLoaded ? 'low' : (mode === 'NEUTRAL' || !ctx.te || decision === 'no_fit') ? 'medium' : best && best.acc >= 50 ? 'high' : 'medium';
  return Object.assign({ decision, confidence, recommendation }, base, {
    price_floor: priceFloor,
    offers: scored.map(s => s.out),
    your_offer: yourOffer,
    do_not_offer: doNot,
    comparables: comparablesFor(ctx, L, tgt, p),
    evidence, rules_applied: rulesApplied, method, values_note: VALUES_NOTE, numbers_as_of: L.built_at,
  });
}

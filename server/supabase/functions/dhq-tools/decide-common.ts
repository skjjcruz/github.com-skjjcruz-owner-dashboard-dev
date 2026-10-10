// dhq-tools/decide-common.ts — small reads shared by the decision modules
// (decide-trade.ts, decide-roster.ts) so the trade, roster and waiver tools
// read players, teams and values the same way.
// deno-lint-ignore-file no-explicit-any
import { type Ctx, type LeagueRow, type Roster, myRoster, rosterOf, teamName, ownerName, dhq, fresh, seasonBits, teamPlayed, norm } from './tools.ts';

// One value scale (owner ruling 2026-10-10), the same bands the connector's
// instructions state. Every threshold in the decision tools reads from here.
export const SCALE = { ELITE: 7000, STARTER: 4000, DEPTH: 2000 };
export const SCALE_NOTE = 'Values are DHQ dynasty values: 7,000+ elite, 4,000+ starter, 2,000+ depth, below that a stash.';

const POS_NORM: Record<string, string> = { DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL', IDL: 'DL', OLB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', PK: 'K', DST: 'DEF', 'D/ST': 'DEF' };
export const normPos = (p: unknown) => { const u = String(p || '').toUpperCase(); return POS_NORM[u] || u; };
export const metaOf = (L: LeagueRow, pid: string): Record<string, any> => (L.intel.playerMeta || {})[pid] || {};
// Fantasy position, normalised (DE/DT → DL, CB/S → DB, OLB → LB).
export const posOf = (ctx: Ctx, L: LeagueRow, pid: string) => normPos(metaOf(L, pid).pos || (ctx.players[pid] || {}).pos || '');
export const pname = (ctx: Ctx, pid: string) => (ctx.players[pid] && ctx.players[pid].n) || String(pid);
export const ageOf = (ctx: Ctx, pid: string): number | null => { const a = Number((ctx.players[pid] || {}).age); return a > 0 ? a : null; };
export const valueOf = (L: LeagueRow, pid: string) => dhq(L, pid);
export const label = (L: LeagueRow, rid: unknown) => { const t = teamName(L, rid), o = ownerName(L, rid); return t + (o && o !== t ? ' (' + o + ')' : ''); };
export const isMe = (ctx: Ctx, L: LeagueRow, r: Roster | null) => { const me = myRoster(L, ctx.memberId); return !!(me && r && me.roster_id === r.roster_id); };
export const holderOf = (L: LeagueRow, pid: string): Roster | null => L.snapshot.rosters.find(r => (r.players || []).map(String).includes(String(pid))) || null;
export const injuryText = (ctx: Ctx, pid: string) => { const p = fresh(ctx, pid); return p.inj ? p.inj + (p.injp ? ' (' + p.injp + ')' : '') : null; };
// This week, in the league's scoring: points scored once his game started, else Sleeper's projection.
export function weekPts(ctx: Ctx, L: LeagueRow, pid: string): number | null {
  const b = seasonBits(ctx, L, pid) as Record<string, any>;
  return b.scored_this_week != null ? Number(b.scored_this_week) : b.proj_this_week != null ? Number(b.proj_this_week) : null;
}
export const gameStarted = (ctx: Ctx, pid: string) => teamPlayed(ctx, fresh(ctx, pid).t);
export const weekNow = (L: LeagueRow) => Number(L.snapshot.proj_week) || Number((L.snapshot.nfl_state || {}).week) || 0;

// A team from a name, owner, roster id or "me"; null when nothing matches
// (the Lab's findTeam, over the stored league).
export function findTeam(ctx: Ctx, L: LeagueRow, q: unknown): Roster | null {
  if (q == null || q === '' || /^(me|my|mine|my team|myself|i)$/i.test(String(q).trim())) return myRoster(L, ctx.memberId);
  const t = norm(q);
  const rs = L.snapshot.rosters;
  const byId = rosterOf(L, String(q).trim());
  if (byId && /^\d{1,3}$/.test(String(q).trim())) return byId;
  if (!t) return null;
  const exact = rs.find(r => norm(teamName(L, r.roster_id)) === t || norm(ownerName(L, r.roster_id)) === t);
  if (exact) return exact;
  return rs.find(r => norm(teamName(L, r.roster_id)).includes(t) || norm(ownerName(L, r.roster_id)).includes(t) || (t.length >= 3 && !!norm(ownerName(L, r.roster_id)) && t.includes(norm(ownerName(L, r.roster_id))))) || null;
}

// Slots this league can start, as base positions.
const FLEX: Record<string, string[]> = { FLEX: ['RB', 'WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'], SUPERFLEX: ['QB', 'RB', 'WR', 'TE'], REC_FLEX: ['WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], IDP_FLEX: ['DL', 'LB', 'DB'], IDP: ['DL', 'LB', 'DB'] };
export const POS_ALL = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'];
export const posSet = (q: unknown): string[] | null => { const p = String(q || '').toUpperCase().replace(/[\s-]/g, '_'); return FLEX[p] || (p === 'DST' || p === 'D_ST' ? ['DEF'] : p ? [normPos(p)] : null); };
export function leaguePositions(L: LeagueRow): string[] {
  const set = new Set<string>();
  ((L.snapshot.league || {}).roster_positions || []).forEach((s: string) => {
    const k = String(s).toUpperCase();
    if (k === 'BN' || k === 'IR' || k === 'TAXI') return;
    (FLEX[k] || [normPos(k)]).forEach(p => { if (POS_ALL.includes(p)) set.add(p); });
  });
  return set.size ? POS_ALL.filter(p => set.has(p)) : ['QB', 'RB', 'WR', 'TE'];
}

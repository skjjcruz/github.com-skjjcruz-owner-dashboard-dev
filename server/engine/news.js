// server/engine/news.js — the player news index (owner ask 2026-10-09).
//
// NFL news moves players: a new play-caller, a QB change, a teammate's
// injury. This builds one list per player of the news that touches him, so
// the app and the member's AI read it next to the numbers.
//
// Sources (ESPN's public site feed, free, no key):
//   · every team's news, last 14 days, and the league-wide feed
//   · a player's own written report (Rotowire via ESPN's athlete overview)
//     for rostered players whose Sleeper record says the news just changed
//
// Linking, in order of confidence:
//   direct   ESPN tagged the player in the story (by ESPN id → Sleeper id),
//            or his full name is in the headline
//   team     a team-only story whose kind moves the whole offense (coaching,
//            play-calling, quarterback change) → that team's skill players
//   teammate a quarterback's injury, benching or move → his receivers
//   report   the player's own report
//
// Kinds come from plain keyword rules (no AI, so DHQ pays nothing). News is
// always news: it is shown with its source and date and never changes what
// Sleeper says about rosters, lineups or values.
'use strict';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const OVERVIEW = id => 'https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/' + id + '/overview';
const ESPN_ABBR = { WSH: 'WAS' };
const DAYS = 14;
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

async function getJson(url) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(15000) }); if (r.ok) return await r.json(); } catch { /* retry once */ }
  }
  return null;
}
const norm = s => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();

// What a story is about. First match wins, most specific first.
const KINDS = [
  ['coaching', /\b(play-?call\w*|offensive coordinator|oc|head coach|fired|interim (head )?coach|coaching staff)\b/i],
  ['qb', /\b(qb|quarterback)s?\b.*\b(start\w*|bench\w*|named|change|replace\w*|demot\w*)\b|\bto start at quarterback\b|\bstarting quarterback\b/i],
  ['suspension', /\bsuspen\w+/i],
  ['transaction', /\b(trade[ds]?|trading|sign(s|ed|ing)?|re-sign\w*|releas\w+|waive[ds]?|claim(ed|s)?|acquir\w+|cut|deal with|extension|contract)\b/i],
  ['return', /\b(return\w*|activat\w+|cleared|back from|off (ir|injured reserve)|designated to return)\b/i],
  ['injury', /\b(injur\w*|hamstring|ankle|knee|concussion|acl|mcl|achilles|groin|calf|shoulder|surgery|sprain\w*|torn|tear|fracture\w*|placed on ir|injured reserve|ruled out|out for|week-to-week|day-to-day|questionable|doubtful)\b/i],
  ['practice', /\b(practice\w*|limited|did not participate|dnp|full participant|estimated)\b/i],
  ['role', /\b(depth chart|starter|starting|backfield|snaps?|role|workload|rb1|wr1|target share|demot\w+|promot\w+|lead back|committee|rotation|usage)\b/i],
];
function kindOf(text) {
  for (const [k, re] of KINDS) if (re.test(text)) return k;
  return 'news';
}
// The headline decides; the summary only when the headline says nothing
// (a summary often recaps older news: "...after last week's ankle injury").
const kindOfStory = (headline, summary) => { const k = kindOf(headline || ''); return k !== 'news' || !summary ? k : kindOf(summary); };
// Kinds that move a whole offense when a story names only the team.
const TEAM_WIDE = new Set(['coaching', 'qb']);

function storyOf(a) {
  if (!a || !a.headline || a.type === 'Media') return null;
  const at = Date.parse(a.published || a.lastModified || '');
  if (!(at > Date.now() - DAYS * 864e5)) return null;
  const url = (((a.links || {}).web || {}).href) || null;
  const cats = a.categories || [];
  return {
    id: String(a.id || a.dataSourceIdentifier || url || a.headline),
    headline: String(a.headline).slice(0, 240),
    summary: a.description && a.description !== a.headline ? String(a.description).slice(0, 400) : null,
    url, published_at: new Date(at).toISOString(),
    athletes: cats.filter(c => c.type === 'athlete' && (c.athleteId || (c.athlete && c.athlete.id))).map(c => Number(c.athleteId || c.athlete.id)),
    teams: cats.filter(c => c.type === 'team' && c.teamId).map(c => Number(c.teamId)),
  };
}

// players: Sleeper's full /players/nfl. espnIds: extra Sleeper→ESPN ids
// matched by name. rostered: Sleeper ids on any connected roster.
// prior: last run's report map { pid: { news_updated, row } } so unchanged
// reports are not fetched again.
async function buildNewsIndex(players, espnIds, rostered, prior) {
  const t0 = Date.now();
  const toSleeper = {};
  for (const pid in players) { const e = players[pid] && players[pid].espn_id; if (e) toSleeper[Number(e)] = pid; }
  Object.entries(espnIds || {}).forEach(([pid, e]) => { toSleeper[Number(e)] = pid; });

  // Teams: ESPN id → abbreviation, and each team's fantasy-relevant players.
  const t = await getJson(ESPN + '/teams?limit=40');
  const teams = ((((t || {}).sports || [])[0] || {}).leagues || [{}])[0].teams || [];
  const abbrOf = {};
  teams.forEach(({ team }) => { abbrOf[Number(team.id)] = ESPN_ABBR[team.abbreviation] || team.abbreviation; });
  const skillByTeam = {};
  for (const pid in players) {
    const p = players[pid];
    if (!p || !p.team || !p.active || !SKILL.has(p.position)) continue;
    // Starters and real contributors only: depth chart top three, or ranked.
    const relevant = (p.depth_chart_order != null && p.depth_chart_order <= 3) || (p.search_rank != null && p.search_rank < 400);
    if (relevant) (skillByTeam[p.team] = skillByTeam[p.team] || []).push(pid);
  }

  // Stories: every team's feed plus the league feed, deduped by id.
  const stories = new Map();
  const take = j => ((j || {}).articles || []).forEach(a => { const s = storyOf(a); if (s && !stories.has(s.id)) stories.set(s.id, s); });
  take(await getJson(ESPN + '/news?limit=100'));
  for (let i = 0; i < teams.length; i += 4) {
    const batch = await Promise.all(teams.slice(i, i + 4).map(({ team }) => getJson(ESPN + '/news?limit=50&team=' + team.id)));
    batch.forEach(take);
  }

  // Full names on teams, for headlines ESPN did not tag.
  const nameIndex = [];
  for (const team in skillByTeam) skillByTeam[team].forEach(pid => { const n = norm(players[pid].full_name || ''); if (n.includes(' ') && n.length >= 7) nameIndex.push([n, pid]); });

  const rows = [];
  const add = (pid, s, link, kind, why) => {
    const p = players[pid];
    if (!p) return;
    rows.push({ id: s.id + ':' + pid, player_id: pid, team: p.team || null, kind, link, why: why || null, headline: s.headline, summary: s.summary, url: s.url, source: 'ESPN', published_at: s.published_at });
  };
  for (const s of stories.values()) {
    const kind = kindOfStory(s.headline, s.summary);
    const direct = new Set();
    const h = ' ' + norm(s.headline) + ' ', hs = ' ' + norm(s.headline + ' ' + (s.summary || '')) + ' ';
    const named = pid => { const n = norm(players[pid] && players[pid].full_name || ''); return n && hs.includes(' ' + n + ' '); };
    // Roundups ("pickups for Week 4", "buzz") tag a dozen players; only the
    // ones the headline or summary actually names count.
    const roundup = s.athletes.length > 4;
    s.athletes.forEach(e => { const pid = toSleeper[e]; if (pid && (!roundup || named(pid))) direct.add(pid); });
    nameIndex.forEach(([n, pid]) => { if (h.includes(' ' + n + ' ')) direct.add(pid); });
    direct.forEach(pid => add(pid, s, 'direct', kind));
    const teamAbbrs = s.teams.map(id => abbrOf[id]).filter(Boolean);
    // A team-only story about coaching or the quarterback: the whole offense.
    if (!direct.size && teamAbbrs.length === 1 && TEAM_WIDE.has(kind) && TEAM_WIDE.has(kindOf(s.headline))) {
      (skillByTeam[teamAbbrs[0]] || []).forEach(pid => add(pid, s, 'team', kind, teamAbbrs[0] + (kind === 'coaching' ? ' coaching / play-calling' : ' quarterback situation')));
    }
    // A quarterback's injury, benching or move: his receivers feel it.
    if (['injury', 'qb', 'transaction', 'suspension', 'return'].includes(kind)) {
      direct.forEach(pid => {
        const p = players[pid];
        // Only when the quarterback is the story (named in the headline).
        if (!p || p.position !== 'QB' || !p.team || !h.includes(' ' + norm(p.full_name || '') + ' ')) return;
        (skillByTeam[p.team] || []).filter(x => x !== pid && ['WR', 'TE'].includes(players[x].position)).forEach(x => add(x, s, 'teammate', kind, 'their QB ' + (p.full_name || '')));
      });
    }
  }

  // The player's own report, for rostered players whose news just changed.
  const reports = {};
  const due = [...(rostered || [])].filter(pid => {
    const p = players[pid]; if (!p) return false;
    const e = p.espn_id || (espnIds || {})[pid]; if (!e) return false;
    const was = prior && prior[pid];
    return !was || Number(p.news_updated || 0) > Number(was.news_updated || 0);
  }).sort((a, b) => Number(players[b].news_updated || 0) - Number(players[a].news_updated || 0)).slice(0, 250);
  for (let i = 0; i < due.length; i += 8) {
    await Promise.all(due.slice(i, i + 8).map(async pid => {
      const p = players[pid], e = p.espn_id || espnIds[pid];
      const j = await getJson(OVERVIEW(e));
      const rw = j && j.rotowire;
      const row = rw && (rw.headline || rw.story) ? {
        id: 'report:' + pid, player_id: pid, team: p.team || null, kind: kindOf(rw.headline || ''), link: 'report', why: null,
        headline: String(rw.headline || '').slice(0, 240) || null, summary: rw.story ? String(rw.story).slice(0, 700) : null,
        url: null, source: 'RotoWire via ESPN', published_at: rw.published && !isNaN(Date.parse(rw.published)) ? new Date(rw.published).toISOString() : new Date().toISOString(),
      } : null;
      reports[pid] = { news_updated: Number(p.news_updated || 0), row };
    }));
  }
  // Reports not refetched this run keep last run's copy.
  Object.entries(prior || {}).forEach(([pid, was]) => { if (!reports[pid] && (rostered || new Set()).has(pid)) reports[pid] = was; });
  Object.values(reports).forEach(r => { if (r && r.row && Date.parse(r.row.published_at) > Date.now() - 30 * 864e5) rows.push(r.row); });

  // One row per story per player (a story can be both tagged and named).
  const seen = new Set();
  const out = rows.filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; });
  return {
    rows: out, reports, fetched_at: new Date().toISOString(), ms: Date.now() - t0,
    counts: { stories: stories.size, rows: out.length, direct: out.filter(r => r.link === 'direct').length, team: out.filter(r => r.link === 'team').length, teammate: out.filter(r => r.link === 'teammate').length, reports: out.filter(r => r.link === 'report').length, reports_fetched: due.length },
  };
}

module.exports = { buildNewsIndex, kindOf, kindOfStory };

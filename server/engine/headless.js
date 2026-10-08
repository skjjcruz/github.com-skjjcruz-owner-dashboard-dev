// server/engine/headless.js — run the DHQ engine outside a browser.
//
// The engine (reconai-shared/*.js) is plain browser script that reads a few
// globals: window.S (the league state), window.App (the engine namespace),
// localStorage / IndexedDB caches, and fetch. This module creates a small
// stand-in for the browser, loads the same engine files the website ships,
// feeds them a league pulled straight from Sleeper, and returns what the
// engine computed. No engine code is changed — this is the file-for-file
// copy the app and the website run.
//
// Owner direction 2026-10-08: "let's move the engine to the server".
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const API = 'https://api.sleeper.app/v1';
const ENGINE_VERSION = 'headless-1';

// The shared engine files, in the order index.html loads them (only the
// ones the valuation path needs — no auth, UI or AI modules).
const ENGINE_FILES = [
  'constants.js', 'utils.js', 'storage.js', 'event-bus.js', 'platform-provider.js', 'sleeper-api.js',
  'pick-value-model.js', 'dhq-providers.js', 'dhq-core.js', 'intelligence-context.js', 'values-v2.js', 'pff-snapshot.js',
  'dhq-engine.js', 'team-assess.js', 'analytics-engine.js', 'trade-engine.js',
].map(f => 'reconai-shared/' + f).concat(['js/utils/player-value.js']);

function storage() {
  const s = {};
  return { getItem: k => (k in s ? s[k] : null), setItem: (k, v) => { s[k] = String(v); }, removeItem: k => { delete s[k]; }, clear: () => { for (const k in s) delete s[k]; }, key: i => Object.keys(s)[i] || null, get length() { return Object.keys(s).length; } };
}

// A browser-shaped global object. Everything the engine touches at load or
// run time is here; anything else it reaches for is wrapped in try/catch
// inside the engine itself.
function buildContext() {
  const ctx = {
    console: { log() {}, info() {}, debug() {}, warn: (...a) => console.warn(...a), error: (...a) => console.error(...a) },
    fetch, setTimeout, clearTimeout, setInterval, clearInterval, performance,
    Date, Math, Object, Array, Number, String, Boolean, JSON, RegExp, Symbol, Map, Set, WeakMap, WeakSet, Promise, Error, TypeError, RangeError,
    parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent, encodeURI, decodeURI, URLSearchParams, URL, TextEncoder, TextDecoder, structuredClone, queueMicrotask,
    AbortController, Headers, Request, Response,
    localStorage: storage(), sessionStorage: storage(),
    location: { search: '', hostname: 'engine.dhqfootball.com', href: 'https://engine.dhqfootball.com/', pathname: '/', protocol: 'https:', origin: 'https://engine.dhqfootball.com' },
    navigator: { userAgent: 'dhq-engine-headless', onLine: true },
    document: { title: '', readyState: 'complete', addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; }, createElement() { return { setAttribute() {}, style: {}, appendChild() {} }; }, head: { appendChild() {} }, body: { appendChild() {} }, currentScript: null, cookie: '' },
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    Event: function Event(type) { this.type = type; },
    requestAnimationFrame: fn => setTimeout(fn, 0), cancelAnimationFrame: () => {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    React: { createContext: () => ({}), useState: () => [null, () => {}], useEffect() {}, useMemo: () => null, useRef: () => ({ current: null }), useCallback: f => f, createElement: () => null, Fragment: 'f' },
  };
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  return vm.createContext(ctx);
}

function loadEngine(ctx) {
  for (const rel of ENGINE_FILES) {
    const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(code, ctx, { filename: rel });
  }
}

async function sleeper(p) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(API + p);
    if (r.ok) return r.json();
    if (r.status === 404) return null;
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); continue; }
    throw new Error('Sleeper ' + r.status + ' ' + p);
  }
  throw new Error('Sleeper kept failing: ' + p);
}

// Shared across leagues in one run: the player directory, the NFL clock and
// the five seasons of stats the engine wants.
async function loadShared() {
  const nfl = await sleeper('/state/nfl');
  const season = String(nfl.league_season || nfl.season);
  const cur = Number(season);
  const years = [cur - 4, cur - 3, cur - 2, cur - 1, cur];
  const [players, ...stats] = await Promise.all([sleeper('/players/nfl')].concat(years.map(y => sleeper('/stats/nfl/regular/' + y).catch(() => ({})))));
  const statsByYear = {}; years.forEach((y, i) => { statsByYear[y] = stats[i] || {}; });
  return { nfl, season, players, statsByYear };
}

// Per-player row the tools need, without the 15 MB of everything else.
function slimPlayers(players) {
  const out = {};
  for (const pid in players) {
    const p = players[pid];
    if (!p || !p.position) continue;
    if (!p.active && !p.team) continue;
    out[pid] = {
      n: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(), pos: p.position, fp: p.fantasy_positions || undefined, t: p.team || null,
      age: p.age ?? null, yrs: p.years_exp ?? null, st: p.status || null, inj: p.injury_status || null, injp: p.injury_body_part || null,
      dc: p.depth_chart_position || null, dco: p.depth_chart_order ?? null, col: p.college || null, num: p.number ?? null, act: !!p.active,
    };
  }
  return out;
}

function playerStatsFor(statsByYear, season, calcRawPts) {
  const prev = statsByYear[Number(season) - 1] || {}, cur = statsByYear[season] || {};
  const out = {};
  Object.entries(prev).forEach(([pid, s]) => { const pts = calcRawPts(s), gp = s.gp || 0; out[pid] = { prevTotal: pts ? Math.round(pts * 10) / 10 : 0, prevAvg: gp > 0 ? Math.round(pts / gp * 10) / 10 : 0, prevRawStats: s }; });
  Object.entries(cur).forEach(([pid, s]) => { const pts = calcRawPts(s), gp = s.gp || 0; if (!out[pid]) out[pid] = {}; if (gp > 0) { out[pid].seasonTotal = pts ? Math.round(pts * 10) / 10 : 0; out[pid].seasonAvg = Math.round(pts / gp * 10) / 10; } });
  return out;
}

// Trim the per-player detail the engine keeps (factor breakdowns and the
// FantasyCalc compatibility reason list are 80% of the bytes).
function slimIntel(LI) {
  const out = Object.assign({}, LI);
  delete out.dhqPickValueFn;
  if (out.playerMeta) {
    const pm = {};
    for (const pid in out.playerMeta) {
      const m = Object.assign({}, out.playerMeta[pid]);
      delete m.sitMultFactors; delete m.fcCompatibilityReasons; delete m.opportunityBlockers;
      pm[pid] = m;
    }
    out.playerMeta = pm;
  }
  return out;
}

// Build one league. `shared` comes from loadShared(); `histCache` is an
// optional {get(key), set(key, value)} that stands in for the browser's
// IndexedDB so past seasons' trades/drafts/brackets are not re-fetched.
async function buildLeague(leagueId, shared, histCache) {
  const t0 = Date.now();
  const ctx = buildContext();
  loadEngine(ctx);
  const W = ctx.window;
  // Season stats come from this run's shared download, not a per-league fetch.
  W.Sleeper.fetchSeasonStats = yr => Promise.resolve(shared.statsByYear[yr] || {});
  W.App.Sleeper = W.Sleeper;
  // The engine's "IndexedDB": serve the history cache for dhq_hist_* keys only,
  // so the LeagueIntel cache (dhq_leagueintel_*) is never used and every run
  // computes fresh values.
  const DhqStorage = vm.runInContext('DhqStorage', ctx);
  DhqStorage.idbGet = async key => (histCache && /^dhq_hist_/.test(key)) ? await histCache.get(key) : null;
  DhqStorage.idbSet = async (key, value) => { if (histCache && /^dhq_hist_/.test(key)) await histCache.set(key, value); return true; };

  const { nfl, season, players } = shared;
  const week = Number(nfl.display_week || nfl.week || 1);
  const [league, rosters, users, tradedPicks, matchups] = await Promise.all([
    sleeper('/league/' + leagueId), sleeper('/league/' + leagueId + '/rosters'), sleeper('/league/' + leagueId + '/users'),
    sleeper('/league/' + leagueId + '/traded_picks'), sleeper('/league/' + leagueId + '/matchups/' + week),
  ]);
  if (!league) throw new Error('league not found: ' + leagueId);
  const leagueSeason = String(league.season || season);
  const S = {
    platform: 'sleeper', players, playerStats: playerStatsFor(shared.statsByYear, leagueSeason, W.calcRawPts),
    rosters: rosters || [], leagueUsers: users || [],
    leagues: [{ league_id: league.league_id, name: league.name, scoring_settings: league.scoring_settings, roster_positions: league.roster_positions, settings: league.settings }],
    currentLeagueId: league.league_id, season: leagueSeason, nflState: nfl, currentWeek: week, matchups: matchups || [],
    tradedPicks: W.App.normalizeTradedPicks ? W.App.normalizeTradedPicks(rosters || [], tradedPicks || []) : (tradedPicks || []),
    drafts: [], transactions: {},
  };
  W.S = S; W.App.S = S;

  await W.App.loadLeagueIntel();
  const LI = W.App.LI;
  if (!LI || !LI.playerScores || !Object.keys(LI.playerScores).length) throw new Error('engine produced no values for ' + leagueId);

  const assessments = W.assessAllTeamsFromGlobal();
  const dna = {};
  (rosters || []).forEach(r => { try { dna[r.roster_id] = W.computeWeightedDNA(r.roster_id) || null; } catch (e) { dna[r.roster_id] = null; } });

  const snapshot = {
    league: { league_id: league.league_id, name: league.name, season: leagueSeason, status: league.status, scoring_settings: league.scoring_settings, roster_positions: league.roster_positions, settings: league.settings, previous_league_id: league.previous_league_id || null, avatar: league.avatar || null },
    rosters: (rosters || []).map(r => ({ roster_id: r.roster_id, owner_id: r.owner_id, co_owners: r.co_owners || null, players: r.players || [], starters: r.starters || [], reserve: r.reserve || [], taxi: r.taxi || [], settings: r.settings || {}, metadata: r.metadata ? { team_name: r.metadata.team_name } : null })),
    users: (users || []).map(u => ({ user_id: u.user_id, display_name: u.display_name, avatar: u.avatar || null, team_name: (u.metadata && u.metadata.team_name) || null, team_avatar: (u.metadata && u.metadata.avatar) || null })),
    traded_picks: S.tradedPicks,
    matchups: (matchups || []).map(m => ({ roster_id: m.roster_id, matchup_id: m.matchup_id, points: m.points, starters: m.starters })),
    nfl_state: { week, season, season_type: nfl.season_type, display_week: nfl.display_week, leg: nfl.leg },
  };
  return {
    league_id: league.league_id, season: leagueSeason, name: league.name, platform: 'sleeper',
    built_at: new Date().toISOString(), engine_version: ENGINE_VERSION, build_ms: Date.now() - t0,
    intel: slimIntel(LI), assessments, dna, snapshot,
  };
}

module.exports = { ENGINE_VERSION, loadShared, buildLeague, slimPlayers, sleeper };

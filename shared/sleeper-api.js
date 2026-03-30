// ── Shared Sleeper API Layer ──────────────────────────────────────
// Base fetch helpers for both ReconAI and War Room.
// Each app may wrap these with its own orchestration (e.g. ReconAI's
// loadLeague calls render functions after fetching), but the raw API
// calls live here once.

window.App = window.App || {};

const SLEEPER_BASE = 'https://api.sleeper.app/v1';

// ── Base fetch with error handling ───────────────────────────────
async function sleeperFetch(path) {
  const res = await fetch(SLEEPER_BASE + path);
  if (!res.ok) throw new Error('Sleeper API error: ' + res.status);
  return res.json();
}

// ── Player DB cache (shared across pages via sessionStorage) ─────
let _playersCache = null;
let _playersCacheTime = 0;
const PLAYERS_TTL = 60 * 60 * 1000; // 1 hour

async function fetchPlayers() {
  // Check memory cache
  if (_playersCache && Date.now() - _playersCacheTime < PLAYERS_TTL) return _playersCache;
  // Check sessionStorage
  try {
    const cached = sessionStorage.getItem('fw_players_cache');
    if (cached) {
      const d = JSON.parse(cached);
      if (Date.now() - d.ts < PLAYERS_TTL) {
        _playersCache = d.data;
        _playersCacheTime = d.ts;
        return d.data;
      }
    }
  } catch (e) { /* sessionStorage may be unavailable */ }
  // Fetch fresh
  const data = await sleeperFetch('/players/nfl');
  _playersCache = data;
  _playersCacheTime = Date.now();
  try {
    sessionStorage.setItem('fw_players_cache', JSON.stringify({ data, ts: Date.now() }));
  } catch (e) { /* quota exceeded or unavailable */ }
  return data;
}

// ── Stats cache per season ───────────────────────────────────────
const _statsCache = {};

async function fetchSeasonStats(season) {
  if (_statsCache[season]) return _statsCache[season];
  // Check sessionStorage
  try {
    const cached = sessionStorage.getItem('fw_stats_' + season);
    if (cached) {
      const d = JSON.parse(cached);
      _statsCache[season] = d;
      return d;
    }
  } catch (e) { /* sessionStorage may be unavailable */ }
  // Fetch fresh
  const data = await sleeperFetch('/stats/nfl/regular/' + season);
  _statsCache[season] = data;
  try {
    sessionStorage.setItem('fw_stats_' + season, JSON.stringify(data));
  } catch (e) { /* quota exceeded or unavailable */ }
  return data;
}

// ── Common fetch helpers ─────────────────────────────────────────
async function fetchUser(username)              { return sleeperFetch('/user/' + encodeURIComponent(username)); }
async function fetchLeagues(userId, season)     { return sleeperFetch('/user/' + userId + '/leagues/nfl/' + season); }
async function fetchRosters(leagueId)           { return sleeperFetch('/league/' + leagueId + '/rosters'); }
async function fetchLeagueInfo(leagueId)        { return sleeperFetch('/league/' + leagueId); }
async function fetchLeagueUsers(leagueId)       { return sleeperFetch('/league/' + leagueId + '/users'); }
async function fetchTradedPicks(leagueId)       { return sleeperFetch('/league/' + leagueId + '/traded_picks'); }
async function fetchDrafts(leagueId)            { return sleeperFetch('/league/' + leagueId + '/drafts'); }
async function fetchDraftPicks(draftId)         { return sleeperFetch('/draft/' + draftId + '/picks'); }
async function fetchMatchups(leagueId, week)    { return sleeperFetch('/league/' + leagueId + '/matchups/' + week); }
async function fetchTransactions(leagueId, week){ return sleeperFetch('/league/' + leagueId + '/transactions/' + week); }
async function fetchNflState()                  { return sleeperFetch('/state/nfl'); }

async function fetchTrending(type, hours, limit) {
  return sleeperFetch('/players/trending/nfl/' + type
    + '?lookback_hours=' + (hours || 24)
    + '&limit=' + (limit || 25));
}

async function fetchWinnersBracket(leagueId) {
  return sleeperFetch('/league/' + leagueId + '/winners_bracket');
}

async function fetchLosersBracket(leagueId) {
  return sleeperFetch('/league/' + leagueId + '/losers_bracket').catch(function () { return []; });
}

// ── Fantasy Points Calculator ────────────────────────────────────
// Full scoring: offense + IDP (prefixed & non-prefixed) + kicking + special teams.
// `stats` = raw stat line from Sleeper, `sc` = league scoring_settings object.

function calcFantasyPts(stats, sc) {
  if (!stats) return 0;
  let pts = 0;
  var add = function (stat, mult) { pts += (stats[stat] || 0) * (mult || 0); };

  // Offense — passing
  add('pass_yd',   sc.pass_yd   || 0);
  add('pass_td',   sc.pass_td   || 4);
  add('pass_int',  sc.pass_int  || -1);
  add('pass_2pt',  sc.pass_2pt  || 0);
  add('pass_sack', sc.pass_sack || 0);

  // Offense — rushing
  add('rush_yd',  sc.rush_yd  || 0.1);
  add('rush_td',  sc.rush_td  || 6);
  add('rush_2pt', sc.rush_2pt || 0);
  add('rush_fd',  sc.rush_fd  || 0);

  // Offense — receiving
  add('rec',     sc.rec     || 0.5);
  add('rec_yd',  sc.rec_yd  || 0.1);
  add('rec_td',  sc.rec_td  || 6);
  add('rec_2pt', sc.rec_2pt || 0);
  add('rec_fd',  sc.rec_fd  || 0);

  // Fumbles
  add('fum_lost',   sc.fum_lost   || -0.5);
  add('fum_rec_td', sc.fum_rec_td || 0);

  // Kicking
  add('xpm',          sc.xpm          || 0);
  add('xpmiss',       sc.xpmiss       || 0);
  add('fgm_yds',      sc.fgm_yds      || 0);
  add('fgmiss',       sc.fgmiss       || 0);
  add('fgmiss_0_19',  sc.fgmiss_0_19  || 0);
  add('fgmiss_20_29', sc.fgmiss_20_29 || 0);

  // IDP — try both idp-prefixed and non-prefixed field names (Sleeper uses both)
  var idpFields = [
    ['idp_tkl_solo',  'tkl_solo'],
    ['idp_tkl_ast',   'tkl_ast'],
    ['idp_tkl_loss',  'tkl_loss'],
    ['idp_sack',      'sack'],
    ['idp_qb_hit',    'qb_hit'],
    ['idp_int',       'int'],
    ['idp_ff',        'ff'],
    ['idp_fum_rec'],
    ['idp_pass_def',  'pass_def'],
    ['idp_pass_def_3p'],
    ['idp_def_td',    'def_td'],
    ['idp_blk_kick'],
    ['idp_safe'],
    ['idp_sack_yd'],
    ['idp_int_ret_yd'],
    ['idp_fum_ret_yd'],
  ];
  idpFields.forEach(function (names) {
    var scKey = names[0]; // scoring setting key is always idp_ prefixed
    var mult = sc[scKey] || 0;
    if (!mult) return;
    // Try each field name variant, use first non-zero
    var val = 0;
    for (var i = 0; i < names.length; i++) {
      if (stats[names[i]]) { val = stats[names[i]]; break; }
    }
    pts += val * mult;
  });

  // Special teams
  add('st_td',       sc.st_td       || 0);
  add('st_ff',       sc.st_ff       || 0);
  add('st_fum_rec',  sc.st_fum_rec  || 0);
  add('st_tkl_solo', sc.st_tkl_solo || 0);
  add('kr_yd',       sc.kr_yd       || 0);
  add('pr_yd',       sc.pr_yd       || 0);

  return Math.round(pts * 10) / 10;
}

// ── Expose on window ─────────────────────────────────────────────
var SleeperAPI = {
  SLEEPER_BASE:       SLEEPER_BASE,
  sleeperFetch:       sleeperFetch,
  fetchPlayers:       fetchPlayers,
  fetchSeasonStats:   fetchSeasonStats,
  fetchUser:          fetchUser,
  fetchLeagues:       fetchLeagues,
  fetchRosters:       fetchRosters,
  fetchLeagueInfo:    fetchLeagueInfo,
  fetchLeagueUsers:   fetchLeagueUsers,
  fetchTradedPicks:   fetchTradedPicks,
  fetchDrafts:        fetchDrafts,
  fetchDraftPicks:    fetchDraftPicks,
  fetchMatchups:      fetchMatchups,
  fetchTransactions:  fetchTransactions,
  fetchNflState:      fetchNflState,
  fetchTrending:      fetchTrending,
  fetchWinnersBracket:fetchWinnersBracket,
  fetchLosersBracket: fetchLosersBracket,
  calcFantasyPts:     calcFantasyPts,
};

window.App.Sleeper = SleeperAPI;
window.Sleeper     = SleeperAPI;
// Alias sf for DHQ engine compatibility
window.App.sf = sleeperFetch;
window.sf = sleeperFetch;
window.App.SLEEPER = SLEEPER_BASE;

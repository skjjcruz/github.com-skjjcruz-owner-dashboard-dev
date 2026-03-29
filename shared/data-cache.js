/*  shared/data-cache.js — cross-page sessionStorage cache layer
 *  Loaded FIRST so every other shared script can use it.
 */
window.App = window.App || {};

const FW_CACHE_PREFIX = 'fw_cache_';
const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

// ── Generic cache get / set / clear ────────────────────────────

function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(FW_CACHE_PREFIX + key);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (Date.now() - d.ts > (d.ttl || DEFAULT_TTL)) {
      sessionStorage.removeItem(FW_CACHE_PREFIX + key);
      return null;
    }
    return d.data;
  } catch (e) { return null; }
}

function cacheSet(key, data, ttl) {
  try {
    sessionStorage.setItem(FW_CACHE_PREFIX + key,
      JSON.stringify({ data, ts: Date.now(), ttl: ttl || DEFAULT_TTL }));
  } catch (e) { /* quota exceeded — silently fail */ }
}

function cacheClear(key) {
  if (key) {
    sessionStorage.removeItem(FW_CACHE_PREFIX + key);
  } else {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(FW_CACHE_PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  }
}

// ── Pre-built helpers for common data ──────────────────────────

function cacheLeagueData(leagueId, data) { cacheSet('league_' + leagueId, data, 5 * 60 * 1000); }
function getCachedLeagueData(leagueId)   { return cacheGet('league_' + leagueId); }

function cachePlayers(data)   { cacheSet('players', data, 60 * 60 * 1000); }
function getCachedPlayers()   { return cacheGet('players'); }

function cacheStats(season, data) { cacheSet('stats_' + season, data, 60 * 60 * 1000); }
function getCachedStats(season)   { return cacheGet('stats_' + season); }

// ── Cache size monitor ─────────────────────────────────────────

function cacheSize() {
  let total = 0;
  Object.keys(sessionStorage)
    .filter(k => k.startsWith(FW_CACHE_PREFIX))
    .forEach(k => { total += sessionStorage.getItem(k).length; });
  return Math.round(total / 1024) + 'KB';
}

// ── Expose on two namespaces ───────────────────────────────────

const _cache = { cacheGet, cacheSet, cacheClear, cacheLeagueData, getCachedLeagueData,
  cachePlayers, getCachedPlayers, cacheStats, getCachedStats, cacheSize };

window.App.Cache = _cache;
window.FWCache   = _cache;

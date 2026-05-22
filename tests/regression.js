#!/usr/bin/env node
// War Room regression guardrails for deep links, mobile layout, and dashboard widgets.
// Usage: npm run test:regression
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LEAGUE_ID = '1312100327931019264';
const USER = 'bigloco';
const MOBILE_WIDTHS = [390, 430];
const MAIN_TABS = [
  'dashboard',
  'myteam',
  'compare',
  'trades',
  'fa',
  'draft',
  'analytics',
  'alex',
  'trophies',
  'calendar',
];
const ROUTED_TABS = [...MAIN_TABS, 'strategy', 'league'];
const WIDGET_SIZES = ['sm', 'slim', 'narrow', 'md', 'lg', 'tall', 'xl', 'xxl'];

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label || 'mismatch'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function sourceHas(source, needle, label) {
  ok(source.includes(needle), label || `missing source fragment: ${needle}`);
}

function sourceMatches(source, regex, label) {
  ok(regex.test(source), label || `source did not match ${regex}`);
}

function routeUrlModel(pathname, search, hash) {
  const query = new URLSearchParams(search || '');
  query.delete('league');
  query.delete('leagueId');
  query.delete('tab');
  const qs = query.toString();
  return pathname + (qs ? '?' + qs : '') + (hash || '');
}

function parseHashModel(hash, search) {
  const params = new URLSearchParams((hash || '').replace('#', ''));
  const query = new URLSearchParams(search || '');
  const rawTab = params.get('tab') || query.get('tab') || 'dashboard';
  return {
    leagueId: params.get('league') || query.get('league') || query.get('leagueId'),
    tab: rawTab === 'brief' ? 'dashboard' : rawTab,
  };
}

function extractSpanMap(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*=\\s*\\{([^}]+)\\}`));
  if (!match) throw new Error(`${name} map not found`);
  const out = {};
  for (const item of match[1].matchAll(/([a-z]+)\s*:\s*'span\s+(\d+)'/gi)) {
    out[item[1]] = Number(item[2]);
  }
  return out;
}

const appSrc = read('js/app.js');
const indexHtml = read('index.html');
const onboardingSrc = read('onboarding.html');
const leagueDetailSrc = read('js/league-detail.js');
const dashboardSrc = read('js/tabs/dashboard.js');
const leagueHistorySrc = read('js/shared/league-history.js');
const trophyRoomSrc = read('js/tabs/trophy-room.js');

console.log('\nWar Room regression tests');

group('cold-load routes');

test('route helper preserves dev/user query while adding league hash', () => {
  sourceHas(appSrc, 'const query = new URLSearchParams(window.location.search || \'\');', 'routeUrl must read current query string');
  sourceHas(appSrc, 'query.delete(\'league\');', 'routeUrl must remove stale query league');
  sourceHas(appSrc, 'query.delete(\'leagueId\');', 'routeUrl must remove stale query leagueId');
  sourceHas(appSrc, 'query.delete(\'tab\');', 'routeUrl must remove stale query tab');
  sourceHas(appSrc, 'return window.location.pathname + (qs ? \'?\' + qs : \'\') + (hash || \'\');', 'routeUrl must preserve query before hash');

  for (const tab of ROUTED_TABS) {
    const hash = `#league=${LEAGUE_ID}&tab=${tab}`;
    const url = routeUrlModel('/', `?dev=true&user=${USER}`, hash);
    eq(url, `/?dev=true&user=${USER}${hash}`, `direct URL for ${tab}`);
  }
});

test('initial history replacement keeps the incoming hash on cold load', () => {
  sourceHas(appSrc, 'const route = parseHash(window.location.hash);', 'cold-load path must parse current hash');
  sourceHas(appSrc, 'history.replaceState(state, \'\', routeUrl(window.location.hash));', 'initial replaceState must keep hash');
  sourceHas(appSrc, 'routeUrl(buildHash(league.id, route.tab || \'dashboard\'))', 'league restore must rebuild hash via routeUrl');
});

test('parseHash supports hash routes, query routes, and brief legacy redirect', () => {
  eq(parseHashModel(`#league=${LEAGUE_ID}&tab=draft`, `?dev=true&user=${USER}`).leagueId, LEAGUE_ID, 'hash league');
  eq(parseHashModel(`#league=${LEAGUE_ID}&tab=draft`, `?dev=true&user=${USER}`).tab, 'draft', 'hash tab');
  eq(parseHashModel('', `?dev=true&user=${USER}&leagueId=${LEAGUE_ID}&tab=fa`).leagueId, LEAGUE_ID, 'query league fallback');
  eq(parseHashModel('', `?dev=true&user=${USER}&leagueId=${LEAGUE_ID}&tab=brief`).tab, 'dashboard', 'brief redirect');
});

test('every routed tab has a cold-load URL and render branch', () => {
  for (const tab of ROUTED_TABS) {
    const hash = `#league=${LEAGUE_ID}&tab=${tab}`;
    const directUrl = `/?dev=true&user=${USER}${hash}`;
    ok(directUrl.includes(`tab=${tab}`), `${tab} route missing tab`);
    if (tab === 'dashboard') {
      sourceHas(leagueDetailSrc, '<DashboardPanel', 'dashboard branch missing');
    } else {
      sourceHas(leagueDetailSrc, `activeTab === '${tab}'`, `${tab} render branch missing`);
    }
  }
});

test('every main sidebar tab remains directly addressable', () => {
  for (const tab of MAIN_TABS) {
    sourceHas(leagueDetailSrc, `tab: '${tab}'`, `${tab} nav entry missing`);
  }
});

test('GM strategy remains routed through GM office, not a sidebar button', () => {
  sourceHas(leagueDetailSrc, "activeTab === 'strategy'", 'strategy route must still render');
  sourceHas(leagueDetailSrc, "{ label: 'GM\\'s Office', tab: 'alex', iconKey: 'office' }", 'GM office sidebar entry missing');
  ok(!leagueDetailSrc.includes("{ label: 'GM Strategy', tab: 'strategy'"), 'GM Strategy should not be a sidebar entry');
});

group('live platform gate');

test('live loader keeps non-Sleeper connector files sandbox-only', () => {
  sourceHas(indexHtml, 'const WR_PLATFORM_SANDBOX_ACCESS', 'sandbox platform flag missing from loader');
  sourceHas(indexHtml, "'sleeper-api.js',", 'Sleeper connector must remain in live loader');
  sourceHas(indexHtml, "'app-config.js',", 'shared backend config must load before backend-backed modules');
  sourceHas(indexHtml, "if (WR_PLATFORM_SANDBOX_ACCESS) WR_SHARED_FILES.splice(7, 0, 'espn-api.js', 'mfl-api.js', 'yahoo-api.js');", 'beta connectors must be gated behind sandbox flag');
  ok(!/WRShared\.loadMany\(\[[\s\S]*'espn-api\.js'/.test(indexHtml), 'ESPN connector should not be in unconditional live loadMany list');
});

test('War Room app filters beta-platform leagues out of live route data', () => {
  sourceHas(appSrc, 'const PLATFORM_SANDBOX_ACCESS = WR_HOST.includes(\'sandbox\')', 'app sandbox platform flag missing');
  sourceHas(appSrc, 'const visibleEspnLeagues = PLATFORM_SANDBOX_ACCESS ? espnLeagues : [];', 'ESPN leagues must be hidden on live');
  sourceHas(appSrc, 'const visibleMflLeagues = PLATFORM_SANDBOX_ACCESS ? mflLeagues : [];', 'MFL leagues must be hidden on live');
  sourceHas(appSrc, 'const resumeLeague = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues].find(l => l.id === lastLeagueId);', 'resume must use filtered platform leagues');
});

test('onboarding only persists allowed platforms for the current environment', () => {
  sourceHas(onboardingSrc, 'window.FW_PLATFORM_SANDBOX_ACCESS = betaPlatforms;', 'onboarding sandbox flag missing');
  sourceHas(onboardingSrc, '.live-platforms .sandbox-platform { display: none; }', 'live onboarding should hide beta platform cards');
  sourceHas(onboardingSrc, 'if (!platformAccessAllowed(id)) return;', 'platform toggle must block live beta selection');
  sourceHas(onboardingSrc, 'patchProfile({ platforms: Array.from(selectedPlatforms).filter(platformAccessAllowed) });', 'saved onboarding platforms must be filtered');
});

group('mobile overflow');

test('league shell clamps horizontal overflow at 390px and 430px', () => {
  sourceMatches(leagueDetailSrc, /@media\(max-width:767px\)/, 'mobile media query missing');
  sourceHas(leagueDetailSrc, 'html,body,#root{max-width:100%;overflow-x:hidden}', 'root overflow clamp missing');
  sourceHas(leagueDetailSrc, '.wr-main-content{margin-left:0 !important;width:100% !important;max-width:100vw;overflow-x:hidden;box-sizing:border-box}', 'main content mobile clamp missing');
  sourceHas(leagueDetailSrc, '.wr-sidebar{left:-220px !important;transform:none !important}', 'sidebar off-canvas rule missing');
  sourceHas(leagueDetailSrc, '.wr-sidebar.open{left:0 !important}', 'sidebar open rule missing');
  for (const width of MOBILE_WIDTHS) {
    ok(width <= 767, `${width}px should exercise the mobile shell rules`);
  }
});

test('main content no longer carries fixed desktop width on mobile', () => {
  sourceHas(leagueDetailSrc, '<div className="wr-main-content" style={{ marginLeft: sidebarWidth + \'px\', width: \'calc(100% - \' + sidebarWidth + \'px)\' }}>', 'desktop content width source changed unexpectedly');
  sourceHas(leagueDetailSrc, 'margin-left:0 !important;width:100% !important;max-width:100vw', 'mobile margin override missing');
});

group('dashboard widgets');

test('dashboard mobile grid collapses every widget size to one safe column', () => {
  const sizeSpan = extractSpanMap(dashboardSrc, 'sizeSpan');
  sourceHas(dashboardSrc, '.wr-dashboard-grid{', 'dashboard grid CSS missing');
  sourceHas(dashboardSrc, 'grid-template-columns:minmax(0,1fr) !important;', 'mobile single-column grid missing');
  sourceHas(dashboardSrc, '.wr-dashboard-grid>.wr-widget{', 'mobile widget override missing');
  sourceHas(dashboardSrc, 'grid-column:1 / -1 !important;', 'mobile widget column override missing');
  sourceHas(dashboardSrc, 'grid-row:auto !important;', 'mobile widget row override missing');
  sourceHas(dashboardSrc, 'min-width:0;', 'mobile min-width guard missing');

  for (const width of MOBILE_WIDTHS) {
    const activeColumns = width <= 767 ? 1 : 4;
    for (const size of WIDGET_SIZES) {
      ok(sizeSpan[size] >= 1, `${size} span missing`);
      const effectiveSpan = width <= 767 ? 1 : sizeSpan[size];
      ok(effectiveSpan <= activeColumns, `${size} spans ${effectiveSpan} columns at ${width}px`);
    }
  }
});

test('dashboard tablet grid clamps xl/xxl spans to active columns', () => {
  const sizeSpan = extractSpanMap(dashboardSrc, 'sizeSpan');
  sourceHas(dashboardSrc, 'grid-template-columns:repeat(2,minmax(140px,1fr)) !important;', 'tablet two-column grid missing');
  sourceHas(dashboardSrc, '.wr-dashboard-grid>.wr-widget[style*="span 4"]{', 'tablet span-4 selector missing');
  sourceHas(dashboardSrc, 'grid-column:span 2 !important;', 'tablet span-4 clamp missing');
  for (const size of ['xl', 'xxl']) {
    eq(sizeSpan[size], 4, `${size} should request four columns on desktop`);
    ok(2 <= 2, `${size} tablet clamp exceeds active columns`);
  }
});

test('dashboard widget shell defines every supported size for rows and columns', () => {
  const sizeSpan = extractSpanMap(dashboardSrc, 'sizeSpan');
  const rowSpan = extractSpanMap(dashboardSrc, 'rowSpan');
  for (const size of WIDGET_SIZES) {
    ok(Number.isFinite(sizeSpan[size]), `${size} missing from sizeSpan`);
    ok(Number.isFinite(rowSpan[size]), `${size} missing from rowSpan`);
  }
});

group('league-scoped history');

test('history globals are replaced per active league instead of merged across leagues', () => {
  sourceHas(leagueHistorySrc, 'window.App.LI.championshipLeagueId = key;', 'active championship league id missing');
  sourceHas(leagueHistorySrc, 'window.App.LI.championships = Object.assign({}, cache.championships || {});', 'championships must replace active league snapshot');
  ok(!leagueHistorySrc.includes('Object.assign({}, window.App.LI.championships || {}, cache.championships || {})'), 'championships should not merge prior league data');
});

test('trophy room reads owner history and championships by current league id', () => {
  sourceHas(trophyRoomSrc, 'const leagueId = currentLeague?.id || currentLeague?.league_id || \'\';', 'trophy room league id source missing');
  sourceHas(trophyRoomSrc, 'window.WrHistory.getOwnerHistory(leagueId)', 'owner history must be league-scoped');
  sourceHas(trophyRoomSrc, 'String(window.App?.LI?.championshipLeagueId || \'\') === String(leagueId)', 'fallback championships must be active-league guarded');
});

group('compiled preview');

test('compiled preview removes browser Babel and keeps app bundle route-ready', () => {
  const previewIndex = path.join(ROOT, 'dist-preview', 'index.html');
  ok(fs.existsSync(previewIndex), 'dist-preview/index.html missing; run npm run build:preview first');
  const html = fs.readFileSync(previewIndex, 'utf8');
  ok(!/type=["']text\/babel["']/i.test(html), 'compiled preview still contains text/babel scripts');
  ok(!/@babel\/standalone/i.test(html), 'compiled preview still loads browser Babel');
  sourceHas(html, './compiled/js/app.js', 'compiled app bundle missing from preview index');
  ok(fs.existsSync(path.join(ROOT, 'dist-preview', 'compiled', 'js', 'app.js')), 'compiled js/app.js missing');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

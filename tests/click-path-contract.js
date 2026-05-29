#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label}: expected ${needle}`);
  }
}

function assertCountAtLeast(source, needle, min, label) {
  const count = source.split(needle).length - 1;
  if (count < min) {
    throw new Error(`${label}: expected ${needle} at least ${min} times, found ${count}`);
  }
}

const surfaces = [
  {
    name: 'global player detail entrypoint',
    file: 'js/league-detail.js',
    checks: [
      ['window.WR.openPlayerCard(pid, { scoringSettings:', 'prefers unified player card'],
      ['window.openPlayerModal = selectPlayer;', 'exposes shared player modal fallback'],
      ['window._wrSelectPlayer = selectPlayer;', 'exposes legacy player selector for older surfaces'],
    ],
  },
  {
    name: 'custom reports',
    file: 'js/tabs/league-map.js',
    checks: [
      ['function canOpenReportPlayer(row, report)', 'gates player-backed report rows'],
      ["report?.dataSource === 'players' && row?.pid", 'only player rows become player links'],
      ["context: 'custom_report'", 'passes report source into player card context'],
      ['function canOpenReportTeam(row, report)', 'gates team-backed report rows'],
      ["report?.dataSource === 'teams' && row?.rosterId", 'only team rows become team links'],
      ['openTeamContext(row, report)', 'routes team report rows to team context'],
      ['{...reportPlayerRowProps(row, previewReport)}', 'live preview rows carry click props'],
      ['{...reportTeamRowProps(row, previewReport)}', 'live preview team rows carry click props'],
      ['{...reportPlayerRowProps(row, report)}', 'full report rows carry click props'],
      ['{...reportTeamRowProps(row, report)}', 'full report team rows carry click props'],
      ['role="button" tabIndex={0} title="Open report" data-report-id={r.id}', 'saved report cards are accessible controls'],
      ['onKeyDown={e => { if (e.key === \'Enter\' || e.key === \' \') { e.preventDefault(); handleViewReport(r); } }}', 'saved report cards support keyboard activation'],
    ],
  },
  {
    name: 'league team rows',
    file: 'js/tabs/league-map.js',
    checks: [
      ['function openLeagueTeamContext(team, roster)', 'centralizes team context opening'],
      ['function openTeamContext(row)', 'exposes report-to-team route'],
      ['setLeagueViewMode(\'roster\');', 'opens the roster context view'],
      ['role="button" tabIndex={0} title="Open team context"', 'team cards are accessible controls'],
      ['onClick={() => openLeagueTeamContext(team, roster)}', 'team cards route to team detail'],
      ['onKeyDown={e => handleLeagueTeamKey(e, team, roster)}', 'team cards support keyboard activation'],
    ],
  },
  {
    name: 'draft pick rows',
    file: 'js/tabs/league-map.js',
    checks: [
      ['function openPickContext(row)', 'centralizes pick context opening'],
      ['window._wrDraftPickFocus = detail;', 'stores draft-pick context for the destination tab'],
      ["wr:open-draft-pick-context", 'dispatches draft-pick context event'],
      ["if (typeof setActiveTab === 'function') setActiveTab('draft');", 'navigates to draft tab when available'],
      ['{...pickRowProps(row)}', 'pick rows carry click props'],
      ['title: \'Open draft pick context\'', 'pick rows explain destination'],
    ],
  },
  {
    name: 'analytics embed drill-in reset',
    file: 'js/tabs/analytics.js',
    checks: [
      ['setLeagueSelectedTeam(null);', 'clears team drill-in when switching analytics surfaces'],
      ["setLeagueViewMode('cards');", 'resets team context view mode for the next embedded surface'],
      ['}, [analyticsTab]);', 'keys the reset to analytics sub-tab changes'],
    ],
  },
  {
    name: 'free agency',
    file: 'js/free-agency.js',
    checks: [
      ['function openFaPlayer(pid)', 'centralizes free-agent player opening'],
      ['window.WR.openPlayerCard(pid, { scoringSettings:', 'uses unified player card'],
      ["<button key={x.pid} className={'fa-hq-candidate' + (isPrimary ? ' is-primary' : '')} title=\"Open player card\"", 'recommendation candidates are real buttons with destination labels'],
      ['onClick={() => openFaPlayer(x.pid)}', 'recommendation candidates open player detail'],
      ['return <div key={pid} role="button" tabIndex={0} title="Open player card" onClick={() => {', 'player universe rows are accessible controls'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openFaPlayer(pid); } }}", 'player universe rows support keyboard activation'],
      ['openFaPlayer(pid);', 'player universe rows route to player detail'],
    ],
  },
  {
    name: 'my roster',
    file: 'js/tabs/my-team.js',
    checks: [
      ['role="button" tabIndex={0}', 'roster rows are accessible controls'],
      ['title="Open roster player detail"', 'roster rows expose their destination'],
      ['onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}', 'roster rows open player context'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPid(prev => prev === r.pid ? null : r.pid); } }}", 'roster rows support keyboard activation'],
      ['<InlineCareerStats pid={r.pid}', 'expanded context includes player career stats'],
      ['ASK ALEX', 'expanded context routes into Alex for that player'],
    ],
  },
  {
    name: 'compare tab',
    file: 'js/tabs/compare.js',
    checks: [
      ['const openPlayerCard = (pid) => {', 'centralizes compare player opening'],
      ['window.WR && typeof window.WR.openPlayerCard', 'uses unified player card'],
      ['else if (typeof window._wrSelectPlayer ===', 'keeps shared selector fallback'],
      ['onClick={() => openPlayerCard(player.pid)}', 'summary player cells open detail'],
      ['onClick={() => openCard(r.pid)}', 'roster matrix cells open detail'],
      ['role="button"\n                    tabIndex={0}\n                    title="Open player card"', 'field comparison player cells expose player-card destination'],
      ['role="button"\n                        tabIndex={0}\n                        title="Open player card"', 'head-to-head roster cells expose player-card destination'],
    ],
  },
  {
    name: 'calendar tab',
    file: 'js/tabs/calendar.js',
    checks: [
      ['const leagueId = currentLeague?.id || currentLeague?.league_id || \'\';', 'keys custom events by the Sleeper league id'],
      ["title: 'Add custom calendar event'", 'add-event control exposes its purpose'],
      ["title: 'Remove custom calendar event'", 'custom-event delete control exposes its purpose'],
      ['Add to Calendar', 'keeps the add-event workflow visible'],
    ],
  },
  {
    name: 'draft room',
    file: 'js/draft-room.js',
    checks: [
      ['const openDraftPlayer = useCallback((pid) => {', 'centralizes draft-room player opening'],
      ['if (window.WR?.openPlayerCard) window.WR.openPlayerCard(pid);', 'uses unified player card'],
      ['else if (window._wrSelectPlayer) window._wrSelectPlayer(pid);', 'keeps shared selector fallback'],
      ['title="Open player card"', 'draft targets expose player-card destination'],
      ['onClick={() => openDraftPlayer(pick.pid)}', 'draft rows open player detail'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDraftPlayer(pick.pid); } }}", 'draft rows support keyboard activation'],
      ['onClick={() => openDraftPlayer(line.pid)}', 'Alex mock rows open player detail'],
      ['const [pickFocus, setPickFocus] = useState(() => window._wrDraftPickFocus || null);', 'keeps pick context from the ledger'],
      ["wr:open-draft-pick-context", 'listens for pick-context navigation'],
      ['Pick Focus', 'renders visible pick context'],
    ],
  },
  {
    name: 'draft command center',
    file: 'js/draft/command-center.js',
    checks: [
      ['const openRecapPlayer = pid => {', 'centralizes draft recap player opening'],
      ['function openLiveDecisionPlayer(player) {', 'centralizes live-decision player opening'],
      ['try { window.openPlayerModal(pid); return; }', 'recap opens shared player modal'],
      ['try { window.openPlayerModal(player.pid); return; }', 'live decision opens shared player modal'],
      ['onClick={() => topPlayer?.pid && openRecapPlayer(topPlayer.pid)}', 'team recap top players open detail'],
      ["onClick={() => card.action === 'trade' ? onTrade?.() : openLiveDecisionPlayer(player)}", 'live decision cards open player detail'],
    ],
  },
  {
    name: 'dashboard market widgets',
    file: 'js/widgets/market-radar.js',
    checks: [
      ['const openCard = (pid) => {', 'centralizes market-radar player opening'],
      ['window.WR && typeof window.WR.openPlayerCard', 'uses unified player card'],
      ['else if (typeof window.openPlayerModal ===', 'keeps shared player modal fallback'],
      ['role="button" tabIndex={0}', 'waiver rows are accessible controls'],
      ['onClick={() => openCard(p.pid)}', 'waiver rows open player detail'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(p.pid); } }}", 'waiver rows support keyboard activation'],
    ],
  },
  {
    name: 'dashboard widget shell',
    file: 'js/tabs/dashboard.js',
    checks: [
      ['data-widget-id={widget.id || \'\'}', 'exposes stable widget ids for live click validation'],
      ['data-widget-key={widget.key || \'\'}', 'exposes stable widget keys for live click validation'],
      ['data-widget-size={widget.size || \'\'}', 'exposes stable widget sizes for live click validation'],
      ["'league-standings': {", 'keeps legacy league standings widgets renderable'],
      ["'transaction-ticker': {", 'keeps legacy transaction ticker widgets renderable'],
    ],
  },
  {
    name: 'dashboard transaction ticker',
    file: 'js/tabs/dashboard.js',
    checks: [
      ['function openTickerPlayer(pid)', 'centralizes ticker player opening'],
      ['window.WR.openPlayerCard(pid);', 'uses unified player card'],
      ["typeof window._wrSelectPlayer === 'function'", 'keeps shared selector fallback'],
      ['function tickerPlayerProps(pid)', 'exposes shared click and keyboard props'],
      ["role: 'button'", 'player chips are accessible controls'],
      ["if (e.key !== 'Enter' && e.key !== ' ') return;", 'player chips support keyboard activation'],
      ['function openTickerTrade(txn)', 'centralizes ticker trade opening'],
      ['window._wrTradeContext = detail;', 'stores trade context for Trade Center'],
      ["wr:open-trade-context", 'dispatches trade context event'],
      ["if (navigateWidget) navigateWidget('trades');", 'navigates to Trade Center'],
      ["const firstTrade = (transactions || []).find(t => t.type === 'trade');", 'large ticker keeps a trade drill-in visible when possible'],
      ['{...tickerTradeProps(txn)}', 'trade rows carry click props'],
    ],
    minCounts: [
      ['{...tickerPlayerProps(pid)}', 2, 'adds and drops both need player click props'],
    ],
  },
  {
    name: 'league transaction context',
    file: 'js/league-detail.js',
    checks: [
      ['let visibleTxns = allTxns.slice(0, 50);', 'keeps a bounded transaction working set'],
      ["const firstTrade = allTxns.find(t => t.type === 'trade');", 'preserves a trade row when league history has one'],
      ['setTransactions(visibleTxns);', 'stores the trade-aware transaction set'],
    ],
  },
  {
    name: 'trade center context',
    file: 'js/trade-calc.js',
    checks: [
      ['const [tradeContext, setTradeContext] = useState(() => window._wrTradeContext || null);', 'keeps trade context from originating surfaces'],
      ["wr:open-trade-context", 'listens for trade-context navigation'],
      ["setTcTab('dealhq');", 'opens Deal HQ for transaction context'],
      ['Trade Context', 'renders visible trade context'],
      ['formatTradeContextSummary(tradeContext)', 'summarizes the opened deal'],
    ],
  },
  {
    name: 'dashboard roster and draft widgets',
    file: 'js/widgets/roster-pulse.js',
    checks: [
      ["window.openPlayerModal === 'function' && p.pid", 'top player strip opens shared player modal'],
      ['role="button" tabIndex={0} title="Open player card"', 'roster player rows are accessible controls'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (typeof window.openPlayerModal === 'function' && p.pid) window.openPlayerModal(p.pid); } }}", 'top player strip supports keyboard activation'],
      ['const onPlayerClick = (pid) => {', 'mini roster centralizes player opening'],
      ['onClick={() => onPlayerClick(pl.pid)}', 'mini roster players open detail'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlayerClick(pl.pid); } }}", 'mini roster players support keyboard activation'],
    ],
  },
  {
    name: 'dashboard draft-capital widget',
    file: 'js/widgets/draft-capital.js',
    checks: [
      ['const openCard = (pid) => {', 'centralizes draft-capital player opening'],
      ['window.WR && typeof window.WR.openPlayerCard', 'uses unified player card'],
      ['else if (typeof window.openPlayerModal ===', 'keeps shared player modal fallback'],
      ['role="button" tabIndex={0} title="Open player card"', 'big-board preview rows are accessible controls'],
      ['onClick={() => p.pid && openCard(p.pid)}', 'big-board preview rows open player detail'],
      ["onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.pid && openCard(p.pid); } }}", 'big-board preview rows support keyboard activation'],
    ],
  },
  {
    name: 'dashboard tag widgets',
    file: 'js/widgets/player-tags.js',
    checks: [
      ['function CompactRow({ r, tone, onClick })', 'tag widgets centralize compact player rows'],
      ['function FullRow({ r, tone, onClick })', 'tag widgets centralize full player rows'],
      ["role: 'button'", 'tag rows are accessible controls'],
      ["title: 'Open player card'", 'tag rows expose player-card destination'],
      ["onKeyDown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick && onClick(e); } }", 'tag rows support keyboard activation'],
      ['onClick: () => openCard(r.pid)', 'tag rows open player detail'],
    ],
  },
  {
    name: 'live click validation script',
    file: 'tests/live-click-paths.js',
    checks: [
      ['const VIEWPORTS = {', 'defines breakpoint-specific coverage'],
      ["['myteam', 'My Roster'", 'covers My Roster as a full-tab surface'],
      ["['analytics', 'Analytics'", 'covers Analytics as a full-tab surface'],
      ["['trades', 'Trade Center'", 'covers Trade Center as a full-tab surface'],
      ["['draft', 'Draft'", 'covers Draft as a full-tab surface'],
      ["['fa', 'Free Agency'", 'covers Free Agency as a full-tab surface'],
      ["['alex', 'GM Office'", 'covers GM Office as a full-tab surface'],
      ["['trophies', 'Trophy Room'", 'covers Trophy Room as a full-tab surface'],
      ["['compare', 'Compare'", 'covers Compare as a full-tab surface'],
      ["['calendar', 'Calendar'", 'covers Calendar as a full-tab surface'],
      ['function findBlankCards()', 'fails blank cards/widgets'],
      ['QA Player Report', 'seeds player custom-report coverage'],
      ['QA Team Report', 'seeds team custom-report coverage'],
      ['Analytics full team report row opens team context', 'validates team report drill-through'],
      ['Analytics full player report row opens player card', 'validates player report drill-through'],
      ['Compare opponent select opens team comparison and player card', 'validates Compare team selection and player-card drill-through'],
      ['Calendar add-event workflow renders a custom event', 'validates Calendar custom-event clicks'],
    ],
  },
  {
    name: 'live click validation wiring',
    file: 'package.json',
    checks: [
      ['"test:live-click-paths": "npm run build:preview && node tests/live-click-paths.js"', 'provides repeatable live click-path QA command'],
      ['node tests/live-click-paths.js', 'wires live click-path QA into browser test workflow'],
    ],
  },
];

let passed = 0;
const failures = [];

console.log('\nWar Room click-path contract');

for (const surface of surfaces) {
  try {
    const source = read(surface.file);
    surface.checks.forEach(([needle, label]) => assertIncludes(source, needle, `${surface.name} ${label}`));
    (surface.minCounts || []).forEach(([needle, min, label]) => assertCountAtLeast(source, needle, min, `${surface.name} ${label}`));
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failures.push(`  FAIL: ${surface.name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

const failed = failures.length;
console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} surfaces - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

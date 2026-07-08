#!/usr/bin/env node
// Live browser click-through QA for dashboard and widget surfaces.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LEAGUE_ID = process.env.WARROOM_QA_LEAGUE || '1312100327931019264';
const USER = process.env.WARROOM_QA_USER || 'bigloco';
const BASE_PATH = process.env.WARROOM_QA_PATH || '/dist-preview/';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_START = Number(process.env.WARROOM_CLICK_QA_PORT || 3410);
const VIEWPORTS = {
  desktop: { width: 1365, height: 950 },
  tablet: { width: 900, height: 900 },
  mobile: { width: 390, height: 844 },
};

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('SKIP live click-path QA - @playwright/test is not installed. Run npm install first.');
  process.exit(0);
}

const LIVE_WIDGET_LAYOUT = [
  { id: 'qa-intel', key: 'intel-brief', size: 'xl' },
  { id: 'qa-roster-sm', key: 'roster-pulse', size: 'sm', primaryMetric: 'health-score' },
  { id: 'qa-roster-xxl', key: 'roster-pulse', size: 'xxl', primaryMetric: 'health-score' },
  { id: 'qa-league-sm', key: 'league-landscape', size: 'sm' },
  { id: 'qa-market-sm', key: 'market-radar', size: 'sm' },
  { id: 'qa-market-xxl', key: 'market-radar', size: 'xxl' },
  { id: 'qa-draft-sm', key: 'draft-capital', size: 'sm' },
  { id: 'qa-draft-xxl', key: 'draft-capital', size: 'xxl' },
  { id: 'qa-field-notes', key: 'field-notes', size: 'lg' },
  { id: 'qa-competitive', key: 'competitive-tiers', size: 'sm' },
  { id: 'qa-power', key: 'power-rankings', size: 'sm' },
  { id: 'qa-trade-block', key: 'trade-block', size: 'sm' },
  { id: 'qa-cut-candidates', key: 'cut-candidates', size: 'sm' },
  { id: 'qa-waiver-targets', key: 'waiver-targets', size: 'sm' },
  { id: 'qa-trophies', key: 'my-trophies', size: 'sm' },
  { id: 'qa-ticker', key: 'transaction-ticker', size: 'lg' },
];

const SEEDED_REPORTS = [
  {
    id: 'qa_players',
    name: 'QA Player Report',
    dataSource: 'players',
    columns: ['name', 'pos', 'dhq', 'owner'],
    filters: [],
    sort: { field: 'dhq', dir: 'desc' },
    groupBy: null,
    limit: 12,
  },
  {
    id: 'qa_teams',
    name: 'QA Team Report',
    dataSource: 'teams',
    columns: ['teamName', 'healthScore', 'tier', 'totalDHQ'],
    filters: [],
    sort: { field: 'healthScore', dir: 'desc' },
    groupBy: null,
    limit: null,
  },
];

function hasChrome() {
  return fs.existsSync(CHROME);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findOpenPort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port >= 65536) return reject(new Error(`no open port found starting at ${start}`));
      const server = net.createServer();
      server.once('error', err => {
        if (err && ['EACCES', 'EPERM'].includes(err.code)) reject(err);
        else tryPort(port + 1);
      });
      server.once('listening', () => server.close(() => resolve(port)));
      server.listen(port, '127.0.0.1');
    };
    if (!Number.isFinite(start)) reject(new Error('invalid start port'));
    else tryPort(start);
  });
}

async function startStaticServer(port) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-static.cjs'), '--host=127.0.0.1', `--port=${port}`], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  proc.stdout.on('data', chunk => {
    if (String(chunk).includes('Serving')) ready = true;
  });
  for (let i = 0; i < 40; i++) {
    if (ready) return proc;
    await wait(250);
  }
  return proc;
}

async function runCase(name, failures, fn) {
  try {
    await fn();
    process.stdout.write('.');
  } catch (err) {
    failures.push(`${name}: ${err && err.message ? err.message : err}`);
    process.stdout.write('F');
  }
}

async function newQaPage(context, baseUrl, failures, options = {}) {
  const tab = options.tab || 'dashboard';
  const viewport = options.viewport || VIEWPORTS.desktop;
  const page = await context.newPage();
  page.on('pageerror', err => failures.push(`page error: ${err.message}`));
  await page.setViewportSize(viewport);
  const url = `${baseUrl}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=${tab}`;
  let lastGotoError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      lastGotoError = null;
      break;
    } catch (err) {
      lastGotoError = err;
      await wait(500);
    }
  }
  if (lastGotoError) throw lastGotoError;
  await page.waitForFunction(activeTab => {
    if (window.App?.LI_LOADED === true) return true;
    if (activeTab === 'dashboard') return false;
    const text = document.body?.innerText || '';
    return text.length > 500 && !text.includes('BUILDING LEAGUE INTELLIGENCE');
  }, tab, { timeout: 60000 });
  if (tab === 'dashboard') {
    await page.waitForSelector('[data-widget-id="qa-roster-sm"]', { timeout: 45000 });
  }
  await page.waitForFunction(() => document.body.innerText.includes('Good') || document.body.innerText.includes('Dashboard'), null, { timeout: 12000 }).catch(() => {});
  await page.waitForTimeout(350);
  return page;
}

function hashTabFromUrl(url) {
  return new URLSearchParams((new URL(url).hash || '').replace(/^#/, '')).get('tab') || 'dashboard';
}

async function waitForTab(page, expectedTab) {
  await page.waitForFunction(
    tab => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tab') === tab,
    expectedTab,
    { timeout: 8000 },
  );
}

async function assertPlayerCardOpen(page) {
  await page.waitForFunction(() => {
    const root = document.getElementById('wr-player-card-root');
    return !!root && root.innerText.trim().length > 20;
  }, null, { timeout: 8000 });
}

async function clickWidget(page, widgetId) {
  await page.waitForFunction(id => !!document.querySelector(`[data-widget-id="${id}"]`), widgetId, { timeout: 8000 });
  await page.evaluate(id => {
    const widget = document.querySelector(`[data-widget-id="${id}"]`);
    if (!widget) throw new Error(`widget ${id} not found`);
    widget.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = widget.getBoundingClientRect();
    const x = Math.max(1, Math.min(window.innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(1, Math.min(window.innerHeight - 1, rect.top + rect.height / 2));
    const target = document.elementFromPoint(x, y) || widget;
    target.click();
  }, widgetId);
}

async function clickWidgetPlayer(page, widgetId) {
  await page.waitForFunction(id => !!document.querySelector(`[data-widget-id="${id}"]`), widgetId, { timeout: 8000 });
  await page.evaluate(id => {
    const widget = document.querySelector(`[data-widget-id="${id}"]`);
    if (!widget) throw new Error(`widget ${id} not found`);
    const target = widget.querySelector('[title="Open player card"]');
    if (!target) throw new Error(`widget ${id} has no player-card target`);
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
  }, widgetId);
  await assertPlayerCardOpen(page);
}

async function clickWidgetTarget(page, widgetId, selector) {
  return page.evaluate(({ widgetId: id, selector: targetSelector }) => {
    const widget = document.querySelector(`[data-widget-id="${id}"]`);
    if (!widget) throw new Error(`widget ${id} not found`);
    const target = widget.querySelector(targetSelector);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  }, { widgetId, selector });
}

async function clickVisibleSelector(page, selector, label) {
  const clicked = await page.evaluate(({ selector: targetSelector }) => {
    const isVisible = el => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const target = Array.from(document.querySelectorAll(targetSelector)).find(isVisible);
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  }, { selector });
  if (!clicked) throw new Error(`${label || selector} not found`);
}

async function clickButtonText(page, text) {
  const clicked = await page.evaluate(label => {
    const normalize = v => String(v || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const wanted = normalize(label);
    const isVisible = el => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find(b => isVisible(b) && normalize(b.innerText) === wanted)
      || buttons.find(b => isVisible(b) && normalize(b.innerText).includes(wanted));
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    target.click();
    return true;
  }, text);
  if (!clicked) throw new Error(`button "${text}" not found`);
}

async function waitForText(page, text, timeout = 8000) {
  await page.waitForFunction(
    expected => document.body.innerText.toLowerCase().includes(String(expected).toLowerCase()),
    text,
    { timeout },
  );
}

async function assertSurfaceReady(page, label, snippets = []) {
  const result = await page.evaluate(({ label: surfaceLabel, snippets: expected }) => {
    const bodyText = document.body.innerText.replace(/\s+/g, ' ').trim();
    const missing = expected.filter(s => !bodyText.toLowerCase().includes(String(s).toLowerCase()));
    return {
      label: surfaceLabel,
      length: bodyText.length,
      missing,
      blankCards: findBlankCards(),
    };

    function isVisible(el) {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function cssPath(el) {
      const id = el.id ? `#${el.id}` : '';
      const cls = String(el.className || '').trim().split(/\s+/).filter(Boolean).slice(0, 3).map(c => `.${c}`).join('');
      const widget = el.dataset?.widgetId ? `[data-widget-id="${el.dataset.widgetId}"]` : '';
      return `${el.tagName.toLowerCase()}${id}${widget}${cls}`;
    }

    function findBlankCards() {
      const selectors = [
        '[data-widget-id]',
        '.analytics-panel',
        '.analytics-proof-card',
        '.analytics-lab-card',
        '.analytics-report-preview',
        '.analytics-report-preview-row',
        '.gm-office-kpi-grid > *',
        '.gm-office-insight-grid > *',
        '.tc-dhq-panel',
        '.tc-dhq-deal-card',
        '.fa-hq-panel',
        '.fa-hq-candidate',
        '.fa-hq-mini-card',
        '.draft-hq-panel',
        '.draft-rec-card',
        '.is-clickable-report-row',
      ];
      const seen = new Set();
      return Array.from(document.querySelectorAll(selectors.join(',')))
        .filter(el => {
          if (seen.has(el)) return false;
          seen.add(el);
          return isVisible(el);
        })
        .filter(el => {
          const text = el.innerText.replace(/\s+/g, ' ').trim();
          const hasNonTextContent = !!el.querySelector('input,select,textarea,img,canvas,svg');
          return text.length < 2 && !hasNonTextContent;
        })
        .map(cssPath)
        .slice(0, 8);
    }
  }, { label, snippets });
  if (result.length < 250) throw new Error(`${label} rendered too little visible text (${result.length} chars)`);
  if (result.missing.length) throw new Error(`${label} missing expected text: ${result.missing.join(', ')}`);
  if (result.blankCards.length) throw new Error(`${label} has blank card/widget targets: ${result.blankCards.join(', ')}`);
}

async function main() {
  if (!hasChrome()) {
    console.log(`SKIP live click-path QA - Chrome not found at ${CHROME}`);
    return;
  }

  let port;
  try {
    port = await findOpenPort(PORT_START);
  } catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`SKIP live click-path QA - local port binding is not permitted here (${err.code}).`);
      return;
    }
    throw err;
  }

  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: (process.env.PLAYWRIGHT_CHROME_ARGS || '').split(' ').filter(Boolean) });
  const failures = [];
  let totalCases = 0;
  const run = async (name, fn) => {
    totalCases++;
    await runCase(name, failures, fn);
  };
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const context = await browser.newContext();
    await context.addInitScript(({ leagueId, layout, reports, user }) => {
      // Connect the user so the league shell renders. sleeperUsername reads from storage
      // (OD.getCurrentUsername → dynastyhq_username), NOT the ?user= param, so without this
      // the app sits on the pre-connect screen and LI_LOADED never flips.
      localStorage.setItem('dynastyhq_username', user);
      localStorage.setItem('wr_tutorial_done_v1', '1');
      localStorage.setItem('wr_dashboard_hint_dismissed', '1');
      localStorage.setItem('wr_dashboard_migrated_v2', 'true');
      localStorage.setItem(`wr_kpi_selection_${leagueId}`, JSON.stringify(layout));
      localStorage.setItem('wr_kpi_selection_', JSON.stringify(layout));
      localStorage.setItem('wr_custom_reports', JSON.stringify(reports));
      localStorage.setItem(`wr_hof_${leagueId}`, JSON.stringify([
        { id: 'qa_hof_1', scope: 'league', name: 'QA League Legend', category: 'Validation', year: 2026, note: 'Seeded by live click QA.' },
      ]));
    }, { leagueId: LEAGUE_ID, layout: LIVE_WIDGET_LAYOUT, reports: SEEDED_REPORTS, user: USER });
    await context.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });

    const navCases = [
      ['roster widget navigates to My Roster', 'qa-roster-sm', 'myteam'],
      ['league landscape navigates to Analytics', 'qa-league-sm', 'analytics'],
      ['market radar navigates to Trade Center', 'qa-market-sm', 'trades'],
      ['draft capital navigates to Draft', 'qa-draft-sm', 'draft'],
      ['field notes navigates to Alex', 'qa-field-notes', 'alex'],
      ['competitive tiers navigates to Analytics', 'qa-competitive', 'analytics'],
      ['power rankings navigates to Analytics', 'qa-power', 'analytics'],
      ['trade block navigates to My Roster', 'qa-trade-block', 'myteam'],
      ['cut candidates navigates to My Roster', 'qa-cut-candidates', 'myteam'],
      ['waiver targets navigates to Free Agency', 'qa-waiver-targets', 'fa'],
      ['trophies widget navigates to Trophy Room', 'qa-trophies', 'trophies'],
    ];

    for (const [label, widgetId, expectedTab] of navCases) {
      await run(label, async () => {
        const page = await newQaPage(context, baseUrl, failures);
        await clickWidget(page, widgetId);
        await waitForTab(page, expectedTab);
        await page.close();
      });
    }

    for (const [label, widgetId] of [
      ['roster pulse player target opens player card', 'qa-roster-xxl'],
      ['market radar player target opens player card', 'qa-market-xxl'],
      ['draft capital player target opens player card', 'qa-draft-xxl'],
    ]) {
      await run(label, async () => {
        const page = await newQaPage(context, baseUrl, failures);
        await clickWidgetPlayer(page, widgetId);
        await page.close();
      });
    }

    await run('intel brief action routes out of dashboard', async () => {
      const page = await newQaPage(context, baseUrl, failures);
      const clicked = await clickWidgetTarget(page, 'qa-intel', 'button');
      if (!clicked) throw new Error('intel brief has no action button');
      await page.waitForFunction(() => {
        const tab = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('tab') || 'dashboard';
        const root = document.getElementById('wr-player-card-root');
        return tab !== 'dashboard' || (!!root && root.innerText.trim().length > 20);
      }, null, { timeout: 8000 });
      if (hashTabFromUrl(page.url()) === 'dashboard') await assertPlayerCardOpen(page);
      await page.close();
    });

    await run('transaction ticker trade row opens Trade Context', async () => {
      const page = await newQaPage(context, baseUrl, failures);
      const clicked = await clickWidgetTarget(page, 'qa-ticker', '[title="Open trade context"]');
      if (!clicked) {
        const tradeCount = await page.evaluate(() => {
          const txns = Object.values(window.S?.transactions || {}).flat();
          const liTradeCount = Array.isArray(window.App?.LI?.tradeHistory) ? window.App.LI.tradeHistory.length : 0;
          return txns.filter(t => t?.type === 'trade').length + liTradeCount;
        });
        if (tradeCount === 0) {
          await page.close();
          return;
        }
        throw new Error('transaction ticker has trade data but no trade-context target');
      }
      await waitForTab(page, 'trades');
      await page.getByText('Trade Context', { exact: true }).waitFor({ state: 'visible', timeout: 8000 });
      await page.close();
    });

    await run('transaction ticker player chip opens player card', async () => {
      const page = await newQaPage(context, baseUrl, failures);
      const clicked = await clickWidgetTarget(page, 'qa-ticker', '[title="Open player card"]');
      if (!clicked) throw new Error('transaction ticker has no player-card target');
      await assertPlayerCardOpen(page);
      await page.close();
    });

    for (const [name, viewport] of Object.entries(VIEWPORTS)) {
      await run(`dashboard widget click works at ${name} breakpoint`, async () => {
        const page = await newQaPage(context, baseUrl, failures, { viewport });
        await assertSurfaceReady(page, `dashboard ${name}`, ['Home', 'My Roster']);
        await clickWidget(page, 'qa-market-sm');
        await waitForTab(page, 'trades');
        await page.close();
      });
    }

    const tabSurfaces = [
      ['myteam', 'My Roster', ['MY ROSTER', 'Roster Board']],
      ['analytics', 'Analytics', ['ANALYTICS', 'ROSTER']],
      ['trades', 'Trade Center', ['TRADE', 'Best Move']],
      ['draft', 'Draft', ['DRAFT', 'BIG BOARD']],
      ['fa', 'Free Agency', ['PRIORITY MOVES']],
      ['alex', 'GM Office', ['OFFICE', "GM's Office"]],
      ['trophies', 'Trophy Room', ['League', 'Trophy']],
      ['compare', 'Compare', ['DUEL']],
      ['calendar', 'Calendar', ['LEAGUE CALENDAR', 'Add Event']],
    ];

    for (const [tab, label, snippets] of tabSurfaces) {
      await run(`${label} surface renders nonblank at desktop`, async () => {
        const page = await newQaPage(context, baseUrl, failures, { tab });
        await assertSurfaceReady(page, label, snippets);
        await page.close();
      });
    }

    await run('My Roster player row opens inline dossier', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'myteam' });
      await clickVisibleSelector(page, '[title="Open roster player detail"]', 'roster player row');
      await waitForText(page, 'Dynasty Read');
      await assertSurfaceReady(page, 'My Roster expanded row', ['Dynasty Read']);
      await page.close();
    });

    await run('Free Agency recommendation opens player card', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'fa' });
      await clickVisibleSelector(page, '.fa-hq-candidate[title="Open player card"], .fa-hq-mini-card[title="Open player card"], [title="Open player card"]', 'free agency player target');
      await assertPlayerCardOpen(page);
      await page.close();
    });

    await run('Draft target opens player card', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'draft' });
      await clickVisibleSelector(page, '.draft-rec-card[title="Open player card"], [title="Open player card"]', 'draft player target');
      await assertPlayerCardOpen(page);
      await page.close();
    });

    await run('Trade Center partner and surface clicks update the adaptive canvas', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'trades' });
      await waitForText(page, 'Best Move');
      // The hero renders when a usable best move exists; otherwise the workspace is already up.
      const onHero = await page.evaluate(() =>
        Array.from(document.querySelectorAll('button')).some(b => b.innerText.trim() === 'Browse All Partners'));
      if (onHero) await clickButtonText(page, 'Browse All Partners');
      await clickButtonText(page, 'Owner DNA');
      await waitForText(page, 'Owners · sorted by power');
      await assertSurfaceReady(page, 'Trade Center clicked state', ['Owner DNA']);
      await page.close();
    });

    await run('Compare opponent select opens team comparison and player card', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'compare' });
      await waitForText(page, 'DUEL');
      const options = await page.locator('.wr-module-select option').count();
      if (options < 2) throw new Error('compare tab has no opponent options');
      await page.locator('.wr-module-select').selectOption({ index: 1 });
      await waitForText(page, 'Position Edge Matrix');
      await assertSurfaceReady(page, 'Compare selected opponent', ['Position Edge Matrix']);
      await clickVisibleSelector(page, '[title="Open player card"]', 'compare player target');
      await assertPlayerCardOpen(page);
      await page.close();
    });

    await run('Calendar add-event workflow renders a custom event', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'calendar' });
      await assertSurfaceReady(page, 'Calendar', ['LEAGUE CALENDAR', '+ Add Event']);
      await clickButtonText(page, '+ Add Event');
      await page.getByPlaceholder('Event title').fill('QA Validation Window');
      await page.locator('input[type="date"]').fill('2026-08-15');
      await clickButtonText(page, 'Add to Calendar');
      await waitForText(page, 'QA Validation Window');
      await assertSurfaceReady(page, 'Calendar custom event', ['QA Validation Window']);
      await clickVisibleSelector(page, '[title="Remove custom calendar event"]', 'calendar custom-event remove');
      await page.close();
    });

    await run('Analytics report preview player row opens player card', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'analytics' });
      await clickButtonText(page, 'Reports');
      await waitForText(page, 'Custom Reports');
      await clickVisibleSelector(page, '.analytics-report-preview-row[title="Open player card"]', 'report preview player row');
      await assertPlayerCardOpen(page);
      await page.close();
    });

    await run('Analytics full player report row opens player card', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'analytics' });
      await clickButtonText(page, 'Reports');
      await waitForText(page, 'Custom Reports');
      await clickVisibleSelector(page, '[data-report-id="qa_players"]', 'QA Player Report');
      await waitForText(page, 'QA Player Report');
      await clickVisibleSelector(page, '.is-clickable-report-row[title="Open player card"]', 'full player report row');
      await assertPlayerCardOpen(page);
      await page.close();
    });

    await run('Analytics full team report row opens team context', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'analytics' });
      await clickButtonText(page, 'Reports');
      await waitForText(page, 'Custom Reports');
      await clickVisibleSelector(page, '[data-report-id="qa_teams"]', 'QA Team Report');
      await waitForText(page, 'QA Team Report');
      await clickVisibleSelector(page, '.is-clickable-report-row[title="Open team context"]', 'full team report row');
      await page.waitForSelector('#wr-export-team-roster', { timeout: 8000 });
      await assertSurfaceReady(page, 'Analytics team report context', ['Back to League', 'Regular Season']);
      await page.close();
    });

    await run('Alex sub-tabs remain clickable', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'alex' });
      await clickButtonText(page, 'Patterns');
      await waitForText(page, 'Patterns');
      await clickButtonText(page, 'Model Settings');
      await waitForText(page, 'How Alex talks to you');
      await assertSurfaceReady(page, 'GM Office clicked state', ['How Alex talks to you']);
      await page.close();
    });

    await run('Trophy Room tab clicks render nonblank states', async () => {
      const page = await newQaPage(context, baseUrl, failures, { tab: 'trophies' });
      await clickButtonText(page, 'All-Time');
      await waitForText(page, 'All-Time');
      await clickButtonText(page, 'Import');
      await waitForText(page, 'Import');
      await clickButtonText(page, 'My Trophies');
      await waitForText(page, 'Hall of Fame');
      await assertSurfaceReady(page, 'Trophy Room clicked state', ['Hall of Fame']);
      await page.close();
    });

    console.log('');
    if (failures.length) {
      console.log(failures.map(f => `  FAIL: ${f}`).join('\n'));
      console.log('');
    }
    console.log(`${failures.length ? 'FAIL' : 'PASS'} live click-path QA - ${totalCases - failures.length} passed, ${failures.length} failed`);
    process.exit(failures.length ? 1 : 0);
  } finally {
    await browser.close().catch(() => {});
    server.kill('SIGTERM');
  }
}

main().catch(err => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});

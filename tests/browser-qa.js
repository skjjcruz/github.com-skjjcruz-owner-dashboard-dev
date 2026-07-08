#!/usr/bin/env node
// Real-browser QA smoke tests for War Room layout/routes.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const LEAGUE_ID = process.env.WARROOM_QA_LEAGUE || '1312100327931019264';
const USER = process.env.WARROOM_QA_USER || 'bigloco';
const BASE_PATH = process.env.WARROOM_QA_PATH || '/dist-preview/';
// Phone floor (390/430), iPad portrait (768 mini, 820 Air, 834 Pro 11", 1024 Pro 12.9"),
// iPad landscape (1180), desktop (1365). iPad portrait is now a first-class layout tier.
const WIDTHS = [390, 430, 768, 820, 834, 1024, 1180, 1365];
const TABS = ['dashboard', 'myteam', 'compare', 'trades', 'fa', 'draft', 'analytics', 'alex', 'trophies', 'calendar', 'strategy'];
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_START = Number(process.env.WARROOM_QA_PORT || 3210);

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('SKIP browser QA - @playwright/test is not installed. Run npm install first.');
  process.exit(0);
}

function hasChrome() {
  return fs.existsSync(CHROME);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function findOpenPort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port >= 65536) {
        reject(new Error(`no open port found starting at ${start}`));
        return;
      }
      const server = net.createServer();
      server.once('error', err => {
        if (err && ['EACCES', 'EPERM'].includes(err.code)) reject(err);
        else tryPort(port + 1);
      });
      server.once('listening', () => {
        server.close(() => resolve(port));
      });
      server.listen(port, '127.0.0.1');
    };
    if (!Number.isFinite(start)) reject(new Error('invalid start port'));
    else tryPort(start);
  });
}

async function startStaticServer(port) {
  const cmd = process.execPath;
  const args = [path.join(ROOT, 'scripts', 'serve-static.cjs'), '--host=127.0.0.1', `--port=${port}`];
  const proc = spawn(cmd, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let ready = false;
  proc.stdout.on('data', chunk => {
    if (String(chunk).includes('Serving')) ready = true;
  });
  proc.stderr.on('data', chunk => {
    if (String(chunk).includes('EADDRINUSE')) ready = false;
  });
  for (let i = 0; i < 40; i++) {
    if (ready) return proc;
    await wait(250);
  }
  return proc;
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const root = document.getElementById('root');
    const clipped = [];
    document.querySelectorAll('button,a,[role="button"],.wr-widget,.wr-player-row,.wr-card').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const style = window.getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') return;
      if (rect.right <= 2 && rect.left < 0) return;
      if (rect.left < -2 || rect.right > window.innerWidth + 2) {
        clipped.push({
          tag: el.tagName.toLowerCase(),
          className: String(el.className || '').slice(0, 80),
          text: String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        });
      }
    });
    return {
      scrollWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
      innerWidth: window.innerWidth,
      rootTextLength: root ? root.innerText.trim().length : 0,
      clipped,
      title: document.title,
    };
  });
}

async function main() {
  if (!hasChrome()) {
    console.log(`SKIP browser QA - Chrome not found at ${CHROME}`);
    return;
  }

  let port;
  try {
    port = await findOpenPort(PORT_START);
  } catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`SKIP browser QA - local port binding is not permitted here (${err.code}).`);
      return;
    }
    throw err;
  }
  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const failures = [];
  let checked = 0;

  try {
    const context = await browser.newContext();
    await context.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });
    for (const width of WIDTHS) {
      const height = width <= 430 ? 900 : 900;
      for (const tab of TABS) {
        const page = await context.newPage();
        await page.setViewportSize({ width, height });
        const url = `http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=${tab}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
        await page.waitForTimeout(700);
        const snap = await layoutSnapshot(page);
        if (snap.rootTextLength < 20) {
          failures.push(`${tab}@${width}: root content did not render`);
        }
        if (snap.scrollWidth > snap.innerWidth + 2) {
          failures.push(`${tab}@${width}: horizontal overflow ${snap.scrollWidth} > ${snap.innerWidth}`);
        }
        if (snap.clipped.length) {
          failures.push(`${tab}@${width}: ${snap.clipped.length} clipped elements; first=${JSON.stringify(snap.clipped[0])}`);
        }
        await page.close();
        checked++;
        process.stdout.write('.');
      }
    }

    const page = await context.newPage();
    await page.setViewportSize({ width: 390, height: 900 });
    // Connect the user so the real league shell renders. sleeperUsername reads from storage
    // (OD.getCurrentUsername → dynastyhq_username), NOT the ?user= param, so without this the
    // app sits on the pre-connect screen and the nav shell (.wr-hamburger) never mounts.
    await page.addInitScript(u => {
      localStorage.setItem('wr_tutorial_done_v1', '1');
      localStorage.setItem('dynastyhq_username', u);
    }, USER);
    await page.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=dashboard`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.locator('.wr-hamburger').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});

    const hamburger = page.locator('.wr-hamburger');
    if (await hamburger.count() !== 1) {
      failures.push('dashboard-shell@390: hamburger control not found');
    } else {
      await hamburger.click({ timeout: 4000 }).catch(err => {
        failures.push(`dashboard-shell@390: hamburger click failed (${err.message})`);
      });
      await page.waitForTimeout(150);
      const open = await page.locator('.wr-sidebar.open').count();
      if (open !== 1) failures.push('dashboard-shell@390: hamburger did not open sidebar');
      const overlay = page.locator('.wr-sidebar-overlay');
      if (await overlay.count()) await overlay.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(150);
    }

    const shellSnap = await page.evaluate(() => {
      const names = ['.wr-hamburger', '.wr-league-header-row', '.wr-time-bar', '.wr-time-mode'];
      const rectFor = selector => {
        const el = document.querySelector(selector);
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          selector,
          text: String(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          width: Math.round(rect.width),
        };
      };
      const banner = rectFor('.wr-dev-banner');
      return {
        banner,
        items: names.map(rectFor).filter(Boolean),
      };
    });
    shellSnap.items.forEach(item => {
      if (item.left < -2 || item.right > 392) {
        failures.push(`dashboard-shell@390: ${item.selector} clips viewport ${JSON.stringify(item)}`);
      }
    });
    const hamburgerRect = shellSnap.items.find(item => item.selector === '.wr-hamburger');
    if (shellSnap.banner && hamburgerRect && hamburgerRect.top < shellSnap.banner.bottom - 1) {
      failures.push(`dashboard-shell@390: dev banner overlaps hamburger ${JSON.stringify({ banner: shellSnap.banner, hamburger: hamburgerRect })}`);
    }

    const widgetSnap = await page.evaluate(() => {
      const widgets = [...document.querySelectorAll('.wr-dashboard-grid > .wr-widget')];
      return widgets.map(widget => {
        const rect = widget.getBoundingClientRect();
        return {
          text: String(widget.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
          width: Math.round(rect.width),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
        };
      });
    });
    widgetSnap.forEach((widget, index) => {
      if (widget.left < -2 || widget.right > 392) {
        failures.push(`dashboard-widget-${index}@390: widget overflows viewport ${JSON.stringify(widget)}`);
      }
    });
    await page.close();
    checked++;
    process.stdout.write('.');

    const empirePage = await context.newPage();
    await empirePage.setViewportSize({ width: 1365, height: 900 });
    // The hub league-selector (which holds the Launch Empire Dashboard control) only renders
    // once a Sleeper user is connected, and sleeperUsername reads from storage
    // (OD.getCurrentUsername → dynastyhq_username), NOT the ?user= query param. Seed it so the
    // hub boots connected and renders the launch control.
    await empirePage.addInitScript(u => {
      try { localStorage.setItem('dynastyhq_username', u); localStorage.setItem('wr_tutorial_done_v1', '1'); } catch (e) {}
    }, USER);
    await empirePage.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    // The selector renders only after the user's leagues finish loading (network).
    await empirePage.locator('.hub-league-selector').waitFor({ state: 'attached', timeout: 20000 }).catch(() => {});
    const launch = empirePage.getByText('Launch Empire Dashboard', { exact: true });
    await launch.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    if (await launch.count() !== 1) {
      const diag = await empirePage.evaluate(() => ({
        sel: !!document.querySelector('.hub-league-selector'),
        body: String(document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160),
      })).catch(() => ({}));
      failures.push(`empire-launch: Launch Empire Dashboard control not found [selector=${diag.sel} body="${diag.body || ''}"]`);
    } else {
      await launch.click();
      await empirePage.waitForTimeout(1200);
      if (await empirePage.getByTestId('empire-root').count() !== 1) {
        failures.push('empire-launch: Empire root did not render');
      }
      if (await empirePage.getByTestId('empire-command-strip').count() !== 1) {
        failures.push('empire-launch: command strip did not render');
      }
      const empireSnap = await layoutSnapshot(empirePage);
      if (empireSnap.rootTextLength < 80) {
        failures.push('empire-launch: Empire rendered too little content');
      }
      if (empireSnap.scrollWidth > empireSnap.innerWidth + 2) {
        failures.push(`empire-launch: horizontal overflow ${empireSnap.scrollWidth} > ${empireSnap.innerWidth}`);
      }
      // P0 data modules must be live in-browser and produce a valid Command Bridge contract.
      const mods = await empirePage.evaluate(() => {
        const r = {
          snap: !!(window.WrSnapshots && typeof window.WrSnapshots.empireDelta === 'function'),
          txn: !!(window.WrTxns && typeof window.WrTxns.fetchLeagueTxns === 'function'),
          cb: !!(window.App && typeof window.App.buildCommandBridge === 'function'),
          kpis: -1,
        };
        try {
          if (window.App && window.App.buildCommandBridge) {
            const out = window.App.buildCommandBridge({
              model: { totals: { totalDHQ: 120000, leagues: 2, totalRecord: { wins: 3, losses: 1 }, avgHealth: 75 }, provinces: [], exposure: [], pickCapital: { total: 5, premium: 2 } },
              actionQueue: [],
            });
            r.kpis = ((out && out.kpis) || []).length;
          }
        } catch (e) { r.err = String((e && e.message) || e); }
        return r;
      }).catch(() => ({}));
      if (!mods.snap) failures.push('empire-modules: window.WrSnapshots.empireDelta missing');
      if (!mods.txn) failures.push('empire-modules: window.WrTxns.fetchLeagueTxns missing');
      if (!mods.cb) failures.push('empire-modules: window.App.buildCommandBridge missing');
      if (mods.kpis !== 6) failures.push(`empire-modules: buildCommandBridge KPIs=${mods.kpis}${mods.err ? ' err=' + mods.err : ''}`);

      // Command Bridge KPI strip renders the 6 mockup KPIs (from buildCommandBridge) with live data.
      const kpiLabels = await empirePage.evaluate(() =>
        [...document.querySelectorAll('[data-testid="empire-command-strip"] .empire-kpi span')].map(s => (s.textContent || '').trim())
      ).catch(() => []);
      const wantKpis = ['Empire Value', 'Record', 'Avg Health', 'Pick Capital', 'Top Exposure', 'Open Actions'];
      const missingKpis = wantKpis.filter(w => !kpiLabels.includes(w));
      if (missingKpis.length) failures.push(`command-bridge: KPI tiles missing ${JSON.stringify(missingKpis)} (got ${JSON.stringify(kpiLabels)})`);

      // Command Bridge composition: the signature panels render with live cross-league data.
      const panels = await empirePage.evaluate(() =>
        [...document.querySelectorAll('.empire-panel-head strong')].map(s => (s.textContent || '').trim())
      ).catch(() => []);
      const wantPanels = ['Empire Brief', 'Priority Queue', 'Risks And Opportunities', 'League Stack'];
      const missingPanels = wantPanels.filter(w => !panels.some(p => p.includes(w)));
      if (missingPanels.length) failures.push(`command-bridge: panels missing ${JSON.stringify(missingPanels)} (got ${JSON.stringify(panels)})`);

      // Asset rows render asynchronously (after the player DB fetch + model build), so wait
      // for them before the filter dance — otherwise the drilldown count races the render.
      await empirePage.getByTestId('empire-asset-row').first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
      const postWindow = empirePage.getByRole('button', { name: 'Post-window', exact: true });
      if (await postWindow.count() > 0) {
        await postWindow.first().click();
        await empirePage.waitForTimeout(300);
        const hasClear = await empirePage.getByText('Clear 1', { exact: true }).count();
        const hasEmpty = await empirePage.getByTestId('empire-empty-state').count();
        const hasRows = await empirePage.getByTestId('empire-asset-row').count();
        if (!hasClear && !hasEmpty && !hasRows) {
          failures.push('empire-filter: filter did not produce changed content, rows, or empty state');
        }
      }
      await empirePage.getByText('Clear 1', { exact: true }).click().catch(() => {});
      await empirePage.waitForTimeout(300);
      const rowCount = await empirePage.getByTestId('empire-asset-row').count();
      if (rowCount > 0) {
        await empirePage.getByTestId('empire-asset-row').first().click();
        await empirePage.waitForTimeout(300);
        if (await empirePage.getByText('Player Portfolio', { exact: true }).count() < 1) {
          failures.push('empire-drilldown: player detail did not open');
        }
        const back = empirePage.getByRole('button', { name: '<', exact: true });
        if (await back.count() > 0) await back.first().click();
      } else {
        failures.push('empire-drilldown: no asset rows available to open');
      }
    }
    await empirePage.close();
    checked++;
    process.stdout.write('.');
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures.length) {
    console.log('\nBrowser QA failures:');
    failures.forEach(failure => console.log(`  FAIL: ${failure}`));
    process.exit(1);
  }

  console.log(`\nPASS browser QA - ${checked} checks`);
}

main().catch(err => {
  console.error('Browser QA failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

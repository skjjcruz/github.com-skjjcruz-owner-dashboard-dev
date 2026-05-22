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
const WIDTHS = [390, 430, 1365];
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
      const server = net.createServer();
      server.once('error', () => tryPort(port + 1));
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

  const port = await findOpenPort(PORT_START);
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
    await page.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=dashboard`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForTimeout(700);
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
    await empirePage.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}`, { waitUntil: 'domcontentloaded', timeout: 12000 });
    const launch = empirePage.getByText('Launch Empire Dashboard', { exact: true });
    await launch.waitFor({ state: 'visible', timeout: 12000 }).catch(() => {});
    if (await launch.count() !== 1) {
      failures.push('empire-launch: Launch Empire Dashboard control not found');
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

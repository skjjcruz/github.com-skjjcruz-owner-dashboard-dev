#!/usr/bin/env node
// Real-browser draft QA for Mock Draft Center, Strategy Studio, and Live Draft.
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
const PORT_START = Number(process.env.WARROOM_DRAFT_QA_PORT || 3510);

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('SKIP draft browser QA - @playwright/test is not installed. Run npm install first.');
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

async function draftSnapshot(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    const clipped = [];
    document.querySelectorAll('button,a,[role="button"],.wr-module-strip,.draft-setup-panel,.draft-setup-start,.draft-setup-choice').forEach(el => {
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
      text: String(body?.innerText || ''),
      scrollWidth: Math.max(doc.scrollWidth, body?.scrollWidth || 0),
      innerWidth: window.innerWidth,
      clipped,
    };
  });
}

async function assertNoOverflow(page, label, failures) {
  const snap = await draftSnapshot(page);
  if (snap.scrollWidth > snap.innerWidth + 2) {
    failures.push(`${label}: horizontal overflow ${snap.scrollWidth} > ${snap.innerWidth}`);
  }
  if (snap.clipped.length) {
    failures.push(`${label}: ${snap.clipped.length} clipped elements; first=${JSON.stringify(snap.clipped[0])}`);
  }
  return snap;
}

async function clickTopDraftView(page, label) {
  await page.waitForFunction(() => !document.body.innerText.includes('BUILDING LEAGUE INTELLIGENCE'), null, { timeout: 45000 }).catch(() => {});
  const button = page.getByRole('button', { name: label, exact: true });
  await button.waitFor({ state: 'visible', timeout: 20000 });
  const count = await button.count();
  if (count !== 1) throw new Error(`expected one ${label} button, found ${count}`);
  await page.waitForFunction((buttonLabel) => {
    const btn = Array.from(document.querySelectorAll('button')).find(el => el.textContent.trim() === buttonLabel);
    if (!btn) return false;
    const rect = btn.getBoundingClientRect();
    const key = [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)].join(':');
    window.__draftNavStable = window.__draftNavStable || {};
    const stable = window.__draftNavStable[buttonLabel] === key;
    window.__draftNavStable[buttonLabel] = key;
    return stable;
  }, label, { timeout: 45000 });
  await button.click();
}

async function main() {
  if (!hasChrome()) {
    console.log(`SKIP draft browser QA - Chrome not found at ${CHROME}`);
    return;
  }

  let port;
  try {
    port = await findOpenPort(PORT_START);
  } catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`SKIP draft browser QA - local port binding is not permitted here (${err.code}).`);
      return;
    }
    throw err;
  }

  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: (process.env.PLAYWRIGHT_CHROME_ARGS || '').split(' ').filter(Boolean) });
  const failures = [];
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const context = await browser.newContext();
    await context.addInitScript(leagueId => {
      localStorage.setItem('wr_tutorial_done_v1', '1');
      localStorage.setItem('wr_dashboard_hint_dismissed', '1');
      Object.keys(localStorage)
        .filter(key => key.startsWith('wr_draft_cc_current_') || key.startsWith('wr_draft_strategy_profile_'))
        .forEach(key => localStorage.removeItem(key));
      localStorage.removeItem(`wr_draft_cc_current_mock_${leagueId}`);
      localStorage.removeItem(`wr_draft_cc_current_live_${leagueId}`);
    }, LEAGUE_ID);
    await context.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });

    const desktop = await context.newPage();
    desktop.on('pageerror', err => failures.push(`desktop page error: ${err.message}`));
    await desktop.setViewportSize({ width: 1365, height: 900 });
    await desktop.goto(`${baseUrl}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=draft`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await desktop.waitForFunction(() => document.body.innerText.includes('Draft'), null, { timeout: 25000 });
    if (!(await desktop.evaluate(() => /Alex Analyst Mock/i.test(document.body.innerText)))) {
      await desktop.getByRole('button', { name: 'Draft', exact: true }).first().click().catch(() => {});
    }
    await desktop.waitForFunction(() => /Alex Analyst Mock/i.test(document.body.innerText), null, { timeout: 45000 });
    const flashSnap = await assertNoOverflow(desktop, 'flash-brief@1365', failures);
    const flashTextLower = flashSnap.text.toLowerCase();
    ['Alex Analyst Mock', 'League Reality', 'My Board Lens', 'Trade Market'].forEach(text => {
      if (!flashTextLower.includes(text.toLowerCase())) failures.push(`flash-brief@1365: missing ${text}`);
    });
    if (!flashTextLower.includes('draft readiness')) failures.push('flash-brief@1365: missing Draft Readiness trust layer');
    process.stdout.write('.');

    await clickTopDraftView(desktop, 'Big Board');
    await desktop.waitForFunction(() => /Draft Big Board/i.test(document.body.innerText), null, { timeout: 45000 });
    const boardSnap = await assertNoOverflow(desktop, 'big-board@1365', failures);
    const boardTextLower = boardSnap.text.toLowerCase();
    ['Default Board', 'AI Recommended', 'User Board'].forEach(text => {
      if (!boardTextLower.includes(text.toLowerCase())) failures.push(`big-board@1365: missing ${text}`);
    });
    process.stdout.write('.');

    await clickTopDraftView(desktop, 'Mock Draft Center');
    await desktop.waitForFunction(() => /Mock Draft Center/i.test(document.body.innerText), null, { timeout: 25000 });
    const mockSnap = await assertNoOverflow(desktop, 'mock-draft-center@1365', failures);
    const mockTextLower = mockSnap.text.toLowerCase();
    ['MOCK UPCOMING DRAFT', 'AI GM STRATEGY STUDIO', 'MODEL TUNING', 'OWNER DNA', 'SAVE PROFILE', 'START MOCK DRAFT'].forEach(text => {
      if (!mockTextLower.includes(text.toLowerCase())) failures.push(`mock-draft-center@1365: missing ${text}`);
    });
    ['Custom Solo', 'bestball', 'Bestball'].forEach(text => {
      if (mockTextLower.includes(text.toLowerCase())) failures.push(`mock-draft-center@1365: removed setup option still visible: ${text}`);
    });
    if (/Analyst Projected Mock|Alex Analyst Mock/i.test(mockSnap.text)) {
      failures.push('mock-draft-center@1365: analyst mock should live on Flash Brief, not Mock Draft Center');
    }
    const roundOptions = await desktop.evaluate(() => [...document.querySelectorAll('option')].map(option => option.textContent.trim()));
    if (!roundOptions.includes('1 round') || !roundOptions.includes('100 rounds')) {
      failures.push('mock-draft-center@1365: round picker does not expose full 1-100 range');
    }
    process.stdout.write('.');

    await clickTopDraftView(desktop, 'Follow Live Draft');
    await desktop.waitForFunction(() => /DraftCast|DRAFTCAST|LIVE SYNC SOURCE/.test(document.body.innerText), null, { timeout: 25000 });
    const liveSnap = await assertNoOverflow(desktop, 'live-draft@1365', failures);
    if (!/DraftCast|DRAFTCAST|LIVE SYNC SOURCE/.test(liveSnap.text)) {
      failures.push('live-draft@1365: missing live launch surface');
    }
    if (liveSnap.text.includes('FOLLOW SELECTED DRAFT')) {
      failures.push('live-draft@1365: one-click follow should not require a second follow button');
    }
    ['Draft Setup', 'AI GM STRATEGY STUDIO', 'MODEL TUNING', 'START MIRROR'].forEach(text => {
      if (liveSnap.text.includes(text)) failures.push(`live-draft@1365: picker-only screen leaked ${text}`);
    });
    if (!/No upcoming|upcoming|Live Sync|LIVE-SYNC|Sync confidence|Sleeper picks found|Mirrored in War Room/i.test(liveSnap.text)) {
      failures.push('live-draft@1365: missing real-league draft source state');
    }
    ['Alex Live Read', 'Manual Pick'].forEach(text => {
      if (!liveSnap.text.toLowerCase().includes(text.toLowerCase())) failures.push(`live-draft@1365: missing live command control ${text}`);
    });
    ['Sleeper Seen', 'Applied'].forEach(text => {
      if (liveSnap.text.includes(text)) failures.push(`live-draft@1365: old sync metric label still visible: ${text}`);
    });
    process.stdout.write('.');

    const mobile = await context.newPage();
    mobile.on('pageerror', err => failures.push(`mobile page error: ${err.message}`));
    await mobile.setViewportSize({ width: 390, height: 900 });
    await mobile.goto(`${baseUrl}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=draft`, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });
    await mobile.waitForFunction(() => document.body.innerText.includes('Draft'), null, { timeout: 25000 });
    await clickTopDraftView(mobile, 'Mock Draft Center');
    await mobile.waitForFunction(() => document.body.innerText.includes('Run mock drafts on desktop'), null, { timeout: 25000 });
    const mobileSnap = await assertNoOverflow(mobile, 'mock-draft-center@390', failures);
    ['Run mock drafts on desktop', 'START MOCK DRAFT'].forEach(text => {
      if (!mobileSnap.text.includes(text)) failures.push(`mock-draft-center@390: missing ${text}`);
    });
    process.stdout.write('.');

    await desktop.close();
    await mobile.close();
  } finally {
    await browser.close().catch(() => {});
    server.kill();
  }

  console.log(`\n${failures.length ? 'FAIL' : 'PASS'} draft browser QA - ${failures.length ? failures.length + ' issue(s)' : '5 checks'}`);
  if (failures.length) {
    failures.forEach(failure => console.log('  - ' + failure));
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

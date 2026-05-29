#!/usr/bin/env node
// Browser QA matrix for league-format skin behavior.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const REDRAFT_LEAGUE_ID = process.env.WARROOM_QA_REDRAFT_LEAGUE || '1356311207652360192';
const DYNASTY_LEAGUE_ID = process.env.WARROOM_QA_DYNASTY_LEAGUE || '1312100327931019264';
const USER = process.env.WARROOM_QA_USER || 'bigloco';
const BASE_PATH = process.env.WARROOM_QA_PATH || '/dist-preview/';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT_START = Number(process.env.WARROOM_LEAGUE_SKIN_QA_PORT || 3610);

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('SKIP league skin browser QA - @playwright/test is not installed. Run npm install first.');
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

async function skinSnapshot(page) {
  return page.evaluate(() => {
    const sectionButtons = title => {
      const heading = Array.from(document.querySelectorAll('div'))
        .find(el => String(el.textContent || '').trim() === title);
      if (!heading?.parentElement) return [];
      return Array.from(heading.parentElement.querySelectorAll('button'))
        .map(el => String(el.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean);
    };
    const skin = window.App?.LeagueSkin?.getCurrent?.() || null;
    return {
      skin,
      text: String(document.body?.innerText || ''),
      buttons: Array.from(document.querySelectorAll('button'))
        .filter(el => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(el => String(el.textContent || '').trim().replace(/\s+/g, ' '))
        .filter(Boolean),
      sections: {
        targetPositions: sectionButtons('Target Positions'),
        draftPickYears: sectionButtons('Draft Pick Years'),
      },
    };
  });
}

async function openLeaguePage(context, port, leagueId, expectedType, tab, options = {}) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1365, height: 900 });
  if (options.alexSubTab) {
    await page.addInitScript(subTab => {
      try { localStorage.setItem('wr_alex_subtab', subTab); } catch (_) {}
    }, options.alexSubTab);
  }
  const hashSuffix = options.hashSuffix || '';
  const url = `http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${leagueId}&tab=${tab}${hashSuffix}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction(type => {
    const skin = window.App?.LeagueSkin?.getCurrent?.();
    if (!skin || skin.type !== type) return false;
    const text = document.body?.innerText || '';
    return text.length > 80 && !text.includes('BUILDING LEAGUE INTELLIGENCE');
  }, expectedType, { timeout: 60000 });
  await page.waitForTimeout(400);
  return page;
}

function hasExact(labels, text) {
  return labels.some(label => label === text);
}

function textHas(snap, phrase) {
  return String(snap?.text || '').toLowerCase().includes(String(phrase || '').toLowerCase());
}

function pushIf(failures, condition, message) {
  if (condition) failures.push(message);
}

function assertSkin(failures, label, snap, expected) {
  const skin = snap.skin || {};
  pushIf(failures, skin.type !== expected.type, `${label}: expected skin type ${expected.type}, got ${skin.type || 'none'}`);
  pushIf(failures, skin.vocabulary?.appLabel !== 'Dynasty HQ War Room', `${label}: app brand changed to ${skin.vocabulary?.appLabel || 'none'}`);
  pushIf(failures, !!expected.phase && skin.phase !== expected.phase, `${label}: expected phase ${expected.phase}, got ${skin.phase || 'none'}`);
}

async function waitForModelSettings(page) {
  const hasSettings = () => {
    const text = String(document.body?.innerText || '').toLowerCase();
    return text.includes('target positions') && text.includes('draft pick years');
  };
  try {
    await page.waitForFunction(hasSettings, null, { timeout: 15000 });
  } catch (_err) {
    await page.evaluate(() => {
      try { localStorage.setItem('wr_alex_subtab', 'settings'); } catch (_) {}
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(hasSettings, null, { timeout: 60000 });
  }
  await page.waitForTimeout(200);
}

async function runMatrix(context, port, failures) {
  let page;

  page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', 'dashboard');
  let snap = await skinSnapshot(page);
  assertSkin(failures, 'redraft dashboard', snap, { type: 'redraft', phase: 'pre_draft' });
  pushIf(failures, !textHas(snap, 'redraft'), 'redraft dashboard: Redraft badge/text missing');
  pushIf(failures, !textHas(snap, 'pre-draft'), 'redraft dashboard: Pre-Draft phase missing');
  pushIf(failures, !snap.skin?.state?.isPreDraftRosterEmpty, 'redraft dashboard: pre-draft empty-roster state not active');
  await page.close();

  page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', 'myteam');
  snap = await skinSnapshot(page);
  assertSkin(failures, 'redraft myteam', snap, { type: 'redraft', phase: 'pre_draft' });
  pushIf(failures, snap.skin?.features?.showTaxi !== false, 'redraft myteam: showTaxi should be false');
  pushIf(failures, snap.skin?.features?.showIDP !== false, 'redraft myteam: showIDP should be false');
  pushIf(failures, snap.skin?.vocabulary?.valueLabel !== 'Format Value', 'redraft myteam: value label should be Format Value');
  pushIf(failures, hasExact(snap.buttons, 'Taxi'), 'redraft myteam: Taxi filter should not render');
  pushIf(failures, hasExact(snap.buttons, 'IDP'), 'redraft myteam: IDP filter should not render');
  await page.close();

  for (const tab of ['fa', 'trades']) {
    page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', tab);
    snap = await skinSnapshot(page);
    assertSkin(failures, `redraft ${tab}`, snap, { type: 'redraft', phase: 'pre_draft' });
    pushIf(failures, !textHas(snap, 'pre-draft mode'), `redraft ${tab}: pre-draft mode copy missing`);
    await page.close();
  }

  page = await openLeaguePage(context, port, REDRAFT_LEAGUE_ID, 'redraft', 'alex', { alexSubTab: 'settings' });
  await waitForModelSettings(page);
  snap = await skinSnapshot(page);
  const redraftPositionButtons = snap.sections?.targetPositions || [];
  const redraftYearButtons = snap.sections?.draftPickYears || [];
  ['QB', 'RB', 'WR', 'TE', 'K', 'D/ST'].forEach(pos => {
    pushIf(failures, !hasExact(redraftPositionButtons, pos), `redraft alex settings: ${pos} target chip missing`);
  });
  ['DL', 'LB', 'DB'].forEach(pos => {
    pushIf(failures, hasExact(redraftPositionButtons, pos), `redraft alex settings: ${pos} target chip should not render`);
  });
  pushIf(failures, redraftYearButtons.length !== 1, `redraft alex settings: expected one current-year draft chip, got ${redraftYearButtons.join(', ') || 'none'}`);
  await page.close();

  page = await openLeaguePage(context, port, DYNASTY_LEAGUE_ID, 'dynasty', 'dashboard');
  snap = await skinSnapshot(page);
  assertSkin(failures, 'dynasty dashboard', snap, { type: 'dynasty', phase: 'pre_draft' });
  pushIf(failures, !textHas(snap, 'dynasty'), 'dynasty dashboard: Dynasty badge/text missing');
  pushIf(failures, !textHas(snap, 'pre-draft'), 'dynasty dashboard: Pre-Draft phase missing');
  await page.close();

  page = await openLeaguePage(context, port, DYNASTY_LEAGUE_ID, 'dynasty', 'myteam');
  snap = await skinSnapshot(page);
  assertSkin(failures, 'dynasty myteam', snap, { type: 'dynasty', phase: 'pre_draft' });
  pushIf(failures, snap.skin?.features?.showTaxi !== true, 'dynasty myteam: showTaxi should be true');
  pushIf(failures, snap.skin?.features?.showIDP !== true, 'dynasty myteam: showIDP should be true');
  pushIf(failures, snap.skin?.vocabulary?.valueShortLabel !== 'DHQ', 'dynasty myteam: short value label should be DHQ');
  pushIf(failures, snap.skin?.vocabulary?.valueLabel !== 'DHQ Dynasty Value', 'dynasty myteam: value label should be DHQ Dynasty Value');
  await page.close();

  page = await openLeaguePage(context, port, DYNASTY_LEAGUE_ID, 'dynasty', 'alex', { alexSubTab: 'settings' });
  await waitForModelSettings(page);
  snap = await skinSnapshot(page);
  const dynastyPositionButtons = snap.sections?.targetPositions || [];
  const dynastyYearButtons = snap.sections?.draftPickYears || [];
  ['DL', 'LB', 'DB'].forEach(pos => {
    pushIf(failures, !hasExact(dynastyPositionButtons, pos), `dynasty alex settings: ${pos} target chip missing`);
  });
  pushIf(failures, dynastyYearButtons.length < 3, `dynasty alex settings: expected future draft-year chips, got ${dynastyYearButtons.join(', ') || 'none'}`);
  await page.close();
}

async function main() {
  if (!hasChrome()) {
    console.log(`SKIP league skin browser QA - Chrome not found at ${CHROME}`);
    return;
  }

  let port;
  try {
    port = await findOpenPort(PORT_START);
  } catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`SKIP league skin browser QA - local port binding is not permitted here (${err.code}).`);
      return;
    }
    throw err;
  }

  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const failures = [];

  try {
    const context = await browser.newContext();
    await context.addInitScript(() => {
      try { localStorage.setItem('wr_tutorial_done_v1', '1'); } catch (_) {}
    });
    await context.route('**/*', route => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media'].includes(type)) return route.abort();
      return route.continue();
    });
    await runMatrix(context, port, failures);
    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }

  if (failures.length) {
    console.log('\nLeague skin browser QA failures:');
    failures.forEach(failure => console.log(`  FAIL: ${failure}`));
    process.exit(1);
  }

  console.log('\nPASS league skin browser QA - redraft/dynasty product skin matrix');
}

main().catch(err => {
  console.error('League skin browser QA failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

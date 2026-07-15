#!/usr/bin/env node
// Live rank-consistency check: drives the preview build in a headless browser
// against a real dynasty league and confirms the ONE blended Power Score rank
// is byte-identical across every surface — engine truth, the command brief
// pecking-order line, the roster-pulse/elites badge, and the Power Rankings
// widget — and that it holds across a reload.
'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DYNASTY_LEAGUE_ID = process.env.WARROOM_QA_DYNASTY_LEAGUE || '1312100327931019264';
const USER = process.env.WARROOM_QA_USER || 'bigloco';
const BASE_PATH = process.env.WARROOM_QA_PATH || '/dist-preview/';
const CHROME = process.env.PLAYWRIGHT_CHROME_PATH || '/opt/pw-browsers/chromium';
const PORT_START = Number(process.env.WARROOM_RANK_QA_PORT || 3720);

let chromium;
try {
  chromium = require('@playwright/test').chromium;
} catch (_err) {
  console.log('SKIP rank consistency browser QA - @playwright/test is not installed.');
  process.exit(0);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// The headless browser can't reach external hosts directly through this
// sandbox's CONNECT-only egress proxy, but `curl` can (it honors HTTPS_PROXY
// + the system CA). So we transparently fulfill every Sleeper API request by
// curling it server-side and handing the real bytes back to the page. The app
// then runs its real assessment engine on real league data. Results are cached
// by URL in-process so the ~15MB /players/nfl payload is fetched at most once.
const _curlCache = new Map();
function curlBuffer(url) {
  if (_curlCache.has(url)) return _curlCache.get(url);
  const p = new Promise((resolve, reject) => {
    const proc = spawn('curl', ['-sS', '--max-time', '90', '--compressed', url], { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    proc.stdout.on('data', c => chunks.push(c));
    proc.stderr.on('data', c => { err += String(c); });
    proc.on('close', code => {
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new Error(`curl exit ${code} for ${url}: ${err.slice(0, 200)}`));
    });
    proc.on('error', reject);
  });
  _curlCache.set(url, p);
  return p;
}

function findOpenPort(start) {
  return new Promise((resolve, reject) => {
    const tryPort = port => {
      if (port >= 65536) return reject(new Error(`no open port from ${start}`));
      const server = net.createServer();
      server.once('error', err => {
        if (err && ['EACCES', 'EPERM'].includes(err.code)) reject(err);
        else tryPort(port + 1);
      });
      server.once('listening', () => server.close(() => resolve(port)));
      server.listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

async function startStaticServer(port) {
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-static.cjs'), '--host=127.0.0.1', `--port=${port}`], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let ready = false;
  proc.stdout.on('data', c => { if (String(c).includes('Serving')) ready = true; });
  for (let i = 0; i < 40; i++) { if (ready) return proc; await wait(250); }
  return proc;
}

async function openDashboard(context, port) {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1365, height: 1600 });
  const url = `http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${DYNASTY_LEAGUE_ID}&tab=dashboard`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  // Wait for league intelligence to finish building and the assessment engine
  // to be ready with a real powerRank for the user's roster.
  await page.waitForFunction(() => {
    const text = document.body?.innerText || '';
    if (text.includes('BUILDING LEAGUE INTELLIGENCE') || text.length < 120) return false;
    if (!window.App?.LI_LOADED) return false;
    if (typeof window.assessAllTeamsFromGlobal !== 'function') return false;
    const all = window.assessAllTeamsFromGlobal() || [];
    return all.length > 0 && all.some(a => (a.powerRank || 0) > 0);
  }, null, { timeout: 90000 });
  await page.waitForTimeout(600);
  return page;
}

// Pull the ground-truth rank from the engine + scrape what each surface renders.
async function snapshot(page) {
  return page.evaluate(() => {
    const out = { engine: null, brief: null, badge: null, widget: null, all: [] };
    const bodyText = document.body?.innerText || '';

    // 1) Engine truth
    try {
      const S = window.S || {};
      const myRosterId = S.myRosterId;
      const mine = typeof window.assessTeamFromGlobal === 'function'
        ? window.assessTeamFromGlobal(myRosterId) : null;
      out.myRosterId = myRosterId;
      out.engine = mine ? (mine.powerRank || null) : null;
      out.engineScore = mine ? (mine.powerScore || null) : null;
      const all = (typeof window.assessAllTeamsFromGlobal === 'function'
        ? window.assessAllTeamsFromGlobal() : []) || [];
      out.all = all.map(a => ({ rosterId: a.rosterId, powerRank: a.powerRank, powerScore: a.powerScore }));
      out.total = all.length;
    } catch (e) { out.engineErr = String(e); }

    // 2) Command brief pecking-order line: "You're #N in the league pecking order"
    const briefM = bodyText.match(/#(\d+)\s+in the league pecking order/i);
    out.brief = briefM ? Number(briefM[1]) : null;
    // Fallback brief phrasing: "Nth in the league" / "ranked Nth"
    if (out.brief == null) {
      const alt = bodyText.match(/(\d+)(?:st|nd|rd|th)\s+in the league/i);
      out.briefAlt = alt ? Number(alt[1]) : null;
    }

    // 3) Roster-pulse / elites badge: "#N of M" (You: ... #N of M)
    const badgeM = bodyText.match(/#(\d+)\s+of\s+(\d+)/i);
    out.badge = badgeM ? Number(badgeM[1]) : null;
    out.badgeTotal = badgeM ? Number(badgeM[2]) : null;

    return out;
  });
}

// Read the Power Rankings widget's rank two ways: (1) replicate the widget's
// blended-sort position for the user (the value the widget computes as myRank),
// and (2) scrape the number the widget actually painted, scoped to its own
// container so we don't pick up another surface's "#N".
async function widgetRank(page) {
  return page.evaluate(() => {
    const S = window.S || {};
    const myRosterId = S.myRosterId;
    const rosters = (S.currentLeague && S.currentLeague.rosters) || [];
    const myRoster = rosters.find(r => r.roster_id === myRosterId);
    const myOwnerId = myRoster && myRoster.owner_id;

    const all = (typeof window.assessAllTeamsFromGlobal === 'function'
      ? window.assessAllTeamsFromGlobal() : []) || [];
    // Same blended sort the widget uses (power-rankings.js): powerScore DESC,
    // totalDHQ DESC, rosterId ASC — its myRank is index+1 in this order.
    const blended = [...all].sort((a, b) => {
      if ((b.powerScore || 0) !== (a.powerScore || 0)) return (b.powerScore || 0) - (a.powerScore || 0);
      if ((b.totalDHQ || 0) !== (a.totalDHQ || 0)) return (b.totalDHQ || 0) - (a.totalDHQ || 0);
      return String(a.rosterId).localeCompare(String(b.rosterId));
    });
    const idxByOwner = blended.findIndex(t => t.ownerId === myOwnerId);
    const idxByRoster = blended.findIndex(t => t.rosterId === myRosterId);
    const widgetComputed = idxByOwner >= 0 ? idxByOwner + 1
      : (idxByRoster >= 0 ? idxByRoster + 1 : null);

    // Scrape the painted number, scoped to the widget whose header says
    // "Power Rankings". The user's rank renders as a big '#N' (power-rankings.js).
    let widgetDom = null;
    const heading = Array.from(document.querySelectorAll('*'))
      .find(el => /^power rankings$/i.test(String(el.textContent || '').trim()));
    if (heading) {
      let box = heading;
      for (let i = 0; i < 6 && box.parentElement; i++) box = box.parentElement;
      const m = String(box.innerText || '').match(/#(\d+)/);
      if (m) widgetDom = Number(m[1]);
    }
    return { myOwnerId, widgetComputed, widgetDom };
  });
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.log(`SKIP rank consistency browser QA - Chromium not found at ${CHROME}`);
    return;
  }
  let port;
  try { port = await findOpenPort(PORT_START); }
  catch (err) {
    if (err && ['EACCES', 'EPERM'].includes(err.code)) {
      console.log(`SKIP rank consistency browser QA - port binding not permitted (${err.code}).`);
      return;
    }
    throw err;
  }

  const server = await startStaticServer(port);
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
  const failures = [];
  const report = {};

  try {
    const context = await browser.newContext();
    await context.addInitScript(user => {
      try {
        localStorage.setItem('wr_tutorial_done_v1', '1');
        // Seed the Sleeper connection the hub reads (OD.getCurrentUsername →
        // od_auth_v1). Without this the app sits on the connect screen and never
        // fetches the league. This is exactly what the in-app CONNECT button writes.
        localStorage.setItem('od_auth_v1', JSON.stringify({ sleeperUsername: user }));
      } catch (_) {}
    }, USER);
    await context.route('**/*', async route => {
      const req = route.request();
      const url = req.url();
      // Local static server: serve directly.
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) return route.continue();
      let host = '';
      try { host = new URL(url).host; } catch (_) {}
      // Real Sleeper JSON data → transparently proxy via curl.
      if (host.includes('api.sleeper.app')) {
        try {
          const body = await curlBuffer(url);
          return route.fulfill({ status: 200, contentType: 'application/json', body });
        } catch (e) {
          return route.abort();
        }
      }
      // Everything else external (fonts, jsdelivr/Supabase CDN, avatars, images):
      // the app degrades gracefully without them, so drop to keep the run offline.
      return route.abort();
    });

    // Pass 1
    let page = await openDashboard(context, port);
    const s1 = await snapshot(page);
    const w1 = await widgetRank(page);
    report.pass1 = { ...s1, ...w1 };
    await page.screenshot({ path: path.join(ROOT, 'rank-consistency-pass1.png'), fullPage: true }).catch(() => {});

    const truth = s1.engine;
    const surfaces1 = { engine: s1.engine, brief: s1.brief ?? s1.briefAlt, badge: s1.badge, widget: w1.widgetComputed };
    Object.entries(surfaces1).forEach(([k, v]) => {
      if (v == null) failures.push(`pass1: ${k} rank not found on screen`);
      else if (truth != null && v !== truth) failures.push(`pass1: ${k}=${v} != engine ${truth}`);
    });
    if (w1.widgetDom != null && truth != null && w1.widgetDom !== truth) {
      failures.push(`pass1: widget painted #${w1.widgetDom} != engine ${truth}`);
    }
    await page.close();

    // Pass 2 — reload, confirm stability (same numbers, no swing)
    page = await openDashboard(context, port);
    const s2 = await snapshot(page);
    const w2 = await widgetRank(page);
    report.pass2 = { ...s2, ...w2 };

    const surfaces2 = { engine: s2.engine, brief: s2.brief ?? s2.briefAlt, badge: s2.badge, widget: w2.widgetComputed };
    Object.entries(surfaces2).forEach(([k, v]) => {
      if (v == null) failures.push(`pass2: ${k} rank not found on screen`);
      else if (s2.engine != null && v !== s2.engine) failures.push(`pass2: ${k}=${v} != engine ${s2.engine}`);
    });
    if (s1.engine != null && s2.engine != null && s1.engine !== s2.engine) {
      failures.push(`stability: engine rank swung ${s1.engine} -> ${s2.engine} across reload`);
    }
    await page.close();
    await context.close();
  } finally {
    await browser.close();
    server.kill();
  }

  console.log('\n=== RANK CONSISTENCY REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('\nPass 1 surfaces:', JSON.stringify({
    engine: report.pass1?.engine, brief: report.pass1?.brief ?? report.pass1?.briefAlt,
    badge: report.pass1?.badge, widget: report.pass1?.widgetComputed, widgetPainted: report.pass1?.widgetDom, total: report.pass1?.total,
  }));
  console.log('Pass 2 surfaces:', JSON.stringify({
    engine: report.pass2?.engine, brief: report.pass2?.brief ?? report.pass2?.briefAlt,
    badge: report.pass2?.badge, widget: report.pass2?.widgetComputed, widgetPainted: report.pass2?.widgetDom, total: report.pass2?.total,
  }));

  if (failures.length) {
    console.log('\nRANK CONSISTENCY FAILURES:');
    failures.forEach(f => console.log(`  FAIL: ${f}`));
    process.exit(1);
  }
  console.log('\nPASS rank consistency - one Power Score rank on every surface, stable across reload');
}

main().catch(err => {
  console.error('Rank consistency browser QA failed:', err && err.stack ? err.stack : err);
  process.exit(1);
});

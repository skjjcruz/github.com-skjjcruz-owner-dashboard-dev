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
// Phone floor (390/430), iPad mini portrait (744 — PHONE tier by ruling),
// iPad portrait (768 9.7", 810 10.2", 820 Air, 834 Pro 11", 1024 Pro 12.9"),
// iPad landscape (1180 + short-height variants), desktop (1365). Heights
// matter for the sidebar-scroll (F1) and tier-contract checks.
const SIZES = [
  { width: 390, height: 900 }, { width: 430, height: 900 },
  { width: 744, height: 1133 }, { width: 768, height: 900 },
  { width: 810, height: 1080 }, { width: 820, height: 900 },
  { width: 834, height: 900 }, { width: 1024, height: 768 },
  { width: 1180, height: 820 }, { width: 1365, height: 900 },
];
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
    for (const { width, height } of SIZES) {
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
    // One-row phone header (owner ruling 2026-07-09): at ≤767 the hamburger is
    // REMOVED (dock covers nav; Refresh lives in the header sheet) and the
    // compact .wr-phone-lhdr row renders instead. The drawer + hamburger remain
    // the contract for the 768-1023 tablet tier only.
    await page.locator('.wr-phone-lhdr').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});

    if (await page.locator('.wr-hamburger').count() !== 0) {
      failures.push('dashboard-shell@390: hamburger should not render on phone (one-row header)');
    }
    const phoneHdr = page.locator('.wr-phone-lhdr');
    if (await phoneHdr.count() !== 1) {
      failures.push('dashboard-shell@390: one-row phone header not found');
    } else {
      await phoneHdr.locator('[role="button"]').first().click({ timeout: 4000 }).catch(err => {
        failures.push(`dashboard-shell@390: phone header tap failed (${err.message})`);
      });
      await page.waitForTimeout(250);
      const sheet = await page.locator('.wr-sheet').count();
      if (sheet !== 1) failures.push('dashboard-shell@390: header league sheet did not open');
      const closeBtn = page.locator('.wr-sheet [aria-label="Close"]');
      if (await closeBtn.count()) await closeBtn.click({ timeout: 4000 }).catch(() => {});
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

    // ── iPad tier contracts (iPad pass, 2026-07-12) ──────────────────
    // 744×1133 (iPad mini portrait) = PHONE tier by ruling: one-row phone
    // header + dock, NO hamburger. 810×1080 (iPad 10.2 portrait) = tablet
    // drawer tier: hamburger present and CLEAR of the league title.
    {
      const mini = await context.newPage();
      await mini.setViewportSize({ width: 744, height: 1133 });
      await mini.addInitScript(u => {
        try { localStorage.setItem('wr_tutorial_done_v1', '1'); localStorage.setItem('dynastyhq_username', u); } catch (e) {}
      }, USER);
      await mini.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=dashboard`, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await mini.locator('.wr-phone-lhdr').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
      if (await mini.locator('.wr-hamburger').count() !== 0) failures.push('ipad-mini@744: hamburger should not render (phone tier by ruling)');
      if (await mini.locator('.wr-phone-lhdr').count() !== 1) failures.push('ipad-mini@744: one-row phone header not found');
      if (await mini.locator('.wr-phone-dock').count() !== 1) failures.push('ipad-mini@744: phone dock not found');
      await mini.close();
      checked++;
      process.stdout.write('.');

      const tab810 = await context.newPage();
      await tab810.setViewportSize({ width: 810, height: 1080 });
      await tab810.addInitScript(u => {
        try { localStorage.setItem('wr_tutorial_done_v1', '1'); localStorage.setItem('dynastyhq_username', u); } catch (e) {}
      }, USER);
      await tab810.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=dashboard`, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await tab810.locator('.wr-hamburger').waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
      const drawerSnap = await tab810.evaluate(() => {
        const ham = document.querySelector('.wr-hamburger');
        const row = document.querySelector('.wr-league-header-row');
        const title = document.querySelector('.wr-league-header-row .header-title') || row;
        return {
          ham: !!ham, dock: !!document.querySelector('.wr-phone-dock'),
          hamRect: ham ? ham.getBoundingClientRect().toJSON() : null,
          titleRect: title ? title.getBoundingClientRect().toJSON() : null,
          rowPadLeft: row ? parseFloat(getComputedStyle(row).paddingLeft) : -1,
        };
      });
      if (!drawerSnap.ham) failures.push('ipad-tablet@810: hamburger missing (drawer-tier contract)');
      if (drawerSnap.dock) failures.push('ipad-tablet@810: phone dock must not render at tablet tier');
      if (drawerSnap.rowPadLeft < 44) failures.push(`ipad-tablet@810: header row padding-left ${drawerSnap.rowPadLeft} < 44 (title clearance)`);
      if (drawerSnap.ham && drawerSnap.hamRect && drawerSnap.titleRect
        && drawerSnap.titleRect.left < drawerSnap.hamRect.right - 1
        && drawerSnap.titleRect.top < drawerSnap.hamRect.bottom
        && drawerSnap.titleRect.bottom > drawerSnap.hamRect.top) {
        failures.push(`ipad-tablet@810: league title intersects hamburger ${JSON.stringify({ ham: drawerSnap.hamRect, title: drawerSnap.titleRect })}`);
      }
      await tab810.close();
      checked++;
      process.stdout.write('.');
    }

    // ── Coarse-pointer pass (iPad pass, 2026-07-12) ──────────────────
    // isMobile+hasTouch makes Chromium report (pointer:coarse)+(hover:none),
    // so the iPad coarse block's rules are ASSERTED here, not just shipped.
    // env(safe-area-inset-*) is 0 in emulation — the --sat probe overrides
    // the token and asserts the plumbing moved the chrome by exactly 47px.
    {
      const coarseCtx = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 1180, height: 820 } });
      await coarseCtx.route('**/*', route => {
        const type = route.request().resourceType();
        if (['image', 'font', 'media'].includes(type)) return route.abort();
        return route.continue();
      });
      const cp = await coarseCtx.newPage();
      await cp.addInitScript(u => {
        try { localStorage.setItem('wr_tutorial_done_v1', '1'); localStorage.setItem('dynastyhq_username', u); } catch (e) {}
      }, USER);
      await cp.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=trades`, { waitUntil: 'domcontentloaded', timeout: 12000 });
      await cp.waitForTimeout(900);
      const coarseSnap = await cp.evaluate(() => {
        const out = {
          coarse: matchMedia('(hover: none) and (pointer: coarse)').matches,
          sidebarOverflow: (() => { const sb = document.querySelector('.wr-sidebar'); return sb ? getComputedStyle(sb).overflowY : 'missing'; })(),
        };
        const hdr = document.querySelector('header.header');
        const padBefore = hdr ? parseFloat(getComputedStyle(hdr).paddingTop) : -1;
        document.documentElement.style.setProperty('--sat', '47px');
        const padAfter = hdr ? parseFloat(getComputedStyle(hdr).paddingTop) : -1;
        out.satDelta = Math.round(padAfter - padBefore);
        document.documentElement.style.removeProperty('--sat');
        return out;
      });
      if (!coarseSnap.coarse) failures.push('coarse@1180: (hover:none)+(pointer:coarse) did not match under touch emulation');
      if (coarseSnap.sidebarOverflow !== 'auto') failures.push(`coarse@1180: .wr-sidebar overflow-y=${coarseSnap.sidebarOverflow}, expected auto (F1)`);
      if (coarseSnap.satDelta !== 47) failures.push(`coarse@1180: header --sat plumbing moved ${coarseSnap.satDelta}px, expected 47`);
      // Halo engagement: the 26px one-tap "+" must win taps 13px above its
      // visual box (44×44 ::after). Needs Deal HQ rows (Pro dev login).
      await cp.locator('.tc-dhq-add-btn').first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
      const haloHit = await cp.evaluate(() => {
        const btn = document.querySelector('.tc-dhq-add-btn');
        if (!btn) return 'no-btn';
        const r = btn.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + r.width / 2, r.top - 8);
        return el === btn || btn.contains(el) ? 'hit' : 'miss:' + (el ? el.className || el.tagName : 'null');
      });
      if (haloHit !== 'hit' && haloHit !== 'no-btn') failures.push(`coarse@1180: add-btn halo hit-test failed (${haloHit})`);
      if (haloHit === 'no-btn') console.log('\n  note: coarse add-btn probe skipped (no Deal HQ rows rendered)');
      await cp.close();
      await coarseCtx.close();
      checked++;
      process.stdout.write('.');
    }

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

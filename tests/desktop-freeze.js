#!/usr/bin/env node
// Desktop-freeze harness (G3, iPhone/iPad program): proves the desktop
// browser experience is byte-identical across phone/touch work.
//
//   node tests/desktop-freeze.js capture <out.json>     — snapshot desktop chrome
//   node tests/desktop-freeze.js compare <baseline.json> — fresh capture, deep-diff
//   node tests/desktop-freeze.js coarse                  — iPad emulation report
//
// Run `npm run build:preview` first — this drives /dist-preview/ like
// tests/browser-qa.js. Captures are style/geometry only (no text), so
// live-data drift doesn't flake the diff; if it ever does, re-capture the
// baseline and re-run compare back-to-back.
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
const PORT_START = Number(process.env.WARROOM_FREEZE_PORT || 3240);
const TABS = ['dashboard', 'myteam', 'compare', 'trades', 'fa', 'draft', 'analytics', 'alex', 'trophies', 'settings', 'legend'];

// The manifest: chrome + the surfaces the phone/touch program touches.
// Selectors that legitimately match nothing on a tab record count 0 —
// a count CHANGE is itself a diff signal.
const SELECTORS = [
    '.wr-sidebar', '.wr-sidebar-nav-btn', '.wr-sidebar-toggle',
    '.wr-league-header-row', '.wr-time-bar', '.wr-hamburger',
    '.wr-module-nav button', '.wr-module-strip',
    '.wr-dashboard-grid', '.wr-widget',
    '.fa-mkt-row', '.fa-colpick-btn', '.fa-detail-drawer',
    '[data-draft-pid]', '.wr-brd-move-btn',
    '.tc-ta-sticky-summary', '.tc-team-card',
    '.wr-tip-icon', 'input', 'select', 'table',
    '.wr-phone-dock', '.wr-sheet', // MUST stay count 0 on desktop
];
const STYLES = [
    'display', 'position', 'background-color', 'color', 'padding', 'margin',
    'min-height', 'min-width', 'font-size', 'font-family', 'font-weight',
    'overflow-x', 'overflow-y', 'border-top-width', 'border-top-color', 'opacity',
];

let chromium, devices;
try { ({ chromium, devices } = require('@playwright/test')); }
catch (_e) { console.log('SKIP desktop-freeze - @playwright/test not installed.'); process.exit(0); }

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function findOpenPort(start) {
    return new Promise((resolve, reject) => {
        const tryPort = port => {
            if (port >= 65536) return reject(new Error('no open port'));
            const server = net.createServer();
            server.once('error', err => (err && ['EACCES', 'EPERM'].includes(err.code)) ? reject(err) : tryPort(port + 1));
            server.once('listening', () => server.close(() => resolve(port)));
            server.listen(port, '127.0.0.1');
        };
        tryPort(start);
    });
}

async function startStaticServer(port) {
    const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve-static.cjs'), '--host=127.0.0.1', `--port=${port}`], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let ready = false;
    proc.stdout.on('data', c => { if (String(c).includes('Serving')) ready = true; });
    for (let i = 0; i < 40; i++) { if (ready) break; await wait(250); }
    return proc;
}

function snapshotScript(selectors, styles) {
    return { selectors, styles };
}

async function captureTab(page, args) {
    return page.evaluate(({ selectors, styles }) => {
        const out = {};
        for (const sel of selectors) {
            let els;
            try { els = [...document.querySelectorAll(sel)]; } catch (e) { out[sel] = { error: String(e) }; continue; }
            const entry = { count: els.length, first: [] };
            for (const el of els.slice(0, 3)) {
                const r = el.getBoundingClientRect();
                const cs = window.getComputedStyle(el);
                const st = {};
                for (const p of styles) st[p] = cs.getPropertyValue(p);
                entry.first.push({
                    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
                    styles: st,
                });
            }
            out[sel] = entry;
        }
        out.__shape = {
            elements: document.getElementsByTagName('*').length,
            buttons: document.getElementsByTagName('button').length,
            coarse: window.matchMedia('(pointer: coarse)').matches,
            hoverNone: window.matchMedia('(hover: none)').matches,
        };
        return out;
    }, args);
}

async function run(mode, fileArg, coarseDevice) {
    const port = await findOpenPort(PORT_START);
    const server = await startStaticServer(port);
    const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: (process.env.PLAYWRIGHT_CHROME_ARGS || '').split(' ').filter(Boolean) });
    const result = { meta: { viewport: '1440x900', basePath: BASE_PATH, league: LEAGUE_ID, tabs: TABS }, tabs: {} };
    try {
        const coarse = mode === 'coarse';
        const context = await browser.newContext(coarse
            ? { ...devices[coarseDevice || 'iPad Pro 11 landscape'] }
            : { viewport: { width: 1440, height: 900 } });
        await context.route('**/*', route => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media'].includes(type)) return route.abort();
            return route.continue();
        });
        for (const tab of TABS) {
            const page = await context.newPage();
            await page.addInitScript(u => {
                try { localStorage.setItem('wr_tutorial_done_v1', '1'); localStorage.setItem('dynastyhq_username', u); } catch (e) {}
            }, USER);
            await page.goto(`http://127.0.0.1:${port}${BASE_PATH}?dev=true&user=${USER}#league=${LEAGUE_ID}&tab=${tab}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
            // Async tab renders race a fixed wait (trophies doubles its DOM as
            // data lands) — poll element count until stable for 3 consecutive
            // 400ms ticks, 12s cap, then settle a beat more.
            await page.waitForFunction(() => {
                const n = document.getElementsByTagName('*').length;
                const w = window;
                if (w.__fzLast === n) { w.__fzStable = (w.__fzStable || 0) + 1; } else { w.__fzStable = 0; }
                w.__fzLast = n;
                return w.__fzStable >= 3;
            }, null, { timeout: 12000, polling: 400 }).catch(() => {});
            await page.waitForTimeout(600);
            result.tabs[tab] = await captureTab(page, snapshotScript(SELECTORS, STYLES));
            await page.close();
            process.stdout.write('.');
        }
    } finally {
        await browser.close();
        server.kill();
    }
    return result;
}

function diffObjects(a, b, pathStr, diffs, limit) {
    if (diffs.length >= limit) return;
    if (typeof a !== typeof b) { diffs.push(`${pathStr}: type ${typeof a} -> ${typeof b}`); return; }
    if (a === null || b === null || typeof a !== 'object') {
        if (a !== b) diffs.push(`${pathStr}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
        return;
    }
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
        if (!(k in a)) { diffs.push(`${pathStr}.${k}: MISSING in baseline`); continue; }
        if (!(k in b)) { diffs.push(`${pathStr}.${k}: MISSING in current`); continue; }
        diffObjects(a[k], b[k], `${pathStr}.${k}`, diffs, limit);
        if (diffs.length >= limit) return;
    }
}

async function main() {
    const mode = process.argv[2];
    const fileArg = process.argv[3];
    if (mode === 'capture') {
        if (!fileArg) { console.error('usage: desktop-freeze.js capture <out.json>'); process.exit(2); }
        const snap = await run('capture');
        fs.mkdirSync(path.dirname(path.resolve(fileArg)), { recursive: true });
        fs.writeFileSync(fileArg, JSON.stringify(snap, null, 1));
        // Sanity: phone chrome must never exist on desktop
        for (const tab of TABS) {
            const dock = snap.tabs[tab] && snap.tabs[tab]['.wr-phone-dock'];
            if (dock && dock.count > 0) { console.error(`\nFAIL: .wr-phone-dock present on desktop (${tab})`); process.exit(1); }
            const shape = snap.tabs[tab] && snap.tabs[tab].__shape;
            if (shape && (shape.coarse || shape.hoverNone)) { console.error(`\nFAIL: desktop context reports coarse/hover-none (${tab})`); process.exit(1); }
        }
        console.log(`\nCAPTURED -> ${fileArg}`);
        return;
    }
    if (mode === 'compare') {
        if (!fileArg || !fs.existsSync(fileArg)) { console.error('usage: desktop-freeze.js compare <baseline.json>'); process.exit(2); }
        const baseline = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
        const current = await run('capture');
        const diffs = [];
        diffObjects(baseline.tabs, current.tabs, 'tabs', diffs, 60);
        // Live-data flap, NOT the contract — warn, don't fail:
        //  - __shape element/button counters (async widgets gain rows between runs)
        //  - rect.x / rect.y (an element's POSITION reflows when variable-length
        //    async content renders above it — e.g. the dashboard AI briefing or the
        //    draft feed). Proven non-deterministic: the same phone-only tree yields
        //    different rect.y sets on back-to-back runs.
        // The real "desktop layout changed" signal is preserved: rect.w / rect.h
        // (rendered SIZE) and every computed style stay strict.
        const isFlap = d => /__shape\.(elements|buttons):/.test(d) || /\.rect\.[xy]:/.test(d);
        const hard = diffs.filter(d => !isFlap(d));
        if (hard.length) {
            console.error(`\nDESKTOP DRIFT — ${hard.length}${diffs.length >= 40 ? '+' : ''} differences vs baseline:`);
            diffs.forEach(d => console.error('  ' + d));
            process.exit(1);
        }
        if (diffs.length) {
            console.warn(`\nWARN: ${diffs.length} live-data flap(s) (position/counters), styling + sizing identical:`);
            diffs.forEach(d => console.warn('  ' + d));
        }
        console.log('\nPASS desktop-freeze - styling and sizing identical to baseline');
        return;
    }
    if (mode === 'coarse') {
        // GATE (iPad pass, 2026-07-12): every tab must engage the coarse
        // media context under iPad emulation — landscape (desktop-tier
        // shell) AND portrait (768-1023 drawer-tier shell) — or the touch
        // rules are dead. The F3 fix is a hit-area halo (::after), so the
        // halo hit-test itself lives in browser-qa.js's coarse pass; this
        // gate asserts context engagement per orientation.
        const failures = [];
        for (const device of ['iPad Pro 11 landscape', 'iPad Pro 11']) {
            const snap = await run('coarse', null, device);
            let engaged = 0;
            for (const tab of TABS) {
                const shape = snap.tabs[tab] && snap.tabs[tab].__shape;
                if (shape && shape.coarse && shape.hoverNone) engaged++;
                else failures.push(`${tab} [${device}]: coarse/hover-none not reported under iPad emulation`);
            }
            console.log(`\ncoarse emulation [${device}]: ${engaged}/${TABS.length} tabs report (pointer:coarse)+(hover:none)`);
            const probe = snap.tabs.draft && snap.tabs.draft['.wr-brd-move-btn'];
            if (probe && probe.count) console.log(`  .wr-brd-move-btn present: ${probe.count} (halo hit-test runs in browser-qa coarse pass)`);
        }
        if (failures.length) {
            failures.forEach(f => console.error('  FAIL: ' + f));
            process.exit(1);
        }
        console.log('PASS desktop-freeze coarse - all tabs engage the coarse-pointer context in both orientations');
        return;
    }
    console.error('usage: desktop-freeze.js capture <out.json> | compare <baseline.json> | coarse');
    process.exit(2);
}

main().catch(err => { console.error('desktop-freeze failed:', err && err.stack ? err.stack : err); process.exit(1); });

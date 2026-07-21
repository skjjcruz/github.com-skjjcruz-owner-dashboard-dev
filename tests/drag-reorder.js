// Functional contract for WR.dragReorderGrip (js/components/wr-primitives.js):
// real pointer drags — mouse AND synthesized touch — against the real engine
// source in a synthetic 8-row list. No app boot, no network: the fixture stubs
// React (the engine never calls it; only the kit's components do) and loads
// wr-primitives from source via setContent.
//
// Run: node tests/drag-reorder.js
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PRIMITIVES = fs.readFileSync(path.join(__dirname, '..', 'js', 'components', 'wr-primitives.js'), 'utf8');

const FIXTURE = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { margin: 0; font-family: monospace; background: #121217; color: #eee; }
  #list { height: 180px; overflow-y: auto; width: 320px; border: 1px solid #444; }
  .row { display: flex; align-items: center; gap: 8px; height: 40px; border-bottom: 1px solid #333; padding: 0 8px; }
  .grip { width: 20px; height: 28px; background: #2a2a33; color: #d4af37; border: 1px solid #555; }
</style></head><body>
<div id="list"></div>
<script>
  window.React = {
    createElement: function () { return null; },
    Fragment: {},
    useState: function (v) { return [v, function () {}]; },
    useEffect: function () {},
    useMemo: function (f) { return f(); },
    useRef: function (v) { return { current: v }; },
    useCallback: function (f) { return f; },
  };
<\/script>
<script>__PRIMITIVES__<\/script>
<script>
  const order = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  window.__drops = [];
  function render() {
    const list = document.getElementById('list');
    list.innerHTML = '';
    order.forEach((key) => {
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('data-reorder-key', key);
      const grip = document.createElement('button');
      grip.className = 'grip';
      grip.textContent = '≡';
      const props = window.WR.dragReorderGrip({
        key,
        onDrop: (dragKey, targetKey, after) => {
          window.__drops.push([dragKey, targetKey, after]);
          const from = order.indexOf(dragKey);
          order.splice(from, 1);
          const at = order.indexOf(targetKey);
          order.splice(after ? at + 1 : at, 0, dragKey);
          render();
        },
      });
      Object.keys(props).forEach((k) => {
        if (k === 'style') { Object.assign(grip.style, props[k]); return; }
        if (k.slice(0, 2) === 'on') grip.addEventListener(k.slice(2).toLowerCase(), props[k]);
      });
      const label = document.createElement('span');
      label.textContent = key;
      row.appendChild(grip);
      row.appendChild(label);
      list.appendChild(row);
    });
  }
  render();
  window.__order = order;
<\/script>
</body></html>`;

(async () => {
    // Same Chrome resolution as browser-qa.js / desktop-freeze.js so the
    // suite runs against a system Chrome instead of a Playwright download.
    const browser = await chromium.launch({
        executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined,
        args: (process.env.PLAYWRIGHT_CHROME_ARGS || '').split(' ').filter(Boolean),
    });
    let failures = 0, passed = 0;
    const check = (name, ok, detail) => {
        if (ok) { passed++; process.stdout.write('.'); }
        else { failures++; console.log('\nFAIL ' + name + (detail ? ' — ' + detail : '')); }
    };

    const boot = async (ctx) => {
        const page = await ctx.newPage();
        page.on('pageerror', (e) => { console.log('\nPAGEERROR: ' + e.message); failures++; });
        await page.setContent(FIXTURE.replace('__PRIMITIVES__', PRIMITIVES.replace(/<\/script>/g, '<\\/script>')), { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.WR && window.WR.dragReorderGrip && window.__order);
        return page;
    };

    const gripCenter = (page, key) => page.evaluate((k) => {
        const r = document.querySelector('[data-reorder-key="' + k + '"] .grip').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, key);
    const rowCenter = (page, key, half) => page.evaluate(({ k, half }) => {
        const r = document.querySelector('[data-reorder-key="' + k + '"]').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: half === 'top' ? r.top + r.height * 0.25 : r.top + r.height * 0.75 };
    }, { k: key, half });

    // ── Mouse-pointer drag: A onto D's lower half → after D ──
    {
        const ctx = await browser.newContext();
        const page = await boot(ctx);
        const from = await gripCenter(page, 'A');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 4, from.y + 30, { steps: 4 });
        const mid = await page.evaluate(() => ({
            ghosts: document.querySelectorAll('body > .row').length,
            srcOpacity: document.querySelector('[data-reorder-key="A"]').style.opacity,
        }));
        check('mouse: ghost clone during drag', mid.ghosts === 1, 'count=' + mid.ghosts);
        check('mouse: source row dims', mid.srcOpacity === '0.25', 'opacity=' + mid.srcOpacity);
        const to = await rowCenter(page, 'D', 'bottom');
        await page.mouse.move(to.x, to.y, { steps: 8 });
        const marked = await page.evaluate(() => document.querySelector('[data-reorder-key="D"]').style.boxShadow);
        check('mouse: insertion line on lower half', /inset 0 -2px/.test(marked), 'boxShadow=' + marked);
        await page.mouse.up();
        const after = await page.evaluate(() => ({
            order: window.__order.join(','),
            drops: window.__drops,
            ghosts: document.querySelectorAll('body > .row').length,
            shadows: Array.from(document.querySelectorAll('[data-reorder-key]')).map(r => r.style.boxShadow).filter(Boolean).length,
            dims: Array.from(document.querySelectorAll('[data-reorder-key]')).map(r => r.style.opacity).filter(o => o && o !== '1').length,
        }));
        check('mouse: commits A after D', after.order === 'B,C,D,A,E,F,G,H', 'order=' + after.order);
        check('mouse: onDrop(A,D,true)', JSON.stringify(after.drops) === JSON.stringify([['A', 'D', true]]), JSON.stringify(after.drops));
        check('mouse: ghost removed', after.ghosts === 0, 'count=' + after.ghosts);
        check('mouse: indicator + dim restored', after.shadows === 0 && after.dims === 0, 'shadows=' + after.shadows + ' dims=' + after.dims);
        await ctx.close();
    }

    // ── Touch-pointer drag: C onto A's upper half → before A ──
    // NOTE: hasTouch only (isMobile would rescale the layout viewport and CDP
    // coords would miss), touch id required, and the dragged row must be
    // INSIDE the 180px clip — a touch on a clipped row lands on HTML.
    {
        const ctx = await browser.newContext({ hasTouch: true, viewport: { width: 500, height: 400 } });
        const page = await boot(ctx);
        const from = await gripCenter(page, 'C');
        const to = await rowCenter(page, 'A', 'top');
        const cdp = await ctx.newCDPSession(page);
        const steps = 10;
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y, id: 1 }] });
        for (let i = 1; i <= steps; i++) {
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: from.x + (to.x - from.x) * (i / steps), y: from.y + (to.y - from.y) * (i / steps), id: 1 }],
            });
        }
        const midGhosts = await page.evaluate(() => document.querySelectorAll('body > .row').length);
        check('touch: ghost clone during drag', midGhosts === 1, 'count=' + midGhosts);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        const after = await page.evaluate(() => ({ order: window.__order.join(','), drops: window.__drops, ghosts: document.querySelectorAll('body > .row').length }));
        check('touch: commits C before A', after.order === 'C,A,B,D,E,F,G,H', 'order=' + after.order);
        check('touch: onDrop(C,A,false)', JSON.stringify(after.drops) === JSON.stringify([['C', 'A', false]]), JSON.stringify(after.drops));
        check('touch: ghost removed', after.ghosts === 0, 'count=' + after.ghosts);
        await ctx.close();
    }

    // ── Edge auto-scroll: hold near the list's bottom edge → container scrolls ──
    {
        const ctx = await browser.newContext();
        const page = await boot(ctx);
        const from = await gripCenter(page, 'A');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        const box = await page.evaluate(() => {
            const r = document.getElementById('list').getBoundingClientRect();
            return { x: r.left + r.width / 2, yEdge: r.bottom - 12 };
        });
        await page.mouse.move(box.x, box.yEdge, { steps: 6 });
        await page.waitForTimeout(450);
        const scrolled = await page.evaluate(() => document.getElementById('list').scrollTop);
        check('autoscroll near bottom edge', scrolled > 20, 'scrollTop=' + scrolled);
        await page.mouse.up();
        await ctx.close();
    }

    // ── No-op: press + tiny jiggle + release commits nothing, changes nothing ──
    {
        const ctx = await browser.newContext();
        const page = await boot(ctx);
        const from = await gripCenter(page, 'C');
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(from.x + 2, from.y + 2);
        await page.mouse.up();
        const after = await page.evaluate(() => ({ order: window.__order.join(','), drops: window.__drops }));
        check('tiny jiggle is a no-op', after.order === 'A,B,C,D,E,F,G,H' && after.drops.length === 0, 'order=' + after.order);
        await ctx.close();
    }

    await browser.close();
    if (failures === 0) console.log('\nPASS drag-reorder - ' + passed + ' passed, 0 failed');
    else console.log('\nFAIL drag-reorder - ' + passed + ' passed, ' + failures + ' failed');
    process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });

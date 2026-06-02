#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// scripts/lightmode-codemod.cjs
//
// Variabilizes hardcoded color literals across the War Room module JS so
// the app can theme cleanly. Every replacement keeps the EXACT original
// value as a CSS var() fallback, which means:
//   - Dark mode is byte-identical (fallback == original, even if theme.js
//     never runs or hasn't loaded yet).
//   - Light mode only needs to override the vars in one place (theme.js).
//
// Categories:
//   #RRGGBB / #RGB            -> var(--k-RRGGBB, #RRGGBB)
//   rgba(255,255,255,a)       -> var(--ov-N,  <original>)   (surface overlays)
//   rgba(212,175,55,a)        -> var(--acc-X, <original>)   (gold accent tints/lines)
//
// Left untouched on purpose:
//   rgba(0,0,0,a)             scrims / shadows read fine on both themes
//   rgba(<accent>,a) tints    translucent status fills stay legible on light
//   SVG fill="..."/stroke=""  presentation attributes don't resolve var()
//
// Usage:
//   node scripts/lightmode-codemod.cjs --dry      (report only)
//   node scripts/lightmode-codemod.cjs            (write + emit manifest)
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

// ── Collect target files: js/**/*.js minus theme/landing (theme.js owns
//    the var definitions; landing pages are standalone marketing). ──────
function walk(dir) {
    const out = [];
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) out.push(...walk(p));
        else if (ent.name.endsWith('.js')) out.push(p);
    }
    return out;
}
const SKIP = new Set(['theme.js', 'landing-content.js', 'landing-editor.js']);
const FILES = walk(JS_DIR).filter(f => !SKIP.has(path.basename(f)));

// ── Bucketing ────────────────────────────────────────────────────────
// White-overlay alpha -> elevation bucket (centers chosen on the observed
// alpha peaks: .02 .03 .04 .06 .08 .10 then stronger fills/dividers/text).
function ovBucket(a) {
    if (a <= 0.024) return 1;
    if (a <= 0.034) return 2;
    if (a <= 0.05)  return 3;
    if (a <= 0.07)  return 4;
    if (a <= 0.095) return 5;
    if (a <= 0.16)  return 6;
    if (a <= 0.26)  return 7;
    if (a <= 0.45)  return 8;
    return 9;
}
// Gold-overlay alpha -> tint(fill) vs line(border) buckets.
function accBucket(a) {
    if (a <= 0.07)  return 'fill1';
    if (a <= 0.13)  return 'fill2';
    if (a <= 0.18)  return 'fill3';
    if (a <= 0.27)  return 'line1';
    if (a <= 0.37)  return 'line2';
    if (a <= 0.5)   return 'line3';
    return 'line4';
}

// Dark tinted panel surfaces -> opaque(solid) vs translucent(veil).
// Pure black rgba(0,0,0,a) is intentionally excluded: black scrims behind
// modals/dropdowns stay dark in light mode too (standard practice).
function surfBucket(a) { return a >= 0.5 ? 'solid' : 'veil'; }

const manifest = { hex: new Set(), ov: new Set(), acc: new Set(), surf: new Set() };
let totals = { hex: 0, ov: 0, acc: 0, surf: 0, alpha: 0, files: 0 };

function expandHex(h) {
    h = h.toLowerCase();
    if (h.length === 3) return h.split('').map(c => c + c).join('');
    return h;
}

// Is the match at `idx` the value of an SVG fill=/stroke= presentation
// attribute? Those can't take var(), so skip them.
function isSvgAttr(src, idx) {
    const pre = src.slice(Math.max(0, idx - 10), idx);
    return /(fill|stroke)=["']$/.test(pre);
}

function processFile(file) {
    let src = fs.readFileSync(file, 'utf8');
    const before = src;
    let nHex = 0, nOv = 0, nAcc = 0, nSurf = 0, nAlpha = 0;

    // 0) Alpha-suffix concatenation: `someColor + '22'` builds an 8-digit
    //    hex (#RRGGBBAA). That only works while someColor is a raw hex, so it
    //    would break the moment its source hex becomes var(). Rewrite to the
    //    runtime helper wrAlpha(color, 'HH'), which resolves hex OR var() to
    //    concrete rgb then applies the alpha — identical in dark, themed in
    //    light. LHS is a color identifier / member / computed-member access.
    src = src.replace(
        /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\?\.[A-Za-z_$][\w$]*|\[[^\]\n]+\])*)\s*\+\s*(['"])([0-9a-fA-F]{2})\2/g,
        (m, expr, q, hh) => {
            // Only color-bearing identifiers (guards against numeric string
            // concatenation that happens to end in two hex-ish digits). Every
            // real color LHS either contains "col" (color/Color/POS_COLORS/
            // labelCol/...) or ends in c/C (c, tierC).
            if (!/col/i.test(expr) && !/c$/i.test(expr)) return m;
            nAlpha++;
            return `wrAlpha(${expr}, '${hh}')`;
        });

    // 1) Hex literals (#RGB or #RRGGBB). Must be a self-contained token:
    //    preceded by a quote/space/(/:/, and followed by quote/;/space/)/,
    //    so we never bite into IDs or already-wrapped fallbacks.
    src = src.replace(/(^|[\s'"(:,>])#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g,
        (m, lead, hex, off) => {
            const idx = off + lead.length; // position of '#'
            if (isSvgAttr(src, idx)) return m;
            const key = expandHex(hex);
            manifest.hex.add(key);
            nHex++;
            return `${lead}var(--k-${key}, #${key})`;
        });

    // 2) White-surface overlays -> elevation buckets.
    src = src.replace(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9]*\.?[0-9]+)\s*\)/g,
        (m, a) => {
            const b = ovBucket(parseFloat(a));
            manifest.ov.add(b);
            nOv++;
            return `var(--ov-${b}, ${m})`;
        });

    // 3) Gold accent overlays -> tint/line buckets.
    src = src.replace(/rgba\(\s*212\s*,\s*175\s*,\s*55\s*,\s*([0-9]*\.?[0-9]+)\s*\)/g,
        (m, a) => {
            const b = accBucket(parseFloat(a));
            manifest.acc.add(b);
            nAcc++;
            return `var(--acc-${b}, ${m})`;
        });

    // 4) Dark tinted panel surfaces (all channels < 60, not pure black).
    src = src.replace(/rgba\(\s*([0-9]{1,2})\s*,\s*([0-9]{1,2})\s*,\s*([0-9]{1,2})\s*,\s*([0-9]*\.?[0-9]+)\s*\)/g,
        (m, r, g, b, a) => {
            if (r === '0' && g === '0' && b === '0') return m; // keep black scrims
            const bucket = surfBucket(parseFloat(a));
            manifest.surf.add(bucket);
            nSurf++;
            return `var(--surf-${bucket}, ${m})`;
        });

    totals.hex += nHex; totals.ov += nOv; totals.acc += nAcc; totals.surf += nSurf; totals.alpha += nAlpha;
    if (src !== before) {
        totals.files++;
        if (!DRY) fs.writeFileSync(file, src);
        const rel = path.relative(ROOT, file);
        if (nHex + nOv + nAcc + nSurf + nAlpha > 0)
            console.log(`  ${rel.padEnd(40)} hex:${nHex} ov:${nOv} acc:${nAcc} surf:${nSurf} alpha:${nAlpha}`);
    }
}

console.log(`${DRY ? '[DRY RUN] ' : ''}Processing ${FILES.length} files...\n`);
FILES.forEach(processFile);

console.log(`\nTotals: hex=${totals.hex} overlay=${totals.ov} gold=${totals.acc} surf=${totals.surf} alpha=${totals.alpha}  (${totals.files} files changed)`);
console.log(`Distinct hex keys: ${manifest.hex.size}`);
console.log(`Overlay buckets:   ${[...manifest.ov].sort().join(', ')}`);
console.log(`Gold buckets:      ${[...manifest.acc].sort().join(', ')}`);
console.log(`Surface buckets:   ${[...manifest.surf].sort().join(', ')}`);

// Emit manifest so theme.js generation references exactly what exists.
const manifestPath = path.join(ROOT, 'scripts', 'lightmode-manifest.json');
const out = {
    hex: [...manifest.hex].sort(),
    ov: [...manifest.ov].sort(),
    acc: [...manifest.acc].sort(),
    surf: [...manifest.surf].sort(),
};
if (!DRY) fs.writeFileSync(manifestPath, JSON.stringify(out, null, 2));
console.log(`\nManifest ${DRY ? '(not written) ' : 'written to ' + path.relative(ROOT, manifestPath)}`);
if (DRY) console.log(JSON.stringify(out, null, 2));

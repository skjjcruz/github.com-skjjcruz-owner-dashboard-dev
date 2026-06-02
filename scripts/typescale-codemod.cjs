#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════
// scripts/typescale-codemod.cjs
//
// Migrates hardcoded font-size literals across the War Room module JS
// onto the semantic type-scale tokens defined in index.html :root, so the
// four named tiers actually render at their target sizes app-wide:
//
//     --text-hero   32px   main headline
//     --text-title  18px   section headers
//     --text-heading/body  16px   card titles / body text
//     --text-label  12px   captions / metadata
//     --text-micro  11px   dense-data floor
//
// The app today has ~2,000 inline `fontSize: '0.6rem'`-style literals that
// bypass the scale entirely and cluster at 8-13px — that is why everything
// reads small. This rewrites them to `var(--text-TIER, <target>)`:
//   - The fallback is the TARGET size, not the original, so text grows even
//     before theme tokens resolve, and the token stays the single knob.
//
// Guard rails (the complaint is "too small", so we only ever GROW):
//   - NEVER shrink: any literal already >= 16px is left untouched. Headlines,
//     stat numbers and hero text keep their intended size.
//   - DENSE files (draft boards, trade panels, compact fixed-height widgets)
//     are floored at --text-micro (11px) instead of jumping to 16px, so the
//     dense tables the iPad audit flags do not reflow.
//   - Skips anything already wrapped (var/clamp/calc) or non-literal
//     (fontSize: someVar), and unitless / em values (em is parent-relative).
//
// Categories (px-equiv at 16px root):
//   normal  <12px   -> var(--text-label, 0.75rem)   [caption/label soup -> 12]
//   normal  12-15px -> var(--text-body,  1rem)       [body -> 16]
//   dense   <11px   -> var(--text-micro, 0.6875rem)  [illegible -> 11 floor]
//   dense   11-15px -> left untouched                [keep table density]
//   any     >=16px  -> left untouched                [never shrink]
//
// Usage:
//   node scripts/typescale-codemod.cjs --dry      (report only)
//   node scripts/typescale-codemod.cjs            (write + emit manifest)
// ════════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

const DRY = process.argv.includes('--dry');
const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

// ── Target files: js/**/*.js minus theme/landing (theme.js owns token defs;
//    landing pages are standalone marketing). ──────────────────────────
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

// ── Dense-data surfaces: intentionally compact tables / boards / fixed
//    tiles. Per the iPad UI audit these are the reflow-regression risks, so
//    here we only floor their illegible sub-11px text and never push cells
//    up to 16px. (Mixed files like my-team keep their roster table dense;
//    the verification pass promotes their genuine body copy by hand.) ────
const DENSE = new Set([
    // Draft experience — live board, big board, analytics, trade tooling
    'command-center.js', 'big-board.js', 'live-analytics.js',
    'draft-room.js', 'trade-proposer.js', 'mock-draft.js',
    // Trade calculator panels
    'trade-calc.js',
    // Compact / fixed-height dashboard widgets
    'power-rankings.js', 'competitive-tiers.js', 'roster-pulse.js',
    'player-tags.js', 'market-radar.js', 'league-landscape.js',
    'draft-capital.js', 'my-trophies.js',
    // Dense tabular tabs
    'my-team.js', 'compare.js', 'trophy-room.js', 'league-map.js',
]);

// ── Value -> px (root = 16px). Returns null for forms we must not touch. ─
function toPx(numStr, unit) {
    const n = parseFloat(numStr);
    if (!isFinite(n)) return null;
    if (unit === 'px') return n;
    if (unit === 'rem') return n * 16;
    return null; // em is parent-relative; unitless is ambiguous — skip both
}

// ── Bucket -> [tokenName, targetRem] or null (= leave untouched). ───────
function bucket(px, dense) {
    if (px >= 16) return null;                       // never shrink
    if (dense) {
        if (px < 11) return ['text-micro', '0.6875rem'];  // illegible -> 11
        return null;                                       // keep 11-15 dense
    }
    if (px < 12) return ['text-label', '0.75rem'];   // caption soup -> 12
    return ['text-body', '1rem'];                    // body -> 16
}

const manifest = {}; // tokenName -> count
let totals = { hits: 0, files: 0, skippedWrapped: 0 };

function processFile(file) {
    let src = fs.readFileSync(file, 'utf8');
    const before = src;
    const dense = DENSE.has(path.basename(file));
    let n = 0;

    // Matches both JS object styles and CSS-string declarations:
    //   fontSize: '0.72rem'   fontSize:"13px"   font-size: 0.62rem;
    // Captures: key (fontSize|font-size), opening quote (optional), number, unit.
    // The value must be a bare number+unit — a leading [^'"`]*var/clamp/calc
    // inside the quotes is excluded by the strict [number][unit] capture.
    const RE = /(fontSize|font-size)(\s*:\s*)(['"`]?)(\d+(?:\.\d+)?)(px|rem|em)\3/g;

    src = src.replace(RE, (m, key, sep, q, num, unit) => {
        const px = toPx(num, unit);
        if (px === null) return m;
        const b = bucket(px, dense);
        if (!b) return m;
        const [token, target] = b;
        manifest[token] = (manifest[token] || 0) + 1;
        n++;
        // Preserve the original quoting EXACTLY. `fontSize:` (JS) values are
        // always quoted strings; `font-size:` (CSS declaration, e.g. inside a
        // `console.log('%c…')` style string or <style>) is bare. Re-quoting a
        // bare CSS value would inject quotes into the surrounding JS string and
        // break it — so emit the var() with the same quote char we captured (q
        // is '' for the bare CSS form).
        return `${key}${sep}${q}var(--${token}, ${target})${q}`;
    });

    totals.hits += n;
    if (src !== before) {
        totals.files++;
        if (!DRY) fs.writeFileSync(file, src);
        console.log(`  ${path.relative(ROOT, file).padEnd(42)} ${n} bumped${dense ? '  [dense floor]' : ''}`);
    }
}

console.log(`${DRY ? '[DRY RUN] ' : ''}Processing ${FILES.length} files...\n`);
FILES.forEach(processFile);

console.log(`\nTotals: ${totals.hits} literals migrated across ${totals.files} files`);
console.log('By token:');
for (const [t, c] of Object.entries(manifest).sort((a, b) => b[1] - a[1])) {
    console.log(`  --${t.padEnd(12)} ${c}`);
}

const manifestPath = path.join(ROOT, 'scripts', 'typescale-manifest.json');
if (!DRY) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`\nManifest ${DRY ? '(not written)' : 'written to ' + path.relative(ROOT, manifestPath)}`);

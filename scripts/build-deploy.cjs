#!/usr/bin/env node
// build-deploy.cjs — Precompile in-browser Babel (type="text/babel") scripts to
// plain JS for the GitHub Pages deploy, so production never downloads ~3.1MB of
// @babel/standalone or transforms ~3MB of JSX in the browser on every cold load.
//
// Difference vs scripts/build-preview.cjs: that script targets a nested
// dist-preview/ directory and rewrites every asset path with `../`. This one
// emits a *flat overlay* rooted at the repo root, so the deploy workflow can copy
// the normal source tree into the Pages artifact and then drop this on top:
//
//   dist-deploy/<entry>.html  — @babel/standalone tag removed, type="text/babel" stripped
//   dist-deploy/js/...        — compiled plain-JS versions of the JSX sources
//
// Uses the same Babel preset/options as build-preview.cjs so the emitted code is
// identical to what the regression/browser test suites already validate.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Babel = require('@babel/standalone');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'dist-deploy');

// Every HTML entry point that loads @babel/standalone + type="text/babel" scripts.
const ENTRIES = ['index.html', 'draft-warroom.html', 'free-agency.html', 'trade-calculator.html'];

const compiled = new Set(); // source pathnames already compiled (dedupe across entries)
const assetHash = new Map(); // pathname -> content hash of the compiled output
let compiledCount = 0;

function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }

// Short content hash for cache-busting. Derived from the *compiled* output, so
// the ?v= changes exactly when a module's shipped bytes change — no manual bumps.
function contentHash(str) {
  return crypto.createHash('sha256').update(str).digest('hex').slice(0, 10);
}

function transform(code, filename) {
  return Babel.transform(code, {
    filename,
    presets: [['react', { runtime: 'classic' }]],
    sourceType: 'script',
    sourceMaps: false,
    comments: false,
  }).code;
}

function compileExternal(src) {
  const pathname = src.split('?')[0];
  const inputPath = path.join(ROOT, pathname);
  if (!fs.existsSync(inputPath)) throw new Error(`Missing Babel source: ${src} (${inputPath})`);
  if (compiled.has(pathname)) return;
  const out = path.join(OUT_DIR, pathname);
  ensureDir(path.dirname(out));
  const code = transform(fs.readFileSync(inputPath, 'utf8'), pathname) + '\n';
  fs.writeFileSync(out, code, 'utf8');
  assetHash.set(pathname, contentHash(code));
  compiled.add(pathname);
  compiledCount++;
}

function processEntry(entry) {
  const inPath = path.join(ROOT, entry);
  if (!fs.existsSync(inPath)) { console.warn(`[build-deploy] skip missing entry: ${entry}`); return; }
  let html = fs.readFileSync(inPath, 'utf8');
  let entryExternal = 0;

  // 1. Remove the @babel/standalone <script> tag entirely.
  html = html.replace(
    /[ \t]*<script[^>]+src=["'][^"']*@babel\/standalone[^"']*["'][^>]*><\/script>\s*\n?/gi,
    '',
  );

  // 2. Rewrite every type="text/babel" script. External (has src): compile the
  //    source and strip the type attribute, keeping the same src so the compiled
  //    overlay file loads as a plain classic script. Inline: compile the body.
  const re = /<script\b([^>]*?)\btype=["']text\/babel["']([^>]*?)>([\s\S]*?)<\/script>/gi;
  html = html.replace(re, (match, before, after, body) => {
    const attrs = (before + after).replace(/\s+/g, ' ').trim();
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) {
      compileExternal(srcMatch[1]);
      entryExternal++;
      return `<script ${attrs}></script>`;
    }
    // inline JSX block
    return `<script${attrs ? ' ' + attrs : ''}>${transform(body, entry + ' (inline)')}</script>`;
  });

  // 3. Refresh the boot guard: it polled for asynchronous in-browser Babel, which
  //    no longer runs now that modules are precompiled plain JS. (index.html only.)
  html = html.replace(
    /\/\/ NON-JSX BOOTSTRAP:[\s\S]*?window\.addEventListener\('DOMContentLoaded', function\(\) \{ setTimeout\(check, 500\); \}\);\n\}\)\(\);/,
    `// PRECOMPILED BOOTSTRAP: modules are plain JS (no in-browser Babel). Verify they loaded.
(function() {
  window.addEventListener('DOMContentLoaded', function() {
    if (typeof OwnerDashboard !== 'undefined') return;
    document.getElementById('root').innerHTML = '<div style="color:#E74C3C;padding:40px;text-align:center;font-family:sans-serif"><h2>Module Load Error</h2><p>War Room modules failed to load. Try a hard refresh (Cmd+Shift+R) or check the console.</p></div>';
  });
})();`,
  );

  // 4. Content-hash cache-bust EVERY local script's ?v= — compiled JSX modules
  //    (hash of the emitted output) and raw plain-JS modules (hash of the source)
  //    alike — so a stale or missing hand-maintained ?v= can never pin an old
  //    module after a deploy. External / CDN URLs are left untouched.
  html = html.replace(/<script\b([^>]*?)\bsrc=(["'])([^"']+)\2([^>]*)>/gi, (m, before, q, src, after) => {
    if (/^(https?:)?\/\//i.test(src)) return m; // external/CDN — leave as-is
    const pathname = src.split('?')[0];
    let hash = assetHash.get(pathname); // compiled JSX module → hash of emitted output
    if (!hash) {
      const rawPath = path.join(ROOT, pathname);
      if (!fs.existsSync(rawPath)) return m; // unknown local asset — leave as-is
      hash = contentHash(fs.readFileSync(rawPath));
    }
    return `<script${before}src=${q}${pathname}?v=${hash}${q}${after}>`;
  });

  // Safety net: the deploy must ship NO in-browser Babel (match real script tags,
  // not the word "text/babel" appearing inside a comment/string).
  if (/<script\b[^>]*\btype=["']text\/babel["']/i.test(html)) {
    throw new Error(`${entry}: residual <script type="text/babel"> after rewrite`);
  }
  if (/@babel\/standalone/i.test(html)) {
    throw new Error(`${entry}: @babel/standalone reference survived`);
  }

  ensureDir(OUT_DIR);
  fs.writeFileSync(path.join(OUT_DIR, entry), html, 'utf8');
  console.log(`[build-deploy]   ${entry}: rewrote ${entryExternal} external babel scripts`);
}

function build() {
  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  ensureDir(OUT_DIR);
  for (const e of ENTRIES) processEntry(e);
  console.log(`[build-deploy] compiled ${compiledCount} unique Babel sources across ${ENTRIES.length} entries -> ${path.relative(ROOT, OUT_DIR)}/`);
}

try {
  build();
} catch (err) {
  console.error('[build-deploy] failed:', err && err.message ? err.message : err);
  process.exit(1);
}

#!/usr/bin/env node
// Rookie/prospect data contract guardrails.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function resolveRookieDataRoot() {
  const sharedSource = process.env.RECONAI_SHARED_SOURCE;
  const candidates = [
    sharedSource && path.resolve(sharedSource, '..'),
    path.resolve(ROOT, '..', 'reconai'),
    path.resolve(ROOT, 'reconai-shared'),
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(path.join(candidate, 'shared', 'rookie-data.js')))
    || candidates.find(candidate => fs.existsSync(path.join(candidate, 'rookie-data.js')))
    || null;
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failed++;
    failures.push(`  FAIL: ${name}\n        ${err.message}`);
    process.stdout.write('F');
  }
}

function group(label) {
  process.stdout.write(`\n  ${label}  `);
}

function ok(value, label) {
  if (!value) throw new Error(label || 'expected truthy value');
}

function read(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

console.log('\nRookie data contract tests');

const rookieDataRoot = resolveRookieDataRoot();
if (!rookieDataRoot) {
  throw new Error('Unable to locate canonical rookie-data.js from RECONAI_SHARED_SOURCE, ../reconai, or reconai-shared/');
}
const rookieSharedPath = fs.existsSync(path.join(rookieDataRoot, 'shared', 'rookie-data.js'))
  ? path.join(rookieDataRoot, 'shared', 'rookie-data.js')
  : path.join(rookieDataRoot, 'rookie-data.js');
const rookieShared = fs.readFileSync(rookieSharedPath, 'utf8');
const scouting = read(ROOT, 'js/draft/scouting.js');
const draftState = read(ROOT, 'js/draft/state.js');
const csvLoader = read(ROOT, 'draft-war-room/csv-loader.js');
const sharedLoader = read(ROOT, 'js/shared/shared-loader.js');
const rootIndex = read(ROOT, 'index.html');
const standalonePages = [
  'draft-warroom.html',
  'free-agency.html',
  'trade-calculator.html',
  'draft-war-room/index.html',
  'draft-war-room/player-detail.html',
];

group('canonical provider');

test('ReconAI rookie-data owns consensus, draft-capital, and synthesis logic', () => {
  [
    'rankToTierBase',
    'pickToBase',
    'mergeSyntheticProspects',
    'draftCapitalValue',
    'baseDynastyValue',
    'rookiePosRank',
    'window.RookieData',
  ].forEach(fragment => ok(rookieShared.includes(fragment), `missing ${fragment}`));
});

test('War Room draft scouting delegates to rookie-data instead of fetching CSVs directly', () => {
  ok(scouting.includes('War Room adapter over ReconAI/shared/rookie-data.js'), 'adapter banner missing');
  ok(scouting.includes('window.RookieData?.loadRookieProspects'), 'shared load delegate missing');
  ok(scouting.includes("source: 'rookie-data'"), 'adapter source marker missing');
  ok(!/fetch\s*\(/.test(scouting), 'draft/scouting.js should not fetch its own CSV files');
  ok(!/calculateTier|calculateGrade|rankToTierBase|pickToBase/.test(scouting), 'draft/scouting.js should not own scoring logic');
});

test('War Room draft state does not rescale rookie scores locally', () => {
  ok(draftState.includes('resolvePlayerDhq'), 'draft state value resolver missing');
  ok(draftState.includes('RookieData.findProspect'), 'draft state should consult canonical rookie-data');
  ok(!/draftScore\s*\*\s*1000/.test(draftState), 'draft state should not rescale draftScore into DHQ');
});

test('War Room prospect matching does not merge players by last name only', () => {
  ok(!scouting.includes('keys.add(last)'), 'last-name-only aliasing can merge distinct prospects');
  ok(scouting.includes('keys.add(`${first[0]} ${last}`)'), 'first-initial alias should remain for nickname matches');
});

test('canonical rookie-data does not transfer draft capital by surname and school', () => {
  ok(!rookieShared.includes('keys.add(last)'), 'canonical last-name-only aliasing can merge distinct prospects');
  ok(!rookieShared.includes('surnameSchoolIndex'), 'surname plus school matching can transfer draft capital to the wrong player');
  ok(rookieShared.includes('applyPostDraftEnrichment(aliasMatch, e)'), 'safe alias enrichment path missing');
});

test('standalone csv-loader delegates to canonical rookie-data when available', () => {
  ok(csvLoader.includes('loadPlayersFromCanonicalRookieData'), 'canonical wrapper missing');
  ok(csvLoader.includes('window.RookieData?.loadRookieProspects'), 'shared provider lookup missing');
  ok(csvLoader.includes('return legacyLoadPlayersFromCSV();'), 'legacy fallback missing');
});

group('shared script resolver');

test('War Room root uses shared-loader for ReconAI shared modules', () => {
  ok(rootIndex.includes('js/shared/shared-loader.js'), 'root shared-loader tag missing');
  ok(rootIndex.includes('WRShared.loadMany('), 'root shared loadMany call missing');
  ok(rootIndex.includes('WR_SHARED_FILES'), 'root shared file registry missing');
  ok(rootIndex.includes("'rookie-data.js'"), 'root rookie-data shared load missing');
  ok(!rootIndex.includes('https://c2-football.github.io/ReconAI/shared/'), 'root still hardcodes remote shared scripts');
});

test('standalone pages use shared-loader instead of hardcoded remote shared scripts', () => {
  standalonePages.forEach(page => {
    const html = read(ROOT, page);
    ok(html.includes('shared-loader.js'), `${page} missing shared-loader`);
    ok(html.includes('rookie-data.js'), `${page} missing rookie-data shared load`);
    ok(!html.includes('https://c2-football.github.io/ReconAI/shared/'), `${page} still hardcodes remote shared scripts`);
  });
});

test('shared-loader supports local/prod switching and rookie data base override', () => {
  [
    'reconai-shared/',
    'https://c2-football.github.io/ReconAI/shared/',
    "shared === 'remote'",
    'sharedBase',
    'window.ROOKIE_DATA_BASE',
    '/draft-war-room',
  ].forEach(fragment => ok(sharedLoader.includes(fragment), `shared-loader missing ${fragment}`));
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

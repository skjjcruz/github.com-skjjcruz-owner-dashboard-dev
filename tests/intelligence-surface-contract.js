#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function assertIncludes(source, needle, label) {
  if (!source.includes(needle)) {
    throw new Error(`${label}: expected ${needle}`);
  }
}

function assertFile(rel, checks) {
  const source = read(rel);
  checks.forEach(([needle, label]) => assertIncludes(source, needle, `${rel} ${label}`));
}

console.log('\nWar Room intelligence surface contract');

const checks = [
  ['reconai-shared/intelligence-context.js', [
    ['buildPlayerContext', 'exports player context builder'],
    ['buildTeamContext', 'exports team context builder'],
    ['buildWhyView', 'exports shared why renderer'],
    ['getSourceRegistry', 'exports source registry'],
    ['buildSourceEvidence', 'exports source evidence builder'],
    ['sourceFreshness', 'exports source freshness helper'],
    ['buildFantasyCalcRequest', 'exports FantasyCalc request builder'],
    ['fetchFantasyCalcSnapshot', 'exports FantasyCalc snapshot fetcher'],
  ]],
  ['js/components/player-card.js', [
    ['buildPlayerContext', 'uses shared player context'],
    ['buildRosterRecommendation', 'uses roster recommendation object'],
    ['buildWhyView', 'renders why view from recommendation'],
  ]],
  ['js/free-agency.js', [
    ['buildPlayerContext', 'uses shared player context'],
    ['buildWaiverRecommendation', 'uses waiver recommendation object'],
    ['buildWhyView', 'renders why view from recommendation'],
  ]],
  ['js/trade-calc.js', [
    ['buildTeamContext', 'uses shared team context'],
    ['buildTradeRecommendation', 'uses trade recommendation object'],
    ['buildWhyView', 'renders why view from recommendation'],
    ['ownerBehaviorProfiles', 'stores shared owner behavior objects'],
  ]],
  ['js/tabs/alex-insights.js', [
    ['buildBehavioralRecommendation', 'uses behavioral recommendation object'],
    ['buildWhyView', 'renders why view from recommendation'],
  ]],
];

let passed = 0;
const failures = [];

for (const [rel, fileChecks] of checks) {
  try {
    assertFile(rel, fileChecks);
    passed++;
    process.stdout.write('.');
  } catch (err) {
    failures.push(`  FAIL: ${err.message}`);
    process.stdout.write('F');
  }
}

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}

const failed = failures.length;
console.log(`${failed ? 'FAIL' : 'PASS'} ${passed + failed} files - ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

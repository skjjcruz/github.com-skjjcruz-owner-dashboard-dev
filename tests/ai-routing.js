#!/usr/bin/env node
// AI routing and pricing regression tests for the War Room Edge Function.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'ai-analyze', 'index.ts'), 'utf8');

const EXPECTED_MODELS = {
  GEMINI_FAST: 'gemini-2.5-flash-lite',
  GEMINI_BALANCED: 'gemini-2.5-flash',
  CLAUDE_REASONING: 'claude-sonnet-4-6',
};

const EXPECTED_COSTS = {
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cachedInput: 0.30 },
};

const DEPRECATED_MODELS = [
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-7-sonnet-20250219',
  'claude-3-5-haiku-20241022',
];

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

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function numberPattern(value) {
  const [whole, decimals = ''] = String(value.toFixed(2)).split('.');
  return `${whole}(?:\\.${decimals.replace(/0+$/, '')}\\d*)?`;
}

function assertModelConstant(name, value) {
  const pattern = new RegExp(`${name}\\s*:\\s*['"]${escapeRegex(value)}['"]`);
  ok(pattern.test(source), `missing ${name}: ${value}`);
}

function assertCost(model, expected) {
  const input = numberPattern(expected.input);
  const output = numberPattern(expected.output);
  let pattern = `['"]${escapeRegex(model)}['"]\\s*:\\s*\\{[^}]*input\\s*:\\s*${input}[^}]*output\\s*:\\s*${output}`;
  if (expected.cachedInput != null) {
    pattern += `[^}]*cachedInput\\s*:\\s*${numberPattern(expected.cachedInput)}`;
  }
  ok(new RegExp(pattern, 's').test(source), `stale/missing cost constants for ${model}`);
}

function assertRoute(callType, provider, modelConstant) {
  const key = `(?:['"]${escapeRegex(callType)}['"]|${escapeRegex(callType)})`;
  const pattern = new RegExp(
    `${key}\\s*:\\s*\\{[^}]*provider\\s*:\\s*['"]${provider}['"][^}]*model\\s*:\\s*AI_MODELS\\.${modelConstant}`,
    's'
  );
  ok(pattern.test(source), `route ${callType} should use ${provider}/${modelConstant}`);
}

console.log('\nWar Room AI routing regression tests');

group('model IDs');

test('Edge Function does not reference deprecated models', () => {
  for (const model of DEPRECATED_MODELS) {
    ok(!source.includes(model), `deprecated model remains: ${model}`);
  }
});

test('Edge Function exposes current routing model IDs', () => {
  for (const [name, value] of Object.entries(EXPECTED_MODELS)) {
    assertModelConstant(name, value);
  }
});

group('pricing');

test('pricing constants match verified provider rates', () => {
  for (const [model, expected] of Object.entries(EXPECTED_COSTS)) {
    assertCost(model, expected);
  }
});

group('routing');

test('frequent Alex surfaces route to Gemini', () => {
  ['fa_chat', 'fa_targets'].forEach(type => assertRoute(type, 'gemini', 'GEMINI_FAST'));
  ['chat', 'league', 'team', 'partners'].forEach(type => assertRoute(type, 'gemini', 'GEMINI_BALANCED'));
});

test('long structured generation routes to Claude Sonnet', () => {
  ['mock_draft', 'rookies'].forEach(type => assertRoute(type, 'anthropic', 'CLAUDE_REASONING'));
  ok(source.includes("route = { provider: 'anthropic', model: AI_MODELS.CLAUDE_REASONING };"), 'Gemini key fallback should use Sonnet');
});

test('unknown route defaults to Gemini Flash', () => {
  ok(source.includes("AI_ROUTES[type] || { provider: 'gemini', model: AI_MODELS.GEMINI_BALANCED }"), 'unknown route should default to Gemini balanced');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

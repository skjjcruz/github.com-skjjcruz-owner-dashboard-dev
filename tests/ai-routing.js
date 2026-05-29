#!/usr/bin/env node
// AI routing and pricing regression tests for the War Room Edge Function.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'supabase', 'functions', 'ai-analyze', 'index.ts'), 'utf8');
const usageMigration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260503000000_ai_usage_controls.sql'), 'utf8');
const marginMigration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20260503020000_ai_margin_rollups.sql'), 'utf8');
const deployWorkflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'deploy-functions.yml'), 'utf8');
const scaleScript = fs.readFileSync(path.join(ROOT, 'scripts', 'ai-scale-load-model.cjs'), 'utf8');

const EXPECTED_MODELS = {
  GEMINI_FAST: 'gemini-2.5-flash-lite',
  GEMINI_BALANCED: 'gemini-2.5-flash',
  OPENAI_FAST: 'gpt-5.4-nano',
  OPENAI_STANDARD: 'gpt-5.4-mini',
  OPENAI_PREMIUM: 'gpt-5.5',
  CLAUDE_REASONING: 'claude-sonnet-4-6',
  CLAUDE_DEEP: 'claude-opus-4-7',
};

const EXPECTED_COSTS = {
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25, cachedInput: 0.02 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50, cachedInput: 0.075 },
  'gpt-5.5': { input: 5.00, output: 30.00, cachedInput: 0.50 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00, cachedInput: 0.30 },
  'claude-opus-4-7': { input: 5.00, output: 25.00, cachedInput: 0.50 },
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

function assertRouteTier(callType, tier) {
  const key = `(?:['"]${escapeRegex(callType)}['"]|${escapeRegex(callType)})`;
  const pattern = new RegExp(`${key}\\s*:\\s*['"]${escapeRegex(tier)}['"]`);
  ok(pattern.test(source), `route ${callType} should use ${tier} tier`);
}

function analyticsMetadataBlock(marker) {
  const markerStart = source.indexOf(marker);
  ok(markerStart >= 0, `missing analytics marker ${marker}`);
  const metadataStart = source.indexOf('metadata:', markerStart);
  ok(metadataStart >= 0, `missing metadata block for ${marker}`);
  const insertEnd = source.indexOf('\n    }));', metadataStart);
  ok(insertEnd >= 0, `missing analytics insert terminator for ${marker}`);
  return source.slice(metadataStart, insertEnd);
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
  ok(source.includes("AI_POLICY_VERSION"), 'missing versioned AI policy');
  ok(source.includes("type AIProvider = 'anthropic' | 'gemini' | 'openai'"), 'AIProvider should include OpenAI');
});

group('pricing');

test('pricing constants match verified provider rates', () => {
  for (const [model, expected] of Object.entries(EXPECTED_COSTS)) {
    assertCost(model, expected);
  }
});

group('routing');

test('frequent Alex surfaces route to fast/standard tiers', () => {
  ['fa_chat', 'fa_targets'].forEach(type => assertRouteTier(type, 'fast'));
  ['chat', 'league', 'team', 'partners'].forEach(type => assertRouteTier(type, 'standard'));
});

test('long structured generation routes to premium tier', () => {
  ['mock_draft', 'rookies'].forEach(type => assertRouteTier(type, 'premium'));
  ok(source.includes("allowExpensiveFallback"), 'expensive fallback policy should be explicit');
  ok(source.includes("providerFallback"), 'fallback usage should be recorded in telemetry');
  ok(source.includes("providerFallbackReason"), 'fallback reason should be recorded in telemetry');
});

test('unknown route defaults to Gemini Flash', () => {
  ok(source.includes("AI_ROUTES[type] || 'standard'"), 'unknown route should default to standard tier');
  ok(source.includes("DEFAULT_PROVIDER_BY_TIER"), 'default provider by tier should be explicit');
});

test('OpenAI adapter is behind the vendor router', () => {
  ok(source.includes("OPENAI_API_KEY"), 'missing OpenAI secret support');
  ok(source.includes("https://api.openai.com/v1/responses"), 'missing OpenAI Responses API adapter');
  ok(source.includes("OPENAI_STANDARD"), 'missing OpenAI standard model constant');
  ok(source.includes("AI_STANDARD_PROVIDER"), 'missing standard tier provider override');
  ok(source.includes("isProviderAvailabilityError"), 'missing provider outage classifier');
  ok(source.includes("resolveConfiguredRoute(route, planLimits, false, failedProvider)"), 'provider outage should retry through router fallback');
});

group('launch controls');

test('server AI has a kill switch and global budget caps', () => {
  ok(source.includes("AI_KILL_SWITCH"), 'missing AI_KILL_SWITCH');
  ok(source.includes("AI_ENABLED"), 'missing AI_ENABLED');
  ok(source.includes("AI_GLOBAL_DAILY_COST_LIMIT_USD"), 'missing global daily AI cost cap');
  ok(source.includes("AI_GLOBAL_MONTHLY_COST_LIMIT_USD"), 'missing global monthly AI cost cap');
});

test('server AI reserves and records DB-backed usage', () => {
  ok(source.includes("reserve_ai_usage"), 'missing reserve_ai_usage RPC');
  ok(source.includes("record_ai_usage_result"), 'missing record_ai_usage_result RPC');
  ok(source.includes("dailyRequests"), 'missing daily request limit metadata');
  ok(source.includes("monthlyRequests"), 'missing monthly request limit metadata');
  ok(usageMigration.includes("create table if not exists public.ai_usage_daily"), 'missing daily AI usage table');
  ok(usageMigration.includes("create table if not exists public.ai_usage_monthly"), 'missing monthly AI usage table');
  ok(usageMigration.includes("alter table public.ai_usage_daily enable row level security"), 'daily AI usage table should have RLS');
  ok(usageMigration.includes("alter table public.ai_usage_monthly enable row level security"), 'monthly AI usage table should have RLS');
  ok(usageMigration.includes("revoke execute on function public.reserve_ai_usage"), 'reserve_ai_usage should not be client-callable');
  ok(usageMigration.includes("revoke execute on function public.record_ai_usage_result"), 'record_ai_usage_result should not be client-callable');
  ok(usageMigration.includes("grant execute on function public.reserve_ai_usage"), 'reserve_ai_usage should be service-role callable');
  ok(usageMigration.includes("grant execute on function public.record_ai_usage_result"), 'record_ai_usage_result should be service-role callable');
  ok(source.includes("recordAIUsageDenied"), 'missing AI usage denial telemetry');
  ok(source.includes("ai_call_denied"), 'missing AI denial analytics event');
  ok(source.includes("recordAIUsageFailed"), 'missing AI usage failure telemetry');
  ok(source.includes("ai_call_failed"), 'missing AI failure analytics event');
  ok(source.includes("p_reserved_cost_usd: args.reservedCostUsd"), 'provider failures should release reserved cost');
});

test('AI analytics do not record raw prompt text', () => {
  ["event_name: 'ai_call_completed'", "event_name: 'ai_call_failed'"].forEach(marker => {
    const analyticsBlock = analyticsMetadataBlock(marker);
    ['userPrompt', 'systemPrompt', 'messages', 'context:'].forEach(fragment => {
      ok(!analyticsBlock.includes(fragment), `analytics metadata should not include raw ${fragment}`);
    });
  });
  ok(source.includes('inputTokens'), 'analytics should retain token counts instead of raw prompts');
  ok(source.includes('estimatedCostUsd'), 'analytics should retain cost instead of raw prompts');
});

test('server AI enforces plan and prompt/output caps', () => {
  ok(source.includes("const AI_LIMITS"), 'missing plan limit matrix');
  ok(source.includes("monthlyRequests: 20"), 'War Room monthly included AI cap should be explicit');
  ok(source.includes("monthlyRequests: 200"), 'Pro monthly included AI cap should be explicit');
  ok(source.includes("maxInputChars"), 'missing input context cap');
  ok(source.includes("AI_MAX_OUTPUT_TOKENS"), 'missing global output cap');
});

test('Opus routes are gated by entitlement instead of available to every paid user', () => {
  ok(source.includes("maxModelTier"), 'missing max model tier gate');
  ok(source.includes("downgradeRouteForEntitlement"), 'missing model downgrade policy');
  ok(source.includes("routeDowngraded"), 'missing downgraded route telemetry');
});

test('AI margin rollup and Deno deploy check are wired', () => {
  ok(marginMigration.includes("'aiMargin'"), 'missing AI margin rollup');
  ok(marginMigration.includes("'errorRatePct'"), 'missing AI error rate rollup');
  ok(marginMigration.includes("provider_fallback"), 'missing fallback rate rollup');
  ok(marginMigration.includes("route_downgraded"), 'missing downgrade rate rollup');
  ok(marginMigration.includes("ai_call_denied"), 'missing quota denial rollup');
  ok(marginMigration.includes("ai_call_failed"), 'missing failure rollup');
  ok(deployWorkflow.includes('for fn in supabase/functions/*/index.ts'), 'deploy workflow should type-check all Edge Functions');
  ok(deployWorkflow.includes('deno check --node-modules-dir=auto "$fn"'), 'deploy workflow should run deno check for each Edge Function with npm support');
});

test('staging AI scale model covers 1,000-user and 100,000-user paths', () => {
  ok(scaleScript.includes("name: 'launch-1000'"), 'missing launch scale model');
  ok(scaleScript.includes("name: 'target-100000'"), 'missing 100,000-user scale model');
  ok(scaleScript.includes('SUPABASE_INCLUDED_EDGE_INVOCATIONS = 2_000_000'), 'scale model should track Supabase invocation threshold');
  ok(scaleScript.includes('AI_LOAD_SEND'), 'scale model should support gated staging probes');
});

console.log('\n');
if (failures.length) {
  console.log(failures.join('\n'));
  console.log('');
}
const status = failed > 0 ? 'FAIL' : 'PASS';
console.log(`${status} ${passed + failed} tests - ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);

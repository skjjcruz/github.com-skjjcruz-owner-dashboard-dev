#!/usr/bin/env node
'use strict';

const COST_PER_1M = {
  'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
  'gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'gpt-5.4-nano': { input: 0.20, output: 1.25 },
  'gpt-5.4-mini': { input: 0.75, output: 4.50 },
  'gpt-5.5': { input: 5.00, output: 30.00 },
  'claude-sonnet-4-6': { input: 3.00, output: 15.00 },
  'claude-opus-4-7': { input: 5.00, output: 25.00 },
};

const ROUTES = {
  fast: { provider: 'gemini', model: 'gemini-2.5-flash-lite', inputTokens: 1200, outputTokens: 350, analyticsEvents: 2, dbWrites: 3 },
  standard: { provider: 'gemini', model: 'gemini-2.5-flash', inputTokens: 2200, outputTokens: 650, analyticsEvents: 2, dbWrites: 3 },
  premium: { provider: 'anthropic', model: 'claude-sonnet-4-6', inputTokens: 5000, outputTokens: 1200, analyticsEvents: 2, dbWrites: 3 },
  deep: { provider: 'anthropic', model: 'claude-opus-4-7', inputTokens: 12000, outputTokens: 2500, analyticsEvents: 2, dbWrites: 3 },
};

const SUPABASE_INCLUDED_EDGE_INVOCATIONS = 2_000_000;
const SUPABASE_INCLUDED_MAU = 100_000;

const SCENARIOS = [
  {
    name: 'launch-1000',
    users: 1_000,
    callsPerUserPerMonth: 20,
    routeMix: { fast: 0.55, standard: 0.35, premium: 0.09, deep: 0.01 },
  },
  {
    name: 'target-100000',
    users: 100_000,
    callsPerUserPerMonth: 20,
    routeMix: { fast: 0.60, standard: 0.32, premium: 0.07, deep: 0.01 },
  },
  {
    name: 'budget-stress-100000',
    users: 100_000,
    callsPerUserPerMonth: 20,
    routeMix: { fast: 0.10, standard: 0.20, premium: 0.55, deep: 0.15 },
  },
];

function usd(model, inputTokens, outputTokens) {
  const rate = COST_PER_1M[model];
  return ((inputTokens / 1_000_000) * rate.input) + ((outputTokens / 1_000_000) * rate.output);
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function dollars(value) {
  return `$${value.toFixed(value >= 100 ? 0 : 2)}`;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function modelScenario(scenario) {
  const monthlyCalls = scenario.users * scenario.callsPerUserPerMonth;
  const byTier = Object.entries(scenario.routeMix).map(([tier, share]) => {
    const route = ROUTES[tier];
    const calls = Math.round(monthlyCalls * share);
    const cost = calls * usd(route.model, route.inputTokens, route.outputTokens);
    return {
      tier,
      provider: route.provider,
      model: route.model,
      calls,
      edgeInvocations: calls,
      dbWrites: calls * route.dbWrites,
      analyticsEvents: calls * route.analyticsEvents,
      cost,
    };
  });
  const totalCost = byTier.reduce((sum, row) => sum + row.cost, 0);
  const edgeInvocations = byTier.reduce((sum, row) => sum + row.edgeInvocations, 0);
  const dbWrites = byTier.reduce((sum, row) => sum + row.dbWrites, 0);
  const analyticsEvents = byTier.reduce((sum, row) => sum + row.analyticsEvents, 0);
  return {
    ...scenario,
    monthlyCalls,
    byTier,
    edgeInvocations,
    dbWrites,
    analyticsEvents,
    totalCost,
    includedInvocationUse: edgeInvocations / SUPABASE_INCLUDED_EDGE_INVOCATIONS,
    includedMauUse: scenario.users / SUPABASE_INCLUDED_MAU,
  };
}

async function stagingProbe() {
  const endpoint = process.env.AI_LOAD_ENDPOINT;
  const token = process.env.AI_LOAD_TOKEN;
  if (process.env.AI_LOAD_SEND !== '1' || !endpoint || !token) return null;

  const total = Math.max(1, Number(process.env.AI_LOAD_REQUESTS || 25));
  const concurrency = Math.max(1, Number(process.env.AI_LOAD_CONCURRENCY || 5));
  const durations = [];
  const statuses = new Map();
  let next = 0;

  async function worker() {
    while (next < total) {
      next += 1;
      const started = Date.now();
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: 'general',
            context: JSON.stringify({
              callType: 'home-chat',
              userMessage: 'Synthetic staging load probe. Return one short sentence.',
              maxTokens: 120,
            }),
          }),
        });
        statuses.set(res.status, (statuses.get(res.status) || 0) + 1);
        await res.text().catch(() => '');
      } catch (_err) {
        statuses.set('network_error', (statuses.get('network_error') || 0) + 1);
      } finally {
        durations.push(Date.now() - started);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return {
    total,
    concurrency,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    statuses: Object.fromEntries(statuses.entries()),
  };
}

(async function main() {
  const reports = SCENARIOS.map(modelScenario);
  console.log('\nAI scale load model');
  reports.forEach(report => {
    console.log(`\n${report.name}`);
    console.log(`  users=${report.users.toLocaleString()} calls/month=${report.monthlyCalls.toLocaleString()} cost/month=${dollars(report.totalCost)}`);
    console.log(`  edge=${report.edgeInvocations.toLocaleString()} (${pct(report.includedInvocationUse)} of included 2M) db_writes=${report.dbWrites.toLocaleString()} analytics_events=${report.analyticsEvents.toLocaleString()}`);
    report.byTier.forEach(row => {
      console.log(`  ${row.tier.padEnd(8)} ${row.model.padEnd(22)} calls=${row.calls.toLocaleString().padStart(9)} cost=${dollars(row.cost)}`);
    });
  });

  const target = reports.find(report => report.name === 'target-100000');
  if (!target || target.edgeInvocations !== 2_000_000) {
    throw new Error('100,000 users at 20 calls/month should model exactly 2,000,000 edge invocations.');
  }

  const probe = await stagingProbe();
  if (probe) {
    console.log('\nStaging probe');
    console.log(`  requests=${probe.total} concurrency=${probe.concurrency} p50=${probe.p50Ms}ms p95=${probe.p95Ms}ms statuses=${JSON.stringify(probe.statuses)}`);
  } else {
    console.log('\nStaging probe skipped: set AI_LOAD_SEND=1, AI_LOAD_ENDPOINT, and AI_LOAD_TOKEN to send traffic.');
  }
})().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});

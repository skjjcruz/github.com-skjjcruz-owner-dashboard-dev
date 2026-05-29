#!/usr/bin/env node
// Copy ReconAI shared browser modules into War Room for local dev.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = path.join(ROOT, 'reconai-shared');

const FILES = [
  'app-config.js',
  'bug-capture.js',
  'constants.js',
  'utils.js',
  'storage.js',
  'event-bus.js',
  'platform-provider.js',
  'sleeper-api.js',
  'espn-api.js',
  'mfl-api.js',
  'yahoo-api.js',
  'supabase-client.js',
  'tier.js',
  'pick-value-model.js',
  'dhq-providers.js',
  'dhq-core.js',
  'intelligence-context.js',
  'dhq-engine.js',
  'team-assess.js',
  'analytics-engine.js',
  'dhq-ai.js',
  'assistant-tutorial.js',
  'ai-dispatch.js',
  'strategy.js',
  'trade-engine.js',
  'mock-engine.js',
  'gm-engine.js',
  'player-modal.js',
  'rookie-data.js',
];

function findSourceDir() {
  const candidates = [
    process.env.RECONAI_SHARED_SOURCE,
    path.resolve(ROOT, '..', 'reconai', 'shared'),
  ].filter(Boolean);

  return candidates.find(candidate => fs.existsSync(candidate)) || null;
}

function hasBundledSnapshot() {
  return FILES.every(file => fs.existsSync(path.join(TARGET, file)));
}

const SOURCE = findSourceDir();

if (!SOURCE) {
  if (hasBundledSnapshot()) {
    console.log('[sync-reconai-shared] Source checkout unavailable; using bundled reconai-shared snapshot');
    process.exit(0);
  }
  console.error('[sync-reconai-shared] Missing ReconAI shared source and bundled snapshot');
  process.exit(1);
}

fs.rmSync(TARGET, { recursive: true, force: true });
fs.mkdirSync(TARGET, { recursive: true });

for (const file of FILES) {
  const src = path.join(SOURCE, file);
  if (!fs.existsSync(src)) {
    console.error(`[sync-reconai-shared] Missing shared file: ${src}`);
    process.exit(1);
  }
  fs.copyFileSync(src, path.join(TARGET, file));
}

console.log(`[sync-reconai-shared] Copied ${FILES.length} files to ${path.relative(ROOT, TARGET)}/`);

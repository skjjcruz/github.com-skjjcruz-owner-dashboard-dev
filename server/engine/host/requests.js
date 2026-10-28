#!/usr/bin/env node
// Builds leagues members just opened (owner go-ahead 2026-10-17). The app
// sends league ids to dhq-request, which queues them in build_requests.
//
// Phase A6 (2026-10-28): a standby builder (run.js with ENGINE_STANDBY=1) is
// always started up and waiting: shared data loaded, database open. It
// checks the queue every second, claims one league (a league open on a
// member's screen first), builds it and exits. The moment it claims one,
// this starts the next standby, so a second member never waits on a cold
// start either. At most two builders at once; while one is building, the
// waiting one takes only leagues open on a screen. A standby whose shared
// data passes 20 minutes exits and is replaced.
// Run by dhq-requests.service. Env (from /etc/dhq-engine.env):
// SUPABASE_ACCESS_TOKEN, ENGINE_PROJECT_REF.
'use strict';
const { spawn } = require('child_process');
const REF = process.env.ENGINE_PROJECT_REF || '';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const APP = process.env.DHQ_APP_DIR || '/opt/dhq/app';
const MAX_BUILDERS = 2;
const BUILD_LIMIT_MS = 30 * 60 * 1000;

async function sql(query) {
  const r = await fetch('https://api.supabase.com/v1/projects/' + REF + '/database/query', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error('management API ' + r.status + ': ' + text.slice(0, 200));
  return JSON.parse(text || '[]');
}

const builders = new Set();   // { child, building }
function waiting() { return [...builders].filter(b => !b.building).length; }

function startStandby() {
  if (builders.size >= MAX_BUILDERS || waiting() > 0) return;
  const busy = builders.size > 0;
  const b = { building: null, started: Date.now() };
  b.child = spawn(process.execPath, ['--max-old-space-size=2048', 'server/engine/run.js'], {
    cwd: APP,
    env: Object.assign({}, process.env, { ENGINE_PARTIAL: '1', ENGINE_STANDBY: '1', ENGINE_RUNNER: 'request', ENGINE_ONLY_OPENED: busy ? '1' : '' }),
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  builders.add(b);
  b.child.on('message', m => {
    if (m && m.building) { b.building = m.building; b.since = Date.now(); startStandby(); }
  });
  b.child.on('exit', code => {
    builders.delete(b);
    // The waiting one may take any league again.
    if (!builders.size || ![...builders].some(x => x.building)) for (const x of builders) { try { x.child.send({ anyLeague: true }); } catch (e) { /* gone */ } }
    if (code) console.warn('builder exited', code, b.building ? '(league ' + b.building + ')' : '(standby)');
    // A crash while waiting: pause before the next, so a broken build can't spin.
    setTimeout(startStandby, code && !b.building ? 30000 : 500);
  });
}

// A claimed league whose builder died (or hangs past the limit) is marked
// failed, as before, so one bad id can't loop; a request a day on re-queues it.
async function sweep() {
  for (const b of builders) if (b.building && Date.now() - b.since > BUILD_LIMIT_MS) { console.warn('builder over time:', b.building); b.child.kill('SIGKILL'); }
  await sql("update public.build_requests set status = 'failed', last_error = coalesce(last_error, 'build did not finish') where status = 'building' and building_at < now() - interval '35 minutes'");
}

(async function main() {
  if (!REF || !TOKEN) { console.error('ENGINE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required'); process.exit(1); }
  console.log('keeping a standby builder ready (at most', MAX_BUILDERS, 'builders)');
  startStandby();
  setInterval(() => { startStandby(); sweep().catch(e => console.warn('request sweep:', e.message)); }, 60 * 1000);
  // The service stopping (setup, restart): take the builders down with it.
  const stop = () => { for (const b of builders) b.child.kill('SIGTERM'); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
})();

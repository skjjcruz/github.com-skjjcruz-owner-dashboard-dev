// server/engine/run.js — build every connected league and store the result.
//
//   node server/engine/run.js                 # build + store (needs env below)
//   node server/engine/run.js --dry           # build only; write JSON to ./out
//   LEAGUES=id1,id2 node server/engine/run.js # override the league list
//
// Env (store mode): SUPABASE_ACCESS_TOKEN (Supabase management token, the one
// the deploy workflows already hold) and ENGINE_PROJECT_REF (the vacant
// project). The script wakes the project if it is paused, applies
// schema.sql, reads the project's service key, builds, and upserts.
'use strict';
const fs = require('fs');
const path = require('path');
const { ENGINE_VERSION, loadShared, withFeeds, buildLeague, computeFromPayload, slimPlayers, sleeper, espnTeamData } = require('./headless');
const { buildNewsIndex } = require('./news');
const { createProjector } = require('./dhq-proj');

const DRY = process.argv.includes('--dry');
// A request build (server/engine/host/requests.js): only the leagues a member
// just opened. It skips the shared lookups and the news index (the hourly
// build owns those) and never stores an error row over a good league.
const PARTIAL = process.env.ENGINE_PARTIAL === '1';
// A standby builder (server/engine/host/requests.js, Phase A6): a request
// build that starts up first (shared data loaded, database open) and then
// waits for a member's league, so a league opened for the first time is
// built in seconds instead of after a cold start. It builds one league and
// exits; requests.js keeps the next one waiting.
const STANDBY = PARTIAL && process.env.ENGINE_STANDBY === '1';
// A standby gives up (and is replaced) once its shared data is this old, the
// same limit a request build puts on the last full build's copy.
const SHARED_MAX_MS = 20 * 60 * 1000;
let SHARED_AT = Date.now();
const REF = process.env.ENGINE_PROJECT_REF || '';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const MGMT = 'https://api.supabase.com/v1/projects/' + REF;
const OUT = path.join(__dirname, 'out');

async function mgmt(p, init) {
  const r = await fetch(MGMT + p, Object.assign({ headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Accept: 'application/json' } }, init || {}));
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  if (!r.ok) throw new Error('management API ' + r.status + ' on ' + p + ': ' + text.slice(0, 300));
  return json;
}
async function sql(query) { return mgmt('/database/query', { method: 'POST', body: JSON.stringify({ query }) }); }

async function ensureAwake() {
  let info = await mgmt('');
  if (info.status === 'ACTIVE_HEALTHY') return info;
  if (info.status === 'INACTIVE' || info.status === 'PAUSED') {
    console.log('project is paused — restoring');
    await mgmt('/restore', { method: 'POST', body: '{}' }).catch(e => { console.warn('restore call:', e.message); });
  }
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 10000));
    info = await mgmt('');
    console.log('  status:', info.status);
    if (info.status === 'ACTIVE_HEALTHY') return info;
  }
  throw new Error('project did not become healthy: ' + info.status);
}

async function serviceKey() {
  const keys = await mgmt('/api-keys?reveal=true');
  const k = (keys || []).find(x => x.name === 'service_role') || (keys || []).find(x => /service/i.test(x.name || ''));
  if (!k || !k.api_key) throw new Error('no service_role key on project ' + REF);
  return k.api_key;
}

function rest(key) {
  const base = 'https://' + REF + '.supabase.co/rest/v1/';
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  return {
    async upsert(table, rows) {
      const r = await fetch(base + table, { method: 'POST', headers: Object.assign({ Prefer: 'resolution=merge-duplicates,return=minimal' }, headers), body: JSON.stringify(rows) });
      if (!r.ok) throw new Error('upsert ' + table + ' ' + r.status + ': ' + (await r.text()).slice(0, 300));
    },
    async update(table, q, patch) {
      const r = await fetch(base + table + '?' + q, { method: 'PATCH', headers: Object.assign({ Prefer: 'return=minimal' }, headers), body: JSON.stringify(patch) });
      if (!r.ok) throw new Error('update ' + table + ' ' + r.status + ': ' + (await r.text()).slice(0, 300));
    },
    // PATCH that returns the rows it changed (a claim: only one builder gets each).
    async claim(table, q, patch) {
      const r = await fetch(base + table + '?' + q, { method: 'PATCH', headers: Object.assign({ Prefer: 'return=representation' }, headers), body: JSON.stringify(patch) });
      if (!r.ok) throw new Error('claim ' + table + ' ' + r.status + ': ' + (await r.text()).slice(0, 300));
      return r.json();
    },
    async select(table, q) {
      const r = await fetch(base + table + '?' + q, { headers });
      if (!r.ok) throw new Error('select ' + table + ' ' + r.status + ': ' + (await r.text()).slice(0, 300));
      return r.json();
    },
  };
}

// What dhq-league serves the app, as exact JSON text: jsonb reorders object
// keys (shortest first), and the app lists some of them in key order
// (positions in an assessment, for one), so the app gets the build's own
// text, key order and all (Phase A1, 2026-10-27).
function appTexts(row) {
  if (!row.snapshot) return;
  const appIntel = Object.assign({}, row.intel); delete appIntel.sourceSnapshots;
  row.snapshot.app_intel_json = JSON.stringify(appIntel);
  row.snapshot.app_brain_json = row.brainPack ? JSON.stringify(row.brainPack) : null;
  // Traded picks as the app compares them (team-assess.js
  // serverBuildMatches): a picks-only trade changes the assessments
  // and the one brain without moving a player.
  const picksSig = (row.snapshot.traded_picks || []).map(p => [p.season, p.round, p.roster_id, p.owner_id].join('|')).sort().join(',');
  row.snapshot.app_assess_json = JSON.stringify({
    assessments: row.assessments || [], dna: row.dna || {}, picks_sig: picksSig,
    rosters: (row.snapshot.rosters || []).map(r => ({ roster_id: r.roster_id, players: r.players || [], settings: { wins: (r.settings || {}).wins || 0, losses: (r.settings || {}).losses || 0, ties: (r.settings || {}).ties || 0, fpts: (r.settings || {}).fpts || 0 } })),
  });
}

const T_START = Date.now();
// The server has one CPU (2026-10-28): the league a member is waiting on
// (opened, never built) gets it; everything after its values and
// assessments are saved, and any league nobody is waiting on, runs at a
// low priority (the scheduled build runs at nice 10, a standby at 0).
let standbyOpened = false;
function lowPriority() { try { require('os').setPriority(15); } catch (e) { /* not allowed: carry on */ } }
let T_BUILD = T_START;   // when the league was taken (a standby waits first)
// The shared data (the player directory, five seasons of stats, this week's
// lines): a full run downloads it and keeps a copy on disk; a request build
// (a member waiting on a new league) reuses a copy under 20 minutes old,
// the same data the last scheduled build used (Phase A6, 2026-10-28: ~3 s
// of downloads against under 1 s to read).
const SHARED_COPY = process.env.DHQ_SHARED_COPY || path.join(require('os').tmpdir(), 'dhq-shared-copy.json');
async function sharedData() {
  if (PARTIAL) {
    try {
      const st = fs.statSync(SHARED_COPY);
      if (Date.now() - st.mtimeMs < SHARED_MAX_MS) {
        const copy = withFeeds(JSON.parse(fs.readFileSync(SHARED_COPY, 'utf8')));
        SHARED_AT = st.mtimeMs;
        console.log('shared data from the last build\'s copy,', Math.round((Date.now() - st.mtimeMs) / 60000), 'min old');
        return copy;
      }
    } catch (e) { /* no usable copy: download */ }
  }
  SHARED_AT = Date.now();
  const shared = await loadShared();
  if (!PARTIAL && !DRY) {
    try {
      const copy = Object.assign({}, shared); delete copy.fetchJsonCached;
      fs.writeFileSync(SHARED_COPY + '.tmp', JSON.stringify(copy));
      fs.renameSync(SHARED_COPY + '.tmp', SHARED_COPY);
    } catch (e) { console.warn('shared data copy not kept:', e.message); }
  }
  return shared;
}
(async () => {
  const started = new Date().toISOString();
  let db = null;
  if (!DRY) {
    if (!REF || !TOKEN) throw new Error('ENGINE_PROJECT_REF and SUPABASE_ACCESS_TOKEN are required (or pass --dry)');
    await ensureAwake();
    // The schema is applied by every full (hourly) run; a request build
    // (PARTIAL, a member waiting on a league) skips it (Phase A6).
    if (!PARTIAL) {
      await sql(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
      // New tables reach the REST layer only after its schema cache reloads.
      await sql("notify pgrst, 'reload schema'").catch(() => {});
    }
    db = rest(await serviceKey());
    for (let i = 0; ; i++) {
      try { await db.select('connect_leagues', 'select=league_id&limit=1'); break; }
      catch (e) { if (i >= 12 || !/PGRST205|schema cache/.test(e.message)) throw e; await new Promise(r => setTimeout(r, 5000)); }
    }
  } else {
    fs.mkdirSync(OUT, { recursive: true });
  }

  // Which leagues: env override, else the active rows in connect_leagues
  // plus every league a member opened in the last 30 days (build_requests).
  let leagues = (process.env.LEAGUES || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!leagues.length && db && !STANDBY) {
    leagues = (await db.select('connect_leagues', 'select=league_id&active=eq.true')).map(r => r.league_id);
    // Connected leagues first, then members' leagues most out of date first,
    // so a run that hits its time budget leaves the freshest work undone.
    const asked = await db.select('build_requests', 'select=league_id&status=neq.failed&expires_at=gt.' + encodeURIComponent(new Date().toISOString()) + '&order=last_built_at.asc.nullsfirst').catch(e => { console.warn('build requests:', e.message); return []; });
    leagues = [...new Set(leagues.concat(asked.map(r => r.league_id)))];
  }
  if (!leagues.length && !(STANDBY && db)) throw new Error('no leagues to build (set LEAGUES=… or add rows to connect_leagues)');
  console.log('engine', ENGINE_VERSION, DRY ? '(dry run)' : '', '—', STANDBY ? 'standby' : leagues.length + ' league(s)');

  const t0 = Date.now();
  if (PARTIAL) console.log('ready in', ((Date.now() - T_START) / 1000).toFixed(1) + 's');
  const shared = await sharedData();
  console.log('shared data in', ((Date.now() - t0) / 1000).toFixed(1) + 's: season', shared.season, 'week', shared.nfl.display_week || shared.nfl.week, '· players', Object.keys(shared.players).length);

  // Past-season history per league lives in engine_cache so each run only
  // refreshes the current season (the engine's own fast path).
  // Monday-night fix (owner report 2026-10-12): once a game ends Sleeper
  // drops its players from the week's projections. The rows seen this week
  // are kept in engine_cache and merged back, but only for a player whose
  // team has already played: one Sleeper drops before his game stays
  // dropped (truth law). The app does the same on each device.
  if (db) {
    try {
      const live = r => r && ['pts_ppr', 'pts_half_ppr', 'pts_std', 'pass_att', 'rush_att', 'rec_tgt', 'fga', 'xpm', 'idp_tkl', 'idp_sack'].some(k => Number(r[k]) > 0);
      const key = 'sleeper_week_' + shared.season + '_' + shared.week;
      const keptRow = await db.select('engine_cache', 'select=data&key=eq.' + encodeURIComponent(key));
      const kept = (keptRow[0] && keptRow[0].data) || {};
      const fresh = {}; Object.keys(shared.projWeek || {}).forEach(pid => { if (live(shared.projWeek[pid])) fresh[pid] = shared.projWeek[pid]; });
      let back = 0;
      Object.keys(kept).forEach(pid => {
        if (fresh[pid]) return;
        const t = shared.players[pid] && shared.players[pid].team;
        if (t && shared.weekGames[t] && shared.weekGames[t].played) { shared.projWeek[pid] = kept[pid]; back++; }
      });
      await db.upsert('engine_cache', [{ key, data: Object.assign({}, kept, fresh), updated_at: new Date().toISOString() }]);
      console.log('sleeper week lines:', Object.keys(fresh).length, 'fresh ·', back, 'kept rows restored (games already played)');
    } catch (e) { console.warn('sleeper week keep:', e.message); }
  }

  // Standby: wait for a league to build (opened on a member's screen first),
  // claimed so no other builder takes it. With ONLY_OPENED (another builder
  // is busy) it waits for an opened league only. Nothing within the shared
  // data's age limit: exit, and requests.js starts a fresh standby.
  if (STANDBY) {
    let onlyOpened = process.env.ENGINE_ONLY_OPENED === '1';
    process.on('message', m => { if (m && m.anyLeague) onlyOpened = false; });   // the other builder finished
    console.log('standby: ready in', ((Date.now() - T_START) / 1000).toFixed(1) + 's' + (onlyOpened ? ' (opened leagues only)' : ''));
    while (!leagues.length) {
      const q = 'select=league_id&status=eq.pending' + (onlyOpened ? '&opened_at=not.is.null' : '') + '&order=opened_at.desc.nullslast,requested_at.asc&limit=3';
      if (Date.now() - SHARED_AT > SHARED_MAX_MS) { console.log('standby: shared data', Math.round((Date.now() - SHARED_AT) / 60000), 'min old; making way for a fresh one'); process.exit(0); }
      // A page waiting on values it gathered (dhq-compute) comes first.
      const asks = await db.select('compute_requests', 'select=id&status=eq.pending&order=requested_at.asc&limit=3').catch(() => []);
      for (const a of asks) {
        const got = await db.claim('compute_requests', 'id=eq.' + a.id + '&status=eq.pending', { status: 'building', building_at: new Date().toISOString() }).catch(() => []);
        if (got.length) { await computeForPage(got[0]); process.exit(0); }
      }
      const rows = await db.select('build_requests', q.replace('select=league_id', 'select=league_id,opened_at')).catch(() => []);
      for (const r of rows) {
        const id = String(r.league_id);
        if (!/^\d{10,20}$/.test(id)) continue;
        const got = await db.claim('build_requests', 'league_id=eq.' + id + '&status=eq.pending', { status: 'building', building_at: new Date().toISOString() }).catch(() => []);
        if (got.length) { leagues = [id]; standbyOpened = !!r.opened_at; break; }
      }
      if (!leagues.length) await new Promise(r => setTimeout(r, 1000));
    }
    T_BUILD = Date.now();
    leagues = leagues.slice(0, 1);
    async function computeForPage(job) {
      const t = Date.now();
      if (process.send) process.send({ building: 'compute ' + job.id, opened: true });
      try {
        const intel = await computeFromPayload(job.payload || {}, shared);
        const text = JSON.stringify(Object.assign({}, intel, { sourceSnapshots: undefined }));
        await db.update('compute_requests', 'id=eq.' + job.id, { status: 'done', result_json: text, payload: null, done_at: new Date().toISOString() });
        console.log('computed for a page:', job.platform, job.league_key, Object.keys(intel.playerScores).length, 'players in', ((Date.now() - t) / 1000).toFixed(1) + 's');
      } catch (e) {
        console.warn('compute for a page failed:', job.platform, job.league_key, e && e.message || e);
        await db.update('compute_requests', 'id=eq.' + job.id, { status: 'failed', error: String(e && e.message || e).slice(0, 300), payload: null, done_at: new Date().toISOString() }).catch(() => {});
      }
    }
    if (process.send) process.send({ building: leagues[0], opened: standbyOpened });
    console.log('building on request:', leagues[0]);
  }

  const histCache = db ? {
    async get(key) { const rows = await db.select('engine_cache', 'select=data&key=eq.' + encodeURIComponent(key)); return rows[0] ? rows[0].data : null; },
    async set(key, value) { await db.upsert('engine_cache', [{ key, data: value, updated_at: new Date().toISOString() }]); },
  } : null;

  let ok = 0, failed = 0;
  const builtIds = [], failedIds = {};
  const rostered = new Set();
  // DHQ weekly projections (server/engine/dhq-proj.js): one projection
  // context per run, then every rostered player per league. A failure here
  // never fails a league build; the server falls back to Sleeper's line.
  // Who gets a DHQ projection beyond the rosters: everyone the app can ask
  // about (Phase A3, 2026-10-27: the app shows the server's numbers, its
  // free-agent lists included): every player on an NFL team at a position
  // the league can start (defenders only in IDP leagues), plus anyone
  // Sleeper projects this week.
  const OFF_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);   // DEF: team defenses (DHQ D/ST model, Lab #108)
  const DEF_POS = new Set(['DL', 'DE', 'DT', 'NT', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'SS', 'FS']);
  const IDP_SLOT = /^(DL|DE|DT|LB|DB|CB|S|IDP_FLEX)$/;
  const projPool = (league, withLine) => {
    const idp = ((league && league.roster_positions) || []).some(s => IDP_SLOT.test(String(s).toUpperCase()));
    const pool = new Set(withLine);
    for (const pid of Object.keys(shared.players)) {
      const p = shared.players[pid], pos = String((p && p.position) || '').toUpperCase();
      if (p && p.team && (OFF_POS.has(pos) || (idp && DEF_POS.has(pos)))) pool.add(pid);
    }
    return [...pool];
  };
  let projector = null, projectorError = null;
  const projectorFor = async () => {
    if (projector || projectorError) return projector;
    const tp = Date.now();
    try { projector = await createProjector(shared); console.log('dhq projections ready in', ((Date.now() - tp) / 1000).toFixed(1) + 's ·', JSON.stringify(projector.data), '· sleeper week', projector.sleeperWeek); }
    catch (e) { projectorError = e; console.warn('dhq projections unavailable:', e && e.message || e); }
    return projector;
  };
  // Time budget (minutes): a full run stops starting new leagues after this,
  // so it always finishes inside its 25-minute limit; the next run picks up
  // the leagues it didn't reach (most out of date first).
  const BUDGET_MS = Number(process.env.ENGINE_BUDGET_MIN || 20) * 60 * 1000;
  let skipped = 0;
  // A league a member opens for the first time (Phase A6, 2026-10-28): its
  // values are saved the moment they are built, before this week's and
  // later weeks' projections (a minute or more), so the app finds them in
  // about the time it would take to build them itself. A full run also
  // takes such leagues between leagues, instead of leaving them queued
  // behind it (it holds the build lock for up to 14 minutes).
  const neverBuilt = new Set();
  const markNew = async ids => {
    if (!db || !ids.length) return;
    const have = new Set((await db.select('league_intel', 'select=league_id&league_id=in.(' + ids.join(',') + ')').catch(() => ids.map(league_id => ({ league_id })))).map(r => String(r.league_id)));
    ids.forEach(id => { if (!have.has(String(id))) neverBuilt.add(String(id)); });
  };
  if (PARTIAL) await markNew(leagues.filter(id => /^\d{10,20}$/.test(id)));
  const urgentDone = () => { if (STANDBY) { lowPriority(); if (process.send) try { process.send({ urgentDone: true }); } catch (e) { /* gone */ } } };
  if (STANDBY && !(standbyOpened && neverBuilt.has(String(leagues[0])))) urgentDone();
  const injected = new Set();
  let lastQueueCheck = 0;
  // A league a member has open right now (opened_at, set by dhq-request)
  // goes first; a request build takes only those, so the league on screen
  // never waits behind the rest of the member's leagues.
  const takeQueued = async li => {
    if (!db || STANDBY || Date.now() - lastQueueCheck < 3000) return;
    lastQueueCheck = Date.now();
    const rows = await db.select('build_requests', PARTIAL
      ? 'select=league_id&status=eq.pending&opened_at=not.is.null&order=opened_at.desc&limit=2'
      : 'select=league_id&status=eq.pending&order=opened_at.desc.nullslast,requested_at.asc&limit=5').catch(() => []);
    // Skip any already built in this run (ahead of li) or already taken.
    let fresh = rows.map(r => String(r.league_id)).filter(id => { const at = leagues.indexOf(id); return /^\d{10,20}$/.test(id) && !injected.has(id) && !(at >= 0 && at < li); });
    if (!fresh.length) return;
    // Claimed, so a standby builder doesn't build the same league.
    fresh = (await db.claim('build_requests', 'status=eq.pending&league_id=in.(' + fresh.join(',') + ')', { status: 'building', building_at: new Date().toISOString() }).catch(() => [])).map(r => String(r.league_id)).filter(id => fresh.includes(id));
    if (!fresh.length) return;
    await markNew(fresh);
    fresh.forEach(id => { const at = leagues.indexOf(id); if (at >= 0) leagues.splice(at, 1); injected.add(id); });
    leagues.splice(li, 0, ...fresh);
    console.log('  taking member requests first:', fresh.join(','));
  };
  for (let li = 0; li < leagues.length; li++) {
    await takeQueued(li);
    const lid = leagues[li];
    if (!PARTIAL && !injected.has(lid) && Date.now() - t0 > BUDGET_MS) { skipped++; continue; }
    try {
      const tStart = Date.now();
      // A league's first build: its values are saved the moment they exist
      // (the app takes values without the assessments and fills those in
      // itself, as it always has), then again with everything but this
      // week's projections, then in full.
      let valuesSaved = Promise.resolve();
      const onValues = db && neverBuilt.has(String(lid)) ? vrow => {
        const tv = Date.now();
        vrow.snapshot.app_intel_json = JSON.stringify(Object.assign({}, vrow.intel, { sourceSnapshots: undefined }));
        valuesSaved = db.upsert('league_intel', [Object.assign(vrow, { error: null })])
          .then(() => console.log('  values saved (first build of this league),', ((Date.now() - T_BUILD) / 1000).toFixed(1) + 's after ' + (STANDBY ? 'taking it' : 'start') + ' · save', ((Date.now() - tv) / 1000).toFixed(1) + 's'))
          .catch(e => console.warn('  values save failed for', lid + ':', e && e.message || e));
      } : null;
      const row = await buildLeague(lid, shared, histCache, onValues);
      await valuesSaved;
      const steps = Object.assign({ start: +((tStart - T_BUILD) / 1000).toFixed(2) }, row.steps); delete row.steps;
      if (db && neverBuilt.has(String(lid))) {
        try {
          const tSave = Date.now();
          const early = Object.assign({}, row, { snapshot: Object.assign({}, row.snapshot) });
          appTexts(early);
          delete early.brainPack;
          await db.upsert('league_intel', [Object.assign(early, { error: null })]);
          urgentDone();
          console.log('  assessments saved early,', ((Date.now() - T_BUILD) / 1000).toFixed(1) + 's after ' + (STANDBY ? 'taking it' : 'start') + ' · build', JSON.stringify(steps), '· save', ((Date.now() - tSave) / 1000).toFixed(1) + 's');
        } catch (e) { console.warn('  early save failed for', lid + ':', e && e.message || e); }
      }
      try {
        const pj = await projectorFor();
        if (pj && row.snapshot && row.snapshot.league) {
          const r = await pj.league(row.snapshot.league, row.snapshot.rosters || [], projPool(row.snapshot.league, Object.keys(row.snapshot.proj || {})));
          row.snapshot.dhq_proj = { week: r.week, built_at: new Date().toISOString(), players: r.proj, inputs: r.data, app: r.app };
          console.log('  dhq projections:', r.projected, 'players (', r.no_line, 'without a Sleeper line ) in', (r.ms / 1000).toFixed(1) + 's, week', r.week);
          // Later weeks (Phase A3): a minute or two a league, so built at
          // most every 12 hours, and only in the first half of the run's
          // time budget; otherwise the last build's carries over while it
          // still fits (same projection model and current week; the app
          // takes it up to 24 hours old).
          const prev = db ? ((await db.select('league_intel', 'select=later:snapshot->dhq_later&league_id=eq.' + lid).catch(() => []))[0] || {}).later : null;
          const fits = prev && prev.model === r.app.model && Number(prev.cur) === Number(r.week);
          if (fits && Date.now() - Date.parse(prev.built_at) < 12 * 60 * 60 * 1000) row.snapshot.dhq_later = prev;
          // A standby build (a member waiting on a new league) leaves them to
          // the next scheduled build, so the builder is free again in about
          // half a minute instead of two; the app projects later weeks
          // itself meanwhile, as it does for any league without them.
          else if ((PARTIAL && !STANDBY) || (!PARTIAL && Date.now() - t0 < BUDGET_MS / 2)) {
            try {
              const lt = await pj.later(row.snapshot.league, row.snapshot.rosters || []);
              console.log('  later weeks:', Object.keys(lt.weeks).join(',') || 'none', 'in', (lt.ms / 1000).toFixed(1) + 's');
              delete lt.ms;
              row.snapshot.dhq_later = lt;
            } catch (e) { console.warn('  later weeks failed for', lid + ':', e && e.message || e); if (fits) row.snapshot.dhq_later = prev; }
          } else if (fits) row.snapshot.dhq_later = prev;
        }
      } catch (e) { console.warn('  dhq projections failed for', lid + ':', e && e.message || e); }
      appTexts(row);
      const valued = Object.keys(row.intel.playerScores || {}).length;
      ((row.snapshot || {}).rosters || []).forEach(r => (r.players || []).forEach(pid => rostered.add(String(pid))));
      console.log('✓', row.name, '(' + lid + ')', 'in', (row.build_ms / 1000).toFixed(1) + 's ·', valued, 'players valued ·', row.assessments.length, 'teams');
      delete row.brainPack; // stored as the app's text in the snapshot only
      if (db) await db.upsert('league_intel', [Object.assign(row, { error: null })]);
      else fs.writeFileSync(path.join(OUT, lid + '.json'), JSON.stringify(row));
      ok++; builtIds.push(lid);
      // A request taken mid-run is marked now, so the request watcher doesn't build it again.
      if (db && injected.has(lid)) await db.update('build_requests', 'league_id=eq.' + lid, { status: 'built', last_built_at: new Date().toISOString(), last_error: null }).catch(() => {});
    } catch (e) {
      failed++;
      console.error('✗', lid, e && e.message || e);
      failedIds[lid] = String(e && e.message || e).slice(0, 300);
      if (db && !PARTIAL) await db.upsert('league_intel', [{ league_id: lid, platform: 'sleeper', built_at: new Date().toISOString(), engine_version: ENGINE_VERSION, intel: {}, assessments: [], snapshot: {}, error: String(e && e.message || e).slice(0, 500) }]).catch(() => {});
    }
  }

  // Record request leagues' outcomes (rows exist only for requested leagues,
  // so a PATCH never creates one).
  if (db) {
    const now = new Date().toISOString();
    if (builtIds.length) await db.update('build_requests', 'league_id=in.(' + builtIds.join(',') + ')', { status: 'built', last_built_at: now, last_error: null }).catch(e => console.warn('build requests:', e.message));
    for (const [lid, err] of Object.entries(failedIds)) await db.update('build_requests', 'league_id=eq.' + encodeURIComponent(lid), { status: PARTIAL ? 'failed' : 'built', last_error: err }).catch(() => {});
  }
  if (PARTIAL) {
    if (db) await db.upsert('engine_runs', [{ started_at: started, finished_at: new Date().toISOString(), engine_version: ENGINE_VERSION, leagues_ok: ok, leagues_failed: failed, notes: process.env.ENGINE_RUNNER || null, kind: 'partial' }]).catch(e => console.warn('run log:', e.message));
    console.log('done (request build):', ok, 'built,', failed, 'failed, total', ((Date.now() - t0) / 1000).toFixed(1) + 's');
    process.exit(failed && !ok ? 1 : 0);
  }

  // Shared lookups the server needs beside the leagues.
  const players = slimPlayers(shared.players);
  const trending = await sleeper('/players/nfl/trending/add?lookback_hours=24&limit=50').catch(() => []);
  const espn = await espnTeamData(shared.players).catch(e => { console.warn('espn news:', e.message); return null; });
  if (espn) {
    Object.entries(espn.ids).forEach(([pid, id]) => { if (players[pid]) players[pid].e = id; });
    console.log('news:', espn.teams, 'teams,', Object.values(espn.news).reduce((t, l) => t + l.length, 0), 'headlines,', Object.keys(espn.ids).length, 'player ids matched by name');
  }
  const news = { fetched_at: espn ? espn.fetched_at : null, teams: espn ? espn.news : {} };

  // The player news index: every story linked to the players it touches.
  // Last run's player reports ride in engine_cache so only changed ones
  // are fetched again. A failure here never fails the build.
  let newsIndex = null;
  try {
    const prior = histCache ? await histCache.get('news_reports') : null;
    newsIndex = await buildNewsIndex(shared.players, espn ? espn.ids : {}, rostered, prior || {});
    console.log('news index:', JSON.stringify(newsIndex.counts), 'in', (newsIndex.ms / 1000).toFixed(1) + 's');
  } catch (e) { console.warn('news index:', e && e.message || e); }
  if (db) {
    await db.upsert('engine_cache', [
      { key: 'players', data: players, updated_at: new Date().toISOString() },
      { key: 'nfl_state', data: shared.nfl, updated_at: new Date().toISOString() },
      { key: 'trending_add', data: trending || [], updated_at: new Date().toISOString() },
      { key: 'nfl_week', data: { week: shared.week, games: shared.weekGames || {} }, updated_at: new Date().toISOString() },
      { key: 'news', data: news, updated_at: new Date().toISOString() },
    ]);
    if (newsIndex) {
      try {
        const now = new Date().toISOString();
        for (let i = 0; i < newsIndex.rows.length; i += 500) await db.upsert('player_news', newsIndex.rows.slice(i, i + 500).map(r => Object.assign({}, r, { updated_at: now })));
        await db.upsert('engine_cache', [
          { key: 'news_reports', data: newsIndex.reports, updated_at: now },
          { key: 'news_index', data: { fetched_at: newsIndex.fetched_at, counts: newsIndex.counts }, updated_at: now },
        ]);
      } catch (e) { console.warn('news store:', e.message); }
    }
    await db.upsert('engine_runs', [{ started_at: started, finished_at: new Date().toISOString(), engine_version: ENGINE_VERSION, leagues_ok: ok, leagues_failed: failed, notes: process.env.ENGINE_RUNNER || null }]).catch(e => console.warn('run log:', e.message));
  } else {
    fs.writeFileSync(path.join(OUT, 'players.json'), JSON.stringify(players));
    fs.writeFileSync(path.join(OUT, 'nfl_week.json'), JSON.stringify({ week: shared.week, games: shared.weekGames || {} }));
    fs.writeFileSync(path.join(OUT, 'news.json'), JSON.stringify(news));
    if (newsIndex) fs.writeFileSync(path.join(OUT, 'player_news.json'), JSON.stringify(newsIndex.rows));
  }
  if (skipped) console.log('time budget reached:', skipped, 'league(s) left for the next run');
  console.log('done:', ok, 'built,', failed, 'failed, total', ((Date.now() - t0) / 1000).toFixed(1) + 's; players table', Object.keys(players).length);
  process.exit(failed && !ok ? 1 : 0);
})().catch(e => { console.error('RUN FAILED:', e && e.stack || e); process.exit(1); });

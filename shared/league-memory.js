// ══════════════════════════════════════════════════════════════════
// shared/league-memory.js — League Memory: persistent intelligence
// Captures trade outcomes, roster changes, owner shifts, user prefs,
// and AI accuracy — compounds over time to make AI smarter.
// ══════════════════════════════════════════════════════════════════

window.App = window.App || {};

const MEMORY_TABLE = 'league_memory';
const MEMORY_CACHE_KEY = lid => `dhq_league_mem_${lid}`;
const MAX_MEMORY_ENTRIES = 50;
const MEMORY_TYPES = ['trade_outcome','waiver_hit','owner_shift','season_narrative','user_preference','ai_accuracy','roster_change'];

// In-memory session cache: leagueId -> entries[]
const _memCache = {};

// ── SQL schema (log once so user can run in Supabase) ───────────
(function logSchema() {
  try {
    const key = 'dhq_mem_schema_logged';
    if (localStorage.getItem(key)) return;
    console.log(
      '%c[LeagueMemory] Run this SQL in Supabase to create the league_memory table:\n\n' +
      'create table if not exists public.league_memory (\n' +
      '  id uuid primary key default gen_random_uuid(),\n' +
      '  league_id text not null,\n' +
      '  username text not null references public.users(sleeper_username) on delete cascade,\n' +
      '  type text not null,\n' +
      '  content jsonb not null default \'{}\'::jsonb,\n' +
      '  season text,\n' +
      '  week int,\n' +
      '  created_at timestamptz default now()\n' +
      ');\n' +
      'create index idx_league_memory_lookup on league_memory(league_id, username, created_at desc);\n',
      'color: #7c6bf8; font-weight: bold'
    );
    localStorage.setItem(key, '1');
  } catch (e) {}
})();

// ── Helpers ──────────────────────────────────────────────────────

function _username() {
  try { return window.S?.user?.username || localStorage.getItem('dynastyhq_username') || ''; } catch (e) { return ''; }
}

function _season() {
  try { return window.S?.nflState?.season || window.S?.season || String(new Date().getFullYear()); } catch (e) { return String(new Date().getFullYear()); }
}

function _week() {
  try { return window.S?.nflState?.display_week || window.S?.currentWeek || 1; } catch (e) { return 1; }
}

function _lsKey(lid) { return MEMORY_CACHE_KEY(lid); }

function _lsLoad(lid) {
  try { return JSON.parse(localStorage.getItem(_lsKey(lid)) || '[]'); } catch (e) { return []; }
}

function _lsSave(lid, entries) {
  try {
    const trimmed = entries.slice(0, MAX_MEMORY_ENTRIES);
    localStorage.setItem(_lsKey(lid), JSON.stringify(trimmed));
  } catch (e) {}
}

// ── Core: Save ──────────────────────────────────────────────────

async function saveMemoryEntry(leagueId, type, content) {
  if (!leagueId || !type) return;
  try {
    const entry = {
      league_id: leagueId,
      username: _username(),
      type,
      content: content || {},
      season: _season(),
      week: _week(),
      created_at: new Date().toISOString(),
    };

    // Try Supabase first
    let saved = false;
    try {
      const db = window.OD?.getClient ? window.OD.getClient() : null;
      if (db) {
        const { error } = await db.from(MEMORY_TABLE).insert([entry]);
        if (!error) saved = true;
        else console.warn('[LeagueMemory] Supabase save error:', error.message);
      }
    } catch (e) { console.warn('[LeagueMemory] Supabase save failed:', e); }

    // Always save to localStorage as backup/fallback
    const local = _lsLoad(leagueId);
    local.unshift(entry);
    _lsSave(leagueId, local);

    // Update session cache
    if (_memCache[leagueId]) {
      _memCache[leagueId].unshift(entry);
      _memCache[leagueId] = _memCache[leagueId].slice(0, MAX_MEMORY_ENTRIES);
    }

    if (saved) console.log('[LeagueMemory] Saved to Supabase:', type);
    else console.log('[LeagueMemory] Saved to localStorage:', type);
  } catch (e) {
    console.warn('[LeagueMemory] saveMemoryEntry error:', e);
  }
}

// ── Core: Load ──────────────────────────────────────────────────

async function loadLeagueMemory(leagueId, limit = 20) {
  if (!leagueId) return [];

  // Return from session cache if available
  if (_memCache[leagueId]) return _memCache[leagueId].slice(0, limit);

  let entries = [];

  // Try Supabase first
  try {
    const db = window.OD?.getClient ? window.OD.getClient() : null;
    if (db) {
      const { data, error } = await db
        .from(MEMORY_TABLE)
        .select('*')
        .eq('league_id', leagueId)
        .eq('username', _username())
        .order('created_at', { ascending: false })
        .limit(MAX_MEMORY_ENTRIES);
      if (!error && data?.length) {
        entries = data;
        console.log('[LeagueMemory] Loaded', entries.length, 'entries from Supabase');
      }
    }
  } catch (e) { console.warn('[LeagueMemory] Supabase load failed:', e); }

  // Fallback to localStorage
  if (!entries.length) {
    entries = _lsLoad(leagueId);
    if (entries.length) console.log('[LeagueMemory] Loaded', entries.length, 'entries from localStorage');
  }

  // Cache for session
  _memCache[leagueId] = entries.slice(0, MAX_MEMORY_ENTRIES);
  return entries.slice(0, limit);
}

// ── Core: Build context string for AI injection ─────────────────

async function buildMemoryContext(leagueId) {
  if (!leagueId) return '';
  try {
    const entries = await loadLeagueMemory(leagueId, 20);
    if (!entries.length) return '';

    const lines = entries.map(e => {
      try {
        const d = new Date(e.created_at);
        const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const c = e.content || {};
        switch (e.type) {
          case 'trade_outcome':
            return `- (${dateStr}) Trade: ${c.summary || 'Trade completed'}${c.valueDiff ? '. Value diff: ' + c.valueDiff + ' DHQ' : ''}`;
          case 'waiver_hit':
            return `- (${dateStr}) Waiver: ${c.summary || 'Waiver move'}${c.dhqNow ? '. Current DHQ: ' + c.dhqNow : ''}`;
          case 'owner_shift':
            return `- (${dateStr}) Owner shift: ${c.summary || 'Activity change detected'}`;
          case 'season_narrative':
            return `- (Season narrative) ${c.summary || ''}`;
          case 'user_preference':
            return `- (Preference) ${c.summary || ''}`;
          case 'ai_accuracy':
            return `- (AI track record) ${c.summary || ''}`;
          case 'roster_change':
            return `- (${dateStr}) Roster: ${c.summary || 'Roster change'}`;
          default:
            return `- (${dateStr}) ${c.summary || e.type}`;
        }
      } catch (e) { return null; }
    }).filter(Boolean);

    if (!lines.length) return '';
    return '[LEAGUE_MEMORY]\n' + lines.join('\n');
  } catch (e) {
    console.warn('[LeagueMemory] buildMemoryContext error:', e);
    return '';
  }
}

// ── Capture: Roster Diff ────────────────────────────────────────

async function captureRosterDiff(leagueId) {
  try {
    const roster = window.myR ? window.myR() : null;
    if (!roster?.players?.length) return;

    const snapKey = `dhq_roster_snap_${leagueId}`;
    const prev = JSON.parse(localStorage.getItem(snapKey) || '[]');
    const curr = roster.players;

    if (!prev.length) {
      // First snapshot — just save, no diff
      localStorage.setItem(snapKey, JSON.stringify(curr));
      return;
    }

    const prevSet = new Set(prev);
    const currSet = new Set(curr);
    const added = curr.filter(p => !prevSet.has(p));
    const dropped = prev.filter(p => !currSet.has(p));

    if (added.length || dropped.length) {
      const pName = window.pName || (id => id);
      const addedNames = added.map(p => pName(p)).join(', ');
      const droppedNames = dropped.map(p => pName(p)).join(', ');
      let summary = '';
      if (added.length) summary += 'Added: ' + addedNames + '. ';
      if (dropped.length) summary += 'Dropped: ' + droppedNames + '.';

      await saveMemoryEntry(leagueId, 'roster_change', {
        summary: summary.trim(),
        added,
        dropped,
        rosterSize: curr.length,
      });
    }

    // Update snapshot
    localStorage.setItem(snapKey, JSON.stringify(curr));
  } catch (e) {
    console.warn('[LeagueMemory] captureRosterDiff error:', e);
  }
}

// ── Capture: Trade Outcomes ─────────────────────────────────────

async function captureTradeOutcomes(leagueId) {
  try {
    const LI = window.App?.LI || {};
    const trades = LI.tradeHistory;
    if (!trades?.length) return;

    const myRid = window.S?.myRosterId;
    if (!myRid) return;

    const seenKey = `dhq_trade_mem_seen_${leagueId}`;
    const seen = JSON.parse(localStorage.getItem(seenKey) || '[]');
    const seenSet = new Set(seen);
    const pName = window.pName || (id => id);

    for (const t of trades) {
      if (!t.roster_ids?.includes(myRid)) continue;

      // Unique key for this trade
      const tKey = (t.ts || '') + '_' + (t.roster_ids || []).join('-');
      if (seenSet.has(tKey)) continue;

      // Build summary
      const mySide = (t.sides || []).find(s => s.rosterId === myRid);
      const otherSide = (t.sides || []).find(s => s.rosterId !== myRid);
      if (!mySide || !otherSide) continue;

      const gave = (mySide.players || []).map(p => pName(p)).join(', ') || 'nothing';
      const got = (otherSide.players || []).map(p => pName(p)).join(', ') || 'nothing';
      const pickGave = mySide.picks || 0;
      const pickGot = otherSide.picks || 0;

      let summary = `Gave: ${gave}`;
      if (pickGave) summary += ` + ${pickGave} pick(s)`;
      summary += `. Got: ${got}`;
      if (pickGot) summary += ` + ${pickGot} pick(s)`;
      if (t.valueDiff) summary += `. Net value: ${t.valueDiff > 0 ? '+' : ''}${t.valueDiff} DHQ`;

      await saveMemoryEntry(leagueId, 'trade_outcome', {
        summary,
        fairness: t.fairness,
        valueDiff: t.valueDiff,
        season: t.season,
        week: t.week,
      });

      seenSet.add(tKey);
    }

    localStorage.setItem(seenKey, JSON.stringify([...seenSet].slice(-100)));
  } catch (e) {
    console.warn('[LeagueMemory] captureTradeOutcomes error:', e);
  }
}

// ── Capture: Owner Shifts ───────────────────────────────────────

async function captureOwnerShifts(leagueId) {
  try {
    const LI = window.App?.LI || {};
    const profiles = LI.ownerProfiles;
    if (!profiles || !Object.keys(profiles).length) return;

    const snapKey = `dhq_owner_snap_${leagueId}`;
    const prev = JSON.parse(localStorage.getItem(snapKey) || '{}');
    const getUser = window.getUser || (id => 'Team ' + id);

    let shifted = false;

    for (const [rid, profile] of Object.entries(profiles)) {
      const prevTrades = prev[rid]?.trades || 0;
      const currTrades = profile.trades || 0;
      const diff = currTrades - prevTrades;

      // Flag if an owner made 3+ more trades since last check
      if (diff >= 3) {
        const ownerName = getUser(window.S?.rosters?.find(r => r.roster_id == rid)?.owner_id);
        const dna = profile.dna || 'unknown';
        await saveMemoryEntry(leagueId, 'owner_shift', {
          summary: `${ownerName} made ${diff} new trades (DNA: ${dna}). Was ${prevTrades} trades, now ${currTrades}.`,
          rosterId: rid,
          tradesBefore: prevTrades,
          tradesAfter: currTrades,
          dna,
        });
        shifted = true;
      }
    }

    // Update snapshot
    const snap = {};
    for (const [rid, profile] of Object.entries(profiles)) {
      snap[rid] = { trades: profile.trades || 0 };
    }
    localStorage.setItem(snapKey, JSON.stringify(snap));

    if (shifted) console.log('[LeagueMemory] Owner shift(s) detected and saved');
  } catch (e) {
    console.warn('[LeagueMemory] captureOwnerShifts error:', e);
  }
}

// ── Capture: User Preferences ───────────────────────────────────

function captureUserPreferences(question) {
  try {
    if (!question || typeof question !== 'string') return;
    const lid = window.S?.currentLeagueId;
    if (!lid) return;

    const prefKey = `dhq_user_prefs_${lid}`;
    const prefs = JSON.parse(localStorage.getItem(prefKey) || '{"questions":0,"topics":{}}');

    // Detect position mentions
    const posPatterns = { QB: /\bqb\b/i, RB: /\brb\b/i, WR: /\bwr\b/i, TE: /\bte\b/i, DL: /\bd[le]\b/i, LB: /\blb\b/i, DB: /\bdb\b|safety|corner/i };
    for (const [pos, rx] of Object.entries(posPatterns)) {
      if (rx.test(question)) prefs.topics[pos] = (prefs.topics[pos] || 0) + 1;
    }

    // Detect action mentions
    const actionPatterns = { trade: /\btrad(e|ing)\b/i, sell: /\bsell\b/i, buy: /\bbuy\b/i, waiver: /\bwaiver|pickup|add\b/i, draft: /\bdraft\b/i, rebuild: /\brebuild\b/i };
    for (const [action, rx] of Object.entries(actionPatterns)) {
      if (rx.test(question)) prefs.topics[action] = (prefs.topics[action] || 0) + 1;
    }

    prefs.questions = (prefs.questions || 0) + 1;
    localStorage.setItem(prefKey, JSON.stringify(prefs));

    // After 5+ questions, save a summary memory entry (every 5 questions)
    if (prefs.questions >= 5 && prefs.questions % 5 === 0) {
      const sorted = Object.entries(prefs.topics).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (sorted.length) {
        const topTopics = sorted.map(([k, v]) => `${k} (${v}x)`).join(', ');
        saveMemoryEntry(lid, 'user_preference', {
          summary: `User frequently asks about: ${topTopics}. Total questions: ${prefs.questions}.`,
          topics: prefs.topics,
          totalQuestions: prefs.questions,
        });
      }
    }
  } catch (e) {
    console.warn('[LeagueMemory] captureUserPreferences error:', e);
  }
}

// ── Capture: AI Accuracy ────────────────────────────────────────

async function captureAIAccuracy(leagueId) {
  try {
    const entries = await loadLeagueMemory(leagueId, 50);
    if (!entries.length) return;

    const LI = window.App?.LI || {};
    const scores = LI.playerScores || {};
    let checked = 0;
    let goodCalls = 0;
    let badCalls = 0;

    for (const e of entries) {
      if (e.type !== 'trade_outcome' && e.type !== 'waiver_hit') continue;
      const c = e.content || {};
      if (!c.playerIds) continue;

      // Check if recommended players gained or lost value
      for (const pid of (c.playerIds || [])) {
        const currVal = scores[pid];
        const savedVal = c.valueThen?.[pid];
        if (!currVal || !savedVal) continue;

        checked++;
        const diff = currVal - savedVal;
        if (c.action === 'buy' && diff > 200) goodCalls++;
        else if (c.action === 'sell' && diff < -200) goodCalls++;
        else if (c.action === 'buy' && diff < -200) badCalls++;
        else if (c.action === 'sell' && diff > 200) badCalls++;
      }
    }

    if (checked >= 3) {
      const pct = Math.round((goodCalls / checked) * 100);
      await saveMemoryEntry(leagueId, 'ai_accuracy', {
        summary: `AI track record: ${goodCalls}/${checked} recommendations were good calls (${pct}%).`,
        goodCalls,
        badCalls,
        checked,
        accuracy: pct,
      });
    }
  } catch (e) {
    console.warn('[LeagueMemory] captureAIAccuracy error:', e);
  }
}

// ── Auto-capture: Run after loadAllData ─────────────────────────

async function runMemoryCapture(leagueId) {
  if (!leagueId) return;
  console.log('[LeagueMemory] Running memory capture for league:', leagueId);
  try {
    await captureRosterDiff(leagueId);
  } catch (e) { console.warn('[LeagueMemory] rosterDiff capture error:', e); }
  try {
    await captureTradeOutcomes(leagueId);
  } catch (e) { console.warn('[LeagueMemory] tradeOutcomes capture error:', e); }
  try {
    await captureOwnerShifts(leagueId);
  } catch (e) { console.warn('[LeagueMemory] ownerShifts capture error:', e); }
  try {
    await captureAIAccuracy(leagueId);
  } catch (e) { console.warn('[LeagueMemory] aiAccuracy capture error:', e); }
  console.log('[LeagueMemory] Memory capture complete');
}

// ── Exports ─────────────────────────────────────────────────────

Object.assign(window.App, { saveMemoryEntry, loadLeagueMemory, buildMemoryContext, runMemoryCapture, captureUserPreferences });
Object.assign(window, { buildMemoryContext, runMemoryCapture, captureUserPreferences });

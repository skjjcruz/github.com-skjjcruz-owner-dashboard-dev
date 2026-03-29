// ══════════════════════════════════════════════════════════════════
// shared/supabase-client.js — Fantasy Wars Supabase Data Layer
// Shared by ReconAI and War Room
//
// Requires: Supabase CDN loaded before this script
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
// ══════════════════════════════════════════════════════════════════

window.App = window.App || {};
window.OD = window.OD || {};

const SUPABASE_URL  = 'https://sxshiqyxhhifvtfqawbq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c2hpcXl4aGhpZnZ0ZnFhd2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTExMzAsImV4cCI6MjA4ODI4NzEzMH0.zJi9W986ZLaANiZN6pt6ReFwaQU6yPeidsERIWo2ibI';

// ── Session token storage ─────────────────────────────────────
const SESSION_LS_KEY = 'od_session_v1';
const FW_SESSION_KEY = 'fw_session_v1';

function getSessionToken() {
    // New email-based session (Fantasy Wars landing)
    try {
        const raw = localStorage.getItem(FW_SESSION_KEY);
        if (raw) {
            const s = JSON.parse(raw);
            if (s?.token) return s.token;
        }
    } catch {}
    // Legacy Sleeper session
    try {
        const raw = localStorage.getItem(SESSION_LS_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s?.token || !s?.expiresAt) return null;
        if (Date.now() >= new Date(s.expiresAt).getTime() - 5 * 60 * 1000) return null;
        return s.token;
    } catch { return null; }
}

// ── Bootstrap Supabase client ─────────────────────────────────
let _supabase = null;
let _supabaseToken = null;

function getClient() {
    if (typeof window.supabase === 'undefined') {
        console.warn('[FW] Supabase CDN not loaded — falling back to localStorage only');
        return null;
    }
    const token = getSessionToken();
    if (_supabase && _supabaseToken === token) return _supabase;
    const opts = token
        ? { global: { headers: { Authorization: `Bearer ${token}` } } }
        : {};
    _supabase      = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, opts);
    _supabaseToken = token;
    return _supabase;
}

function isConfigured() {
    return SUPABASE_URL !== 'YOUR_SUPABASE_URL' &&
           SUPABASE_ANON !== 'YOUR_SUPABASE_ANON_KEY';
}

// ── Username helper ───────────────────────────────────────────
// Works for both War Room (od_auth_v1) and ReconAI (dynastyhq_username)
function getCurrentUsername() {
    // War Room auth
    try {
        const raw = localStorage.getItem('od_auth_v1');
        if (raw) {
            const auth = JSON.parse(raw);
            if (auth?.sleeperUsername || auth?.username) return auth.sleeperUsername || auth.username;
        }
    } catch {}
    // ReconAI auth
    try {
        return localStorage.getItem('dynastyhq_username') || null;
    } catch { return null; }
}

// ── Ensure user row exists ────────────────────────────────────
async function ensureUser(username) {
    const db = getClient();
    if (!db || !username) return;
    await db.from('users').upsert(
        { sleeper_username: username },
        { onConflict: 'sleeper_username', ignoreDuplicates: true }
    );
}

// ══════════════════════════════════════════════════════════════════
// AUTH — Session token acquisition
// Sleeper username → JWT via Edge Function → RLS enforced
// ══════════════════════════════════════════════════════════════════

window.OD.acquireSessionToken = async function(username, password) {
    if (!isConfigured() || !username) return null;
    try {
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/get-session-token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON,
            },
            body: JSON.stringify({ username, password: password || undefined }),
        });
        if (!resp.ok) return null;
        const session = await resp.json();
        if (!session?.token) return null;
        localStorage.setItem(SESSION_LS_KEY, JSON.stringify(session));
        _supabase = null;
        _supabaseToken = null;
        return session;
    } catch { return null; }
};

// ══════════════════════════════════════════════════════════════════
// AI ANALYSIS — Server-side AI via Edge Function
// ══════════════════════════════════════════════════════════════════

window.OD.callAI = async function({ type, context }) {
    const token = getSessionToken();
    const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-analyze`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token || SUPABASE_ANON}`,
            'apikey': SUPABASE_ANON,
        },
        body: JSON.stringify({ type, context }),
    });
    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const error = new Error(err.error || `AI call failed (${response.status})`);
        error.status = response.status;
        if (err.usage) error.usage = err.usage;
        if (err.limit) error.limit = err.limit;
        if (err.used) error.used = err.used;
        throw error;
    }
    return response.json();
};

window.OD.saveAIAnalysis = async function(leagueId, type, contextSummary, analysis) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('ai_analysis').insert({
        username, league_id: leagueId, type,
        context_summary: contextSummary || '',
        analysis,
    });
    if (error) console.warn('[FW] ai_analysis save error', error);
};

window.OD.loadAIHistory = async function(leagueId) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return [];
    const { data, error } = await db
        .from('ai_analysis')
        .select('id, type, context_summary, analysis, created_at')
        .eq('username', username)
        .eq('league_id', leagueId)
        .order('created_at', { ascending: false })
        .limit(20);
    if (error) return [];
    return data || [];
};

// ══════════════════════════════════════════════════════════════════
// USER PROFILE
// ══════════════════════════════════════════════════════════════════

window.OD.ensureUser = ensureUser;

window.OD.saveProfile = async function(profile) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('users').update({
        tier:                profile.tier               || 'free',
        fantasy_platforms:   profile.platforms          || ['sleeper'],
        onboarding_complete: profile.onboardingComplete || false,
    }).eq('sleeper_username', username);
    if (error) console.warn('[FW] profile save error', error);
};

window.OD.loadProfile = async function() {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db
        .from('users')
        .select('tier, fantasy_platforms, onboarding_complete')
        .eq('sleeper_username', username)
        .maybeSingle();
    if (error || !data) return null;
    return {
        tier:               data.tier               || 'free',
        platforms:          data.fantasy_platforms  || ['sleeper'],
        onboardingComplete: data.onboarding_complete || false,
    };
};

// ══════════════════════════════════════════════════════════════════
// DISPLAY NAME
// ══════════════════════════════════════════════════════════════════

window.OD.loadDisplayName = async function() {
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const db = getClient();
        const { data } = await db.from('users').select('display_name').eq('sleeper_username', username).maybeSingle();
        if (data && data.display_name) {
            localStorage.setItem('od_display_name', data.display_name);
            return data.display_name;
        }
    }
    return localStorage.getItem('od_display_name') || '';
};

window.OD.saveDisplayName = function(name) {
    localStorage.setItem('od_display_name', name);
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const db = getClient();
        ensureUser(username).then(() => {
            db.from('users').update({ display_name: name || null }).eq('sleeper_username', username).then(({ error }) => {
                if (error) console.warn('[FW] display_name save error', error);
            });
        }).catch(console.warn);
    }
};

// ══════════════════════════════════════════════════════════════════
// OWNER DNA PROFILES
// ══════════════════════════════════════════════════════════════════

window.OD.loadDNA = async function(leagueId) {
    let local = {};
    try {
        const raw = localStorage.getItem(`od_owner_dna_v1_${leagueId}`);
        if (raw) local = JSON.parse(raw);
    } catch {}
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const db = getClient();
        if (db) {
            const { data } = await db.from('owner_dna').select('dna_map')
                .eq('username', username).eq('league_id', leagueId).maybeSingle();
            if (data) {
                const merged = { ...local, ...(data.dna_map || {}) };
                localStorage.setItem(`od_owner_dna_v1_${leagueId}`, JSON.stringify(merged));
                return merged;
            }
        }
    }
    return local;
};

window.OD.saveDNA = function(leagueId, dnaMap) {
    localStorage.setItem(`od_owner_dna_v1_${leagueId}`, JSON.stringify(dnaMap));
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const db = getClient();
        if (db) {
            ensureUser(username).then(() => {
                db.from('owner_dna').upsert(
                    { username, league_id: leagueId, dna_map: dnaMap, updated_at: new Date().toISOString() },
                    { onConflict: 'username,league_id' }
                );
            }).catch(console.warn);
        }
    }
};

// ══════════════════════════════════════════════════════════════════
// STATUS + HELPERS
// ══════════════════════════════════════════════════════════════════

window.OD.getSessionToken = getSessionToken;
window.OD.getClient = getClient;
window.OD.isConfigured = isConfigured;
window.OD.getCurrentUsername = getCurrentUsername;
window.OD.SUPABASE_URL = SUPABASE_URL;
window.OD.SUPABASE_ANON = SUPABASE_ANON;

window.OD.status = function() {
    if (!isConfigured()) return console.log('[FW] Supabase not configured — using localStorage only');
    const db = getClient();
    if (!db) return console.log('[FW] Supabase CDN not loaded');
    const token = getSessionToken();
    console.log('[FW] Supabase connected:', SUPABASE_URL);
    console.log('[FW] Current user:', getCurrentUsername() || '(not logged in)');
    console.log('[FW] Session token:', token ? 'valid' : 'none — DB writes will be blocked by RLS');
};

// ══════════════════════════════════════════════════════════════════
// CALENDAR EVENTS (War Room)
// ══════════════════════════════════════════════════════════════════
const CALENDAR_LS_KEY = 'od_calendar_events';

async function dbLoadCalendarEvents(username) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db.from('calendar_events').select('*').eq('username', username);
    if (error) { console.warn('[FW] calendar load error', error); return null; }
    return data.map(row => ({ id: row.id, title: row.title, date: row.date, time: row.time, league: row.league, details: row.details }));
}

async function dbSaveCalendarEvents(username, events) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const rows = events.map(e => ({ id: e.id, username, title: e.title, date: e.date, time: e.time || '', league: e.league || '', details: e.details || '' }));
    if (rows.length > 0) {
        const { error } = await db.from('calendar_events').upsert(rows, { onConflict: 'id' });
        if (error) console.warn('[FW] calendar save error', error);
    }
    const { data: existing } = await db.from('calendar_events').select('id').eq('username', username);
    const keepIds = new Set(events.map(e => e.id));
    const toDelete = (existing || []).map(r => r.id).filter(id => !keepIds.has(id));
    if (toDelete.length > 0) await db.from('calendar_events').delete().in('id', toDelete);
}

window.OD.loadCalendarEvents = async function(defaultEvents) {
    let local = null;
    try { const raw = localStorage.getItem(CALENDAR_LS_KEY); if (raw) local = JSON.parse(raw); } catch {}
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadCalendarEvents(username);
        if (remote !== null) {
            const remoteIds = new Set(remote.map(e => e.id));
            const missingDefaults = (defaultEvents || []).filter(d => !remoteIds.has(d.id));
            const merged = [...remote, ...missingDefaults];
            localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(merged));
            return merged;
        }
    }
    if (local) {
        const localIds = new Set(local.map(e => e.id));
        const missing = (defaultEvents || []).filter(d => !localIds.has(d.id));
        if (missing.length > 0) { const merged = [...local, ...missing]; localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(merged)); return merged; }
        return local;
    }
    localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(defaultEvents || []));
    return defaultEvents || [];
};

window.OD.saveCalendarEvents = function(events) {
    localStorage.setItem(CALENDAR_LS_KEY, JSON.stringify(events));
    const username = getCurrentUsername();
    if (isConfigured() && username) dbSaveCalendarEvents(username, events).catch(console.warn);
};

// ══════════════════════════════════════════════════════════════════
// EARNINGS (War Room)
// ══════════════════════════════════════════════════════════════════
const EARNINGS_LS_KEY = 'od_earnings_entries';

async function dbLoadEarnings(username) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db.from('earnings').select('*').eq('username', username);
    if (error) { console.warn('[FW] earnings load error', error); return null; }
    return data.map(row => ({ id: row.id, year: row.year, league: row.league, description: row.description, amount: row.amount }));
}

async function dbSaveEarnings(username, entries) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    if (entries.length > 0) {
        const rows = entries.map(e => ({ id: e.id, username, year: e.year, league: e.league || '', description: e.description || '', amount: e.amount }));
        const { error } = await db.from('earnings').upsert(rows, { onConflict: 'id' });
        if (error) console.warn('[FW] earnings save error', error);
    }
    const { data: existing } = await db.from('earnings').select('id').eq('username', username);
    const keepIds = new Set(entries.map(e => e.id));
    const toDelete = (existing || []).map(r => r.id).filter(id => !keepIds.has(id));
    if (toDelete.length > 0) await db.from('earnings').delete().in('id', toDelete);
}

window.OD.loadEarnings = async function() {
    let local = null;
    try { const raw = localStorage.getItem(EARNINGS_LS_KEY); if (raw) local = JSON.parse(raw); } catch {}
    const username = getCurrentUsername();
    if (isConfigured() && username) {
        const remote = await dbLoadEarnings(username);
        if (remote !== null) { localStorage.setItem(EARNINGS_LS_KEY, JSON.stringify(remote)); return remote; }
    }
    return local || [];
};

window.OD.saveEarnings = function(entries) {
    localStorage.setItem(EARNINGS_LS_KEY, JSON.stringify(entries));
    const username = getCurrentUsername();
    if (isConfigured() && username) dbSaveEarnings(username, entries).catch(console.warn);
};

// ══════════════════════════════════════════════════════════════════
// FREE AGENCY TARGETS (War Room)
// ══════════════════════════════════════════════════════════════════
const FA_LS_KEY = id => `od_fa_targets_v1_${id}`;

async function dbLoadTargets(username, leagueId) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return null;
    const { data, error } = await db.from('fa_targets').select('*').eq('username', username).eq('league_id', leagueId).maybeSingle();
    if (error) { console.warn('[FW] fa load error', error); return null; }
    if (!data) return null;
    return { startingBudget: data.starting_budget, targets: data.targets || [] };
}

async function dbSaveTargets(username, leagueId, faData) {
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await ensureUser(username);
    const { error } = await db.from('fa_targets').upsert(
        { username, league_id: leagueId, starting_budget: faData.startingBudget, targets: faData.targets, updated_at: new Date().toISOString() },
        { onConflict: 'username,league_id' }
    );
    if (error) console.warn('[FW] fa save error', error);
}

window.OD.loadTargets = async function(leagueId) {
    let local = null;
    try { const raw = localStorage.getItem(FA_LS_KEY(leagueId)); if (raw) local = JSON.parse(raw); } catch {}
    const username = getCurrentUsername();
    if (isConfigured() && username) { const remote = await dbLoadTargets(username, leagueId); if (remote !== null) return remote; }
    return local || { startingBudget: 1000, targets: [] };
};

window.OD.saveTargets = function(leagueId, data) {
    localStorage.setItem(FA_LS_KEY(leagueId), JSON.stringify(data));
    const username = getCurrentUsername();
    if (isConfigured() && username) dbSaveTargets(username, leagueId, data).catch(console.warn);
};

// ══════════════════════════════════════════════════════════════════
// DIRECT MESSAGES (War Room)
// ══════════════════════════════════════════════════════════════════

window.OD.sendDM = async function(toUsername, body) {
    const from = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !from) throw new Error('Not configured');
    await ensureUser(from);
    const { error } = await db.from('messages').insert({ from_username: from, to_username: toUsername, body });
    if (error) throw error;
};

window.OD.loadDMs = async function({ limit = 100, offset = 0 } = {}) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return [];
    const { data, error } = await db.from('messages').select('*')
        .or(`from_username.eq.${username},to_username.eq.${username}`)
        .order('created_at', { ascending: true })
        .range(offset, offset + limit - 1);
    if (error) return [];
    return data || [];
};

window.OD.markDMsRead = async function(fromUsername) {
    const username = getCurrentUsername();
    const db = getClient();
    if (!db || !isConfigured() || !username) return;
    await db.from('messages').update({ read: true })
        .eq('to_username', username).eq('from_username', fromUsername).eq('read', false);
};

// ══════════════════════════════════════════════════════════════════
// GIFT USERS + PASSWORD (War Room)
// ══════════════════════════════════════════════════════════════════

window.OD.createGiftUser = async function({ sleeperUsername, password, displayName }) {
    if (!isConfigured()) throw new Error('Supabase not configured');
    const token = getSessionToken();
    if (!token) throw new Error('You must be logged in to gift a dashboard');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ username: sleeperUsername, password, displayName: displayName || undefined }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Failed to create gift user');
};

window.OD.checkUsersAccess = async function(usernames) {
    const db = getClient();
    if (!db || !isConfigured() || !usernames || usernames.length === 0) return new Set();
    const { data } = await db.from('users').select('sleeper_username').in('sleeper_username', usernames);
    return new Set((data || []).map(u => u.sleeper_username));
};

window.OD.verifySupabasePassword = async function(username, password) {
    const db = getClient();
    if (!db || !isConfigured()) return false;
    const { data, error } = await db.from('users').select('password_hash, is_gifted').eq('sleeper_username', username).maybeSingle();
    if (error || !data || !data.password_hash) return false;
    const inputHash = await hashPassword(password);
    return { match: data.password_hash === inputHash, isGifted: data.is_gifted || false };
};

window.OD.updatePassword = async function(username, newPassword) {
    if (!isConfigured()) throw new Error('Supabase not configured');
    const token = getSessionToken();
    if (!token) throw new Error('You must be logged in to change your password');
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/set-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'apikey': SUPABASE_ANON },
        body: JSON.stringify({ username, password: newPassword }),
    });
    const result = await resp.json();
    if (!resp.ok) throw new Error(result.error || 'Failed to update password');
};

// Expose on App namespace too
window.App.OD = window.OD;
window.App.SUPABASE_URL = SUPABASE_URL;
window.App.SUPABASE_ANON = SUPABASE_ANON;

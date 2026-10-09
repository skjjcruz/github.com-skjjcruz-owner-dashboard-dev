// dhq-auth — the sign-in behind DHQ Connect (engine project).
//
// When a member taps "Connect" in ChatGPT, Claude, Gemini or any agent, that
// app sends them here. The member signs in with their existing Dynasty HQ
// login, ticks the leagues to share, and taps Allow. The app gets a token it
// then presents to dhq-tools. Standard OAuth 2.1 with PKCE and dynamic client
// registration — what those apps expect.
//
// The live app's database is only READ (the sign-in check goes through the
// live project's own fw-signin function, exactly like the website does); the
// member's password is never stored here. Everything else lives in the engine
// project.
//
// Routes (under /functions/v1/dhq-auth):
//   GET  /.well-known/oauth-authorization-server   who we are
//   GET  /.well-known/oauth-protected-resource     which server the tools trust
//   POST /register                                  a client registers itself
//   GET  /authorize                                 sends the member to the sign-in page
//   POST /authorize/login                           email + password → league list (JSON)
//   POST /authorize/decision                        Allow / Cancel → where to send them (JSON)
//   POST /token                                     code (+PKCE) → tokens; refresh
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// The live app's project: sign-in check only, with its public key.
const LIVE_FUNCTIONS = 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1';
const LIVE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c2hpcXl4aGhpZnZ0ZnFhd2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTExMzAsImV4cCI6MjA4ODI4NzEzMH0.zJi9W986ZLaANiZN6pt6ReFwaQU6yPeidsERIWo2ibI';
const SLEEPER = 'https://api.sleeper.app/v1';
// The sign-in page itself. The function host serves every response as plain
// text (its anti-phishing rule), so the page is a static file elsewhere that
// talks to this function with JSON; /authorize sends the member there.
const SIGNIN_PAGE = Deno.env.get('DHQ_SIGNIN_PAGE') || 'https://skjjcruz.github.io/DHQ-Web-Page/connect/';
const PUBLIC_FUNCTIONS = (Deno.env.get('SUPABASE_URL') || 'https://hovnqztlbsgsywrbidbh.supabase.co').replace(/\/$/, '') + '/functions/v1';
const ACCESS_TTL_S = 30 * 24 * 3600;      // 30 days
const REFRESH_TTL_S = 180 * 24 * 3600;    // 180 days
const CODE_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000;

const CORS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });

// ── storage (service role) ───────────────────────────────────────
const H = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Accept: 'application/json' };
async function select<T = any>(table: string, q: string): Promise<T[]> {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + q, { headers: H });
  if (!r.ok) throw new Error('storage ' + r.status + ' ' + table + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function insert(table: string, rows: unknown[], upsert = false) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table, { method: 'POST', headers: { ...H, Prefer: (upsert ? 'resolution=merge-duplicates,' : '') + 'return=minimal' }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error('storage ' + r.status + ' ' + table + ': ' + (await r.text()).slice(0, 200));
}
async function update(table: string, q: string, patch: unknown) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + q, { method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  if (!r.ok) throw new Error('storage ' + r.status + ' ' + table + ': ' + (await r.text()).slice(0, 200));
}
async function remove(table: string, q: string) {
  await fetch(SUPABASE_URL + '/rest/v1/' + table + '?' + q, { method: 'DELETE', headers: H });
}

// ── crypto helpers ───────────────────────────────────────────────
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
async function sha256Hex(s: string) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, '0')).join(''); }
async function s256(verifier: string) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))); }

// ── the live app: sign-in check and Sleeper identity ─────────────
async function liveSignIn(email: string, password: string): Promise<{ ok: true; id: string; email: string; sleeperUsername: string | null; sleeperUserId: string | null } | { ok: false; error: string }> {
  const r = await fetch(LIVE_FUNCTIONS + '/fw-signin', { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: LIVE_ANON, Authorization: 'Bearer ' + LIVE_ANON }, body: JSON.stringify({ email, password }) });
  let j: any = null; try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok || !j || !j.user) return { ok: false, error: (j && j.error) || 'Sign-in failed (' + r.status + ').' };
  const pu = j.platformUsernames || {};
  return { ok: true, id: String(j.user.id), email: String(j.user.email || email), sleeperUsername: pu.sleeper ? String(pu.sleeper) : null, sleeperUserId: pu.sleeperUserId ? String(pu.sleeperUserId) : null };
}
async function sleeperJson(p: string) { const r = await fetch(SLEEPER + p); return r.ok ? r.json() : null; }
async function memberLeagues(sleeperUserId: string) {
  const nfl = await sleeperJson('/state/nfl'); const season = String((nfl && (nfl.league_season || nfl.season)) || new Date().getFullYear());
  const leagues = (await sleeperJson('/user/' + sleeperUserId + '/leagues/nfl/' + season)) || [];
  return leagues.map((l: any) => ({ league_id: String(l.league_id), name: l.name, teams: l.total_rosters, status: l.status, dynasty: /dynasty|keeper/i.test(String((l.settings && l.settings.type) || '') + ' ' + l.name) || (l.settings && l.settings.type === 2) }));
}

// ── OAuth plumbing ───────────────────────────────────────────────
async function clientOf(id: string) { const rows = await select('oauth_clients', 'select=client_id,client_name,redirect_uris&client_id=eq.' + encodeURIComponent(id)); return rows[0] || null; }
function redirectWith(uri: string, params: Record<string, string>) {
  const u = new URL(uri); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return new Response(null, { status: 302, headers: { Location: u.toString(), 'Cache-Control': 'no-store' } });
}
async function mintTokens(member: { sleeper_user_id: string; app_user_id: string | null; email: string | null }, client: { client_id: string; client_name: string | null }, scope: string) {
  const access = 'dhq_at_' + random(32), refresh = 'dhq_rt_' + random(32); const now = Date.now();
  await insert('connect_keys', [
    { key_hash: await sha256Hex(access), sleeper_user_id: member.sleeper_user_id, label: client.client_name || client.client_id, scopes: scope, kind: 'access', client_id: client.client_id, app_user_id: member.app_user_id, email: member.email, expires_at: new Date(now + ACCESS_TTL_S * 1000).toISOString() },
    { key_hash: await sha256Hex(refresh), sleeper_user_id: member.sleeper_user_id, label: client.client_name || client.client_id, scopes: scope, kind: 'refresh', client_id: client.client_id, app_user_id: member.app_user_id, email: member.email, expires_at: new Date(now + REFRESH_TTL_S * 1000).toISOString() },
  ]);
  return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
}
async function formOrJson(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get('content-type') || '';
  if (ct.includes('application/json')) { const j = await req.json(); return Object.fromEntries(Object.entries(j || {}).map(([k, v]) => [k, Array.isArray(v) ? v.join(' ') : String(v ?? '')])); }
  const fd = await req.formData(); const out: Record<string, string> = {}; const leagues: string[] = [];
  fd.forEach((v, k) => { if (k === 'league') leagues.push(String(v)); else out[k] = String(v); });
  out._leagues = leagues.join(',');
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const i = url.pathname.indexOf('/dhq-auth');
  // The runtime hands the function an internal URL (http, without the
  // /functions/v1 prefix); the addresses we publish must be the public ones.
  const base = PUBLIC_FUNCTIONS + '/dhq-auth';
  const route = url.pathname.slice(i + '/dhq-auth'.length).replace(/\/+$/, '') || '/';
  const tools = PUBLIC_FUNCTIONS + '/dhq-tools';
  try {
    if (req.method === 'GET' && (route === '/.well-known/oauth-authorization-server' || route === '/.well-known/openid-configuration')) {
      return json({ issuer: base, authorization_endpoint: base + '/authorize', token_endpoint: base + '/token', registration_endpoint: base + '/register', response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['read'], service_documentation: 'https://dhqfootball.com' });
    }
    if (req.method === 'GET' && route === '/.well-known/oauth-protected-resource') {
      return json({ resource: tools, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['read'], resource_name: 'Dynasty HQ' });
    }
    if (req.method === 'POST' && route === '/register') {
      const body = await req.json().catch(() => ({}));
      const uris: string[] = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String).filter((u: string) => /^https:\/\//.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(u)) : [];
      if (!uris.length) return json({ error: 'invalid_redirect_uri', error_description: 'redirect_uris must contain at least one https URL.' }, 400);
      const client_id = 'dhq_c_' + random(16);
      const client_name = String(body.client_name || 'Your AI').slice(0, 80);
      await insert('oauth_clients', [{ client_id, client_name, redirect_uris: uris, client_uri: body.client_uri ? String(body.client_uri).slice(0, 200) : null }]);
      return json({ client_id, client_name, redirect_uris: uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], client_id_issued_at: Math.floor(Date.now() / 1000) }, 201);
    }
    if (req.method === 'GET' && route === '/authorize') {
      const p = Object.fromEntries(url.searchParams.entries());
      const client = p.client_id ? await clientOf(p.client_id) : null;
      if (!client) return redirectWith(SIGNIN_PAGE, { error: 'This app is not registered with Dynasty HQ. Go back to your AI and try connecting again.' });
      if (!p.redirect_uri || !(client.redirect_uris || []).includes(p.redirect_uri)) return redirectWith(SIGNIN_PAGE, { error: 'The return address does not match what this app registered.' });
      if (p.response_type !== 'code') return redirectWith(p.redirect_uri, { error: 'unsupported_response_type', state: p.state || '' });
      if (!p.code_challenge || (p.code_challenge_method || 'S256') !== 'S256') return redirectWith(p.redirect_uri, { error: 'invalid_request', error_description: 'PKCE S256 is required', state: p.state || '' });
      const keep = { client_id: p.client_id, redirect_uri: p.redirect_uri, state: p.state || '', code_challenge: p.code_challenge, scope: p.scope || 'read', resource: p.resource || '', client_name: client.client_name || 'Your AI', auth: base };
      return redirectWith(SIGNIN_PAGE, keep);
    }
    if (req.method === 'POST' && route === '/authorize/login') {
      const f = await formOrJson(req);
      const client = f.client_id ? await clientOf(f.client_id) : null;
      if (!client || !(client.redirect_uris || []).includes(f.redirect_uri)) return json({ ok: false, error: 'Start again from your AI.' }, 400);
      if (!f.code_challenge) return json({ ok: false, error: 'Start again from your AI.' }, 400);
      const who = await liveSignIn(String(f.email || '').trim(), String(f.password || ''));
      if (!who.ok) return json({ ok: false, error: who.error }, 401);
      let sleeperId = who.sleeperUserId;
      if (!sleeperId && who.sleeperUsername) { const u = await sleeperJson('/user/' + encodeURIComponent(who.sleeperUsername)); sleeperId = u && u.user_id ? String(u.user_id) : null; }
      if (!sleeperId) return json({ ok: false, error: 'This Dynasty HQ account has no Sleeper username linked yet. Connect a league on dhqfootball.com first, then come back.' }, 400);
      const leagues = await memberLeagues(sleeperId);
      const id = random(24);
      await insert('oauth_pending', [{ id, client_id: f.client_id, redirect_uri: f.redirect_uri, state: f.state || null, code_challenge: f.code_challenge, scope: f.scope || 'read', resource: f.resource || null, app_user_id: who.id, email: who.email, sleeper_user_id: sleeperId, sleeper_username: who.sleeperUsername, leagues, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() }]);
      return json({ ok: true, pending: id, who: who.email, client_name: client.client_name || 'Your AI', leagues });
    }
    if (req.method === 'POST' && route === '/authorize/decision') {
      const f = await formOrJson(req);
      const rows = await select('oauth_pending', 'select=*&id=eq.' + encodeURIComponent(f.pending || ''));
      const pend = rows[0];
      if (!pend || new Date(pend.expires_at).getTime() < Date.now()) return json({ ok: false, error: 'That took too long. Start again from your AI.' }, 400);
      await remove('oauth_pending', 'id=eq.' + encodeURIComponent(pend.id));
      const back = (params: Record<string, string>) => { const u = new URL(pend.redirect_uri); Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v)); return json({ ok: true, redirect: u.toString() }); };
      if (f.decision !== 'allow') return back({ error: 'access_denied', state: pend.state || '' });
      const chosen = new Set((f._leagues || '').split(',').filter(Boolean));
      const leagues = (pend.leagues || []).filter((l: any) => chosen.has(String(l.league_id)));
      if (leagues.length) await insert('connect_leagues', leagues.map((l: any) => ({ league_id: String(l.league_id), platform: 'sleeper', sleeper_user_id: pend.sleeper_user_id, label: l.name, active: true, added_by: pend.email || pend.sleeper_user_id })), true);
      const code = 'dhq_code_' + random(32);
      await insert('oauth_codes', [{ code, client_id: pend.client_id, redirect_uri: pend.redirect_uri, code_challenge: pend.code_challenge, scope: pend.scope || 'read', app_user_id: pend.app_user_id, email: pend.email, sleeper_user_id: pend.sleeper_user_id, leagues: leagues.map((l: any) => l.league_id), expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() }]);
      return back({ code, state: pend.state || '' });
    }
    if (req.method === 'POST' && route === '/token') {
      const f = await formOrJson(req);
      if (f.grant_type === 'authorization_code') {
        const rows = await select('oauth_codes', 'select=*&code=eq.' + encodeURIComponent(f.code || ''));
        const c = rows[0];
        if (!c || c.used || new Date(c.expires_at).getTime() < Date.now()) return json({ error: 'invalid_grant', error_description: 'Code is unknown, used or expired.' }, 400);
        if (f.client_id && f.client_id !== c.client_id) return json({ error: 'invalid_grant', error_description: 'Code was issued to another client.' }, 400);
        if (f.redirect_uri && f.redirect_uri !== c.redirect_uri) return json({ error: 'invalid_grant', error_description: 'redirect_uri does not match.' }, 400);
        if (!f.code_verifier || await s256(f.code_verifier) !== c.code_challenge) return json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' }, 400);
        await update('oauth_codes', 'code=eq.' + encodeURIComponent(c.code), { used: true });
        const client = (await clientOf(c.client_id)) || { client_id: c.client_id, client_name: null };
        return json(await mintTokens({ sleeper_user_id: c.sleeper_user_id, app_user_id: c.app_user_id, email: c.email }, client, c.scope || 'read'));
      }
      if (f.grant_type === 'refresh_token') {
        const rows = await select('connect_keys', 'select=*&kind=eq.refresh&revoked=eq.false&key_hash=eq.' + await sha256Hex(f.refresh_token || ''));
        const t = rows[0];
        if (!t || (t.expires_at && new Date(t.expires_at).getTime() < Date.now())) return json({ error: 'invalid_grant', error_description: 'Refresh token is unknown or expired.' }, 400);
        if (f.client_id && t.client_id && f.client_id !== t.client_id) return json({ error: 'invalid_grant' }, 400);
        await update('connect_keys', 'key_hash=eq.' + t.key_hash, { revoked: true });
        const client = (await clientOf(t.client_id)) || { client_id: t.client_id, client_name: t.label };
        return json(await mintTokens({ sleeper_user_id: t.sleeper_user_id, app_user_id: t.app_user_id, email: t.email }, client, t.scopes || 'read'));
      }
      return json({ error: 'unsupported_grant_type' }, 400);
    }
    if (req.method === 'GET' && route === '/') return json({ name: 'Dynasty HQ Connect sign-in', metadata: base + '/.well-known/oauth-authorization-server' });
    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: 'server_error', error_description: (e as Error).message }, 500);
  }
});

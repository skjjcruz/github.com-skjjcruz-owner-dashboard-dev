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
//   GET  /authorize                                 the sign-in page
//   POST /authorize/login                           email + password → league picker
//   POST /authorize/decision                        Allow / Cancel → back to the app
//   POST /token                                     code (+PKCE) → tokens; refresh
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
// The live app's project: sign-in check only, with its public key.
const LIVE_FUNCTIONS = 'https://sxshiqyxhhifvtfqawbq.supabase.co/functions/v1';
const LIVE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4c2hpcXl4aGhpZnZ0ZnFhd2JxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTExMzAsImV4cCI6MjA4ODI4NzEzMH0.zJi9W986ZLaANiZN6pt6ReFwaQU6yPeidsERIWo2ibI';
const SLEEPER = 'https://api.sleeper.app/v1';
const PUBLIC_FUNCTIONS = (Deno.env.get('SUPABASE_URL') || 'https://hovnqztlbsgsywrbidbh.supabase.co').replace(/\/$/, '') + '/functions/v1';
const ACCESS_TTL_S = 30 * 24 * 3600;      // 30 days
const REFRESH_TTL_S = 180 * 24 * 3600;    // 180 days
const CODE_TTL_MS = 10 * 60 * 1000;
const PENDING_TTL_MS = 15 * 60 * 1000;

const CORS: Record<string, string> = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS, ...extra } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self' https:; base-uri 'none'; frame-ancestors 'none'" } });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

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

// ── pages ────────────────────────────────────────────────────────
function page(title: string, body: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#0b0b0b;--card:#141414;--gold:#D4AF37;--fg:#e8e8e8;--muted:#9a9a9a;--line:rgba(255,255,255,0.1);--r:10px;--rs:8px}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:var(--r);padding:26px 22px}
.brand{display:flex;align-items:center;gap:10px;margin-bottom:14px}.brand b{color:var(--gold);letter-spacing:.08em;font-size:.85rem}.brand span{color:var(--muted);font-size:.8rem}
h1{font-size:1.25rem;margin:0 0 6px}p{margin:8px 0;color:var(--muted);font-size:.92rem}p.err{color:#ff9d9d}
label{display:block;font-size:.85rem;color:var(--muted);margin:14px 0 6px}
input[type=email],input[type=password]{width:100%;padding:11px 12px;border:1px solid rgba(255,255,255,.2);border-radius:var(--rs);background:#000;color:#fff;font-size:1rem}
.btn{display:block;width:100%;margin-top:16px;padding:12px;border:none;border-radius:var(--rs);background:var(--gold);color:#111;font-weight:800;font-size:1rem;cursor:pointer}
.btn.alt{background:none;border:1px solid rgba(255,255,255,.25);color:var(--fg);font-weight:600;margin-top:8px}
.lg{display:flex;gap:10px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:var(--rs);margin-top:8px}.lg small{color:var(--muted);display:block}
.foot{margin-top:18px;font-size:.78rem;color:var(--muted)}
</style></head><body><div class="card"><div class="brand"><b>DYNASTY HQ</b><span>· Connect your AI</span></div>${body}</div></body></html>`;
}
function hidden(fields: Record<string, string>) { return Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join(''); }
function loginPage(base: string, client: string, params: Record<string, string>, error?: string) {
  return page('Sign in to Dynasty HQ', `
<h1>Allow <span style="color:var(--gold)">${esc(client)}</span> to use your Dynasty HQ</h1>
<p>Sign in with the email and password you use on dhqfootball.com. Your AI will be able to read your leagues' rosters, DHQ values and verdicts — never make moves.</p>
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post" action="${esc(base)}/authorize/login">${hidden(params)}
<label>Email</label><input type="email" name="email" autocomplete="username" required>
<label>Password</label><input type="password" name="password" autocomplete="current-password" required>
<button class="btn" type="submit">Sign in</button></form>
<p class="foot">Signed up with Google? Set a password in Dynasty HQ → Settings first, then sign in here. Your password is checked by Dynasty HQ and never stored by this page.</p>`);
}
function consentPage(base: string, client: string, pendingId: string, who: string, leagues: Array<{ league_id: string; name: string; teams: number; status: string }>) {
  const list = leagues.length ? leagues.map(l => `<label class="lg"><input type="checkbox" name="league" value="${esc(l.league_id)}" checked><span>${esc(l.name)}<small>${esc(l.teams)} teams · ${esc(String(l.status || '').replace('_', ' '))}</small></span></label>`).join('')
    : '<p class="err">No Sleeper leagues found for this account this season.</p>';
  return page('Choose leagues', `
<h1>Which leagues can <span style="color:var(--gold)">${esc(client)}</span> see?</h1>
<p>Signed in as ${esc(who)}. Untick any league you want to keep private.</p>
<form method="post" action="${esc(base)}/authorize/decision">${hidden({ pending: pendingId })}
${list}
<button class="btn" type="submit" name="decision" value="allow"${leagues.length ? '' : ' disabled'}>Allow</button>
<button class="btn alt" type="submit" name="decision" value="deny">Cancel</button></form>
<p class="foot">Read-only. You can disconnect any time from your AI's connector settings. New leagues take up to two hours to get their first DHQ numbers.</p>`);
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
      if (!client) return html(page('Unknown app', '<h1>Unknown app</h1><p>This app is not registered with Dynasty HQ. Go back to your AI and try connecting again.</p>'), 400);
      if (!p.redirect_uri || !(client.redirect_uris || []).includes(p.redirect_uri)) return html(page('Bad request', '<h1>Bad request</h1><p>The return address does not match what this app registered.</p>'), 400);
      if (p.response_type !== 'code') return redirectWith(p.redirect_uri, { error: 'unsupported_response_type', state: p.state || '' });
      if (!p.code_challenge || (p.code_challenge_method || 'S256') !== 'S256') return redirectWith(p.redirect_uri, { error: 'invalid_request', error_description: 'PKCE S256 is required', state: p.state || '' });
      const keep = { client_id: p.client_id, redirect_uri: p.redirect_uri, state: p.state || '', code_challenge: p.code_challenge, scope: p.scope || 'read', resource: p.resource || '' };
      return html(loginPage(base, client.client_name || 'Your AI', keep));
    }
    if (req.method === 'POST' && route === '/authorize/login') {
      const f = await formOrJson(req);
      const client = f.client_id ? await clientOf(f.client_id) : null;
      if (!client || !(client.redirect_uris || []).includes(f.redirect_uri)) return html(page('Bad request', '<h1>Bad request</h1><p>Start again from your AI.</p>'), 400);
      const keep = { client_id: f.client_id, redirect_uri: f.redirect_uri, state: f.state || '', code_challenge: f.code_challenge, scope: f.scope || 'read', resource: f.resource || '' };
      const name = client.client_name || 'Your AI';
      const who = await liveSignIn(String(f.email || '').trim(), String(f.password || ''));
      if (!who.ok) return html(loginPage(base, name, keep, who.error), 401);
      let sleeperId = who.sleeperUserId;
      if (!sleeperId && who.sleeperUsername) { const u = await sleeperJson('/user/' + encodeURIComponent(who.sleeperUsername)); sleeperId = u && u.user_id ? String(u.user_id) : null; }
      if (!sleeperId) return html(loginPage(base, name, keep, 'This Dynasty HQ account has no Sleeper username linked yet. Connect a league on dhqfootball.com first, then come back.'), 400);
      const leagues = await memberLeagues(sleeperId);
      const id = random(24);
      await insert('oauth_pending', [{ id, client_id: f.client_id, redirect_uri: f.redirect_uri, state: f.state || null, code_challenge: f.code_challenge, scope: keep.scope, resource: keep.resource || null, app_user_id: who.id, email: who.email, sleeper_user_id: sleeperId, sleeper_username: who.sleeperUsername, leagues, expires_at: new Date(Date.now() + PENDING_TTL_MS).toISOString() }]);
      return html(consentPage(base, name, id, who.email, leagues));
    }
    if (req.method === 'POST' && route === '/authorize/decision') {
      const f = await formOrJson(req);
      const rows = await select('oauth_pending', 'select=*&id=eq.' + encodeURIComponent(f.pending || ''));
      const pend = rows[0];
      if (!pend || new Date(pend.expires_at).getTime() < Date.now()) return html(page('Expired', '<h1>That took too long</h1><p>Start again from your AI.</p>'), 400);
      await remove('oauth_pending', 'id=eq.' + encodeURIComponent(pend.id));
      if (f.decision !== 'allow') return redirectWith(pend.redirect_uri, { error: 'access_denied', state: pend.state || '' });
      const chosen = new Set((f._leagues || '').split(',').filter(Boolean));
      const leagues = (pend.leagues || []).filter((l: any) => chosen.has(String(l.league_id)));
      if (leagues.length) await insert('connect_leagues', leagues.map((l: any) => ({ league_id: String(l.league_id), platform: 'sleeper', sleeper_user_id: pend.sleeper_user_id, label: l.name, active: true, added_by: pend.email || pend.sleeper_user_id })), true);
      const code = 'dhq_code_' + random(32);
      await insert('oauth_codes', [{ code, client_id: pend.client_id, redirect_uri: pend.redirect_uri, code_challenge: pend.code_challenge, scope: pend.scope || 'read', app_user_id: pend.app_user_id, email: pend.email, sleeper_user_id: pend.sleeper_user_id, leagues: leagues.map((l: any) => l.league_id), expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString() }]);
      return redirectWith(pend.redirect_uri, { code, state: pend.state || '' });
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

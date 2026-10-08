// dhq-tools — the DHQ serving endpoint (engine project).
//
// Answers questions about a member's leagues from what the engine builder
// stored (league_intel, engine_cache) in milliseconds. One URL, two ways in:
//
//   • MCP (Streamable HTTP, JSON-RPC): initialize / tools/list / tools/call —
//     what ChatGPT, Claude, Gemini and any agent speak.
//   • Plain REST: POST {"tool": "get_team", "args": {...}} → {"ok": true, "result": ...}
//
// Auth: `Authorization: Bearer dhq_ck_…` — a DHQ Connect key minted for the
// member (only its SHA-256 is stored, in connect_keys). The key maps to the
// member's Sleeper user id; every tool is scoped to leagues that member is in.
// Read-only: nothing here writes to Sleeper or to any league.
import './vendor/trade-engine.js';
import { TOOL_DEFS, runTool, ToolError, type Ctx, type LeagueRow } from './tools.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const VERSION = 'dhq-tools 0.1';
const PROTOCOL_DEFAULT = '2025-06-18';

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, accept, mcp-protocol-version, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'mcp-protocol-version',
};
const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS, ...extra } });

const INSTRUCTIONS = [
  'You are talking to Dynasty HQ, a dynasty fantasy football engine. The member connected their own leagues (Sleeper). Use the tools for every fact: rosters, values, records, picks, owners. Never guess a number, roster or pick; if a tool did not give it to you, you do not know it.',
  'The truth rule: league facts come from Sleeper through these tools. If something is not there, say so plainly instead of filling the gap from memory.',
  'DHQ value is this app\'s dynasty trade value for the league in question (higher is better; roughly 7,000+ is elite, 3,000+ a solid starter, under 1,000 a depth piece). Values are league-specific and refresh every couple of hours; "numbers_as_of" says when.',
  'Think like a sharp, honest dynasty GM: weigh this season against the long game, the member\'s competitive window (contender vs rebuilding), and the other owner\'s habits (DNA). Have an opinion and give the reasons with the key numbers.',
  'Start with list_leagues when the league is unknown. The member\'s own team is the default for get_team and evaluate_trade.',
  'You cannot make moves in Sleeper. Tell the member exactly what to do.',
].join('\n');

// ── storage reads (service role; RLS keeps the public key out) ────
async function rest(path: string): Promise<unknown> {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, Accept: 'application/json' } });
  if (!r.ok) throw new Error('storage ' + r.status + ' on ' + path.split('?')[0] + ': ' + (await r.text()).slice(0, 200));
  return r.json();
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}
// Minted keys (dhq_ck_…) and sign-in access tokens (dhq_at_…) both land in
// connect_keys; refresh tokens never open the door.
async function memberFor(req: Request): Promise<{ id: string; label: string; scopes: string } | null> {
  const m = (req.headers.get('authorization') || '').match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  const hash = await sha256Hex(m[1]);
  const rows = await rest('connect_keys?select=sleeper_user_id,label,scopes,revoked,kind,expires_at&key_hash=eq.' + hash) as Array<{ sleeper_user_id: string; label: string; scopes: string; revoked: boolean; kind: string; expires_at: string | null }>;
  const k = rows[0];
  if (!k || k.revoked) return null;
  if (k.kind && k.kind !== 'key' && k.kind !== 'access') return null;
  if (k.expires_at && new Date(k.expires_at).getTime() < Date.now()) return null;
  fetch(SUPABASE_URL + '/rest/v1/connect_keys?key_hash=eq.' + hash, { method: 'PATCH', headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ last_used_at: new Date().toISOString() }) }).catch(() => {});
  return { id: k.sleeper_user_id, label: k.label, scopes: k.scopes };
}
// Where an unauthenticated client goes to sign the member in (RFC 9728).
function authChallenge(req: Request): string {
  const u = new URL(req.url); const i = u.pathname.indexOf('/dhq-tools');
  return 'Bearer realm="Dynasty HQ", resource_metadata="' + u.origin + u.pathname.slice(0, i) + '/dhq-auth/.well-known/oauth-protected-resource"';
}
function inLeague(L: { snapshot: { rosters: Array<{ owner_id: string; co_owners: string[] | null }> } }, memberId: string): boolean {
  return (L.snapshot?.rosters || []).some(r => r.owner_id === memberId || (r.co_owners || []).includes(memberId));
}
async function buildCtx(memberId: string): Promise<Ctx> {
  // Light rows for the member's league list; the full row loads on demand.
  const [all, cache] = await Promise.all([
    rest('league_intel?select=league_id,season,name,built_at,engine_version,assessments,snapshot&error=is.null') as Promise<LeagueRow[]>,
    rest('engine_cache?select=key,data&key=in.(players,nfl_state,trending_add)') as Promise<Array<{ key: string; data: any }>>,
  ]);
  const leagues = all.filter(L => inLeague(L, memberId)).map(L => ({ ...L, intel: L.intel || {}, dna: L.dna || {} }));
  const full = new Map<string, LeagueRow>();
  const get = (k: string) => (cache.find(c => c.key === k) || { data: null }).data;
  // deno-lint-ignore no-explicit-any
  const te = (globalThis as any).App?.TradeEngine;
  if (!te) throw new Error('trade engine not loaded');
  return {
    memberId, leagues, players: get('players') || {}, nflState: get('nfl_state') || {}, trending: get('trending_add') || [], te,
    async loadLeague(id: string) {
      if (full.has(id)) return full.get(id)!;
      if (!leagues.some(L => L.league_id === id)) return null;
      const rows = await rest('league_intel?select=*&league_id=eq.' + encodeURIComponent(id)) as LeagueRow[];
      const row = rows[0] || null;
      if (row) full.set(id, row);
      return row;
    },
  };
}

// ── MCP (JSON-RPC over HTTP, stateless) ──────────────────────────
type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
async function rpc(msg: Rpc, ctx: () => Promise<Ctx>): Promise<Record<string, unknown> | null> {
  const id = msg.id ?? null;
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const err = (code: number, message: string, data?: unknown) => ({ jsonrpc: '2.0', id, error: { code, message, data } });
  if (msg.id === undefined || msg.id === null) return null; // notification: nothing to answer
  switch (msg.method) {
    case 'initialize':
      return ok({ protocolVersion: (msg.params && msg.params.protocolVersion) || PROTOCOL_DEFAULT, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'Dynasty HQ', title: 'Dynasty HQ', version: VERSION }, instructions: INSTRUCTIONS });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOL_DEFS });
    case 'tools/call': {
      const name = msg.params && msg.params.name; const args = (msg.params && msg.params.arguments) || {};
      try {
        const result = await runTool(await ctx(), name, args);
        return ok({ content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result && typeof result === 'object' && !Array.isArray(result) ? result : { result }, isError: false });
      } catch (e) {
        if (e instanceof ToolError) return ok({ content: [{ type: 'text', text: e.message }], isError: true });
        console.error('tool failed', name, e);
        return ok({ content: [{ type: 'text', text: 'Tool failed: ' + (e as Error).message }], isError: true });
      }
    }
    case 'resources/list': return ok({ resources: [] });
    case 'prompts/list': return ok({ prompts: [] });
    default:
      return err(-32601, 'Method not found: ' + msg.method);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  if (req.method === 'GET') {
    if (url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
      const i = url.pathname.indexOf('/dhq-tools'); const root = url.origin + url.pathname.slice(0, i);
      return json({ resource: root + '/dhq-tools', authorization_servers: [root + '/dhq-auth'], bearer_methods_supported: ['header'], scopes_supported: ['read'], resource_name: 'Dynasty HQ' });
    }
    if ((req.headers.get('accept') || '').includes('text/event-stream')) return new Response('This server does not open server-sent streams.', { status: 405, headers: CORS });
    return json({ name: 'Dynasty HQ tools', version: VERSION, mcp: 'POST JSON-RPC (initialize, tools/list, tools/call) to this URL', rest: 'POST {"tool": "...", "args": {...}}', auth: 'Authorization: Bearer <DHQ Connect key>', tools: TOOL_DEFS.map(t => t.name) });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400); }
  const isRpc = (b: any) => b && typeof b === 'object' && b.jsonrpc === '2.0';
  const batch = Array.isArray(body);
  const msgs: any[] = batch ? body : [body];

  // Unauthenticated callers may still initialize and list tools (that is how
  // clients discover the server); anything that reads data needs a key.
  let member: { id: string; label: string; scopes: string } | null | undefined;
  const needMember = async () => {
    if (member === undefined) member = await memberFor(req);
    if (!member) throw new AuthError();
    return member;
  };
  let ctxPromise: Promise<Ctx> | null = null;
  const ctx = async () => { const m = await needMember(); if (!ctxPromise) ctxPromise = buildCtx(m.id); return ctxPromise; };

  try {
    if (msgs.every(isRpc)) {
      const out: Array<Record<string, unknown>> = [];
      for (const m of msgs) { const r = await rpc(m, ctx); if (r) out.push(r); }
      if (!out.length) return new Response(null, { status: 202, headers: CORS });
      return json(batch ? out : out[0], 200, { 'MCP-Protocol-Version': PROTOCOL_DEFAULT });
    }
    // Plain REST
    const tool = body && body.tool; const args = (body && body.args) || {};
    if (!tool) return json({ ok: false, error: 'Send {"tool": "<name>", "args": {...}} or a JSON-RPC 2.0 message.' }, 400);
    try { return json({ ok: true, result: await runTool(await ctx(), tool, args) }); }
    catch (e) {
      if (e instanceof ToolError) return json({ ok: false, error: e.message }, 400);
      throw e;
    }
  } catch (e) {
    if (e instanceof AuthError) return json({ error: 'Sign in to Dynasty HQ to use these tools (OAuth), or send a DHQ Connect key: Authorization: Bearer dhq_ck_…' }, 401, { 'WWW-Authenticate': authChallenge(req) });
    console.error(e);
    return json({ error: 'Server error: ' + (e as Error).message }, 500);
  }
});
class AuthError extends Error {}

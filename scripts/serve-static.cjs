#!/usr/bin/env node
'use strict';

const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const LIVE_AI_ENDPOINT = 'https://hovnqztlbsgsywrbidbh.supabase.co/functions/v1/ai-analyze';

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
};

function getArg(name, fallback) {
  const prefix = `--${name}=`;
  const match = process.argv.find(arg => arg.startsWith(prefix));
  if (match) return match.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return fallback;
}

const host = getArg('host', '127.0.0.1');
const port = Number(getArg('port', process.env.PORT || 3001));
const root = path.resolve(getArg('root', process.cwd()));
const openPath = getArg('open', '');

function loadLocalEnv() {
  ['.env.local', '.env'].forEach(file => {
    const envPath = path.join(root, file);
    if (!fs.existsSync(envPath)) return;
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!match || process.env[match[1]]) return;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    });
  });
}

loadLocalEnv();

function isInsideRoot(filePath) {
  const relative = path.relative(root, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRequestPath(reqUrl) {
  const url = new URL(reqUrl, `http://${host}:${port}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';
  if (pathname === '/favicon.ico') pathname = '/icon-192.png';

  const directPath = path.join(root, pathname);
  if (isInsideRoot(directPath) && fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  const indexPath = path.join(root, pathname, 'index.html');
  if (isInsideRoot(indexPath) && fs.existsSync(indexPath) && fs.statSync(indexPath).isFile()) {
    return indexPath;
  }

  return null;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function landingContentPath() {
  return path.join(root, 'content', 'landing-pages.json');
}

async function handleLandingContent(req, res) {
  const filePath = landingContentPath();

  if (req.method === 'GET') {
    if (!fs.existsSync(filePath)) {
      sendJson(res, 404, { error: 'Landing content file not found.' });
      return;
    }
    try {
      sendJson(res, 200, JSON.parse(fs.readFileSync(filePath, 'utf8')));
    } catch (error) {
      sendJson(res, 500, { error: error.message || 'Landing content could not be read.' });
    }
    return;
  }

  if (req.method === 'PUT') {
    try {
      const body = await readJson(req);
      if (!body || typeof body !== 'object' || !body.pages || typeof body.pages !== 'object') {
        sendJson(res, 400, { error: 'Landing content must include a pages object.' });
        return;
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
      sendJson(res, 200, { ok: true });
    } catch (error) {
      sendJson(res, 400, { error: error.message || 'Landing content could not be saved.' });
    }
    return;
  }

  res.writeHead(405, { Allow: 'GET, PUT' });
  res.end('Method Not Allowed');
}

function localAIProvider() {
  if (process.env.OPENAI_API_KEY) {
    return {
      name: 'openai',
      model: process.env.OPENAI_MODEL || 'gpt-5.4-mini',
      apiKey: process.env.OPENAI_API_KEY,
    };
  }
  if (process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY) {
    return {
      name: 'gemini',
      model: process.env.GOOGLE_AI_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      apiKey: process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY,
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      name: 'anthropic',
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
      apiKey: process.env.ANTHROPIC_API_KEY,
    };
  }
  return null;
}

function normalizeMessages(type, context) {
  let parsed = context;
  if (typeof context === 'string') {
    try {
      parsed = JSON.parse(context);
    } catch {
      parsed = { userMessage: context };
    }
  }
  const system = parsed?.system || 'You are Alex Ingram, a fantasy football GM assistant. Give direct, format-aware, league-grounded advice using the supplied context.';
  const sourceMessages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const userMessage = parsed?.userMessage || parsed?.userPrompt || parsed?.question || '';
  const messages = sourceMessages.length
    ? sourceMessages
    : [{ role: 'user', content: userMessage || `Analyze this ${type || 'fantasy football'} context:\n${JSON.stringify(parsed, null, 2)}` }];
  const maxTokens = Math.max(100, Math.min(Number(parsed?.maxTokens || 700), 2200));
  return { system, messages, maxTokens };
}

// MIRROR of buildDynastyReadSystemPrompt / dynastyReadFormatClause /
// buildDynastyReadPrompt in supabase/functions/ai-analyze/index.ts — keep in sync.
// Lets the LOCAL preview produce the REAL dynasty read (NFL-analyst, plain prose,
// web-search-grounded) instead of the generic bridge prompt. Dev harness only:
// no shared cache, no pause_turn resume (prod handles those).
function buildDynastyReadDev(parsed) {
  const name = parsed?.name || 'this player';
  const pos = parsed?.pos || '';
  const team = parsed?.team || 'FA';
  const age = parsed?.age ? `, age ${parsed.age}` : '';
  const wk = (parsed?.week === 0 || parsed?.week === '0' || parsed?.week == null) ? 'the offseason' : `week ${parsed.week}`;
  const season = parsed?.season || '';

  const sf = parsed?.superflex === true || parsed?.isSuperFlex === true;
  const tep = parsed?.tep === true || parsed?.tePremium === true || parsed?.isTEP === true;
  const idp = parsed?.idp === true || parsed?.isIDP === true;
  const scoring = parsed?.scoringType || parsed?.scoring || '';
  const bits = [];
  if (scoring === 'ppr') bits.push('full PPR');
  else if (scoring === 'half_ppr' || scoring === 'half') bits.push('half PPR');
  else if (scoring === 'std' || scoring === 'standard') bits.push('standard / non-PPR');
  if (sf) bits.push('superflex (2 QB-eligible slots)');
  if (tep) bits.push('TE-premium');
  if (idp) bits.push('IDP');
  const fmt = bits.length
    ? `\nThe GM's league is ${bits.join(', ')}. Read this player THROUGH that lens — the same news means different things by format: QB value swings hardest in superflex; high-target receivers and pass-catching backs gain in PPR; every-down and receiving tight ends gain in TE-premium; defenders carry real, tradeable value in IDP. Weight the outlook to what this format rewards.\n`
    : `\nThis is a league-agnostic dynasty read: focus on the role, usage, health and trajectory signals that move a player's value in any format.\n`;

  const system = `You are a sharp NFL analyst writing the dynasty read on ONE player for the GM who ALREADY ROSTERS him. Your job: translate what is ACTUALLY happening with this player in the real world right now into what it means for his dynasty value. You have web search — use it, and build the read entirely on what you find.

Weave three things into plain prose, in this order (do not label them):
1. SITUATION — the most important real, current development from recent reporting: depth-chart role and snap/target/touch trend, health and its timeline, contract or roster status, a coaching/scheme change, or a teammate's move that opens or closes a path. Anchor it to something concrete and recent — not a career résumé.
2. IMPACT — what that situation does to his usage and value right now.
3. LONG-TERM OUTLOOK — the dynasty trajectory over the next 1-3 seasons: arrow up, flat, or down, and the specific reason driving it.
${fmt}
HARD RULES:
- Ground the read in real, recent developments you actually found. Do NOT fall back on a generic age/role platitude that could be said about any player at his position.
- LOW-PROFILE PLAYERS (deep bench, practice squad, just-drafted, UDFA): never go blank or generic — give his depth-chart spot, who is ahead of him, his realistic path to snaps, and a blunt verdict (deep stash / taxi-only / waiver-level) plus the single change that would put him on the radar.
- The GM ALREADY OWNS him — write the forward outlook and a hold-or-move read, NOT whether to acquire him or what to pay. Never say "don't pay up" or give buy-price advice.
- Wrap the final read — and nothing else — in <read></read> tags. Only the text inside those tags is shown to the GM, so put no preamble, fact list, separators, labels, or meta-commentary inside them (you may reason before the opening tag if you must). Example: <read>His role firmed up when…</read>
- Confident and direct. Cut "could / may / might" hedging.
- 3-5 sentences of PLAIN PROSE that run together as one short paragraph. Absolutely NO markdown, NO "#"/"##" headings, NO section titles ("Quick Take", "Situation", "Verdict", etc.), NO bullets, NO tables, NO labels, NO sign-off — just the sentences.`;

  const user = `Use web search to pull the LATEST reporting on ${name} (${pos}, ${team}${age}) as of ${wk} ${season} — prioritize the last ~10 days plus this offseason's moves. Sources: ESPN, PFF, The Athletic, trusted team beat reporters. Then write the read per your instructions. Do NOT restate fantasy points, DHQ value, or position rank.`;

  return { system, messages: [{ role: 'user', content: user }], maxTokens: 2000, webSearch: true };
}

// MIRROR of extractTaggedRead in index.ts — keep only the <read></read> content.
function extractTaggedRead(text) {
  const raw = String(text || '').trim();
  const m = raw.match(/<read>([\s\S]*?)<\/read>/i);
  if (m && m[1].trim()) return m[1].trim();
  let t = raw.replace(/<\/?read>/gi, '').trim();
  const sep = t.split(/\n\s*-{3,}\s*\n/);
  if (sep.length > 1) t = sep[sep.length - 1].trim();
  const paras = t.split(/\n\s*\n/);
  if (paras.length > 1 && /^(i have |i'?ve |let me |here(?:'s| is| are)|okay|alright|sure|based on|after (?:my |the )?search)/i.test(paras[0].trim())) {
    t = paras.slice(1).join('\n\n').trim();
  }
  return t.trim();
}

async function callOpenAI(provider, request) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      instructions: request.system,
      input: request.messages.map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || ''),
      })),
      max_output_tokens: request.maxTokens,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI API error ${response.status}`);
  return {
    analysis: data.output_text || (data.output || [])
      .flatMap(item => item?.content || [])
      .filter(part => part?.type === 'output_text' || part?.type === 'text')
      .map(part => part?.text || '')
      .join('') || 'No response.',
    usage: data.usage || {},
  };
}

async function callGemini(provider, request) {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: request.maxTokens,
      // Gemini 2.5 "thinking" silently consumes the token budget, truncating
      // short advisory blurbs. These prompts don't need reasoning — disable it
      // so the cap goes to visible output.
      reasoning_effort: 'none',
      messages: [{ role: 'system', content: request.system }, ...request.messages],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Gemini API error ${response.status}`);
  return {
    analysis: data.choices?.[0]?.message?.content || 'No response.',
    usage: data.usage || {},
  };
}

async function callAnthropic(provider, request) {
  const payload = {
    model: provider.model,
    max_tokens: request.maxTokens,
    system: request.system,
    messages: request.messages
      .filter(message => message.role !== 'system')
      .map(message => ({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: String(message.content || ''),
      })),
  };
  // GA web search for the dynasty read (mirrors the edge function) so the preview
  // produces a real news-grounded read, not an answer from training.
  if (request.webSearch) payload.tools = [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }];
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || `Anthropic API error ${response.status}`);
  return {
    analysis: (data.content || []).filter(part => part.type === 'text').map(part => part.text || '').join('') || 'No response.',
    usage: data.usage || {},
  };
}

async function proxyLiveAI(body, authHeader, apiKey) {
  const response = await fetch(LIVE_AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
      'apikey': apiKey,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
}

async function handleDevAI(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
    });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Method Not Allowed' });
    return;
  }

  try {
    const body = await readJson(req);
    const authHeader = req.headers.authorization || '';
    const apiKey = req.headers.apikey || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();
    const hasUserToken = bearer && apiKey && bearer !== apiKey && bearer.split('.').length === 3;

    if (hasUserToken) {
      const proxied = await proxyLiveAI(body, authHeader, apiKey);
      sendJson(res, proxied.status, proxied.data);
      return;
    }

    let provider = localAIProvider();
    // dynasty_read needs Anthropic (web search) to mirror prod. Prefer the
    // Anthropic key for this type even if another provider is first in priority.
    if (body.type === 'dynasty_read' && process.env.ANTHROPIC_API_KEY) {
      provider = {
        name: 'anthropic',
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        apiKey: process.env.ANTHROPIC_API_KEY,
      };
    }
    if (!provider) {
      sendJson(res, 503, {
        error: 'Local AI preview bridge is not configured. Add OPENAI_API_KEY, GOOGLE_AI_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY to warroom/.env.local, or sign in with a real app session and restart the preview.',
      });
      return;
    }

    // dynasty_read uses the REAL prompt + web search (Anthropic only); everything
    // else uses the generic single-provider bridge.
    let request;
    if (body.type === 'dynasty_read' && provider.name === 'anthropic') {
      let parsed = body.context;
      if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch { parsed = {}; } }
      request = buildDynastyReadDev(parsed);
    } else {
      request = normalizeMessages(body.type, body.context);
    }
    const result = provider.name === 'openai'
      ? await callOpenAI(provider, request)
      : provider.name === 'gemini'
        ? await callGemini(provider, request)
        : await callAnthropic(provider, request);

    const analysis = body.type === 'dynasty_read' ? extractTaggedRead(result.analysis) : result.analysis;
    sendJson(res, 200, {
      analysis,
      provider: provider.name,
      model: provider.model,
      usage: {
        ...(result.usage || {}),
        plan: 'local-preview',
        routeTier: 'preview',
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'Local AI preview failed.' });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${host}:${port}`);
  if (url.pathname === '/api/dev-ai-analyze') {
    handleDevAI(req, res);
    return;
  }
  if (url.pathname === '/api/landing-content') {
    handleLandingContent(req, res);
    return;
  }

  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end('Method Not Allowed');
    return;
  }

  let filePath;
  try {
    filePath = resolveRequestPath(req.url);
  } catch (_err) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, host, () => {
  console.log(`Serving ${root} at http://${host}:${port}/`);
  if (openPath) {
    const target = new URL(openPath.replace(/^\/+/, ''), `http://${host}:${port}/`).toString();
    const opener = spawn('open', [target], { detached: true, stdio: 'ignore' });
    opener.unref();
  }
});

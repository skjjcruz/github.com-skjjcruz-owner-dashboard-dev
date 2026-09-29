// ============================================================
// Fast lane for short, latency-critical Alex answers (pure helpers).
//
// Measured 2026-09-29 (a user's Lineup game-day note took 23.7s in the model
// phase alone): the Gemini free tier serves these one-liners in 3.3s at best
// (p50 5.6s) because the served id is a thinking model, and on a 429/503 the
// general ladder sleeps 1.5s + 3s and has no per-attempt timeout before it
// falls to Groq, which answers the same prompt in well under a second.
//
// The fast lane: a latency-first provider for the listed call types, one
// attempt per provider with a hard timeout and no sleeps, thinking kept to
// its minimum, a tight output cap, an optional SSE stream to the client, and
// a short user-scoped response cache. Everything here is pure (no network, no
// Deno APIs) so it is unit-tested in supabase/functions/tests/ai_fast_test.ts.
// ============================================================

export type FastProvider = 'gemini' | 'groq';

// Call types whose answer is a sentence or two the user is waiting on.
// Provider preference: Groq's small open-weight model on the free tier (its
// own rate-limit bucket, $0) answers first; the router's next configured
// provider (Gemini flash-lite) is the timed fallback.
export const LATENCY_ROUTE_PROVIDER: Record<string, FastProvider> = {
    'start-sit': 'groq',
};

// A one-to-two sentence note never needs more; also bounds a runaway.
export const LATENCY_MAX_OUTPUT_TOKENS = 600;

// Per-attempt deadline (request sent → first byte of the answer). The first
// provider gets less rope than the last one: failing over early is the point.
export const LATENCY_TIMEOUTS_MS = { primary: 5000, fallback: 8000 } as const;
// Streamed (non-latency) generic calls: generous, but never unbounded.
export const STREAM_TIMEOUTS_MS = { primary: 20000, fallback: 25000 } as const;
// Once text is flowing, the whole answer must finish inside this.
export const STREAM_TOTAL_CAP_MS = 45000;

// Generic-path call types that may be served from the response cache. Keyed
// on the exact prompt (which carries the facts), so any change to the week,
// lineup, win % or swaps produces a fresh entry. User-scoped.
export const GENERIC_CACHEABLE_TYPES: Record<string, number> = {
    'start-sit': 6 * 60 * 60 * 1000,
};

export function normalizeFastProvider(value: unknown): FastProvider | null {
    const v = String(value || '').trim().toLowerCase();
    return v === 'gemini' || v === 'groq' ? v : null;
}

// The latency-first provider for a call type, or null when the type is not
// on the fast lane. AI_LATENCY_PROVIDER (env) may swap the provider; the
// value 'off' disables the preference (the tier default applies again).
export function latencyProviderFor(type: string, envOverride?: string | null): FastProvider | null {
    const base = LATENCY_ROUTE_PROVIDER[type];
    if (!base) return null;
    const raw = String(envOverride || '').trim().toLowerCase();
    if (raw === 'off' || raw === 'none') return null;
    return normalizeFastProvider(raw) || base;
}

export function isLatencyRoute(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(LATENCY_ROUTE_PROVIDER, type);
}

// Lowest thinking setting a Gemini id accepts on the OpenAI-compatible
// endpoint: 2.5 Flash / Flash-Lite can turn thinking off ("none"); Gemini 3
// cannot, "minimal" is its floor; an alias of unknown generation gets "low",
// which both generations accept. Pro models are never on the fast lane.
export function geminiReasoningEffort(model: string): 'none' | 'minimal' | 'low' | null {
    const m = String(model || '').toLowerCase();
    if (!m.startsWith('gemini')) return null;
    if (m.includes('-pro')) return null;
    if (/^gemini-2\.5-flash/.test(m)) return 'none';
    if (/^gemini-3/.test(m)) return 'minimal';
    return 'low';
}

export interface ChatBodyArgs {
    provider: FastProvider;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    stream: boolean;
    latency: boolean;
    omitReasoning?: boolean;
}

// OpenAI-compatible chat-completions body for Gemini or Groq.
export function buildChatCompletionBody(args: ChatBodyArgs): Record<string, unknown> {
    const body: Record<string, unknown> = {
        model: args.model,
        max_tokens: args.maxTokens,
        messages: [
            { role: 'system', content: args.systemPrompt },
            { role: 'user', content: args.userPrompt },
        ],
    };
    if (args.provider === 'groq') {
        // gpt-oss "thinks" out of the completion budget; low keeps it short.
        if (!args.omitReasoning) body.reasoning_effort = 'low';
        if (args.stream) body.stream_options = { include_usage: true };
    } else if (args.latency && !args.omitReasoning) {
        const effort = geminiReasoningEffort(args.model);
        if (effort) body.reasoning_effort = effort;
    }
    if (args.stream) body.stream = true;
    return body;
}

// A 400 that names the reasoning parameter: resend once without it.
export function isReasoningParamError(status: number, message: string): boolean {
    return status === 400 && /reasoning|thinking/i.test(String(message || ''));
}

// ── Server-Sent Events ───────────────────────────────────────
// Incremental parser: push() raw decoded text as it arrives, get back the
// complete events it finished (partial lines are buffered). Handles \n, \r\n
// and \r line endings, multi-line data, comments and named events.
export interface SSEEvent { event: string; data: string }

export function createSSEParser() {
    let buffer = '';
    let dataLines: string[] = [];
    let eventName = '';

    function dispatch(out: SSEEvent[]) {
        if (dataLines.length) out.push({ event: eventName || 'message', data: dataLines.join('\n') });
        dataLines = [];
        eventName = '';
    }

    function processLine(line: string, out: SSEEvent[]) {
        if (line === '') { dispatch(out); return; }
        if (line.startsWith(':')) return; // comment / keep-alive
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        let value = colon < 0 ? '' : line.slice(colon + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') dataLines.push(value);
        else if (field === 'event') eventName = value;
        // id / retry are irrelevant here
    }

    return {
        push(chunk: string): SSEEvent[] {
            const out: SSEEvent[] = [];
            buffer += chunk;
            // Normalise line endings, but keep a trailing lone \r buffered: it
            // may be the first half of a \r\n split across chunks.
            let text = buffer;
            let carry = '';
            if (text.endsWith('\r')) { carry = '\r'; text = text.slice(0, -1); }
            text = text.replace(/\r\n?/g, '\n');
            const parts = text.split('\n');
            buffer = parts.pop()! + carry;
            for (const line of parts) processLine(line, out);
            return out;
        },
        flush(): SSEEvent[] {
            const out: SSEEvent[] = [];
            if (buffer) { processLine(buffer.replace(/\r$/, ''), out); buffer = ''; }
            dispatch(out);
            return out;
        },
    };
}

export interface ChunkUsage { inputTokens: number; outputTokens: number }
export interface ParsedChunk { done: boolean; text: string; usage: ChunkUsage | null; finishReason: string | null }

// One OpenAI-compatible streaming chunk (Gemini and Groq both speak it;
// Groq also reports usage under x_groq.usage on the last chunk).
export function parseChatCompletionChunk(data: string): ParsedChunk | null {
    const raw = String(data || '').trim();
    if (!raw) return null;
    if (raw === '[DONE]') return { done: true, text: '', usage: null, finishReason: null };
    let json: any;
    try { json = JSON.parse(raw); } catch { return null; }
    const choice = Array.isArray(json?.choices) ? json.choices[0] : null;
    const text = typeof choice?.delta?.content === 'string' ? choice.delta.content : '';
    const u = json?.usage || json?.x_groq?.usage || null;
    const usage = u
        ? { inputTokens: Number(u.prompt_tokens || u.input_tokens || 0), outputTokens: Number(u.completion_tokens || u.output_tokens || 0) }
        : null;
    return { done: false, text, usage, finishReason: choice?.finish_reason || null };
}

// One SSE frame from the edge function to the client.
export function formatSSE(event: string, data: unknown): string {
    const payload = typeof data === 'string' ? data : JSON.stringify(data);
    return `event: ${event}\n` + payload.split('\n').map(l => `data: ${l}`).join('\n') + '\n\n';
}

// Cache-key material for a generic call: the exact prompt the model would
// see, scoped to the caller. The caller hashes it (SHA-256).
export function genericCacheMaterial(args: {
    policyVersion: string;
    callType: string;
    identifier: string;
    systemPrompt: string;
    userPrompt: string;
}): string {
    return [
        args.policyVersion,
        'generic',
        args.callType,
        args.identifier,
        String(args.systemPrompt || '').length,
        args.systemPrompt || '',
        args.userPrompt || '',
    ].join('␞');
}

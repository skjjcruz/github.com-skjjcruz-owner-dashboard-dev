// deno test supabase/functions/tests/
import { assertEquals, assert, assertNotEquals } from 'jsr:@std/assert@1';
import {
    buildChatCompletionBody,
    createSSEParser,
    formatSSE,
    GENERIC_CACHEABLE_TYPES,
    geminiReasoningEffort,
    genericCacheMaterial,
    isLatencyRoute,
    isReasoningParamError,
    LATENCY_MAX_OUTPUT_TOKENS,
    LATENCY_TIMEOUTS_MS,
    latencyProviderFor,
    parseChatCompletionChunk,
} from '../_shared/ai-fast.ts';

Deno.test('start-sit is on the fast lane, Groq first; env can swap or disable it', () => {
    assert(isLatencyRoute('start-sit'));
    assert(!isLatencyRoute('home-chat'));
    assertEquals(latencyProviderFor('start-sit'), 'groq');
    assertEquals(latencyProviderFor('start-sit', 'gemini'), 'gemini');
    assertEquals(latencyProviderFor('start-sit', 'GROQ'), 'groq');
    assertEquals(latencyProviderFor('start-sit', 'off'), null);
    assertEquals(latencyProviderFor('start-sit', 'anthropic'), 'groq'); // paid providers never on this lane
    assertEquals(latencyProviderFor('home-chat', 'groq'), null);
});

Deno.test('fast-lane budgets: tight output cap, primary deadline shorter than fallback', () => {
    assert(LATENCY_MAX_OUTPUT_TOKENS <= 800);
    assert(LATENCY_TIMEOUTS_MS.primary < LATENCY_TIMEOUTS_MS.fallback);
    assert(LATENCY_TIMEOUTS_MS.primary + LATENCY_TIMEOUTS_MS.fallback <= 15000);
    assert(GENERIC_CACHEABLE_TYPES['start-sit'] > 0);
});

Deno.test('Gemini thinking floor per generation', () => {
    assertEquals(geminiReasoningEffort('gemini-2.5-flash-lite'), 'none');
    assertEquals(geminiReasoningEffort('gemini-2.5-flash'), 'none');
    assertEquals(geminiReasoningEffort('gemini-3-flash-preview'), 'minimal');
    assertEquals(geminiReasoningEffort('gemini-flash-latest'), 'low');
    assertEquals(geminiReasoningEffort('gemini-2.5-pro'), null);
    assertEquals(geminiReasoningEffort('openai/gpt-oss-20b'), null);
});

Deno.test('chat body: Groq low reasoning + usage in stream; Gemini effort only on the fast lane', () => {
    const base = { systemPrompt: 'S', userPrompt: 'U', maxTokens: 300 };
    const groq = buildChatCompletionBody({ ...base, provider: 'groq', model: 'openai/gpt-oss-20b', stream: true, latency: true });
    assertEquals(groq.reasoning_effort, 'low');
    assertEquals(groq.stream, true);
    assertEquals(groq.stream_options, { include_usage: true });
    assertEquals(groq.max_tokens, 300);
    assertEquals((groq.messages as any[]).map(m => m.role), ['system', 'user']);

    const gemFast = buildChatCompletionBody({ ...base, provider: 'gemini', model: 'gemini-3-flash-preview', stream: false, latency: true });
    assertEquals(gemFast.reasoning_effort, 'minimal');
    assertEquals(gemFast.stream, undefined);
    assertEquals(gemFast.stream_options, undefined); // not part of Gemini's documented compat surface

    const gemStd = buildChatCompletionBody({ ...base, provider: 'gemini', model: 'gemini-2.5-flash', stream: true, latency: false });
    assertEquals(gemStd.reasoning_effort, undefined); // quality routes keep their thinking
    assertEquals(gemStd.stream, true);

    const retry = buildChatCompletionBody({ ...base, provider: 'gemini', model: 'gemini-2.5-flash-lite', stream: false, latency: true, omitReasoning: true });
    assertEquals(retry.reasoning_effort, undefined);
});

Deno.test('reasoning-param 400 is recognised; other errors are not', () => {
    assert(isReasoningParamError(400, 'Invalid value for reasoning_effort'));
    assert(isReasoningParamError(400, 'Thinking level not supported'));
    assert(!isReasoningParamError(429, 'reasoning'));
    assert(!isReasoningParamError(400, 'bad model'));
});

Deno.test('SSE parser: events split across arbitrary chunk boundaries and line endings', () => {
    const stream = 'data: {"a":1}\r\n\r\n: keep-alive\n\nevent: delta\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n';
    // Feed it one character at a time — the worst case for buffering.
    const p = createSSEParser();
    const got: { event: string; data: string }[] = [];
    for (const ch of stream) got.push(...p.push(ch));
    got.push(...p.flush());
    assertEquals(got, [
        { event: 'message', data: '{"a":1}' },
        { event: 'delta', data: 'line1\nline2' },
        { event: 'message', data: '[DONE]' },
    ]);
});

Deno.test('SSE parser: CR-only endings, trailing event without blank line, no-space values', () => {
    const p = createSSEParser();
    const got = [...p.push('data:x\r\rdata: y'), ...p.flush()];
    assertEquals(got, [{ event: 'message', data: 'x' }, { event: 'message', data: 'y' }]);
});

Deno.test('SSE round trip: formatSSE output parses back, including multi-line payloads', () => {
    const frames = formatSSE('delta', { text: 'Start Waddle.\nSit Odunze.' }) + formatSSE('note', 'two\nlines');
    const p = createSSEParser();
    const got = [...p.push(frames), ...p.flush()];
    assertEquals(got.length, 2);
    assertEquals(got[0].event, 'delta');
    assertEquals(JSON.parse(got[0].data).text, 'Start Waddle.\nSit Odunze.');
    assertEquals(got[1], { event: 'note', data: 'two\nlines' });
});

Deno.test('chat chunk parser: text deltas, finish reason, usage (OpenAI and Groq shapes), DONE, junk', () => {
    assertEquals(parseChatCompletionChunk('{"choices":[{"delta":{"content":"Start "}}]}'),
        { done: false, text: 'Start ', usage: null, finishReason: null });
    assertEquals(parseChatCompletionChunk('{"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":410,"completion_tokens":52}}'),
        { done: false, text: '', usage: { inputTokens: 410, outputTokens: 52 }, finishReason: 'stop' });
    assertEquals(parseChatCompletionChunk('{"choices":[{"delta":{}}],"x_groq":{"usage":{"prompt_tokens":7,"completion_tokens":3}}}')?.usage,
        { inputTokens: 7, outputTokens: 3 });
    assertEquals(parseChatCompletionChunk('[DONE]'), { done: true, text: '', usage: null, finishReason: null });
    assertEquals(parseChatCompletionChunk('not json'), null);
    assertEquals(parseChatCompletionChunk(''), null);
});

Deno.test('generic cache material: same prompt+caller → same key; any fact or caller change → new key', () => {
    const base = { policyVersion: 'v1', callType: 'start-sit', identifier: 'app:u1', systemPrompt: 'S', userPrompt: '{"week":4,"winPct":62}' };
    assertEquals(genericCacheMaterial(base), genericCacheMaterial({ ...base }));
    assertNotEquals(genericCacheMaterial(base), genericCacheMaterial({ ...base, userPrompt: '{"week":4,"winPct":63}' }));
    assertNotEquals(genericCacheMaterial(base), genericCacheMaterial({ ...base, identifier: 'app:u2' }));
    assertNotEquals(genericCacheMaterial(base), genericCacheMaterial({ ...base, policyVersion: 'v2' }));
    // A boundary shift between system and user text is still a different key.
    assertNotEquals(genericCacheMaterial({ ...base, systemPrompt: 'SA', userPrompt: 'B' }),
        genericCacheMaterial({ ...base, systemPrompt: 'S', userPrompt: 'AB' }));
});

// ============================================================
// Owner Dashboard — AI Analysis Edge Function  [v3]
// Supabase Edge Function: /functions/v1/ai-analyze
//
// DEPLOY:
//   supabase functions deploy ai-analyze
//
// SET SECRET:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase secrets set GOOGLE_AI_KEY=AIza...
//   supabase secrets set OPENAI_API_KEY=sk-...
// ============================================================

import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    corsHeaders,
    hasAdminRole,
    handleOptions,
    requireActiveAppSession,
    requireSleeperSession,
} from '../_shared/security.ts';

// ── Rate limiting ─────────────────────────────────────────────
// 10 AI requests per user per minute to protect Anthropic API costs.
// Uses Deno KV (shared across Edge Function instances).
const RATE_LIMIT_MAX     = 10;
const RATE_LIMIT_WINDOW  = 60 * 1000; // 1 minute in ms

function extractUsernameFromJWT(authHeader: string | null): string {
    if (!authHeader) return 'anonymous';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
        const [, payload] = token.split('.');
        const decoded = JSON.parse(atob(payload));
        return decoded?.app_metadata?.sleeper_username
            ?? decoded?.sub
            ?? 'anonymous';
    } catch { return 'anonymous'; }
}

async function checkRateLimit(identifier: string): Promise<{ allowed: boolean; retryAfterMs?: number }> {
    try {
        const kv = await Deno.openKv();
        const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW);
        const key = ['rate_limit', 'ai_analyze', identifier, bucket];
        const entry = await kv.get<number>(key);
        const count = entry.value ?? 0;
        if (count >= RATE_LIMIT_MAX) {
            const windowEnd = (bucket + 1) * RATE_LIMIT_WINDOW;
            return { allowed: false, retryAfterMs: windowEnd - Date.now() };
        }
        await kv.set(key, count + 1, { expireIn: RATE_LIMIT_WINDOW });
        return { allowed: true };
    } catch {
        // If KV is unavailable, allow the request (fail open)
        return { allowed: true };
    }
}

type AIPlanName = 'free' | 'scout' | 'warroom' | 'pro' | 'commissioner' | 'legacy';

interface AISession {
    identifier: string;
    username: string | null;
    userId: string | null;
    email: string | null;
    plan: AIPlanName;
    products: string[];
    source: 'app' | 'sleeper';
}

function normalizeAIPlan(value: unknown): AIPlanName {
    const plan = String(value || 'free').toLowerCase();
    if (plan === 'commissioner') return 'commissioner';
    if (plan === 'pro' || plan === 'power' || plan === 'bundle') return 'pro';
    if (plan === 'warroom' || plan === 'war_room' || plan === 'standard') return 'warroom';
    if (plan === 'scout' || plan === 'dynast_hq' || plan === 'reconai') return 'scout';
    if (plan === 'legacy') return 'legacy';
    return 'free';
}

async function loadAppAIPlan(
    supabase: any,
    userId: string,
    payload: Record<string, any>,
): Promise<{ plan: AIPlanName; products: string[] }> {
    const metadata = payload?.app_metadata || {};
    const fallbackPlan = normalizeAIPlan(metadata.tier);
    const fallbackProducts = Array.isArray(metadata.products) ? metadata.products.map(String) : [];

    const isAdmin = await hasAdminRole(supabase, userId).catch(() => false);
    if (isAdmin) {
        return { plan: 'commissioner', products: fallbackProducts };
    }

    const subs = await safeSupabaseData(supabase
        .from('subscriptions')
        .select('product_slug, tier, status')
        .eq('user_id', userId)
        .in('status', ['active', 'trialing']));

    const activePaid = (subs || []).filter((s: any) => s?.tier === 'pro');
    const paidProducts = activePaid.map((s: any) => String(s.product_slug || ''));
    const products = paidProducts.length
        ? [...new Set(paidProducts.flatMap((slug: string) => slug === 'bundle' ? ['war_room', 'dynast_hq'] : [slug]))]
        : fallbackProducts;

    if (paidProducts.includes('bundle') || (products.includes('war_room') && products.includes('dynast_hq'))) {
        return { plan: 'pro', products };
    }
    if (paidProducts.includes('war_room')) {
        return { plan: 'warroom', products };
    }
    if (paidProducts.includes('dynast_hq')) {
        return { plan: 'scout', products };
    }
    if (fallbackPlan !== 'free') {
        return { plan: fallbackPlan, products };
    }
    return { plan: 'free', products };
}

async function resolveAISession(req: Request): Promise<AISession | null> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (supabaseUrl && serviceRoleKey) {
        const supabase = createClient(supabaseUrl, serviceRoleKey);
        const appSession = await requireActiveAppSession(supabase, req);
        if (appSession) {
            const entitlement = await loadAppAIPlan(supabase, appSession.userId, appSession.payload);
            return {
                identifier: `app:${appSession.userId}`,
                username: null,
                userId: appSession.userId,
                email: appSession.email,
                plan: entitlement.plan,
                products: entitlement.products,
                source: 'app',
            };
        }
    }

    const sleeperSession = await requireSleeperSession(req);
    if (sleeperSession) {
        return {
            identifier: `sleeper:${sleeperSession.username.toLowerCase()}`,
            username: sleeperSession.username,
            userId: null,
            email: null,
            plan: 'legacy',
            products: ['legacy_sleeper'],
            source: 'sleeper',
        };
    }

    return null;
}

// ── AI model routing and cost telemetry ───────────────────────
type AIProvider = 'anthropic' | 'gemini' | 'openai';
type AIWorkloadTier = 'fast' | 'standard' | 'premium' | 'deep';
interface AIRoute {
    provider: AIProvider;
    model: string;
    tier: AIWorkloadTier;
}

const AI_POLICY_VERSION = '2026-05-03.vendor-router.v1';

const AI_MODELS = {
    GEMINI_FAST: 'gemini-2.5-flash-lite',
    GEMINI_BALANCED: 'gemini-2.5-flash',
    OPENAI_FAST: 'gpt-5.4-nano',
    OPENAI_STANDARD: 'gpt-5.4-mini',
    OPENAI_PREMIUM: 'gpt-5.5',
    CLAUDE_REASONING: 'claude-sonnet-4-6',
    CLAUDE_DEEP: 'claude-opus-4-7',
} as const;

const MODEL_COSTS: Record<string, { input: number; output: number; cachedInput?: number }> = {
    'gemini-2.5-flash-lite': { input: 0.10, output: 0.40 },
    'gemini-2.5-flash': { input: 0.30, output: 2.50 },
    'gpt-5.4-nano': { input: 0.20, output: 1.25, cachedInput: 0.02 },
    'gpt-5.4-mini': { input: 0.75, output: 4.50, cachedInput: 0.075 },
    'gpt-5.5': { input: 5.00, output: 30.00, cachedInput: 0.50 },
    'claude-sonnet-4-6': { input: 3.00, output: 15.00, cachedInput: 0.30 },
    'claude-opus-4-7': { input: 5.00, output: 25.00, cachedInput: 0.50 },
};

const AI_TIER_MODELS: Record<AIWorkloadTier, Partial<Record<AIProvider, string>>> = {
    fast: {
        gemini: AI_MODELS.GEMINI_FAST,
        openai: AI_MODELS.OPENAI_FAST,
    },
    standard: {
        gemini: AI_MODELS.GEMINI_BALANCED,
        openai: AI_MODELS.OPENAI_STANDARD,
    },
    premium: {
        anthropic: AI_MODELS.CLAUDE_REASONING,
        openai: AI_MODELS.OPENAI_PREMIUM,
    },
    deep: {
        anthropic: AI_MODELS.CLAUDE_DEEP,
    },
};

const DEFAULT_PROVIDER_BY_TIER: Record<AIWorkloadTier, AIProvider> = {
    fast: 'gemini',
    standard: 'gemini',
    premium: 'anthropic',
    deep: 'anthropic',
};

const PROVIDER_OVERRIDE_ENV: Record<AIWorkloadTier, string> = {
    fast: 'AI_FAST_PROVIDER',
    standard: 'AI_STANDARD_PROVIDER',
    premium: 'AI_PREMIUM_PROVIDER',
    deep: 'AI_DEEP_PROVIDER',
};

type AIModelTier = AIWorkloadTier;

interface AIPlanLimits {
    dailyRequests: number;
    monthlyRequests: number;
    dailyCostUsd: number;
    monthlyCostUsd: number;
    maxOutputTokens: number;
    mockDraftMaxOutputTokens: number;
    maxInputChars: number;
    maxModelTier: AIModelTier;
    allowWebSearch: boolean;
}

const MODEL_TIERS: Record<string, AIModelTier> = {
    'gemini-2.5-flash-lite': 'fast',
    'gemini-2.5-flash': 'standard',
    'gpt-5.4-nano': 'fast',
    'gpt-5.4-mini': 'standard',
    'gpt-5.5': 'premium',
    'claude-sonnet-4-6': 'premium',
    'claude-opus-4-7': 'deep',
};

const MODEL_TIER_RANK: Record<AIModelTier, number> = { fast: 1, standard: 2, premium: 3, deep: 4 };

const AI_LIMITS: Record<AIPlanName, AIPlanLimits> = {
    free: {
        dailyRequests: 1,
        monthlyRequests: 31,
        dailyCostUsd: 0.10,
        monthlyCostUsd: 1.00,
        maxOutputTokens: 700,
        mockDraftMaxOutputTokens: 0,
        maxInputChars: 20000,
        maxModelTier: 'standard',
        allowWebSearch: false,
    },
    scout: {
        dailyRequests: 1,
        monthlyRequests: 31,
        dailyCostUsd: 0.10,
        monthlyCostUsd: 1.00,
        maxOutputTokens: 700,
        mockDraftMaxOutputTokens: 0,
        maxInputChars: 20000,
        maxModelTier: 'standard',
        allowWebSearch: false,
    },
    warroom: {
        dailyRequests: 5,
        monthlyRequests: 20,
        dailyCostUsd: 0.75,
        monthlyCostUsd: 6.00,
        maxOutputTokens: 2200,
        mockDraftMaxOutputTokens: 6000,
        maxInputChars: 55000,
        maxModelTier: 'premium',
        allowWebSearch: false,
    },
    pro: {
        dailyRequests: 25,
        monthlyRequests: 200,
        dailyCostUsd: 3.00,
        monthlyCostUsd: 35.00,
        maxOutputTokens: 4200,
        mockDraftMaxOutputTokens: 10000,
        maxInputChars: 90000,
        maxModelTier: 'premium',
        allowWebSearch: true,
    },
    commissioner: {
        dailyRequests: 60,
        monthlyRequests: 600,
        dailyCostUsd: 10.00,
        monthlyCostUsd: 150.00,
        maxOutputTokens: 8000,
        mockDraftMaxOutputTokens: 16000,
        maxInputChars: 140000,
        maxModelTier: 'deep',
        allowWebSearch: true,
    },
    legacy: {
        dailyRequests: 10,
        monthlyRequests: 100,
        dailyCostUsd: 1.00,
        monthlyCostUsd: 12.00,
        maxOutputTokens: 2200,
        mockDraftMaxOutputTokens: 6000,
        maxInputChars: 55000,
        maxModelTier: 'premium',
        allowWebSearch: false,
    },
};

function envFlag(name: string, defaultValue = false): boolean {
    const raw = Deno.env.get(name);
    if (raw == null || raw === '') return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function envNumber(name: string, defaultValue: number): number {
    const raw = Number(Deno.env.get(name));
    return Number.isFinite(raw) ? raw : defaultValue;
}

function isAIEnabled(): boolean {
    if (envFlag('AI_KILL_SWITCH', false)) return false;
    return envFlag('AI_ENABLED', true);
}

function allowExpensiveFallback(): boolean {
    return envFlag('AI_ALLOW_EXPENSIVE_FALLBACK', !Deno.env.get('GOOGLE_AI_KEY') && !Deno.env.get('OPENAI_API_KEY'));
}

function providerSecretName(provider: AIProvider): string {
    if (provider === 'gemini') return 'GOOGLE_AI_KEY';
    if (provider === 'openai') return 'OPENAI_API_KEY';
    return 'ANTHROPIC_API_KEY';
}

const AI_SECRET_CACHE = new Map<string, string | null>();

async function getVaultSecret(secretName: string): Promise<string | null> {
    if (AI_SECRET_CACHE.has(secretName)) {
        return AI_SECRET_CACHE.get(secretName) || null;
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
        AI_SECRET_CACHE.set(secretName, null);
        return null;
    }

    try {
        const admin = createClient(supabaseUrl, serviceRoleKey);
        const data = await safeSupabaseData(admin.rpc('get_app_secret', { secret_name: secretName }));
        const value = typeof data === 'string' ? data.trim() : '';
        AI_SECRET_CACHE.set(secretName, value || null);
        return value || null;
    } catch {
        AI_SECRET_CACHE.set(secretName, null);
        return null;
    }
}

async function getProviderSecret(provider: AIProvider): Promise<string | null> {
    const secretName = providerSecretName(provider);
    return Deno.env.get(secretName) || await getVaultSecret(secretName);
}

async function isProviderConfigured(provider: AIProvider): Promise<boolean> {
    return !!(await getProviderSecret(provider));
}

function normalizeProvider(value: string | null | undefined): AIProvider | null {
    const provider = String(value || '').trim().toLowerCase();
    if (provider === 'gemini' || provider === 'openai' || provider === 'anthropic') return provider;
    return null;
}

function routeForProviderTier(tier: AIWorkloadTier, provider: AIProvider): AIRoute | null {
    const model = AI_TIER_MODELS[tier]?.[provider];
    return model ? { provider, model, tier } : null;
}

function preferredProviderForTier(tier: AIWorkloadTier): AIProvider {
    return normalizeProvider(Deno.env.get(PROVIDER_OVERRIDE_ENV[tier])) || DEFAULT_PROVIDER_BY_TIER[tier];
}

function routeForTier(tier: AIWorkloadTier, provider?: AIProvider): AIRoute {
    const preferred = provider || preferredProviderForTier(tier);
    return routeForProviderTier(tier, preferred)
        || routeForProviderTier(tier, DEFAULT_PROVIDER_BY_TIER[tier])
        || routeForProviderTier('standard', 'gemini')!;
}

const AI_ROUTES: Record<string, AIWorkloadTier> = {
    // Frequent Alex surfaces should be self-sufficient and inexpensive.
    chat:       'standard',
    fa_chat:    'fast',
    fa_targets: 'fast',
    league:     'standard',
    team:       'standard',
    partners:   'standard',
    // Keep long structured generation on premium models for reliability.
    mock_draft: 'premium',
    rookies:    'premium',
    // ReconAI / Scout generic chat routes.
    'trade-chat':        'premium',
    'trade-scout':       'premium',
    'draft-scout':       'premium',
    'pick-analysis':     'premium',
    'player-scout':      'premium',
    'waiver-chat':       'standard',
    'waiver-agent':      'standard',
    'draft-chat':        'standard',
    'strategy-analysis': 'standard',
    'home-chat':         'fast',
    'memory-summary':    'fast',
    'power-posts':       'fast',
    'recon-chat':        'fast',
    general:             'standard',
    'deep-analysis':     'deep',
    'league-report':     'deep',
    'rule-simulator':    'deep',
    'trade-audit':       'deep',
};

function routeForType(type: string): AIRoute {
    return routeForTier(AI_ROUTES[type] || 'standard');
}

function modelTier(model: string): AIModelTier {
    return MODEL_TIERS[model] || 'standard';
}

function allowsModelTier(limit: AIPlanLimits, tier: AIModelTier): boolean {
    return MODEL_TIER_RANK[tier] <= MODEL_TIER_RANK[limit.maxModelTier];
}

function downgradeRouteForEntitlement(route: AIRoute, limits: AIPlanLimits): { route: AIRoute; downgraded: boolean } {
    if (allowsModelTier(limits, modelTier(route.model))) {
        return { route, downgraded: false };
    }
    if (allowsModelTier(limits, 'premium')) return { route: routeForTier('premium'), downgraded: true };
    if (allowsModelTier(limits, 'standard')) return { route: routeForTier('standard'), downgraded: true };
    return { route: routeForTier('fast'), downgraded: true };
}

async function resolveConfiguredRoute(
    route: AIRoute,
    limits: AIPlanLimits,
    useWebSearch: boolean,
    blockedProvider: AIProvider | null = null,
): Promise<{ route: AIRoute | null; providerFallback: boolean; providerFallbackReason: string | null }> {
    if (useWebSearch) {
        const webRoute = routeForProviderTier('premium', 'anthropic');
        if (webRoute && blockedProvider !== 'anthropic' && allowsModelTier(limits, webRoute.tier) && await isProviderConfigured(webRoute.provider)) {
            return {
                route: webRoute,
                providerFallback: route.provider !== webRoute.provider || route.model !== webRoute.model,
                providerFallbackReason: route.provider === webRoute.provider ? null : 'web_search_requires_anthropic',
            };
        }
        return { route: null, providerFallback: false, providerFallbackReason: 'web_search_provider_unavailable' };
    }

    if (blockedProvider !== route.provider && await isProviderConfigured(route.provider)) {
        return { route, providerFallback: false, providerFallbackReason: null };
    }

    const candidates: AIRoute[] = [];
    (['openai', 'gemini', 'anthropic'] as AIProvider[]).forEach(provider => {
        const candidate = routeForProviderTier(route.tier, provider);
        if (candidate) candidates.push(candidate);
    });

    if (allowExpensiveFallback() && allowsModelTier(limits, 'premium')) {
        (['openai', 'anthropic'] as AIProvider[]).forEach(provider => {
            const candidate = routeForProviderTier('premium', provider);
            if (candidate) candidates.push(candidate);
        });
    }

    let fallback: AIRoute | null = null;
    for (const candidate of candidates) {
        if (
            candidate.provider !== route.provider
            && candidate.provider !== blockedProvider
            && allowsModelTier(limits, candidate.tier)
            && await isProviderConfigured(candidate.provider)
        ) {
            fallback = candidate;
            break;
        }
    }

    return fallback
        ? { route: fallback, providerFallback: true, providerFallbackReason: blockedProvider ? `${blockedProvider}_provider_error` : `${route.provider}_unconfigured` }
        : { route: null, providerFallback: false, providerFallbackReason: 'no_configured_provider' };
}

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number, cachedInputTokens = 0): number {
    const costs = MODEL_COSTS[model];
    if (!costs) return 0;
    const billableInput = Math.max(0, inputTokens - cachedInputTokens);
    const inputCost = (billableInput / 1_000_000) * costs.input;
    const cachedCost = (cachedInputTokens / 1_000_000) * (costs.cachedInput ?? costs.input);
    const outputCost = (outputTokens / 1_000_000) * costs.output;
    return Number((inputCost + cachedCost + outputCost).toFixed(6));
}

function estimatePromptTokens(text: string): number {
    return Math.ceil(String(text || '').length / 4);
}

function isProviderAvailabilityError(error: any): boolean {
    const message = String(error?.message || error || '').toLowerCase();
    return /429|rate|timeout|temporar|unavailable|overload|quota|502|503|529/.test(message);
}

async function callAIProvider(args: {
    route: AIRoute;
    systemPrompt: string;
    userPrompt: string;
    maxTokens: number;
    useWebSearch: boolean;
}): Promise<{
    analysis: string;
    stopReason: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
}> {
    const { route, systemPrompt, userPrompt, maxTokens, useWebSearch } = args;

    if (route.provider === 'gemini') {
        const googleKey = await getProviderSecret('gemini');
        if (!googleKey) throw new Error('GOOGLE_AI_KEY not configured');
        const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${googleKey}`,
            },
            body: JSON.stringify({
                model: route.model,
                max_tokens: maxTokens,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as any).error?.message || `Gemini API error ${res.status}`);
        }
        const data = await res.json();
        const usage = (data as any).usage || {};
        let inputTokens = usage.prompt_tokens || usage.input_tokens || 0;
        const outputTokens = usage.completion_tokens || usage.output_tokens || 0;
        if (!inputTokens && !outputTokens && usage.total_tokens) inputTokens = usage.total_tokens;
        return {
            analysis: (data as any).choices?.[0]?.message?.content || '',
            stopReason: '',
            inputTokens,
            outputTokens,
            cachedInputTokens: 0,
        };
    }

    if (route.provider === 'openai') {
        const apiKey = await getProviderSecret('openai');
        if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
        const res = await fetch('https://api.openai.com/v1/responses', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: route.model,
                instructions: systemPrompt,
                input: [{ role: 'user', content: userPrompt }],
                max_output_tokens: maxTokens,
            }),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error((err as any).error?.message || `OpenAI API error ${res.status}`);
        }
        const data = await res.json();
        const usage = (data as any).usage || {};
        return {
            analysis: (data as any).output_text || ((data as any).output || [])
                .flatMap((item: any) => item?.content || [])
                .filter((part: any) => part?.type === 'output_text' || part?.type === 'text')
                .map((part: any) => part?.text || '')
                .join(''),
            stopReason: (data as any).status === 'incomplete' ? 'max_tokens' : '',
            inputTokens: usage.input_tokens || usage.prompt_tokens || 0,
            outputTokens: usage.output_tokens || usage.completion_tokens || 0,
            cachedInputTokens: usage.input_tokens_details?.cached_tokens || usage.cached_input_tokens || 0,
        };
    }

    const apiKey = await getProviderSecret('anthropic');
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');

    const anthropic = new Anthropic({ apiKey });
    const anthropicRequest: any = {
        model: route.model,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
    };
    if (useWebSearch) {
        anthropicRequest.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }
    const message = await anthropic.messages.create(
        anthropicRequest,
        useWebSearch ? { headers: { 'anthropic-beta': 'web-search-2025-03-05' } } : undefined,
    );
    const usage = (message as any).usage || {};
    return {
        analysis: ((message.content || []) as any[])
            .filter(part => part.type === 'text')
            .map(part => part.text || '')
            .join(''),
        stopReason: (message as any).stop_reason || '',
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cachedInputTokens: usage.cache_read_input_tokens || 0,
    };
}

function clampTextToChars(text: string, maxChars: number): { text: string; truncated: boolean } {
    const value = String(text || '');
    if (value.length <= maxChars) return { text: value, truncated: false };
    const suffix = '\n\n[Context truncated to fit launch AI limits.]';
    return { text: value.slice(0, Math.max(0, maxChars - suffix.length)) + suffix, truncated: true };
}

const STRUCTURED_TYPES = new Set(['league', 'team', 'partners', 'fa_targets', 'rookies', 'fa_chat', 'mock_draft', 'chat']);

interface GenericAIContext {
    callType: string;
    system: string;
    userPrompt: string;
    maxTokens: number;
    useWebSearch: boolean;
    leagueId: string | null;
    sessionId: string | null;
}

function decodeAuthPayload(authHeader: string | null): Record<string, any> | null {
    if (!authHeader) return null;
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    try {
        const [, payload] = token.split('.');
        return JSON.parse(atob(payload));
    } catch {
        return null;
    }
}

function parseContextPayload(context: any): any {
    if (typeof context !== 'string') return context || {};
    try {
        return JSON.parse(context);
    } catch {
        return { userMessage: context, messages: [{ role: 'user', content: context }] };
    }
}

function normalizeGenericAIContext(type: string, context: any): GenericAIContext | null {
    const parsed = parseContextPayload(context);
    const hasGenericShape = !!(
        parsed?.callType ||
        parsed?.system ||
        parsed?.userMessage ||
        Array.isArray(parsed?.messages) ||
        type === 'general' ||
        !STRUCTURED_TYPES.has(type)
    );
    if (!hasGenericShape) return null;

    const callType = String(parsed?.callType || type || 'recon-chat');
    let messages = Array.isArray(parsed?.messages)
        ? parsed.messages
            .filter((m: any) => m && typeof m.content === 'string')
            .map((m: any) => ({ role: String(m.role || 'user'), content: m.content }))
        : [];

    if (!messages.length && parsed?.userMessage) {
        messages = [{ role: 'user', content: String(parsed.userMessage) }];
    }
    if (!messages.length && typeof context === 'string') {
        messages = [{ role: 'user', content: context }];
    }

    const userPrompt = messages.length
        ? messages.map((m: any) => `${String(m.role || 'user').toUpperCase()}: ${m.content}`).join('\n')
        : `USER: ${JSON.stringify(parsed)}`;

    return {
        callType,
        system: String(parsed?.system || 'Dynasty fantasy football advisor. Values are DHQ on a 0-10000 league-adjusted scale. Be specific, practical, and concise.'),
        userPrompt,
        maxTokens: Math.max(100, Math.min(Number(parsed?.maxTokens) || 600, 4000)),
        useWebSearch: parsed?.useWebSearch === true,
        leagueId: parsed?.leagueId || parsed?.currentLeagueId || null,
        sessionId: parsed?.sessionId || parsed?.session_id || null,
    };
}

function isUuid(value: unknown): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function safeSupabaseData(query: any): Promise<any> {
    try {
        const { data } = await query;
        return data ?? null;
    } catch {
        return null;
    }
}

async function safeSupabaseWrite(query: any): Promise<void> {
    try {
        await query;
    } catch {
        // Analytics and post-response accounting must not break the user flow.
    }
}

async function recordAIAccounting(args: {
    req: Request;
    aiSession: AISession;
    planLimits: AIPlanLimits;
    reservedCostUsd: number;
    routeType: string;
    originalType: string;
    context: any;
    genericContext: GenericAIContext | null;
    route: AIRoute;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    tokensUsed: number;
    estimatedCostUsd: number;
    latencyMs: number;
    providerFallback: boolean;
    providerFallbackReason: string | null;
    routeDowngraded: boolean;
    promptTruncated: boolean;
    webSearchDisabled: boolean;
}) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return { totalTokensUsed: null, usageCounters: null };

    const claims = decodeAuthPayload(args.req.headers.get('Authorization'));
    const userId = args.aiSession.userId || (isUuid(claims?.sub) ? claims?.sub : null);
    const parsed = parseContextPayload(args.context);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    let totalTokensUsed: number | null = null;
    let usageCounters: Record<string, any> | null = null;

    if (args.tokensUsed > 0 && args.aiSession.username) {
        const data = await safeSupabaseData(supabase.rpc('add_ai_tokens_used', {
            p_username: args.aiSession.username,
            p_tokens: args.tokensUsed,
        }));
        if (typeof data === 'number') totalTokensUsed = data;
    }

    const usageData = await safeSupabaseData(supabase.rpc('record_ai_usage_result', {
        p_identifier: args.aiSession.identifier,
        p_user_id: userId,
        p_username: args.aiSession.username,
        p_tier: args.aiSession.plan,
        p_tokens: args.tokensUsed,
        p_estimated_cost_usd: args.estimatedCostUsd,
        p_reserved_cost_usd: args.reservedCostUsd,
    }));
    if (usageData && typeof usageData === 'object') usageCounters = usageData as Record<string, any>;

    await safeSupabaseWrite(supabase.from('analytics_events').insert({
        event_id: crypto.randomUUID(),
        username: args.aiSession.username,
        user_id: userId,
        league_id: args.genericContext?.leagueId || parsed?.leagueId || parsed?.currentLeagueId || null,
        session_id: args.genericContext?.sessionId || parsed?.sessionId || parsed?.session_id || `edge_${args.aiSession.identifier}_${Date.now()}`,
        platform: args.genericContext ? 'reconai' : 'warroom',
        module: 'ai',
        widget: args.routeType,
        event_name: 'ai_call_completed',
        duration_ms: args.latencyMs,
        entity_type: 'ai_call',
        entity_id: args.routeType,
        metadata: {
            originalType: args.originalType,
            callType: args.routeType,
            aiPolicyVersion: AI_POLICY_VERSION,
            routeTier: args.route.tier,
            provider: args.route.provider,
            model: args.route.model,
            inputTokens: args.inputTokens,
            outputTokens: args.outputTokens,
            cachedInputTokens: args.cachedInputTokens,
            tokensUsed: args.tokensUsed,
            totalTokensUsed,
            estimatedCostUsd: args.estimatedCostUsd,
            providerFallback: args.providerFallback,
            providerFallbackReason: args.providerFallbackReason,
            useWebSearch: !!args.genericContext?.useWebSearch,
            routeDowngraded: args.routeDowngraded,
            promptTruncated: args.promptTruncated,
            webSearchDisabled: args.webSearchDisabled,
            plan: args.aiSession.plan,
            dailyRequestLimit: args.planLimits.dailyRequests,
            monthlyRequestLimit: args.planLimits.monthlyRequests,
        },
    }));

    return { totalTokensUsed, usageCounters };
}

async function recordAIUsageDenied(args: {
    req: Request;
    aiSession: AISession;
    planLimits: AIPlanLimits;
    routeType: string;
    originalType: string;
    route: AIRoute;
    reason: string;
    usage?: Record<string, any> | null;
}) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return;

    const claims = decodeAuthPayload(args.req.headers.get('Authorization'));
    const userId = args.aiSession.userId || (isUuid(claims?.sub) ? claims?.sub : null);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await safeSupabaseWrite(supabase.from('analytics_events').insert({
        event_id: crypto.randomUUID(),
        username: args.aiSession.username,
        user_id: userId,
        league_id: null,
        session_id: `edge_${args.aiSession.identifier}_${Date.now()}`,
        platform: 'warroom',
        module: 'ai',
        widget: args.routeType,
        event_name: 'ai_call_denied',
        entity_type: 'ai_call',
        entity_id: args.routeType,
        metadata: {
            originalType: args.originalType,
            callType: args.routeType,
            aiPolicyVersion: AI_POLICY_VERSION,
            routeTier: args.route.tier,
            provider: args.route.provider,
            model: args.route.model,
            reason: args.reason,
            plan: args.aiSession.plan,
            dailyRequestLimit: args.planLimits.dailyRequests,
            monthlyRequestLimit: args.planLimits.monthlyRequests,
            usage: args.usage || null,
        },
    }));
}

async function recordAIUsageFailed(args: {
    req: Request;
    aiSession: AISession;
    planLimits: AIPlanLimits;
    reservedCostUsd: number;
    routeType: string;
    originalType: string;
    route: AIRoute;
    reason: string;
    latencyMs: number;
    providerFallback: boolean;
    providerFallbackReason: string | null;
    routeDowngraded: boolean;
    promptTruncated: boolean;
    webSearchDisabled: boolean;
}) {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return;

    const claims = decodeAuthPayload(args.req.headers.get('Authorization'));
    const userId = args.aiSession.userId || (isUuid(claims?.sub) ? claims?.sub : null);
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    await safeSupabaseData(supabase.rpc('record_ai_usage_result', {
        p_identifier: args.aiSession.identifier,
        p_user_id: userId,
        p_username: args.aiSession.username,
        p_tier: args.aiSession.plan,
        p_tokens: 0,
        p_estimated_cost_usd: 0,
        p_reserved_cost_usd: args.reservedCostUsd,
    }));

    await safeSupabaseWrite(supabase.from('analytics_events').insert({
        event_id: crypto.randomUUID(),
        username: args.aiSession.username,
        user_id: userId,
        league_id: null,
        session_id: `edge_${args.aiSession.identifier}_${Date.now()}`,
        platform: 'warroom',
        module: 'ai',
        widget: args.routeType,
        event_name: 'ai_call_failed',
        duration_ms: args.latencyMs,
        entity_type: 'ai_call',
        entity_id: args.routeType,
        metadata: {
            originalType: args.originalType,
            callType: args.routeType,
            aiPolicyVersion: AI_POLICY_VERSION,
            routeTier: args.route.tier,
            provider: args.route.provider,
            model: args.route.model,
            reason: args.reason,
            providerFallback: args.providerFallback,
            providerFallbackReason: args.providerFallbackReason,
            routeDowngraded: args.routeDowngraded,
            promptTruncated: args.promptTruncated,
            webSearchDisabled: args.webSearchDisabled,
            plan: args.aiSession.plan,
            dailyRequestLimit: args.planLimits.dailyRequests,
            monthlyRequestLimit: args.planLimits.monthlyRequests,
        },
    }));
}

async function reserveAIUsage(args: {
    aiSession: AISession;
    limits: AIPlanLimits;
    estimatedRequestCostUsd: number;
}): Promise<Record<string, any>> {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error('AI usage controls unavailable.');
    }
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data, error } = await supabase.rpc('reserve_ai_usage', {
        p_identifier: args.aiSession.identifier,
        p_user_id: args.aiSession.userId,
        p_username: args.aiSession.username,
        p_tier: args.aiSession.plan,
        p_daily_request_limit: args.limits.dailyRequests,
        p_monthly_request_limit: args.limits.monthlyRequests,
        p_daily_cost_limit: args.limits.dailyCostUsd,
        p_monthly_cost_limit: args.limits.monthlyCostUsd,
        p_estimated_request_cost_usd: args.estimatedRequestCostUsd,
        p_global_daily_cost_limit: envNumber('AI_GLOBAL_DAILY_COST_LIMIT_USD', 50),
        p_global_monthly_cost_limit: envNumber('AI_GLOBAL_MONTHLY_COST_LIMIT_USD', 1000),
    });
    if (error) {
        console.error('[ai-analyze] reserve_ai_usage failed:', error);
        throw new Error('AI usage controls unavailable.');
    }
    return (data && typeof data === 'object') ? data as Record<string, any> : { allowed: false, reason: 'usage_control_error' };
}

function aiLimitMessage(reason: string): string {
    switch (reason) {
        case 'daily_requests':
            return 'Daily AI limit reached. Try again tomorrow or upgrade your plan.';
        case 'monthly_requests':
            return 'Monthly AI limit reached. Your included AI resets next month.';
        case 'daily_cost':
        case 'monthly_cost':
            return 'AI budget limit reached for this plan. Try a shorter request or use your own AI key.';
        case 'global_daily_cost':
        case 'global_monthly_cost':
            return 'AI is temporarily capped while we protect launch capacity. Try again later.';
        default:
            return 'AI usage limit reached.';
    }
}

// ── League Format Detection ──────────────────────────────────────────────────

interface LeagueFormat {
    isSuperFlex: boolean;
    isTEP: boolean;       // TE Premium (bonus rec for TE)
    isIDP: boolean;
    idpSlots: number;     // actual IDP-designated slots (DL, LB, DB, etc.)
    numQBSlots: number;   // starting QB + SUPER_FLEX slots that accept QB
    numTESlots: number;   // starting TE + FLEX slots
    numRBSlots: number;
    numWRSlots: number;
    rosterSize: number;
    benchSpots: number;
    starterCount: number;
    hasK: boolean;
    hasDST: boolean;
    scoringType: string;  // 'ppr' | 'half_ppr' | 'std' | 'custom'
    tePremiumBonus: number; // extra PPR bonus for TE (e.g. 0.5 means 1.5 PPR for TE)
}

function detectLeagueFormat(ctx: any): LeagueFormat {
    const rp: string[] = ctx.rosterPositions || ctx.roster_positions || [];
    const scoring = ctx.scoringSettings || ctx.scoring_settings || {};

    const sfSlots = rp.filter((s: string) => s === 'SUPER_FLEX').length;
    const qbSlots = rp.filter((s: string) => s === 'QB').length + sfSlots;
    const rbSlots = rp.filter((s: string) => s === 'RB').length;
    const wrSlots = rp.filter((s: string) => s === 'WR').length;
    const teSlots = rp.filter((s: string) => s === 'TE').length;
    const flexSlots = rp.filter((s: string) => s === 'FLEX' || s === 'REC_FLEX' || s === 'WRRB_FLEX').length;
    const idpSlots = rp.filter((s: string) => ['IDP_FLEX', 'DL', 'LB', 'DB', 'DE', 'CB', 'S'].includes(s)).length;
    const benchSpots = rp.filter((s: string) => s === 'BN').length;
    const starterSlots = rp.filter((s: string) => s !== 'BN' && s !== 'IR' && s !== 'TAXI').length;

    // TE Premium detection: check if TE gets extra receiving bonus
    const recBonus = scoring.rec || 0;
    const teBonusRec = scoring.bonus_rec_te || scoring.rec_te || 0;
    const tePremiumBonus = teBonusRec > 0 ? teBonusRec : 0;
    const isTEP = tePremiumBonus > 0;

    // Scoring type detection
    let scoringType = 'std';
    if (recBonus >= 1) scoringType = 'ppr';
    else if (recBonus >= 0.5) scoringType = 'half_ppr';
    else if (recBonus > 0) scoringType = 'custom';

    return {
        isSuperFlex: sfSlots > 0,
        isTEP,
        isIDP: idpSlots > 0,
        idpSlots,
        numQBSlots: qbSlots,
        numTESlots: teSlots,
        numRBSlots: rbSlots,
        numWRSlots: wrSlots,
        rosterSize: rp.length,
        benchSpots,
        starterCount: starterSlots,
        hasK: rp.includes('K'),
        hasDST: rp.includes('DEF'),
        scoringType,
        tePremiumBonus,
    };
}

function buildLeagueFormatBlock(fmt: LeagueFormat): string {
    const lines: string[] = [];

    if (fmt.isSuperFlex) {
        lines.push(`⚡ SUPERFLEX LEAGUE — ${fmt.numQBSlots} QB-eligible slots. QBs are the most valuable position. A team without 2 starting-caliber QBs has a CRITICAL deficit that overrides all other needs.`);
        lines.push(`  → QB scarcity multiplier: 1.8x. Every QB valuation, trade offer, and FAAB bid must reflect this premium.`);
        lines.push(`  → A team with only 1 startable QB should treat acquiring a second QB as their #1 priority above ALL other positions.`);
    }

    if (fmt.isTEP) {
        lines.push(`⚡ TE PREMIUM LEAGUE — TEs receive +${fmt.tePremiumBonus} bonus PPR (total: ${(fmt.tePremiumBonus + (fmt.scoringType === 'ppr' ? 1 : fmt.scoringType === 'half_ppr' ? 0.5 : 0)).toFixed(1)} PPR for TE). Elite TEs (top 5) are premium assets worth significantly more than standard leagues.`);
        lines.push(`  → TE scarcity multiplier: 1.5x. Do NOT treat TEs as interchangeable depth pieces.`);
    }

    if (fmt.isIDP) {
        lines.push(`⚡ IDP LEAGUE — ${fmt.idpSlots} defensive starter slots. LB/DL/DB have real fantasy value. Defensive studs (top-5 at their IDP position) are tradeable assets.`);
    }

    if (fmt.scoringType === 'ppr') {
        lines.push(`📊 FULL PPR scoring — high-volume pass catchers (slot WRs, receiving RBs, pass-catching TEs) carry premium value over pure rushers.`);
    } else if (fmt.scoringType === 'half_ppr') {
        lines.push(`📊 HALF PPR scoring — balanced value between volume receivers and efficient rushers.`);
    }

    // Positional scarcity context based on roster construction
    const rbDemand = fmt.numRBSlots + Math.floor(fmt.starterCount * 0.3); // RBs fill FLEX too
    if (rbDemand >= 3) {
        lines.push(`🔴 RB SCARCITY — ${fmt.numRBSlots} dedicated RB slots plus FLEX competition means startable RBs are at a premium. Do NOT recommend trading away RB depth lightly.`);
    }

    return lines.length > 0
        ? `\n═══ LEAGUE FORMAT CONTEXT (critically important — adjust ALL valuations accordingly) ═══\n${lines.join('\n')}\n═══════════════════════════════════════════════════════════════════════════════════════\n`
        : '';
}

// ── Team Mode Context ────────────────────────────────────────────────────────

function buildTeamModeBlock(ctx: any): string {
    const tier = ctx.teamTier || ctx.tier || '';
    const window = ctx.teamWindow || ctx.tradeWindow || '';
    const healthScore = ctx.healthScore || 0;

    if (!tier && !window) return '';

    const lines: string[] = [];
    lines.push(`\n═══ TEAM COMPETITIVE MODE (critically important — drives ALL recommendations) ═══`);

    const mode = tier.toUpperCase();
    if (mode === 'REBUILDING' || window === 'REBUILDING') {
        lines.push(`🔨 THIS TEAM IS IN REBUILD MODE (Health: ${healthScore}/100)`);
        lines.push(`REBUILD RULES — strictly enforce these:`);
        lines.push(`  1. PRIORITIZE YOUTH: Target players aged 24 and under. Players over 28 are sell candidates, not buy targets.`);
        lines.push(`  2. ACCUMULATE DRAFT PICKS: Every trade recommendation should seek to acquire future draft capital. Early-round picks (1st-2nd) are the #1 currency.`);
        lines.push(`  3. DO NOT RECOMMEND aging veterans — even if they fill a positional need. A rebuilding team does NOT need a 30-year-old WR2 for "depth."`);
        lines.push(`  4. SELL declining assets aggressively: Any player past peak with 2+ years of decline should be moved for picks or young talent.`);
        lines.push(`  5. FAAB RESTRAINT: Only spend FAAB on young upside plays (age ≤25) or injury replacements for trade-value players. Do NOT recommend bidding on replacement-level veterans.`);
        lines.push(`  6. PATIENCE > DEPTH: A rebuild team should NOT be told to "add depth." They should be told to stockpile assets and wait.`);
    } else if (mode === 'ELITE' || mode === 'CONTENDER' || window === 'CONTENDING') {
        lines.push(`🏆 THIS TEAM IS CONTENDING (${mode} tier, Health: ${healthScore}/100)`);
        lines.push(`CONTENDER RULES — strictly enforce these:`);
        lines.push(`  1. WIN-NOW ASSETS: Prioritize proven producers who can contribute THIS season. Age matters less than immediate output.`);
        lines.push(`  2. FILL GAPS: Identify the weakest starting position and fix it. A contender with a QB2 problem should solve it NOW.`);
        lines.push(`  3. TRADE FUTURE PICKS FOR PRESENT TALENT: Contenders should be willing to move 2nd/3rd round picks for upgrades.`);
        lines.push(`  4. DEPTH MATTERS for contenders — but only QUALITY depth (top-24 at position, minimum). Do NOT recommend adding low-end bench players.`);
        lines.push(`  5. FAAB AGGRESSION on difference-makers: If a player would start, bid aggressively. If they'd be WR5 on the bench, skip them.`);
    } else if (mode === 'CROSSROADS' || window === 'TRANSITIONING') {
        lines.push(`⚖️ THIS TEAM IS AT A CROSSROADS (Health: ${healthScore}/100)`);
        lines.push(`CROSSROADS RULES:`);
        lines.push(`  1. EVALUATE the core: Can this team compete in 1-2 years with targeted upgrades, or should they sell and rebuild?`);
        lines.push(`  2. DO NOT half-commit: Either push to contend (trade picks for upgrades) or commit to rebuild (trade vets for picks/youth).`);
        lines.push(`  3. Players aged 27-29 with declining production are the priority sell candidates.`);
        lines.push(`  4. FAAB: Moderate spending. Target young upside + immediate starters only. Skip replacement-level additions.`);
    }

    lines.push(`═══════════════════════════════════════════════════════════════════════════════════════\n`);
    return lines.join('\n');
}

// ── Minimum Quality Thresholds ──────────────────────────────────────────────

function buildQualityThresholdBlock(): string {
    return `
═══ MINIMUM QUALITY THRESHOLDS (apply to ALL FA/FAAB/waiver recommendations) ═══
⛔ DO NOT recommend adding or bidding on players who meet ANY of these criteria:
  • DHQ below 500 (replacement-level talent — not worth a roster spot in competitive leagues)
  • PPG below 5.0 in their most recent season with 6+ games played
  • Players with no NFL stats in the last 2 seasons (unless they are rookies)
  • Veterans (age 27+) with declining trend who would not crack the starting lineup

✅ ONLY recommend FAAB spending when the player would:
  • Start or be the first backup at a position of need, OR
  • Be a high-upside young player (age ≤25) worth a speculative hold, OR
  • Replace an injured starter (emergency depth pickup)

💰 FAAB DISCIPLINE:
  • "Depth for depth's sake" is NEVER a valid reason to spend FAAB
  • A $1 bid on a bad player is still a wasted roster spot
  • If no quality targets exist at a position, say "HOLD YOUR FAAB" — do not invent targets
  • Remaining FAAB is a weapon for mid-season breakouts and injuries — preserve it
═══════════════════════════════════════════════════════════════════════════════════════
`;
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystemPrompt(ctx?: any): string {
    const leagueFmt = ctx ? detectLeagueFormat(ctx) : null;
    const fmtBlock = leagueFmt ? buildLeagueFormatBlock(leagueFmt) : '';
    const modeBlock = ctx ? buildTeamModeBlock(ctx) : '';
    const qualityBlock = buildQualityThresholdBlock();

    return `You are an elite dynasty fantasy football analyst with deep expertise in player values, team-building strategy, and trade negotiation psychology. You analyze leagues with the precision of a sports analytics team combined with the strategic instinct of a seasoned GM.

You have access to live data: Sleeper rosters and standings, FantasyCalc dynasty player values, and behavioral profiles of each owner (their DNA/trading personality derived from actual trade history).
${fmtBlock}${modeBlock}${qualityBlock}
Your analysis must be:
- Specific and data-driven — name owners, cite records, reference actual roster compositions
- Actionable — concrete recommendations an owner can act on today
- Psychologically sharp — factor in owner DNA and negotiation leverage
- Confident and direct — write like a seasoned scout, not a chatbot
- CONTEXTUALLY AWARE — every recommendation must respect the team's competitive mode (rebuild/contend/crossroads) and the league's format (superflex/TEP/IDP/scoring type)

CRITICAL RULES:
1. Never recommend a rebuilding team acquire aging veterans for "depth"
2. Never recommend spending FAAB on replacement-level players (DHQ < 500, PPG < 5.0)
3. In superflex leagues, ALWAYS flag QB needs as the top priority if a team lacks 2 starters
4. In TE premium leagues, value elite TEs 1.5x higher than standard leagues
5. "Add depth" is only valid advice for CONTENDING teams at positions where the depth player would actually start in case of injury to a top-24 player

Format with **bold headers** for each section. Keep total response under 1200 words.`
    + (ctx?._dhqContext ? '\n\n--- WAR ROOM CONTEXT ---\n' + ctx._dhqContext : '');
}

function formatTeamsForPrompt(teams: any[]): string {
    return teams.map(t => {
        const flag = t.isMyTeam ? ' ← MY TEAM' : '';
        return `• ${t.owner} (${t.record}) | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | DNA: ${t.dna || 'Unknown'} | Posture: ${t.posture || 'N/A'}${flag}
  Strengths: ${(t.strengths || []).join(', ') || 'none'}
  Needs: ${(t.needs || []).join(', ') || 'none'} (positions marked * are critical deficits)`;
    }).join('\n');
}

function buildLeaguePrompt(ctx: any): string {
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);

    return `Analyze this dynasty fantasy football league.

**League:** ${ctx.leagueName} | Season: ${ctx.season} | ${ctx.teams.length} teams
**My Team:** ${ctx.myOwner}
${fmtBlock}
**TEAM DATA:**
${formatTeamsForPrompt(ctx.teams)}

Provide:
**LEAGUE LANDSCAPE** — 3-4 sentence overview of competitive balance${fmt.isSuperFlex ? '. Note which teams have QB advantages/deficits in this superflex format.' : ''}
**POWER RANKINGS** — Top 3 teams and specifically why they're winning
**REBUILDERS TO WATCH** — Teams in rebuild mode with the most upside. Emphasize their youth and draft capital, not veteran depth.
**DANGER ZONE** — Teams in trouble and why
**KEY STORYLINES** — 2-3 compelling narratives in this league right now
**CHAMPIONSHIP WINDOW** — Who wins this league over the next 1-3 years and why`;
}

function buildTeamPrompt(ctx: any): string {
    const t = ctx.team;
    const isMyTeam = t.isMyTeam === true;

    const rosterStr = (t.roster || []).map((p: any) =>
        `  ${p.pos} | ${p.name} (${p.team}) | Value: ${p.value}${p.isElite ? ' ★ELITE' : ''}${p.age ? ` | Age ${p.age}` : ''}`
    ).join('\n');

    // Build detailed pick breakdown with per-year flagging
    const pa = t.picksAssessment;
    let pickDetail = t.picksText || 'No pick data available';
    if (pa && pa.pickCountByYear && pa.pickYears) {
        const yearLines = (pa.pickYears as string[]).map((yr: string) => {
            const count = pa.pickCountByYear[yr] ?? 0;
            const firstCount = pa.pickCountByYearRound?.[yr]?.[1] ?? 0;
            if (count === 0) return `  ${yr}: ⚠️ ZERO PICKS — cannot participate in ${yr} rookie draft`;
            const firstNote = firstCount > 0 ? ` (${firstCount} first-round${firstCount > 1 ? 's' : ''} 🔑)` : ' (no 1st rounders)';
            return `  ${yr}: ${count} pick${count > 1 ? 's' : ''}${firstNote}`;
        }).join('\n');
        pickDetail = `${t.picksText}\nYear-by-year breakdown:\n${yearLines}`;
    }

    // Top 10 most valuable players for value-anchoring trade advice
    const topValues = (t.roster || [])
        .slice(0, 10)
        .map((p: any) => `${p.name} (${p.pos}, ${p.value})`)
        .join(', ');

    // League format context
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock({ teamTier: t.tier, teamWindow: t.tradeWindow || t.window, healthScore: t.healthScore });

    // Superflex QB audit
    let sfQBNote = '';
    if (fmt.isSuperFlex) {
        const qbs = (t.roster || []).filter((p: any) => p.pos === 'QB');
        const startableQBs = qbs.filter((p: any) => p.value >= 2000).length;
        if (startableQBs < fmt.numQBSlots) {
            sfQBNote = `\n⚠️ SUPERFLEX QB CRISIS: This team has only ${startableQBs} startable QB(s) for ${fmt.numQBSlots} QB-eligible slots. QB acquisition MUST be the #1 recommendation regardless of other needs.\n`;
        }
    }

    const negotiationSection = isMyTeam
        ? `**MY NEGOTIATION STRATEGY** — I am ${t.owner}. Based on my ${t.dna} DNA and current roster situation, how should I approach trade negotiations? What leverage do I have, what should I lead with, and what traps should I avoid?`
        : `**NEGOTIATION PLAYBOOK** — ${ctx.myOwner ? `I am ${ctx.myOwner} looking to trade with ${t.owner}.` : ''} Based on ${t.owner}'s ${t.dna} DNA profile, how should I approach negotiating with this owner? What buttons to push, what to avoid, how to frame offers?`;

    const tradeMovesSection = isMyTeam
        ? `**TOP RECOMMENDED MOVES** — 2-3 specific, value-balanced trades I (${t.owner}) should pursue to improve my team. For each: name the player I want to acquire, what I should offer from MY OWN roster in return, and why the other owner says yes. Trades MUST align with my team mode: ${t.tier === 'REBUILDING' ? 'target youth and picks, sell aging assets' : t.tier === 'ELITE' || t.tier === 'CONTENDER' ? 'target win-now upgrades, willing to move future picks' : 'either push to contend or commit to rebuild — no half-measures'}.`
        : `**TOP RECOMMENDED MOVES** — I am ${ctx.myOwner || 'the logged-in owner'}. Give me 2-3 specific players I should target from ${t.owner}'s roster. For each: (1) name the ${t.owner} player I want, (2) describe what I should offer FROM MY OWN ASSETS — NOT ${t.owner}'s players, (3) explain why ${t.owner} would accept. CRITICAL: I am making the offer. Do NOT suggest ${t.owner} trade their own players to themselves.`;

    return `Provide a comprehensive scouting report on **${t.owner}**'s team in ${ctx.leagueName}.${isMyTeam ? ' This is MY OWN team — give me honest self-assessment and first-person strategic advice.' : ` I am ${ctx.myOwner || 'the logged-in owner'} scouting this team for trade opportunities.`}
${fmtBlock}${modeBlock}${sfQBNote}

**TEAM OVERVIEW:** ${t.record} | ${t.tier} | Health: ${t.healthScore}/100 | ${t.weeklyPts} pts/wk | Posture: ${t.posture}
**OWNER DNA:** ${t.dna}${t.dnaDescription ? ` — ${t.dnaDescription}` : ''}
**STATED NEEDS:** ${(t.needs || []).join(', ') || 'none identified'}
**STATED STRENGTHS:** ${(t.strengths || []).join(', ') || 'none identified'}
**DRAFT CAPITAL:** ${pickDetail}
**FAAB:** ${t.faabText || (t.waiverBudget > 0 ? `$${t.faabRemaining} of $${t.waiverBudget} remaining` : 'No FAAB system')}

**ROSTER (by position, sorted by value — scale 0-10,000):**
${rosterStr || 'No roster data available'}

**TOP 10 BY VALUE:** ${topValues || 'N/A'}
${ctx.myOwner && !isMyTeam ? `**MY TEAM (the owner requesting this analysis):** ${ctx.myOwner}\n` : ''}

TRADE RECOMMENDATION RULES (strictly enforce):
- Values are on a 0-10,000 scale. Only propose trades where combined values are within ~20% of each other.
- Never suggest offering a low-value player for a clearly higher-value target (e.g. do not offer a 1,500-value DB for a 4,000-value RB).
- Respect positional market rates: elite RBs and QBs command premium return; DBs, LBs, and depth pieces do not.
- A player with a high value (4,000+) is likely a borderline elite — do not frame them as depth or "cheap filler."
- Only recommend trades that a reasonable opposing owner would actually accept.
- When analyzing another owner's team, all trade offers come FROM the requesting owner — never from the team being analyzed.

Provide:
**TEAM IDENTITY** — What type of contender/rebuilder/pretender is this? (2-3 sentences)
**CORE STRENGTHS** — What does this team do well? Name the specific players driving it
**CRITICAL WEAKNESSES** — Where are the real gaps? Be brutally honest
**DRAFT CAPITAL & FAAB** — Zero-pick years are a crisis. Pick-rich years are leverage. Assess accordingly and state what it means for their ability to add talent.
**TRADE OUTLOOK** — Buyer, seller, or holding? What should they target vs. deal away?
${tradeMovesSection}
${negotiationSection}`;
}

function buildPartnersPrompt(ctx: any): string {
    const partnersStr = ctx.partners.map((p: any, i: number) =>
        `${i + 1}. ${p.owner} (${p.record}) | Compat: ${p.compatibility}% | ${p.tier} | DNA: ${p.dna} | Posture: ${p.posture}
   Strengths: ${(p.strengths || []).join(', ')}
   Needs: ${(p.needs || []).join(', ')}${p.grudgeEntries > 0 ? ` | Trade history: ${p.grudgeEntries} logged interactions` : ''}`
    ).join('\n');

    return `I'm **${ctx.myTeam.owner}** looking for the best trading partners in ${ctx.leagueName}.

**MY TEAM:** ${ctx.myTeam.record} | ${ctx.myTeam.tier} | Health: ${ctx.myTeam.healthScore}/100 | Posture: ${ctx.myTeam.posture}
My Strengths: ${(ctx.myTeam.strengths || []).join(', ')}
My Needs: ${(ctx.myTeam.needs || []).join(', ')}

**ALL OWNERS (ranked by trade compatibility):**
${partnersStr}

Identify my top 3 trading partners and one sleeper pick:

**TRADE PARTNER #1: [NAME]**
- Why they're a great target
- What I should offer (my surplus fills their need)
- What I should target (their surplus fills my need)
- Negotiation strategy based on their DNA

**TRADE PARTNER #2: [NAME]**
[same format]

**TRADE PARTNER #3: [NAME]**
[same format]

**SLEEPER PICK** — One overlooked partner most would miss and exactly why`;
}

function buildFATargetsPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Age ${p.age ?? '?'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}${p.dhq ? ` | DHQ ${p.dhq}` : ''}`
    ).join('\n');

    const faStr = (ctx.topFreeAgents || []).slice(0, 50).map((fa: any) =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | ${fa.gp ? `${fa.gp}gp` : ''} | ${fa.avg ? `${fa.avg}avg` : ''} | Age ${fa.age ?? '?'} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}${fa.dhq ? ` | DHQ ${fa.dhq}` : ''}`
    ).join('\n');

    const rosterPositions = (ctx.rosterPositions || []).filter((p: string) => p !== 'BN' && p !== 'IR').join(', ');

    // Detect league format for context
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);

    // Team mode context
    const teamMode = ctx.teamTier || ctx.tier || 'UNKNOWN';
    const teamWindow = ctx.teamWindow || ctx.tradeWindow || '';
    const healthScore = ctx.healthScore || 0;
    const modeBlock = buildTeamModeBlock(ctx);

    // Count QBs on roster for superflex urgency
    let qbCount = 0;
    let qbWarning = '';
    if (fmt.isSuperFlex) {
        qbCount = (ctx.myRoster || []).filter((p: any) => p.pos === 'QB' && p.isStarter).length;
        if (qbCount < fmt.numQBSlots) {
            qbWarning = `\n⚠️ CRITICAL: This team has only ${qbCount} starting QB(s) in a ${fmt.numQBSlots}-QB-slot league. QB acquisition is the #1 PRIORITY. Any available QB with DHQ > 1000 should be the first recommendation.`;
        }
    }

    return `Build a free agency action plan for **${ctx.myOwner}** in **${ctx.leagueName}**.
${fmtBlock}${modeBlock}
**TEAM STATUS:** ${teamMode} tier | Health: ${healthScore}/100 | Window: ${teamWindow || 'Unknown'}
**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}${ctx.faabMinBid > 0 ? `\n**MINIMUM BID:** $${ctx.faabMinBid} (league rule — never suggest below this)` : ''}
**STARTING LINEUP SPOTS:** ${rosterPositions}
${qbWarning}

**MY CURRENT ROSTER:**
${rosterStr || 'No roster data'}

**TOP AVAILABLE FREE AGENTS:**
${faStr || 'No FA data'}

FAAB RECOMMENDATION RULES (strictly enforce):
1. QUALITY FLOOR: Do NOT recommend any player with DHQ < 500 or season PPG < 5.0 (with 6+ games). "Just for depth" is NOT a valid reason.
2. TEAM MODE MATTERS:
   - REBUILDING teams: Only recommend young upside plays (age ≤25) or injury emergency pickups. Do NOT suggest veteran depth adds.
   - CONTENDING teams: Recommend players who would immediately start or be first-in-line backup. Skip low-end bench filler.
   - CROSSROADS teams: Target young starters only. No speculative depth.
3. FAAB PRESERVATION: If fewer than 3 quality targets exist, explicitly say "HOLD YOUR FAAB for mid-season opportunities." Do NOT pad the list with marginal players.
4. If the available player pool is weak, SAY SO. "There are no impactful additions available right now" is a valid and HELPFUL answer.

Provide:
**ROSTER AUDIT** — 2-3 sentences: current strengths and the biggest gaps to address, framed for the team's competitive mode
**TOP FA TARGETS** — Up to 5-7 specific free agents I should pursue (ONLY those meeting quality thresholds), each with:
  - Why they fit my roster (positional need, age profile, upside)
  - Suggested FAAB bid ($X–$Y range) — proportional to impact and remaining budget
  - Priority tier (must-win bid / competitive / speculative)
  - If fewer than 3 quality targets exist, stop and say so. Do NOT recommend bad players to fill the list.
**BUDGET STRATEGY** — How to allocate the $${ctx.faabBudget} remaining. Include explicit "save X% for mid-season" guidance.
**WAIVER WIRE APPROACH** — Aggressive or patient? Tied to team mode: rebuilders should be patient, contenders should be targeted.`;
}

function buildRookiesPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}`
    ).join('\n');

    const rookieStr = (ctx.availableRookies || []).map((r: any) =>
        `  ${r.pos} ${r.name} (${r.team})`
    ).join('\n');

    const rosterPositions = (ctx.rosterPositions || []).filter((p: string) => p !== 'BN' && p !== 'IR').join(', ');

    // Build draft pick summary from fully-resolved pick list (same logic as trade-calculator)
    const myPicks: any[] = ctx.myDraftPicks || [];
    const standardTotal: number = ctx.standardPickTotal || 21;
    const totalPicks = myPicks.length;

    let pickSummary: string;
    if (totalPicks === 0) {
        pickSummary = `⚠️ ZERO DRAFT PICKS — This owner has NO draft picks across any future season. They cannot participate in the rookie draft at all. Acquiring draft capital via trade must be the #1 priority.`;
    } else {
        const byYear: Record<string, number[]> = {};
        for (const p of myPicks) {
            const yr = String(p.year);
            if (!byYear[yr]) byYear[yr] = [];
            byYear[yr].push(p.round);
        }
        const pickLines = Object.entries(byYear)
            .sort(([a], [b]) => Number(a) - Number(b))
            .map(([yr, rounds]) => `  ${yr}: Rounds ${rounds.sort((a: number, b: number) => a - b).join(', ')}`)
            .join('\n');
        const deficit = standardTotal - totalPicks;
        const statusNote = deficit > 0
            ? `${totalPicks} of ${standardTotal} standard picks — ${deficit} picks below a full slate.`
            : totalPicks > standardTotal
            ? `${totalPicks} picks — ${totalPicks - standardTotal} above the ${standardTotal}-pick baseline (strong capital).`
            : `${totalPicks} picks — full standard slate.`;
        pickSummary = `${statusNote}\n${pickLines}`;
    }

    // League format context
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock(ctx);

    return `Provide a rookie draft strategy for **${ctx.myOwner}** in **${ctx.leagueName}**.
${fmtBlock}${modeBlock}
**STARTING LINEUP SPOTS:** ${rosterPositions}

**DRAFT PICK STATUS:**
${pickSummary}

**MY CURRENT ROSTER (with experience):**
${rosterStr || 'No roster data'}

**AVAILABLE ROOKIES (not on any roster):**
${rookieStr || 'No rookies available'}

CRITICAL INSTRUCTION: Base your entire strategy on the draft pick status above. If the owner has zero picks, do NOT recommend specific draft picks — instead focus your advice entirely on how to acquire picks via trade (what assets to offer, which roster positions to sell high on) and which rookies are worth targeting in trades post-draft.

Provide:
**DRAFT PICK SITUATION** — Clearly state how many picks this owner has and what it means for their draft strategy.
**ROSTER NEEDS ANALYSIS** — Which positions are thin, aging, or lack upside?
**STRATEGY** — If they have picks: BPA vs. positional need advice. If they have NO picks: specific trade strategies to acquire picks or post-draft rookie values to target.
**TARGET ROOKIES** — Top rookies that fit this team's needs (for drafting if picks exist, or for trade acquisition if not).
**SLEEPER PICKS** — 1-2 overlooked rookies worth targeting (via draft or trade).`;
}

function buildMockDraftPrompt(ctx: any): string {
    const isIDP = ctx.isIDP === true;

    const slotsStr = (ctx.draftSlots || []).map((o: any) => {
        let line = `Slot ${o.slot}: ${o.name} | Trade DNA: ${o.dna}`;
        if (o.draftDna)       line += ` | Draft Label: ${o.draftDna}`;
        if (o.roundProfile)   line += `\n         Round splits: ${o.roundProfile}`;
        else if (o.draftTendency) line += ` (${o.draftTendency})`;
        // Flag if they have unusually high early-round defensive picks
        if (o.earlyDefPct !== null && o.earlyDefPct > 10) {
            line += `\n         ⚠ Takes defenders in R1-R2 ${o.earlyDefPct}% of the time (NFL avg: 9%)`;
        }
        if (o.needs?.length)  line += `\n         Needs: ${o.needs.join(', ')}`;
        return line;
    }).join('\n');

    const playersStr = (ctx.players || []).map((p: any) =>
        `${p.fantasyRank}. ${p.name} | ${p.pos} | Tier ${p.tier}`
    ).join('\n');

    const draftTypeLabel = ctx.draftType === 'snake'
        ? 'SNAKE (odd rounds pick left→right, even rounds pick right→left)'
        : 'LINEAR (same slot order every round)';

    const idpNote = isIDP
        ? `• This IS an IDP (Individual Defensive Player) league — LB, DL, DB are valid picks at any round IF the owner has a confirmed Need for that position.`
        : `• This is a STANDARD fantasy league (NOT IDP). Defensive positions (LB, DL, DB, S, CB, EDGE) score ZERO fantasy points and are almost never drafted early.`;

    return `Simulate a complete ${ctx.numRounds}-round rookie draft with ${ctx.numTeams} teams in ${ctx.leagueName || 'the league'}.

DRAFT TYPE: ${draftTypeLabel}

OWNER PROFILES (slot → name → Trade DNA → Draft DNA from 3 seasons of real picks → round splits → needs):
${slotsStr}

DRAFT DNA LABELS (derived from real owner pick history):
• QB-Hunter   → Has taken QB in round 1 historically
• QB-Hungry   → >15% of picks are QB
• RB-Heavy    → >38% of picks are RB
• WR-First    → >38% of picks are WR
• TE-Premium  → >15% of picks are TE
• DEF-Early   → Unusually takes defenders in R1-R2 (rare — >20% of their early picks)
• QB-Avoider  → Never or rarely drafts QB before round 4
• Balanced    → No strong positional bias
The "Round splits" line shows what each owner ACTUALLY drafts by round group across 3 seasons.
When Draft DNA conflicts with current Needs, current Needs take priority for critical gaps (0 starters at a position).

AVAILABLE PLAYERS (fantasy-ranked — #1 = highest fantasy value, defenders already deprioritized):
Players are ordered by fantasy scoring potential, not NFL draft consensus.
QB/RB/WR float to the top; EDGE/OLB rank above CB/S; CB/S/DL sink to the bottom of the pool.
Within the defender tier: EDGE = OLB > LB > CB > S > DL. Never pick a CB before a same-tier EDGE or OLB.
Pick from this list in order — #1 is the top remaining fantasy asset:
${playersStr}

═══════════════════════════════════════════════════════
REAL NFL DRAFT BASELINE — ground your simulation here
═══════════════════════════════════════════════════════
Across 2023, 2024, and 2025 NFL drafts (96 picks in rounds 1-2):
  • Only 9 of 96 picks (9%) were defenders — all were Edge rushers or OLBs
  • ZERO CBs, safeties, LBs, or DTs were taken in rounds 1-2
  • Across all rounds: ~32% of picks are defenders — but concentrated heavily in rounds 4-7

Dynasty fantasy owners mirror this behavior. In a realistic dynasty rookie draft:
  Round 1: 90%+ skill positions (QB/RB/WR/TE). A defender in round 1 is extremely rare.
  Round 2: 90%+ skill positions. The occasional EDGE rusher only in IDP leagues.
  Round 3-5: Mostly skill positions, a few EDGE/OLB may appear.
  Round 6+: Defenders become more common — up to 30-40% of late picks.
${idpNote}

═══════════════════════════════════════════════════════
FANTASY FOOTBALL POSITIONAL SCORING RULES
═══════════════════════════════════════════════════════
Fantasy points come from OFFENSE only in standard leagues.

SCORING POSITIONS (target these):
  QB  — Scarce. A team without a QB starter MUST address early.
  RB  — Premium volume scorer. Top RBs are always R1-R2 value.
  WR  — Receiver depth needed. Strong R1-R4 value.
  TE  — Elite TEs are assets; depth TEs are round 5+ picks.

NON-SCORING IN STANDARD LEAGUES (almost never draft before round 6):
  EDGE, LB, CB, S, DL — contribute zero to fantasy scores. Only valid early in IDP leagues.

ROUND-BY-ROUND POSITIONAL RULES (strictly enforce):
  Round 1: QB / RB / WR only. No defenders. No exceptions in standard leagues.
  Round 2: QB / RB / WR / TE. No defenders. EDGE only if owner is flagged DEF-Early AND it's IDP.
  Round 3-4: Skill positions. EDGE/OLB may appear if owner's round splits show it. If a defender IS taken, it must be EDGE or OLB — never CB, S, or DL before round 5.
  Round 5+: Any position is fair game, guided by owner's actual round-split profile.

CRITICAL: If an owner's "Round splits" show their R1-2 picks are 100% skill positions historically,
simulate them drafting 100% skill positions in rounds 1-2. Don't add defenders just to vary picks.

DNA DRAFT BEHAVIOR (apply AFTER positional rules above):
• Win Now       → Immediate contributors at QB/RB/WR who can start this season.
• Rebuilder     → Ceiling over floor. Raw upside at any OFFENSIVE position.
• Value Drafter → Strict BPA among offensive players. Trusts consensus rankings.
• Need Drafter  → Fills offensive roster gaps first. Reaches 3-5 spots for a critical need.
• Contrarian    → Takes offensive players ranked 8-15 spots below expectations.
• Risk Averse   → Safe college producers at skill positions. No boom-or-bust gambles.
• Aggressive    → Reaches 3-8 spots for high-upside offensive plays.
• Unknown       → Balanced BPA among offensive players with mild positional awareness.

CRITICAL SIMULATION RULES:
1. Each player can only be selected ONCE — track every pick and never repeat a player name
2. Process picks in the correct draft order based on DRAFT TYPE above
3. EVERY pick must reflect that specific owner's DNA and round-split profile
4. Round 1: ONLY QB, RB, or WR — no TE, no defenders, in a standard league
5. Round 2: QB, RB, WR, or TE only — still no defenders in standard leagues
6. Use each owner's "Round splits" data as the primary guide for when they take each position type
7. The "reason" field must be 10-15 words referencing DNA behavior, positional need, or roster fit
8. ZERO-QB EMERGENCY RULE (highest priority, overrides everything):
   If an owner has QB in their Needs AND the #1 or #2 ranked available player is a QB, that owner
   MUST take the QB — no exceptions, no DNA override, no "but they're WR-First". An owner with
   zero QBs who skips the top available QB when it's sitting at #1 or #2 is a simulation error.
   QB NEED RULE: If an owner's Needs include QB AND a QB is ranked in the top 5 of the available
   player pool, that owner WILL take the QB with their next pick. DNA is secondary to critical need.

Output ONLY a valid JSON array with no extra text, no markdown, no backticks:
[{"pick":1,"round":1,"slot":1,"owner":"Name","player":"Exact Player Name","pos":"WR","tier":1,"reason":"DNA-driven reason in exactly 10-15 words"},...]`;
}

function buildFAChatPrompt(ctx: any): string {
    const rosterStr = (ctx.myRoster || []).map((p: any) =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : ''}`
    ).join('\n');

    const faStr = (ctx.topFreeAgents || []).slice(0, 30).map((fa: any) =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}`
    ).join('\n');

    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock(ctx);

    return `You are advising **${ctx.myOwner}** on their free agency strategy in **${ctx.leagueName}**.
${fmtBlock}${modeBlock}
**TEAM STATUS:** ${ctx.teamTier || 'Unknown'} tier | Health: ${ctx.healthScore || '?'}/100
**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}${ctx.faabMinBid > 0 ? `\n**MINIMUM BID:** $${ctx.faabMinBid} (league rule — never suggest below this)` : ''}

**MY ROSTER:**
${rosterStr || 'No roster data'}

**TOP AVAILABLE FREE AGENTS:**
${faStr || 'No FA data'}

Remember: Never recommend spending FAAB on replacement-level players. Quality over quantity.

**Question:** ${ctx.question}`;
}

// ── Live NFL news (ESPN RSS, best-effort) ─────────────────────────────────────

async function fetchLiveNFLNews(): Promise<string> {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const r = await fetch('https://www.espn.com/espn/rss/nfl/news', {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            signal: controller.signal,
        });
        clearTimeout(timer);
        if (!r.ok) return '';
        const xml = await r.text();
        const items: string[] = [];
        // Match CDATA and plain <title> tags inside <item> blocks
        const re = /<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(xml)) !== null && items.length < 12) {
            const t = m[1].replace(/<[^>]+>/g, '').trim();
            if (t && t.length > 10) items.push(`• ${t}`);
        }
        return items.join('\n');
    } catch {
        return '';
    }
}

// ── General chat prompt ───────────────────────────────────────────────────────

function buildChatPrompt(ctx: any, liveNews: string): string {
    const teamsStr = (ctx.teams || []).map((t: any) => {
        const players = (t.players || []).slice(0, 12).join(', ');
        return `  ${t.owner} (${t.record || '?'}) | ${t.tier || '?'} | Health:${t.healthScore ?? '?'} | Needs:${(t.needs||[]).join(',')||'—'} | Strengths:${(t.strengths||[]).join(',')||'—'}${players ? `\n    Roster: ${players}` : ''}`;
    }).join('\n');

    const newsSection = liveNews
        ? `\n**LIVE NFL NEWS (fetched now from ESPN):**\n${liveNews}\n`
        : '';

    return `You are answering a dynasty fantasy football question for **${ctx.myOwner || 'an owner'}** in **${ctx.leagueName}** (${ctx.season} season).

**ALL TEAMS IN THE LEAGUE:**
${teamsStr || 'No team data available'}
${newsSection}
**QUESTION:** ${ctx.question}

Answer thoroughly and specifically. Reference real players, owners, and league data where relevant.
- If asking about a specific player: comment on their dynasty value, role, age, and injury status if known from the news above.
- If asking about trades: factor in both teams' needs, tier, and roster composition from the data above.
- If asking about targeting a player: identify which team owns them and suggest a realistic offer.
- If asking about NFL news/injuries: use the live news headlines above.
- If asking general strategy: tailor advice to the owner's league context.
Keep the response focused and actionable. Use **bold headers** to organize if the answer is multi-part.`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
    const options = handleOptions(req);
    if (options) return options;

    const responseHeaders = corsHeaders(req);

    try {
        const aiSession = await resolveAISession(req);
        if (!aiSession) {
            return new Response(
                JSON.stringify({ error: 'Valid session token required.' }),
                { status: 401, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        if (!isAIEnabled()) {
            return new Response(
                JSON.stringify({ error: 'AI is temporarily disabled by launch controls.' }),
                { status: 503, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        const planLimits = AI_LIMITS[aiSession.plan] || AI_LIMITS.free;

        const body = await req.json();
        const { type, context } = body;

        if (!type || !context) {
            return new Response(
                JSON.stringify({ error: 'Missing required fields: type, context' }),
                { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }

        // ── Rate limit check ──────────────────────────────────────────────
        const rateCheck  = await checkRateLimit(aiSession.identifier);
        if (!rateCheck.allowed) {
            const retryAfterSec = Math.ceil((rateCheck.retryAfterMs ?? RATE_LIMIT_WINDOW) / 1000);
            return new Response(
                JSON.stringify({ error: `Rate limit exceeded. Try again in ${retryAfterSec}s.` }),
                {
                    status: 429,
                    headers: {
                        ...responseHeaders,
                        'Content-Type': 'application/json',
                        'Retry-After': String(retryAfterSec),
                    },
                }
            );
        }

        const genericContext = normalizeGenericAIContext(type, context);
        let routeType = type;
        let maxTokensOverride: number | null = null;
        let useWebSearch = false;

        // Fetch live NFL news for War Room chat mode (best-effort, non-blocking on failure)
        const liveNews = type === 'chat' && !genericContext ? await fetchLiveNFLNews() : '';

        let userPrompt: string;
        switch (type) {
            case 'league':     userPrompt = buildLeaguePrompt(context);           break;
            case 'team':       userPrompt = buildTeamPrompt(context);             break;
            case 'partners':   userPrompt = buildPartnersPrompt(context);         break;
            case 'fa_targets': userPrompt = buildFATargetsPrompt(context);        break;
            case 'rookies':    userPrompt = buildRookiesPrompt(context);          break;
            case 'fa_chat':    userPrompt = buildFAChatPrompt(context);           break;
            case 'mock_draft': userPrompt = buildMockDraftPrompt(context);        break;
            case 'chat':       userPrompt = buildChatPrompt(context, liveNews);   break;
            default:
                if (genericContext) {
                    userPrompt = genericContext.userPrompt;
                    routeType = genericContext.callType;
                    maxTokensOverride = genericContext.maxTokens;
                    useWebSearch = genericContext.useWebSearch;
                } else {
                    return new Response(
                        JSON.stringify({ error: `Unknown analysis type: ${type}` }),
                        { status: 400, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
                    );
                }
        }

        if (genericContext && STRUCTURED_TYPES.has(type) && type !== 'chat') {
            routeType = genericContext.callType;
            maxTokensOverride = genericContext.maxTokens;
            useWebSearch = genericContext.useWebSearch;
        }

        const isMockDraft = type === 'mock_draft' && !genericContext;
        const requestedMaxTokens = maxTokensOverride || (isMockDraft ? 16000 : 8192);
        const routeOutputCap = isMockDraft
            ? planLimits.mockDraftMaxOutputTokens
            : planLimits.maxOutputTokens;
        if (routeOutputCap <= 0) {
            return new Response(
                JSON.stringify({ error: 'This AI feature is not included on your current plan.' }),
                { status: 403, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        const globalOutputCap = envNumber('AI_MAX_OUTPUT_TOKENS', 8000);
        const maxTokens = Math.max(100, Math.min(requestedMaxTokens, routeOutputCap, globalOutputCap));
        const systemPrompt = genericContext?.system || (isMockDraft
            ? 'You are a dynasty fantasy football draft simulator. Output ONLY a raw JSON array. No markdown, no code fences, no backticks, no prose before or after. Start your response with [ and end with ]. Never repeat a player. Track all prior picks carefully so each player is selected at most once.'
            : buildSystemPrompt(context));

        let route = routeForType(routeType);
        if (['deep-analysis', 'league-report', 'rule-simulator', 'trade-audit'].includes(routeType)) {
            route = routeForTier('deep');
        }
        const downgradedRoute = downgradeRouteForEntitlement(route, planLimits);
        route = downgradedRoute.route;
        let webSearchDisabled = false;
        if (useWebSearch && (!planLimits.allowWebSearch || !envFlag('AI_ALLOW_WEB_SEARCH', false))) {
            useWebSearch = false;
            webSearchDisabled = true;
        }
        const promptBudget = Math.max(1000, Math.min(planLimits.maxInputChars, envNumber('AI_MAX_INPUT_CHARS', planLimits.maxInputChars)) - systemPrompt.length);
        const promptClamp = clampTextToChars(userPrompt, promptBudget);
        userPrompt = promptClamp.text;

        const configuredRoute = await resolveConfiguredRoute(route, planLimits, useWebSearch);
        if (!configuredRoute.route) {
            return new Response(
                JSON.stringify({ error: 'AI provider unavailable for this route.' }),
                { status: 503, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        route = configuredRoute.route;
        let providerFallback = configuredRoute.providerFallback;
        let providerFallbackReason = configuredRoute.providerFallbackReason;

        const estimatedInputTokens = estimatePromptTokens(systemPrompt + '\n' + userPrompt);
        const estimatedRequestCostUsd = estimateCostUsd(route.model, estimatedInputTokens, maxTokens, 0);
        const usageReservation = await reserveAIUsage({
            aiSession,
            limits: planLimits,
            estimatedRequestCostUsd,
        });
        if (!usageReservation.allowed) {
            await recordAIUsageDenied({
                req,
                aiSession,
                planLimits,
                routeType,
                originalType: type,
                route,
                reason: String(usageReservation.reason || 'usage_control_error'),
                usage: usageReservation,
            });
            return new Response(
                JSON.stringify({
                    error: aiLimitMessage(String(usageReservation.reason || '')),
                    usage: usageReservation,
                }),
                { status: 429, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
            );
        }
        let analysis = '';
        let stopReason = '';
        let inputTokens = 0;
        let outputTokens = 0;
        let cachedInputTokens = 0;
        const startedAt = Date.now();
        const reservedCostUsd = Number(usageReservation.reservedCostUsd || estimatedRequestCostUsd || 0);
        let failureRecorded = false;
        const recordProviderFailure = async (providerError: any) => {
            if (failureRecorded) return;
            failureRecorded = true;
            await recordAIUsageFailed({
                req,
                aiSession,
                planLimits,
                reservedCostUsd,
                routeType,
                originalType: type,
                route,
                reason: String(providerError?.message || providerError || 'provider_error').slice(0, 300),
                latencyMs: Date.now() - startedAt,
                providerFallback,
                providerFallbackReason,
                routeDowngraded: downgradedRoute.downgraded,
                promptTruncated: promptClamp.truncated,
                webSearchDisabled,
            });
        };

        try {
            const providerResult = await callAIProvider({ route, systemPrompt, userPrompt, maxTokens, useWebSearch });
            analysis = providerResult.analysis;
            stopReason = providerResult.stopReason;
            inputTokens = providerResult.inputTokens;
            outputTokens = providerResult.outputTokens;
            cachedInputTokens = providerResult.cachedInputTokens;
        } catch (providerError) {
            if (useWebSearch || !isProviderAvailabilityError(providerError)) {
                await recordProviderFailure(providerError);
                throw providerError;
            }
            const failedProvider = route.provider;
            const fallback = await resolveConfiguredRoute(route, planLimits, false, failedProvider);
            if (!fallback.route || fallback.route.provider === route.provider) {
                await recordProviderFailure(providerError);
                throw providerError;
            }

            route = fallback.route;
            providerFallback = true;
            providerFallbackReason = fallback.providerFallbackReason || `${failedProvider}_provider_error`;

            try {
                const providerResult = await callAIProvider({ route, systemPrompt, userPrompt, maxTokens, useWebSearch: false });
                analysis = providerResult.analysis;
                stopReason = providerResult.stopReason;
                inputTokens = providerResult.inputTokens;
                outputTokens = providerResult.outputTokens;
                cachedInputTokens = providerResult.cachedInputTokens;
            } catch (fallbackError) {
                await recordProviderFailure(fallbackError);
                throw fallbackError;
            }
        }

        const latencyMs = Date.now() - startedAt;
        const measuredTokensUsed = inputTokens + outputTokens;
        const tokensUsed = measuredTokensUsed || (estimatedInputTokens + maxTokens);
        const estimatedCostUsd = measuredTokensUsed
            ? estimateCostUsd(route.model, inputTokens, outputTokens, cachedInputTokens)
            : estimatedRequestCostUsd;
        const accounting = await recordAIAccounting({
            req,
            aiSession,
            planLimits,
            reservedCostUsd,
            routeType,
            originalType: type,
            context,
            genericContext,
            route,
            inputTokens,
            outputTokens,
            cachedInputTokens,
            tokensUsed,
            estimatedCostUsd,
            latencyMs,
            providerFallback,
            providerFallbackReason,
            routeDowngraded: downgradedRoute.downgraded,
            promptTruncated: promptClamp.truncated,
            webSearchDisabled,
        });

        // For mock_draft, parse the JSON picks array from the AI response
        let picks: any[] | undefined;
        if (isMockDraft) {
            // Detect truncation before attempting to parse
            if (stopReason === 'max_tokens') {
                return new Response(
                    JSON.stringify({ error: 'Draft simulation response was too long and got cut off. Try reducing the number of rounds or owners.' }),
                    { status: 422, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
                );
            }
            // Strip markdown code fences if the AI wrapped the response despite instructions
            let cleanAnalysis = analysis.trim();
            if (cleanAnalysis.startsWith('```')) {
                cleanAnalysis = cleanAnalysis.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
            }
            try {
                picks = JSON.parse(cleanAnalysis);
            } catch {
                const match = cleanAnalysis.match(/\[[\s\S]*\]/);
                if (match) {
                    try { picks = JSON.parse(match[0]); } catch { /* leave undefined */ }
                }
            }
        }

        return new Response(
            JSON.stringify({
                analysis,
                ...(picks ? { picks } : {}),
                provider: route.provider,
                model: route.model,
                usage: {
                    aiPolicyVersion: AI_POLICY_VERSION,
                    routeTier: route.tier,
                    inputTokens,
                    outputTokens,
                    cachedInputTokens,
                    tokensUsed,
                    totalTokensUsed: accounting.totalTokensUsed,
                    estimatedCostUsd,
                    latencyMs,
                    providerFallback,
                    providerFallbackReason,
                    routeDowngraded: downgradedRoute.downgraded,
                    promptTruncated: promptClamp.truncated,
                    webSearchDisabled,
                    plan: aiSession.plan,
                    dailyRequests: accounting.usageCounters?.dailyRequests ?? usageReservation.dailyRequests ?? null,
                    dailyRequestLimit: usageReservation.dailyRequestLimit ?? planLimits.dailyRequests,
                    monthlyRequests: accounting.usageCounters?.monthlyRequests ?? usageReservation.monthlyRequests ?? null,
                    monthlyRequestLimit: usageReservation.monthlyRequestLimit ?? planLimits.monthlyRequests,
                    dailyCostUsd: accounting.usageCounters?.dailyCostUsd ?? usageReservation.dailyCostUsd ?? null,
                    monthlyCostUsd: accounting.usageCounters?.monthlyCostUsd ?? usageReservation.monthlyCostUsd ?? null,
                },
            }),
            { headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
        );
    } catch (error: any) {
        console.error('[ai-analyze] error:', error);
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { ...responseHeaders, 'Content-Type': 'application/json' } }
        );
    }
});

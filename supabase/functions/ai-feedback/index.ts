// ============================================================
// AI Feedback Edge Function  [v1]
// Supabase Edge Function: /functions/v1/ai-feedback
//
// Learning-loop capture: records thumbs up/down, acted-on, and
// dismissed signals on AI recommendations. ai-analyze rolls these
// up via get_ai_preference_summary() and injects a preference
// block into structured prompts.
//
// DEPLOY:
//   supabase functions deploy ai-feedback
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    corsHeaders,
    handleOptions,
    requireActiveAppSession,
    requireSleeperSession,
} from '../_shared/security.ts';

const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_WINDOW = 60 * 1000;

const ALLOWED_SURFACES = new Set(['trade_verdict', 'team_diagnosis', 'insight', 'dashboard_digest', 'fa_targets']);
const ALLOWED_ACTIONS = new Set(['up', 'down', 'acted', 'dismissed']);

async function checkRateLimit(identifier: string): Promise<boolean> {
    try {
        const kv = await Deno.openKv();
        const bucket = Math.floor(Date.now() / RATE_LIMIT_WINDOW);
        const key = ['rate_limit', 'ai_feedback', identifier, bucket];
        const entry = await kv.get<number>(key);
        const count = entry.value ?? 0;
        if (count >= RATE_LIMIT_MAX) return false;
        await kv.set(key, count + 1, { expireIn: RATE_LIMIT_WINDOW });
        return true;
    } catch {
        return true; // fail open — feedback is best-effort
    }
}

interface FeedbackSession {
    identifier: string;
    userId: string | null;
    username: string | null;
}

async function resolveSession(supabase: any, req: Request): Promise<FeedbackSession | null> {
    const appSession = await requireActiveAppSession(supabase, req);
    if (appSession) {
        return { identifier: `app:${appSession.userId}`, userId: appSession.userId, username: null };
    }
    const sleeperSession = await requireSleeperSession(req);
    if (sleeperSession) {
        return { identifier: `sleeper:${sleeperSession.username.toLowerCase()}`, userId: null, username: sleeperSession.username };
    }
    return null;
}

// Subjects feed prompt context later — keep them small and flat.
function sanitizeSubject(subject: any): Record<string, string> | null {
    if (!subject || typeof subject !== 'object' || Array.isArray(subject)) return null;
    const out: Record<string, string> = {};
    let count = 0;
    for (const [k, v] of Object.entries(subject)) {
        if (count >= 8) break;
        if (v === null || v === undefined) continue;
        if (typeof v === 'object') continue;
        out[String(k).slice(0, 40)] = String(v).slice(0, 120);
        count++;
    }
    return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
    const options = handleOptions(req);
    if (options) return options;

    const responseHeaders = { ...corsHeaders(req), 'Content-Type': 'application/json' };

    try {
        if (req.method !== 'POST') {
            return new Response(JSON.stringify({ error: 'POST required' }), { status: 405, headers: responseHeaders });
        }

        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!supabaseUrl || !serviceRoleKey) {
            return new Response(JSON.stringify({ error: 'Feedback unavailable.' }), { status: 503, headers: responseHeaders });
        }
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        const session = await resolveSession(supabase, req);
        if (!session) {
            return new Response(JSON.stringify({ error: 'Valid session token required.' }), { status: 401, headers: responseHeaders });
        }

        if (!(await checkRateLimit(session.identifier))) {
            return new Response(JSON.stringify({ error: 'Rate limit exceeded.' }), { status: 429, headers: responseHeaders });
        }

        const body = await req.json().catch(() => null);
        const surface = String(body?.surface || '');
        const action = String(body?.action || '');
        const recId = String(body?.recId || '').slice(0, 200);
        const leagueId = body?.leagueId ? String(body.leagueId).slice(0, 100) : null;
        const subject = sanitizeSubject(body?.subject);

        if (!ALLOWED_SURFACES.has(surface) || !ALLOWED_ACTIONS.has(action) || !recId) {
            return new Response(JSON.stringify({ error: 'Invalid feedback payload.' }), { status: 400, headers: responseHeaders });
        }

        const { error } = await supabase.from('ai_feedback').upsert({
            identifier: session.identifier,
            user_id: session.userId,
            username: session.username,
            league_id: leagueId,
            surface,
            rec_id: recId,
            action,
            subject,
        }, { onConflict: 'identifier,rec_id,action', ignoreDuplicates: true });

        if (error) {
            console.error('[ai-feedback] insert failed:', error);
            return new Response(JSON.stringify({ error: 'Could not record feedback.' }), { status: 500, headers: responseHeaders });
        }

        // Fire-and-forget telemetry; failures must not affect the response.
        try {
            await supabase.from('analytics_events').insert({
                event_id: crypto.randomUUID(),
                username: session.username,
                user_id: session.userId,
                league_id: leagueId,
                session_id: `edge_${session.identifier}_${Date.now()}`,
                platform: 'warroom',
                module: 'ai',
                widget: surface,
                event_name: 'ai_feedback',
                entity_type: 'ai_feedback',
                entity_id: recId,
                metadata: { surface, action },
            });
        } catch { /* best-effort */ }

        return new Response(JSON.stringify({ recorded: true }), { headers: responseHeaders });
    } catch (error: any) {
        console.error('[ai-feedback] error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Internal server error' }), { status: 500, headers: responseHeaders });
    }
});

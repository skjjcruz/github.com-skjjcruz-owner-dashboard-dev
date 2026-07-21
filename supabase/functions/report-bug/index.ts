// ============================================================
// Report Bug Edge Function  [v1]
// Supabase Edge Function: /functions/v1/report-bug
//
// Two feeds land here and get posted as a color-coded embed to a
// PRIVATE Discord staff channel via DISCORD_BUG_WEBHOOK_URL:
//   • kind:'user'  — a person clicked "Report a bug" (blue embed)
//   • kind:'crash' — an uncaught error / promise rejection (red embed)
//
// Session is OPTIONAL: crashes can fire before/without login, so we
// accept anonymous reports (IP rate-limited) but attach the app or
// Sleeper identity when present. Every report is also stored in
// public.bug_reports so Discord is never the only copy.
//
// Secrets (supabase secrets set ...):
//   DISCORD_BUG_WEBHOOK_URL   — webhook of the private #bug-reports-staff channel
//   SUPABASE_URL              — provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY — provided by the platform
//
// DEPLOY:
//   supabase functions deploy report-bug
// ============================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    corsHeaders,
    handleOptions,
    clientIp,
    userAgent,
    requireActiveAppSession,
    requireSleeperSession,
    checkRateLimit,
} from '../_shared/security.ts';

// Discord embed colors (decimal)
const COLOR_CRASH = 0xf0495c; // --neg
const COLOR_USER = 0x4a9dde;  // --tactical
const COLOR_HIGH = 0xff6a1a;  // --forge (user-flagged "blocker")

const ALLOWED_KINDS = new Set(['user', 'crash']);
const ALLOWED_SEVERITY = new Set(['low', 'normal', 'high', 'blocker']);

function s(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    return String(v).slice(0, max);
}

interface Reporter {
    identifier: string;
    userId: string | null;
    username: string | null;
    label: string; // human-friendly for the embed
}

async function resolveReporter(admin: any, req: Request): Promise<Reporter> {
    try {
        const appSession = await requireActiveAppSession(admin, req);
        if (appSession) {
            return {
                identifier: `app:${appSession.userId}`,
                userId: appSession.userId,
                username: null,
                label: appSession.email || `app user ${appSession.userId.slice(0, 8)}`,
            };
        }
    } catch { /* fall through */ }
    try {
        const sleeper = await requireSleeperSession(req);
        if (sleeper) {
            return {
                identifier: `sleeper:${sleeper.username.toLowerCase()}`,
                userId: null,
                username: sleeper.username,
                label: `@${sleeper.username} (Sleeper)`,
            };
        }
    } catch { /* fall through */ }
    return { identifier: `ip:${clientIp(req)}`, userId: null, username: null, label: 'Anonymous' };
}

function field(name: string, value: string, inline = true) {
    return { name, value: value && value.length ? value.slice(0, 1024) : '—', inline };
}

async function postToDiscord(webhook: string, payload: unknown): Promise<boolean> {
    try {
        const res = await fetch(webhook, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        return res.ok;
    } catch (e) {
        console.error('[report-bug] discord post failed:', e);
        return false;
    }
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
            return new Response(JSON.stringify({ error: 'Reporting unavailable.' }), { status: 503, headers: responseHeaders });
        }
        const supabase = createClient(supabaseUrl, serviceRoleKey);

        const reporter = await resolveReporter(supabase, req);

        // Rate limit by identity (or IP for anon). Crashes dedupe client-side,
        // so this mainly guards against a runaway loop or an abusive origin.
        const rl = await checkRateLimit(supabase, 'report_bug', reporter.identifier, {
            limit: 20,
            windowSeconds: 60,
            lockoutSeconds: 300,
        });
        if (!rl.allowed) {
            return new Response(JSON.stringify({ error: 'Too many reports, slow down.' }), {
                status: 429,
                headers: { ...responseHeaders, 'Retry-After': String(rl.retryAfterSeconds || 60) },
            });
        }

        const body = await req.json().catch(() => null);
        const kind = s(body?.kind, 12) || 'user';
        if (!ALLOWED_KINDS.has(kind)) {
            return new Response(JSON.stringify({ error: 'Invalid kind.' }), { status: 400, headers: responseHeaders });
        }

        const message = s(body?.message, 4000).trim();
        if (!message) {
            return new Response(JSON.stringify({ error: 'A message is required.' }), { status: 400, headers: responseHeaders });
        }

        const ctx = (body?.context && typeof body.context === 'object') ? body.context : {};
        const title = s(body?.title, 200).trim() || (kind === 'crash' ? 'Uncaught error' : 'Bug report');
        const severityRaw = s(body?.severity, 12).toLowerCase();
        const severity = ALLOWED_SEVERITY.has(severityRaw) ? severityRaw : (kind === 'crash' ? 'high' : 'normal');
        const url = s(ctx.url, 500);
        const leagueId = s(ctx.leagueId, 100);
        const tier = s(ctx.tier, 40);
        const platform = s(ctx.platform, 60);
        const appVersion = s(ctx.appVersion, 60);
        const stack = s(body?.stack, 3000);
        const screenshotUrl = s(body?.screenshotUrl, 800);
        const ua = userAgent(req);

        // Persist first (best-effort) so nothing is lost if Discord is down.
        let storedId: string | null = null;
        try {
            const { data } = await supabase.from('bug_reports').insert({
                kind,
                identifier: reporter.identifier,
                user_id: reporter.userId,
                username: reporter.username,
                reporter_label: reporter.label,
                title,
                message,
                severity,
                url,
                league_id: leagueId || null,
                tier: tier || null,
                platform: platform || null,
                app_version: appVersion || null,
                user_agent: ua,
                stack: stack || null,
                screenshot_url: screenshotUrl || null,
                ip_address: clientIp(req),
            }).select('id').maybeSingle();
            storedId = data?.id || null;
        } catch (e) {
            console.warn('[report-bug] store failed (continuing):', e);
        }

        // Post to Discord staff channel.
        const webhook = Deno.env.get('DISCORD_BUG_WEBHOOK_URL');
        let delivered = false;
        if (webhook) {
            const color = kind === 'crash'
                ? COLOR_CRASH
                : (severity === 'blocker' || severity === 'high' ? COLOR_HIGH : COLOR_USER);

            const descParts = [message];
            if (stack) descParts.push('```' + stack.slice(0, 1500) + '```');
            const fields = [
                field('Reporter', reporter.label),
                field('Severity', severity.toUpperCase()),
                field('Tier', tier || 'unknown'),
                field('Page', url || 'unknown', false),
                field('League', leagueId || '—'),
                field('Platform', platform || 'web'),
                field('Version', appVersion || 'unknown'),
            ];
            if (storedId) fields.push(field('Report ID', storedId, false));

            const embed: Record<string, unknown> = {
                title: `${kind === 'crash' ? '💥' : '🐞'} ${title}`.slice(0, 256),
                description: descParts.join('\n').slice(0, 4000),
                color,
                fields,
                footer: { text: `DHQ ${kind === 'crash' ? 'crash' : 'bug report'} · ${platform || 'web'}` },
                timestamp: new Date().toISOString(),
            };
            if (screenshotUrl) embed.image = { url: screenshotUrl };

            delivered = await postToDiscord(webhook, {
                username: 'DHQ Bug Feed',
                embeds: [embed],
            });
        } else {
            console.warn('[report-bug] DISCORD_BUG_WEBHOOK_URL not set — stored only.');
        }

        return new Response(JSON.stringify({ reported: true, delivered, id: storedId }), { headers: responseHeaders });
    } catch (error: any) {
        console.error('[report-bug] error:', error);
        return new Response(JSON.stringify({ error: error?.message || 'Internal server error' }), { status: 500, headers: responseHeaders });
    }
});

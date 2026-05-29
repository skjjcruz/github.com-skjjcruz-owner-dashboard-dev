// ============================================================
// Owner Dashboard — get-session-token Edge Function
//
// Issues a signed JWT embedding the verified Sleeper username
// in app_metadata so RLS policies can enforce per-user access.
//
// Auth strategies:
//   • Password-backed legacy/gifted users only. Username-only Sleeper lookup
//     is not identity proof and must not mint database/RLS tokens.
//
// DEPLOY:
//   supabase functions deploy get-session-token
//
// REQUIRED SECRETS (set once):
//   supabase secrets set JWT_SECRET=<your-jwt-secret>
//   (find it: Supabase Dashboard → Settings → API → JWT Secret)
// ============================================================

import * as jose    from 'npm:jose';
import bcrypt       from 'npm:bcryptjs';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    auditEvent,
    checkRateLimit,
    clearRateLimit,
    clientIp,
    handleOptions,
    json,
} from '../_shared/security.ts';

const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const BCRYPT_ROUNDS     = 12;

// Detect legacy SHA-256 hash (64 lowercase hex chars, not a bcrypt hash)
function isLegacySHA256(hash: string): boolean {
    return /^[0-9a-f]{64}$/.test(hash);
}

async function sha256Hex(input: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
    const options = handleOptions(req);
    if (options) return options;

    try {
        const { username, password } = await req.json();
        const normalizedUsername = String(username || '').trim();

        if (!normalizedUsername) {
            return json(req, { error: 'username is required' }, 400);
        }

        const jwtSecret  = Deno.env.get('SUPABASE_JWT_SECRET') || Deno.env.get('JWT_SECRET');
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');

        if (!jwtSecret) {
            return json(req, { error: 'JWT_SECRET not configured — see SETUP.md' }, 500);
        }
        if (!serviceKey || !supabaseUrl) {
            return json(req, { error: 'Supabase service credentials not available' }, 500);
        }

        // ── Look up user row (service role bypasses RLS pre-auth) ──────────
        const admin = createClient(supabaseUrl, serviceKey);
        const ipLimit = await checkRateLimit(admin, 'get-session-token:ip', clientIp(req), { limit: 40, windowSeconds: 900, lockoutSeconds: 900 });
        const userLimit = await checkRateLimit(admin, 'get-session-token:username', normalizedUsername.toLowerCase(), { limit: 10, windowSeconds: 900, lockoutSeconds: 900 });
        if (!ipLimit.allowed || !userLimit.allowed) {
            await auditEvent(admin, req, 'get_session_token_rate_limited', 'blocked', { username: normalizedUsername }, {});
            return json(req, { error: 'Too many attempts. Try again later.' }, 429);
        }

        const { data: userRow } = await admin
            .from('users')
            .select('password_hash, is_gifted')
            .eq('sleeper_username', normalizedUsername)
            .maybeSingle();

        const hasStoredPassword = userRow?.password_hash;
        let isGifted = userRow?.is_gifted ?? false;

        if (!hasStoredPassword) {
            await auditEvent(admin, req, 'get_session_token', 'blocked', { username: normalizedUsername }, { reason: 'passwordless_sleeper_disabled' });
            return json(req, {
                error: 'Passwordless Sleeper username sessions are disabled. Sign in with your Dynasty HQ account or use a password-backed gifted account.',
                code: 'passwordless_sleeper_disabled',
            }, 401);
        }

        if (!password) {
            await auditEvent(admin, req, 'get_session_token', 'failure', { username: normalizedUsername }, { reason: 'password_required' });
            return json(req, { error: 'Password required for this account', isGifted: true }, 401);
        }

        let passwordMatch = false;

        if (isLegacySHA256(userRow.password_hash)) {
            // Legacy hash — compare with SHA-256, then silently upgrade to bcrypt
            const inputSha = await sha256Hex(password);
            if (inputSha === userRow.password_hash) {
                passwordMatch = true;
                const newHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
                await admin
                    .from('users')
                    .update({ password_hash: newHash })
                    .eq('sleeper_username', normalizedUsername);
            }
        } else {
            passwordMatch = await bcrypt.compare(password, userRow.password_hash);
        }

        if (!passwordMatch) {
            await auditEvent(admin, req, 'get_session_token', 'failure', { username: normalizedUsername }, { reason: 'bad_password' });
            return json(req, { error: 'Incorrect password', isGifted: true }, 401);
        }

        // ── Issue JWT ──────────────────────────────────────────────────────
        // Extract project ref from SUPABASE_URL
        const projectRef = supabaseUrl.replace('https://', '').split('.')[0];
        const now        = Math.floor(Date.now() / 1000);
        const exp        = now + TOKEN_TTL_SECONDS;

        const payload = {
            iss:           'supabase',
            ref:           projectRef,
            role:          'anon',
            iat:           now,
            exp,
            sub:           normalizedUsername,
            app_metadata:  { sleeper_username: normalizedUsername, is_gifted: isGifted },
        };

        const secret = new TextEncoder().encode(jwtSecret);
        const token  = await new jose.SignJWT(payload)
            .setProtectedHeader({ alg: 'HS256' })
            .sign(secret);

        await clearRateLimit(admin, 'get-session-token:username', normalizedUsername.toLowerCase());
        await auditEvent(admin, req, 'get_session_token', 'success', { username: normalizedUsername }, { isGifted });

        return json(req, {
            token,
            expiresAt: new Date(exp * 1000).toISOString(),
            isGifted,
        });

    } catch (err: any) {
        console.error('[get-session-token] error:', err);
        return json(req, { error: err.message || 'Internal server error' }, 500);
    }
});

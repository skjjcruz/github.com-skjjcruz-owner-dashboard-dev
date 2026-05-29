// ============================================================
// Owner Dashboard — set-password Edge Function
//
// Creates a gifted user's bcrypt password hash or lets a password-backed
// legacy user rotate their own password. Gift creation requires an active
// app-account session and never overwrites an existing password.
//
// POST body: { username: string, password: string, displayName?: string }
//
// DEPLOY:
//   supabase functions deploy set-password
// ============================================================

import bcrypt from 'npm:bcryptjs';
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
    auditEvent,
    checkRateLimit,
    clientIp,
    handleOptions,
    json,
    requireActiveAppSession,
    requireSleeperSession,
} from '../_shared/security.ts';

const BCRYPT_ROUNDS = 12;

Deno.serve(async (req) => {
    const options = handleOptions(req);
    if (options) return options;

    try {
        const { username, password, displayName } = await req.json();
        const normalizedUsername = String(username || '').trim();

        if (!normalizedUsername || !password) {
            return json(req, { error: 'username and password are required' }, 400);
        }
        if (password.length < 8) {
            return json(req, { error: 'Password must be at least 8 characters' }, 400);
        }

        const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        if (!serviceKey || !supabaseUrl) {
            return json(req, { error: 'Supabase service credentials not available' }, 500);
        }
        const admin = createClient(supabaseUrl, serviceKey);

        const appSession = await requireActiveAppSession(admin, req);
        const sleeperSession = appSession ? null : await requireSleeperSession(req);
        const callerKey = appSession?.userId ? `app:${appSession.userId}` : sleeperSession?.username ? `sleeper:${sleeperSession.username.toLowerCase()}` : null;
        if (!callerKey) return json(req, { error: 'Invalid token' }, 401);

        const ipLimit = await checkRateLimit(admin, 'set-password:ip', clientIp(req), { limit: 20, windowSeconds: 3600, lockoutSeconds: 1800 });
        const callerLimit = await checkRateLimit(admin, 'set-password:caller', callerKey, { limit: 10, windowSeconds: 3600, lockoutSeconds: 1800 });
        if (!ipLimit.allowed || !callerLimit.allowed) {
            await auditEvent(admin, req, 'set_password_rate_limited', 'blocked', { userId: appSession?.userId || null, username: sleeperSession?.username || null }, {});
            return json(req, { error: 'Too many password setup attempts. Try again later.' }, 429);
        }

        const { data: existingUser } = await admin
            .from('users')
            .select('sleeper_username, password_hash')
            .eq('sleeper_username', normalizedUsername)
            .maybeSingle();

        const isSelfPasswordChange = !!sleeperSession && sleeperSession.username.toLowerCase() === normalizedUsername.toLowerCase();
        if (sleeperSession && !isSelfPasswordChange) {
            await auditEvent(admin, req, 'set_password', 'blocked', { username: sleeperSession.username }, { targetUsername: normalizedUsername, reason: 'target_mismatch' });
            return json(req, { error: 'Legacy password changes can only update your own account.' }, 403);
        }

        if (isSelfPasswordChange && !existingUser?.password_hash) {
            await auditEvent(admin, req, 'set_password', 'blocked', { username: sleeperSession.username }, { targetUsername: normalizedUsername, reason: 'no_existing_password' });
            return json(req, { error: 'Passwordless Sleeper accounts cannot set a password through this endpoint.' }, 403);
        }

        if (appSession && existingUser?.password_hash) {
            await auditEvent(admin, req, 'set_password', 'blocked', { userId: appSession.userId, email: appSession.email }, { targetUsername: normalizedUsername, reason: 'target_already_password_backed' });
            return json(req, { error: 'This Sleeper account already has a password-backed login.' }, 409);
        }

        // ── Verify target Sleeper username exists ──────────────────────────
        try {
            const resp = await fetch(
                `https://api.sleeper.app/v1/user/${encodeURIComponent(normalizedUsername)}`,
                { signal: AbortSignal.timeout(5000) }
            );
            const sleeperUser = resp.ok ? await resp.json() : null;
            if (!sleeperUser?.user_id) {
                await auditEvent(admin, req, 'set_password', 'failure', { userId: appSession?.userId || null, username: sleeperSession?.username || null }, { targetUsername: normalizedUsername, reason: 'target_not_found' });
                return json(req, { error: 'Target Sleeper username not found' }, 404);
            }
        } catch {
            return json(req, { error: 'Could not verify target Sleeper username' }, 503);
        }

        // ── Hash password with bcrypt ──────────────────────────────────────
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // ── Upsert user row using service role (bypasses RLS) ─────────────
        const { error } = await admin.from('users').upsert(
            {
                sleeper_username: normalizedUsername,
                password_hash:    passwordHash,
                display_name:     displayName || null,
                is_gifted:        true,
            },
            { onConflict: 'sleeper_username' }
        );
        if (error) throw error;

        await auditEvent(admin, req, 'set_password', 'success', { userId: appSession?.userId || null, email: appSession?.email || null, username: sleeperSession?.username || null }, { targetUsername: normalizedUsername, mode: appSession ? 'gift_create' : 'self_update' });
        return json(req, { success: true });

    } catch (err: any) {
        console.error('[set-password] error:', err);
        return json(req, { error: err.message || 'Internal server error' }, 500);
    }
});

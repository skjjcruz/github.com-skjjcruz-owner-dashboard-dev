// ============================================================
// Owner Dashboard — set-password Edge Function
//
// Creates or updates a gifted user's bcrypt password hash.
// Caller must supply a valid session token (their own JWT)
// in the Authorization header — only authenticated users
// can gift a dashboard to a league mate.
//
// POST body: { username: string, password: string, displayName?: string }
//
// DEPLOY:
//   supabase functions deploy set-password
// ============================================================

import bcrypt from 'npm:bcryptjs';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BCRYPT_ROUNDS = 12;

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    const json = (body: object, status = 200) =>
        new Response(JSON.stringify(body), {
            status,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });

    try {
        // ── Require a valid Authorization header ───────────────────────────
        const authHeader = req.headers.get('Authorization') || '';
        const callerToken = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (!callerToken) {
            return json({ error: 'Authorization header required' }, 401);
        }

        // Decode JWT (not verifying signature — trust Supabase's gateway for that)
        let callerUsername: string | null = null;
        try {
            const [, payload] = callerToken.split('.');
            const decoded = JSON.parse(atob(payload));
            callerUsername = decoded?.app_metadata?.sleeper_username ?? null;
        } catch {
            return json({ error: 'Invalid token' }, 401);
        }
        if (!callerUsername) {
            return json({ error: 'Token missing sleeper_username claim' }, 401);
        }

        const { username, password, displayName } = await req.json();

        if (!username || !password) {
            return json({ error: 'username and password are required' }, 400);
        }
        if (password.length < 8) {
            return json({ error: 'Password must be at least 8 characters' }, 400);
        }

        const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        if (!serviceKey || !supabaseUrl) {
            return json({ error: 'Supabase service credentials not available' }, 500);
        }

        // ── Verify target Sleeper username exists ──────────────────────────
        try {
            const resp = await fetch(
                `https://api.sleeper.app/v1/user/${encodeURIComponent(username)}`,
                { signal: AbortSignal.timeout(5000) }
            );
            const sleeperUser = resp.ok ? await resp.json() : null;
            if (!sleeperUser?.user_id) {
                return json({ error: 'Target Sleeper username not found' }, 404);
            }
        } catch {
            return json({ error: 'Could not verify target Sleeper username' }, 503);
        }

        // ── Hash password with bcrypt ──────────────────────────────────────
        const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

        // ── Upsert user row using service role (bypasses RLS) ─────────────
        const admin = createClient(supabaseUrl, serviceKey);
        const { error } = await admin.from('users').upsert(
            {
                sleeper_username: username,
                password_hash:    passwordHash,
                display_name:     displayName || null,
                is_gifted:        true,
            },
            { onConflict: 'sleeper_username' }
        );
        if (error) throw error;

        return json({ success: true });

    } catch (err: any) {
        console.error('[set-password] error:', err);
        return json({ error: err.message || 'Internal server error' }, 500);
    }
});

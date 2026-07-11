/**
 * fw-refresh-session — slide an app session forward and re-stamp entitlements
 *
 * POST /functions/v1/fw-refresh-session
 * Header: Authorization: Bearer <current, still-valid app JWT>
 *
 * Why this exists: app JWTs live 7 days and nothing renewed them, so any
 * user who stayed signed in longer than a week silently degraded to the
 * free tier when authenticated calls started failing. The shared client
 * calls this on boot when the stored token is more than a day old (or the
 * stored session is missing its user record) and swaps in the fresh token.
 *
 * The presented token must still be valid — this endpoint extends live
 * sessions, it does not resurrect expired ones. Revocation still works:
 * requireActiveAppSession checks session_version against app_users on
 * every call, so a bumped version refuses the refresh.
 *
 * Returns: { token, user: { id, email, displayName, tier, products[] } }
 * (same shape as fw-signin, so clients can store it verbatim)
 *
 * Required built-in secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clientIp,
  handleOptions,
  json,
  requireActiveAppSession,
} from '../_shared/security.ts';
import { mintAppSessionJWT, resolveEntitlements } from '../_shared/entitlements.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  try {
    const ipLimit = await checkRateLimit(admin, 'fw-refresh-session:ip', clientIp(req), { limit: 60, windowSeconds: 3600 });
    if (!ipLimit.allowed) {
      await auditEvent(admin, req, 'fw_refresh_session_rate_limited', 'blocked', {}, {});
      return json(req, { error: 'Too many attempts. Try again later.' }, 429);
    }

    const session = await requireActiveAppSession(admin, req);
    if (!session) {
      await auditEvent(admin, req, 'fw_refresh_session', 'blocked', {}, { reason: 'invalid_session' });
      return json(req, { error: 'Invalid or expired session.' }, 401);
    }

    const { data: user } = await admin
      .from('app_users')
      .select('id, email, display_name, session_version')
      .eq('id', session.userId)
      .maybeSingle();
    if (!user) {
      await auditEvent(admin, req, 'fw_refresh_session', 'failure', { userId: session.userId }, { reason: 'user_missing' });
      return json(req, { error: 'Account not found.' }, 401);
    }

    const { tier, products } = await resolveEntitlements(admin, user.id);
    const token = await mintAppSessionJWT({
      userId: user.id,
      email: user.email,
      tier,
      products,
      sessionVersion: Number(user.session_version || 1),
    });

    await auditEvent(admin, req, 'fw_refresh_session', 'success', { userId: user.id, email: user.email }, { tier, products });

    return json(req, {
      token,
      user: {
        id:          user.id,
        email:       user.email,
        displayName: user.display_name,
        tier,
        products,
      },
    });
  } catch (err) {
    console.error('fw-refresh-session error:', err);
    return json(req, { error: 'Internal server error.' }, 500);
  }
});

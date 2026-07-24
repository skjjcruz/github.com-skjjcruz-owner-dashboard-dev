/**
 * admin-grant-pro — reserve, list, and revoke owner-granted Pro gifts
 *
 * GET  /functions/v1/admin-grant-pro                     → { grants: [...] }
 * POST /functions/v1/admin-grant-pro
 *   { action: 'grant', email, kind: 'season'|'lifetime' }
 *   { action: 'revoke', id }
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 * Gifts live on product_slug 'dhq_gift' / store 'promotional' so real
 * Stripe/Apple subscriptions can never overwrite or cancel them. If the
 * email already has an account the gift applies immediately; otherwise the
 * apply_gift_grant_on_signup trigger applies it when the account is created.
 * Season gifts expire (via subscriptions.expires_at) on the March 1st after
 * the grant — the end of the fantasy season in play.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  hasAdminRole,
  json,
  normalizeEmail,
  resolveAppUserId,
} from '../_shared/security.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function seasonExpiry(): string {
  const now = new Date();
  const year = now.getUTCMonth() >= 2 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  return new Date(Date.UTC(year, 2, 1)).toISOString();
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  // ── Auth check ────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await resolveAppUserId(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_grant_pro', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    if (req.method === 'GET') {
      const { data, error } = await admin
        .from('gift_grants')
        .select('id, email, kind, status, expires_at, created_at, redeemed_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) return json(req, { error: error.message }, 500);
      return json(req, { grants: data ?? [] });
    }

    const body = await req.json().catch(() => ({}));

    if (body.action === 'grant') {
      const email = normalizeEmail(body.email);
      const kind = body.kind === 'lifetime' ? 'lifetime' : body.kind === 'season' ? 'season' : null;
      if (!email || !email.includes('@') || !kind) {
        return json(req, { error: 'A valid email and kind (season or lifetime) are required.' }, 400);
      }
      const expiresAt = kind === 'season' ? seasonExpiry() : null;

      const { data: existing } = await admin
        .from('gift_grants')
        .select('id')
        .eq('status', 'pending')
        .ilike('email', email)
        .maybeSingle();
      if (existing) {
        return json(req, { error: 'That email already has a pending gift.' }, 409);
      }

      // Existing account → apply immediately; otherwise leave pending for
      // the signup trigger.
      const { data: user } = await admin
        .from('app_users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (user) {
        const { error: subErr } = await admin.from('subscriptions').upsert({
          user_id: user.id,
          product_slug: 'dhq_gift',
          tier: 'pro',
          status: 'active',
          store: 'promotional',
          current_period_start: new Date().toISOString(),
          current_period_end: expiresAt,
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,product_slug' });
        if (subErr) return json(req, { error: subErr.message }, 500);
      }

      const { error: grantErr } = await admin.from('gift_grants').insert({
        email,
        kind,
        status: user ? 'redeemed' : 'pending',
        expires_at: expiresAt,
        created_by: userId,
        redeemed_at: user ? new Date().toISOString() : null,
        redeemed_user_id: user?.id ?? null,
      });
      if (grantErr) return json(req, { error: grantErr.message }, 500);

      await auditEvent(admin, req, 'admin_grant_pro', 'success', { userId }, {
        action: 'grant', email, kind, applied: !!user,
      });
      return json(req, { granted: user ? 'applied' : 'pending' });
    }

    if (body.action === 'revoke') {
      const id = String(body.id || '');
      if (!id) return json(req, { error: 'Grant id is required.' }, 400);

      const { data: grant } = await admin
        .from('gift_grants')
        .select('id, email, status, redeemed_user_id')
        .eq('id', id)
        .maybeSingle();
      if (!grant) return json(req, { error: 'Gift not found.' }, 404);
      if (grant.status === 'revoked') {
        return json(req, { error: 'Gift is already revoked.' }, 409);
      }

      if (grant.status === 'redeemed' && grant.redeemed_user_id) {
        const { error: subErr } = await admin
          .from('subscriptions')
          .update({ status: 'canceled', updated_at: new Date().toISOString() })
          .eq('user_id', grant.redeemed_user_id)
          .eq('product_slug', 'dhq_gift');
        if (subErr) return json(req, { error: subErr.message }, 500);
      }

      const { error: revokeErr } = await admin
        .from('gift_grants')
        .update({ status: 'revoked' })
        .eq('id', id);
      if (revokeErr) return json(req, { error: revokeErr.message }, 500);

      await auditEvent(admin, req, 'admin_grant_pro', 'success', { userId }, {
        action: 'revoke', email: grant.email, wasRedeemed: grant.status === 'redeemed',
      });
      return json(req, { revoked: true });
    }

    return json(req, { error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error('admin-grant-pro error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

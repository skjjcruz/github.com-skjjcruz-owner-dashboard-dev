/**
 * fw-profile - authenticated app-account profile reads/writes.
 *
 * GET  /functions/v1/fw-profile
 * POST /functions/v1/fw-profile
 *
 * Body for POST: { tutorialState?, platformUsernames? }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  json,
  requireActiveAppSession,
} from '../_shared/security.ts';
import { resolveEntitlements } from '../_shared/entitlements.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const VALID_PRODUCTS = new Set(['scout', 'warroom']);

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await requireActiveAppSession(admin, req);
  if (!session) {
    await auditEvent(admin, req, 'fw_profile', 'blocked', {}, { reason: 'invalid_session' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    if (req.method === 'GET') {
      const { data: user, error } = await admin
        .from('app_users')
        .select('id, email, display_name, tutorial_state, platform_usernames')
        .eq('id', session.userId)
        .maybeSingle();
      if (error) return json(req, { error: error.message }, 500);
      if (!user) return json(req, { error: 'Profile not found' }, 404);
      const { tier, products } = await resolveEntitlements(admin, session.userId);
      await auditEvent(admin, req, 'fw_profile_read', 'success', { userId: session.userId, email: session.email }, {});
      return json(req, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          tier,
          products,
        },
        tutorialState: sanitizeTutorialState(user.tutorial_state || {}),
        platformUsernames: sanitizePlatformUsernames(user.platform_usernames || {}),
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const hasTutorialState = Object.prototype.hasOwnProperty.call(body || {}, 'tutorialState');
      const tutorialState = sanitizeTutorialState(body?.tutorialState || {});
      const platformUsernames = sanitizePlatformUsernames(body?.platformUsernames || {});
      const update: Record<string, unknown> = {};
      if (hasTutorialState) update.tutorial_state = tutorialState;
      if (Object.keys(platformUsernames).length) update.platform_usernames = platformUsernames;
      if (!Object.keys(update).length) return json(req, { ok: true, tutorialState, platformUsernames });
      const { error } = await admin
        .from('app_users')
        .update(update)
        .eq('id', session.userId);
      if (error) return json(req, { error: error.message }, 500);
      await auditEvent(admin, req, 'fw_profile_update', 'success', { userId: session.userId, email: session.email }, {
        fields: Object.keys(update),
        products: Object.keys(tutorialState),
        platformKeys: Object.keys(platformUsernames),
      });
      return json(req, { ok: true, tutorialState, platformUsernames });
    }

    return json(req, { error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('fw-profile error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

function sanitizeTutorialState(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, unknown> = {};
  for (const product of VALID_PRODUCTS) {
    const raw = (value as Record<string, unknown>)[product];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const completedAt = String(record.completedAt || '').slice(0, 80);
    const version = String(record.version || 'gm-brief-v1').slice(0, 40);
    if (!completedAt || !version) continue;
    out[product] = {
      product,
      version,
      completedAt,
      skipped: record.skipped === true,
    };
  }
  return out;
}

function sanitizePlatformUsernames(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const out: Record<string, string> = {};
  const sleeper = String(raw.sleeper || raw.sleeperUsername || '').trim();
  if (sleeper && /^[A-Za-z0-9_.-]{1,40}$/.test(sleeper)) out.sleeper = sleeper;
  return out;
}

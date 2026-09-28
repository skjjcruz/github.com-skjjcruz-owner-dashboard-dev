/**
 * fw-profile - authenticated app-account profile reads/writes.
 *
 * GET  /functions/v1/fw-profile
 * POST /functions/v1/fw-profile
 *
 * Body for POST: { tutorialState?, platformUsernames? }
 *
 * platformUsernames is MERGED into app_users.platform_usernames (it used to
 * replace the whole object and keep only `sleeper`, so connecting one platform
 * wiped the others). Accepted keys — see _shared/platforms.ts:
 *   sleeper        "handle" (as every shipped client sends) or { username, userId }
 *   sleeperUserId  numeric string, only alongside a valid sleeper handle
 *   espn           [{ leagueId, year, teamId }]      ≤ 10, full list ([] clears)
 *   mfl            [{ leagueId, year, franchiseId }] ≤ 10, full list ([] clears)
 * Pointers only: credential fields (espn_s2, SWID, apiKey, cookies) are never
 * stored; they are dropped and the attempt is audited. A bad espn/mfl list is
 * a 400; a bad sleeper handle is ignored, exactly as before.
 * GET and the POST response return the merged object in the public shape.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  json,
  requireActiveAppSession,
} from '../_shared/security.ts';
import {
  mergePlatformUsernames,
  parsePlatformPatch,
  publicPlatformUsernames,
} from '../_shared/platforms.ts';

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
      const products = await loadActiveProducts(admin, session.userId);
      const tier = products.some((p: any) => p.tier === 'pro') ? 'pro' : 'free';
      await auditEvent(admin, req, 'fw_profile_read', 'success', { userId: session.userId, email: session.email }, {});
      return json(req, {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          tier,
          products: expandProducts(products.map((p: any) => String(p.product_slug || ''))),
        },
        tutorialState: sanitizeTutorialState(user.tutorial_state || {}),
        platformUsernames: publicPlatformUsernames(user.platform_usernames || {}),
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const hasTutorialState = Object.prototype.hasOwnProperty.call(body || {}, 'tutorialState');
      const tutorialState = sanitizeTutorialState(body?.tutorialState || {});
      const parsed = parsePlatformPatch(body?.platformUsernames || {});
      if (parsed.secretFields.length) {
        // Never stored (entries are rebuilt from whitelisted fields); logged by
        // field NAME only so a client shipping credentials here gets caught.
        await auditEvent(admin, req, 'fw_profile_secret_fields', 'blocked', { userId: session.userId, email: session.email }, {
          reason: 'secret_fields_stripped',
          secretFields: parsed.secretFields,
        });
      }
      if (!parsed.ok) {
        await auditEvent(admin, req, 'fw_profile_update', 'failure', { userId: session.userId, email: session.email }, {
          reason: 'invalid_platforms',
          error: parsed.error,
        });
        return json(req, { error: parsed.error }, 400);
      }
      const patchKeys = Object.keys(parsed.patch);

      const update: Record<string, unknown> = {};
      if (hasTutorialState) update.tutorial_state = tutorialState;
      let storedPlatforms: unknown = null;
      if (patchKeys.length) {
        // Read-modify-write: merge into what's stored instead of replacing it.
        const { data: current, error: readErr } = await admin
          .from('app_users')
          .select('platform_usernames')
          .eq('id', session.userId)
          .maybeSingle();
        if (readErr) return json(req, { error: readErr.message }, 500);
        const platformUsernames = mergePlatformUsernames(current?.platform_usernames || {}, parsed.patch);
        update.platform_usernames = platformUsernames;
        storedPlatforms = platformUsernames;
      }
      if (!Object.keys(update).length) {
        return json(req, { ok: true, tutorialState, platformUsernames: {} });
      }
      const { error } = await admin
        .from('app_users')
        .update(update)
        .eq('id', session.userId);
      if (error) return json(req, { error: error.message }, 500);
      await auditEvent(admin, req, 'fw_profile_update', 'success', { userId: session.userId, email: session.email }, {
        fields: Object.keys(update),
        products: Object.keys(tutorialState),
        platformKeys: patchKeys,
        ...(parsed.patch.espn ? { espnLeagues: parsed.patch.espn.length } : {}),
        ...(parsed.patch.mfl ? { mflLeagues: parsed.patch.mfl.length } : {}),
      });
      return json(req, {
        ok: true,
        tutorialState,
        // The merged result when platforms changed; {} (the old echo of an
        // empty patch) when only tutorialState was written.
        platformUsernames: storedPlatforms === null ? {} : publicPlatformUsernames(storedPlatforms),
      });
    }

    return json(req, { error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('fw-profile error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

async function loadActiveProducts(admin: any, userId: string): Promise<Array<{ product_slug: string; tier: string }>> {
  const { data } = await admin
    .from('subscriptions')
    .select('product_slug, tier, status, expires_at')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing']);
  // expires_at (promotional/gift subs) bounds entitlement here exactly as in
  // _shared/entitlements.ts — the profile and the JWT must never disagree.
  return (data || []).filter((s: any) => !s.expires_at || Date.parse(s.expires_at) > Date.now());
}

// Mirrors _shared/entitlements.ts expandProductSlugs: 'dhq' (the live Pro
// line), owner-granted 'dhq_gift', and legacy 'bundle' all mean full access
// to both apps. fw-profile previously only knew 'bundle', so dhq-line
// subscribers' profiles carried a raw slug the clients don't recognize and
// tier chrome fell back to the minimum paid level (owner report 2026-07-27).
function expandProducts(products: string[]): string[] {
  return [...new Set(products.flatMap((slug) => (slug === 'bundle' || slug === 'dhq' || slug === 'dhq_gift') ? ['war_room', 'dynast_hq'] : [slug]))];
}

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

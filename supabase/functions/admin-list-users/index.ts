/**
 * admin-list-users — returns paginated user + subscription list
 *
 * GET /functions/v1/admin-list-users?page=0&limit=50&search=foo
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  hasAdminRole,
  json,
  resolveAppUserId,
} from '../_shared/security.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  // ── Auth check ────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await resolveAppUserId(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_list_users', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const url    = new URL(req.url);
    const page   = Math.max(0, parseInt(url.searchParams.get('page')  ?? '0', 10));
    const limit  = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10)));
    const search = url.searchParams.get('search')?.trim() ?? '';

    // ── Fetch users (with subscription join) ─────────────────
    let query = admin
      .from('app_users')
      .select(`
        id,
        email,
        display_name,
        platform_usernames,
        created_at,
        subscriptions ( product_slug, tier, status )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (search) {
      query = query.ilike('email', `%${search}%`);
    }

    const { data: users, error, count } = await query;

    if (error) {
      console.error('admin-list-users query error:', error);
      return json(req, { error: error.message }, 500);
    }

    // ── Shape the response ────────────────────────────────────
    const rows = (users ?? []).map((u: any) => {
      const subs    = u.subscriptions ?? [];
      const active  = subs.filter((s: any) => s.status === 'active');
      const tier    = active.some((s: any) => s.tier === 'pro') ? 'pro' : 'free';
      const products = active.map((s: any) => s.product_slug);
      const pu = u.platform_usernames ?? {};
      return {
        id:          u.id,
        email:       u.email,
        displayName: u.display_name,
        sleeperUsername: (typeof pu.sleeper === 'string' && pu.sleeper) || null,
        tier,
        products,
        createdAt:   u.created_at,
      };
    });

    // ── Guests: Sleeper names seen in product usage with no account ──
    // A guest never signs up, so app_users can't know them — analytics is
    // the only place they exist. A username counts as a guest when no event
    // ever links it to an account id AND it doesn't match any account's
    // linked Sleeper name (owner ask 2026-08-10: capture guests as users).
    const guests: Array<{ username: string; firstSeen: string; lastSeen: string }> = [];
    try {
      const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: events }, { data: allAccounts }] = await Promise.all([
        admin
          .from('analytics_events')
          .select('username, user_id, event_ts')
          .not('username', 'is', null)
          .gte('event_ts', since)
          .order('event_ts', { ascending: false })
          .limit(20000),
        admin
          .from('app_users')
          .select('platform_usernames')
          .limit(1000),
      ]);
      const accountSleepers = new Set(
        (allAccounts ?? [])
          .map((a: any) => String(a.platform_usernames?.sleeper || '').toLowerCase())
          .filter(Boolean),
      );
      const seen = new Map<string, { display: string; firstSeen: string; lastSeen: string; linked: boolean }>();
      for (const e of events ?? []) {
        const key = String(e.username).toLowerCase();
        const g = seen.get(key) ??
          { display: String(e.username), firstSeen: e.event_ts, lastSeen: e.event_ts, linked: false };
        if (e.user_id) g.linked = true;
        if (e.event_ts < g.firstSeen) g.firstSeen = e.event_ts;
        if (e.event_ts > g.lastSeen) { g.lastSeen = e.event_ts; g.display = String(e.username); }
        seen.set(key, g);
      }
      for (const [key, g] of seen) {
        if (g.linked || accountSleepers.has(key)) continue;
        guests.push({ username: g.display, firstSeen: g.firstSeen, lastSeen: g.lastSeen });
      }
      guests.sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1));
    } catch (guestErr) {
      // Guests are additive — a failure here must not break the account list.
      console.error('admin-list-users guest scan error:', guestErr);
    }

    await auditEvent(admin, req, 'admin_list_users', 'success', { userId }, { page, limit, search: !!search });
    return json(req, { users: rows, guests, total: count ?? 0, page, limit });

  } catch (err) {
    console.error('admin-list-users error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

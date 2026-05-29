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
  requireActiveAppSession,
} from '../_shared/security.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  // ── Auth check ────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await requireActiveAppSession(admin, req);
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
      return {
        id:          u.id,
        email:       u.email,
        displayName: u.display_name,
        tier,
        products,
        createdAt:   u.created_at,
      };
    });

    await auditEvent(admin, req, 'admin_list_users', 'success', { userId }, { page, limit, search: !!search });
    return json(req, { users: rows, total: count ?? 0, page, limit });

  } catch (err) {
    console.error('admin-list-users error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

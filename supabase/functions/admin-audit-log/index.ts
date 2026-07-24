/**
 * admin-audit-log — read the security_events audit trail
 *
 * GET /functions/v1/admin-audit-log?page=0&limit=50
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 * Read-only: the audit trail is append-only by design and this endpoint
 * never mutates it (reads are themselves audited).
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
    await auditEvent(admin, req, 'admin_audit_log', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const url   = new URL(req.url);
    const page  = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50));

    const { data, error, count } = await admin
      .from('security_events')
      .select('id, event_type, outcome, actor_email, actor_username, ip_address, metadata, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);
    if (error) return json(req, { error: error.message }, 500);

    return json(req, { events: data ?? [], total: count ?? 0, page, limit });
  } catch (err) {
    console.error('admin-audit-log error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

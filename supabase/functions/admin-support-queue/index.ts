/**
 * admin-support-queue — read and triage bug reports + feature requests
 *
 * GET  /functions/v1/admin-support-queue          → { bugs: [...], features: [...] }
 * POST /functions/v1/admin-support-queue          { kind: 'bug'|'feature', id, status }
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 * bug_reports / feature_requests are deny-all under RLS by design — this
 * service-role reader is the only way they reach a screen.
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

const BUG_STATUSES     = ['open', 'triaged', 'in_progress', 'resolved', 'wont_fix', 'duplicate'];
const FEATURE_STATUSES = ['open', 'planned', 'in_progress', 'shipped', 'declined'];

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  // ── Auth check ────────────────────────────────────────────
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await resolveAppUserId(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_support_queue', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    if (req.method === 'GET') {
      const [bugs, features] = await Promise.all([
        admin
          .from('bug_reports')
          .select('id, kind, reporter_label, title, message, severity, status, platform, app_version, created_at')
          .order('created_at', { ascending: false })
          .limit(100),
        admin
          .from('feature_requests')
          .select('id, title, description, category, status, author_username, vote_count, pinned, created_at')
          .order('vote_count', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (bugs.error) return json(req, { error: bugs.error.message }, 500);
      if (features.error) return json(req, { error: features.error.message }, 500);
      return json(req, { bugs: bugs.data ?? [], features: features.data ?? [] });
    }

    const body = await req.json().catch(() => ({}));
    const kind = body.kind === 'bug' ? 'bug' : body.kind === 'feature' ? 'feature' : null;
    const id = String(body.id || '');
    const status = String(body.status || '');
    const allowed = kind === 'bug' ? BUG_STATUSES : FEATURE_STATUSES;
    if (!kind || !id || !allowed.includes(status)) {
      return json(req, { error: 'kind (bug|feature), id, and a valid status are required.' }, 400);
    }

    const table = kind === 'bug' ? 'bug_reports' : 'feature_requests';
    const { error } = await admin
      .from(table)
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return json(req, { error: error.message }, 500);

    await auditEvent(admin, req, 'admin_support_queue', 'success', { userId }, { kind, id, status });
    return json(req, { updated: true });
  } catch (err) {
    console.error('admin-support-queue error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

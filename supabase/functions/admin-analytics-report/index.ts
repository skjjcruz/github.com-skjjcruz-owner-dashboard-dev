/**
 * admin-analytics-report — aggregated product analytics for launch ops
 *
 * GET /functions/v1/admin-analytics-report?days=7
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 * Raw analytics_events stays browser insert-only; this endpoint returns rollups.
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

function clampDays(value: string | null): number {
  const parsed = Number.parseInt(value || '7', 10);
  if (!Number.isFinite(parsed)) return 7;
  return Math.min(90, Math.max(1, parsed));
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await requireActiveAppSession(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_analytics_report', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get('days'));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await admin.rpc('admin_analytics_report', { p_since: since });
    if (error) {
      console.error('admin-analytics-report query error:', error);
      return json(req, { error: error.message }, 500);
    }

    await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days });
    return json(req, { report: data || {}, days, since });
  } catch (err) {
    console.error('admin-analytics-report error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

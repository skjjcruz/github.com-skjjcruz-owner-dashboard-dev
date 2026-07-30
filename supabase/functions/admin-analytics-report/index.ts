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
  resolveAppUserId,
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
  const session = await resolveAppUserId(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_analytics_report', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get('days'));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    // ── detail=users: who is behind the "known users" tile ──
    // Same window as the rollup; aggregated here (not in SQL) because the
    // volume is small and this avoids another security-definer function.
    if (url.searchParams.get('detail') === 'users') {
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('username, session_id, event_ts, module, widget')
        .gte('event_ts', since)
        .not('username', 'is', null)
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report users query error:', error);
        return json(req, { error: error.message }, 500);
      }
      // Group case-insensitively — "Skjjcruz" and "skjjcruz" are the same
      // person (Sleeper usernames are case-insensitive); display the casing
      // seen most recently. "Most used" falls back to widget so it reflects
      // real activity instead of "unknown" (owner ask 2026-07-30).
      const byUser = new Map<string, { display: string; events: number; sessions: Set<string>; lastSeen: string; modules: Map<string, number> }>();
      for (const r of rows ?? []) {
        const key = String(r.username).toLowerCase();
        const u = byUser.get(key) ??
          { display: r.username, events: 0, sessions: new Set(), lastSeen: r.event_ts, modules: new Map() };
        u.events++;
        if (r.session_id) u.sessions.add(r.session_id);
        if (r.event_ts > u.lastSeen) { u.lastSeen = r.event_ts; u.display = r.username; }
        const m = r.module || r.widget;
        if (m) u.modules.set(m, (u.modules.get(m) ?? 0) + 1);
        byUser.set(key, u);
      }
      const users = [...byUser.values()]
        .map((u) => ({
          username: u.display,
          events: u.events,
          sessions: u.sessions.size,
          lastSeen: u.lastSeen,
          topModule: [...u.modules.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
        }))
        .sort((a, b) => b.events - a.events);
      await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days, detail: 'users' });
      return json(req, { users, days, since });
    }

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

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

    // ── detail=sessions: anonymous visitors behind the sessions tile ──
    // No identity exists for these (never signed in, nothing personal is
    // collected) — this profiles each session instead: when, platform,
    // pages touched, dwell, and the external referrer when one was captured.
    if (url.searchParams.get('detail') === 'sessions') {
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('session_id, username, event_ts, platform, module, event_name, metadata')
        .gte('event_ts', since)
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report sessions query error:', error);
        return json(req, { error: error.message }, 500);
      }
      const named = new Set<string>();
      for (const r of rows ?? []) if (r.username && r.session_id) named.add(r.session_id);
      const bySession = new Map<string, { first: string; last: string; events: number; platform: string | null; pages: Map<string, number>; ref: string | null }>();
      for (const r of rows ?? []) {
        if (!r.session_id || named.has(r.session_id)) continue;
        const s = bySession.get(r.session_id) ??
          { first: r.event_ts, last: r.event_ts, events: 0, platform: null, pages: new Map(), ref: null };
        s.events++;
        if (r.event_ts < s.first) s.first = r.event_ts;
        if (r.event_ts > s.last) s.last = r.event_ts;
        if (!s.platform && r.platform) s.platform = r.platform;
        const page = r.module || (r.metadata && (r.metadata as Record<string, unknown>).route as string) || null;
        if (page) s.pages.set(String(page), (s.pages.get(String(page)) ?? 0) + 1);
        const ref = r.metadata && (r.metadata as Record<string, unknown>).ref;
        if (!s.ref && typeof ref === 'string' && ref) s.ref = ref;
        bySession.set(r.session_id, s);
      }
      const sessions = [...bySession.values()]
        .map((s) => ({
          started: s.first,
          minutes: Math.max(0, Math.round((Date.parse(s.last) - Date.parse(s.first)) / 60000)),
          events: s.events,
          platform: s.platform || '—',
          pages: [...s.pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map((p) => p[0]),
          ref: s.ref,
        }))
        .sort((a, b) => (a.started < b.started ? 1 : -1))
        .slice(0, 150);
      await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days, detail: 'sessions' });
      return json(req, { sessions, anonymousTotal: bySession.size, days, since });
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

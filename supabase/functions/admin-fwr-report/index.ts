/**
 * admin-fwr-report — Fantasy War Room (playfantasywarroom.com) for Mission Control
 *
 * GET /functions/v1/admin-fwr-report?section=users|guests|analytics&days=30
 *
 * Requires an app JWT whose user_id has role admin/owner in app_user_roles.
 * Read-only. Fantasy War Room shares this Supabase project but is a separate
 * app: its accounts are the `users` table and its events are analytics_events
 * rows with platform = 'fantasywarroom'. Nothing here touches Dynasty HQ data,
 * and DHQ reports never count these rows (they only count dhqfootball.com /
 * ios_app). Never selects users.password_hash.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  handleOptions,
  hasAdminRole,
  json,
  resolveAppUserId,
} from '../_shared/security.ts';
import {
  analyticsReport,
  type FwrEvent,
  type FwrUserRow,
  guestsReport,
  isRealVisit,
  usersReport,
} from './report.ts';

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const SECTIONS = new Set(['users', 'guests', 'analytics']);
const PAGE_ROWS = 1000;

// The API returns at most 1,000 rows per request; page through up to the cap.
async function fetchAllRows(build: () => any, cap = 20000): Promise<{ data: any[]; error: any }> {
  const out: any[] = [];
  for (let from = 0; from < cap; from += PAGE_ROWS) {
    const { data, error } = await build().range(from, Math.min(from + PAGE_ROWS, cap) - 1);
    if (error) return { data: out, error };
    out.push(...(data ?? []));
    if (!data || data.length < PAGE_ROWS) break;
  }
  return { data: out, error: null };
}

function clampDays(value: string | null): number {
  const parsed = Number.parseInt(value || '30', 10);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(90, Math.max(1, parsed));
}

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const session = await resolveAppUserId(admin, req);
  const userId = session?.userId || null;
  if (!await hasAdminRole(admin, userId)) {
    await auditEvent(admin, req, 'admin_fwr_report', 'blocked', { userId }, { reason: 'missing_admin_role' });
    return json(req, { error: 'Unauthorized' }, 401);
  }

  try {
    const url = new URL(req.url);
    const section = url.searchParams.get('section') || 'users';
    if (!SECTIONS.has(section)) return json(req, { error: 'Unknown section' }, 400);
    const days = clampDays(url.searchParams.get('days'));
    const nowMs = Date.now();
    const since = new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: eventRows, error: eventsError } = await fetchAllRows(() => admin
      .from('analytics_events')
      .select('session_id, event_ts, event_name, module, metadata')
      .eq('platform', 'fantasywarroom')
      .gte('event_ts', since)
      .order('event_ts', { ascending: false }));
    if (eventsError) {
      console.error('admin-fwr-report events query error:', eventsError);
      return json(req, { error: eventsError.message }, 500);
    }
    const events = (eventRows as FwrEvent[]).filter(isRealVisit);

    if (section === 'analytics') {
      return json(req, { days, ...analyticsReport(events) });
    }

    const { data: userRows, error: usersError } = await fetchAllRows(() => admin
      .from('users')
      .select('sleeper_username, display_name, tier, is_gifted, onboarding_complete, created_at')
      .order('created_at', { ascending: false }));
    if (usersError) {
      console.error('admin-fwr-report users query error:', usersError);
      return json(req, { error: usersError.message }, 500);
    }
    const users = userRows as FwrUserRow[];

    if (section === 'users') {
      return json(req, { days, ...usersReport(users, events, since) });
    }
    return json(req, { days, ...guestsReport(users, events, nowMs) });
  } catch (err) {
    console.error('admin-fwr-report error:', err);
    return json(req, { error: 'Internal server error' }, 500);
  }
});

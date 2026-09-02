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
    // A person is keyed by ACCOUNT id when their events carry one (email or
    // Google members), else by the account an identical username links to
    // elsewhere in the window, else by lowercased username — mirrors the
    // person_key in admin_analytics_report (owner ask 2026-08-03: members
    // signed in without a Sleeper username were invisible here).
    if (url.searchParams.get('detail') === 'users') {
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('username, user_id, session_id, event_ts, module, widget')
        .gte('event_ts', since)
        .or('username.not.is.null,user_id.not.is.null')
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report users query error:', error);
        return json(req, { error: error.message }, 500);
      }
      // username -> account bridge from events that carry both.
      const links = new Map<string, string>();
      for (const r of rows ?? []) {
        if (r.username && r.user_id) {
          const uname = String(r.username).toLowerCase();
          if (!links.has(uname)) links.set(uname, String(r.user_id));
        }
      }
      const personKey = (r: { username: string | null; user_id: string | null }) => {
        if (r.user_id) return String(r.user_id);
        const uname = String(r.username).toLowerCase();
        return links.get(uname) ?? uname;
      };
      // Group per person; display the most recent username casing when one
      // exists ("Skjjcruz" and "skjjcruz" are the same person). "Most used"
      // falls back to widget so it reflects real activity (owner ask 2026-07-30).
      const byUser = new Map<string, { display: string | null; accountId: string | null; events: number; sessions: Set<string>; lastSeen: string; modules: Map<string, number> }>();
      for (const r of rows ?? []) {
        const key = personKey(r);
        const u = byUser.get(key) ??
          { display: r.username, accountId: r.user_id ? String(r.user_id) : null, events: 0, sessions: new Set(), lastSeen: r.event_ts, modules: new Map() };
        u.events++;
        if (r.session_id) u.sessions.add(r.session_id);
        if (r.user_id && !u.accountId) u.accountId = String(r.user_id);
        if (r.event_ts > u.lastSeen) u.lastSeen = r.event_ts;
        if (r.username && (!u.display || r.event_ts >= u.lastSeen)) u.display = r.username;
        const m = r.module || r.widget;
        if (m) u.modules.set(m, (u.modules.get(m) ?? 0) + 1);
        byUser.set(key, u);
      }
      // Friendly names for username-less accounts: the email's mailbox part.
      const needEmail = [...byUser.values()].filter((u) => !u.display && u.accountId).map((u) => u.accountId as string);
      if (needEmail.length) {
        const { data: accounts } = await admin
          .from('app_users')
          .select('id, email')
          .in('id', needEmail.slice(0, 200));
        const emailById = new Map((accounts ?? []).map((a) => [String(a.id), String(a.email || '')]));
        for (const u of byUser.values()) {
          if (!u.display && u.accountId) {
            const email = emailById.get(u.accountId) || '';
            u.display = email ? email.split('@')[0] + ' (account)' : 'account ' + u.accountId.slice(0, 8);
          }
        }
      }
      const users = [...byUser.values()]
        .map((u) => ({
          username: u.display || 'unknown',
          events: u.events,
          sessions: u.sessions.size,
          lastSeen: u.lastSeen,
          topModule: [...u.modules.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—',
        }))
        .sort((a, b) => b.events - a.events);
      await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days, detail: 'users' });
      return json(req, { users, days, since });
    }

    // ── detail=doors: which door (native app vs browser) + guest sign-ins ──
    // surface comes from metadata stamped client-side: 'ios_app' when the UA
    // is a bare WKWebView (the shell), 'web' for real browsers. Events older
    // than the stamp's ship date carry no surface and count as 'unknown'.
    if (url.searchParams.get('detail') === 'doors') {
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('session_id, username, event_ts, event_name, module, metadata')
        .gte('event_ts', since)
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report doors query error:', error);
        return json(req, { error: error.message }, 500);
      }
      const surfaces: Record<string, { events: number; sessions: Set<string> }> = {};
      // New accounts by door: email signups + first-ever OAuth sign-ins
      // (oauth_succeeded stamps isNew as of 2026-08-12; older OAuth events
      // can't be classified and simply don't count here).
      const signups: Record<string, number> = {};
      const guests: Array<{ when: string; event: string; username: string | null; guest: boolean; surface: string }> = [];
      for (const r of rows ?? []) {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const surface = typeof meta.surface === 'string' && meta.surface ? meta.surface : 'unknown';
        const s = surfaces[surface] ?? (surfaces[surface] = { events: 0, sessions: new Set() });
        s.events++;
        if (r.session_id) s.sessions.add(r.session_id);
        if (r.event_name === 'signup_succeeded' || (r.event_name === 'oauth_succeeded' && meta.isNew === true)) {
          signups[surface] = (signups[surface] ?? 0) + 1;
        }
        if (r.module === 'connect' && guests.length < 200) {
          guests.push({
            when: r.event_ts,
            event: String(r.event_name || ''),
            username: (typeof meta.sleeperUsername === 'string' && meta.sleeperUsername) || r.username || null,
            guest: meta.guest === true,
            surface,
          });
        }
      }
      const split = Object.fromEntries(
        Object.entries(surfaces).map(([k, v]) => [k, { events: v.events, sessions: v.sessions.size }]),
      );
      await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days, detail: 'doors' });
      return json(req, { surfaces: split, signups, guests, days, since });
    }

    // ── detail=errors: client errors with their context ──
    // The rollup's clientErrors collapses to source+name ("wrLog: Error").
    // This branch reads the raw events and groups by the context/detail the
    // client started stamping on 2026-08-09 — older events show '—'.
    if (url.searchParams.get('detail') === 'errors') {
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('session_id, username, user_id, event_ts, metadata')
        .eq('event_name', 'client_error')
        .gte('event_ts', since)
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report errors query error:', error);
        return json(req, { error: error.message }, 500);
      }
      const groups = new Map<string, { source: string; errorName: string; context: string | null; detail: string | null; times: number; people: Set<string>; lastSeen: string }>();
      for (const r of rows ?? []) {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const source = typeof meta.source === 'string' && meta.source ? meta.source : 'unknown';
        const errorName = typeof meta.errorName === 'string' && meta.errorName ? meta.errorName : 'Error';
        const context = typeof meta.context === 'string' && meta.context ? meta.context : null;
        const detail = typeof meta.errorDetail === 'string' && meta.errorDetail ? meta.errorDetail : null;
        const key = `${source}|${errorName}|${context ?? ''}`;
        const g = groups.get(key) ??
          { source, errorName, context, detail: null, times: 0, people: new Set<string>(), lastSeen: r.event_ts };
        g.times++;
        g.people.add(String(r.username || r.user_id || r.session_id || 'anon'));
        if (r.event_ts > g.lastSeen) g.lastSeen = r.event_ts;
        if (!g.detail && detail) g.detail = detail;
        groups.set(key, g);
      }
      const errors = [...groups.values()]
        .map((g) => ({
          source: g.source,
          errorName: g.errorName,
          context: g.context,
          detail: g.detail,
          times: g.times,
          people: g.people.size,
          lastSeen: g.lastSeen,
        }))
        .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
        .slice(0, 100);
      await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days, detail: 'errors' });
      return json(req, { errors, days, since });
    }

    // ── detail=signin: the front door's auth health, with reasons ──
    // The funnel alone can't distinguish "walked away" from "hit an error",
    // and an existing user signing in via Google from the signup form reads
    // as an abandoned signup even though they got in fine (owner ask
    // 2026-08-28). Group every auth event by method and failure reason.
    if (url.searchParams.get('detail') === 'signin') {
      const AUTH_EVENTS = [
        'signup_started', 'signup_succeeded', 'signup_failed',
        'signin_started', 'signin_succeeded', 'signin_failed',
        'oauth_started', 'oauth_succeeded', 'oauth_sync_failed',
        // The three previously-silent OAuth trapdoors (owner deep dive
        // 2026-09-02): provider bounced back with an error in the URL, the
        // return carried no session, or the callback itself threw.
        'oauth_returned_error', 'oauth_no_session', 'oauth_callback_error',
      ];
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('session_id, username, user_id, event_ts, event_name, metadata')
        .in('event_name', AUTH_EVENTS)
        .gte('event_ts', since)
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report signin query error:', error);
        return json(req, { error: error.message }, 500);
      }
      const groups = new Map<string, { event: string; method: string; reason: string | null; times: number; people: Set<string>; lastSeen: string }>();
      for (const r of rows ?? []) {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const method = typeof meta.method === 'string' && meta.method ? meta.method
          : (typeof meta.provider === 'string' && meta.provider ? meta.provider : 'email');
        const reason = typeof meta.reason === 'string' && meta.reason ? meta.reason
          : (meta.status != null ? `status ${meta.status}` : null);
        const key = `${r.event_name}|${method}|${reason ?? ''}`;
        const g = groups.get(key) ??
          { event: r.event_name, method, reason, times: 0, people: new Set<string>(), lastSeen: r.event_ts };
        g.times++;
        g.people.add(String(r.username || r.user_id || r.session_id || 'anon'));
        if (r.event_ts > g.lastSeen) g.lastSeen = r.event_ts;
        groups.set(key, g);
      }
      // Password-reset outcomes live in the server audit trail, not client
      // analytics — without them a silently-undelivered reset email is
      // invisible (owner bug report 2026-08-31). Fold them into the same table.
      const { data: resetRows } = await admin
        .from('security_events')
        .select('created_at, event_type, outcome, actor_email, ip_address, metadata')
        .in('event_type', ['password_reset_requested', 'password_reset_confirmed'])
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5000);
      for (const r of resetRows ?? []) {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        let event: string;
        let reason: string | null;
        if (r.event_type === 'password_reset_requested') {
          if (r.outcome === 'success') {
            event = meta.emailSent === true ? 'reset_email_sent' : 'reset_email_failed';
            reason = meta.emailSent === true ? null : String(meta.emailReason || 'not sent');
          } else {
            event = 'reset_email_failed';
            reason = String((meta.reason as string) || r.outcome);
          }
        } else {
          event = r.outcome === 'success' ? 'password_reset_done' : 'password_reset_link_rejected';
          reason = r.outcome === 'success' ? null : String((meta.reason as string) || r.outcome);
        }
        const key = `${event}|email|${reason ?? ''}`;
        const g = groups.get(key) ??
          { event, method: 'email', reason, times: 0, people: new Set<string>(), lastSeen: r.created_at };
        g.times++;
        g.people.add(String(r.actor_email || r.ip_address || 'anon'));
        if (r.created_at > g.lastSeen) g.lastSeen = r.created_at;
        groups.set(key, g);
      }
      const signin = [...groups.values()]
        .map((g) => ({ event: g.event, method: g.method, reason: g.reason, times: g.times, people: g.people.size, lastSeen: g.lastSeen }))
        .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
        .slice(0, 100);
      await auditEvent(admin, req, 'admin_analytics_report', 'success', { userId }, { days, detail: 'signin' });
      return json(req, { signin, days, since });
    }

    // ── detail=sessions: anonymous visitors behind the sessions tile ──
    // No identity exists for these (never signed in, nothing personal is
    // collected) — this profiles each session instead: when, platform,
    // pages touched, dwell, and the external referrer when one was captured.
    if (url.searchParams.get('detail') === 'sessions') {
      const { data: rows, error } = await admin
        .from('analytics_events')
        .select('session_id, username, user_id, event_ts, platform, module, event_name, metadata')
        .gte('event_ts', since)
        .order('event_ts', { ascending: false })
        .limit(20000);
      if (error) {
        console.error('admin-analytics-report sessions query error:', error);
        return json(req, { error: error.message }, 500);
      }
      // A session with EITHER identity is a signed-in member, not a visitor
      // (owner ask 2026-08-03 — Google members were listed as anonymous).
      const named = new Set<string>();
      for (const r of rows ?? []) if ((r.username || r.user_id) && r.session_id) named.add(r.session_id);
      const bySession = new Map<string, { first: string; last: string; events: number; platform: string | null; surface: string | null; pages: Map<string, number>; ref: string | null }>();
      for (const r of rows ?? []) {
        if (!r.session_id || named.has(r.session_id)) continue;
        const s = bySession.get(r.session_id) ??
          { first: r.event_ts, last: r.event_ts, events: 0, platform: null, surface: null, pages: new Map(), ref: null };
        s.events++;
        if (r.event_ts < s.first) s.first = r.event_ts;
        if (r.event_ts > s.last) s.last = r.event_ts;
        if (!s.platform && r.platform) s.platform = r.platform;
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        if (!s.surface && typeof meta.surface === 'string' && meta.surface) s.surface = meta.surface;
        const page = r.module || (meta.route as string) || null;
        if (page) s.pages.set(String(page), (s.pages.get(String(page)) ?? 0) + 1);
        // Landing/connect trackers store the referrer as referrerHost; ref is
        // the older key some events still carry.
        const ref = meta.ref ?? meta.referrerHost;
        if (!s.ref && typeof ref === 'string' && ref) s.ref = ref;
        bySession.set(r.session_id, s);
      }
      const sessions = [...bySession.values()]
        .map((s) => ({
          started: s.first,
          minutes: Math.max(0, Math.round((Date.parse(s.last) - Date.parse(s.first)) / 60000)),
          events: s.events,
          platform: s.platform || '—',
          surface: s.surface || 'unknown',
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

// Pure rollups for admin-fwr-report (no I/O, so they can be unit-tested).
//
// Fantasy War Room (playfantasywarroom.com) is a separate app that shares this
// Supabase project. Its fwr-analytics.js writes analytics_events rows with
// platform = 'fantasywarroom' and metadata { fwr_user, signed_in, standalone,
// host, path, internal? }. Its accounts live in the `users` table (keyed by
// sleeper_username), not app_users.

export type FwrEvent = {
  session_id: string;
  event_ts: string;
  event_name: string;
  module: string | null;
  metadata: Record<string, unknown> | null;
};

export type FwrUserRow = {
  sleeper_username: string | null;
  display_name: string | null;
  tier: string | null;
  is_gifted: boolean | null;
  onboarding_complete: boolean | null;
  created_at: string | null;
};

const DAY_MS = 24 * 60 * 60 * 1000;

function meta(e: FwrEvent): Record<string, unknown> {
  return (e.metadata ?? {}) as Record<string, unknown>;
}

export function handleOf(e: FwrEvent): string | null {
  const h = meta(e).fwr_user;
  return typeof h === 'string' && h.trim() ? h.trim().toLowerCase() : null;
}

// Automated browsers (test runs) stamp metadata.internal; they are never visitors.
export function isRealVisit(e: FwrEvent): boolean {
  return meta(e).internal !== true;
}

function day(ts: string): string {
  return ts.slice(0, 10);
}

function topKey(counts: Map<string, number>): string | null {
  let best: string | null = null;
  let n = -1;
  for (const [k, v] of counts) if (v > n) { best = k; n = v; }
  return best;
}

// Per-handle activity: first/last seen, visits (distinct sessions), page views, top page.
function activityByHandle(events: FwrEvent[]) {
  const by = new Map<string, { firstSeen: string; lastSeen: string; sessions: Set<string>; pageViews: number; pages: Map<string, number> }>();
  for (const e of events) {
    const h = handleOf(e);
    if (!h) continue;
    const a = by.get(h) ?? { firstSeen: e.event_ts, lastSeen: e.event_ts, sessions: new Set<string>(), pageViews: 0, pages: new Map<string, number>() };
    if (e.event_ts < a.firstSeen) a.firstSeen = e.event_ts;
    if (e.event_ts > a.lastSeen) a.lastSeen = e.event_ts;
    a.sessions.add(e.session_id);
    if (e.event_name === 'page_view') {
      a.pageViews++;
      const page = e.module || 'unknown';
      a.pages.set(page, (a.pages.get(page) ?? 0) + 1);
    }
    by.set(h, a);
  }
  return by;
}

export function usersReport(users: FwrUserRow[], events: FwrEvent[], sinceIso: string) {
  const activity = activityByHandle(events);
  const rows = users
    .filter((u) => u.sleeper_username)
    .map((u) => {
      const a = activity.get(String(u.sleeper_username).toLowerCase());
      return {
        sleeper_username: u.sleeper_username,
        display_name: u.display_name,
        tier: u.tier || 'free',
        is_gifted: !!u.is_gifted,
        onboarding_complete: !!u.onboarding_complete,
        created_at: u.created_at,
        lastSeen: a?.lastSeen ?? null,
        visits: a?.sessions.size ?? 0,
      };
    })
    .sort((a, b) => String(b.lastSeen ?? '').localeCompare(String(a.lastSeen ?? '')) ||
      String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
  return {
    summary: {
      total: rows.length,
      newInWindow: rows.filter((u) => (u.created_at ?? '') >= sinceIso).length,
      pro: rows.filter((u) => u.tier === 'pro' || u.is_gifted).length,
      gifted: rows.filter((u) => u.is_gifted).length,
      activeInWindow: rows.filter((u) => u.visits > 0).length,
    },
    users: rows,
  };
}

// A guest is a Sleeper name seen in the app with no Fantasy War Room account.
export function guestsReport(users: FwrUserRow[], events: FwrEvent[], nowMs: number) {
  const accounts = new Set(users.map((u) => String(u.sleeper_username || '').toLowerCase()).filter(Boolean));
  const activity = activityByHandle(events);
  const weekAgo = new Date(nowMs - 7 * DAY_MS).toISOString();
  const guests = [...activity.entries()]
    .filter(([h]) => !accounts.has(h))
    .map(([h, a]) => ({
      sleeper: h,
      firstSeen: a.firstSeen,
      lastSeen: a.lastSeen,
      visits: a.sessions.size,
      pageViews: a.pageViews,
      topPage: topKey(a.pages),
    }))
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
  const anonymous = new Set<string>();
  const named = new Set<string>();
  for (const e of events) (handleOf(e) ? named : anonymous).add(e.session_id);
  let anonymousVisits = 0;
  for (const s of anonymous) if (!named.has(s)) anonymousVisits++;
  return {
    summary: {
      guests: guests.length,
      activeWeek: guests.filter((g) => g.lastSeen >= weekAgo).length,
      returning: guests.filter((g) => g.visits > 1).length,
      anonymousVisits,
    },
    guests,
  };
}

export function analyticsReport(events: FwrEvent[]) {
  const sessions = new Map<string, { signedIn: boolean; standalone: boolean }>();
  const days = new Map<string, { visits: Set<string>; pageViews: number }>();
  const pages = new Map<string, { views: number; visits: Set<string> }>();
  const errors = new Map<string, { errorName: string; message: string; page: string; times: number; lastSeen: string }>();
  let pageViews = 0;
  let errorCount = 0;

  for (const e of events) {
    const m = meta(e);
    const s = sessions.get(e.session_id) ?? { signedIn: false, standalone: false };
    if (m.signed_in === true) s.signedIn = true;
    if (m.standalone === true) s.standalone = true;
    sessions.set(e.session_id, s);

    const d = days.get(day(e.event_ts)) ?? { visits: new Set<string>(), pageViews: 0 };
    d.visits.add(e.session_id);
    days.set(day(e.event_ts), d);

    const page = e.module || 'unknown';
    if (e.event_name === 'page_view') {
      pageViews++;
      d.pageViews++;
      const p = pages.get(page) ?? { views: 0, visits: new Set<string>() };
      p.views++;
      p.visits.add(e.session_id);
      pages.set(page, p);
    } else if (e.event_name === 'client_error') {
      errorCount++;
      const errorName = String(m.errorName || 'Error');
      const message = String(m.message || '').slice(0, 200);
      const key = `${errorName}|${message}|${page}`;
      const g = errors.get(key) ?? { errorName, message, page, times: 0, lastSeen: e.event_ts };
      g.times++;
      if (e.event_ts > g.lastSeen) g.lastSeen = e.event_ts;
      errors.set(key, g);
    }
  }

  const visits = sessions.size;
  const signedInVisits = [...sessions.values()].filter((s) => s.signedIn).length;
  return {
    summary: {
      visits,
      pageViews,
      signedInVisits,
      guestVisits: visits - signedInVisits,
      homeScreenVisits: [...sessions.values()].filter((s) => s.standalone).length,
      errors: errorCount,
    },
    byDay: [...days.entries()]
      .map(([d, v]) => ({ day: d, visits: v.visits.size, pageViews: v.pageViews }))
      .sort((a, b) => b.day.localeCompare(a.day)),
    topPages: [...pages.entries()]
      .map(([page, v]) => ({ page, views: v.views, visits: v.visits.size }))
      .sort((a, b) => b.views - a.views),
    errors: [...errors.values()].sort((a, b) => b.times - a.times || b.lastSeen.localeCompare(a.lastSeen)).slice(0, 50),
  };
}

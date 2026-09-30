// deno test supabase/functions/tests/
import { assertEquals } from 'jsr:@std/assert@1';
import {
  analyticsReport,
  type FwrEvent,
  type FwrUserRow,
  guestsReport,
  isRealVisit,
  usersReport,
} from '../admin-fwr-report/report.ts';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const ev = (session_id: string, event_ts: string, module: string, metadata: Record<string, unknown>, event_name = 'page_view'): FwrEvent =>
  ({ session_id, event_ts, event_name, module, metadata });

const users: FwrUserRow[] = [
  { sleeper_username: 'SkjjCruz', display_name: 'Steve', tier: 'pro', is_gifted: false, onboarding_complete: true, created_at: '2026-03-01T00:00:00Z' },
  { sleeper_username: 'buddy', display_name: null, tier: null, is_gifted: true, onboarding_complete: false, created_at: '2026-09-25T00:00:00Z' },
];

const events: FwrEvent[] = [
  ev('s1', '2026-09-30T10:00:00Z', 'dashboard', { fwr_user: 'skjjcruz', signed_in: true, standalone: true }),
  ev('s1', '2026-09-30T10:05:00Z', 'team-comps', { fwr_user: 'skjjcruz', signed_in: true, standalone: true }),
  ev('s2', '2026-09-29T09:00:00Z', 'team-comps', { fwr_user: 'GuestGuy', signed_in: false }),
  ev('s3', '2026-09-20T09:00:00Z', 'team-comps', { fwr_user: 'guestguy', signed_in: false }),
  ev('s4', '2026-09-30T08:00:00Z', 'landing', { fwr_user: null, signed_in: false }),
  ev('s4', '2026-09-30T08:01:00Z', 'landing', { errorName: 'TypeError', message: 'x is undefined' }, 'client_error'),
];

Deno.test('test-browser rows are not visits', () => {
  assertEquals(isRealVisit(ev('t', '2026-09-30T00:00:00Z', 'x', { internal: true })), false);
  assertEquals(isRealVisit(events[0]), true);
});

Deno.test('users: account list with activity, case-insensitive match', () => {
  const r = usersReport(users, events, '2026-09-01T00:00:00Z');
  assertEquals(r.summary, { total: 2, newInWindow: 1, pro: 2, gifted: 1, activeInWindow: 1 });
  assertEquals(r.users[0].sleeper_username, 'SkjjCruz');
  assertEquals(r.users[0].visits, 1);
  assertEquals(r.users[0].lastSeen, '2026-09-30T10:05:00Z');
  assertEquals(r.users[1].tier, 'free');
  assertEquals('password_hash' in r.users[0], false);
});

Deno.test('guests: Sleeper names without an account, anonymous visits counted', () => {
  const r = guestsReport(users, events, NOW);
  assertEquals(r.summary, { guests: 1, activeWeek: 1, returning: 1, anonymousVisits: 1 });
  assertEquals(r.guests[0], {
    sleeper: 'guestguy', firstSeen: '2026-09-20T09:00:00Z', lastSeen: '2026-09-29T09:00:00Z',
    visits: 2, pageViews: 2, topPage: 'team-comps',
  });
});

Deno.test('analytics: visits, pages, signed-in split, home screen, errors', () => {
  const r = analyticsReport(events);
  assertEquals(r.summary, { visits: 4, pageViews: 5, signedInVisits: 1, guestVisits: 3, homeScreenVisits: 1, errors: 1 });
  assertEquals(r.topPages[0], { page: 'team-comps', views: 3, visits: 3 });
  assertEquals(r.byDay[0], { day: '2026-09-30', visits: 2, pageViews: 3 });
  assertEquals(r.errors[0].times, 1);
  assertEquals(r.errors[0].page, 'landing');
});

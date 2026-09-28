// deno test supabase/functions/tests/
import { assertEquals, assert } from 'jsr:@std/assert@1';
import {
  MAX_LEAGUES_PER_PLATFORM,
  mergePlatformUsernames,
  parsePlatformPatch,
  publicPlatformUsernames,
} from '../_shared/platforms.ts';

const Y = 2026;

Deno.test('legacy client body { sleeper } parses exactly as before', () => {
  const r = parsePlatformPatch({ sleeper: 'bigloco' }, Y);
  assert(r.ok);
  assertEquals(r.patch, { sleeper: { username: 'bigloco', userId: null } });
  // legacy alias
  const alias = parsePlatformPatch({ sleeperUsername: ' tipps527 ' }, Y);
  assert(alias.ok);
  assertEquals(alias.patch.sleeper?.username, 'tipps527');
});

Deno.test('invalid / empty sleeper handles are ignored, never an error (old behavior)', () => {
  for (const body of [{}, { sleeper: '' }, { sleeper: null }, { sleeper: 'has space' }, { sleeper: 'x'.repeat(41) }, null, 'str', []]) {
    const r = parsePlatformPatch(body, Y);
    assert(r.ok, JSON.stringify(body));
    assertEquals(r.patch, {});
  }
});

Deno.test('sleeperUserId: string only, needs a handle', () => {
  const ok = parsePlatformPatch({ sleeper: 'a', sleeperUserId: '123456789012345678' }, Y);
  assert(ok.ok);
  assertEquals(ok.patch.sleeper, { username: 'a', userId: '123456789012345678' });
  const obj = parsePlatformPatch({ sleeper: { username: 'a', userId: '42' } }, Y);
  assert(obj.ok);
  assertEquals(obj.patch.sleeper, { username: 'a', userId: '42' });
  assert(!parsePlatformPatch({ sleeper: 'a', sleeperUserId: 123456789012345678 }, Y).ok);
  assert(!parsePlatformPatch({ sleeper: 'a', sleeperUserId: '12ab' }, Y).ok);
  assert(!parsePlatformPatch({ sleeperUserId: '42' }, Y).ok);
});

Deno.test('espn/mfl entries are validated, normalized and deduped', () => {
  const r = parsePlatformPatch({
    espn: [
      { leagueId: '12345', year: '2026', teamId: 3 },
      { leagueId: 12345, year: 2026, teamId: '3' }, // duplicate league+year
      { leagueId: '999', year: 2025 },              // team optional
    ],
    mfl: [{ leagueId: '54321', year: 2026, franchiseId: '4' }],
  }, Y);
  assert(r.ok);
  assertEquals(r.patch.espn, [
    { leagueId: '12345', year: 2026, teamId: '3' },
    { leagueId: '999', year: 2025, teamId: null },
  ]);
  assertEquals(r.patch.mfl, [{ leagueId: '54321', year: 2026, franchiseId: '0004' }]);
});

Deno.test('espn/mfl strict types and size limits', () => {
  const tooMany = Array.from({ length: MAX_LEAGUES_PER_PLATFORM + 1 }, (_, i) => ({ leagueId: String(i + 1), year: 2026 }));
  assert(!parsePlatformPatch({ espn: tooMany }, Y).ok);
  assert(!parsePlatformPatch({ espn: { leagueId: '1', year: 2026 } }, Y).ok);
  assert(!parsePlatformPatch({ espn: ['1'] }, Y).ok);
  assert(!parsePlatformPatch({ espn: [{ leagueId: '1', year: 1999 }] }, Y).ok);
  assert(!parsePlatformPatch({ espn: [{ leagueId: '1', year: 2028 }] }, Y).ok);
  assert(!parsePlatformPatch({ espn: [{ leagueId: '1.5', year: 2026 }] }, Y).ok);
  assert(!parsePlatformPatch({ espn: [{ leagueId: 1.5, year: 2026 }] }, Y).ok);
  assert(!parsePlatformPatch({ mfl: [{ leagueId: 'abc', year: 2026 }] }, Y).ok);
  assert(!parsePlatformPatch({ mfl: [{ leagueId: '1', year: 2026, franchiseId: '00004' }] }, Y).ok);
  const clear = parsePlatformPatch({ espn: null, mfl: [] }, Y);
  assert(clear.ok);
  assertEquals(clear.patch, { espn: [], mfl: [] });
});

Deno.test('credentials are never kept and are reported by name', () => {
  const r = parsePlatformPatch({
    sleeper: 'a',
    espn: [{ leagueId: '1', year: 2026, teamId: 1, espn_s2: 'AEB...', SWID: '{ABC}' }],
    mfl: [{ leagueId: '2', year: 2026, apiKey: 'k', cookie: 'c' }],
  }, Y);
  assert(r.ok);
  assertEquals(new Set(r.secretFields), new Set(['espn_s2', 'SWID', 'apiKey', 'cookie']));
  const serialized = JSON.stringify(mergePlatformUsernames({}, r.patch));
  for (const needle of ['AEB', 'ABC', 'espn_s2', 'SWID', 'apiKey', 'cookie']) {
    assert(!serialized.includes(needle), needle);
  }
});

Deno.test('merge keeps keys the patch does not name (the wipe bug)', () => {
  const stored = {
    sleeper: 'old',
    sleeperUserId: '1',
    espn: [{ leagueId: '1', year: 2026, teamId: '2' }],
    mfl: [{ leagueId: '3', year: 2026, franchiseId: '0001' }],
    somethingElse: true,
  };
  // An old client re-connects Sleeper: ESPN/MFL survive.
  const p1 = parsePlatformPatch({ sleeper: 'new' }, Y);
  assert(p1.ok);
  const m1 = mergePlatformUsernames(stored, p1.patch);
  assertEquals(m1.sleeper, 'new');
  assertEquals(m1.sleeperUserId, undefined); // different handle → stale id dropped
  assertEquals(m1.espn, stored.espn);
  assertEquals(m1.mfl, stored.mfl);
  assertEquals(m1.somethingElse, true);

  // Same handle (case-insensitive) keeps the known id.
  const p2 = parsePlatformPatch({ sleeper: 'OLD' }, Y);
  assert(p2.ok);
  assertEquals(mergePlatformUsernames(stored, p2.patch).sleeperUserId, '1');

  // ESPN-only patch leaves sleeper alone; [] clears the platform.
  const p3 = parsePlatformPatch({ espn: [] }, Y);
  assert(p3.ok);
  const m3 = mergePlatformUsernames(stored, p3.patch);
  assertEquals(m3.sleeper, 'old');
  assertEquals('espn' in m3, false);

  // Empty patch is a no-op.
  assertEquals(mergePlatformUsernames(stored, {}), stored);
});

Deno.test('public shape: sleeper stays a string, junk dropped, lists capped', () => {
  assertEquals(publicPlatformUsernames(null), {});
  assertEquals(publicPlatformUsernames({ sleeper: 'x' }), { sleeper: 'x' });
  assertEquals(publicPlatformUsernames({ sleeperUsername: 'y' }), { sleeper: 'y' });
  const many = Array.from({ length: 15 }, (_, i) => ({ leagueId: String(i + 1), year: 2026 }));
  const out = publicPlatformUsernames({
    sleeper: 'bad handle',
    sleeperUserId: '5',
    espn: [...many, { leagueId: 'junk', year: 2026 }],
    mfl: 'nope',
    other: 1,
  }, Y);
  assertEquals(out.sleeper, undefined);
  assertEquals(out.sleeperUserId, undefined);
  assertEquals(out.espn?.length, MAX_LEAGUES_PER_PLATFORM);
  assertEquals(out.mfl, undefined);
  assertEquals('other' in out, false);
});

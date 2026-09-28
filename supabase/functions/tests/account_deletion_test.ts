// deno test supabase/functions/tests/
import { assert, assertEquals } from 'jsr:@std/assert@1';
import {
  deleteAuthUsersByEmail,
  emailTombstoneKey,
  isStaleAuthUserForDeletedAccount,
} from '../_shared/account-deletion.ts';

const DELETED = '2026-09-20T12:00:00.000Z';
const NOW = Date.parse('2026-09-28T12:00:00.000Z');

Deno.test('auth user created before the deletion is a leftover', () => {
  assert(isStaleAuthUserForDeletedAccount({ authUserCreatedAt: '2026-07-01T00:00:00Z', tombstoneDeletedAt: DELETED, now: NOW }));
  assert(isStaleAuthUserForDeletedAccount({ authUserCreatedAt: null, tombstoneDeletedAt: DELETED, now: NOW }));
});

Deno.test('auth user created after the deletion is a deliberate return', () => {
  assert(!isStaleAuthUserForDeletedAccount({ authUserCreatedAt: '2026-09-21T00:00:00Z', tombstoneDeletedAt: DELETED, now: NOW }));
});

Deno.test('tombstones expire after the window', () => {
  assert(!isStaleAuthUserForDeletedAccount({ authUserCreatedAt: '2026-01-01T00:00:00Z', tombstoneDeletedAt: DELETED, now: Date.parse('2026-11-01T00:00:00Z') }));
  assert(!isStaleAuthUserForDeletedAccount({ authUserCreatedAt: '2026-01-01T00:00:00Z', tombstoneDeletedAt: null, now: NOW }));
});

Deno.test('tombstone key is the sha256 of the normalized email (matches the SQL backfill)', async () => {
  assertEquals(await emailTombstoneKey('  Someone@Gmail.COM '), await emailTombstoneKey('someone@gmail.com'));
  // printf 'a@b.co' | sha256sum — what the migration's encode(sha256(...)) yields
  assertEquals(await emailTombstoneKey('A@b.co'), '80305c9bb1bb2480e03894350e0a8a366dcbdeb302e69e0817aa0743abd77054');
});

function fakeAdmin(pages: Array<Array<{ id: string; email: string }>>, failDelete = new Set<string>()) {
  const deleted: string[] = [];
  const listed: number[] = [];
  return {
    deleted,
    listed,
    auth: {
      admin: {
        listUsers: ({ page }: { page: number; perPage: number }) => {
          listed.push(page);
          return Promise.resolve({ data: { users: pages[page - 1] || [] }, error: null });
        },
        deleteUser: (id: string) => {
          if (failDelete.has(id)) return Promise.resolve({ error: { message: 'boom' } });
          deleted.push(id);
          return Promise.resolve({ error: null });
        },
      },
    },
  };
}

Deno.test('auth users are found by email across pages, not by app_users.id', async () => {
  const full = Array.from({ length: 1000 }, (_, i) => ({ id: `u${i}`, email: `p${i}@x.co` }));
  full[10] = { id: 'google-1', email: 'Owner@X.co' };
  const admin = fakeAdmin([full, [{ id: 'apple-2', email: 'owner@x.co' }, { id: 'u-other', email: 'other@x.co' }]]);
  const res = await deleteAuthUsersByEmail(admin, 'owner@x.co');
  assertEquals(res, { found: 2, deleted: 2 });
  assertEquals(admin.deleted, ['google-1', 'apple-2']);
  assertEquals(admin.listed, [1, 2]);
});

Deno.test('no auth user (email/password account) is fine; delete errors are reported, not thrown', async () => {
  assertEquals(await deleteAuthUsersByEmail(fakeAdmin([[]]), 'none@x.co'), { found: 0, deleted: 0 });
  const res = await deleteAuthUsersByEmail(fakeAdmin([[{ id: 'g', email: 'a@x.co' }]], new Set(['g'])), 'a@x.co');
  assertEquals(res.found, 1);
  assertEquals(res.deleted, 0);
  assert(res.error);
});

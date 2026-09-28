/**
 * _shared/account-deletion.ts — what "this account was deleted" means beyond
 * the app_users row.
 *
 * 1. Supabase Auth users (Google / Apple sign-ins) live in a different id
 *    space than app_users (0 of 40 OAuth accounts share an id), and app_users
 *    has no auth_user_id column, so they are found BY EMAIL through the admin
 *    API, paginated. fw-delete-account used to call deleteUser(app_users.id),
 *    which never matched, leaving the auth user (and every device's Google
 *    session) alive.
 *
 * 2. A tombstone (public.deleted_account_tombstones, keyed by the SHA-256 of
 *    the normalized email — no plaintext is kept) lets fw-oauth-sync refuse to
 *    silently recreate an account from a Supabase session that predates the
 *    deletion. A Google sign-in made AFTER the deletion creates a new auth
 *    user and is allowed: that's a person deliberately coming back.
 *
 * Every helper here is best-effort and never throws: a missing tombstone
 * table (migration not applied yet) or an Auth API hiccup must never block a
 * deletion or a sign-in.
 */

import { normalizeEmail, sha256Hex } from './security.ts';

export const DELETED_ACCOUNT_WINDOW_DAYS = 30;
const TOMBSTONE_TABLE = 'deleted_account_tombstones';
const AUTH_PAGE_SIZE = 1000;
const AUTH_MAX_PAGES = 50; // 50k auth users — far past today's size, bounds the loop

export async function emailTombstoneKey(email: string): Promise<string> {
  return sha256Hex(normalizeEmail(email));
}

/**
 * Pure decision: is this Supabase Auth user a leftover from before the
 * account was deleted (so an OAuth sync must NOT recreate the account)?
 * Unknown / unparseable creation time counts as leftover (fail closed; the
 * caller's remedy is to delete that auth user, after which a fresh sign-in
 * goes through).
 */
export function isStaleAuthUserForDeletedAccount(args: {
  authUserCreatedAt: string | null | undefined;
  tombstoneDeletedAt: string | null | undefined;
  now?: number;
  windowDays?: number;
}): boolean {
  const deletedAt = Date.parse(String(args.tombstoneDeletedAt || ''));
  if (!Number.isFinite(deletedAt)) return false;
  const now = args.now ?? Date.now();
  const windowMs = (args.windowDays ?? DELETED_ACCOUNT_WINDOW_DAYS) * 24 * 60 * 60 * 1000;
  if (now - deletedAt > windowMs) return false;
  const createdAt = Date.parse(String(args.authUserCreatedAt || ''));
  if (!Number.isFinite(createdAt)) return true;
  return createdAt <= deletedAt;
}

export async function recordDeletionTombstone(admin: any, email: string, source: string): Promise<boolean> {
  if (!normalizeEmail(email)) return false;
  try {
    const { error } = await admin.from(TOMBSTONE_TABLE).upsert({
      email_sha256: await emailTombstoneKey(email),
      deleted_at: new Date().toISOString(),
      source,
    }, { onConflict: 'email_sha256' });
    if (error) {
      console.warn('[account-deletion] tombstone write failed', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('[account-deletion] tombstone write failed', err);
    return false;
  }
}

export async function findRecentDeletionTombstone(
  admin: any,
  email: string,
  windowDays = DELETED_ACCOUNT_WINDOW_DAYS,
): Promise<{ deletedAt: string } | null> {
  if (!normalizeEmail(email)) return null;
  try {
    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await admin
      .from(TOMBSTONE_TABLE)
      .select('deleted_at')
      .eq('email_sha256', await emailTombstoneKey(email))
      .gte('deleted_at', since)
      .maybeSingle();
    if (error || !data?.deleted_at) return null; // table missing → fail open
    return { deletedAt: String(data.deleted_at) };
  } catch {
    return null;
  }
}

export async function clearDeletionTombstone(admin: any, email: string): Promise<void> {
  try {
    await admin.from(TOMBSTONE_TABLE).delete().eq('email_sha256', await emailTombstoneKey(email));
  } catch { /* best-effort */ }
}

/**
 * Delete every Supabase Auth user whose email matches. Paginates the admin
 * listUsers API (it has no email filter). Returns counts; never throws.
 */
export async function deleteAuthUsersByEmail(
  admin: any,
  email: string,
): Promise<{ found: number; deleted: number; error?: string }> {
  const target = normalizeEmail(email);
  if (!target) return { found: 0, deleted: 0 };
  let found = 0;
  let deleted = 0;
  let lastError: string | undefined;
  const ids: string[] = [];
  try {
    for (let page = 1; page <= AUTH_MAX_PAGES; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
      if (error) {
        lastError = error.message || String(error);
        break;
      }
      const users = data?.users || [];
      for (const u of users) {
        if (u?.id && normalizeEmail(u.email) === target) ids.push(u.id);
      }
      if (users.length < AUTH_PAGE_SIZE) break;
    }
  } catch (err) {
    lastError = String(err);
  }
  found = ids.length;
  for (const id of ids) {
    try {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) lastError = error.message || String(error);
      else deleted++;
    } catch (err) {
      lastError = String(err);
    }
  }
  return lastError ? { found, deleted, error: lastError.slice(0, 200) } : { found, deleted };
}

export async function deleteAuthUserById(admin: any, id: string): Promise<boolean> {
  try {
    const { error } = await admin.auth.admin.deleteUser(id);
    return !error;
  } catch {
    return false;
  }
}

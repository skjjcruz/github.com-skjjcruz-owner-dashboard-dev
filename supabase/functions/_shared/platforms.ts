/**
 * _shared/platforms.ts — the account's connected-platform POINTERS
 * (app_users.platform_usernames), the server copy of "who is this user on
 * Sleeper / ESPN / MFL".
 *
 * Why this exists: identity lived only in device localStorage, so a new
 * device, the other surface (web vs app), a sign-out or Safari's storage
 * purge stranded users with 0 leagues. fw-profile now MERGES pointers into the
 * row (it used to replace the whole object and only kept `sleeper`), and every
 * session issuer (fw-signin / fw-oauth-sync / fw-refresh-session) returns them
 * so a sign-in can rebuild the device cache without an extra round trip.
 *
 * Stored shape (jsonb). `sleeper` stays a plain string because SQL and admin
 * tooling read `platform_usernames->>'sleeper'`:
 *   {
 *     sleeper?:       "handle",
 *     sleeperUserId?: "123456789012345678",          // string: exceeds 2^53
 *     espn?: [{ leagueId: "12345", year: 2026, teamId: "3" | null }],
 *     mfl?:  [{ leagueId: "54321", year: 2026, franchiseId: "0004" | null }],
 *   }
 *
 * POINTERS ONLY. ESPN espn_s2/SWID cookies and MFL API keys are credentials;
 * they are never stored here. Entries are rebuilt from whitelisted fields, so
 * a secret can't be persisted by construction, and any secret-looking field
 * a client sends is reported (by name only) so fw-profile can audit it.
 *
 * Pure helpers (no env reads at import time) so supabase/functions/tests can
 * exercise them directly.
 */

export const MAX_LEAGUES_PER_PLATFORM = 10;

export type EspnPointer = { leagueId: string; year: number; teamId: string | null };
export type MflPointer = { leagueId: string; year: number; franchiseId: string | null };

export type PlatformUsernames = {
  sleeper?: string;
  sleeperUserId?: string;
  espn?: EspnPointer[];
  mfl?: MflPointer[];
};

// A validated POST. A key is present only when the client sent it:
//   sleeper — only when the handle is valid (invalid handles are ignored,
//             exactly as before, so old clients never start failing);
//   espn/mfl — the complete list for that platform ([] clears it).
export type PlatformPatch = {
  sleeper?: { username: string; userId: string | null };
  espn?: EspnPointer[];
  mfl?: MflPointer[];
};

export type PlatformPatchResult =
  | { ok: true; patch: PlatformPatch; secretFields: string[] }
  | { ok: false; error: string; secretFields: string[] };

const SLEEPER_HANDLE_RE = /^[A-Za-z0-9_.-]{1,40}$/;
const SLEEPER_USER_ID_RE = /^\d{1,32}$/;
const ESPN_LEAGUE_ID_RE = /^\d{1,12}$/;
const ESPN_TEAM_ID_RE = /^\d{1,4}$/;
const MFL_LEAGUE_ID_RE = /^\d{1,10}$/;
const MFL_FRANCHISE_ID_RE = /^\d{1,4}$/;
const MIN_YEAR = 2000;

// Credential-looking field names. Matched against every key the client sends
// under platformUsernames (any depth we inspect).
const SECRET_KEY_RE = /(espn_?s2|^s2$|swid|api_?key|cookie|password|passwd|secret|token|credential|auth)/i;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function collectSecretFields(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 3 || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 50)) collectSecretFields(item, out, depth + 1);
    return;
  }
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(key)) out.add(key.slice(0, 40));
    collectSecretFields(inner, out, depth + 1);
  }
}

// Ids arrive as strings (localStorage) or small integers (JSON). Anything
// else — floats, booleans, objects, strings with junk — is a type error.
function idString(value: unknown, re: RegExp): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    value = String(value);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return re.test(trimmed) ? trimmed : null;
}

function yearNumber(value: unknown, currentYear: number): number | null {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'string' && /^\d{4}$/.test(value.trim())) n = Number(value.trim());
  else return null;
  if (!Number.isInteger(n) || n < MIN_YEAR || n > currentYear + 1) return null;
  return n;
}

function optionalId(value: unknown, re: RegExp): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, value: null };
  const id = idString(value, re);
  return id === null ? { ok: false } : { ok: true, value: id };
}

function padFranchise(id: string | null): string | null {
  return id === null ? null : id.padStart(4, '0');
}

type ListResult<T> = { ok: true; list: T[] } | { ok: false; error: string };

function parseLeagueList<T>(
  platform: 'espn' | 'mfl',
  value: unknown,
  parseEntry: (entry: Record<string, unknown>) => T | null,
  key: (entry: T) => string,
): ListResult<T> {
  if (value === null) return { ok: true, list: [] };
  if (!Array.isArray(value)) return { ok: false, error: `${platform} must be an array.` };
  if (value.length > MAX_LEAGUES_PER_PLATFORM) {
    return { ok: false, error: `${platform} accepts at most ${MAX_LEAGUES_PER_PLATFORM} leagues.` };
  }
  const seen = new Set<string>();
  const list: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (!isPlainObject(raw)) return { ok: false, error: `${platform}[${i}] must be an object.` };
    const entry = parseEntry(raw);
    if (!entry) return { ok: false, error: `${platform}[${i}] has an invalid leagueId, year or team.` };
    const k = key(entry);
    if (seen.has(k)) continue;
    seen.add(k);
    list.push(entry);
  }
  return { ok: true, list };
}

function parseEspnEntry(raw: Record<string, unknown>, currentYear: number): EspnPointer | null {
  const leagueId = idString(raw.leagueId, ESPN_LEAGUE_ID_RE);
  const year = yearNumber(raw.year, currentYear);
  const teamId = optionalId(raw.teamId, ESPN_TEAM_ID_RE);
  if (!leagueId || year === null || !teamId.ok) return null;
  return { leagueId, year, teamId: teamId.value };
}

function parseMflEntry(raw: Record<string, unknown>, currentYear: number): MflPointer | null {
  const leagueId = idString(raw.leagueId, MFL_LEAGUE_ID_RE);
  const year = yearNumber(raw.year, currentYear);
  const franchiseId = optionalId(raw.franchiseId, MFL_FRANCHISE_ID_RE);
  if (!leagueId || year === null || !franchiseId.ok) return null;
  return { leagueId, year, franchiseId: padFranchise(franchiseId.value) };
}

const leagueKey = (e: { leagueId: string; year: number }) => `${e.leagueId}:${e.year}`;

/**
 * Validate a client's `platformUsernames` POST body.
 *
 * Backward compatible with every shipped client, which only ever sends
 * `{ sleeper: "<handle>" }` (or the older `sleeperUsername` alias): a missing,
 * empty or malformed handle is IGNORED, never an error. The new keys (espn,
 * mfl, sleeperUserId) are strict: a wrong type or an oversize list is a 400.
 */
export function parsePlatformPatch(
  value: unknown,
  currentYear: number = new Date().getUTCFullYear(),
): PlatformPatchResult {
  const secrets = new Set<string>();
  collectSecretFields(value, secrets);
  const secretFields = [...secrets];
  if (!isPlainObject(value)) return { ok: true, patch: {}, secretFields };

  const patch: PlatformPatch = {};

  // ── Sleeper: string handle (legacy) or { username, userId } ──
  const sleeperRaw = value.sleeper;
  const handleRaw = isPlainObject(sleeperRaw) ? sleeperRaw.username : (sleeperRaw || value.sleeperUsername);
  // String() for primitives mirrors the pre-merge sanitizer exactly.
  const handle = (typeof handleRaw === 'string' || typeof handleRaw === 'number') ? String(handleRaw).trim() : '';
  const userIdRaw = isPlainObject(sleeperRaw) && sleeperRaw.userId !== undefined ? sleeperRaw.userId : value.sleeperUserId;
  const hasUserId = userIdRaw !== undefined && userIdRaw !== null && userIdRaw !== '';
  if (hasUserId) {
    // Strings only: Sleeper user ids are ~18 digits, past Number precision.
    if (typeof userIdRaw !== 'string' || !SLEEPER_USER_ID_RE.test(userIdRaw.trim())) {
      return { ok: false, error: 'sleeperUserId must be a numeric string.', secretFields };
    }
  }
  if (handle && SLEEPER_HANDLE_RE.test(handle)) {
    patch.sleeper = { username: handle, userId: hasUserId ? (userIdRaw as string).trim() : null };
  } else if (hasUserId) {
    return { ok: false, error: 'sleeperUserId requires a valid sleeper username.', secretFields };
  }

  // ── ESPN / MFL league pointers (complete list per platform) ──
  if (Object.prototype.hasOwnProperty.call(value, 'espn')) {
    const res = parseLeagueList('espn', value.espn, (e) => parseEspnEntry(e, currentYear), leagueKey);
    if (!res.ok) return { ok: false, error: res.error, secretFields };
    patch.espn = res.list;
  }
  if (Object.prototype.hasOwnProperty.call(value, 'mfl')) {
    const res = parseLeagueList('mfl', value.mfl, (e) => parseMflEntry(e, currentYear), leagueKey);
    if (!res.ok) return { ok: false, error: res.error, secretFields };
    patch.mfl = res.list;
  }

  return { ok: true, patch, secretFields };
}

/**
 * Merge a validated patch into the stored object. Keys the patch doesn't name
 * are kept untouched (including keys this code doesn't know about), which is
 * the fix for "connecting Sleeper wiped everything else".
 */
export function mergePlatformUsernames(existing: unknown, patch: PlatformPatch): Record<string, unknown> {
  const out: Record<string, unknown> = isPlainObject(existing) ? { ...existing } : {};

  if (patch.sleeper) {
    const previous = typeof out.sleeper === 'string' ? out.sleeper : '';
    const sameHandle = previous.toLowerCase() === patch.sleeper.username.toLowerCase();
    out.sleeper = patch.sleeper.username;
    delete out.sleeperUsername; // never-written legacy alias; `sleeper` is canonical
    if (patch.sleeper.userId) {
      out.sleeperUserId = patch.sleeper.userId;
    } else if (!sameHandle) {
      // A different handle invalidates the old id; the same handle keeps it.
      delete out.sleeperUserId;
    }
  }

  for (const platform of ['espn', 'mfl'] as const) {
    const list = patch[platform];
    if (!list) continue;
    if (list.length) out[platform] = list;
    else delete out[platform];
  }

  return out;
}

/**
 * The client-facing view of the stored object: the shape fw-profile GET and
 * the sign-in responses return. Re-validates what's stored (lenient: bad
 * entries are dropped, never thrown) so a hand-edited row can't leak junk.
 */
export function publicPlatformUsernames(
  stored: unknown,
  currentYear: number = new Date().getUTCFullYear(),
): PlatformUsernames {
  if (!isPlainObject(stored)) return {};
  const out: PlatformUsernames = {};

  const handleRaw = stored.sleeper || stored.sleeperUsername;
  const handle = typeof handleRaw === 'string' ? handleRaw.trim() : '';
  if (handle && SLEEPER_HANDLE_RE.test(handle)) {
    out.sleeper = handle;
    const uid = stored.sleeperUserId;
    if (typeof uid === 'string' && SLEEPER_USER_ID_RE.test(uid)) out.sleeperUserId = uid;
  }

  const lenientList = <T>(raw: unknown, parse: (e: Record<string, unknown>) => T | null): T[] =>
    (Array.isArray(raw) ? raw : [])
      .filter(isPlainObject)
      .map(parse)
      .filter((e): e is T => e !== null)
      .slice(0, MAX_LEAGUES_PER_PLATFORM);

  const espn = lenientList(stored.espn, (e) => parseEspnEntry(e, currentYear));
  if (espn.length) out.espn = espn;
  const mfl = lenientList(stored.mfl, (e) => parseMflEntry(e, currentYear));
  if (mfl.length) out.mfl = mfl;

  return out;
}

/**
 * Session issuers call this to attach `platformUsernames` to their response.
 * Never throws and never blocks a sign-in: on a read failure it returns null,
 * meaning "unknown — ask fw-profile", as distinct from {} ("none on file").
 */
export async function loadPlatformUsernames(admin: any, userId: string): Promise<PlatformUsernames | null> {
  try {
    const { data, error } = await admin
      .from('app_users')
      .select('platform_usernames')
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      console.warn('[platforms] load failed', error.message);
      return null;
    }
    return publicPlatformUsernames(data?.platform_usernames || {});
  } catch (err) {
    console.warn('[platforms] load failed', err);
    return null;
  }
}

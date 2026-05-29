import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { jwtVerify } from 'npm:jose';

export type JsonBody = Record<string, unknown>;

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
  'https://jcc100218.github.io',
  'https://warroom.skjjcruz.com',
];

export function corsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get('Origin') || '';
  const configured = (Deno.env.get('APP_ALLOWED_ORIGINS') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowed = configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0] || origin || '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  };
}

export function handleOptions(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response('ok', { headers: corsHeaders(req) });
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ||
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    req.headers.get('X-Real-IP') ||
    'unknown'
  );
}

export function userAgent(req: Request): string {
  return (req.headers.get('User-Agent') || '').slice(0, 500);
}

export function decodeJwtPayload(authHeader: string | null): Record<string, any> | null {
  const token = (authHeader || '').replace(/^Bearer\s+/i, '').trim();
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function bearerToken(req: Request): string {
  return (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
}

export async function verifyJwtPayload(
  req: Request,
  secretEnvNames: string[] = ['JWT_SECRET', 'SUPABASE_JWT_SECRET'],
): Promise<Record<string, any> | null> {
  const token = bearerToken(req);
  if (!token) return null;
  for (const envName of secretEnvNames) {
    const secret = Deno.env.get(envName);
    if (!secret) continue;
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { algorithms: ['HS256'] });
      return payload as Record<string, any>;
    } catch {}
  }
  return null;
}

export async function requireActiveAppSession(
  admin: SupabaseClient,
  req: Request,
): Promise<{ userId: string; email: string | null; sessionVersion: number; payload: Record<string, any> } | null> {
  const payload = await verifyJwtPayload(req, ['JWT_SECRET', 'SUPABASE_JWT_SECRET']);
  if (!payload) return null;
  const metadata = payload?.app_metadata || {};
  const userId = metadata.user_id || payload?.sub || null;
  const tokenSessionVersion = Number(metadata.session_version || 0);
  if (!userId || !Number.isFinite(tokenSessionVersion) || tokenSessionVersion < 1) return null;

  const { data: user } = await admin
    .from('app_users')
    .select('email, session_version')
    .eq('id', userId)
    .maybeSingle();
  if (!user || Number(user.session_version || 1) !== tokenSessionVersion) return null;

  return {
    userId,
    email: metadata.email || user.email || null,
    sessionVersion: tokenSessionVersion,
    payload,
  };
}

export async function requireSleeperSession(req: Request): Promise<{ username: string; payload: Record<string, any> } | null> {
  const payload = await verifyJwtPayload(req, ['SUPABASE_JWT_SECRET', 'JWT_SECRET']);
  if (!payload) return null;
  const username = payload?.app_metadata?.sleeper_username || null;
  if (!username) return null;
  return { username: String(username), payload };
}

export function normalizeEmail(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function auditEvent(
  admin: SupabaseClient,
  req: Request,
  eventType: string,
  outcome: string,
  actor: { userId?: string | null; email?: string | null; username?: string | null } = {},
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await admin.from('security_events').insert({
      event_type: eventType,
      outcome,
      actor_user_id: actor.userId || null,
      actor_email: actor.email || null,
      actor_username: actor.username || null,
      ip_address: clientIp(req),
      user_agent: userAgent(req),
      metadata,
    });
  } catch (err) {
    console.warn('[security] auditEvent failed', err);
  }
}

export async function checkRateLimit(
  admin: SupabaseClient,
  scope: string,
  identifier: string,
  options: { limit: number; windowSeconds: number; lockoutSeconds?: number },
): Promise<{ allowed: boolean; retryAfterSeconds?: number; count: number }> {
  const now = Date.now();
  const key = String(identifier || 'unknown').slice(0, 300);
  const { data: row } = await admin
    .from('auth_rate_limits')
    .select('window_start, attempt_count, locked_until')
    .eq('scope', scope)
    .eq('identifier', key)
    .maybeSingle();

  const lockedUntil = row?.locked_until ? Date.parse(row.locked_until) : 0;
  if (lockedUntil && lockedUntil > now) {
    return {
      allowed: false,
      retryAfterSeconds: Math.ceil((lockedUntil - now) / 1000),
      count: row?.attempt_count || 0,
    };
  }

  const windowStart = row?.window_start ? Date.parse(row.window_start) : 0;
  const resetWindow = !windowStart || now - windowStart > options.windowSeconds * 1000;
  const count = resetWindow ? 1 : (row?.attempt_count || 0) + 1;
  const shouldLock = count > options.limit;
  const lockedIso = shouldLock && options.lockoutSeconds
    ? new Date(now + options.lockoutSeconds * 1000).toISOString()
    : null;

  await admin.from('auth_rate_limits').upsert({
    scope,
    identifier: key,
    window_start: resetWindow ? new Date(now).toISOString() : row?.window_start,
    attempt_count: count,
    locked_until: lockedIso,
    updated_at: new Date(now).toISOString(),
  }, { onConflict: 'scope,identifier' });

  if (shouldLock) {
    return {
      allowed: false,
      retryAfterSeconds: options.lockoutSeconds || options.windowSeconds,
      count,
    };
  }

  return { allowed: true, count };
}

export async function clearRateLimit(admin: SupabaseClient, scope: string, identifier: string): Promise<void> {
  try {
    await admin.from('auth_rate_limits').delete().eq('scope', scope).eq('identifier', identifier.slice(0, 300));
  } catch {}
}

export async function hasAdminRole(admin: SupabaseClient, userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  const { data } = await admin
    .from('app_user_roles')
    .select('role')
    .eq('user_id', userId)
    .in('role', ['admin', 'owner'])
    .limit(1);
  return !!data?.length;
}

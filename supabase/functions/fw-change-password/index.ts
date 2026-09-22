// App-account Settings rotation; legacy provisioning remains a separate endpoint.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { auditEvent, checkRateLimit, clientIp, handleOptions, json, requireActiveAppSession } from '../_shared/security.ts';

Deno.serve(async req => {
  const options = handleOptions(req);
  if (options) return options;
  if (req.method !== 'POST') return json(req, { error: 'POST required.' }, 405);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const session = await requireActiveAppSession(admin, req);
    if (!session) return json(req, { error: 'Sign in again before changing your password.' }, 401);
    const limits = await Promise.all([
      checkRateLimit(admin, 'password-change:ip', clientIp(req), { limit: 20, windowSeconds: 900, lockoutSeconds: 900 }),
      checkRateLimit(admin, 'password-change:account', session.userId, { limit: 8, windowSeconds: 900, lockoutSeconds: 900 }),
    ]);
    if (limits.some(limit => !limit.allowed)) return json(req, { error: 'Too many attempts. Try again later.' }, 429);
    const raw = await req.text();
    if (raw.length > 12000) return json(req, { error: 'Password request is too large.' }, 413);
    let body;
    try { body = JSON.parse(raw); } catch { return json(req, { error: 'Invalid password request.' }, 400); }
    const { currentPassword, password } = body || {};
    if (typeof currentPassword !== 'string' || !currentPassword || currentPassword.length > 1024
        || typeof password !== 'string' || password.length < 8 || password.length > 1024) {
      return json(req, { error: 'Enter your current password and a new password between 8 and 1024 characters.' }, 400);
    }
    if (currentPassword === password) return json(req, { error: 'Choose a different new password.' }, 400);
    const { data: user, error: readError } = await admin.from('app_users')
      .select('password_hash, session_version').eq('id', session.userId).maybeSingle();
    if (readError) throw readError;
    if (!user || Number(user.session_version) !== session.sessionVersion) {
      return json(req, { error: 'Your account changed. Sign in again.' }, 401);
    }
    if (typeof user.password_hash === 'string' && user.password_hash.startsWith('oauth:')) {
      return json(req, { error: 'This account uses provider sign-in. Manage your password with your sign-in provider.' }, 400);
    }
    if (!await verifyPassword(currentPassword, user.password_hash)) {
      await auditEvent(admin, req, 'password_changed', 'failure', { userId: session.userId }, { reason: 'current_password' });
      return json(req, { error: 'Current password is incorrect.' }, 400);
    }
    const passwordHash = await hashPassword(password);
    const { data: changed, error } = await admin.rpc('change_app_password', {
      p_user_id: session.userId, p_expected_version: session.sessionVersion,
      p_expected_hash: user.password_hash, p_password_hash: passwordHash,
    });
    if (error) throw error;
    if (changed !== true) return json(req, { error: 'Your account changed. Sign in again before retrying.' }, 409);
    await auditEvent(admin, req, 'password_changed', 'success', { userId: session.userId }, {});
    return json(req, { ok: true, signInRequired: true });
  } catch (error) {
    console.error('fw-change-password failed:', error instanceof Error ? error.name : 'service_error');
    return json(req, { error: 'The password change could not be confirmed. Try signing in with your new password before retrying.' }, 500);
  }
});

async function derive(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new Uint8Array(salt), iterations: 100_000, hash: 'SHA-256' }, key, 256));
}
const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return hex(salt) + ':' + hex(await derive(password, salt));
}
async function verifyPassword(password: string, stored: unknown): Promise<boolean> {
  if (typeof stored !== 'string' || !/^[0-9a-f]{32}:[0-9a-f]{64}$/.test(stored)) return false;
  const [saltHex, hashHex] = stored.split(':');
  const salt = Uint8Array.from(saltHex.match(/.{2}/g)!, h => parseInt(h, 16));
  const actual = await derive(password, salt);
  const expected = Uint8Array.from(hashHex.match(/.{2}/g)!, h => parseInt(h, 16));
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

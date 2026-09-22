/**
 * fw-confirm-password-reset — consume reset token and rotate password.
 *
 * POST /functions/v1/fw-confirm-password-reset
 * Body: { token, password }
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clientIp,
  handleOptions,
  json,
  sha256Hex,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method === 'GET') {
    const token = new URL(req.url).searchParams.get('token') || '';
    const resetBase = Deno.env.get('PASSWORD_RESET_URL') || Deno.env.get('APP_RESET_URL') || 'https://dhqfootball.com/reset-password.html';
    const redirectUrl = `${resetBase}${resetBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    return Response.redirect(redirectUrl, 302);
  }
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405);

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    const limit = await checkRateLimit(admin, 'password-reset-confirm:ip', clientIp(req), { limit: 20, windowSeconds: 3600, lockoutSeconds: 1800 });
    if (!limit.allowed) {
      await auditEvent(admin, req, 'password_reset_confirmed', 'blocked', {}, { reason: 'rate_limited' });
      return json(req, { error: 'Too many reset attempts. Try again later.' }, 429);
    }

    const { token, password } = await req.json();
    if (typeof token !== 'string' || !token || token.length > 512 || typeof password !== 'string') {
      return json(req, { error: 'Token and password are required.' }, 400);
    }
    if (password.length < 8 || password.length > 1024) return json(req, { error: 'Password must be between 8 and 1024 characters.' }, 400);

    const tokenHash = await sha256Hex(String(token));
    const passwordHash = await hashPassword(password);
    const { data, error } = await admin.rpc('confirm_app_password_reset', {
      p_token_hash: tokenHash,
      p_password_hash: passwordHash,
    });
    if (error) throw error;
    const reset = data?.[0];
    if (!reset) {
      await auditEvent(admin, req, 'password_reset_confirmed', 'failure', {}, { reason: 'invalid_or_expired' });
      return json(req, { error: 'Invalid or expired reset token.' }, 400);
    }

    await auditEvent(admin, req, 'password_reset_confirmed', 'success', { userId: reset.user_id, email: reset.email }, {});

    return json(req, { ok: true });
  } catch (err) {
    console.error('fw-confirm-password-reset error:', err);
    return json(req, { error: 'Failed to reset password.' }, 500);
  }
});

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' },
    key,
    256,
  );
  const toHex = (buf: Uint8Array) => Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${toHex(salt)}:${toHex(new Uint8Array(bits))}`;
}

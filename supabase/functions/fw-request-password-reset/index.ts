/**
 * fw-request-password-reset — create an expiring password reset token.
 *
 * POST /functions/v1/fw-request-password-reset
 * Body: { email }
 *
 * Sends a reset email through Resend when RESEND_API_KEY is configured.
 * Returns a generic success response. In non-production setup, set
 * RESET_DEBUG_RETURN_TOKEN=true to include resetToken/resetUrl for manual QA.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  auditEvent,
  checkRateLimit,
  clientIp,
  handleOptions,
  json,
  normalizeEmail,
  sha256Hex,
} from '../_shared/security.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  try {
    const { email } = await req.json();
    const normalizedEmail = normalizeEmail(email);
    const ipLimit = await checkRateLimit(admin, 'password-reset-request:ip', clientIp(req), { limit: 10, windowSeconds: 3600, lockoutSeconds: 1800 });
    const emailLimit = await checkRateLimit(admin, 'password-reset-request:email', normalizedEmail || 'missing', { limit: 3, windowSeconds: 3600, lockoutSeconds: 1800 });
    if (!ipLimit.allowed || !emailLimit.allowed) {
      await auditEvent(admin, req, 'password_reset_requested', 'blocked', { email: normalizedEmail }, { reason: 'rate_limited' });
      return json(req, { ok: true }, 200);
    }

    if (!normalizedEmail) return json(req, { ok: true }, 200);

    const { data: user } = await admin
      .from('app_users')
      .select('id, email')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (!user) {
      await auditEvent(admin, req, 'password_reset_requested', 'ignored', { email: normalizedEmail }, { reason: 'unknown_email' });
      return json(req, { ok: true }, 200);
    }

    const resetToken = crypto.randomUUID() + '.' + crypto.randomUUID();
    const tokenHash = await sha256Hex(resetToken);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await admin.from('password_reset_tokens').insert({
      user_id: user.id,
      token_hash: tokenHash,
      requested_ip: clientIp(req),
      requested_user_agent: req.headers.get('User-Agent') || null,
      expires_at: expiresAt,
    });

    const resetBase = Deno.env.get('PASSWORD_RESET_URL') || Deno.env.get('APP_RESET_URL') || 'https://warroom.skjjcruz.com/reset-password.html';
    const resetUrl = resetBase ? `${resetBase}${resetBase.includes('?') ? '&' : '?'}token=${encodeURIComponent(resetToken)}` : null;
    const delivery = resetUrl
      ? await sendPasswordResetEmail(user.email, resetUrl, expiresAt)
      : { sent: false, reason: 'missing_reset_url' };

    await auditEvent(admin, req, 'password_reset_requested', 'success', { userId: user.id, email: normalizedEmail }, {
      emailSent: delivery.sent,
      emailProvider: delivery.provider || null,
      emailReason: delivery.reason || null,
    });

    if (Deno.env.get('RESET_DEBUG_RETURN_TOKEN') === 'true') {
      return json(req, { ok: true, resetToken, resetUrl, expiresAt, emailSent: delivery.sent, emailReason: delivery.reason || null });
    }
    return json(req, { ok: true });
  } catch (err) {
    console.error('fw-request-password-reset error:', err);
    return json(req, { ok: true }, 200);
  }
});

async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  expiresAt: string,
): Promise<{ sent: boolean; provider?: string; reason?: string }> {
  const apiKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!apiKey) return { sent: false, provider: 'resend', reason: 'missing_resend_api_key' };

  const from = Deno.env.get('PASSWORD_RESET_FROM_EMAIL') || 'Dynasty HQ <onboarding@resend.dev>';
  const replyTo = Deno.env.get('PASSWORD_RESET_REPLY_TO') || undefined;
  const expiresText = new Date(expiresAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Chicago',
  });
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#0a0a0a;color:#ffffff;padding:28px">
      <div style="max-width:560px;margin:0 auto;background:#151515;border:1px solid #d4af37;border-radius:8px;padding:28px">
        <h1 style="margin:0 0 12px;color:#d4af37;font-size:24px">Reset your Dynasty HQ password</h1>
        <p style="line-height:1.55;color:#e8e8e8">Use the button below to choose a new password. This link expires at ${expiresText} Central.</p>
        <p style="margin:28px 0">
          <a href="${escapeHtml(resetUrl)}" style="display:inline-block;background:#d4af37;color:#0a0a0a;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:6px">Reset password</a>
        </p>
        <p style="line-height:1.55;color:#bdbdbd;font-size:13px">If you did not request this, you can ignore this email.</p>
      </div>
    </div>
  `;
  const text = [
    'Reset your Dynasty HQ password',
    '',
    `Use this link to choose a new password: ${resetUrl}`,
    `This link expires at ${expiresText} Central.`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: 'Reset your Dynasty HQ password',
      html,
      text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.warn('[password-reset] Resend failed:', res.status, errText.slice(0, 300));
    return { sent: false, provider: 'resend', reason: `resend_${res.status}` };
  }

  return { sent: true, provider: 'resend' };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

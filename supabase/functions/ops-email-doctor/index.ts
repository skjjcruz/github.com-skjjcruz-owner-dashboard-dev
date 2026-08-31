/**
 * ops-email-doctor — TEMPORARY operator diagnostic (2026-08-31).
 *
 * The password-reset pipeline fails silently by design (no account
 * enumeration), which also blinds the operator. This one-shot probe answers,
 * in a single call: is the Resend key visible to functions, do the test
 * emails have accounts, and does a live send from the verified domain
 * actually deliver. Nonce-guarded; returns booleans and status codes only —
 * never secret values. Retired (stubbed) immediately after use.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const NONCE = 'dhq-doctor-e6XizXfJvtCfhvhIcn1JNKJZ';

Deno.serve(async (req) => {
  try {
    const { nonce, sendTo } = await req.json().catch(() => ({}));
    if (nonce !== NONCE) return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const out: Record<string, unknown> = {};

    const envKey = Deno.env.get('RESEND_API_KEY') || '';
    out.envKeyPresent = !!envKey;
    out.envKeyLooksRight = envKey.startsWith('re_');
    out.envKeyLen = envKey.length;
    out.replyToSecret = Deno.env.get('PASSWORD_RESET_REPLY_TO') || null;
    out.fromSecret = Deno.env.get('PASSWORD_RESET_FROM_EMAIL') || null;

    try {
      const { data, error } = await admin.rpc('get_app_secret', { secret_name: 'RESEND_API_KEY' });
      out.vaultKeyPresent = typeof data === 'string' && !!data.trim();
      if (error) out.vaultErr = error.message;
    } catch (e) {
      out.vaultErr = String(e);
    }

    for (const em of ['steven.crusinberry@gmail.com', 'admin@c2football.com']) {
      const { data, error } = await admin.from('app_users').select('id').eq('email', em).maybeSingle();
      out['account_' + em] = !!data;
      if (error) out['accountErr_' + em] = error.message;
    }

    if (sendTo && envKey) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${envKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Dynasty HQ <noreply@dhqfootball.com>',
          to: sendTo,
          subject: 'Dynasty HQ email engine — live test',
          text: 'This is the test email proving the new Dynasty HQ email engine works end to end. Password-reset emails ride this same engine. You can delete this.',
        }),
      });
      out.sendStatus = res.status;
      out.sendBody = (await res.text()).slice(0, 300);
    }

    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ err: String(e) }), { status: 500 });
  }
});

/**
 * yahoo-oauth — Yahoo Fantasy OAuth 2.0 handler
 *
 * STEP 1 — Initiate (called from the frontend):
 *   GET /functions/v1/yahoo-oauth?action=start&user_id=<app_user_id>&return_to=<url>
 *   → Redirects browser to Yahoo authorization page
 *
 * STEP 2 — Callback (called by Yahoo after user approves):
 *   GET /functions/v1/yahoo-oauth?code=<code>&state=<state>
 *   → Exchanges code for tokens, stores in DB, redirects back to return_to URL
 *
 * Required secrets (set in Supabase → Settings → Edge Functions → Secrets):
 *   YAHOO_CLIENT_ID      — Yahoo app Client ID (Consumer Key)
 *   YAHOO_CLIENT_SECRET  — Yahoo app Client Secret (Consumer Secret)
 *
 * Built-in secrets (auto-provided by Supabase):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Yahoo app setup:
 *   1. Go to developer.yahoo.com → My Apps → your app
 *   2. Set Callback Domain to: sxshiqyxhhifvtfqawbq.supabase.co
 *   3. Enable API Permissions: Fantasy Sports (Read)
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const YAHOO_CLIENT_ID     = Deno.env.get('YAHOO_CLIENT_ID')!;
const YAHOO_CLIENT_SECRET = Deno.env.get('YAHOO_CLIENT_SECRET')!;
const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const YAHOO_AUTH_URL  = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

// The callback URL registered in your Yahoo app must point here
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/yahoo-oauth`;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const action = url.searchParams.get('action');
  const code   = url.searchParams.get('code');

  // ── STEP 1: Initiate OAuth flow ───────────────────────────────
  if (action === 'start') {
    const userId   = url.searchParams.get('user_id') || '';
    const returnTo = url.searchParams.get('return_to') || '';

    if (!YAHOO_CLIENT_ID) {
      return errorPage('YAHOO_CLIENT_ID secret is not configured in Supabase.');
    }

    // Encode context into state so we can retrieve it in the callback
    const state = btoa(JSON.stringify({ userId, returnTo }));

    const authUrl = new URL(YAHOO_AUTH_URL);
    authUrl.searchParams.set('client_id',     YAHOO_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri',  CALLBACK_URL);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('state',         state);
    // fspt-r = Fantasy Sports read; fspt-w = write (not needed for now)
    authUrl.searchParams.set('scope',         'fspt-r');

    return Response.redirect(authUrl.toString(), 302);
  }

  // ── STEP 2: Handle Yahoo callback (code present) ──────────────
  if (code) {
    const stateParam = url.searchParams.get('state') || '';
    const error      = url.searchParams.get('error');

    if (error) {
      return errorPage(`Yahoo denied access: ${error}`);
    }

    // Decode state
    let userId   = '';
    let returnTo = '';
    try {
      const state = JSON.parse(atob(stateParam));
      userId   = state.userId   || '';
      returnTo = state.returnTo || '';
    } catch {
      // state decode failed — continue without user_id, tokens won't be saved
    }

    // Exchange authorization code for access + refresh tokens
    const basicCreds = btoa(`${YAHOO_CLIENT_ID}:${YAHOO_CLIENT_SECRET}`);
    let tokens: Record<string, unknown>;
    try {
      const tokenResp = await fetch(YAHOO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicCreds}`,
          'Content-Type':  'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type:   'authorization_code',
          code,
          redirect_uri: CALLBACK_URL,
        }),
      });

      if (!tokenResp.ok) {
        const body = await tokenResp.text();
        return errorPage(`Yahoo token exchange failed (${tokenResp.status}): ${body}`);
      }

      tokens = await tokenResp.json();
    } catch (err) {
      return errorPage(`Network error during token exchange: ${err}`);
    }

    // tokens shape from Yahoo:
    //   access_token, refresh_token, expires_in, token_type, xoauth_yahoo_guid
    const yahooGuid = tokens.xoauth_yahoo_guid as string | undefined;

    // Persist tokens to app_users row (if we have a user_id)
    if (userId) {
      try {
        const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

        // Read current platform_usernames to merge (don't overwrite other platforms)
        const { data: existing } = await admin
          .from('app_users')
          .select('platform_usernames, platform_tokens')
          .eq('id', userId)
          .maybeSingle();

        const mergedUsernames = {
          ...(existing?.platform_usernames || {}),
          yahoo: yahooGuid || 'connected',
        };

        const mergedTokens = {
          ...(existing?.platform_tokens || {}),
          yahoo: {
            access_token:  tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at:    Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
            guid:          yahooGuid,
          },
        };

        await admin.from('app_users').update({
          platform_usernames: mergedUsernames,
          platform_tokens:    mergedTokens,
        }).eq('id', userId);
      } catch (dbErr) {
        console.error('[yahoo-oauth] DB update error:', dbErr);
        // Don't fail the user — tokens were exchanged, just log the error
      }
    }

    // Redirect back to the app with success indicator
    if (returnTo) {
      const dest = new URL(returnTo);
      dest.searchParams.set('yahoo_connected', '1');
      if (yahooGuid) dest.searchParams.set('yahoo_guid', yahooGuid);
      return Response.redirect(dest.toString(), 302);
    }

    // Fallback success page if no return_to was provided
    return new Response(successHtml(yahooGuid), {
      headers: { 'Content-Type': 'text/html' },
    });
  }

  // ── Unknown request ───────────────────────────────────────────
  return new Response(
    JSON.stringify({ error: 'Use ?action=start to begin Yahoo OAuth' }),
    { status: 400, headers: { 'Content-Type': 'application/json' } },
  );
});

// ── HTML helpers ──────────────────────────────────────────────

function errorPage(message: string): Response {
  const html = `<!DOCTYPE html>
<html>
<head><title>Yahoo OAuth Error</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#f44;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a1a1a;padding:2rem;border-radius:8px;max-width:480px;text-align:center}
h2{margin:0 0 1rem}p{color:#ccc;line-height:1.5}</style></head>
<body><div class="box"><h2>Yahoo Connection Failed</h2><p>${escapeHtml(message)}</p>
<p><a href="javascript:history.back()" style="color:#d4af37">← Go back</a></p></div></body></html>`;
  return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html' } });
}

function successHtml(guid?: string): string {
  return `<!DOCTYPE html>
<html>
<head><title>Yahoo Connected</title>
<style>body{font-family:sans-serif;background:#0a0a0a;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a1a1a;padding:2rem;border-radius:8px;max-width:480px;text-align:center}
h2{color:#d4af37;margin:0 0 1rem}p{color:#ccc}</style></head>
<body><div class="box"><h2>Yahoo Fantasy Connected ✓</h2>
${guid ? `<p>Logged in as GUID: <code>${escapeHtml(guid)}</code></p>` : ''}
<p>You can close this tab and return to the app.</p></div></body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

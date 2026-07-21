# Dynasty HQ — Bug Reporting + Feature Voting + Discord Wiring

This adds three things to War Room:

1. **In-app "Report a bug"** — users file bugs; each one posts to a **private Discord staff channel** and is stored in `bug_reports`.
2. **Automatic crash capture** — uncaught JS errors + unhandled promise rejections post to the same staff channel (deduped, capped per page-load).
3. **Feature voting board** — users submit ideas and upvote; new ideas post to a **public Discord `#feature-requests` channel**. Submitting/voting is **logged-in only**.

All three are surfaced by a single floating **Feedback** launcher (bottom-right) and are also callable from anywhere via `window.WR.Feedback.reportBug()` and `window.WR.Feedback.openBoard()`.

---

## Files added / changed

**New — edge functions**
- `supabase/functions/report-bug/index.ts`
- `supabase/functions/feature-requests/index.ts`

**New — migrations**
- `supabase/migrations/20260711000000_bug_reports.sql`
- `supabase/migrations/20260711010000_feature_requests.sql`

**New — client**
- `js/shared/feedback-hub.js`

**Edited**
- `supabase/config.toml` — added `verify_jwt = false` for `report-bug` and `feature-requests`
- `index.html` — added the `feedback-hub.js` script include (after `wr-ai-context.js`)

Nothing else in the app is touched. The client only calls the two new functions through your existing `window.OD.getClient()`, so no CSP change is needed (your `connect-src` already allows the Supabase origin).

---

## Part 1 — Discord (do this first; it produces the two webhook URLs)

You need one **private** staff channel (bugs) and one **public** channel (ideas), each with an incoming webhook.

### 1a. Create the channels
In the Dynasty HQ server:
- Private staff channel: **`#bug-reports-staff`** under a 🔒 **STAFF** category (deny `@everyone` View Channel; allow your team role). This receives both user bug reports and automatic crashes.
- Public channel: **`#feature-requests`** under a community category. This receives new idea submissions.

### 1b. Create a webhook on each channel
For each channel: **Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL.**
- From `#bug-reports-staff` → this is your **`DISCORD_BUG_WEBHOOK_URL`**.
- From `#feature-requests` → this is your **`DISCORD_IDEAS_WEBHOOK_URL`**.

> Treat these URLs like secrets — anyone with the URL can post to that channel. They go into Supabase secrets (below), never into client-side code.

---

## Part 2 — Supabase (backend)

Run from the `warroom/` repo root, linked to project `sxshiqyxhhifvtfqawbq`.

### 2a. Apply the migrations
```bash
supabase db push
```
This creates `bug_reports`, `feature_requests`, `feature_votes`, and the `toggle_feature_vote` / `list_feature_requests` RPCs (all RLS-locked, service-role only — same model as `ai_feedback`).

### 2b. Set the webhook secrets
```bash
supabase secrets set DISCORD_BUG_WEBHOOK_URL="https://discord.com/api/webhooks/XXXX/YYYY"
supabase secrets set DISCORD_IDEAS_WEBHOOK_URL="https://discord.com/api/webhooks/AAAA/BBBB"
```
(`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are already provided by the platform.)

### 2c. Deploy the two functions
```bash
supabase functions deploy report-bug
supabase functions deploy feature-requests
```
`config.toml` already pins `verify_jwt = false` for both, so a plain deploy won't turn on gateway JWT verification and break your custom-JWT auth.

---

## Part 3 — Frontend

The script include is already added to `index.html`. Deploy the site as you normally do. The Feedback button appears on the authenticated app immediately.

If you want the launcher on other standalone pages (`free-agency.html`, `draft-warroom.html`, etc.), add the same line there:
```html
<script src="js/shared/feedback-hub.js?v=20260711fb1"></script>
```
Crash capture only reports when `window.OD.getClient()` exists on that page (it needs the client to send).

---

## Part 4 — Test it

1. **User bug report:** open the app → click **Feedback → Report a bug** → send. It should appear in `#bug-reports-staff` as a blue (or orange for high/blocker) embed, and as a row in `bug_reports`.
2. **Crash capture:** in the console run `setTimeout(() => { throw new Error("DHQ test crash"); })`. A red 💥 embed should land in `#bug-reports-staff`.
3. **Feature board — submit:** **Feedback → Feature requests → Submit idea.** A 💡 embed should post to public `#feature-requests`, and the idea appears on the board with 1 vote (yours).
4. **Vote:** click the ▲ on any idea; the count updates and toggles.
5. **Logged-out guard:** while signed out, voting/submitting should show "Sign in to vote / submit."

---

## Managing it day-to-day

**Bug statuses** live on `bug_reports.status` (`open → triaged → in_progress → resolved / wont_fix / duplicate`). Update via SQL or the Supabase table editor, e.g.:
```sql
update public.bug_reports set status = 'resolved', admin_note = 'fixed in v20260712' where id = '...';
```

**Feature statuses** live on `feature_requests.status` (`open → planned → in_progress → shipped / declined`). Moving one is what turns the board into a public roadmap:
```sql
update public.feature_requests set status = 'planned' where id = '...';
```
The board's status filter chips (Open / Planned / In Progress / Shipped) read this. You can also `pinned = true` to keep something at the top.

---

## Optional upgrades (not built, easy to add later)

- **Admin surface in `admin.html`** — a table view of `bug_reports` and a dropdown to change statuses, instead of raw SQL.
- **Screenshots on bug reports** — capture with `html2canvas`, upload to a Supabase Storage bucket, pass the public URL as `screenshotUrl`; the function already renders it as the embed image. (Add `html2canvas` to CSP `script-src` / your bundle first.)
- **Sentry → Discord** — your CSP already allows Sentry. If you later add `Sentry.init`, you can route Sentry alerts to the staff channel via Sentry's native Discord alert integration, and dial the built-in crash capture down (e.g. lower `CRASH_CAP`) to avoid double-reporting.
- **Clickable "mark resolved" in Discord** — requires a real Discord **bot** (not just a webhook); that's the same bot you'd build for `#dhq-alerts` and `#bot-commands`. Phase 2.

---

## Security notes

- Both functions authenticate internally (custom JWT via `_shared/security.ts`), rate-limit per identity/IP, and reach the DB only with the service role. Tables have no `anon`/`authenticated` grants.
- `report-bug` is intentionally **session-optional** (so pre-login crashes are still captured) but IP rate-limited; `feature-requests` writes (submit/vote) **require a session**.
- Only `pathname + hash` is sent as the page reference — never the query string — so tokens/PII in URLs are not forwarded to Discord.

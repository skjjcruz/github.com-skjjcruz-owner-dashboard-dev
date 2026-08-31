/**
 * ops-email-doctor — RETIRED (2026-08-31).
 *
 * One-shot diagnostic used to pin down the silent password-reset email
 * failure (verdict: sandbox sender + one probe address having no account).
 * Kept as an inert stub so the deploy pipeline stays simple; returns 410
 * for every request and holds no logic, secrets, or database access.
 */

Deno.serve(() => new Response(JSON.stringify({ error: 'retired' }), { status: 410 }));

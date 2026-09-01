/**
 * ops-board-vault — RETIRED (2026-09-01).
 *
 * One-shot read-only diagnostic deployed during the "draft board gone"
 * incident to list the big-board vault rows in draft_boards (verdict:
 * false alarm — the owner found his board; the vault was never needed).
 * Kept as an inert stub so the deploy pipeline stays simple; returns 410
 * for every request and holds no logic, secrets, or database access.
 */

Deno.serve(() => new Response(JSON.stringify({ error: 'retired' }), { status: 410 }));

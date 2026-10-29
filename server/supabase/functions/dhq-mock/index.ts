// dhq-mock — the mock draft's computer picks (Phase A7, 2026-10-29). Pages no
// longer carry the pick formula (mock-engine.js, vendored here at deploy):
// the draft room sends a trimmed persona and the available players, and
// gets back the pick, or each opponent's predictions. Public, no sign-in
// (the draft room offers persona picks to Scout Pro members and gates that
// itself; free mocks pick best-available on the page).
//
//   POST /functions/v1/dhq-mock
//     { op: 'pick', persona, pool, round, pick, ctx: { teamRoster, draftTuning, draftWeights } }
//       → { pid, confidence, reasoning } (pid null when the pool is empty)
//     { op: 'predict', pool, ctx: { draftTuning }, teams: [{ rid, persona, round, pick }] }
//       → { predictions: { [rid]: { willReach, willPassOn, likelyPick } } }
import './vendor/mock-engine.js';

const ME = (globalThis as any).App.MockEngine as {
  personaPick: (persona: unknown, pool: unknown[], round: number, pick: number, ctx: unknown) => { player: { pid: string } | null; confidence: number; reasoning: unknown } | null;
  computePredictions: (persona: unknown, pool: unknown[], round: number, pick: number, ctx: unknown) => unknown;
};
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, accept',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS } });
const MAX_BYTES = 1024 * 1024, MAX_POOL = 600, MAX_TEAMS = 40;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const text = await req.text();
  if (text.length > MAX_BYTES) return json({ error: 'request too large' }, 413);
  let b: any;
  try { b = JSON.parse(text); } catch { return json({ error: 'JSON body required' }, 400); }
  const pool = Array.isArray(b?.pool) ? b.pool.slice(0, MAX_POOL) : null;
  if (!pool) return json({ error: 'pool required' }, 400);
  const ctx = b.ctx && typeof b.ctx === 'object' ? b.ctx : {};
  try {
    if (b.op === 'pick') {
      const r = ME.personaPick(b.persona || null, pool, Number(b.round) || 1, Number(b.pick) || 1, ctx);
      return json({ pid: r?.player?.pid ?? null, confidence: r?.confidence ?? null, reasoning: r?.reasoning ?? null });
    }
    if (b.op === 'predict') {
      const teams = Array.isArray(b.teams) ? b.teams.slice(0, MAX_TEAMS) : [];
      const predictions: Record<string, unknown> = {};
      for (const t of teams) {
        if (!t || t.rid == null) continue;
        try { predictions[String(t.rid)] = ME.computePredictions(t.persona || null, pool, Number(t.round) || 1, Number(t.pick) || 1, ctx); } catch { /* that team's panel stays as it was */ }
      }
      return json({ predictions });
    }
    return json({ error: "op must be 'pick' or 'predict'" }, 400);
  } catch (e) {
    return json({ error: 'pick failed', detail: String((e as Error).message || e) }, 500);
  }
});

// ops-board-vault — one-shot READ-ONLY diagnostic for the big-board vault
// (owner incident 2026-09-01: draft board reported lost). Lists every
// draft_boards row (vault rows carry league_id '<lid>::wr_bigboard') with a
// richness summary of the stored board, and can return one full payload by id
// so a rescue copy can be secured off-device. Nonce-guarded, GET only, writes
// nothing. Retire to a 410 stub once the incident is closed (ops-email-doctor
// precedent).
import { createClient } from 'npm:@supabase/supabase-js@2';

const NONCE = 'cd33ce4be55a4acc05e4207352cbbf52';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

function boardSummary(picks: unknown) {
  try {
    const p = picks as Record<string, unknown> | null;
    const board = (p && typeof p === 'object' && 'board' in p ? (p as { board?: Record<string, unknown> }).board : null) || null;
    const src = board || (p && typeof p === 'object' ? p : null);
    if (!src) return { empty: true };
    const len = (v: unknown) => Array.isArray(v) ? v.length : 0;
    const keys = (v: unknown) => v && typeof v === 'object' ? Object.keys(v as object).length : 0;
    return {
      schema: (p as Record<string, unknown>)?.schema ?? null,
      savedAt: (p as Record<string, unknown>)?.savedAt ?? null,
      myOrder: len((src as Record<string, unknown>).myOrder),
      aiOrder: len((src as Record<string, unknown>).aiOrder),
      tags: keys((src as Record<string, unknown>).tags),
      notes: keys((src as Record<string, unknown>).notes),
      tiers: keys((src as Record<string, unknown>).tiers),
      roundPlans: keys((src as Record<string, unknown>).roundPlans),
      drafted: len((src as Record<string, unknown>).drafted),
      updatedAt: (src as Record<string, unknown>).updatedAt ?? null,
      topKeys: src && typeof src === 'object' ? Object.keys(src as object).slice(0, 20) : [],
    };
  } catch (_e) {
    return { summaryError: true };
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.searchParams.get('nonce') !== NONCE) {
    return new Response('not found', { status: 404 });
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const fullId = url.searchParams.get('full');
  try {
    if (fullId) {
      const { data, error } = await admin.from('draft_boards')
        .select('*').eq('id', fullId).maybeSingle();
      if (error) throw error;
      return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    }
    const { data, error } = await admin.from('draft_boards')
      .select('id, league_id, board_name, sleeper_username, user_id, created_at, updated_at, picks')
      .order('updated_at', { ascending: false }).limit(60);
    if (error) throw error;
    const rows = (data || []).map((r) => ({
      id: r.id,
      league_id: r.league_id,
      board_name: r.board_name,
      sleeper_username: r.sleeper_username,
      user_id: r.user_id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      picks_summary: boardSummary(r.picks),
    }));
    return new Response(JSON.stringify({ count: rows.length, rows }, null, 1), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  }
});

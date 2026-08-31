/**
 * nfl-depth-charts — NFL role feed for the fantasy apps (owner build 2026-08-31).
 *
 * The Sleeper depth-chart field lags real-world roles by days (it listed the
 * Chargers' starting TE as TE3), so drop advice punished players whose
 * situation had just improved. ESPN's editorial depth charts update fast and
 * are free; browsers are CORS-blocked from ESPN, so this proxies and caches.
 *
 * GET → { builtAt, roles: { "TEAM|normalized name": { pos, rank } } }
 *
 * rank = the player's best depth slot at his fantasy position. For defense
 * ESPN lists granular slots (WLB, RCB, FS…) — rank 1 in ANY sub-slot means
 * "the starter". Offense positions are single lists (wr list covers WR1-3).
 * "Starter" thresholds are applied CLIENT-side so tuning them never needs a
 * function deploy.
 *
 * Snapshot cached 6h in ai_response_cache (cache_key nfl_depth_charts_v1) so
 * ESPN sees ~64 requests per rebuild, not per user.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CACHE_KEY = 'nfl_depth_charts_v1';
const TTL_MS = 6 * 60 * 60 * 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

// ESPN slot abbreviation → fantasy position.
const SLOT_TO_POS: Record<string, string> = {
  QB: 'QB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', PK: 'K',
  LDE: 'DL', RDE: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', LDT: 'DL', RDT: 'DL',
  WLB: 'LB', SLB: 'LB', MLB: 'LB', LILB: 'LB', RILB: 'LB', LOLB: 'LB', ROLB: 'LB', ILB: 'LB', OLB: 'LB', LB: 'LB',
  LCB: 'DB', RCB: 'DB', CB: 'DB', NB: 'DB', FS: 'DB', SS: 'DB', S: 'DB', DB: 'DB',
};

function normName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '')
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function espn(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'FantasyWarRoom/1.0', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('espn ' + r.status + ' ' + url);
  return r.json();
}

async function buildSnapshot(): Promise<Record<string, { pos: string; rank: number }>> {
  const season = new Date().getUTCMonth() >= 2 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1;
  const teamsDoc = await espn('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams');
  const teams = (teamsDoc?.sports?.[0]?.leagues?.[0]?.teams || [])
    .map((t: any) => ({ id: String(t.team.id), abbr: String(t.team.abbreviation || '').toUpperCase() }))
    .filter((t: any) => t.id && t.abbr);

  const roles: Record<string, { pos: string; rank: number }> = {};
  // Modest parallelism — ESPN is fine with it and the whole build stays ~5s.
  const chunk = 8;
  for (let i = 0; i < teams.length; i += chunk) {
    await Promise.all(teams.slice(i, i + chunk).map(async (team: any) => {
      try {
        const [rosterDoc, depthDoc] = await Promise.all([
          espn('https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/' + team.id + '/roster'),
          espn('https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/' + season + '/teams/' + team.id + '/depthcharts'),
        ]);
        const nameById: Record<string, string> = {};
        for (const grp of rosterDoc?.athletes || []) {
          for (const a of grp?.items || []) {
            if (a?.id && a?.displayName) nameById[String(a.id)] = a.displayName;
          }
        }
        for (const grp of depthDoc?.items || []) {
          const positions = grp?.positions || {};
          for (const key of Object.keys(positions)) {
            const slot = positions[key];
            const abbr = String(slot?.position?.abbreviation || key).toUpperCase();
            const pos = SLOT_TO_POS[abbr];
            if (!pos) continue; // OL / returner / long-snapper slots
            for (const entry of slot?.athletes || []) {
              const rank = Number(entry?.rank) || 99;
              const ref = String(entry?.athlete?.$ref || '');
              const aid = ref.split('/').pop()?.split('?')[0] || '';
              const nm = nameById[aid];
              if (!nm) continue;
              const k = team.abbr + '|' + normName(nm);
              // Keep the BEST (lowest) rank; prefer same-position ranks so a
              // TE moonlighting at FB doesn't overwrite his real TE rank.
              const prev = roles[k];
              if (!prev || rank < prev.rank) roles[k] = { pos, rank };
            }
          }
        }
      } catch (e) {
        console.warn('[depth-charts] team failed', team.abbr, String(e).slice(0, 120));
      }
    }));
  }
  return roles;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  try {
    const { data: cached } = await admin
      .from('ai_response_cache')
      .select('analysis, created_at, expires_at')
      .eq('cache_key', CACHE_KEY)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (cached && typeof cached.analysis === 'string' && cached.analysis.length > 2) {
      return new Response(cached.analysis, { headers: { ...CORS, 'Cache-Control': 'public, max-age=1800' } });
    }

    const roles = await buildSnapshot();
    const teamCount = new Set(Object.keys(roles).map((k) => k.split('|')[0])).size;
    const payload = JSON.stringify({ builtAt: new Date().toISOString(), teams: teamCount, roles });

    // A build that lost most teams is worse than a stale cache — keep serving
    // the old snapshot rather than blinding every client.
    if (teamCount >= 24) {
      await admin.from('ai_response_cache').upsert({
        cache_key: CACHE_KEY,
        type: 'nfl_roles',
        league_id: null,
        model: 'espn',
        analysis: payload,
        expires_at: new Date(Date.now() + TTL_MS).toISOString(),
      });
      return new Response(payload, { headers: { ...CORS, 'Cache-Control': 'public, max-age=1800' } });
    }

    // Thin build — fall back to the most recent snapshot even if expired.
    const { data: stale } = await admin
      .from('ai_response_cache')
      .select('analysis')
      .eq('cache_key', CACHE_KEY)
      .maybeSingle();
    if (stale && typeof stale.analysis === 'string' && stale.analysis.length > 2) {
      return new Response(stale.analysis, { headers: { ...CORS, 'Cache-Control': 'public, max-age=600' } });
    }
    return new Response(payload, { headers: { ...CORS, 'Cache-Control': 'public, max-age=600' } });
  } catch (err) {
    console.error('nfl-depth-charts error:', err);
    return new Response(JSON.stringify({ builtAt: null, roles: {} }), { status: 200, headers: CORS });
  }
});

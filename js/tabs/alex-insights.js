// ══════════════════════════════════════════════════════════════════
// js/tabs/alex-insights.js — AlexInsightsTab: personalized pattern
// recognition & performance analytics. "Option A" placement: new
// top-level tab with sub-tabs Overview / Patterns / Decision History
// / Model Settings.
//
// Depends on: window.WR.* primitives (wr-primitives.js),
//             window.App.LI (playerScores, tradeHistory, draftOutcomes, championships),
//             window.S (transactions, rosters, matchups, leagueUsers).
// Exposes:    window.AlexInsightsTab
// ══════════════════════════════════════════════════════════════════

(function () {
    const h = React.createElement;
    const { useState, useEffect } = React;

    // ── Settings access ───────────────────────────────────────────
    // Delegates to window.WR.AlexSettings so every Alex surface shares
    // the same tuning. Falls back to a safe inline default if the helper
    // hasn't loaded yet (e.g., script-order edge case).
    const DEFAULT_SETTINGS = (window.WR?.AlexSettings?.DEFAULTS) || {
        alertThreshold: 70, maxAlertsPerWeek: 6, minPointsDelta: 2.5, tradeAggression: 50,
        focus: { startSit: true, trades: true, waivers: true, draft: true, injury: false, streaming: false, gmStyle: false },
        channel: { inApp: true, email: false, push: false },
    };
    function loadSettings() { return window.WR?.AlexSettings?.get?.() || { ...DEFAULT_SETTINGS }; }
    function saveSettings(s) {
        if (window.WR?.AlexSettings?.save) window.WR.AlexSettings.save(s);
        else try { localStorage.setItem('wr_alex_settings', JSON.stringify(s)); } catch (_) {}
    }

    // ── KPI computations ──────────────────────────────────────────
    // Best-effort from data already in window.App.LI / window.S. Fields
    // we don't have yet return null so the tile shows a dash.
    function computeKpis({ myRoster, currentLeague, playersData }) {
        const LI = window.App?.LI || {};
        const myRid = myRoster?.roster_id;

        // Trade success: net DHQ delta across all trades I was part of.
        let tradeNetDhq = 0, tradeCount = 0;
        (LI.tradeHistory || []).forEach(t => {
            if (!t.sides || !t.sides[myRid]) return;
            tradeCount++;
            const myIn = (t.sides[myRid].players || []).reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
            // Sum of what I gave — players on the OTHER side(s)
            let myOut = 0;
            Object.entries(t.sides).forEach(([rid, side]) => {
                if (String(rid) === String(myRid)) return;
                (side.players || []).forEach(pid => { myOut += LI.playerScores?.[pid] || 0; });
            });
            tradeNetDhq += (myIn - myOut);
        });

        // Waiver hit rate: % of waiver/FA adds still on my roster.
        const txns = [];
        const txnMap = window.S?.transactions || {};
        if (txnMap && typeof txnMap === 'object' && !Array.isArray(txnMap)) {
            Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) txns.push(...arr); });
        }
        const myPlayers = new Set(myRoster?.players || []);
        let waiverTotal = 0, waiverKept = 0;
        txns.forEach(t => {
            if (t.type !== 'waiver' && t.type !== 'free_agent') return;
            if (!t.adds) return;
            Object.entries(t.adds).forEach(([pid, rid]) => {
                if (String(rid) !== String(myRid)) return;
                waiverTotal++;
                if (myPlayers.has(pid)) waiverKept++;
            });
        });
        const waiverHitPct = waiverTotal > 0 ? Math.round((waiverKept / waiverTotal) * 100) : null;

        // Draft hit rate: % of my drafted players now worth ≥3000 DHQ (contributor threshold).
        const draftPicks = (LI.draftOutcomes || []).filter(d => String(d.roster_id) === String(myRid));
        let draftHits = 0;
        draftPicks.forEach(d => {
            const dhq = LI.playerScores?.[d.pid] || 0;
            if (dhq >= 3000) draftHits++;
        });
        const draftHitPct = draftPicks.length > 0 ? Math.round((draftHits / draftPicks.length) * 100) : null;

        // Best decision type: whichever hit rate is highest and has a sample.
        const candidates = [
            { label: 'TRADES',  pct: tradeCount >= 3 && tradeNetDhq > 0 ? 100 : (tradeCount >= 1 ? (tradeNetDhq > 0 ? 65 : 40) : null) },
            { label: 'WAIVERS', pct: waiverHitPct },
            { label: 'DRAFT',   pct: draftHitPct },
        ].filter(c => c.pct != null).sort((a, b) => b.pct - a.pct);
        const best = candidates[0];

        // GM Grade — composite 0-100 score across the dimensions we DO have.
        // Trade ROI: anchor at 50, +/- 10 points per 1k DHQ swing (capped 0-100).
        // Waiver hit% and draft hit% feed in directly. Sample-size gating keeps
        // a single trade from yielding "A+".
        const tradeScore = tradeCount >= 3
            ? Math.max(0, Math.min(100, 50 + (tradeNetDhq / 1000) * 10))
            : null;
        const components = [tradeScore, waiverHitPct, draftHitPct].filter(v => v != null);
        const gmScoreNum = components.length
            ? Math.round(components.reduce((s, v) => s + v, 0) / components.length)
            : null;

        return {
            gmScore: gmScoreNum,
            gmScoreSample: components.length, // how many dimensions fed the score
            tradeNetDhq,
            tradeCount,
            waiverHitPct,
            waiverKept,
            waiverTotal,
            draftHitPct,
            draftHits,
            draftTotal: draftPicks.length,
            bestType: best ? best.label : null,
            bestPct: best ? best.pct : null,
        };
    }

    function gmGradeLetter(score) {
        if (score == null) return '\u2014';
        if (score >= 90) return 'A+';
        if (score >= 80) return 'A';
        if (score >= 70) return 'B+';
        if (score >= 60) return 'B';
        if (score >= 50) return 'C+';
        if (score >= 40) return 'C';
        if (score >= 30) return 'D';
        return 'F';
    }
    function gmGradeTone(score) {
        if (score == null) return 'mute';
        if (score >= 70) return 'win';
        if (score >= 50) return 'gold';
        return 'loss';
    }

    // ── Insight generation ────────────────────────────────────────
    // Each heuristic returns a card-compatible object or pushes nothing.
    // All carry a `focus` tag so WR.AlexSettings.filterInsights can hide
    // them when the user disables that focus area. Confidence values are
    // calibrated so the alert-threshold slider reads intuitively.
    function computeInsights(props, kpis) {
        const { myRoster, currentLeague, playersData } = props;
        const LI = window.App?.LI || {};
        const myRid = myRoster?.roster_id;
        const out = [];
        const rosterCount = (currentLeague?.rosters || []).length || 12;
        // Position peak-age windows (e.g. RB peak ≈ 24-26). Lazy-loaded by ReconAI;
        // fall back to an empty object so default [24, 29] kicks in.
        const peaks = (window.App && window.App.peakWindows) || {};

        // ── Trades ────────────────────────────────────────────────
        const allTrades = LI.tradeHistory || [];
        const leagueTradeAvg = allTrades.length / Math.max(1, rosterCount) * 2;
        if (kpis.tradeCount != null && leagueTradeAvg > 0 && kpis.tradeCount < leagueTradeAvg * 0.5) {
            out.push({
                focus: 'trades', severity: 'opportunity', confidence: 78,
                title: 'You trade less than half as often as your league',
                body: 'You\u2019ve been part of ' + kpis.tradeCount + ' trade' + (kpis.tradeCount === 1 ? '' : 's') + ' vs. a league average of ~' + Math.round(leagueTradeAvg) + '. Your analytical style tends to translate into good trades \u2014 you\u2019re leaving value on the table.',
                ctaLabel: 'Explore trade targets',
            });
        }
        if (kpis.tradeCount >= 3 && kpis.tradeNetDhq > 0) {
            out.push({
                focus: 'trades', severity: 'edge', confidence: 84,
                title: 'Your trades net +' + (kpis.tradeNetDhq / 1000).toFixed(1) + 'k DHQ across ' + kpis.tradeCount + ' deals',
                body: 'You\u2019re a net winner on trade value. Keep hunting deals \u2014 this is your highest-ROI activity.',
                ctaLabel: 'Continue & scale',
            });
        }
        if (kpis.tradeCount >= 3 && kpis.tradeNetDhq < -1000) {
            out.push({
                focus: 'trades', severity: 'warning', confidence: 82,
                title: 'Your trades are net -' + Math.abs(Math.round(kpis.tradeNetDhq / 1000)) + 'k DHQ',
                body: 'Across ' + kpis.tradeCount + ' trades you\u2019re giving up more value than you receive. Run proposals through Trade Center\u2019s analyzer before accepting.',
                ctaLabel: 'Review trade history',
            });
        }
        // NEW: Trade partner diversity (concentration OR notable breadth)
        if (kpis.tradeCount >= 4 && myRid != null) {
            const partnerCounts = {};
            allTrades.forEach(t => {
                if (!t.sides || !t.sides[myRid]) return;
                Object.keys(t.sides).forEach(rid => {
                    if (String(rid) !== String(myRid)) partnerCounts[rid] = (partnerCounts[rid] || 0) + 1;
                });
            });
            const partners = Object.entries(partnerCounts).sort((a, b) => b[1] - a[1]);
            const top2Share = partners.length ? (partners.slice(0, 2).reduce((s, p) => s + p[1], 0) / kpis.tradeCount) : 0;
            if (top2Share >= 0.6 && partners.length >= 3) {
                out.push({
                    focus: 'trades', severity: 'pattern', confidence: 72,
                    title: 'Most of your trades go through just 2 managers',
                    body: Math.round(top2Share * 100) + '% of your ' + kpis.tradeCount + ' trades are concentrated with 2 partners out of ' + partners.length + ' total. Broadening the pool opens mismatched-need exchanges that tight partner loops miss.',
                    ctaLabel: 'See all owners',
                });
            } else if (partners.length >= Math.min(10, rosterCount - 2)) {
                out.push({
                    focus: 'trades', severity: 'edge', confidence: 78,
                    title: 'You\u2019ve traded with ' + partners.length + ' different owners',
                    body: 'Broad trade network across ' + kpis.tradeCount + ' deals. You\u2019re reading the whole league, not just a couple of usual suspects \u2014 exactly why your trade DHQ net is positive.',
                    ctaLabel: 'Keep hunting',
                });
            }
        }
        // NEW: Prolific trader flag
        if (kpis.tradeCount >= 30) {
            out.push({
                focus: 'trades', severity: 'edge', confidence: 75,
                title: 'You\u2019re a high-volume trader (' + kpis.tradeCount + ' deals)',
                body: 'Most managers in this league sit under 20. Your activity alone is a signal you read the market differently. Stay disciplined \u2014 volume without net value is churn.',
                ctaLabel: 'Open Trade Center',
            });
        }

        // ── Waivers / FA ──────────────────────────────────────────
        if (kpis.waiverHitPct != null && kpis.waiverHitPct >= 50 && kpis.waiverTotal >= 5) {
            out.push({
                focus: 'waivers', severity: 'edge', confidence: 80,
                title: 'You retain ' + kpis.waiverHitPct + '% of your waiver adds',
                body: 'That\u2019s above league-average stickiness. Your FA targeting instincts are working \u2014 keep adding aggressively at the position-scarcity windows.',
                ctaLabel: 'Continue & scale',
            });
        }
        if (kpis.waiverHitPct != null && kpis.waiverHitPct < 25 && kpis.waiverTotal >= 6) {
            out.push({
                focus: 'waivers', severity: 'pattern', confidence: 78,
                title: 'Your waiver retention rate is ' + kpis.waiverHitPct + '%',
                body: Math.round(kpis.waiverTotal - kpis.waiverKept) + ' of ' + kpis.waiverTotal + ' waiver/FA adds were dropped within weeks. Slow down and run DHQ + tier checks before burning FAAB.',
                ctaLabel: 'Review FAAB log',
            });
        }
        // NEW: FAAB usage pattern
        const myFaab = myRoster?.settings?.waiver_budget_used || 0;
        const budget = currentLeague?.settings?.waiver_budget || 100;
        if (budget > 0) {
            const spentPct = myFaab / budget;
            // Compute league avg spend
            let leagueSpent = 0, managerCount = 0;
            (currentLeague?.rosters || []).forEach(r => {
                if (r.settings?.waiver_budget_used != null) {
                    leagueSpent += r.settings.waiver_budget_used;
                    managerCount++;
                }
            });
            const leagueAvgPct = managerCount > 0 ? (leagueSpent / (managerCount * budget)) : 0;
            if (spentPct < 0.15 && leagueAvgPct > 0.35) {
                out.push({
                    focus: 'waivers', severity: 'opportunity', confidence: 72,
                    title: 'You\u2019re sitting on ' + Math.round((1 - spentPct) * 100) + '% of your FAAB',
                    body: 'League average is ' + Math.round(leagueAvgPct * 100) + '% spent. Unspent FAAB at season end is zero value \u2014 bid aggressively on the 2\u20133 impact adds you\u2019re tracking.',
                    ctaLabel: 'Open Free Agency',
                });
            }
            if (spentPct > 0.85 && (currentLeague?.settings?.waiver_budget > 0)) {
                out.push({
                    focus: 'waivers', severity: 'warning', confidence: 70,
                    title: 'You\u2019ve burned ' + Math.round(spentPct * 100) + '% of your FAAB',
                    body: 'Only $' + Math.round(budget * (1 - spentPct)) + ' left. Playoff-push adds are expensive \u2014 conserve for clear upgrades.',
                    ctaLabel: 'Review waiver log',
                });
            }
        }

        // ── Draft ─────────────────────────────────────────────────
        // Relaxed sample thresholds — users often have 5\u20137 picks visible,
        // not 10+, and still deserve signal when their pattern is clear.
        if (kpis.draftHitPct != null && kpis.draftTotal >= 5 && kpis.draftHitPct < 30) {
            out.push({
                focus: 'draft', severity: 'pattern', confidence: 82,
                title: 'Your draft hit rate (' + kpis.draftHitPct + '%) trails starter caliber',
                body: 'Only ' + kpis.draftHits + ' of ' + kpis.draftTotal + ' drafted players reached contributor DHQ (3000+). Consider leaning harder on DHQ rankings over gut in rounds 1\u20133.',
                ctaLabel: 'Review draft board',
            });
        }
        if (kpis.draftHitPct != null && kpis.draftTotal >= 5 && kpis.draftHitPct >= 55) {
            out.push({
                focus: 'draft', severity: 'edge', confidence: 80,
                title: 'Your drafts hit ' + kpis.draftHitPct + '% \u2014 elite',
                body: kpis.draftHits + '/' + kpis.draftTotal + ' of your picks reached contributor DHQ. You\u2019re outdrafting the league. Prioritize draft capital in any trade.',
                ctaLabel: 'See pick values',
            });
        }
        // NEW: Position bias in drafting — lowered from 8 picks / 45% to 5 picks / 40%.
        const draftPicks = (LI.draftOutcomes || []).filter(d => String(d.roster_id) === String(myRid));
        if (draftPicks.length >= 5) {
            const byPos = {};
            draftPicks.forEach(d => { byPos[d.pos] = (byPos[d.pos] || 0) + 1; });
            const topPos = Object.entries(byPos).sort((a, b) => b[1] - a[1])[0];
            if (topPos && topPos[1] / draftPicks.length >= 0.4) {
                out.push({
                    focus: 'draft', severity: 'pattern', confidence: 74,
                    title: 'You draft ' + topPos[0] + ' ' + Math.round(topPos[1] / draftPicks.length * 100) + '% of the time',
                    body: 'Over ' + draftPicks.length + ' career picks, ' + topPos[1] + ' went to ' + topPos[0] + '. Heavy concentration can starve depth at other positions \u2014 worth checking your roster-construction tier.',
                    ctaLabel: 'Open Roster Analytics',
                });
            }
        }

        // ── GM style / roster ─────────────────────────────────────
        const myPlayers = myRoster?.players || [];
        const totalDhq = myPlayers.reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
        const agingPids = myPlayers.filter(pid => {
            const p = playersData?.[pid]; if (!p) return false;
            const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                ? window.App.getValueWindowEnd(p.position)
                : ((window.App?.peakWindows || {})[p.position] || [24, 29])[1];
            return p.age && p.age > valueEnd;
        });
        const agingDhq = agingPids.reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
        if (totalDhq > 0 && agingDhq / totalDhq > 0.25) {
            out.push({
                focus: 'gmStyle', severity: 'warning', confidence: 91,
	                title: Math.round((agingDhq / totalDhq) * 100) + '% of your roster DHQ is past the value window',
	                body: agingPids.length + ' players are beyond their position\u2019s valuable decline band. Sell windows are closing \u2014 cash in now or commit to a rebuild.',
                ctaLabel: 'See aging assets',
            });
        }
        // Elite concentration — uses the canonical "7000+ DHQ or top-5 at position" rule
        // exposed by ReconAI via window.App.countElitePlayers, falling back to
        // a 7000+ DHQ threshold only when that helper isn't loaded.
        const eliteCount = typeof window.App?.countElitePlayers === 'function'
            ? window.App.countElitePlayers(myPlayers)
            : myPlayers.filter(pid => (LI.playerScores?.[pid] || 0) >= 7000).length;
        if (myPlayers.length >= 10 && eliteCount === 0) {
            out.push({
                focus: 'gmStyle', severity: 'warning', confidence: 85,
                title: 'Your roster has zero elite-tier players',
                body: 'Championship cores are built around 2\u20134 elites (7000+ DHQ or top-5 at their position). Without one, you\u2019re capped at \u201Cgood\u201D \u2014 accumulate picks and flip mid-tier depth for a cornerstone.',
                ctaLabel: 'Find a cornerstone target',
            });
        } else if (eliteCount >= 4) {
            out.push({
                focus: 'gmStyle', severity: 'edge', confidence: 80,
                title: 'You hold ' + eliteCount + ' elite-tier players',
                body: 'Championship-caliber concentration. Protect this core \u2014 prioritize ageing-RB insurance and depth at FLEX before chasing another star.',
                ctaLabel: 'Stabilize lineup',
            });
        }
        // NEW: Rebuild tier + young stud surplus (rebuilder edge)
        const risingPids = myPlayers.filter(pid => {
            const p = playersData?.[pid]; if (!p || !p.age) return false;
            const pk = peaks[p.position] || [24, 29];
            return p.age < pk[0] && (LI.playerScores?.[pid] || 0) >= 4000;
        });
        if (risingPids.length >= 3 && eliteCount < 2) {
            out.push({
                focus: 'gmStyle', severity: 'opportunity', confidence: 76,
                title: 'You\u2019re sitting on ' + risingPids.length + ' rising mid-tier players',
                body: 'Pre-peak players at 4000+ DHQ are your highest-appreciation assets. If you aren\u2019t contending, bundle 2 of them for a proven elite now.',
                ctaLabel: 'Explore consolidation trades',
            });
        }

        // ── Start/Sit — lineup efficiency ────────────────────────
        // Proxy via window.S.matchups: compare actual points vs optimal.
        try {
            const matchups = Array.isArray(window.S?.matchups) ? window.S.matchups : [];
            const mine = matchups.filter(m => m.roster_id === myRid && m.points != null);
            if (mine.length >= 4) {
                // Optimal isn't in the payload, but we can flag low-scoring weeks vs opponents.
                const avg = mine.reduce((s, m) => s + (m.points || 0), 0) / mine.length;
                const lowWeeks = mine.filter(m => (m.points || 0) < avg * 0.75).length;
                if (lowWeeks >= 3) {
                    out.push({
                        focus: 'startSit', severity: 'pattern', confidence: 70,
                        title: lowWeeks + ' of ' + mine.length + ' weeks were 25%+ below your average',
                        body: 'Lineup variance is eating wins. Either volatile plays or frequent start-sit misses. Use the Compare tab\u2019s matchup view to pre-commit starters.',
                        ctaLabel: 'Open Compare',
                    });
                }
            }
        } catch (_) {}

        // ── Injury behavior ──────────────────────────────────────
        const injuredHigh = myPlayers.filter(pid => {
            const p = playersData?.[pid];
            const dhq = LI.playerScores?.[pid] || 0;
            return p?.injury_status && ['IR', 'Out', 'Doubtful'].includes(p.injury_status) && dhq >= 3000;
        });
        if (injuredHigh.length >= 2) {
            out.push({
                focus: 'injury', severity: 'warning', confidence: 73,
                title: injuredHigh.length + ' high-DHQ players are injured',
                body: 'Contributor-tier assets stacked in Out/Doubtful/IR status. Deploy IR slots + hunt short-term-upside replacements before the news breaks league-wide.',
                ctaLabel: 'Open Free Agency',
            });
        }

        // NEW: FAAB restraint while winning on the trade market (gmStyle edge)
        if (budget > 0 && (myFaab / budget) < 0.3 && kpis.tradeCount >= 10 && (kpis.tradeNetDhq || 0) > 0) {
            out.push({
                focus: 'gmStyle', severity: 'edge', confidence: 70,
                title: 'You win value on the trade market without leaning on FAAB',
                body: 'Only ' + Math.round((myFaab / budget) * 100) + '% of your FAAB spent but your trades net +' + Math.round((kpis.tradeNetDhq || 0) / 1000) + 'k DHQ across ' + kpis.tradeCount + ' deals. Trade-first managers tend to beat FAAB-first managers in dynasty \u2014 you\u2019re in the right bucket.',
                ctaLabel: 'Keep trading',
            });
        }

        // ── Streaming K/DEF ──────────────────────────────────────
        const streamables = myPlayers.filter(pid => {
            const p = playersData?.[pid];
            return p && (p.position === 'K' || p.position === 'DEF');
        });
        if (streamables.length === 0 && currentLeague?.settings) {
            out.push({
                focus: 'streaming', severity: 'opportunity', confidence: 60,
                title: 'You don\u2019t roster a K or DEF',
                body: 'Streaming these weekly based on matchup is fine \u2014 just don\u2019t leave the slot empty. Auto-pilot settings may cost you 6\u20138 pts per week.',
                ctaLabel: 'Check Free Agency',
            });
        }

        // Priority-sort (warning → edge → pattern → opportunity).
        const priority = { warning: 0, edge: 1, pattern: 2, opportunity: 3 };
        out.sort((a, b) => (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9));
        return out;
    }

    // ── AI-generated novel insights ───────────────────────────────
    // Asks Alex (via window.dhqAI) to produce 1-2 *novel* behavioral
    // insights that don't overlap with the heuristic pool. Cached for
    // 24h to keep LLM spend reasonable. Result shape is compatible
    // with the heuristic insights so they render in the same card grid.
    const AI_CACHE_KEY = 'wr_alex_ai_insights';
    const AI_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    function getLeagueId(props) {
        return props?.currentLeague?.id || props?.currentLeague?.league_id || window.S?.currentLeagueId || window.S?.currentLeague?.league_id || window.S?.currentLeague?.id || 'global';
    }

    function getAiCacheKey(props) {
        const leagueId = getLeagueId(props);
        const user = window.OD?.getCurrentUsername?.() || window.S?.user?.username || window.S?.user?.display_name || 'anon';
        return AI_CACHE_KEY + ':' + user + ':' + leagueId;
    }

    function loadCachedAiInsights(props) {
        try {
            const raw = JSON.parse(localStorage.getItem(getAiCacheKey(props)) || 'null');
            if (!raw || !raw.ts) return { insights: [], ts: 0 };
            if (Date.now() - raw.ts > AI_CACHE_TTL_MS) return { insights: [], ts: 0 };
            return raw;
        } catch (_) { return { insights: [], ts: 0 }; }
    }
    function saveCachedAiInsights(props, insights) {
        try { localStorage.setItem(getAiCacheKey(props), JSON.stringify({ insights, ts: Date.now() })); } catch (_) {}
    }
    function clearCachedAiInsights(props) { try { localStorage.removeItem(getAiCacheKey(props)); } catch (_) {} }

    async function generateAiInsights({ myRoster, currentLeague, playersData }, kpis, heuristicTitles) {
        const aiFn = typeof window.dhqAI === 'function' ? window.dhqAI : null;
        if (!aiFn) return { error: 'dhqAI not loaded' };

        // Build compact context: KPIs + recent trades + roster snapshot.
        const LI = window.App?.LI || {};
        const topHolds = (myRoster?.players || [])
            .map(pid => ({ pid, dhq: LI.playerScores?.[pid] || 0, name: playersData?.[pid]?.full_name, pos: playersData?.[pid]?.position, age: playersData?.[pid]?.age }))
            .sort((a, b) => b.dhq - a.dhq).slice(0, 6);
        const recentTrades = (LI.tradeHistory || [])
            .filter(t => t.sides && t.sides[myRoster?.roster_id])
            .slice(0, 3)
            .map(t => {
                const mine = (t.sides[myRoster.roster_id].players || []).map(pid => playersData?.[pid]?.full_name || pid).join(', ');
                const partners = Object.entries(t.sides).filter(([rid]) => String(rid) !== String(myRoster.roster_id));
                const theirs = partners.flatMap(([, side]) => (side.players || []).map(pid => playersData?.[pid]?.full_name || pid)).join(', ');
                return '- Traded ' + (mine || 'picks') + ' for ' + (theirs || 'picks');
            }).join('\n');

        const contextLines = [
            'LEAGUE: ' + (currentLeague?.name || 'Dynasty') + ', ' + (currentLeague?.rosters?.length || 12) + ' teams',
            'TRADES: ' + (kpis.tradeCount || 0) + ' completed, net DHQ ' + (kpis.tradeNetDhq > 0 ? '+' : '') + Math.round((kpis.tradeNetDhq || 0) / 1000) + 'k',
            'WAIVERS: ' + (kpis.waiverHitPct != null ? (kpis.waiverHitPct + '% retention over ' + kpis.waiverTotal + ' adds') : 'n/a'),
            'DRAFT: ' + (kpis.draftHitPct != null ? (kpis.draftHitPct + '% hit rate over ' + kpis.draftTotal + ' picks') : 'n/a'),
            'TOP HOLDS: ' + topHolds.map(p => (p.name || p.pid) + ' (' + (p.pos || '?') + ', ' + (p.age || '?') + 'yo, ' + p.dhq + ' DHQ)').join('; '),
            recentTrades ? 'RECENT TRADES:\n' + recentTrades : 'RECENT TRADES: none in view',
            heuristicTitles && heuristicTitles.length ? 'ALREADY SURFACED:\n- ' + heuristicTitles.join('\n- ') : '',
        ].filter(Boolean).join('\n');

        const prompt = [
            'You are Alex, an analytical fantasy-football GM assistant. Generate EXACTLY 2 novel behavioral insights about this manager that are NOT already in the "ALREADY SURFACED" list.',
            'Look for unusual patterns in how they build their roster, manage trades, use waivers, or allocate draft capital. Prefer non-obvious findings over generic ones.',
            '',
            'Return ONLY a JSON array with exactly 2 objects in this exact shape:',
            '[{',
            '  "severity": "warning" | "edge" | "pattern" | "opportunity",',
            '  "confidence": integer 50-95,',
            '  "focus": "trades" | "waivers" | "draft" | "startSit" | "injury" | "streaming" | "gmStyle",',
            '  "title": "short headline, under 80 chars",',
            '  "body": "2 sentences with a specific number or detail",',
            '  "ctaLabel": "action verb phrase, e.g. \'Open Trade Center\'"',
            '}]',
            '',
            'No markdown, no prose, no comments. Just the JSON array.',
        ].join('\n');

        try {
            // Use the existing `strategy-analysis` route — same provider
            // (Gemini Flash), same tier, semantically a strategy read on
            // the user's managerial patterns. Avoids a cross-repo routing
            // change to add a bespoke `alex-insights` type.
            const reply = await aiFn('strategy-analysis', prompt, contextLines);
            if (!reply || typeof reply !== 'string') return { error: 'empty reply' };
            // Tolerate replies wrapped in ```json fences or surrounded by text.
            const match = reply.match(/\[\s*\{[\s\S]*\}\s*\]/);
            if (!match) return { error: 'no JSON array in reply' };
            const parsed = JSON.parse(match[0]);
            if (!Array.isArray(parsed)) return { error: 'reply is not an array' };
            // Validate + normalize
            const cleaned = parsed.filter(x => x && x.severity && x.title).map(x => ({
                severity: String(x.severity).toLowerCase(),
                confidence: Math.max(50, Math.min(95, parseInt(x.confidence) || 70)),
                focus: x.focus || null,
                title: String(x.title).slice(0, 120),
                body: String(x.body || '').slice(0, 400),
                ctaLabel: x.ctaLabel ? String(x.ctaLabel).slice(0, 40) : null,
                isAi: true,
            }));
            return { insights: cleaned };
        } catch (e) {
            return { error: String(e.message || e) };
        }
    }

    // ── Hero ──────────────────────────────────────────────────────
    function Hero({ active }) {
        return h('div', { className: 'wr-module-strip' },
            h('div', { className: 'wr-module-context' },
                h('span', null, 'Office'),
                h('strong', null, 'GM\'s Office'),
                h('em', null, 'Strategy, alerts, weekly reads, and recommendation history.')
            ),
            h('div', {
                className: 'wr-module-actions'
            },
                h('span', {
                    className: 'wr-module-pill',
                    style: active ? { color: 'var(--good)', borderColor: 'rgba(46,204,113,0.35)', background: 'rgba(46,204,113,0.08)' } : null
                }, active ? 'Alex Active' : 'Alex Idle')
            )
        );
    }

    // ── Sub-tab row ───────────────────────────────────────────────
    function SubTabs({ value, onChange, tabs }) {
        return h('div', { className: 'wr-module-nav', style: { margin: '0 0 16px' } },
            tabs.map(t => h('button', {
                key: t.k,
                className: value === t.k ? 'is-active' : '',
                onClick: () => onChange(t.k),
            }, t.label))
        );
    }

    // ── Overview sub-tab ──────────────────────────────────────────
    function OverviewView({ kpis, insights, props }) {
        const Kpi = window.WR.Kpi;
        const InsightCard = window.WR.InsightCard;
        const fmtK = (n) => n == null ? null : ((n > 0 ? '+' : '') + (n / 1000).toFixed(1) + 'k');

        // AI-generated insights — separate from heuristic insights, cached
        // for 24h, tagged with isAi so the card badge can distinguish them.
        const [aiState, setAiState] = useState(() => loadCachedAiInsights(props));
        const [aiLoading, setAiLoading] = useState(false);
        const [aiError, setAiError] = useState(null);
        const aiInsights = (aiState?.insights || []).filter(x => !window.WR?.AlexSettings || window.WR.AlexSettings.shouldShow(x));
        const merged = [...insights, ...aiInsights];

        useEffect(() => {
            setAiState(loadCachedAiInsights(props));
            setAiError(null);
        }, [props?.currentLeague?.id, props?.currentLeague?.league_id]);

        const doGenerate = async () => {
            setAiLoading(true); setAiError(null);
            const titles = insights.map(i => i.title);
            const r = await generateAiInsights(props, kpis, titles);
            setAiLoading(false);
            if (r.error) { setAiError(r.error); return; }
            setAiState({ insights: r.insights, ts: Date.now() });
            saveCachedAiInsights(props, r.insights);
        };
        const doClear = () => { clearCachedAiInsights(props); setAiState({ insights: [], ts: 0 }); };

        const cacheAge = aiState?.ts ? Math.round((Date.now() - aiState.ts) / 60000) : null;

        return h(React.Fragment, null,
            h('div', { className: 'gm-office-kpi-grid' },
                h(Kpi, {
                    label: 'GM Grade',
                    value: gmGradeLetter(kpis.gmScore),
                    tone: gmGradeTone(kpis.gmScore),
                    sub: kpis.gmScore != null
                        ? (kpis.gmScore + '/100 \u00B7 ' + kpis.gmScoreSample + '-dim composite')
                        : 'Need more decision history',
                }),
                h(Kpi, {
                    label: 'Trade Net DHQ',
                    value: fmtK(kpis.tradeNetDhq) || '\u2014',
                    tone: kpis.tradeNetDhq > 0 ? 'win' : kpis.tradeNetDhq < 0 ? 'loss' : 'plain',
                    sub: (kpis.tradeCount || 0) + ' trade' + (kpis.tradeCount === 1 ? '' : 's'),
                }),
                h(Kpi, {
                    label: 'Waiver Hit Rate',
                    value: kpis.waiverHitPct != null ? (kpis.waiverHitPct + '%') : '\u2014',
                    tone: kpis.waiverHitPct >= 50 ? 'win' : kpis.waiverHitPct >= 30 ? 'gold' : 'mute',
                    sub: kpis.waiverTotal ? (kpis.waiverKept + '/' + kpis.waiverTotal + ' kept') : 'No waiver history yet',
                }),
                h(Kpi, {
                    label: 'Best Decision Type',
                    value: kpis.bestType || '\u2014',
                    tone: 'gold',
                    sub: kpis.bestPct != null ? (kpis.bestPct + '% positive rate') : 'Need more data',
                })
            ),
            h('div', { className: 'gm-office-section-head' },
                h('h2', null, 'Behavioral Analysis'),
                h('span', { className: 'gm-office-section-meta' },
                    '\u2014 ' + merged.length + ' insight' + (merged.length === 1 ? '' : 's') + (aiInsights.length ? ' (' + aiInsights.length + ' AI)' : '')),
                // Spacer pushes the AI controls to the right
                h('div', { className: 'gm-office-spacer' }),
                h('button', {
                    onClick: doGenerate,
                    disabled: aiLoading,
                    style: {
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '6px 12px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 600,
                        fontFamily: 'DM Sans, sans-serif',
                        background: aiLoading ? 'rgba(124,107,248,0.08)' : 'rgba(124,107,248,0.12)',
                        border: '1px solid rgba(124,107,248,0.35)',
                        color: '#9b8afb',
                        cursor: aiLoading ? 'wait' : 'pointer',
                        opacity: aiLoading ? 0.7 : 1,
                    }
                }, '\u2728 ', aiLoading ? 'Thinking…' : (aiInsights.length ? 'Regenerate AI insights' : 'Generate with Alex')),
                aiInsights.length > 0 && h('button', {
                    onClick: doClear,
                    style: {
                        padding: '6px 10px', borderRadius: '6px', fontSize: '0.7rem',
                        fontFamily: 'DM Sans, sans-serif', background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.08)', color: 'var(--silver)',
                        cursor: 'pointer',
                    }
                }, 'Clear AI'),
                aiInsights.length > 0 && cacheAge != null && h('span', { style: { fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.5, fontFamily: 'JetBrains Mono, monospace' } },
                    cacheAge < 1 ? 'just now' : cacheAge < 60 ? cacheAge + 'm ago' : Math.floor(cacheAge / 60) + 'h ago')
            ),
            aiError && h('div', { style: { padding: '10px 14px', marginBottom: '12px', background: 'rgba(231,76,60,0.08)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '6px', fontSize: '0.78rem', color: '#E74C3C' } },
                'Alex couldn\u2019t generate insights: ', aiError),
            merged.length === 0
                ? h(window.WR.Card, { padding: '24px' },
                    h('div', { style: { fontSize: '0.86rem', color: 'var(--silver)', opacity: 0.7, lineHeight: 1.55, textAlign: 'center' } },
                        'No behavioral patterns detected yet. Alex needs a bit of trade / waiver / draft history before it can speak confidently.')
                )
                : h('div', { className: 'gm-office-insight-grid' },
                    merged.map((ins, i) => h('div', { key: i, style: { position: 'relative' } },
                        h(InsightCard, ins),
                        ins.isAi && h('div', { style: { position: 'absolute', top: 10, right: 10, fontFamily: 'JetBrains Mono, monospace', fontSize: '0.52rem', fontWeight: 700, letterSpacing: '0.12em', padding: '2px 6px', borderRadius: '4px', background: 'rgba(124,107,248,0.2)', color: '#9b8afb', border: '1px solid rgba(124,107,248,0.4)' } }, '\u2728 AI')
                    ))
                )
        );
    }

    // ── Patterns sub-tab ──────────────────────────────────────────
    // Deep-dive charts over the user's managerial history. Every panel
    // is computed from window.App.LI + window.S, with soft-fail empty
    // states when a panel's data source is thin.
    function PatternsView({ props }) {
        const { myRoster, currentLeague, playersData } = props || {};
        const LI = window.App?.LI || {};
        const myRid = myRoster?.roster_id;
        const Card = window.WR.Card;

        // ── Data prep ──
        const myTrades = (LI.tradeHistory || []).filter(t => t.sides && t.sides[myRid]);
        const partners = (() => {
            const counts = {}; const nets = {};
            myTrades.forEach(t => {
                const myIn = (t.sides[myRid].players || []).reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
                Object.entries(t.sides).forEach(([rid, side]) => {
                    if (String(rid) === String(myRid)) return;
                    counts[rid] = (counts[rid] || 0) + 1;
                    const theirGive = (side.players || []).reduce((s, pid) => s + (LI.playerScores?.[pid] || 0), 0);
                    nets[rid] = (nets[rid] || 0) + (myIn - theirGive) / Object.keys(t.sides).filter(r => String(r) !== String(myRid)).length;
                });
            });
            const rosters = currentLeague?.rosters || [];
            const users = currentLeague?.users || window.S?.leagueUsers || [];
            return Object.entries(counts).map(([rid, count]) => {
                const r = rosters.find(x => String(x.roster_id) === rid);
                const u = users.find(x => x.user_id === r?.owner_id);
                return { rid, count, net: Math.round(nets[rid] || 0), name: u?.display_name || u?.metadata?.team_name || ('T' + rid) };
            }).sort((a, b) => b.count - a.count);
        })();

        const draftPicks = (LI.draftOutcomes || []).filter(d => String(d.roster_id) === String(myRid));
        const draftByRound = (() => {
            const rounds = {};
            draftPicks.forEach(d => {
                const r = d.round || 0;
                if (!rounds[r]) rounds[r] = { total: 0, hits: 0 };
                rounds[r].total++;
                if ((LI.playerScores?.[d.pid] || 0) >= 3000) rounds[r].hits++;
            });
            return Object.entries(rounds).map(([r, v]) => ({ round: Number(r), ...v, rate: v.total ? Math.round(v.hits / v.total * 100) : 0 })).sort((a, b) => a.round - b.round);
        })();
        const draftByPos = (() => {
            const pos = {};
            draftPicks.forEach(d => {
                if (!pos[d.pos]) pos[d.pos] = { total: 0, hits: 0 };
                pos[d.pos].total++;
                if ((LI.playerScores?.[d.pid] || 0) >= 3000) pos[d.pos].hits++;
            });
            return Object.entries(pos).map(([p, v]) => ({ pos: p, ...v, rate: v.total ? Math.round(v.hits / v.total * 100) : 0 })).sort((a, b) => b.total - a.total);
        })();

        const myPlayers = myRoster?.players || [];
        const rosterByPos = (() => {
            const pos = {};
            myPlayers.forEach(pid => {
                const p = playersData?.[pid]; if (!p) return;
                const ps = p.position || 'UNK';
                if (!pos[ps]) pos[ps] = { count: 0, dhq: 0 };
                pos[ps].count++;
                pos[ps].dhq += LI.playerScores?.[pid] || 0;
            });
            const totalDhq = Object.values(pos).reduce((s, x) => s + x.dhq, 0);
            return Object.entries(pos).map(([p, v]) => ({ pos: p, ...v, pct: totalDhq ? v.dhq / totalDhq : 0 })).sort((a, b) => b.dhq - a.dhq);
        })();

        const txns = (() => {
            const arr = []; const txnMap = window.S?.transactions || {};
            if (txnMap && typeof txnMap === 'object' && !Array.isArray(txnMap)) Object.values(txnMap).forEach(a => { if (Array.isArray(a)) arr.push(...a); });
            return arr;
        })();
        const myTxns = txns.filter(t => {
            const inAdds = t.adds && Object.values(t.adds).some(r => String(r) === String(myRid));
            const inDrops = t.drops && Object.values(t.drops).some(r => String(r) === String(myRid));
            return inAdds || inDrops;
        });
        const txnByWeek = (() => {
            const wk = {};
            myTxns.forEach(t => { const w = t.leg || t.week || 0; if (!w) return; wk[w] = (wk[w] || 0) + 1; });
            return Object.entries(wk).map(([w, c]) => ({ week: Number(w), count: c })).sort((a, b) => a.week - b.week);
        })();

        // ── Chart primitives ──
        const POS_COLORS = window.App?.POS_COLORS || {};
        const posColor = (p) => POS_COLORS[p] || '#D0D0D0';

        const HBar = ({ label, labelColor, value, max, valStr, barColor, rightText }) =>
            h('div', { style: { display: 'grid', gridTemplateColumns: '110px 1fr 60px', gap: '10px', alignItems: 'center', marginBottom: '6px' } },
                h('div', { style: { fontSize: '0.76rem', color: labelColor || 'var(--silver)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, label),
                h('div', { style: { height: '10px', background: 'rgba(255,255,255,0.04)', borderRadius: '3px', overflow: 'hidden', position: 'relative' } },
                    h('div', { style: { width: Math.max(0, Math.min(100, (value / max) * 100)) + '%', height: '100%', background: barColor || 'var(--gold)', borderRadius: '3px', transition: 'width 0.2s' } })
                ),
                h('div', { style: { fontSize: '0.74rem', fontFamily: 'JetBrains Mono, monospace', color: rightText || 'var(--silver)', textAlign: 'right', fontWeight: 700 } }, valStr)
            );

        // Panel wraps each chart with its title + Alex-voiced interpretation.
        // `interpretation` is the differentiator vs. Analytics: the same data
        // is there, but here Alex tells you what it *means* for your play.
        const Panel = ({ title, subtitle, interpretation, interpColor, children, empty }) => h(Card, { padding: '18px 20px', style: { marginBottom: '12px' } },
            h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: interpretation ? '8px' : '14px' } },
                h('h3', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', fontWeight: 700, margin: 0, letterSpacing: 0 } }, title),
                subtitle && h('span', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6, fontFamily: 'JetBrains Mono, monospace' } }, '\u2014 ' + subtitle)
            ),
            interpretation && h('div', {
                style: {
                    display: 'flex', alignItems: 'flex-start', gap: '8px',
                    marginBottom: '14px', padding: '8px 10px',
                    background: 'rgba(212,175,55,0.04)',
                    borderLeft: '2px solid ' + (interpColor || 'rgba(212,175,55,0.5)'),
                    borderRadius: '0 5px 5px 0',
                    fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.92, lineHeight: 1.5,
                }
            },
                h('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.64rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0, paddingTop: '2px' } }, 'Alex'),
                h('span', null, interpretation)
            ),
            empty
                ? h('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6, padding: '12px 0', fontStyle: 'italic' } }, empty)
                : children
        );

        // ── Alex interpretations (computed from data) ──
        const tradePartnersInterp = (() => {
            if (!partners.length) return null;
            const top = partners[0];
            const top2Share = partners.slice(0, 2).reduce((s, p) => s + p.count, 0) / Math.max(1, myTrades.length);
            if (partners.length >= 10 && top2Share < 0.5) {
                return 'Broad network across ' + partners.length + ' partners \u2014 you engage the whole league. ' + top.name + ' is your most frequent dance partner at ' + top.count + ' deals.';
            }
            if (top2Share >= 0.6) {
                return 'Concentrated network \u2014 ' + Math.round(top2Share * 100) + '% of your trades go through 2 managers. Worth broadening; mismatched needs live on the periphery.';
            }
            return 'Balanced spread across ' + partners.length + ' partners. ' + top.name + ' is your most frequent counter at ' + top.count + ' deals.';
        })();

        const tradeValueInterp = (() => {
            if (!partners.length) return null;
            const winners = partners.filter(p => p.net > 0);
            const losers = partners.filter(p => p.net < 0);
            const biggestLoser = losers.length ? losers.reduce((a, b) => Math.abs(a.net) > Math.abs(b.net) ? a : b) : null;
            const biggestWinner = winners.length ? winners.reduce((a, b) => a.net > b.net ? a : b) : null;
            if (biggestLoser && Math.abs(biggestLoser.net) >= 3000) {
                return 'You profit from ' + winners.length + ' of ' + partners.length + ' partners, but ' + biggestLoser.name + ' has taken you for ' + (biggestLoser.net / 1000).toFixed(1) + 'k DHQ. Run their next proposal through Trade Center\u2019s analyzer before you reply.';
            }
            if (biggestWinner && winners.length >= partners.length / 2) {
                return biggestWinner.name + ' has been your most profitable mark (+' + (biggestWinner.net / 1000).toFixed(1) + 'k). Stay on the offer side with them \u2014 your edge is real.';
            }
            return 'Net trade value is scattered. No single partner dominates either direction \u2014 you\u2019re playing the whole market fairly.';
        })();

        const draftHitInterp = (() => {
            if (!draftPicks.length) return null;
            const totalHits = draftPicks.filter(d => (LI.playerScores?.[d.pid] || 0) >= 3000).length;
            const rate = Math.round(totalHits / draftPicks.length * 100);
            if (rate === 0) {
                return 'Zero of your ' + draftPicks.length + ' tracked picks have reached contributor DHQ. Your draft isn\u2019t the engine \u2014 trades are. Consider flipping future rookies for proven veterans.';
            }
            if (rate >= 50) {
                return rate + '% hit rate across ' + draftPicks.length + ' picks \u2014 elite drafting. Hoard picks in trades; they\u2019re compound value in your hands.';
            }
            return rate + '% hit rate over ' + draftPicks.length + ' picks. Middle of the pack \u2014 no clear round stands out as your sweet spot yet.';
        })();

        const draftPosInterp = (() => {
            if (!draftByPos.length) return null;
            const top = draftByPos[0];
            const topPct = Math.round(top.total / draftPicks.length * 100);
            if (topPct >= 40) {
                return 'You lean hard on ' + top.pos + ' in drafts (' + topPct + '% of picks). Either a deliberate roster-construction thesis or a bias \u2014 diversifying next draft is cheap insurance.';
            }
            return 'Position mix is balanced across ' + draftByPos.length + ' spots. No one position dominates your draft board.';
        })();

        const partnerInterpColor = partners.some(p => p.net < -3000) ? '#E74C3C' : '#2ECC71';
        const draftHitInterpColor = draftPicks.length && draftPicks.filter(d => (LI.playerScores?.[d.pid] || 0) >= 3000).length === 0 ? '#E74C3C' : 'var(--gold)';

        // ── Render ──
        const maxPartnerCount = Math.max(1, ...partners.map(p => p.count));
        const maxPartnerAbs = Math.max(1, ...partners.map(p => Math.abs(p.net)));
        const maxDraftTotal = Math.max(1, ...draftByRound.map(r => r.total));
        const maxPosCount = Math.max(1, ...rosterByPos.map(p => p.count));
        const maxWeekCount = Math.max(1, ...txnByWeek.map(w => w.count));

        // Four panels, each narrated by Alex. Roster DHQ allocation and
        // waiver-activity-by-week were removed — both are league-generic
        // data views that fully live in the Analytics tab. These four are
        // all behavior-specific (about how you play, not raw league data).
        return h('div', null,
            h('div', { style: { marginBottom: '14px', padding: '12px 16px', background: 'rgba(124,107,248,0.04)', border: '1px solid rgba(124,107,248,0.15)', borderRadius: 'var(--card-radius, 10px)' } },
                h('div', { style: { fontSize: '0.68rem', color: '#9b8afb', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'Rajdhani, sans-serif' } }, 'How this differs from Analytics'),
                h('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.85, lineHeight: 1.5 } },
                    'Analytics shows raw numbers. Patterns is Alex reading those numbers back to you \u2014 every chart below includes Alex\u2019s take on what it means for your play style.')
            ),
            // Trade partners — volume
            h(Panel, {
                title: 'Trade partners \u2014 who you deal with',
                subtitle: partners.length + ' partner' + (partners.length === 1 ? '' : 's') + ' over ' + myTrades.length + ' trade' + (myTrades.length === 1 ? '' : 's'),
                interpretation: tradePartnersInterp,
                empty: partners.length === 0 ? 'No trade history yet.' : null,
            },
                partners.slice(0, 12).map(p => h(HBar, {
                    key: p.rid,
                    label: p.name,
                    value: p.count,
                    max: maxPartnerCount,
                    valStr: String(p.count),
                    barColor: 'var(--gold)',
                }))
            ),
            // Trade partners — net DHQ (fleecer vs fleeced)
            h(Panel, {
                title: 'Trade value \u2014 who you profit from',
                subtitle: 'Net DHQ per partner; green = you won, red = they won',
                interpretation: tradeValueInterp,
                interpColor: partnerInterpColor,
                empty: partners.length === 0 ? 'No trade history yet.' : null,
            },
                partners.slice(0, 12).map(p => h(HBar, {
                    key: p.rid,
                    label: p.name,
                    value: Math.abs(p.net),
                    max: maxPartnerAbs,
                    valStr: (p.net > 0 ? '+' : '') + (p.net / 1000).toFixed(1) + 'k',
                    barColor: p.net > 0 ? '#2ECC71' : p.net < 0 ? '#E74C3C' : 'var(--silver)',
                    rightText: p.net > 0 ? '#2ECC71' : p.net < 0 ? '#E74C3C' : 'var(--silver)',
                }))
            ),
            // Draft — hit rate by round
            h(Panel, {
                title: 'Draft hit rate by round',
                subtitle: draftPicks.length + ' pick' + (draftPicks.length === 1 ? '' : 's') + ' tracked · contributor threshold 3000 DHQ',
                interpretation: draftHitInterp,
                interpColor: draftHitInterpColor,
                empty: draftPicks.length === 0 ? 'No draft history recorded yet.' : null,
            },
                draftByRound.map(r => h(HBar, {
                    key: r.round,
                    label: 'Round ' + r.round,
                    value: r.hits,
                    max: maxDraftTotal,
                    valStr: r.hits + '/' + r.total + '  ' + r.rate + '%',
                    barColor: r.rate >= 50 ? '#2ECC71' : r.rate >= 25 ? '#F0A500' : '#E74C3C',
                }))
            ),
            // Draft — position mix
            h(Panel, {
                title: 'Draft position mix',
                subtitle: 'Where your picks land',
                interpretation: draftPosInterp,
                empty: draftByPos.length === 0 ? 'No draft history recorded yet.' : null,
            },
                draftByPos.map(p => h(HBar, {
                    key: p.pos,
                    label: p.pos,
                    labelColor: posColor(p.pos),
                    value: p.total,
                    max: maxDraftTotal,
                    valStr: p.total + ' pick' + (p.total === 1 ? '' : 's') + ' \u00B7 ' + p.rate + '% hit',
                    barColor: posColor(p.pos),
                })),
                // Deep-link to the Analytics draft tab for full tabular detail.
                h('div', { style: { marginTop: '12px', paddingTop: '12px', borderTop: '1px solid rgba(255,255,255,0.05)', fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.55 } },
                    'For full roster and waiver data tables, open ',
                    h('a', { href: '#', onClick: e => { e.preventDefault(); props?.setActiveTab?.('analytics'); }, style: { color: 'var(--gold)', textDecoration: 'underline' } }, 'Analytics'), '.')
            )
        );
    }

    // ── Decision History sub-tab ──────────────────────────────────
    // Robust timestamp coercion — Sleeper/DHQ inconsistently mix seconds vs ms.
    function _dhMs(ts) {
        const n = Number(ts) || 0;
        if (!n) return 0;
        return n > 1e12 ? n : n * 1000; // > Sep 2001 in ms means it IS ms
    }
    function _dhDate(ts) {
        const ms = _dhMs(ts);
        if (!ms) return '\u2014';
        return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function _dhMonth(ts) {
        const ms = _dhMs(ts);
        if (!ms) return 'Unknown';
        return new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    }

    function HistoryView({ props }) {
        const leagueId = getLeagueId(props);
        const myRid = props?.myRoster?.roster_id || window.S?.myRosterId;
        const [filter, setFilter] = useState('all'); // 'all' | 'trade' | 'waiver' | 'fa' | 'note'
        const [remoteLog, setRemoteLog] = useState(null);

        useEffect(() => {
            let cancelled = false;
            setRemoteLog(null);
            if (!window.OD?.loadFieldLog) return;
            window.OD.loadFieldLog(leagueId, 80).then(data => {
                if (!cancelled) setRemoteLog(Array.isArray(data) ? data : []);
            }).catch(() => {
                if (!cancelled) setRemoteLog([]);
            });
            return () => { cancelled = true; };
        }, [leagueId]);

        let localLog = [];
        try { localLog = JSON.parse(localStorage.getItem('scout_field_log_v1') || '[]'); } catch (_) {}
        const logById = new Map();
        [...(remoteLog || []), ...localLog].forEach(entry => {
            if (!entry) return;
            if (entry.leagueId && leagueId && String(entry.leagueId) !== String(leagueId)) return;
            const id = entry.id || String(entry.ts || Math.random());
            logById.set(id, { ...entry, kind: 'field-log' });
        });
        const log = Array.from(logById.values()).sort((a, b) => _dhMs(b.ts) - _dhMs(a.ts)).slice(0, 50);

        const txns = [];
        const txnMap = window.S?.transactions || {};
        if (txnMap && typeof txnMap === 'object' && !Array.isArray(txnMap)) {
            Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) txns.push(...arr); });
        }
        // ts stored as the raw upstream value — _dhMs() auto-detects seconds
        // vs ms when rendering, so we don't pre-multiply (which broke dates
        // when LI.tradeHistory's t.ts was already in milliseconds).
        const transactionEvents = txns.filter(t => {
            const addsMe = t.adds && Object.values(t.adds).some(r => String(r) === String(myRid));
            const dropsMe = t.drops && Object.values(t.drops).some(r => String(r) === String(myRid));
            const tradeMe = t.type === 'trade' && (
                (Array.isArray(t.roster_ids) && t.roster_ids.some(r => String(r) === String(myRid))) ||
                (t.sides && Object.keys(t.sides).some(r => String(r) === String(myRid)))
            );
            return addsMe || dropsMe || tradeMe;
        }).map(t => ({ kind: 'transaction', ts: t.created || t.ts || 0, transaction: t }));

        const liTradeEvents = (window.App?.LI?.tradeHistory || [])
            .filter(t => t.sides && t.sides[myRid])
            .map(t => ({ kind: 'transaction', ts: t.ts || 0, transaction: { ...t, type: 'trade', created: t.ts || 0, _fromDHQ: true } }));

        const eventById = new Map();
        [...transactionEvents, ...liTradeEvents].forEach(ev => {
            const t = ev.transaction || {};
            const id = t.transaction_id || t.id || (t.type + ':' + (t.created || t.ts || 0) + ':' + JSON.stringify(t.roster_ids || Object.keys(t.sides || {})));
            eventById.set(id, ev);
        });
        const events = [...log, ...Array.from(eventById.values())].sort((a, b) => _dhMs(b.ts) - _dhMs(a.ts)).slice(0, 50);

        if (remoteLog === null && window.OD?.loadFieldLog && !events.length) {
            return h(window.WR.Card, { padding: '32px' },
                h('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.7 } },
                    'Loading shared decision history...')
            );
        }

        if (!events.length) {
            return h(window.WR.Card, { padding: '32px' },
                h('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.7 } },
                    'No decisions logged yet. Your trades, waivers, and Scout field-log entries will show up here.')
            );
        }

        // ── Helpers for rich row rendering ──
        const playersData = props?.playersData || {};
        const playerScores = window.App?.LI?.playerScores || {};
        function pname(pid) {
            const p = playersData[pid];
            return (p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim() || pid);
        }
        function ppos(pid) { return playersData[pid]?.position || ''; }
        function pdhq(pid) { return playerScores[pid] || 0; }
        function chipText(pid) {
            const dhq = pdhq(pid);
            return pname(pid) + (dhq ? ' (' + (dhq >= 1000 ? (dhq / 1000).toFixed(1) + 'k' : dhq) + ')' : '');
        }
        function classifyKind(ev) {
            if (ev.kind === 'field-log') return 'note';
            const t = ev.transaction || {};
            return t.type === 'trade' ? 'trade' : t.type === 'waiver' ? 'waiver' : 'fa';
        }

        // Filter
        const filtered = filter === 'all' ? events : events.filter(ev => classifyKind(ev) === filter);

        // Counts for the chip strip
        const counts = events.reduce((acc, ev) => { const k = classifyKind(ev); acc[k] = (acc[k] || 0) + 1; return acc; }, {});

        // Group by month
        const groups = [];
        let cur = null;
        filtered.forEach(ev => {
            const m = _dhMonth(ev.ts);
            if (!cur || cur.month !== m) {
                cur = { month: m, items: [] };
                groups.push(cur);
            }
            cur.items.push(ev);
        });

        const filterChip = (key, label) => h('button', {
            key, onClick: () => setFilter(key),
            style: {
                padding: '5px 10px', borderRadius: '999px',
                fontSize: '0.7rem', fontWeight: 600, cursor: 'pointer',
                background: filter === key ? 'rgba(212,175,55,0.15)' : 'transparent',
                border: '1px solid ' + (filter === key ? 'rgba(212,175,55,0.5)' : 'rgba(255,255,255,0.08)'),
                color: filter === key ? 'var(--gold)' : 'var(--silver)',
                fontFamily: 'DM Sans, sans-serif',
            },
        }, label, key !== 'all' && counts[key] != null ? h('span', { style: { marginLeft: '6px', opacity: 0.6, fontFamily: 'JetBrains Mono, monospace' } }, counts[key]) : null);

        function renderRow(ev, i) {
            const date = _dhDate(ev.ts);
            const kind = classifyKind(ev);
            if (ev.kind === 'field-log') {
                return h(window.WR.Card, { key: 'log' + (ev.id || i), padding: '10px 14px' },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
                        h(window.WR.Badge, { label: ev.category || 'note', kind: ev.category || 'note' }),
                        h('div', { style: { flex: 1, minWidth: 0, fontSize: '0.82rem', color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ev.text || 'Logged decision'),
                        h('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 } }, date),
                    )
                );
            }
            const t = ev.transaction || {};
            // For trades, gather adds (what I got) and drops (what I gave)
            let addedPids = [];
            let droppedPids = [];
            if (kind === 'trade') {
                if (t.sides && t.sides[myRid]) {
                    addedPids = (t.sides[myRid].players || []);
                    Object.entries(t.sides).forEach(([rid, side]) => {
                        if (String(rid) === String(myRid)) return;
                        droppedPids = droppedPids.concat(side.players || []);
                    });
                } else if (t.adds || t.drops) {
                    addedPids = Object.keys(t.adds || {}).filter(pid => String(t.adds[pid]) === String(myRid));
                    droppedPids = Object.keys(t.drops || {}).filter(pid => String(t.drops[pid]) === String(myRid));
                }
            } else {
                addedPids = Object.keys(t.adds || {}).filter(pid => String(t.adds[pid]) === String(myRid));
                droppedPids = Object.keys(t.drops || {}).filter(pid => String(t.drops[pid]) === String(myRid));
            }

            // Compute net DHQ for trades
            const myIn = addedPids.reduce((s, pid) => s + pdhq(pid), 0);
            const myOut = droppedPids.reduce((s, pid) => s + pdhq(pid), 0);
            const netDhq = myIn - myOut;
            const netStr = kind === 'trade' && (myIn || myOut) ? ((netDhq >= 0 ? '+' : '') + (Math.abs(netDhq) >= 1000 ? (netDhq / 1000).toFixed(1) + 'k' : Math.round(netDhq)) + ' DHQ') : null;
            const netCol = netDhq > 0 ? '#2ECC71' : netDhq < 0 ? '#E74C3C' : 'var(--silver)';

            const renderChips = (pids, prefix, color) => pids.length === 0 ? null : h('span', { style: { display: 'inline-flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center' } },
                pids.slice(0, 4).map(pid => h('span', {
                    key: pid,
                    style: { fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: color + '12', border: '1px solid ' + color + '33', color: color, fontWeight: 600 },
                }, prefix, chipText(pid))),
                pids.length > 4 ? h('span', { style: { fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.6 } }, '+' + (pids.length - 4)) : null,
            );

            return h(window.WR.Card, { key: 'tx' + i, padding: '10px 14px' },
                h('div', { style: { display: 'grid', gridTemplateColumns: '60px 1fr auto auto', gap: '10px', alignItems: 'center' } },
                    h(window.WR.Badge, { label: kind, kind }),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', minWidth: 0 } },
                        renderChips(addedPids, '+ ', '#2ECC71'),
                        droppedPids.length > 0 && addedPids.length > 0 && h('span', { style: { fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.5, alignSelf: 'center' } }, 'for'),
                        renderChips(droppedPids, '\u2212 ', '#E74C3C'),
                        addedPids.length === 0 && droppedPids.length === 0 && h('span', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6, fontStyle: 'italic' } }, 'No player changes'),
                    ),
                    netStr && h('span', { style: { fontSize: '0.74rem', fontWeight: 700, color: netCol, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 } }, netStr),
                    h('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6, fontFamily: 'JetBrains Mono, monospace', flexShrink: 0 } }, date),
                ),
            );
        }

        return h('div', null,
            // Filter strip
            h('div', { style: { display: 'flex', gap: '6px', marginBottom: '14px', flexWrap: 'wrap', alignItems: 'center' } },
                h('span', { style: { fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.55, fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: '4px' } }, 'Filter:'),
                filterChip('all', 'All ' + events.length),
                counts.trade && filterChip('trade', 'Trades'),
                counts.waiver && filterChip('waiver', 'Waivers'),
                counts.fa && filterChip('fa', 'Free Agency'),
                counts.note && filterChip('note', 'Notes'),
            ),
            filtered.length === 0 ? h(window.WR.Card, { padding: '24px' },
                h('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6, textAlign: 'center' } }, 'No ' + filter + ' history.')
            ) : groups.map((g, gi) => h('div', { key: 'g' + gi, style: { marginBottom: '20px' } },
                h('div', { style: { fontSize: '0.66rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' } },
                    g.month,
                    h('span', { style: { color: 'var(--silver)', opacity: 0.5, fontFamily: 'JetBrains Mono, monospace', fontWeight: 400 } }, g.items.length + ' decision' + (g.items.length === 1 ? '' : 's')),
                ),
                h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                    g.items.map((ev, i) => renderRow(ev, gi * 1000 + i)),
                ),
            )),
        );
    }

    // ── Model Settings sub-tab ────────────────────────────────────
    function SettingsView({ settings, setSettings }) {
        const update = (patch) => { const next = { ...settings, ...patch }; setSettings(next); saveSettings(next); };
        const updateFocus = (k, v) => update({ focus: { ...settings.focus, [k]: v } });
        const updateChannel = (k, v) => update({ channel: { ...settings.channel, [k]: v } });
        const tp = settings.tradePriority || { positions: {}, picks: {}, faab: true };
        const updateTP = (section, k, v) => update({ tradePriority: { ...tp, [section]: { ...tp[section], [k]: v } } });
        const updateTPFaab = (v) => update({ tradePriority: { ...tp, faab: v } });

        const sliderRow = (label, hint, key, min, max, step, format) => h('div', { style: { marginBottom: '18px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' } },
                h('span', { style: { fontSize: '0.82rem', color: 'var(--white)', opacity: 0.88, fontWeight: 600 } }, label),
                h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.88rem', fontWeight: 700, color: 'var(--gold)' } },
                    format ? format(settings[key]) : settings[key])
            ),
            hint && h('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.55, marginBottom: '8px', lineHeight: 1.4 } }, hint),
            h('input', {
                type: 'range', min, max, step: step || 1,
                value: settings[key],
                onChange: e => update({ [key]: Number(e.target.value) }),
                style: { width: '100%', accentColor: '#D4AF37' },
            })
        );

        const focusChip = (k, label) => h('button', {
            key: k, onClick: () => updateFocus(k, !settings.focus[k]),
            style: {
                padding: '6px 12px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                border: '1px solid ' + (settings.focus[k] ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.1)'),
                background: settings.focus[k] ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.02)',
                color: settings.focus[k] ? 'var(--gold)' : 'var(--silver)',
            }
        }, label);
        const chanChip = (k, label) => h('button', {
            key: k, onClick: () => updateChannel(k, !settings.channel[k]),
            style: {
                padding: '6px 12px', borderRadius: '6px', fontSize: '0.74rem', fontWeight: 500,
                cursor: 'pointer', fontFamily: 'DM Sans, sans-serif',
                border: '1px solid ' + (settings.channel[k] ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.1)'),
                background: settings.channel[k] ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.02)',
                color: settings.channel[k] ? 'var(--gold)' : 'var(--silver)',
            }
        }, label);

        const sectionTitle = (label) => h('div', { style: { display: 'flex', alignItems: 'baseline', gap: '8px', margin: '0 0 14px' } },
            h('h3', { style: { fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, fontSize: '1.02rem', margin: 0, letterSpacing: '0.01em', color: 'var(--white)' } }, label.title),
            h('span', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.55, fontFamily: 'JetBrains Mono, monospace' } }, label.sub),
        );

        const presetButton = (label, desc, getPatch) => h('button', {
            onClick: () => { const p = getPatch(); setSettings(p); saveSettings(p); },
            title: desc,
            style: {
                ...presetBtnStyle,
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
                padding: '8px 10px', textAlign: 'left',
            },
        },
            h('span', { style: { fontWeight: 700, color: 'var(--white)' } }, label),
            h('span', { style: { fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.7, fontWeight: 400 } }, desc),
        );

        return h('div', null,
            // Intro card
            h('div', { style: { padding: '12px 16px', marginBottom: '14px', background: 'rgba(124,107,248,0.04)', border: '1px solid rgba(124,107,248,0.15)', borderRadius: 'var(--card-radius, 10px)' } },
                h('div', { style: { fontSize: '0.68rem', color: '#9b8afb', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '4px', fontFamily: 'Rajdhani, sans-serif' } }, 'How Alex talks to you'),
                h('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.85, lineHeight: 1.5 } },
                    'These knobs control which behavioral insights surface in Overview, how confidently Alex needs to be before flagging something, and where you get pinged. Defaults are tuned for active dynasty managers \u2014 use the presets below if you want a different vibe.')
            ),
            h('div', { style: { display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '14px' } },
                h(window.WR.Card, { padding: '20px 22px' },
                    sectionTitle({ title: 'Sensitivity', sub: 'When and how often Alex speaks up' }),
                    sliderRow('Alert threshold', 'Minimum confidence Alex needs before showing an insight. Higher = quieter, only the strong signals.', 'alertThreshold', 0, 100, 1, v => v + '%'),
                    sliderRow('Max alerts per week', 'Caps how many cards Alex shows in Overview. Lower = curated.', 'maxAlertsPerWeek', 1, 20, 1),
                    sliderRow('Min projected-points delta', 'Smallest swing (in projected fantasy points) Alex bothers flagging on lineup or waiver moves.', 'minPointsDelta', 0, 10, 0.5, v => Number(v).toFixed(1) + ' pts'),
                    h('div', { style: { fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.55, marginTop: '4px', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 } }, 'Quick presets'),
                    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' } },
                        presetButton('Conservative', 'Only flag 85%+ confidence \u00B7 ~3 alerts/week',
                            () => ({ ...DEFAULT_SETTINGS, alertThreshold: 85, maxAlertsPerWeek: 3, minPointsDelta: 4 })),
                        presetButton('Balanced', 'Tuned defaults \u00B7 70% threshold \u00B7 ~6 alerts/week',
                            () => ({ ...DEFAULT_SETTINGS })),
                        presetButton('Aggressive', '55% threshold \u00B7 up to 12 alerts/week',
                            () => ({ ...DEFAULT_SETTINGS, alertThreshold: 55, maxAlertsPerWeek: 12, minPointsDelta: 1 })),
                    ),
                ),
                h(window.WR.Card, { padding: '20px 22px' },
                    sectionTitle({ title: 'Focus areas', sub: 'Which categories Alex monitors' }),
                    h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
                        focusChip('startSit', 'Start / Sit'),
                        focusChip('trades', 'Trades'),
                        focusChip('waivers', 'Waivers'),
                        focusChip('draft', 'Draft'),
                        focusChip('injury', 'Injury watch'),
                        focusChip('streaming', 'Streaming'),
                        focusChip('gmStyle', 'GM style')
                    ),
                    h('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6, marginTop: '12px', lineHeight: 1.5 } },
                        'Alex only surfaces insights for active areas. Decision History still logs everything regardless.'),
                    h('div', { style: { marginTop: '20px', paddingTop: '16px', borderTop: '1px solid rgba(255,255,255,0.06)' } },
                        sectionTitle({ title: 'Notifications', sub: 'Where you get pinged' }),
                        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '7px' } },
                            chanChip('inApp', 'In-app'),
                            chanChip('email', 'Email (daily)'),
                            chanChip('push', 'Push'),
                        ),
                        h('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.55, marginTop: '10px', lineHeight: 1.5 } },
                            'In-app shows up as toasts on Home + a count badge on GM\'s Office. Email/Push are coming soon \u2014 toggle to opt in early.'),
                    )
                ),
            ),
            // ── Trade Calculator tuning ──
            h('div', { style: { display: 'grid', gridTemplateColumns: '1.1fr 0.9fr', gap: '14px', marginTop: '14px' } },
                // Left column — Aggression
                h(window.WR.Card, { padding: '20px 22px' },
                    sectionTitle({ title: 'Trade Calculator', sub: 'How aggressive Deal HQ builds packages' }),
                    sliderRow('Trade aggression', 'Controls how wide the value-matching window is when generating packages. Conservative = tight, fair deals. Aggressive = bold moves that might land with the right owner.', 'tradeAggression', 0, 100, 5,
                        v => v <= 20 ? 'Conservative' : v <= 40 ? 'Cautious' : v <= 60 ? 'Balanced' : v <= 80 ? 'Bold' : 'Aggressive'),
                    h('div', { style: { fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.55, marginTop: '4px', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700 } }, 'Quick presets'),
                    h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' } },
                        presetButton('Conservative', 'Tight value · fair only',
                            () => ({ ...settings, tradeAggression: 15 })),
                        presetButton('Balanced', 'Default range',
                            () => ({ ...settings, tradeAggression: 50 })),
                        presetButton('Aggressive', 'Max range · hunt steals',
                            () => ({ ...settings, tradeAggression: 100 })),
                    ),
                ),
                // Right column — Asset Priorities
                h(window.WR.Card, { padding: '20px 22px' },
                    sectionTitle({ title: 'Asset Priorities', sub: 'What Deal HQ targets' }),
                    h('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '14px', lineHeight: 1.45 } },
                        'Active chips tell Deal HQ which assets to prioritize. All positions off = auto-detect from roster needs.'),
                    // Positions
                    h('div', { style: { marginBottom: '16px' } },
                        h('div', { style: { fontSize: '0.66rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px', fontFamily: 'Rajdhani, sans-serif' } }, 'Target Positions'),
                        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                            ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'].map(pos => {
                                const posColors = { QB:'#FF6B6B', RB:'#4ECDC4', WR:'#45B7D1', TE:'#F7DC6F', DL:'#E67E22', LB:'#F0A500', DB:'#5DADE2', K:'#BB8FCE' };
                                const active = tp.positions?.[pos];
                                const c = posColors[pos] || 'var(--silver)';
                                return h('button', {
                                    key: pos, onClick: () => updateTP('positions', pos, !active),
                                    style: {
                                        padding: '5px 12px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700,
                                        cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                                        border: '1px solid ' + (active ? c + '88' : 'rgba(255,255,255,0.1)'),
                                        background: active ? c + '18' : 'rgba(255,255,255,0.02)',
                                        color: active ? c : 'var(--silver)',
                                    }
                                }, pos);
                            })
                        )
                    ),
                    // Draft picks + FAAB side by side
                    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' } },
                        h('div', null,
                            h('div', { style: { fontSize: '0.66rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px', fontFamily: 'Rajdhani, sans-serif' } }, 'Draft Pick Years'),
                            h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                                ['2026', '2027', '2028'].map(yr => {
                                    const active = tp.picks?.[yr];
                                    return h('button', {
                                        key: yr, onClick: () => updateTP('picks', yr, !active),
                                        style: {
                                            padding: '5px 14px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700,
                                            cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                                            border: '1px solid ' + (active ? 'rgba(187,143,206,0.5)' : 'rgba(255,255,255,0.1)'),
                                            background: active ? 'rgba(187,143,206,0.12)' : 'rgba(255,255,255,0.02)',
                                            color: active ? '#BB8FCE' : 'var(--silver)',
                                        }
                                    }, yr);
                                })
                            )
                        ),
                        h('div', null,
                            h('div', { style: { fontSize: '0.66rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px', fontFamily: 'Rajdhani, sans-serif' } }, 'FAAB'),
                            h('button', {
                                onClick: () => updateTPFaab(!tp.faab),
                                style: {
                                    padding: '5px 14px', borderRadius: '6px', fontSize: '0.76rem', fontWeight: 700,
                                    cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace',
                                    border: '1px solid ' + (tp.faab ? 'rgba(46,204,113,0.5)' : 'rgba(255,255,255,0.1)'),
                                    background: tp.faab ? 'rgba(46,204,113,0.12)' : 'rgba(255,255,255,0.02)',
                                    color: tp.faab ? '#2ECC71' : 'var(--silver)',
                                }
                            }, tp.faab ? 'Include' : 'Off'),
                        ),
                    ),
                ),
            ),
        );
    }

    const presetBtnStyle = {
        flex: 1, padding: '7px 10px', borderRadius: '6px',
        fontSize: '0.74rem', fontWeight: 600, cursor: 'pointer',
        background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
        color: 'var(--silver)', fontFamily: 'DM Sans, sans-serif',
    };

    // ── Main component ────────────────────────────────────────────
    function AlexInsightsTab(props) {
        const [subTab, setSubTab] = useState(() => {
            // Priority: explicit prop (used by old tab=strategy URLs) →
            // ?film-sub=… hash arg → last-used sub → 'overview'.
            if (props.initialSubTab) return props.initialSubTab;
            try {
                const m = (window.location.hash || '').match(/[?&]film-sub=([^&]+)/);
                if (m) return m[1];
                return localStorage.getItem('wr_alex_subtab') || 'overview';
            } catch { return 'overview'; }
        });
        useEffect(() => { try { localStorage.setItem('wr_alex_subtab', subTab); } catch {} }, [subTab]);

        const [settings, setSettings] = useState(loadSettings);

        // Keep local state in sync with cross-surface setting changes so
        // Overview filters update when the user tweaks sliders elsewhere.
        useEffect(() => {
            if (!window.WR?.AlexSettings?.subscribe) return;
            return window.WR.AlexSettings.subscribe((next) => setSettings(next || loadSettings()));
        }, []);

        // Safe read of derived data — handle mid-load states
        const kpis = React.useMemo(() => computeKpis(props), [props.myRoster, props.currentLeague, props.timeRecomputeTs]);
        const rawInsights = React.useMemo(() => computeInsights(props, kpis), [kpis, props.myRoster, props.playersData]);
        // Filter through AlexSettings — applies alertThreshold + focus areas + maxAlertsPerWeek.
        const insights = React.useMemo(() => {
            if (window.WR?.AlexSettings?.filterInsights) return window.WR.AlexSettings.filterInsights(rawInsights);
            return rawInsights.slice(0, 6);
        }, [rawInsights, settings]);

        return h('div', { className: 'gm-office-shell wr-fade-in' },
            h(Hero, { active: !!(window.App?.LI_LOADED) }),
            h(SubTabs, {
                value: subTab,
                onChange: setSubTab,
                tabs: [
                    { k: 'overview', label: 'Overview' },
                    { k: 'strategy', label: 'My Strategy' },
                    { k: 'patterns', label: 'Patterns' },
                    { k: 'history', label: 'Decision History' },
                    { k: 'settings', label: 'Model Settings' },
                ]
            }),
            subTab === 'overview' && h(OverviewView, { kpis, insights, props }),
            subTab === 'strategy' && h(StrategySubview, { props }),
            subTab === 'patterns' && h(PatternsView, { props }),
            subTab === 'history' && h(HistoryView, { props }),
            subTab === 'settings' && h(SettingsView, { settings, setSettings })
        );
    }

    // ── Strategy sub-view — embeds the existing StrategyEditorTab ──────
    function StrategySubview({ props }) {
        if (typeof window.StrategyEditorTab !== 'function') {
            return h('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--silver)' } }, 'Strategy editor module not loaded.');
        }
        return React.createElement(window.StrategyEditorTab, {
            currentLeague: props.currentLeague,
            myRoster: props.myRoster,
            playersData: props.playersData,
            gmStrategy: props.gmStrategy,
            setGmStrategy: props.setGmStrategy,
        });
    }

    window.AlexInsightsTab = AlexInsightsTab;
})();

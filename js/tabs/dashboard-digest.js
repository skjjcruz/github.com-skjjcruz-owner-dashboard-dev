// ══════════════════════════════════════════════════════════════════
// dashboard-digest.js — "Alex's Desk" cross-league top insights card
//
// Hub-level ambient AI surface: compact snapshots of every league go to
// the dashboard_digest route (fast tier), which returns at most 3
// decision-relevant insights across the whole portfolio. Two cache
// layers keep this near-free: a 24h localStorage cache here, and the
// server-side ai_response_cache behind it (uncounted against the
// plan's request allowance). An explicit Refresh pays a normal counted
// request via forceRefresh.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    window.WR = window.WR || {};

    const DIGEST_TTL_MS = 24 * 60 * 60 * 1000;

    function hashString(str) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
        return h.toString(36);
    }

    function digestUser() {
        return window.OD?.getCurrentUsername?.() || window.S?.user?.username || 'anon';
    }

    function buildSnapshots(leagues, sleeperUser) {
        return (leagues || []).slice(0, 12).map(l => {
            const myRoster = (l.rosters || []).find(r => r.owner_id === sleeperUser?.user_id);
            const fmt = window.WR?.AIContext?.detectFormat?.(l) || {};
            const waiverBudget = Number(l.settings?.waiver_budget || 0);
            const faabRemaining = waiverBudget > 0 && myRoster?.settings
                ? Math.max(0, waiverBudget - Number(myRoster.settings.waiver_budget_used || 0))
                : null;
            return {
                leagueId: l.id || l.league_id,
                leagueName: l.name,
                record: `${l.wins || 0}-${l.losses || 0}${l.ties > 0 ? '-' + l.ties : ''}`,
                teamCount: (l.rosters || []).length,
                formatFlags: {
                    isSuperFlex: !!fmt.isSuperFlex,
                    isTEP: !!fmt.isTEP,
                    isIDP: !!fmt.isIDP,
                    scoringType: fmt.scoringType || 'std',
                },
                ...(faabRemaining != null ? { faabRemaining } : {}),
            };
        });
    }

    function cacheKeyFor(snapshots) {
        const stateHash = hashString(snapshots.map(s => `${s.leagueId}:${s.record}`).join('|'));
        return { key: `wr_dash_digest:${digestUser()}:${stateHash}`, stateHash };
    }

    function loadCachedDigest(key) {
        try {
            const raw = JSON.parse(localStorage.getItem(key) || 'null');
            if (!raw || !raw.ts || Date.now() - raw.ts > DIGEST_TTL_MS) return null;
            return Array.isArray(raw.insights) ? raw.insights : null;
        } catch (_) { return null; }
    }

    function saveCachedDigest(key, insights) {
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), insights })); } catch (_) {}
    }

    function normalizeInsights(arr) {
        return (arr || []).filter(x => x && x.title).slice(0, 3).map(x => ({
            leagueId: x.leagueId != null ? String(x.leagueId) : null,
            severity: String(x.severity || 'pattern').toLowerCase(),
            title: String(x.title).slice(0, 120),
            body: String(x.body || '').slice(0, 400),
        }));
    }

    function DashboardDigestCard({ leagues, sleeperUser, onSelectLeague }) {
        const React = window.React;
        const h = React.createElement;
        const InsightCard = window.WR.InsightCard;
        const snapshots = React.useMemo(() => buildSnapshots(leagues, sleeperUser), [leagues, sleeperUser]);
        const { key, stateHash } = React.useMemo(() => cacheKeyFor(snapshots), [snapshots]);
        const [state, setState] = React.useState({ status: 'idle', insights: null, error: null });
        const [feedbackGiven, setFeedbackGiven] = React.useState({});

        const generate = React.useCallback(async (force) => {
            setState(prev => ({ ...prev, status: 'loading', error: null }));
            try {
                const context = { leagues: snapshots, stateHash, ...(force ? { forceRefresh: true } : {}) };
                const result = await window.OD.callAI({ type: 'dashboard_digest', context });
                let insights = Array.isArray(result?.insights) ? result.insights : null;
                if (!insights && typeof result?.analysis === 'string') {
                    const match = result.analysis.match(/\[\s*\{[\s\S]*\}\s*\]/);
                    if (match) { try { insights = JSON.parse(match[0]); } catch (_) {} }
                }
                const cleaned = normalizeInsights(insights);
                if (!cleaned.length) { setState({ status: 'error', insights: null, error: 'No insights returned. Try a refresh later.' }); return; }
                saveCachedDigest(key, cleaned);
                setState({ status: 'ready', insights: cleaned, error: null });
            } catch (e) {
                const msg = /limit/i.test(String(e?.message))
                    ? 'Daily AI limit reached — fresh insights return tomorrow.'
                    : (e?.message || 'Could not generate insights right now.');
                setState({ status: 'error', insights: null, error: msg });
            }
        }, [snapshots, stateHash, key]);

        React.useEffect(() => {
            if (!snapshots.length) return;
            const cached = loadCachedDigest(key);
            if (cached && cached.length) { setState({ status: 'ready', insights: cached, error: null }); return; }
            generate(false); // ambient: server-cached + uncounted against request allowance
        }, [key]);

        if (!snapshots.length || typeof window.OD?.callAI !== 'function' || !InsightCard) return null;

        const sendFeedback = (idx, action) => {
            setFeedbackGiven(prev => ({ ...prev, [idx]: action }));
            window.WR?.AIFeedback?.send?.({ leagueId: state.insights?.[idx]?.leagueId || null, surface: 'dashboard_digest', recId: `${stateHash}:${idx}`, action });
        };

        return h('div', { style: { marginBottom: '14px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' } },
                h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase' } }, "✨ Alex's Desk — Top Insights"),
                h('button', {
                    onClick: () => state.status !== 'loading' && generate(true),
                    title: 'Regenerate (uses one AI request)',
                    style: { background: 'none', border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)', padding: '2px 9px', opacity: state.status === 'loading' ? 0.5 : 1 }
                }, state.status === 'loading' ? '…' : 'Refresh')
            ),
            state.status === 'loading' && !state.insights && h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' } }, 'Scanning your leagues for the moves that matter this week…'),
            state.status === 'error' && h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, padding: '6px 2px' } }, state.error),
            state.status === 'ready' && (state.insights || []).map((ins, idx) => {
                const league = (leagues || []).find(l => String(l.id || l.league_id) === String(ins.leagueId));
                return h('div', { key: idx, style: { marginBottom: '8px' } },
                    h(InsightCard, {
                        severity: ins.severity,
                        title: ins.title,
                        body: ins.body,
                        compact: true,
                        ctaLabel: league ? `Open ${league.name}` : null,
                        ctaOnClick: league ? () => onSelectLeague(league) : null,
                    }),
                    h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px', marginTop: '2px' } },
                        feedbackGiven[idx]
                            ? h('span', { style: { fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.5 } }, 'Thanks — Alex learns from this.')
                            : ['up', 'down'].map(action => h('button', {
                                key: action,
                                onClick: () => sendFeedback(idx, action),
                                style: { background: 'none', border: 'none', color: 'var(--silver)', opacity: 0.45, cursor: 'pointer', fontSize: '0.72rem', padding: '0 4px' }
                            }, action === 'up' ? '👍' : '👎'))
                    )
                );
            })
        );
    }

    window.WR.DashboardDigestCard = DashboardDigestCard;
})();

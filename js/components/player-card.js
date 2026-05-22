// ══════════════════════════════════════════════════════════════════
// player-card.js — Unified War Room Player Card (SI-2)
// Replaces window.openFWPlayerModal (ReconAI CDN) as the primary player modal.
// Single entry point: window.WR.openPlayerCard(pid, { context })
// Used by: My Roster, Free Agency, Compare, Draft big boards, Trade Center, Home widgets.
// ══════════════════════════════════════════════════════════════════
(function () {
    const { useState, useEffect, useRef } = React;

    // ── Shared helpers ────────────────────────────────────────────
    function normPos(pos) {
        if (['DE', 'DT', 'NT'].includes(pos)) return 'DL';
        if (['CB', 'S', 'SS', 'FS'].includes(pos)) return 'DB';
        if (['OLB', 'ILB', 'MLB'].includes(pos)) return 'LB';
        return pos || '';
    }

    function playerName(p) {
        return p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim() || '—';
    }

    // Tier comes from DHQ score (same thresholds used in roster table)
    function tierFromDhq(dhq) {
        if (dhq >= 7000) return { label: 'Elite', color: '#2ECC71' };
        if (dhq >= 5000) return { label: 'Tier 1', color: '#3498DB' };
        if (dhq >= 3500) return { label: 'Tier 2', color: '#D4AF37' };
        if (dhq >= 2000) return { label: 'Tier 3', color: '#D0D0D0' };
        if (dhq > 0)    return { label: 'Depth', color: 'var(--text-muted)' };
        return { label: '—', color: 'var(--text-muted)' };
    }

    // Chronicles → custom-awards index. Scans `wr_chronicles_*` keys ONCE and
    // returns a lowercased-name → [awards] map so repeated card opens don't
    // rescan localStorage. Invalidated via window._wrChroniclesInvalidate()
    // whenever chronicles are imported or removed.
    let _chroniclesIndexCache = null;
    function _getChroniclesAwardIndex() {
        if (_chroniclesIndexCache) return _chroniclesIndexCache;
        const index = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('wr_chronicles_')) continue;
                let data;
                try { data = JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { continue; }
                if (!data || !Array.isArray(data.customAwards)) continue;
                data.customAwards.forEach(a => {
                    (a.winners || []).forEach(w => {
                        const key = (w.winner || '').toLowerCase();
                        if (!key) return;
                        if (!index[key]) index[key] = [];
                        index[key].push({ name: a.name, year: w.year, stats: w.stats, league: data.leagueName || '' });
                    });
                });
            }
        } catch (_) { /* noop */ }
        _chroniclesIndexCache = index;
        return index;
    }
    // Public invalidator — Trophy Room calls this after a chronicles import/delete.
    window._wrChroniclesInvalidate = function () { _chroniclesIndexCache = null; };

    // ── Team history: best-effort from career stats + current team ────
    // Sleeper doesn't expose a first-class team history. We reconstruct from
    // the yearly NFL career stats table (already fetched by fwFetchCareerStats).
    // If that fails we show only the current team with a note.
    function useTeamHistory(pid, player) {
        const [rows, setRows] = useState(null);
        const [loading, setLoading] = useState(true);
        useEffect(() => {
            let cancelled = false;
            async function load() {
                try {
                    const exp = player?.years_exp || 0;
                    const cur = parseInt(window.S?.season) || new Date().getFullYear();
                    if (typeof window.fwFetchCareerStats !== 'function' || exp <= 0) {
                        // Rookie or no career fetcher available — current team only
                        if (!cancelled) setRows(player?.team ? [{ season: cur, team: player.team }] : []);
                        setLoading(false);
                        return;
                    }
                    const career = await window.fwFetchCareerStats(pid, cur, exp);
                    if (cancelled) return;
                    const history = [];
                    Object.keys(career || {}).sort().forEach(yr => {
                        const row = career[yr] || {};
                        const team = row.team || row.tm || row.TEAM;
                        if (team) history.push({ season: parseInt(yr), team });
                    });
                    // Append current season / team if not represented
                    const latest = history[history.length - 1];
                    if (player?.team && (!latest || latest.team !== player.team || latest.season < cur)) {
                        history.push({ season: cur, team: player.team });
                    }
                    setRows(history);
                } catch (e) {
                    if (!cancelled) setRows(player?.team ? [{ season: new Date().getFullYear(), team: player.team }] : []);
                } finally {
                    if (!cancelled) setLoading(false);
                }
            }
            load();
            return () => { cancelled = true; };
        }, [pid]);
        return { rows, loading };
    }

    // Collapse consecutive same-team seasons into ranges (SEA 2022-2024, KC 2025)
    function compressHistory(rows) {
        if (!Array.isArray(rows) || !rows.length) return [];
        const out = [];
        let cur = { team: rows[0].team, start: rows[0].season, end: rows[0].season };
        for (let i = 1; i < rows.length; i++) {
            if (rows[i].team === cur.team && rows[i].season === cur.end + 1) {
                cur.end = rows[i].season;
            } else {
                out.push(cur);
                cur = { team: rows[i].team, start: rows[i].season, end: rows[i].season };
            }
        }
        out.push(cur);
        return out;
    }

    // ── Main component ────────────────────────────────────────────
    function PlayerCard({ pid, playersData, statsData, scoringSettings, onClose, initialTab }) {
        const [tab, setTab] = useState(initialTab || 'overview');
        const [tagMenu, setTagMenu] = useState(false);
        const closeRef = useRef(null);
        const p = playersData?.[pid];

        // ESC closes
        useEffect(() => {
            const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
            document.addEventListener('keydown', onKey);
            return () => document.removeEventListener('keydown', onKey);
        }, [onClose]);

        const { rows: historyRows, loading: historyLoading } = useTeamHistory(pid, p);

        // Custom awards hook must fire unconditionally — hoisted above the early
        // return so hook count stays stable across renders where p flips between
        // defined/undefined (otherwise React hook-count mismatch crashes the card).
        // Uses a single cached player→awards index so we don't rescan localStorage
        // on every card open. Cache is rebuilt on demand when storage version changes.
        const customAwards = React.useMemo(() => {
            if (!p) return [];
            const fullName = (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || '').toLowerCase();
            if (!fullName) return [];
            const index = _getChroniclesAwardIndex();
            const hits = index[fullName] || [];
            return hits.slice().sort((a, b) => (b.year || 0) - (a.year || 0));
        }, [pid, p?.full_name, p?.first_name, p?.last_name]);

        if (!p) return null;

        const pos = p.position || '?';
        const nPos = normPos(pos);
        const name = playerName(p);
        const age = p.age || 0;
        const team = p.team || 'FA';
        const dhq = window.App?.LI?.playerScores?.[pid] || 0;
        const meta = window.App?.LI?.playerMeta?.[pid] || {};
        const st = statsData?.[pid] || {};
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(nPos)
            : { build: [22, 24], peak: (window.App?.peakWindows || {})[nPos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const peakYrs = Math.max(0, pHi - age);
        const valueYrs = Math.max(0, declineHi - age);
        const peakLabel = age < pLo ? 'Rising' : age <= pHi ? 'Prime' : age <= declineHi ? 'Veteran' : 'Post-Window';
        const peakCol = age < pLo ? '#2ECC71' : age <= pHi ? '#D4AF37' : age <= declineHi ? '#F0A500' : '#E74C3C';
        const dhqCol = dhq >= 7000 ? '#2ECC71' : dhq >= 4000 ? '#3498DB' : dhq >= 2000 ? '#D0D0D0' : 'var(--text-muted)';
        const sc = scoringSettings || window.S?.leagues?.[0]?.scoring_settings || {};
        const ppgRaw = typeof window.App?.calcPPG === 'function' ? window.App.calcPPG(st, sc) : 0;
        const ppg = ppgRaw > 0 ? +ppgRaw.toFixed(1) : (meta.ppg || 0);
        const trend = meta.trend || 0;
        const pa = typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
        const rec = pa ? pa.label.toUpperCase() :
            (valueYrs <= 0 && trend <= -10 ? 'SELL NOW' : valueYrs <= 0 ? 'SELL' : peakYrs <= 1 ? 'SELL' : dhq >= 7000 && peakYrs >= 3 ? 'HOLD CORE' : 'HOLD');
        const recCol = rec.includes('SELL') ? '#E74C3C' : rec.includes('BUY') ? '#2ECC71' : '#D4AF37';
        const tier = tierFromDhq(dhq);
        const depthChart = typeof p.depth_chart_order === 'number'
            ? (pos + (p.depth_chart_order + 1))
            : null;
        const dhqContext = meta.statusReason
            ? (meta.statusReason + (meta.roleLabel ? ' · ' + meta.roleLabel : ''))
            : [meta.roleLabel, meta.opportunityLabel].filter(Boolean).join(' · ');
        const dhqContextCol = meta.statusReason ? '#E74C3C'
            : meta.roleMult && meta.roleMult < 0.9 ? '#F0A500'
                : meta.opportunityMult && meta.opportunityMult < 1 ? '#F0A500'
                    : 'var(--text-muted)';

        // Roster context
        const S = window.S || {};
        const myRoster = (S.rosters || []).find(r => r.roster_id === S.myRosterId);
        const isOnMyTeam = !!myRoster?.players?.includes(pid);

        const heightWeight = [p.height, p.weight].filter(Boolean).join(' / ');

        // customAwards is computed above (hoisted for stable hook order).

        // ── Action handlers ────────────────────────────────────────
        function goCompare() {
            try {
                if (typeof window.wrOpenCompare === 'function') window.wrOpenCompare(pid);
                else if (typeof window.openPlayerModal === 'function') {
                    // no-op — Compare tab lives inside My Roster; callers set wrOpenCompare
                }
            } catch (e) { /* noop */ }
            onClose && onClose();
        }
        function goTradeFinder() {
            try {
                // Trade Center listens on window._wrTradeFinderTarget
                window._wrTradeFinderTarget = { pid, mode: isOnMyTeam ? 'my' : 'acquire', ts: Date.now() };
                if (typeof window.wrNavigateTab === 'function') window.wrNavigateTab('trades');
                else if (typeof window.setActiveTab === 'function') window.setActiveTab('trades');
                window.dispatchEvent(new CustomEvent('wr:open-trade-finder', { detail: { pid } }));
            } catch (e) { console.warn('[PlayerCard] Trade Finder deep-link unavailable', e); }
            onClose && onClose();
        }
        function applyTag(tag) {
            try {
                const leagueId = window.S?.currentLeagueId || window.S?.currentLeague?.league_id || window.S?.currentLeague?.id || '';
                const next = { ...(window._playerTags || {}) };
                const wasActive = next[pid] === tag;
                if (wasActive) delete next[pid];
                else next[pid] = tag;
                window._playerTags = next;

                if (window.OD?.savePlayerTags) {
                    window.OD.savePlayerTags(leagueId, next);
                } else if (leagueId) {
                    localStorage.setItem('player_tags_' + leagueId, JSON.stringify(next));
                }
                if (!wasActive) {
                    window.wrLogAction?.('🏷️', 'Tagged ' + name + ' as ' + tag, 'roster', {
                        players: [{ name, pid, pos: nPos }],
                        actionType: 'tag',
                    });
                }
                window.dispatchEvent(new CustomEvent('wr:player-tags-changed', { detail: { leagueId, tags: next, pid, tag: wasActive ? null : tag } }));
            } catch (e) { /* noop */ }
            setTagMenu(false);
        }

        // ── Overview section ──────────────────────────────────────
        function OverviewTab() {
            const compressed = compressHistory(historyRows || []);
            return React.createElement(React.Fragment, null,
                // Stats grid
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                    [
                        { v: dhq > 0 ? dhq.toLocaleString() : '—', l: 'DHQ', c: dhqCol },
                        { v: ppg || '—', l: 'PPG (curr)', c: ppg >= 10 ? '#2ECC71' : '#D0D0D0' },
                        { v: peakYrs > 0 ? peakYrs + 'yr' : valueYrs + 'yr', l: peakYrs > 0 ? 'Peak Left' : 'Value Left', c: peakCol },
                        { v: tier.label, l: 'Tier', c: tier.color },
                        { v: rec, l: 'Action', c: recCol },
                    ].map((s, i) => React.createElement('div', { key: i, style: { textAlign: 'center' } },
                        React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.05rem', fontWeight: 700, color: s.c } }, s.v),
                        React.createElement('div', { style: { fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '3px' } }, s.l)
                    ))
                ),
                dhqContext && React.createElement('div', {
                    style: {
                        margin: '12px 20px 0',
                        padding: '9px 11px',
                        border: '1px solid rgba(212,175,55,0.16)',
                        borderRadius: '7px',
                        background: 'rgba(255,255,255,0.025)',
                        color: dhqContextCol,
                        fontSize: '0.76rem',
                        lineHeight: 1.45,
                    }
                }, dhqContext),
                // Age curve
                React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
	                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' } },
	                        React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 } }, 'Age Curve'),
	                        React.createElement('div', { style: { fontSize: '0.74rem', color: peakCol } },
	                            peakLabel + ' · ' + (peakYrs > 0 ? peakYrs + 'yr peak left' : valueYrs > 0 ? valueYrs + 'yr value left' : 'Past value window'))
                    ),
                    React.createElement('div', { style: { display: 'flex', height: '18px', borderRadius: '4px', overflow: 'hidden', gap: '1px' } },
                        Array.from({ length: 17 }, (_, i) => {
                            const a = i + 20;
                            const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' :
                                a < pLo ? 'rgba(46,204,113,0.45)' :
                                (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' :
	                                a <= declineHi ? 'rgba(212,175,55,0.45)' : 'rgba(231,76,60,0.35)';
                            return React.createElement('div', {
                                key: a,
                                style: {
                                    flex: 1, background: col, opacity: a === age ? 1 : 0.55,
                                    outline: a === age ? '2px solid #D4AF37' : 'none', outlineOffset: '-1px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.6rem', fontWeight: 700, color: a === age ? 'var(--text-primary)' : 'transparent'
                                }
                            }, a === age ? String(age) : '');
                        })
                    ),
                    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '4px' } },
                        React.createElement('span', null, '20'),
                        React.createElement('span', null, 'Peak ' + pLo + '–' + pHi),
                        React.createElement('span', null, '36')
                    )
                ),
                // Attributes row (depth chart clarified, no "News" button)
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                    [
                        { l: 'Experience', v: (p.years_exp || 0) + ' yr' + ((p.years_exp || 0) === 1 ? '' : 's') },
                        { l: 'NFL Depth Chart', v: depthChart || '—' },
                        { l: 'Height / Weight', v: heightWeight || '—' },
                        { l: 'College', v: p.college || '—' },
                    ].map((s, i) => React.createElement('div', { key: i },
                        React.createElement('div', { style: { fontSize: '0.64rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '3px' } }, s.l),
                        React.createElement('div', { style: { fontSize: '0.86rem', color: 'var(--text-primary)', fontWeight: 500 } }, s.v)
                    ))
                ),
                // Team history
                React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                    React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '8px' } }, 'Team History'),
                    historyLoading
                        ? React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.55 } }, 'Loading…')
                        : (compressed.length
                            ? React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
                                compressed.map((r, i) => React.createElement('span', {
                                    key: i,
                                    style: {
                                        padding: '4px 10px', background: 'rgba(212,175,55,0.08)',
                                        border: '1px solid rgba(212,175,55,0.2)', borderRadius: '6px',
                                        fontSize: '0.78rem', color: 'var(--text-primary)', fontFamily: 'JetBrains Mono, monospace'
                                    }
                                }, r.team + ' ' + (r.start === r.end ? r.start : r.start + '–' + r.end)))
                            )
                            : React.createElement('div', null,
                                React.createElement('div', { style: { fontSize: '0.82rem', color: 'var(--text-primary)' } },
                                    team === 'FA' ? 'Free Agent' : ('Current: ' + team)
                                ),
                                React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.55, marginTop: '4px' } },
                                    'Per-season history not available from the current data source.'
                                )
                            )
                        )
                ),
                // Phase 9 deferred: custom awards from imported Chronicles
                customAwards.length > 0 && React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                    React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: '8px' } }, 'Custom Awards'),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
                        customAwards.map((a, i) => React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px', background: 'rgba(212,175,55,0.06)', borderRadius: '6px' } },
                            React.createElement('span', { style: { fontSize: '0.95rem' } }, '\uD83C\uDFC5'),
                            React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                                React.createElement('div', { style: { fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' } }, a.name),
                                React.createElement('div', { style: { fontSize: '0.68rem', color: 'var(--silver)' } },
                                    [a.year, a.stats, a.league].filter(Boolean).join(' · ')
                                )
                            )
                        ))
                    )
                ),
                // AI recommendation
                React.createElement('div', { style: { padding: '14px 20px', display: 'flex', gap: '10px', alignItems: 'flex-start' } },
                    React.createElement('div', { style: { width: '24px', height: '24px', borderRadius: '6px', background: 'linear-gradient(135deg, #D4AF37, #B8941E)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '0.55rem', fontWeight: 800, color: '#0A0A0A' } }, 'AI'),
                    React.createElement('div', { style: { fontSize: '0.84rem', color: '#D0D0D0', lineHeight: 1.5 } },
                        (() => {
                            let insight;
	                            if (isOnMyTeam && valueYrs <= 1 && dhq >= 3000) insight = 'Sell window closing — move before value drops.';
                            else if (!isOnMyTeam && peakYrs >= 5 && dhq < 4000) insight = 'Buy-low candidate — young with room to grow.';
                            else if (peakYrs >= 4) insight = 'Long dynasty window — cornerstone asset.';
                            else if (peakYrs >= 1) insight = 'In production window.';
	                            else if (valueYrs >= 1) insight = 'Veteran value window.';
	                            else insight = 'Past value window — value declining.';
                            if (trend >= 20) insight += ' Trending up ' + trend + '%.';
                            else if (trend <= -15) insight += ' Production down ' + Math.abs(trend) + '%.';
                            return insight;
                        })()
                    )
                )
            );
        }

        // ── Stats tab reuses InlineCareerStats (NFL + College, with PPG) ──
        function StatsTab() {
            const InlineCareerStats = window.InlineCareerStats;
            if (typeof InlineCareerStats !== 'function') {
                return React.createElement('div', { style: { padding: '28px 20px', color: 'var(--silver)', opacity: 0.6 } }, 'Stats module not loaded.');
            }
            return React.createElement('div', { style: { padding: '14px 20px' } },
                React.createElement(InlineCareerStats, {
                    pid, pos, player: p,
                    scoringSettings: sc,
                    statsData
                })
            );
        }

        // ── Render ────────────────────────────────────────────────
        const backdrop = {
            position: 'fixed', inset: 0, background: 'rgba(5,6,9,0.72)',
            zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px', animation: 'wrFadeIn 0.15s ease'
        };
        const modal = {
            width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto',
            background: '#0a0b0d', border: '1px solid rgba(212,175,55,0.3)',
            borderRadius: '14px', boxShadow: '0 24px 80px rgba(0,0,0,0.8)',
            animation: 'wrFadeIn 0.2s ease'
        };

        return React.createElement('div', { style: backdrop, onClick: (e) => { if (e.target === e.currentTarget) onClose && onClose(); } },
            React.createElement('div', { style: modal, onClick: (e) => e.stopPropagation() },
                // Hero
                React.createElement('div', { style: { padding: '18px 20px', background: 'linear-gradient(135deg, rgba(212,175,55,0.10), transparent 60%)', borderBottom: '1px solid rgba(212,175,55,0.2)', display: 'flex', gap: '14px', alignItems: 'center' } },
                    React.createElement('div', { className: 'wr-ring wr-ring-' + nPos, style: { width: '60px', height: '60px', borderRadius: '12px', overflow: 'hidden', background: 'rgba(212,175,55,0.1)', border: '1px solid rgba(212,175,55,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
                        React.createElement('img', {
                            src: 'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg',
                            style: { width: '60px', height: '60px', objectFit: 'cover' },
                            onError: function (e) { e.target.style.display = 'none'; }
                        })
                    ),
                    React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                        React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.45rem', color: 'var(--text-primary)', letterSpacing: '0.02em' } }, name),
                        // Single-row identity strip — no redundant profile block below
                        React.createElement('div', { style: { fontSize: '0.82rem', color: '#D0D0D0', marginTop: '2px' } },
                            [nPos, team, 'Age ' + (age || '?'), heightWeight, p.college].filter(Boolean).join(' · ')
                        )
                    ),
                    React.createElement('button', {
                        ref: closeRef, onClick: onClose,
                        style: { background: 'none', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.95rem', padding: '4px 10px' }
                    }, '✕')
                ),
                // Tabs
                React.createElement('div', { style: { display: 'flex', gap: '2px', padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,0.06)' } },
                    ['overview', 'stats'].map(t =>
                        React.createElement('button', {
                            key: t,
                            onClick: () => setTab(t),
                            style: {
                                padding: '10px 14px', background: 'transparent',
                                border: 'none', borderBottom: tab === t ? '2px solid var(--gold)' : '2px solid transparent',
                                color: tab === t ? 'var(--gold)' : 'var(--silver)',
                                fontFamily: 'var(--font-body)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer'
                            }
                        }, t === 'overview' ? 'Overview' : 'Career Stats')
                    )
                ),
                // Tab body
                tab === 'overview' ? OverviewTab() : StatsTab(),
                // Actions — Compare, Trade Finder, Tag As (no News button)
                React.createElement('div', { style: { padding: '14px 20px', display: 'flex', gap: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', position: 'relative' } },
                    React.createElement('button', { onClick: goCompare, style: btnStyle() }, 'Compare'),
                    React.createElement('button', { onClick: goTradeFinder, style: btnStyle('primary') }, isOnMyTeam ? 'Trade Finder' : 'Find Trade'),
                    React.createElement('button', { onClick: () => setTagMenu(!tagMenu), style: btnStyle() }, 'Tag As ▾'),
                    tagMenu ? React.createElement('div', {
                        style: { position: 'absolute', bottom: '54px', right: '20px', background: '#0a0b0d', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '8px', padding: '6px', zIndex: 5, minWidth: '160px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }
                    },
                        ['trade', 'cut', 'watch', 'untouchable'].map(t =>
                            React.createElement('button', {
                                key: t, onClick: () => applyTag(t),
                                style: { display: 'block', width: '100%', textAlign: 'left', padding: '7px 10px', background: 'transparent', border: 'none', color: '#D0D0D0', fontSize: '0.82rem', cursor: 'pointer', borderRadius: '4px' }
                            }, 'Tag as ' + t.charAt(0).toUpperCase() + t.slice(1))
                        )
                    ) : null,
                    React.createElement('button', { onClick: onClose, style: btnStyle('ghost', { marginLeft: 'auto' }) }, 'Close')
                )
            )
        );
    }

    function btnStyle(variant, extra) {
        const base = {
            padding: '9px 14px', border: '1px solid rgba(212,175,55,0.3)',
            borderRadius: '6px', fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem',
            letterSpacing: '0.03em', cursor: 'pointer'
        };
        if (variant === 'primary') return { ...base, background: '#D4AF37', color: '#0A0A0A', border: '1px solid #D4AF37', ...(extra || {}) };
        if (variant === 'ghost')   return { ...base, background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.08)', ...(extra || {}) };
        return { ...base, background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', ...(extra || {}) };
    }

    // ── Host component: mounted once into a root container ────────
    function PlayerCardHost() {
        const [state, setState] = useState(null); // { pid, options }

	        useEffect(() => {
	            window.WR = window.WR || {};
	            window.WR.openPlayerCard = function (pid, options) {
	                if (!pid) return;
	                window.OD?.track?.('player_modal_opened', {
	                    platform: 'warroom',
	                    module: window.S?.activeTab || null,
	                    leagueId: window.S?.currentLeagueId || null,
	                    entityType: 'player',
	                    entityId: pid,
	                    metadata: { source: options?.context || 'player_card' },
	                });
	                setState({ pid, options: options || {} });
	            };
            window.WR.closePlayerCard = function () { setState(null); };
            return () => { /* Do not clear globals on unmount; host is persistent */ };
        }, []);

        if (!state) return null;
        const playersData = (window.App && window.App._playersCache) || {};
        const statsData = window._wrStatsData || window.App?._statsCache || {};
        const sc = state.options.scoringSettings || window.S?.leagues?.[0]?.scoring_settings;
        return React.createElement(PlayerCard, {
            pid: state.pid,
            playersData,
            statsData,
            scoringSettings: sc,
            initialTab: state.options.tab,
            onClose: () => setState(null)
        });
    }

    // ── Boot ──────────────────────────────────────────────────────
    window.PlayerCard = PlayerCard;
    window.PlayerCardHost = PlayerCardHost;

    function mount() {
        if (document.getElementById('wr-player-card-root')) return;
        const el = document.createElement('div');
        el.id = 'wr-player-card-root';
        document.body.appendChild(el);
        // Defer until React + ReactDOM are ready
        const tryRender = () => {
            if (typeof React === 'undefined' || typeof ReactDOM === 'undefined') {
                return setTimeout(tryRender, 80);
            }
            try {
                if (ReactDOM.createRoot) {
                    ReactDOM.createRoot(el).render(React.createElement(PlayerCardHost));
                } else {
                    ReactDOM.render(React.createElement(PlayerCardHost), el);
                }
            } catch (e) { console.warn('[PlayerCard] mount failed', e); }
        };
        tryRender();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', mount);
    } else {
        mount();
    }
})();

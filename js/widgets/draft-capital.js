// ══════════════════════════════════════════════════════════════════
// js/widgets/draft-capital.js — Draft Capital widget (v3)
//
// Pick inventory, league capital rank, draft countdown.
//
// sm: total DHQ value + pick count + countdown
// md: pick distribution by year (bars) + top pick highlights
// lg: capital rank + inventory by year (no scroll, fits 320px)
// xxl: lg + Big Board snapshot (top available players)
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    function DraftCapitalWidget({ size, myRoster, currentLeague, playersData, briefDraftInfo, setActiveTab, navigateWidget }) {
        const theme = window.WrTheme?.get?.() || {};
        const colors = theme.colors || {};
        const fonts = theme.fonts || {};
        const cardStyle = window.WrTheme?.cardStyle?.() || {};
        const fs = (rem) => window.WrTheme?.fontSize?.(rem) || (rem + 'rem');

        const myRid = myRoster?.roster_id;
        const season = String(currentLeague?.season || new Date().getFullYear());
        const draftRounds = currentLeague?.settings?.draft_rounds || 5;
        const totalTeams = currentLeague?.rosters?.length || 12;
        const tradedPicks = window.S?.tradedPicks || [];

        // ── Pick inventory ──
        const picks = React.useMemo(() => {
            const inv = [];
            const pvFn = window.App?.PlayerValue?.getPickValue;
            for (let yr = parseInt(season); yr <= parseInt(season) + 2; yr++) {
                for (let rd = 1; rd <= draftRounds; rd++) {
                    const tradedAway = tradedPicks.find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === myRid && p.owner_id !== myRid);
                    if (tradedAway) continue;
                    const acquired = tradedPicks.filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === myRid && p.roster_id !== myRid);
                    if (!tradedAway) {
                        const val = pvFn ? pvFn(yr, rd, totalTeams, Math.ceil(totalTeams / 2)) : Math.max(500, 10000 - rd * 2000);
                        inv.push({ year: yr, round: rd, own: true, value: val, label: yr === parseInt(season) ? 'R' + rd : "'" + String(yr).slice(-2) + ' R' + rd });
                    }
                    acquired.forEach(a => {
                        const fromRoster = (currentLeague?.rosters || []).find(r => r.roster_id === a.roster_id);
                        const fromUser = fromRoster ? (window.S?.leagueUsers || []).find(u => u.user_id === fromRoster.owner_id) : null;
                        const fromName = fromUser?.display_name || ('T' + a.roster_id);
                        const val = pvFn ? pvFn(yr, rd, totalTeams, Math.ceil(totalTeams / 2)) : Math.max(500, 10000 - rd * 2000);
                        inv.push({ year: yr, round: rd, own: false, from: fromName, value: val, label: 'R' + rd + ' (' + fromName.slice(0, 6) + ')' });
                    });
                }
            }
            return inv;
        }, [myRid, season, draftRounds, totalTeams, tradedPicks]);

        const totalValue = picks.reduce((s, p) => s + (p.value || 0), 0);
        const pickCount = picks.length;
        const maxRoundVal = Math.max(...picks.map(p => p.value || 0), 1);

        // Draft countdown
        const countdown = React.useMemo(() => {
            if (!briefDraftInfo?.start_time || briefDraftInfo.status !== 'pre_draft') return null;
            const diff = briefDraftInfo.start_time - Date.now();
            if (diff <= 0) return { text: 'LIVE', live: true };
            const days = Math.floor(diff / 86400000);
            const hours = Math.floor((diff % 86400000) / 3600000);
            return { text: days > 0 ? days + 'd ' + hours + 'h' : hours + 'h', live: false };
        }, [briefDraftInfo]);

        const valCol = totalValue >= 20000 ? colors.positive : totalValue >= 10000 ? colors.accent : colors.negative;
        const isClickable = size === 'sm' || size === 'md';
        const openDraft = (e) => {
            e?.stopPropagation?.();
            if (navigateWidget) navigateWidget('draft');
            else if (setActiveTab) setActiveTab('draft');
        };
        const onClick = () => { if (isClickable) openDraft(); };
        const openCard = (pid) => {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
            else if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid);
        };

        // Group picks by year (used by lg/xxl)
        const picksByYear = React.useMemo(() => {
            const groups = {};
            picks.forEach(p => {
                const yr = p.year || 'Unknown';
                if (!groups[yr]) groups[yr] = [];
                groups[yr].push(p);
            });
            return Object.entries(groups).sort((a, b) => a[0] - b[0]);
        }, [picks]);

        // League capital rank
        const leagueCapitalRank = React.useMemo(() => {
            const allRosters = currentLeague?.rosters || [];
            const leagueSeason = parseInt(currentLeague?.season) || new Date().getFullYear();
            const allTeamCap = allRosters.map(r => {
                let cap = 0;
                for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                    for (let rd = 1; rd <= draftRounds; rd++) {
                        const pv = typeof window.getIndustryPickValue === 'function'
                            ? window.getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds)
                            : window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || 0;
                        const tradedAway = (tradedPicks || []).find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
                        if (!tradedAway) cap += pv;
                        const acquired = (tradedPicks || []).filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === r.roster_id && p.roster_id !== r.roster_id);
                        acquired.forEach(() => { cap += pv; });
                    }
                }
                return { rid: r.roster_id, cap };
            }).sort((a, b) => b.cap - a.cap);
            const rank = allTeamCap.findIndex(t => t.rid === myRid) + 1;
            return { rank: rank || '—', total: allTeamCap.length };
        }, [currentLeague, draftRounds, totalTeams, tradedPicks, myRid]);

        // Pick value equivalent label
        const pickEquiv = (val) => {
            if (val >= 7000) return 'QB1/RB1';
            if (val >= 5000) return 'WR1';
            if (val >= 3000) return 'starter';
            if (val >= 1500) return 'flex';
            if (val >= 500) return 'depth';
            return '';
        };

        // ── SM: total value hero ──
        if (size === 'sm') {
            return (
                <div onClick={onClick} style={{
                    ...cardStyle, padding: 'var(--card-pad, 14px 16px)', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center',
                }}>
                    <div style={{
                        fontFamily: fonts.mono, fontSize: fs(1.6), fontWeight: 700,
                        color: valCol, lineHeight: 1,
                    }} className="wr-data-value">
                        {totalValue >= 1000 ? (totalValue / 1000).toFixed(1) + 'k' : totalValue}
                    </div>
                    <div style={{ fontSize: fs(0.85), color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginTop: '4px', fontFamily: fonts.ui }}>
                        {pickCount} PICKS
                    </div>
                    {countdown && (
                        <div style={{
                            marginTop: '6px', fontSize: fs(0.64),
                            color: countdown.live ? colors.positive : colors.accent,
                            fontWeight: 700, fontFamily: fonts.ui,
                        }}>{countdown.live ? '🔴 LIVE' : countdown.text}</div>
                    )}
                </div>
            );
        }

        // ── MD: bars per year + 2 best picks ──
        if (size === 'md') {
            const yearTotals = picksByYear.map(([year, ypicks]) => {
                const total = ypicks.reduce((s, p) => s + (p.value || 0), 0);
                const count = ypicks.length;
                return { year, total, count };
            });
            const maxYearTotal = Math.max(...yearTotals.map(y => y.total), 1);
            const top2 = [...picks].sort((a, b) => b.value - a.value).slice(0, 2);

            return (
                <div onClick={onClick} style={{ ...cardStyle, padding: '12px 14px', cursor: 'pointer', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexShrink: 0 }}>
                        <span style={{ fontSize: '0.95rem' }}>🎯</span>
                        <span style={{ fontFamily: fonts.display, fontSize: fs(0.85), fontWeight: 700, color: colors.warn || '#F0A500', letterSpacing: '0.06em', textTransform: 'uppercase', flex: 1 }}>Draft Capital</span>
                        {countdown && <span style={{ fontSize: fs(0.6), color: countdown.live ? colors.positive : colors.accent, fontWeight: 700, fontFamily: fonts.ui }}>{countdown.live ? '🔴' : countdown.text}</span>}
                    </div>
                    {/* Year value bars */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexShrink: 0, marginBottom: '6px' }}>
                        {yearTotals.map((y, i) => {
                            const pct = (y.total / maxYearTotal) * 100;
                            const col = y.total >= 7000 ? colors.positive : y.total >= 3000 ? colors.accent : colors.textMuted;
                            return (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.textMuted, width: 30, fontFamily: fonts.mono }}>{y.year}</span>
                                    <div style={{ flex: 1, height: 12, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ width: pct + '%', height: '100%', background: col }} />
                                    </div>
                                    <span style={{ fontSize: fs(0.56), fontWeight: 700, color: col, fontFamily: fonts.mono, minWidth: 36, textAlign: 'right' }}>{y.count}p · {y.total >= 1000 ? (y.total / 1000).toFixed(1) + 'k' : y.total}</span>
                                </div>
                            );
                        })}
                    </div>
                    {/* Top picks */}
                    <div style={{ flex: 1, minHeight: 0, fontSize: fs(0.62), color: colors.textMuted, fontFamily: fonts.ui, lineHeight: 1.4, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '4px' }}>
                        Best: {top2.map(p => p.label + ' (' + (p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'k' : p.value) + (pickEquiv(p.value) ? ', ' + pickEquiv(p.value) : '') + ')').join(' · ')}
                    </div>
                </div>
            );
        }

        // ── Reusable inventory list (lg/xxl) ──
        function renderInventory(opts = {}) {
            const compact = !!opts.compact;
            return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? '4px' : '6px' }}>
                    {picksByYear.map(([year, yearPicks], yi) => {
                        const yearTotal = yearPicks.reduce((s, p) => s + (p.value || 0), 0);
                        return (
                            <div key={year}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '2px' }}>
                                    <span style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, fontFamily: fonts.ui }}>{year}</span>
                                    <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.06)' }} />
                                    <span style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.mono }}>
                                        {yearPicks.length}p · {yearTotal >= 1000 ? (yearTotal / 1000).toFixed(1) + 'k' : yearTotal}
                                    </span>
                                </div>
                                {yearPicks.map((p, i) => {
                                    const equiv = pickEquiv(p.value);
                                    return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '1px 0', fontSize: fs(compact ? 0.56 : 0.62) }}>
                                            <span style={{ fontWeight: 700, color: p.own ? colors.text : colors.accent, minWidth: 60, fontFamily: fonts.ui }}>{p.label}</span>
                                            {!p.own && <span style={{ fontSize: fs(0.48), fontWeight: 700, color: colors.purple || '#7C6BF8', padding: '0 3px', background: (colors.purple || '#7C6BF8') + '18', borderRadius: 2 }}>TR</span>}
                                            <div style={{ flex: 1, height: 4, background: 'rgba(255,255,255,0.04)', borderRadius: 2, overflow: 'hidden' }}>
                                                <div style={{ width: ((p.value / maxRoundVal) * 100) + '%', height: '100%', background: p.round <= 2 ? colors.accent : colors.textMuted + '88' }} />
                                            </div>
                                            <span style={{ fontSize: fs(0.54), fontWeight: 700, color: colors.textMuted, minWidth: 30, textAlign: 'right', fontFamily: fonts.mono }}>
                                                {p.value >= 1000 ? (p.value / 1000).toFixed(1) + 'k' : p.value}
                                            </span>
                                            {equiv && !compact && <span style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.ui, minWidth: 40 }}>{equiv}</span>}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            );
        }

        // ── Capital rank header strip ──
        function renderRankStrip() {
            return (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '6px 10px',
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid ' + (colors.border || 'rgba(255,255,255,0.06)'),
                    borderRadius: '6px',
                }}>
                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 700, color: valCol, lineHeight: 1 }} className="wr-data-value">
                            {totalValue >= 1000 ? (totalValue / 1000).toFixed(1) + 'k' : totalValue}
                        </div>
                        <div style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.ui }}>TOTAL DHQ</div>
                    </div>
                    <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />
                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 700, color: colors.accent, lineHeight: 1 }}>#{leagueCapitalRank.rank}</div>
                        <div style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.ui }}>OF {leagueCapitalRank.total}</div>
                    </div>
                    <div style={{ width: 1, height: 28, background: 'rgba(255,255,255,0.08)' }} />
                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontFamily: fonts.mono, fontSize: fs(1.05), fontWeight: 700, color: colors.text, lineHeight: 1 }}>{pickCount}</div>
                        <div style={{ fontSize: fs(0.54), color: colors.textMuted, fontFamily: fonts.ui }}>PICKS</div>
                    </div>
                </div>
            );
        }

        // ── Header ──
        function header() {
            return (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <span style={{ fontSize: '1rem' }}>🎯</span>
                    <span style={{ fontFamily: fonts.display, fontSize: fs(0.95), fontWeight: 700, color: colors.warn || '#F0A500', letterSpacing: '0.07em', textTransform: 'uppercase', flex: 1 }}>Draft Capital</span>
                    {countdown && <span style={{ fontSize: fs(0.62), color: countdown.live ? colors.positive : colors.accent, fontWeight: 700, fontFamily: fonts.ui }}>{countdown.live ? '🔴 LIVE' : countdown.text}</span>}
                    <button onClick={openDraft} title="Open Draft Command" style={{ padding: '3px 8px', background: 'rgba(240,165,0,0.10)', color: colors.warn || '#F0A500', border: '1px solid rgba(240,165,0,0.28)', borderRadius: '5px', cursor: 'pointer', fontSize: fs(0.56), fontFamily: fonts.ui, fontWeight: 700, whiteSpace: 'nowrap' }}>Draft</button>
                </div>
            );
        }

        // ── LG: capital rank + inventory (no scroll) ──
        if (size === 'lg') {
            return (
                <div style={{ ...cardStyle, padding: '12px 14px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ marginBottom: '8px', flexShrink: 0 }}>{renderRankStrip()}</div>
                    <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        {renderInventory({ compact: true })}
                    </div>
                </div>
            );
        }

        // ── XXL: lg + Big Board + Pick Strategy + League Capital chart ──
        if (size === 'xxl') {
            // Top available players (proxy for big board): un-rostered, sorted by DHQ
            const scores = window.App?.LI?.playerScores || {};
            const rostered = new Set();
            (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
            const bigBoard = Object.entries(scores)
                .filter(([pid]) => !rostered.has(pid))
                .map(([pid, dhq]) => {
                    const p = playersData?.[pid] || {};
                    return {
                        pid, name: p.full_name || pid,
                        pos: window.App?.normPos?.(p.position) || p.position || '?',
                        age: p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null),
                        team: p.team || 'FA', dhq,
                    };
                })
                .sort((a, b) => b.dhq - a.dhq)
                .slice(0, 20);

            // League capital chart: every team's pick value for comparison
            const leagueCapital = React.useMemo(() => {
                const allRosters = currentLeague?.rosters || [];
                const leagueSeason = parseInt(currentLeague?.season) || new Date().getFullYear();
                const data = allRosters.map(r => {
                    let cap = 0;
                    for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                        for (let rd = 1; rd <= draftRounds; rd++) {
                            const pv = typeof window.getIndustryPickValue === 'function'
                                ? window.getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds)
                                : window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || 0;
                            const tradedAway = (tradedPicks || []).find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
                            if (!tradedAway) cap += pv;
                            const acquired = (tradedPicks || []).filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === r.roster_id && p.roster_id !== r.roster_id);
                            acquired.forEach(() => { cap += pv; });
                        }
                    }
                    const user = (currentLeague?.users || window.S?.leagueUsers || []).find(u => u.user_id === r.owner_id);
                    return { rid: r.roster_id, name: user?.metadata?.team_name || user?.display_name || ('Team ' + r.roster_id), cap, isMe: r.roster_id === myRid };
                }).sort((a, b) => b.cap - a.cap);
                return data;
            }, [currentLeague, draftRounds, totalTeams, tradedPicks, myRid]);

            const maxLeagueCap = Math.max(...leagueCapital.map(t => t.cap), 1);

            // Pick strategy: pair top 4 picks with user's needs
            const myAssess = typeof window.assessTeamFromGlobal === 'function' && myRid
                ? window.assessTeamFromGlobal(myRid)
                : null;
            const myNeeds = (myAssess?.needs || []).map(n => typeof n === 'string' ? n : n?.pos).filter(Boolean);
            const topPicks = [...picks].sort((a, b) => b.value - a.value).slice(0, 4);
            const strategy = topPicks.map((p, i) => ({
                pick: p,
                target: myNeeds[i] || myNeeds[0] || '—',
            }));

            return (
                <div style={{ ...cardStyle, padding: '14px 16px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                    {header()}
                    <div style={{ marginBottom: '10px', flexShrink: 0 }}>{renderRankStrip()}</div>
                    {/* Top half: 2-col inventory + big board */}
                    <div style={{ flex: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px', marginBottom: '10px', overflow: 'hidden' }}>
                        <div style={{ minWidth: 0, overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Pick Inventory</div>
                            {renderInventory({ compact: true })}
                        </div>
                        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            <div style={{ fontSize: fs(0.62), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui, flexShrink: 0 }}>Big Board · Top Available</div>
                            <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                                {bigBoard.length === 0 ? <div style={{ fontSize: fs(0.6), color: colors.textFaint, fontStyle: 'italic' }}>No players available</div> : bigBoard.map((p, i) => {
                                    const col = p.dhq >= 5000 ? colors.positive : p.dhq >= 2000 ? colors.accent : colors.textMuted;
                                    return (
                                        <div key={p.pid} onClick={() => p.pid && openCard(p.pid)} style={{
                                            display: 'flex', alignItems: 'center', gap: '6px', padding: '2px 0',
                                            borderBottom: '1px solid rgba(255,255,255,0.03)', cursor: 'pointer',
                                            fontSize: fs(0.6), fontFamily: fonts.ui,
                                        }}>
                                            <span style={{ fontSize: fs(0.52), color: i < 3 ? colors.accent : colors.textFaint, fontWeight: 700, width: 16, textAlign: 'right', fontFamily: fonts.mono }}>{i + 1}</span>
                                            <span style={{ fontSize: fs(0.48), padding: '0 4px', borderRadius: 2, background: (window.App?.POS_COLORS?.[p.pos] || colors.accent) + '22', color: window.App?.POS_COLORS?.[p.pos] || colors.accent, fontWeight: 700 }}>{p.pos}</span>
                                            <span style={{ flex: 1, color: colors.text, fontWeight: i < 3 ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                            {p.age && <span style={{ fontSize: fs(0.48), color: colors.textFaint, fontFamily: fonts.mono }}>{p.age}</span>}
                                            <span style={{ fontSize: fs(0.54), fontWeight: 700, color: col, fontFamily: fonts.mono, minWidth: 30, textAlign: 'right' }}>{p.dhq >= 1000 ? (p.dhq / 1000).toFixed(1) + 'k' : p.dhq}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                    {/* Bottom half: Pick Strategy + League Capital chart */}
                    <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '16px' }}>
                        {/* Pick Strategy */}
                        <div style={{ padding: '8px 10px', background: 'rgba(240,165,0,0.05)', border: '1px solid rgba(240,165,0,0.2)', borderRadius: '6px' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.warn || '#F0A500', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>Pick Strategy · Targets by Round</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '4px 12px' }}>
                                {strategy.map((s, i) => {
                                    const targetCol = window.App?.POS_COLORS?.[s.target] || colors.accent;
                                    return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: fs(0.6), fontFamily: fonts.ui }}>
                                            <span style={{ minWidth: 50, fontWeight: 700, color: colors.text }}>{s.pick.label}</span>
                                            <span style={{ fontSize: fs(0.52), color: colors.textMuted, fontFamily: fonts.mono }}>{s.pick.value >= 1000 ? (s.pick.value / 1000).toFixed(1) + 'k' : s.pick.value}</span>
                                            <span style={{ color: colors.textFaint }}>→</span>
                                            <span style={{ fontWeight: 700, color: targetCol, fontFamily: fonts.ui }}>{s.target}</span>
                                            <span style={{ fontSize: fs(0.52), color: colors.textFaint, fontFamily: fonts.ui }}>{pickEquiv(s.pick.value)}</span>
                                        </div>
                                    );
                                })}
                            </div>
                            {strategy.length === 0 && (
                                <div style={{ fontSize: fs(0.6), color: colors.textFaint, fontStyle: 'italic' }}>No assessment available</div>
                            )}
                        </div>
                        {/* League Capital Distribution */}
                        <div style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px' }}>
                            <div style={{ fontSize: fs(0.6), fontWeight: 700, color: colors.accent, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px', fontFamily: fonts.ui }}>League Capital Distribution</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                {leagueCapital.map((t, i) => {
                                    const pct = (t.cap / maxLeagueCap) * 100;
                                    return (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: fs(0.54), fontFamily: fonts.ui }}>
                                            <span style={{ fontSize: fs(0.5), color: colors.textFaint, width: 12, textAlign: 'right', fontFamily: fonts.mono }}>{i + 1}</span>
                                            <span style={{ flex: 1, minWidth: 0, color: t.isMe ? colors.accent : colors.textMuted, fontWeight: t.isMe ? 700 : 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(t.isMe ? '★ ' : '') + (t.name || '').slice(0, 14)}</span>
                                            <div style={{ width: 80, height: 5, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                                                <div style={{ width: pct + '%', height: '100%', background: t.isMe ? colors.accent : colors.textMuted, opacity: t.isMe ? 1 : 0.5 }} />
                                            </div>
                                            <span style={{ fontSize: fs(0.5), color: colors.textFaint, fontFamily: fonts.mono, minWidth: 28, textAlign: 'right' }}>{t.cap >= 1000 ? (t.cap / 1000).toFixed(1) + 'k' : t.cap}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return null;
    }

    window.DraftCapitalWidget = DraftCapitalWidget;
})();

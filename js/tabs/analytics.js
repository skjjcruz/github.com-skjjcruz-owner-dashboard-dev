// ══════════════════════════════════════════════════════════════════
// js/tabs/analytics.js — AnalyticsPanel: League analytics terminal
// with 5 sub-tabs: Roster, Draft, Waiver/Trades, Playoffs, Timeline
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

// Phase 8 deferred: small wrapper that holds the local state needed to mount
// LeagueMapTab in embed mode. Keeping it separate prevents AnalyticsPanel from
// re-initialising the sort/filter/search state on every render of other sub-tabs.
window.AnalyticsLeagueEmbed = function AnalyticsLeagueEmbed(props) {
    const { analyticsTab, standings, currentLeague, playersData, statsData, sleeperUserId,
        myRoster, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName } = props;
    const [lpSort, setLpSort] = React.useState({ key: 'dhq', dir: -1 });
    const [lpFilter, setLpFilter] = React.useState('');
    const [lpSearch, setLpSearch] = React.useState('');
    const [leagueSelectedTeam, setLeagueSelectedTeam] = React.useState(null);
    const [leagueSort, setLeagueSort] = React.useState('health');
    const [leagueViewMode, setLeagueViewMode] = React.useState('cards');
    if (typeof window.LeagueMapTab !== 'function') {
        return React.createElement('div', { style: { padding: '40px', textAlign: 'center', color: 'var(--silver)' } }, 'League Map module not loaded.');
    }
    return React.createElement(window.LeagueMapTab, {
        embedSubView: analyticsTab,
        analyticsEmbedMode: true,
        leagueViewTab: 'analyst', setLeagueViewTab: () => {},
        leagueSelectedTeam, setLeagueSelectedTeam,
        leagueSort, setLeagueSort,
        leagueSubView: analyticsTab, setLeagueSubView: () => {},
        leagueViewMode, setLeagueViewMode,
        lpSort, setLpSort,
        lpFilter, setLpFilter,
        lpSearch, setLpSearch,
        standings, currentLeague, playersData, statsData, sleeperUserId, myRoster,
        activeYear, timeRecomputeTs, setActiveTab,
        getAcquisitionInfo: getAcquisitionInfo || (() => ({ method: 'Unknown', date: '', cost: '' })),
        getOwnerName,
    });
};

function AnalyticsPanel({
  analyticsData,
  analyticsTab,
  setAnalyticsTab,
  myRoster,
  currentLeague,
  standings,
  playersData,
  statsData,
  stats2025Data,
  sleeperUserId,
  timeRecomputeTs,
  setTimeRecomputeTs,
  activeYear,
  setActiveTab,
  viewingOwnerId,
  setViewingOwnerId,
  timeDelta,
  timeYear,
  setTradeSubTab,
  getOwnerName,
  // Phase 8: needed when embedding LeagueMapTab (All Players / Draft Picks / Custom Reports).
  getAcquisitionInfo,
}) {
    const _seasonCtx = React.useContext(window.App.SeasonContext) || {};
    const [timelineFilter, setTimelineFilter] = React.useState('all');
    // _SS mirrors the window.S shape consumed throughout this component
    const _SS = {
        rosters: _seasonCtx.rosters?.length ? _seasonCtx.rosters : (window.S?.rosters || currentLeague?.rosters || []),
        myRosterId: _seasonCtx.myRosterId ?? window.S?.myRosterId,
        tradedPicks: _seasonCtx.tradedPicks !== undefined ? _seasonCtx.tradedPicks : (window.S?.tradedPicks || []),
        playerStats: _seasonCtx.playerStats || window.S?.playerStats || {},
    };

    // Token-driven card style so padding/radius/border track index.html's spacing scale.
    const aCardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', padding: 'var(--card-pad, 14px 16px)', marginBottom: 'var(--card-gap, 12px)' };
    const aHeaderStyle = { fontFamily: 'Rajdhani, sans-serif', color: 'var(--gold)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '0.06em', marginBottom: '12px', borderBottom: '1px solid rgba(212,175,55,0.2)', paddingBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
    const aValStyle = { fontFamily: 'JetBrains Mono, monospace', fontSize: '0.95rem', fontWeight: 500 };
    const goodColor = '#2ECC71';
    const warnColor = '#F0A500';
    const badColor = '#E74C3C';
    const sevIcon = (sev) => sev === 'high' || sev === 'critical' ? '\uD83D\uDD34' : sev === 'medium' ? '\u26A0\uFE0F' : '\u2705';
    const sevColor = (sev) => sev === 'high' || sev === 'critical' ? badColor : sev === 'medium' ? warnColor : goodColor;
    const pctFmt = (v) => Math.round((v || 0) * 100) + '%';
    const numFmt = (v) => v != null ? (typeof v === 'number' ? v.toLocaleString() : v) : '\u2014';
    // showAlerts block removed — alerts now on Brief tab

    // ── ANALYST VIEW: full analytics terminal ──
    // Phase 8: Absorbed ex-League Map sub-views (All Players, Draft Picks, Custom Reports)
    // since League Map was removed from the nav. They render LeagueMapTab in embed mode.
    const subTabs = [
        { key: 'roster', label: 'Roster' },
        { key: 'draft', label: 'Draft' },
        { key: 'trades', label: 'Market Moves' },
        { key: 'playoffs', label: 'Playoffs' },
        { key: 'timeline', label: 'Timeline' },
        { key: 'players', label: 'All Players', navLabel: 'Players' },
        { key: 'picks', label: 'Draft Picks', navLabel: 'Picks' },
        { key: 'reports', label: 'Custom Reports', navLabel: 'Reports' },
    ];
    const activeSubTab = subTabs.find(t => t.key === analyticsTab) || subTabs[0];
    const analyticsContext = {
        roster: 'Winner-template gaps, room coverage, and roster construction evidence.',
        draft: 'Pick value, hit-rate patterns, and current-pick strategy.',
        trades: 'Trade efficiency, waiver activity, FAAB, and market pressure.',
        playoffs: 'Titles, finals paths, roadblocks, and postseason records.',
        timeline: 'League eras, filtered events, champions, and major shifts.',
        players: 'Full player universe with analytics-grade filters and saved views.',
        picks: 'Pick capital, ownership status, and traded/acquired paths.',
        reports: 'Custom report templates, saved views, and live preview.'
    };
    const tableRowStyle = (i) => ({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '8px', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', ...(i === 0 ? { fontWeight: 700, color: 'var(--gold)', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' } : { color: 'var(--silver)' }) });
    const d = analyticsData;
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const leagueRosters = currentLeague?.rosters || _SS.rosters || [];
    const leagueUsers = currentLeague?.users || window.S?.leagueUsers || [];
    const rosterByAnyId = (id) => leagueRosters.find(r => sameId(r.roster_id, id) || sameId(r.owner_id, id));
    const ownerNameSafe = (id, fallback) => {
        if (id == null || id === '') return fallback || 'Unknown';
        try {
            const direct = typeof getOwnerName === 'function' ? getOwnerName(id) : '';
            if (direct && direct !== 'Unknown' && !String(direct).startsWith('Team ')) return direct;
        } catch (_) {}
        const roster = rosterByAnyId(id);
        const user = leagueUsers.find(u => sameId(u.user_id, roster?.owner_id) || sameId(u.user_id, id));
        return user?.metadata?.team_name || user?.display_name || user?.username || fallback || 'Unknown';
    };
    const isResolvedOwner = (id) => {
        const name = ownerNameSafe(id, '');
        return !!name && name !== 'Unknown';
    };
    const completedChampionshipEntries = (championships) => Object.entries(championships || {})
        .filter(([, data]) => data?.champion && data?.runnerUp && isResolvedOwner(data.champion) && isResolvedOwner(data.runnerUp))
        .sort(([a], [b]) => String(b).localeCompare(String(a)));
    const AnalyticsReadout = ({ title, children, detail }) => (
        <details className="analytics-readout" open>
            <summary>
                <span>{title}</span>
                {detail && <em>{detail}</em>}
            </summary>
            <div className="analytics-readout-body">{children}</div>
        </details>
    );
    const AnalyticsKpi = ({ label, value, sub, color }) => (
        <div className="analytics-kpi">
            <span>{label}</span>
            <strong style={{ color: color || 'var(--white)' }}>{value}</strong>
            {sub && <em>{sub}</em>}
        </div>
    );
    const AnalyticsSection = ({ title, meta, children }) => (
        <div className="analytics-panel">
            <div className="analytics-panel-head">
                <span>{title}</span>
                {meta && <em>{meta}</em>}
            </div>
            {children}
        </div>
    );
    const toneFromDelta = (delta, inverse = false) => {
        const good = inverse ? delta < 0 : delta >= 0;
        if (Math.abs(delta || 0) < 0.01) return 'warn';
        return good ? 'good' : 'bad';
    };
    const signedNum = (v, suffix = '') => {
        if (v == null || !Number.isFinite(Number(v))) return '\u2014';
        const n = Number(v);
        return (n > 0 ? '+' : '') + n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + suffix;
    };
    const AnalyticsCommandPanel = ({ title, thesis, stats = [] }) => (
        <div className="analytics-command-panel">
            <div>
                <span>Research Question</span>
                <h2>{title}</h2>
                <p>{thesis}</p>
            </div>
            <aside>
                {stats.map((s, i) => (
                    <div key={i}>
                        <span>{s.label}</span>
                        <strong style={{ color: s.color || 'var(--white)' }}>{s.value}</strong>
                        {s.sub && <em>{s.sub}</em>}
                    </div>
                ))}
            </aside>
        </div>
    );
    const AnalyticsProofGrid = ({ items }) => (
        <div className="analytics-proof-grid">
            {items.map((item, i) => (
                <div key={i} className={'analytics-proof-card is-' + (item.tone || 'neutral')}>
                    <span>{item.label}</span>
                    <strong style={{ color: item.color || undefined }}>{item.value}</strong>
                    {item.detail && <em>{item.detail}</em>}
                </div>
            ))}
        </div>
    );
    const AnalyticsDeltaRows = ({ rows, youLabel = 'You', benchmarkLabel = 'Elite' }) => {
        const max = Math.max(1, ...rows.map(r => Math.max(Math.abs(r.yours || 0), Math.abs(r.benchmark || 0))));
        return (
            <div className="analytics-delta-list">
                <div className="analytics-delta-head">
                    <span>Room</span><span>Share</span><span>{youLabel}</span><span>{benchmarkLabel}</span><span>Gap</span>
                </div>
                {rows.map((r, i) => {
                    const yours = Number(r.yours || 0);
                    const bench = Number(r.benchmark || 0);
                    const delta = yours - bench;
                    const yPct = Math.max(2, Math.min(100, Math.abs(yours) / max * 100));
                    const bPct = Math.max(0, Math.min(100, Math.abs(bench) / max * 100));
                    return (
                        <div key={i} className="analytics-delta-row">
                            <strong>{r.label}</strong>
                            <div className="analytics-delta-track">
                                <div className="analytics-delta-fill" style={{ width: yPct + '%', background: r.color || '#4ECDC4' }} />
                                <div className="analytics-delta-benchmark" style={{ left: bPct + '%' }} />
                            </div>
                            <b>{r.format ? r.format(yours) : yours.toFixed(0)}</b>
                            <b>{r.format ? r.format(bench) : bench.toFixed(0)}</b>
                            <em className={delta >= 0 ? 'is-good' : 'is-bad'}>{signedNum(delta, r.suffix || '')}</em>
                        </div>
                    );
                })}
            </div>
        );
    };
    const AnalyticsDataStack = ({ rows }) => (
        <div className="analytics-data-stack">
            {rows.map((r, i) => (
                <div key={i} className="analytics-data-row">
                    <div>
                        <span>{r.kicker || r.label}</span>
                        <strong>{r.label}</strong>
                    </div>
                    <em>{r.detail}</em>
                    <b style={{ color: r.color || undefined }}>{r.value}</b>
                </div>
            ))}
        </div>
    );

    return (
    <div className="analytics-shell" style={{ padding: '10px 16px 16px' }}>
        <div className="wr-module-strip">
            <div className="wr-module-context">
                <span>Analytics</span>
                <strong>{activeSubTab.label}</strong>
                <em>{analyticsContext[activeSubTab.key]}</em>
            </div>
            <div className="wr-module-actions">
                <div className="wr-module-nav">
                    {subTabs.map(t => (
                        <button key={t.key} className={analyticsTab === t.key ? 'is-active' : ''} onClick={() => setAnalyticsTab(t.key)}>{t.navLabel || t.label}</button>
                    ))}
                </div>
                <span className="wr-module-pill">{d?.computedAt ? 'Updated ' + new Date(d.computedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Loading'}</span>
            </div>
        </div>

        <div className="analytics-definition">Elite player = 7000+ DHQ or top 5 at position. Elite team benchmarks compare against the league's proven top teams.</div>

        {!d ? (
            <div style={{ ...aCardStyle, color: 'var(--silver)', textAlign: 'center', padding: '40px' }}>
                {window.App?.LI_LOADED ? 'Computing analytics...' : 'League Intelligence is still loading. Please wait...'}
            </div>
        ) : (
        <React.Fragment>

        {/* ═══ ROSTER CONSTRUCTION ═══ */}
        {analyticsTab === 'roster' && (() => {
            const r = d.roster;
            if (!r) return <div style={{ color: 'var(--silver)' }}>No roster data available.</div>;
            const w = r.winnerProfile;
            const l = r.leagueProfile;
            const m = r.myProfile;
            // Elite = 7000+ DHQ or top 5 at position
            const playerScores = window.App?.LI?.playerScores || {};
            const SS = _SS;
            const allRosters = SS?.rosters || [];
            const winnerIds = new Set(d.winners || []);
            const hasEliteFn = typeof window.App?.countElitePlayers === 'function';
            function countElite(rosterList) {
                if (!rosterList.length) return 0;
                let total = 0;
                rosterList.forEach(ros => {
                    total += hasEliteFn ? window.App.countElitePlayers(ros.players || []) : (ros.players || []).filter(pid => (playerScores[pid] || 0) >= 7000).length;
                });
                return +(total / rosterList.length).toFixed(1);
            }
            const wElite = countElite(allRosters.filter(ros => winnerIds.has(ros.roster_id)));
            const lElite = countElite(allRosters);
            const myRid = SS?.myRosterId;
            const mElite = countElite(allRosters.filter(ros => ros.roster_id === myRid));

            // Health score
            let healthScore = 0;
            let tier = 'UNKNOWN';
            let needs = [];
            let assessment = null;
            try {
                if (window.assessTeamFromGlobal) {
                    assessment = window.assessTeamFromGlobal(myRid);
                    if (assessment) {
                        healthScore = assessment.healthScore || 0;
                        tier = (assessment.tier || 'UNKNOWN').toUpperCase();
                        needs = assessment.needs || [];
                    }
                }
            } catch(e) { window.wrLog('analytics.assessTeam', e); }
            // Winner avg health
            let winnerHealthTotal = 0, winnerHealthCount = 0;
            try {
                winnerIds.forEach(wid => {
                    if (window.assessTeamFromGlobal) {
                        const wa = window.assessTeamFromGlobal(wid);
                        if (wa) { winnerHealthTotal += wa.healthScore || 0; winnerHealthCount++; }
                    }
                });
            } catch(e) { window.wrLog('analytics.winnerHealth', e); }
            const winnerHealthAvg = winnerHealthCount > 0 ? Math.round(winnerHealthTotal / winnerHealthCount) : 0;
            const healthDelta = healthScore - winnerHealthAvg;

            // Compete window
            const compWindow = d.window || {};
            const compYears = compWindow.years || 0;
            // Avg compete window — dead code removed

            // KPI sparkline data: build from projection years
            const projData = (d.projection || []).map(p => p.projectedDHQ);
            const healthData = (d.projection || []).map(p => p.projectedHealth || healthScore);

            // ── KPI Card style ──
            const kpiCardStyle = {
                background: 'linear-gradient(135deg, rgba(26,26,26,0.95), rgba(10,10,10,0.98))',
                border: '1px solid rgba(212,175,55,0.25)',
                borderRadius: '10px',
                padding: '10px 12px 8px',
                flex: '1 1 0',
                minWidth: '140px',
                position: 'relative',
                overflow: 'hidden',
            };
            const kpiNumberStyle = {
                fontFamily: 'Rajdhani, sans-serif',
                fontSize: '1.8rem',
                lineHeight: 1,
                color: 'var(--white)',
                marginBottom: '2px',
            };
            const kpiLabelStyle = {
                fontFamily: 'var(--font-body)',
                fontSize: '0.68rem',
                color: 'var(--silver)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                opacity: 0.7,
            };
            const kpiDeltaStyle = (positive) => ({
                fontFamily: 'var(--font-body)',
                fontSize: '0.75rem',
                fontWeight: 600,
                color: positive ? goodColor : badColor,
                marginTop: '4px',
            });

            // ── Position data for BarChart ──
            const posOrder = ['QB','RB','TE','WR','K','DL','LB','DB'];
            const allPos = [...new Set([...Object.keys(w.posInvestment || {}), ...Object.keys(m.posInvestment || {})])].filter(p => p !== 'UNK').sort((a,b) => { const ia = posOrder.indexOf(a); const ib = posOrder.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
            const posBarItems = allPos.map(pos => ({
                label: pos,
                value: Math.round((m.posInvestment[pos] || 0) * 100),
                color: '#4ECDC4',
            }));
            const posBarWinnerItems = allPos.map(pos => ({
                label: pos,
                value: Math.round((w.posInvestment[pos] || 0) * 100),
                color: CHART_COLORS?.gold || '#D4AF37',
            }));

            // ── Radar data ──
            const radarValues = {};
            allPos.forEach(pos => {
                const wPct = (w.posInvestment[pos] || 0) * 100;
                const mPct = (m.posInvestment[pos] || 0) * 100;
                radarValues[pos] = Math.min(100, Math.round(mPct / Math.max(wPct, 1) * 100));
            });

            // ── Rankings: all teams sorted by health ──
            const teamRankings = [];
            allRosters.forEach(ros => {
                let hs = 0, tier = '';
                try {
                    if (window.assessTeamFromGlobal) {
                        const a = window.assessTeamFromGlobal(ros.roster_id);
                        if (a) { hs = a.healthScore || 0; tier = a.tier || ''; }
                    }
                } catch(e) { window.wrLog('rankings.assessTeam', e); }
                const totalDhq = (ros.players || []).reduce((s, pid) => s + (playerScores[pid] || 0), 0);
                const s = ros.settings || {};
                const rUser = currentLeague.users?.find(u => u.user_id === ros.owner_id);
                teamRankings.push({
                    rosterId: ros.roster_id,
                    name: ownerNameSafe(ros.roster_id),
                    teamName: rUser?.metadata?.team_name || '',
                    avatar: rUser?.avatar || null,
                    wins: s.wins || 0,
                    losses: s.losses || 0,
                    healthScore: hs,
                    totalDhq,
                    tier,
                    isMe: ros.roster_id === myRid,
                });
            });
            teamRankings.sort((a, b) => b.healthScore - a.healthScore);

            // ── Insight cards ──
            const insights = [];
            const projMyAgeInsight = m.avgAge + (timeDelta || 0);
            const ageDiff = projMyAgeInsight - w.avgAge;
            if (Math.abs(ageDiff) > 0.3) {
                insights.push({
                    color: ageDiff > 0 ? badColor : goodColor,
                    title: ageDiff > 0 ? 'Roster Running Older' : 'Youth Advantage',
                    text: 'Your roster is ' + Math.abs(ageDiff).toFixed(1) + ' years ' + (ageDiff > 0 ? 'older' : 'younger') + ' than champion average (' + w.avgAge.toFixed(1) + ' yrs).' + (timeDelta ? ' (projected for ' + timeYear + ')' : ''),
                });
            }
            if (m.avgBenchQuality < w.avgBenchQuality * 0.75) {
                insights.push({
                    color: warnColor,
                    title: 'Bench Depth Concern',
                    text: 'Bench quality (' + numFmt(m.avgBenchQuality) + ') is significantly below elite tier benchmark (' + numFmt(w.avgBenchQuality) + ').',
                });
            }
            if (m.avgTotalDHQ < w.avgTotalDHQ * 0.85) {
                insights.push({
                    color: badColor,
                    title: 'Total Value Gap',
                    text: 'Your total DHQ (' + numFmt(m.avgTotalDHQ) + ') trails elite tier average (' + numFmt(w.avgTotalDHQ) + ') by ' + Math.round((1 - m.avgTotalDHQ / w.avgTotalDHQ) * 100) + '%.',
                });
            }
            if (compYears >= 3) {
                insights.push({
                    color: goodColor,
                    title: 'Strong Compete Window',
                    text: compYears + ' years remaining in your competitive window. Maximize with targeted upgrades.',
                });
            }

            const rosterNeedGaps = (needs || []).map(n => {
                const data = assessment?.posAssessment?.[n.pos] || {};
                const required = data.minQuality || data.startingReq || data.ideal || 1;
                const have = data.nflStarters ?? data.actual ?? 0;
                const priority = n.urgency === 'deficit' ? 'critical' : 'high';
                return {
                    priority,
                    pos: n.pos,
                    action: (n.urgency === 'deficit' ? 'Add ' : 'Build ') + n.pos + (n.urgency === 'deficit' ? ' starter coverage' : ' depth'),
                    detail: n.pos + ' is a current roster ' + n.urgency + ': ' + have + '/' + required + ' starter-quality players by league settings.',
                    source: 'roster-assessment',
                };
            });
            const needsSet = new Set(rosterNeedGaps.map(g => g.pos));
            const templateGaps = (d.gaps || r.gaps || [])
                .filter(g => !g.pos || !needsSet.has(g.pos))
                .map(g => ({
                    ...g,
                    action: g.action || (g.area ? 'Template gap: ' + g.area : 'Champion-template gap'),
                    source: 'champion-template',
                }));
            const gapsList = [...rosterNeedGaps, ...templateGaps];
            const investmentRows = allPos.map(pos => ({
                label: pos,
                yours: Math.round((m.posInvestment[pos] || 0) * 100),
                benchmark: Math.round((w.posInvestment[pos] || 0) * 100),
                suffix: ' pts',
                format: v => Math.round(v) + '%',
                color: needsSet.has(pos) ? badColor : '#4ECDC4',
            }));
            // ── Roster command summary ──
            const projMyAge = m.avgAge + (timeDelta || 0);
            const projWAge = w.avgAge; // champion profile is historical, no projection needed
            const ageDiffDiag = projMyAge - projWAge;
            const eliteDiffDiag = mElite - wElite;
            const dhqGap = m.avgTotalDHQ - w.avgTotalDHQ;
            const benchGap = m.avgBenchQuality - w.avgBenchQuality;
            const rosterStrategy = ageDiffDiag > 1.5 && dhqGap < 0 ? 'sell aging veterans and acquire young elites'
                : eliteDiffDiag < -1 ? 'buy young elite players to close the talent gap'
                : dhqGap >= 0 && ageDiffDiag <= 0.5 ? 'hold course — your roster matches the elite tier template'
                : 'target strategic upgrades at your weakest positions';
            const rosterProofItems = [
                { label: 'Champion Value Gap', value: signedNum(dhqGap, ' DHQ'), detail: 'You vs elite tier total roster DHQ template.', tone: toneFromDelta(dhqGap), color: dhqGap >= 0 ? goodColor : badColor },
                { label: 'Elite Asset Gap', value: signedNum(eliteDiffDiag), detail: 'Elite player count vs champion benchmark.', tone: toneFromDelta(eliteDiffDiag), color: eliteDiffDiag >= 0 ? goodColor : badColor },
                { label: 'Bench Quality Gap', value: signedNum(Math.round(benchGap)), detail: 'Depth buffer compared with winning rosters.', tone: toneFromDelta(benchGap), color: benchGap >= 0 ? goodColor : badColor },
                { label: 'Age Window Delta', value: signedNum(Number(ageDiffDiag.toFixed(1)), ' yrs'), detail: 'Negative means younger than the winner template.', tone: Math.abs(ageDiffDiag) <= 1 ? 'good' : ageDiffDiag > 0 ? 'warn' : 'good', color: Math.abs(ageDiffDiag) <= 1 ? goodColor : warnColor },
            ];
            const gapRows = (gapsList.length ? gapsList.slice(0, 6) : [{ action: 'No critical construction gap', detail: 'Roster template is not flagging a major room-level deficit.', priority: 'low' }])
                .map(g => ({
                    kicker: (g.source === 'roster-assessment' ? 'Current Need' : 'Champion Template'),
                    label: g.action || g.area || 'Roster signal',
                    detail: g.detail || 'Use module tabs to inspect the player-level evidence behind this room.',
                    value: (g.priority || g.severity || 'low').toUpperCase(),
                    color: sevColor(g.priority || g.severity || 'low'),
                }));

            return (
            <React.Fragment>
                <AnalyticsCommandPanel
                    title="What exactly separates this roster from the league's winning build?"
                    thesis={'Analytics is now reading your roster as evidence: winner-template gaps, room-level coverage, age-window risk, and the positions where a move actually changes your title path. Suggested operating thesis: ' + rosterStrategy + '.'}
                    stats={[
                        { label: 'Evidence Set', value: allRosters.length + ' teams', sub: 'live league rosters' },
                        { label: 'Champion Sample', value: (winnerIds.size || 0) + ' teams', sub: 'completed winners' },
                        { label: 'Current Tier', value: tier || 'UNKNOWN', sub: healthScore + ' health', color: tier === 'REBUILDING' ? badColor : tier === 'CONTENDER' || tier === 'ELITE' ? goodColor : warnColor },
                        { label: 'Window', value: compYears + ' yr', sub: compWindow.label || 'projection model' },
                    ]}
                />

                <AnalyticsProofGrid items={rosterProofItems} />

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Champion Blueprint</span>
                        <strong>Position Investment Delta</strong>
                        <p>Bars show your DHQ share by room. The gold marker is the champion-template share. This answers where your roster is structurally over- or under-weighted, not just whether a single KPI is high.</p>
                        <AnalyticsDeltaRows rows={investmentRows} benchmarkLabel="Elite" />
                    </div>
                    <div className="analytics-lab-card">
                        <span>Priority Evidence</span>
                        <strong>Rooms To Fix First</strong>
                        <p>These are the roster-construction gaps that should drive Trade Center and Free Agency decisions. Each row is a data-backed reason, not a generic status card.</p>
                        <AnalyticsDataStack rows={gapRows} />
                    </div>
                </div>

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Coverage Matrix</span>
                        <strong>Starter Quality By Room</strong>
                        <p>Coverage is measured against league settings and room requirements. Red rooms need usable bodies; green rooms are possible trade surplus.</p>
                        <div className="analytics-chip-grid">
                            {['QB','RB','WR','TE','K','DL','LB','DB'].map(pos => {
                                const assessPos = assessment?.posAssessment?.[pos] || {};
                                const have = assessPos.nflStarters ?? assessPos.actual ?? 0;
                                const need = assessPos.minQuality || assessPos.startingReq || assessPos.ideal || 0;
                                const weak = (needs || []).some(n => (typeof n === 'string' ? n : n.pos) === pos);
                                const tone = weak ? 'bad' : have > need && need > 0 ? 'good' : 'neutral';
                                return (
                                    <div key={pos} className={'analytics-room-chip is-' + tone}>
                                        <strong>{pos}</strong>
                                        <span>{need ? have + '/' + need : have}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="analytics-lab-card">
                        <span>Next Workbench</span>
                        <strong>Where This Data Should Send You</strong>
                        <p>Analytics should prove the move, then route you to the module that executes it.</p>
                        <div className="analytics-signal-list">
                            <div className="analytics-signal analytics-signal-high"><strong>Trade Center</strong><span>Use the partner finder to turn weak rooms into targeted packages.</span></div>
                            <div className="analytics-signal analytics-signal-medium"><strong>Free Agency</strong><span>Use the waiver board for cheap depth in thin starter-quality rooms.</span></div>
                            <div className="analytics-signal analytics-signal-low"><strong>My Roster</strong><span>Use granular roster views for player-level keep/sell/stash decisions.</span></div>
                        </div>
                    </div>
                </div>

                {/* ── INSIGHT CARDS ── */}
                {insights.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px' }}>
                    {insights.map((ins, i) => (
                        <div key={i} style={{
                            background: 'rgba(26,26,26,0.8)', borderRadius: '10px', padding: '14px 16px',
                            borderLeft: '4px solid ' + ins.color,
                            border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700, color: ins.color, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {ins.title}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.5 }}>{ins.text}</div>
                        </div>
                    ))}
                </div>
                )}

                {/* ── 5-YEAR OUTLOOK (moved from Projections) ── */}
                {(() => {
                    const proj = d.projection;
                    const win = d.window;
                    if (!proj || !proj.length) return null;
                    const maxDHQ = Math.max(...proj.map(p => p.projectedDHQ), 1);
                    const tierColor = (tier) => tier === 'Contender' ? goodColor : tier === 'Playoff Team' ? warnColor : badColor;
                    return (
                        <div style={{ ...aCardStyle, marginTop: '12px' }}>
                            <div style={aHeaderStyle}><span>YOUR 5-YEAR OUTLOOK</span></div>
                            {proj.map((p, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                                    <span style={{ color: 'var(--silver)', fontFamily: 'var(--font-body)', minWidth: '40px', fontSize: '0.9rem' }}>{p.year}</span>
                                    <div style={{ flex: 1, position: 'relative', height: '24px', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', overflow: 'hidden' }}>
                                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: (p.projectedDHQ / maxDHQ * 100) + '%', background: tierColor(p.tier), borderRadius: '6px', opacity: 0.6, transition: 'width 0.5s ease' }} />
                                        <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '0.75rem', fontFamily: 'var(--font-body)', color: 'var(--white)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                            {p.projectedDHQ.toLocaleString()} DHQ
                                        </div>
                                    </div>
                                    <span style={{ color: tierColor(p.tier), fontFamily: 'var(--font-body)', fontSize: '0.8rem', minWidth: '90px', textAlign: 'right' }}>
                                        {p.tier} {p.tier === 'Rebuilding' || p.tier === 'Deep Rebuild' ? '\uD83D\uDD34' : p.tier === 'Playoff Team' ? '\u26A0\uFE0F' : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                    );
                })()}

                {/* ── AGING CLIFF ALERT (moved from Projections) ── */}
                {(() => {
                    const S2 = _SS;
                    const LI2 = window.App?.LI || {};
                    const ps2 = LI2.playerScores || {};
                    const pm2 = LI2.playerMeta || {};
                    const pw2 = window.App?.peakWindows || {};
                    const myRid2 = S2?.myRosterId;
                    const myRos2 = (S2?.rosters || []).find(r => r.roster_id === myRid2);
                    const myPl2 = myRos2?.players || [];
                    let tDHQ2 = 0, arDHQ2 = 0;
                    const arPlayers2 = [];
                    myPl2.forEach(pid => {
                        const dq = ps2[pid] || 0;
                        const mt = pm2[pid] || {};
                        tDHQ2 += dq;
                        if (!mt.age || !mt.pos) return;
	                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
	                            ? window.App.getValueWindowEnd(mt.pos)
	                            : ((window.App.peakWindows || {})[mt.pos] || [23, 29])[1];
	                        if (mt.age + 2 > valueEnd && dq >= 2000) {
                            arDHQ2 += dq;
                            arPlayers2.push({ name: playersData[pid]?.full_name || S2?.players?.[pid]?.full_name || mt.name || ('Player ' + pid), age: mt.age, dhq: dq });
                        }
                    });
                    const arPct2 = tDHQ2 > 0 ? Math.round(arDHQ2 / tDHQ2 * 100) : 0;
                    arPlayers2.sort((a, b) => b.dhq - a.dhq);
                    if (!arPlayers2.length && arPct2 === 0) return null;
                    return (
                        <div style={{ ...aCardStyle, marginTop: '12px' }}>
                            <div style={aHeaderStyle}><span>AGING CLIFF ALERT</span></div>
	                            <div style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px', lineHeight: 1.5 }}>Players within 2 years of their position's value-window end with 2000+ DHQ value. These are your highest-risk assets for dynasty value decline.</div>
                            <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', color: arPct2 > 30 ? badColor : arPct2 > 15 ? warnColor : goodColor }}>{arPct2}%</div>
	                                    <div style={{ fontSize: '0.75rem', color: 'var(--silver)' }}>Your DHQ near value cliff by {(parseInt(S2?.season) || 2026) + 2}</div>
                                </div>
                                <div style={{ textAlign: 'center' }}>
                                    {(() => {
                                        let lgT = 0, lgA = 0;
                                        (S2?.rosters || []).forEach(r => {
                                            (r.players || []).forEach(pid => {
                                                const dv = ps2[pid] || 0;
                                                const mv = pm2[pid] || {};
                                                lgT += dv;
                                                if (mv.age && mv.pos) {
                                                    const pe = ((window.App?.peakWindows || {})[mv.pos] || [23,29])[1];
                                                    if (mv.age + 2 > pe && dv >= 2000) lgA += dv;
                                                }
                                            });
                                        });
                                        const lgP = lgT > 0 ? Math.round(lgA / lgT * 100) : 0;
                                        return <>
                                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', color: 'var(--gold)' }}>{lgP}%</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--silver)' }}>League avg</div>
                                        </>;
                                    })()}
                                </div>
                            </div>
                            {arPlayers2.length > 0 && (
                                <div>
                                    <div style={{ color: 'var(--silver)', fontSize: '0.8rem', marginBottom: '6px', fontWeight: 700 }}>Players at risk:</div>
                                    {arPlayers2.slice(0, 5).map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '0.85rem', fontFamily: 'var(--font-body)' }}>
                                            <span style={{ color: 'var(--silver)' }}>{p.name} ({p.age})</span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ color: badColor }}>{p.dhq.toLocaleString()} DHQ</span>
                                                <span style={{ padding: '2px 8px', background: 'rgba(231,76,60,0.15)', color: badColor, borderRadius: '4px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em' }}>TRADE NOW</span>
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })()}
            </React.Fragment>
            );
        })()}

        {/* ═══ DRAFT INTELLIGENCE ═══ */}
        {analyticsTab === 'draft' && (() => {
            const dr = d.draft;
            if (!dr) return <div style={{ color: 'var(--silver)' }}>No draft data available.</div>;
            const rounds = Object.keys(dr.winnerDraftProfile || {}).map(Number).sort((a, b) => a - b);
            const S = _SS;
            const myRid = S?.myRosterId;
            const draftOutcomes = (window.App?.LI || {}).draftOutcomes || [];
            const myDraftProfile = {};
            rounds.forEach(rd => {
                const myPicks = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid);
                if (!myPicks.length) return;
                const posCounts = {};
                myPicks.forEach(dp => { const pos = dp.pos || 'UNK'; posCounts[pos] = (posCounts[pos] || 0) + 1; });
                myDraftProfile[rd] = {};
                Object.entries(posCounts).forEach(([pos, cnt]) => { myDraftProfile[rd][pos] = +(cnt / myPicks.length).toFixed(2); });
            });
            let totalHitDiff = 0;
            let hitRounds = 0;
            let winnerHitAvg = 0, leagueHitAvg = 0;
            rounds.forEach(rd => {
                const hr = dr.winnerHitRate[rd];
                if (!hr) return;
                totalHitDiff += (hr.winners - hr.league);
                winnerHitAvg += hr.winners;
                leagueHitAvg += hr.league;
                hitRounds++;
            });
            const avgHitAdv = hitRounds > 0 ? totalHitDiff / hitRounds : 0;
            winnerHitAvg = hitRounds > 0 ? winnerHitAvg / hitRounds : 0;
            leagueHitAvg = hitRounds > 0 ? leagueHitAvg / hitRounds : 0;
            const grades = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D'];
            const gradeIdx = Math.min(grades.length - 1, Math.max(0, Math.round(4 - avgHitAdv * 20)));
            const totalMyPicks = draftOutcomes.filter(dp => dp.roster_id === myRid).length;
            // Compute top draft position for winners
            const winnerTopPos = {};
            rounds.forEach(rd => {
                Object.entries(dr.winnerDraftProfile[rd] || {}).forEach(([pos, pct]) => {
                    winnerTopPos[pos] = (winnerTopPos[pos] || 0) + pct;
                });
            });
            const topDraftTarget = Object.entries(winnerTopPos).sort((a,b) => b[1] - a[1])[0];

            // KPI card style
            const dKpiCardStyle = {
                background: 'linear-gradient(135deg, rgba(26,26,26,0.95), rgba(10,10,10,0.98))',
                border: '1px solid rgba(212,175,55,0.25)',
                borderRadius: '14px',
                padding: '20px 18px 14px',
                flex: '1 1 0',
                minWidth: '140px',
            };
            const dKpiNum = { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.2rem', lineHeight: 1, color: 'var(--white)', marginBottom: '2px' };
            const dKpiLabel = { fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 };

            // Build bar chart items for hit rate by round
            const hitRateBarItems = rounds.filter(rd => dr.winnerHitRate[rd]).map(rd => ({
                label: 'R' + rd,
                value: Math.round((dr.winnerHitRate[rd].winners || 0) * 100),
                color: goodColor,
            }));
            const hitRateLeagueItems = rounds.filter(rd => dr.winnerHitRate[rd]).map(rd => ({
                label: 'R' + rd,
                value: Math.round((dr.winnerHitRate[rd].league || 0) * 100),
                color: 'rgba(192,192,192,0.6)',
            }));

            // ── Draft Strategy Summary ──
            const myHitRates = {};
            rounds.forEach(rd => {
                const myPicks = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid);
                if (!myPicks.length) return;
                const hits = myPicks.filter(dp => dp.isHit).length;
                myHitRates[rd] = myPicks.length > 0 ? hits / myPicks.length : 0;
            });
            const myR1Hit = myHitRates[1] || 0;
            const winnerR1Hit = (dr.winnerHitRate[1] || {}).winners || 0;
            const topDraftPos = topDraftTarget ? topDraftTarget[0] : 'RB/WR';
            const draftGradeLetter = grades[gradeIdx];
            const leagueSeason = parseInt(currentLeague?.season || activeYear, 10) || new Date().getFullYear();
            const draftRounds = Number(currentLeague?.settings?.draft_rounds || 5);
            const totalTeams = leagueRosters.length || 12;
            const tradedPicks = _SS.tradedPicks || [];
            const pickValue = (yr, rd) => window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || Math.max(100, 9000 - rd * 1600);
            const currentPicks = [];
            for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                for (let rd = 1; rd <= draftRounds; rd++) {
                    const ownMoved = tradedPicks.find(p => sameId(p.season, yr) && Number(p.round) === rd && sameId(p.roster_id, myRid) && !sameId(p.owner_id, myRid));
                    if (!ownMoved) currentPicks.push({ year: yr, round: rd, own: true, label: (yr === leagueSeason ? 'R' : String(yr).slice(-2) + ' R') + rd, value: pickValue(yr, rd) });
                    tradedPicks
                        .filter(p => sameId(p.season, yr) && Number(p.round) === rd && sameId(p.owner_id, myRid) && !sameId(p.roster_id, myRid))
                        .forEach(p => currentPicks.push({ year: yr, round: rd, own: false, from: ownerNameSafe(p.roster_id), label: (yr === leagueSeason ? 'R' : String(yr).slice(-2) + ' R') + rd + ' via ' + ownerNameSafe(p.roster_id), value: pickValue(yr, rd) }));
                }
            }
            const currentPickValue = currentPicks.reduce((s, p) => s + (p.value || 0), 0);
            const earlyPicks = currentPicks.filter(p => p.round <= 2).length;
            const topCurrentPicks = [...currentPicks].sort((a, b) => b.value - a.value || a.year - b.year || a.round - b.round).slice(0, 5);
            const draftProofItems = [
                { label: 'Hit Rate Edge', value: signedNum(Math.round(avgHitAdv * 100), ' pts'), detail: 'Elite tier average hit-rate advantage by round.', tone: toneFromDelta(avgHitAdv), color: avgHitAdv >= 0 ? goodColor : badColor },
                { label: 'R1 Benchmark', value: pctFmt(winnerR1Hit), detail: 'Elite tier first-round hit rate in this league.', tone: 'good', color: goodColor },
                { label: 'Your R1 History', value: pctFmt(myR1Hit), detail: totalMyPicks ? 'Your recorded first-round conversion.' : 'No first-round history loaded yet.', tone: myR1Hit >= winnerR1Hit ? 'good' : 'warn', color: myR1Hit >= winnerR1Hit ? goodColor : warnColor },
                { label: 'Current Capital', value: currentPickValue.toLocaleString(), detail: currentPicks.length + ' current picks, ' + earlyPicks + ' in R1-R2.', tone: earlyPicks >= 3 ? 'good' : 'warn', color: earlyPicks >= 3 ? goodColor : warnColor },
            ];
            const hitRows = rounds.filter(rd => dr.winnerHitRate[rd]).map(rd => ({
                label: 'R' + rd,
                yours: Math.round(((myHitRates[rd] || 0) * 100)),
                benchmark: Math.round(((dr.winnerHitRate[rd].winners || 0) * 100)),
                suffix: ' pts',
                format: v => Math.round(v) + '%',
                color: (myHitRates[rd] || 0) >= (dr.winnerHitRate[rd].winners || 0) ? goodColor : warnColor,
            }));
            const curvePickCount = totalTeams * draftRounds;
            const curveSlots = [...new Set([1, 2, 3, 4, Math.ceil(totalTeams / 2), totalTeams, totalTeams + 1, totalTeams * 2, totalTeams * 3, Math.max(1, curvePickCount - Math.floor(curvePickCount * 0.12)), curvePickCount])].filter(p => p <= curvePickCount);
            const curveValues = curveSlots.map(p => (typeof window.getIndustryPickValue === 'function' ? window.getIndustryPickValue(p, totalTeams, draftRounds) : Math.max(50, 7500 - p * 100)));
            const curveMax = Math.max(...curveValues, 1);
            const draftRows = topCurrentPicks.length ? topCurrentPicks.map(p => ({
                kicker: p.own ? 'Owned Pick' : 'Acquired Pick',
                label: p.label,
                detail: p.own ? 'Original pick path' : 'From ' + (p.from || 'another roster'),
                value: (p.value || 0).toLocaleString(),
                color: p.round <= 2 ? 'var(--gold)' : '#9b8afb',
            })) : [{ kicker: 'Pick Path', label: 'No current picks loaded', detail: 'Draft pick source did not return current inventory.', value: '\u2014' }];

            return (
            <React.Fragment>
                <AnalyticsCommandPanel
                    title="What does this league actually reward in the draft?"
                    thesis="Draft analytics should not be another pick-count dashboard. This lab separates slot value, round hit-rate, current pick path, and the position patterns that have historically produced title rosters."
                    stats={[
                        { label: 'Draft Grade', value: grades[gradeIdx], sub: 'hit-rate evidence', color: gradeIdx <= 2 ? goodColor : gradeIdx <= 5 ? warnColor : badColor },
                        { label: 'Elite R1 Hit', value: pctFmt(winnerR1Hit), sub: 'winner sample' },
                        { label: 'Capital Loaded', value: currentPicks.length || '\u2014', sub: currentPickValue.toLocaleString() + ' DHQ' },
                        { label: 'Template Lean', value: topDraftPos, sub: 'early-round position signal' },
                    ]}
                />

                <AnalyticsProofGrid items={draftProofItems} />

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Pick Value Curve</span>
                        <strong>Slot EV, Not Round Labels</strong>
                        <p>The shared pick-value file drives this curve. It shows why a specific slot should be treated differently than a generic future round.</p>
                        <div className="analytics-curve">
                            {curveValues.map((v, i) => <i key={i} title={curveSlots[i] + ': ' + v} style={{ height: Math.max(5, Math.round(v / curveMax * 100)) + '%' }} />)}
                        </div>
                        <div className="analytics-pick-strip" style={{ marginTop: '8px' }}>
                            {curveSlots.slice(0, 7).map((p, i) => <span key={p}>P{p} <em>{curveValues[i].toLocaleString()}</em></span>)}
                        </div>
                    </div>
                    <div className="analytics-lab-card">
                        <span>Current Capital</span>
                        <strong>Pick Path Workbench</strong>
                        <p>These are the picks that should drive trade-up, trade-down, or consolidation decisions. Acquired picks are shown as independent capital, not blended away.</p>
                        <AnalyticsDataStack rows={draftRows} />
                    </div>
                </div>

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Round Conversion</span>
                        <strong>Your Hit Rate Vs Winner Benchmark</strong>
                        <p>Gold markers are the historical elite-tier standard. The bar is your recorded conversion by round.</p>
                        <AnalyticsDeltaRows rows={hitRows} benchmarkLabel="Elite" />
                    </div>
                    <div className="analytics-lab-card">
                        <span>Winner Formula</span>
                        <strong>Position Mix By Round</strong>
                        {rounds.map(rd => {
                            const wProf = dr.winnerDraftProfile[rd] || {};
                            const myProf = myDraftProfile[rd] || {};
                            const sorted = Object.entries(wProf).sort((a, b) => b[1] - a[1]);
                            return (
                            <div key={rd} style={{ marginBottom: '10px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', minWidth: '65px' }}>Round {rd}</span>
                                    <div style={{ flex: 1, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {sorted.map(([pos, pct]) => (
                                            <span key={pos} style={{
                                                fontSize: '0.72rem', fontFamily: 'var(--font-body)', padding: '2px 8px',
                                                borderRadius: '10px', background: 'rgba(212,175,55,0.12)', color: 'var(--gold)',
                                                border: '1px solid rgba(212,175,55,0.25)',
                                            }}>{pos} {pctFmt(pct)}</span>
                                        ))}
                                    </div>
                                </div>
                                {Object.keys(myProf).length > 0 && (
                                    <div style={{ marginLeft: '65px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                        {Object.entries(myProf).sort((a, b) => b[1] - a[1]).map(([pos, pct]) => (
                                            <span key={pos} style={{
                                                fontSize: '0.68rem', fontFamily: 'var(--font-body)', padding: '1px 6px',
                                                borderRadius: '8px', background: 'rgba(78,205,196,0.1)', color: '#4ECDC4',
                                                border: '1px solid rgba(78,205,196,0.2)',
                                            }}>{pos} {pctFmt(pct)}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                            );
                        })}
                        <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: '0.7rem' }}>
                            <span style={{ color: 'var(--gold)' }}>{'\u25A0'} Elite Tier</span>
                            <span style={{ color: '#4ECDC4' }}>{'\u25A0'} You</span>
                        </div>
                    </div>
                </div>
            </React.Fragment>
            );
        })()}

        {/* ═══ MARKET MOVES INTELLIGENCE ═══ */}
        {analyticsTab === 'trades' && (() => {
            const tr = d.trades;
            if (!tr) return <div style={{ color: 'var(--silver)' }}>No trade data available.</div>;
            const wa = d.waivers || {};
            const wp = tr.winnerTradeProfile;
            const lp = tr.leagueTradeProfile;
            const mp = tr.myTradeProfile;
            const cleanPreference = (v) => (!v || v === 'Unknown') ? 'No pattern' : v;
            const waiverBudget = Number(currentLeague?.settings?.waiver_budget || 0);
            const waiverUsed = Number(myRoster?.settings?.waiver_budget_used || 0);
            const faabRemaining = waiverBudget > 0 ? Math.max(0, waiverBudget - waiverUsed) : null;
            const faabEfficiency = wa.faabEfficiency || {};
            const topFaabPos = Object.entries(wa.leagueFaabProfile || {})
                .sort((a, b) => (b[1].avg || 0) - (a[1].avg || 0))[0];
            const hasFaabEfficiency = Number.isFinite(Number(faabEfficiency.winners)) || Number.isFinite(Number(faabEfficiency.league));
            const topEffPos = Object.entries(wa.faabEffByPos || {})
                .sort((a, b) => (b[1].dhqPerDollar || 0) - (a[1].dhqPerDollar || 0))[0];
            const topPosBought = (prof) => {
                const entries = Object.entries(prof.positionsBought || {}).sort((a, b) => b[1] - a[1]);
                return entries.slice(0, 3).map(([p]) => p).join(', ') || '\u2014';
            };
            const alerts = [];
            if (mp.avgTradesPerSeason < lp.avgTradesPerSeason) alerts.push({ sev: 'medium', title: 'Low Trade Volume', msg: 'You trade below league average (' + mp.avgTradesPerSeason + ' vs ' + lp.avgTradesPerSeason + ' per season). Elite tier teams average ' + wp.avgTradesPerSeason + '.' });
            if (mp.avgValueGained < 0) alerts.push({ sev: 'high', title: 'Losing Value', msg: 'You\'re losing ' + Math.abs(mp.avgValueGained) + ' DHQ per trade on average. Elite tier teams gain +' + wp.avgValueGained + '.' });
            if (wp.partnerPreference && wp.partnerPreference !== 'Unknown' && wp.partnerPreference !== mp.partnerPreference) alerts.push({ sev: 'low', title: 'Trade Partner Strategy', msg: 'Elite tier teams target ' + cleanPreference(wp.partnerPreference) + ' teams. You trade with ' + cleanPreference(mp.partnerPreference) + ' teams.' });

            // Build position bought bar chart items
            const allBoughtPos = [...new Set([...Object.keys(wp.positionsBought || {}), ...Object.keys(mp.positionsBought || {})])].filter(p => p !== 'UNK').sort();
            const boughtBarWinner = allBoughtPos.map(pos => ({ label: pos, value: (wp.positionsBought || {})[pos] || 0, color: CHART_COLORS?.gold || '#D4AF37' }));
            const boughtBarYou = allBoughtPos.map(pos => ({ label: pos, value: (mp.positionsBought || {})[pos] || 0, color: '#4ECDC4' }));

            // KPI card style
            const tKpiCardStyle = {
                background: 'linear-gradient(135deg, rgba(26,26,26,0.95), rgba(10,10,10,0.98))',
                border: '1px solid rgba(212,175,55,0.25)',
                borderRadius: '14px',
                padding: '20px 18px 14px',
                flex: '1 1 0',
                minWidth: '140px',
            };
            const tKpiNum = { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.2rem', lineHeight: 1, color: 'var(--white)', marginBottom: '2px' };
            const tKpiLabel = { fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 };

            const valueDeltaColor = mp.avgValueGained >= 0 ? goodColor : badColor;
            const marketProofItems = [
                { label: 'Trade Frequency Edge', value: signedNum(Number((mp.avgTradesPerSeason - wp.avgTradesPerSeason).toFixed(1))), detail: 'Your trades per season vs elite-tier behavior.', tone: toneFromDelta(mp.avgTradesPerSeason - wp.avgTradesPerSeason), color: mp.avgTradesPerSeason >= wp.avgTradesPerSeason ? goodColor : warnColor },
                { label: 'Value Per Deal', value: signedNum(mp.avgValueGained, ' DHQ'), detail: 'Average DHQ gained/lost in completed trades.', tone: toneFromDelta(mp.avgValueGained), color: valueDeltaColor },
                { label: 'FAAB Leverage', value: faabRemaining == null ? '\u2014' : '$' + faabRemaining.toLocaleString(), detail: waiverBudget ? Math.round(faabRemaining / Math.max(waiverBudget, 1) * 100) + '% of budget remaining.' : 'No FAAB budget configured.', tone: faabRemaining == null ? 'warn' : faabRemaining >= waiverBudget * 0.5 ? 'good' : 'warn', color: faabRemaining == null ? 'var(--silver)' : faabRemaining >= waiverBudget * 0.5 ? goodColor : warnColor },
                { label: 'Best Waiver Yield', value: topEffPos ? topEffPos[0] : '\u2014', detail: topEffPos ? (topEffPos[1].dhqPerDollar || 0) + ' DHQ per FAAB dollar.' : 'Bid outcome sample is still thin.', tone: topEffPos ? 'good' : 'warn', color: topEffPos ? goodColor : warnColor },
            ];
            const tradeFlowRows = allBoughtPos.map(pos => ({
                label: pos,
                yours: (mp.positionsBought || {})[pos] || 0,
                benchmark: (wp.positionsBought || {})[pos] || 0,
                suffix: '',
                format: v => Math.round(v),
                color: '#7C6BF8',
            }));
            const marketRows = [
                { kicker: 'Partner Archetype', label: 'Elite teams trade with', detail: 'Preferred counterparty posture among title teams.', value: cleanPreference(wp.partnerPreference), color: 'var(--gold)' },
                { kicker: 'Your Pattern', label: 'You trade with', detail: 'Your observed partner preference.', value: cleanPreference(mp.partnerPreference), color: '#4ECDC4' },
                { kicker: 'Top Price Position', label: topFaabPos ? topFaabPos[0] : 'No FAAB history', detail: topFaabPos ? 'Average winning bid across waiver history.' : 'Transactions have not produced a market map yet.', value: topFaabPos ? '$' + Math.round(topFaabPos[1].avg || 0) : '\u2014', color: warnColor },
                { kicker: 'Winner Timing', label: 'Market entry point', detail: 'When title teams usually create transaction value.', value: (wa.winnerTiming?.early || 0) >= 0.5 ? 'Early' : (wa.winnerTiming?.mid || 0) >= (wa.winnerTiming?.late || 0) ? 'Mid' : 'Late', color: goodColor },
            ];

            // ── Trade Strategy Summary ──
            const tradeVolDiff = mp.avgTradesPerSeason - wp.avgTradesPerSeason;
            const hasTraded = mp.avgTradesPerSeason > 0;
            const tradeEfficiency = !hasTraded ? '' : mp.avgValueGained >= 0 ? 'trading efficiently' : 'over-paying in trades';
            const tradeActivity = !hasTraded ? '' : tradeVolDiff < -1 ? 'under-trading' : tradeVolDiff > 1 ? 'over-trading' : 'trading at the right frequency';

            const tradeSummaryText = !hasTraded
                ? 'You haven\u2019t made any trades yet. Active trading is a key trait of winning teams \u2014 elite tier teams average ' + wp.avgTradesPerSeason + ' trades/season and gain +' + wp.avgValueGained + ' DHQ per trade. Consider using the trade finder to identify value opportunities.'
                : 'You average ' + mp.avgTradesPerSeason + ' trades/season vs elite tier teams\' ' + wp.avgTradesPerSeason + '. You ' + (mp.avgValueGained >= 0 ? 'gain +' : 'lose ') + Math.abs(mp.avgValueGained) + ' DHQ per trade (elite tier: +' + wp.avgValueGained + '). You are ' + tradeActivity + ' and ' + tradeEfficiency + '. ' + (mp.avgValueGained < 0 ? 'Focus on extracting value \u2014 target aging stars from contenders or sell depreciating assets.' : 'Keep leveraging your trade edge to consolidate elite talent.');
            const assetListText = (items) => {
                const clean = (items || []).filter(x => x && x !== 'Unknown');
                return clean.length ? clean.join(', ') : 'Picks/assets';
            };

            return (
            <React.Fragment>
                <AnalyticsCommandPanel
                    title="Where is the league market mispricing value?"
                    thesis="Market analytics should explain owner behavior and price movement. This view separates trade liquidity, deal quality, waiver pricing, FAAB leverage, and position flow before sending you to Trade Center or Free Agency."
                    stats={[
                        { label: 'Trade Pattern', value: tradeActivity || 'No trades', sub: tradeEfficiency || 'sample pending', color: mp.avgValueGained >= 0 ? goodColor : badColor },
                        { label: 'Elite Volume', value: wp.avgTradesPerSeason, sub: 'trades per season' },
                        { label: 'High Price Room', value: topFaabPos ? topFaabPos[0] : '\u2014', sub: topFaabPos ? '$' + Math.round(topFaabPos[1].avg || 0) + ' avg bid' : 'bid history thin' },
                        { label: 'FAAB Left', value: faabRemaining == null ? '\u2014' : '$' + faabRemaining.toLocaleString(), sub: waiverBudget ? '$' + waiverBudget.toLocaleString() + ' budget' : 'no budget' },
                    ]}
                />

                <AnalyticsProofGrid items={marketProofItems} />

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Waiver Economy</span>
                        <strong>Position Price Map</strong>
                        <p>Average FAAB paid by room. Use this to decide whether a free-agent target is cheap relative to the league's actual market.</p>
                        <div className="analytics-mini-table">
                            {Object.entries(wa.leagueFaabProfile || {}).sort((a, b) => (b[1].avg || 0) - (a[1].avg || 0)).slice(0, 6).map(([pos, info]) => (
                                <div key={pos}><strong>{pos}</strong><span>${Math.round(info.avg || 0)} avg</span><em>{info.count || 0} bids</em></div>
                            ))}
                            {!Object.keys(wa.leagueFaabProfile || {}).length && <div><strong>No FAAB history</strong><span>Use Free Agency recommendations until transactions load.</span></div>}
                        </div>
                    </div>
                    <div className="analytics-lab-card">
                        <span>Market Clock</span>
                        <strong>When Winners Act</strong>
                        <p>Winner timing versus the league baseline. This is the calendar pressure behind buy/sell windows.</p>
                        <div className="analytics-mini-table">
                            {[
                                ['Early', wa.winnerTiming?.early, wa.leagueTiming?.early],
                                ['Mid', wa.winnerTiming?.mid, wa.leagueTiming?.mid],
                                ['Late', wa.winnerTiming?.late, wa.leagueTiming?.late],
                            ].map(([label, winners, league]) => (
                                <div key={label}><strong>{label}</strong><span>{pctFmt(winners || 0)} winners</span><em>{pctFmt(league || 0)} league</em></div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Trade Flow</span>
                        <strong>Positions Acquired Via Trade</strong>
                        <p>Bars show the positions you buy. Gold markers show elite-tier acquisition frequency.</p>
                        {tradeFlowRows.length ? <AnalyticsDeltaRows rows={tradeFlowRows} benchmarkLabel="Elite" /> : <div className="analytics-proof-card"><strong>No position trade flow yet</strong><em>Completed trade data has not yielded position movement.</em></div>}
                    </div>
                    <div className="analytics-lab-card">
                        <span>Owner Behavior</span>
                        <strong>Market Pattern Evidence</strong>
                        <p>Behavioral evidence explains where Trade Center should search first.</p>
                        <AnalyticsDataStack rows={marketRows} />
                    </div>
                </div>

                {/* ── YOUR LAST 5 TRADES ── */}
                {tr.myLast5 && tr.myLast5.length > 0 && (
                <AnalyticsReadout title="Your Recent Trade Performance" detail="Last five completed deals">
                        {tr.myLast5.map((trade, i) => {
                            const netDhq = trade.netDhq || 0;
                            const result = netDhq > 200 ? 'Won' : netDhq < -200 ? 'Lost' : 'Fair';
                            const resultColor = result === 'Won' ? goodColor : result === 'Lost' ? badColor : warnColor;
                            return (
                                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--gold)', fontFamily: 'var(--font-body)' }}>S{trade.season || '?'} W{trade.week || '?'}</span>
                                        <span style={{ fontSize: '0.68rem', fontFamily: 'var(--font-body)', padding: '2px 8px', borderRadius: '10px', background: resultColor + '22', color: resultColor, border: '1px solid ' + resultColor + '44', fontWeight: 700 }}>{result}</span>
                                    </div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--silver)', fontFamily: 'var(--font-body)' }}>
                                        {assetListText(trade.gave)} <span style={{ color: 'var(--gold)', margin: '0 4px' }}>{'\u2192'}</span> {assetListText(trade.got)}
                                    </div>
                                    <div style={{ fontSize: '0.75rem', fontFamily: 'var(--font-body)', color: netDhq >= 0 ? goodColor : badColor, fontWeight: 700 }}>
                                        {netDhq >= 0 ? '+' : ''}{netDhq.toLocaleString()} DHQ
                                    </div>
                                </div>
                            );
                        })}
                </AnalyticsReadout>
                )}

                {/* ── INSIGHT CARDS ROW ── */}
                {alerts.length > 0 && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
                    {alerts.map((a, i) => (
                        <div key={i} style={{
                            background: 'rgba(26,26,26,0.8)', borderRadius: '10px', padding: '14px 16px',
                            borderLeft: '4px solid ' + sevColor(a.sev),
                            border: '1px solid rgba(255,255,255,0.06)',
                        }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', fontWeight: 700, color: sevColor(a.sev), marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {a.title}
                            </div>
                            <div style={{ fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.5 }}>{a.msg}</div>
                        </div>
                    ))}
                </div>
                )}
            </React.Fragment>
            );
        })()}

        {/* ═══ PLAYOFF HISTORY ═══ */}
        {analyticsTab === 'playoffs' && (() => { try {
            const championships = window.App?.LI?.championships || {};
            const seasons = completedChampionshipEntries(championships);
            if (!seasons.length) return <div style={{ ...aCardStyle, color: 'var(--silver)', textAlign: 'center', padding: '40px' }}>No championship history available yet.</div>;

            // ── Playoff Profile Summary ──
            const myRidP = myRoster?.roster_id;
            let myChampionships = 0, myRunnerUps = 0, mySemiFinals = 0;
            seasons.forEach(([season, data]) => {
                if (sameId(data.champion, myRidP)) myChampionships++;
                if (sameId(data.runnerUp, myRidP)) myRunnerUps++;
                if ((data.semiFinals || data.semiFinalists || []).some(rid => sameId(rid, myRidP))) mySemiFinals++;
            });
            const myPlayoffAppearances = myChampionships + myRunnerUps;
            const bracketDataP = window.App?.LI?.bracketData || {};
            let playoffWins = 0, playoffLosses = 0;
            Object.values(bracketDataP).forEach(sData => {
                (sData?.winners || []).forEach(m => {
                    if (sameId(m.w, myRidP)) playoffWins++;
                    if (sameId(m.l, myRidP)) playoffLosses++;
                });
            });
            const playoffDiag = myChampionships > 0
                ? 'You have ' + myChampionships + ' championship' + (myChampionships > 1 ? 's' : '') + ' in ' + seasons.length + ' seasons.'
                : myRunnerUps > 0
                ? 'You have reached ' + myRunnerUps + ' final' + (myRunnerUps > 1 ? 's' : '') + ' but no championships in ' + seasons.length + ' seasons.'
                : 'You haven\'t reached the finals recently.';
            const playoffInsight = myRunnerUps > myChampionships && myRunnerUps > 0
                ? ' You struggle to close out championship matchups — consider roster upgrades at key playoff positions.'
                : myPlayoffAppearances === 0
                ? ' Focus on building a contender before worrying about playoff optimization.'
                : ' Your playoff track record is solid. Maintain your competitive edge.';
            const playoffProofItems = [
                { label: 'Titles', value: myChampionships, detail: seasons.length + ' completed seasons in evidence.', tone: myChampionships ? 'good' : 'warn', color: myChampionships ? 'var(--gold)' : 'var(--silver)' },
                { label: 'Finals Conversion', value: (myChampionships + myRunnerUps) ? Math.round(myChampionships / Math.max(myChampionships + myRunnerUps, 1) * 100) + '%' : '\u2014', detail: (myChampionships + myRunnerUps) + ' finals appearances.', tone: myChampionships >= myRunnerUps ? 'good' : 'warn', color: myChampionships >= myRunnerUps ? goodColor : warnColor },
                { label: 'Semifinal Reach', value: mySemiFinals, detail: 'Documented semifinal berths.', tone: mySemiFinals ? 'good' : 'warn', color: mySemiFinals ? '#4ECDC4' : 'var(--silver)' },
                { label: 'Playoff Record', value: playoffWins + '-' + playoffLosses, detail: 'Winners bracket games only.', tone: playoffWins >= playoffLosses ? 'good' : 'bad', color: playoffWins >= playoffLosses ? goodColor : badColor },
            ];

            return (
            <React.Fragment>
                <AnalyticsCommandPanel
                    title="What has the bracket proven about your title path?"
                    thesis={playoffDiag + playoffInsight + ' Trophy Room owns legacy; Analytics keeps the bracket evidence and roadblock data.'}
                    stats={[
                        { label: 'Completed Seasons', value: seasons.length, sub: 'with champion and runner-up' },
                        { label: 'Your Finals', value: myChampionships + myRunnerUps, sub: myRunnerUps + ' runner-up' },
                        { label: 'Roadblock Sample', value: (window.App?.detectRivalries?.(myRoster?.roster_id) || []).length, sub: 'repeat playoff opponents' },
                        { label: 'Bracket Games', value: playoffWins + playoffLosses, sub: 'winners bracket' },
                    ]}
                />

                <AnalyticsProofGrid items={playoffProofItems} />

                {(() => {
                    const detectRivalries = window.App?.detectRivalries;
                    const rivals = detectRivalries && myRoster ? detectRivalries(myRoster.roster_id) : [];
                    return (
                        <div className="analytics-action-grid">
                            <AnalyticsSection title="ROADBLOCKS" meta="Most frequent playoff opponents">
                                <div className="analytics-signal-list">
                                    {rivals && rivals.length ? rivals.slice(0, 3).map((r, i) => (
                                        <div key={i} className={'analytics-signal ' + (r.wins >= r.losses ? 'analytics-signal-low' : 'analytics-signal-high')}>
                                            <strong>{ownerNameSafe(r.rosterId)}</strong>
                                            <span>{r.wins}-{r.losses} across {r.total} playoff meetings</span>
                                        </div>
                                    )) : <div className="analytics-signal"><strong>No repeat roadblock</strong><span>No opponent has met you multiple times in the available bracket data.</span></div>}
                                </div>
                            </AnalyticsSection>
                            <AnalyticsSection title="RECENT FINISHES" meta="Champion / runner-up">
                                <div className="analytics-mini-table">
                                    {seasons.slice(0, 4).map(([season, data]) => (
                                        <div key={season}><strong>{season}</strong><span>{ownerNameSafe(data.champion)}</span><em>over {ownerNameSafe(data.runnerUp)}</em></div>
                                    ))}
                                </div>
                            </AnalyticsSection>
                        </div>
                    );
                })()}

                <div style={aCardStyle}>
                    <div style={aHeaderStyle}>TITLE PATH EVIDENCE</div>
                    {seasons.map(([season, data]) => {
                        const champName = ownerNameSafe(data.champion);
                        const runnerName = ownerNameSafe(data.runnerUp);
                        const isMyChamp = sameId(data.champion, myRoster?.roster_id);
                        const isMyRunner = sameId(data.runnerUp, myRoster?.roster_id);
                        const champRoster = rosterByAnyId(data.champion);
                        const champUser = currentLeague.users?.find(u => u.user_id === champRoster?.owner_id);
                        const runnerRoster = rosterByAnyId(data.runnerUp);
                        const runnerUser = currentLeague.users?.find(u => u.user_id === runnerRoster?.owner_id);
                        return (
                            <div key={season} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', color: 'var(--gold)', minWidth: '40px' }}>{season}</span>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: isMyChamp ? 'var(--gold)' : 'var(--white)', fontWeight: isMyChamp ? 700 : 400 }}>
                                        {champUser?.avatar && <img src={'https://sleepercdn.com/avatars/thumbs/' + champUser.avatar} style={{ width:'20px', height:'20px', borderRadius:'50%' }} onError={e => e.target.style.display='none'} />}
                                        Champion: {champName}{champUser?.metadata?.team_name ? ' (' + champUser.metadata.team_name + ')' : ''}{isMyChamp ? ' (You!)' : ''}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.78rem', color: 'var(--silver)' }}>
                                        {runnerUser?.avatar && <img src={'https://sleepercdn.com/avatars/thumbs/' + runnerUser.avatar} style={{ width:'20px', height:'20px', borderRadius:'50%' }} onError={e => e.target.style.display='none'} />}
                                        Runner-up: {runnerName}{isMyRunner ? ' (You)' : ''}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── FULL BRACKET DISPLAY ── */}
                {(() => {
                    const bracketData = window.App?.LI?.bracketData;
                    if (!bracketData || !Object.keys(bracketData).length) return null;
                    const completedSeasonSet = new Set(seasons.map(([season]) => String(season)));
                    const bracketSeasons = Object.entries(bracketData)
                        .filter(([season]) => completedSeasonSet.has(String(season)))
                        .sort(([a],[b]) => String(b).localeCompare(String(a)));
                    if (!bracketSeasons.length) return null;
                    return (
                        <div style={aCardStyle}>
                            <div style={aHeaderStyle}>BRACKET EVIDENCE</div>
                            {bracketSeasons.map(([season, sData]) => {
                                const brackets = [
                                    { key: 'winners', label: 'Winners Bracket', data: sData.winners || sData.w || [] },
                                    { key: 'losers', label: 'Losers Bracket', data: sData.losers || sData.l || [] },
                                ];
                                return (
                                    <div key={season} style={{ marginBottom: '12px' }}>
                                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', color: 'var(--gold)', marginBottom: '8px' }}>{season} Playoffs</div>
                                        {brackets.map(b => {
                                            if (!b.data || !b.data.length) return null;
                                            return (
                                                <div key={b.key} style={{ marginBottom: '12px' }}>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--silver)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{b.label}</div>
                                                    {b.data.map((matchup, mi) => {
                                                        const t1 = matchup.t1 || matchup.team1;
                                                        const t2 = matchup.t2 || matchup.team2;
                                                        const w = matchup.w || matchup.winner;
                                                        if (!isResolvedOwner(t1) || !isResolvedOwner(t2)) return null;
                                                        // Robust round label: handle 0-indexed rounds and missing values
                                                        let _mr = Math.max(...(b.data || []).map(m => m.r || m.round || 0), 0);
                                                        let _rd = matchup.r || matchup.round || 0;
                                                        // If all rounds are 0, try 1-indexing from matchup index
                                                        if (_mr <= 0) {
                                                            const uniqueRounds = [...new Set((b.data || []).map(m => m.r || m.round || 0))];
                                                            _mr = uniqueRounds.length || 1;
                                                            _rd = mi + 1; // fallback: use matchup index as round proxy
                                                        }
                                                        // If rounds appear 0-indexed (max round is 0-based), shift up by 1
                                                        if (_mr >= 1 && _rd === 0) { _rd = 1; }
                                                        // Debug log removed — was flooding console with every bracket matchup
                                                        const roundLabel = _rd === _mr ? 'Championship' : _rd === _mr - 1 ? 'Semi-finals' : _rd === _mr - 2 ? 'Quarter-finals' : 'Round ' + _rd;
                                                        const isMyGame = sameId(t1, myRidP) || sameId(t2, myRidP);
                                                        return (
                                                            <div key={mi} style={{
                                                                display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', marginBottom: '4px',
                                                                background: isMyGame ? 'rgba(212,175,55,0.06)' : 'rgba(255,255,255,0.02)',
                                                                borderLeft: isMyGame ? '3px solid var(--gold)' : '3px solid transparent',
                                                                borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'var(--font-body)',
                                                            }}>
                                                                <span style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.6, minWidth: '80px' }}>{roundLabel}</span>
                                                                <span style={{ color: sameId(w, t1) ? 'var(--gold)' : 'var(--silver)', fontWeight: sameId(w, t1) ? 700 : 400 }}>{ownerNameSafe(t1)}</span>
                                                                <span style={{ color: 'var(--silver)', opacity: 0.4, fontSize: '0.7rem' }}>vs</span>
                                                                <span style={{ color: sameId(w, t2) ? 'var(--gold)' : 'var(--silver)', fontWeight: sameId(w, t2) ? 700 : 400 }}>{ownerNameSafe(t2)}</span>
                                                                {w && <span style={{ color: 'var(--gold)', fontSize: '0.7rem', marginLeft: 'auto' }}>{'\u2192'} {ownerNameSafe(w)}</span>}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}

                {/* Rivalry Detection */}
                {(() => {
                    const detectRivalries = window.App?.detectRivalries;
                    if (!detectRivalries || !myRoster) return null;
                    const rivals = detectRivalries(myRoster.roster_id);
                    if (!rivals || !rivals.length) return null;
                    return (
                        <div style={aCardStyle}>
                            <div style={aHeaderStyle}>YOUR PLAYOFF RIVALRIES</div>
                            {rivals.map((r, i) => {
                                const rivalName = ownerNameSafe(r.rosterId);
                                return (
                                    <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.85rem', color: 'var(--white)', fontWeight: 600, flex: 1 }}>{rivalName}</span>
                                            <span style={{ fontSize: '0.78rem', color: r.wins > r.losses ? goodColor : r.wins < r.losses ? badColor : warnColor, fontWeight: 700, fontFamily: 'var(--font-body)' }}>{r.wins}-{r.losses}</span>
                                            <span style={{ fontSize: '0.74rem', color: 'var(--silver)' }}>{r.total} meetings</span>
                                        </div>
                                        {r.meetings && r.meetings.length > 0 && (
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                                                {r.meetings.map((mtg, mi) => (
                                                    <span key={mi} style={{ fontSize: '0.68rem', fontFamily: 'var(--font-body)', padding: '1px 6px', borderRadius: '8px', background: mtg.won ? 'rgba(46,204,113,0.1)' : 'rgba(231,76,60,0.1)', color: mtg.won ? goodColor : badColor, border: '1px solid ' + (mtg.won ? goodColor : badColor) + '33' }}>
                                                        Met in {mtg.bracket || 'Winners'} R{mtg.round || '?'} ({mtg.season || '?'})
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {(!r.meetings || !r.meetings.length) && (
                                            <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.65, marginTop: '2px' }}>{r.seasons.join(', ')}</div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    );
                })()}
            </React.Fragment>
            );
        } catch(e) { console.warn('[WarRoom] Playoffs render error:', e); return <div style={{ padding: '24px', textAlign: 'center', color: 'var(--silver)' }}>Playoff data could not be rendered. Check console for details.</div>; } })()}

        {/* ═══ TIMELINE ═══ */}
        {analyticsTab === 'timeline' && (() => {
            const championships = window.App?.LI?.championships || {};
            const championshipEntries = completedChampionshipEntries(championships);
            const completedChampionships = Object.fromEntries(championshipEntries);
            const tradeHistory = window.App?.LI?.tradeHistory || [];
            // Uses shared getOwnerName() passed as prop
            const events = [];

            championshipEntries.forEach(([season, data]) => {
                if (data.champion) events.push({ year: season, type: 'champ', title: ownerNameSafe(data.champion) + ' wins the championship', color: 'var(--gold)', ts: parseInt(season)*100+99 });
            });

            // Collect all trades with DHQ, then keep top 5 by total value
            const _tradeEvents = [];
            tradeHistory.forEach(trade => {
                const rids = trade.roster_ids || [];
                const names = rids.map(r => ownerNameSafe(r)).join(' and ');
                const pids = Object.keys(trade.sides || {}).flatMap(rid => (trade.sides[rid]?.players || []));
                const playerNames = pids.slice(0, 3).map(pid => playersData[pid]?.full_name || pid).join(', ');
                const totalVal = pids.reduce((s, pid) => s + Math.abs(window.App?.LI?.playerScores?.[pid] || 0), 0);
                if (totalVal < 5000) return;
                _tradeEvents.push({
                    year: trade.season || '?', type: 'trade',
                    title: names + ' swap assets' + (playerNames ? ': ' + playerNames : ''),
                    sub: totalVal > 0 ? totalVal.toLocaleString() + ' DHQ moved' : '',
                    color: '#F0A500', ts: parseInt(trade.season||0)*100 + (trade.week||50),
                    _totalVal: totalVal
                });
            });
            _tradeEvents.sort((a, b) => b._totalVal - a._totalVal);
            _tradeEvents.slice(0, 5).forEach(te => events.push(te));

            // Personal highlights per year
            const myRidTLx = myRoster?.roster_id;
            const playerScoresTL = window.App?.LI?.playerScores || {};
            const draftOutcomesTL = (window.App?.LI || {}).draftOutcomes || [];
            const allYears = [...new Set([...Object.keys(completedChampionships), ...events.map(e => String(e.year))])].sort((a,b) => b - a);
            allYears.forEach(yr => {
                // Your team's finish
                const cData = completedChampionships[yr];
                if (cData) {
                    if (sameId(cData.champion, myRidTLx)) events.push({ year: yr, type: 'personal', title: 'You won the championship!', color: 'var(--gold)', ts: parseInt(yr)*100+97 });
                    else if (sameId(cData.runnerUp, myRidTLx)) events.push({ year: yr, type: 'personal', title: 'You finished as runner-up', color: 'var(--silver)', ts: parseInt(yr)*100+96 });
                    else if ((cData.semiFinalists || cData.semiFinals || []).some(rid => sameId(rid, myRidTLx))) events.push({ year: yr, type: 'personal', title: 'You reached the semi-finals', color: '#4ECDC4', ts: parseInt(yr)*100+95 });
                }
                // Your best draft pick that year
                const myDraftPicks = draftOutcomesTL.filter(dp => dp.roster_id === myRidTLx && String(dp.season || dp.year) === String(yr));
                if (myDraftPicks.length > 0) {
                    const bestPick = myDraftPicks.reduce((best, dp) => (playerScoresTL[dp.player_id] || 0) > (playerScoresTL[best.player_id] || 0) ? dp : best, myDraftPicks[0]);
                    const bestDhq = playerScoresTL[bestPick.player_id] || 0;
                    if (bestDhq > 2000) {
                        const pName = playersData[bestPick.player_id]?.full_name || bestPick.player_id;
                        events.push({ year: yr, type: 'personal', title: 'Best draft pick: ' + pName + ' (R' + (bestPick.round || '?') + ', ' + bestDhq.toLocaleString() + ' DHQ)', color: '#4ECDC4', ts: parseInt(yr)*100+94 });
                    }
                }
            });

            events.sort((a, b) => b.ts - a.ts);
            const years = [...new Set(events.map(e => e.year))].sort((a, b) => b - a);

            if (!events.length) return <div style={{ color:'var(--silver)', textAlign:'center', padding:'40px' }}>No timeline events. DHQ engine needs to load trade history and championship data.</div>;

            // ── League Narrative Summary ──
            const champCounts = {};
            Object.values(completedChampionships).forEach(data => {
                if (data.champion) champCounts[data.champion] = (champCounts[data.champion] || 0) + 1;
            });
            const champEntries = Object.entries(champCounts).sort((a, b) => b[1] - a[1]);
            const dominantTeam = champEntries.length > 0 ? ownerNameSafe(champEntries[0][0]) : 'N/A';
            const dominantTitles = champEntries.length > 0 ? champEntries[0][1] : 0;
            const repeatWinners = champEntries.filter(([, cnt]) => cnt > 1).map(([rid]) => ownerNameSafe(rid)).filter(n => n && n !== 'Unknown');
            const myRidTL = myRoster?.roster_id;
            const myChampsTL = champCounts[myRidTL] || 0;
            // Trajectory from projection data
            const projTL = d.projection || [];
            const tlTrend = projTL.length >= 2 ? projTL[projTL.length - 1].projectedDHQ - projTL[0].projectedDHQ : 0;
            const myTrajectory = tlTrend > 500 ? 'rising' : tlTrend < -500 ? 'declining' : 'stable';
            // Next champion candidates: teams with highest health scores
            const allRostersTL = _SS.rosters || [];
            const teamHealthList = [];
            allRostersTL.forEach(ros => {
                try {
                    if (window.assessTeamFromGlobal) {
                        const a = window.assessTeamFromGlobal(ros.roster_id);
                        if (a) teamHealthList.push({ rid: ros.roster_id, name: ownerNameSafe(ros.roster_id), health: a.healthScore || 0 });
                    }
                } catch(e) { window.wrLog('timeline.assessTeam', e); }
            });
            teamHealthList.sort((a, b) => b.health - a.health);
            const nextChampCandidates = teamHealthList.slice(0, 3).map(t => t.name).join(', ') || 'insufficient data';
            const majorTradeCount = events.filter(e => e.type === 'trade').length;
            const personalEventCount = events.filter(e => e.type === 'personal').length;

            return (
                <React.Fragment>
                <AnalyticsCommandPanel
                    title="How has the league evolved, and where are you in the current era?"
                    thesis={(dominantTitles > 0 ? 'League dominated by ' + dominantTeam + ' with ' + dominantTitles + ' title' + (dominantTitles > 1 ? 's' : '') + '.' : 'No completed championship history is resolved yet.') + (repeatWinners.length > 0 ? ' Repeat elite tier: ' + repeatWinners.join(', ') + '.' : ' No repeat champions yet — wide-open league.') + ' Your trajectory: ' + myTrajectory + (myChampsTL > 0 ? ' (' + myChampsTL + ' title' + (myChampsTL > 1 ? 's' : '') + ')' : '') + '. Next likely champion candidates: ' + nextChampCandidates + '.'}
                    stats={[
                        { label: 'Timeline Events', value: events.length, sub: 'resolved evidence points' },
                        { label: 'Major Trades', value: majorTradeCount, sub: '5000+ DHQ moved' },
                        { label: 'My Highlights', value: personalEventCount, sub: 'personal league events' },
                        { label: 'Current Trajectory', value: myTrajectory, sub: 'projection signal', color: myTrajectory === 'rising' ? goodColor : myTrajectory === 'declining' ? badColor : warnColor },
                    ]}
                />

                <div className="analytics-filter-row">
                    {[
                        ['all', 'All Events'],
                        ['champ', 'Championships'],
                        ['trade', 'Major Trades'],
                        ['personal', 'My Highlights'],
                    ].map(([key, label]) => (
                        <button key={key} onClick={() => setTimelineFilter(key)} className={timelineFilter === key ? 'is-active' : ''}>{label}</button>
                    ))}
                </div>

                <div style={{ background:'var(--black)', border:'2px solid rgba(212,175,55,0.3)', borderRadius:'12px', padding:'24px' }}>
                    <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.3rem', color:'var(--gold)', letterSpacing:'0.08em', marginBottom:'12px' }}>ERA / MOVE TIMELINE</div>
                    {(() => {
                        const visibleEvents = timelineFilter === 'all'
                            ? events
                            : timelineFilter === 'champ'
                            ? events.filter(e => e.type === 'champ')
                            : events.filter(e => e.type === timelineFilter);
                        const visibleYears = [...new Set(visibleEvents.map(e => e.year))].sort((a, b) => b - a);
                        return visibleYears.map(year => {
                        const yearEvents = visibleEvents.filter(e => e.year === year);
                        return (
                            <div key={year} style={{ marginBottom:'24px' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'10px', marginBottom:'12px' }}>
                                    <div style={{ width:'14px', height:'14px', background:'var(--gold)', borderRadius:'50%', border:'3px solid var(--black)', flexShrink:0 }} />
                                    <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.2rem', color:'var(--gold)' }}>{year}</span>
                                </div>
                                <div style={{ paddingLeft:'20px', borderLeft:'2px solid rgba(212,175,55,0.2)', marginLeft:'6px' }}>
                                    {yearEvents.map((ev, i) => (
                                        <div key={i} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(212,175,55,0.12)', borderLeft:'3px solid '+ev.color, borderRadius:'6px', padding:'10px 14px', marginBottom:'8px', position:'relative' }}>
                                            <div style={{ position:'absolute', left:'-14px', top:'12px', width:'8px', height:'8px', background:ev.color, borderRadius:'50%', border:'2px solid var(--black)' }} />
                                            <div style={{ fontSize:'0.78rem', color:ev.color, textTransform:'uppercase', fontFamily: 'var(--font-body)', letterSpacing:'0.06em', marginBottom:'3px' }}>{ev.type === 'champ' ? 'Championship' : ev.type === 'finals' ? 'Runner-Up' : ev.type === 'personal' ? 'Your Highlight' : 'Trade'}</div>
                                            <div style={{ fontSize:'0.78rem', color:'var(--white)', fontWeight:600 }}>{ev.title}</div>
                                            {ev.sub && <div style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.6, marginTop:'2px' }}>{ev.sub}</div>}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    });
                    })()}
                </div>
                </React.Fragment>
            );
        })()}

        {/* Phase 8: All Players / Draft Picks / Custom Reports — ex-League Map sub-views
            rendered inline via LeagueMapTab's embed mode. Local state lives in AnalyticsPanel
            so sort/filter/search persist as the user moves between sub-tabs. */}
        {(analyticsTab === 'players' || analyticsTab === 'picks' || analyticsTab === 'reports') && React.createElement(window.AnalyticsLeagueEmbed || (() => null), {
            analyticsTab, standings, currentLeague, playersData, statsData, sleeperUserId,
            myRoster, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName,
        })}

        </React.Fragment>
        )}
    </div>
    );
}

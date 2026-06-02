// ══════════════════════════════════════════════════════════════════
// js/tabs/analytics.js — AnalyticsPanel: League analytics terminal
// with focused sub-tabs: Roster, Draft, Market Moves, Players, Picks, Reports
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

// Phase 8 deferred: small wrapper that holds the local state needed to mount
// LeagueMapTab in embed mode. Keeping it separate prevents AnalyticsPanel from
// re-initialising the sort/filter/search state on every render of other sub-tabs.
window.AnalyticsLeagueEmbed = function AnalyticsLeagueEmbed(props) {
    const { analyticsTab, standings, currentLeague, playersData, statsData, sleeperUserId,
        myRoster, leagueSkin, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName } = props;
    const [lpSort, setLpSort] = React.useState({ key: 'dhq', dir: -1 });
    const [lpFilter, setLpFilter] = React.useState('');
    const [lpSearch, setLpSearch] = React.useState('');
    const [leagueSelectedTeam, setLeagueSelectedTeam] = React.useState(null);
    const [leagueSort, setLeagueSort] = React.useState('health');
    const [leagueViewMode, setLeagueViewMode] = React.useState('cards');
    React.useEffect(() => {
        setLeagueSelectedTeam(null);
        setLeagueViewMode('cards');
    }, [analyticsTab]);
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
        standings, currentLeague, leagueSkin, playersData, statsData, sleeperUserId, myRoster,
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
  leagueSkin,
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
    // _SS mirrors the window.S shape consumed throughout this component
    const _SS = {
        rosters: _seasonCtx.rosters?.length ? _seasonCtx.rosters : (window.S?.rosters || currentLeague?.rosters || []),
        myRosterId: _seasonCtx.myRosterId ?? window.S?.myRosterId,
        tradedPicks: _seasonCtx.tradedPicks !== undefined ? _seasonCtx.tradedPicks : (window.S?.tradedPicks || []),
        playerStats: _seasonCtx.playerStats || window.S?.playerStats || {},
    };
    const resolvedLeagueSkin = leagueSkin || _seasonCtx.leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
    const skinFeatures = resolvedLeagueSkin?.features || {};
    const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, rosters: _SS.rosters, currentLeague }) || { isUsable: true };

    // Token-driven card style so padding/radius/border track index.html's spacing scale.
    const aCardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid var(--acc-line1, rgba(212,175,55,0.2)))', borderRadius: 'var(--card-radius, 10px)', padding: 'var(--card-pad, 16px 18px)', marginBottom: 'var(--card-gap, 14px)' };
    const aHeaderStyle = { fontFamily: 'Rajdhani, sans-serif', color: 'var(--gold)', fontSize: '1.125rem', fontWeight: 600, letterSpacing: '0.06em', marginBottom: '12px', borderBottom: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', paddingBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
    const aValStyle = { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-body, 1rem)', fontWeight: 500 };
    const goodColor = 'var(--good)';
    const warnColor = 'var(--warn)';
    const badColor = 'var(--bad)';
    const sevIcon = (sev) => sev === 'high' || sev === 'critical' ? '\uD83D\uDD34' : sev === 'medium' ? '\u26A0\uFE0F' : '\u2705';
    const sevColor = (sev) => sev === 'high' || sev === 'critical' ? badColor : sev === 'medium' ? warnColor : goodColor;
    const pctFmt = (v) => Math.round((v || 0) * 100) + '%';
    const numFmt = (v) => v != null ? (typeof v === 'number' ? v.toLocaleString() : v) : '\u2014';
    const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
    // showAlerts block removed — alerts now on Brief tab

    // ── ANALYST VIEW: full analytics terminal ──
    // Phase 8: Absorbed ex-League Map sub-views (All Players, Draft Picks, Custom Reports)
    // since League Map was removed from the nav. They render LeagueMapTab in embed mode.
    const subTabs = [
        { key: 'roster', label: 'Roster' },
        { key: 'draft', label: 'Draft' },
        { key: 'trades', label: 'Market Moves' },
        { key: 'players', label: 'All Players', navLabel: 'Players' },
        { key: 'picks', label: 'Draft Picks', navLabel: 'Picks' },
        { key: 'reports', label: 'Custom Reports', navLabel: 'Reports' },
    ];
    const activeSubTab = subTabs.find(t => t.key === analyticsTab) || subTabs[0];
    const analyticsViewTab = activeSubTab.key;
    const analyticsContext = {
        roster: 'Winner-template gaps, room coverage, and roster construction evidence.',
        draft: 'Pick value, hit-rate patterns, and current-pick strategy.',
        trades: 'Trade efficiency, waiver activity, FAAB, and market pressure.',
        players: 'Full player universe with analytics-grade filters and saved views.',
        picks: 'Pick capital, ownership status, and traded/acquired paths.',
        reports: 'Custom report templates, saved views, and live preview.'
    };
    const tableRowStyle = (i) => ({ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', ...(i === 0 ? { fontWeight: 700, color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', textTransform: 'uppercase', letterSpacing: '0.05em' } : { color: 'var(--silver)' }) });
    const d = analyticsData;
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const historyLeagueId = currentLeague?.id || currentLeague?.league_id || '';
    const [historyTick, setHistoryTick] = React.useState(0);
    React.useEffect(() => {
        const onLoaded = (event) => {
            const loadedId = event?.detail?.leagueId;
            if (!loadedId || !historyLeagueId || sameId(loadedId, historyLeagueId)) setHistoryTick(t => t + 1);
        };
        window.addEventListener('wr_history_loaded', onLoaded);
        if (historyLeagueId && window.WrHistory?.loadIfMissing) {
            window.WrHistory.loadIfMissing(currentLeague).then(cache => {
                if (cache) setHistoryTick(t => t + 1);
            }).catch(() => {});
        }
        return () => window.removeEventListener('wr_history_loaded', onLoaded);
    }, [historyLeagueId]);
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
                                <div className="analytics-delta-fill" style={{ width: yPct + '%', background: r.color || 'var(--k-4ecdc4, #4ecdc4)' }} />
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
    const RosterDataBlocker = ({ title = 'Roster analytics paused' }) => (
        <div className="analytics-panel" style={{ minHeight: '240px' }}>
            {window.App?.renderRosterDataBlocker?.(rosterState, {
                title,
                message: 'Champion-template and room coverage reads need complete roster IDs.',
                detail: rosterState.detail,
                actionLabel: 'Refresh Data',
                style: { minHeight: '220px' },
            })}
        </div>
    );

    return (
    <div className="analytics-shell" style={{ padding: 'var(--space-md) var(--space-lg) var(--space-lg)' }}>
        <div className="wr-module-strip">
            <div className="wr-module-context">
                <span>Analytics</span>
                <strong>{activeSubTab.label}</strong>
                <em>{analyticsContext[activeSubTab.key]}</em>
            </div>
            <div className="wr-module-actions">
                <div className="wr-module-nav">
                    {subTabs.map(t => (
                        <button key={t.key} className={analyticsViewTab === t.key ? 'is-active' : ''} onClick={() => setAnalyticsTab(t.key)}>{t.navLabel || t.label}</button>
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
        {analyticsViewTab === 'roster' && (() => {
            const r = d.roster;
            if (!r) return <div style={{ color: 'var(--silver)' }}>No roster data available.</div>;
            if (!rosterState.isUsable) return <RosterDataBlocker />;
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
                background: 'linear-gradient(135deg, var(--surf-solid, rgba(26,26,26,0.95)), var(--surf-solid, rgba(10,10,10,0.98)))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
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
                fontSize: 'var(--text-label, 0.75rem)',
                color: 'var(--silver)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                opacity: 0.7,
            };
            const kpiDeltaStyle = (positive) => ({
                fontFamily: 'var(--font-body)',
                fontSize: 'var(--text-body, 1rem)',
                fontWeight: 600,
                color: positive ? goodColor : badColor,
                marginTop: '4px',
            });

            // ── Position data for BarChart ──
            const posOrder = ['QB','RB','TE','WR','K','DEF','DL','LB','DB'];
            const allPos = [...new Set([...Object.keys(w.posInvestment || {}), ...Object.keys(m.posInvestment || {})])].filter(p => p !== 'UNK').sort((a,b) => { const ia = posOrder.indexOf(a); const ib = posOrder.indexOf(b); return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib); });
            const posBarItems = allPos.map(pos => ({
                label: window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos),
                value: Math.round((m.posInvestment[pos] || 0) * 100),
                color: 'var(--k-4ecdc4, #4ecdc4)',
            }));
            const posBarWinnerItems = allPos.map(pos => ({
                label: window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos),
                value: Math.round((w.posInvestment[pos] || 0) * 100),
                color: CHART_COLORS?.gold || 'var(--k-d4af37, #d4af37)',
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
                action: (n.urgency === 'deficit' ? 'Add ' : 'Build ') + posLabel(n.pos) + (n.urgency === 'deficit' ? ' starter coverage' : ' depth'),
                detail: posLabel(n.pos) + ' is a current roster ' + n.urgency + ': ' + have + '/' + required + ' starter-quality players by league settings.',
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
                label: posLabel(pos),
                yours: Math.round((m.posInvestment[pos] || 0) * 100),
                benchmark: Math.round((w.posInvestment[pos] || 0) * 100),
                suffix: ' pts',
                format: v => Math.round(v) + '%',
                color: needsSet.has(pos) ? badColor : 'var(--k-4ecdc4, #4ecdc4)',
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
                            {['QB','RB','WR','TE','K','DEF','DL','LB','DB'].map(pos => {
                                const assessPos = assessment?.posAssessment?.[pos] || {};
                                const have = assessPos.nflStarters ?? assessPos.actual ?? 0;
                                const need = assessPos.minQuality || assessPos.startingReq || assessPos.ideal || 0;
                                const weak = (needs || []).some(n => (typeof n === 'string' ? n : n.pos) === pos);
                                const tone = weak ? 'bad' : have > need && need > 0 ? 'good' : 'neutral';
                                return (
                                    <div key={pos} className={'analytics-room-chip is-' + tone}>
                                        <strong>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</strong>
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
                            background: 'var(--surf-solid, rgba(26,26,26,0.8))', borderRadius: 'var(--card-radius)', padding: '14px 16px',
                            borderLeft: '4px solid ' + ins.color,
                            border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: ins.color, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {ins.title}
                            </div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5 }}>{ins.text}</div>
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
                                    <span style={{ color: 'var(--silver)', fontFamily: 'var(--font-body)', minWidth: '40px', fontSize: 'var(--text-body, 1rem)' }}>{p.year}</span>
                                    <div style={{ flex: 1, position: 'relative', height: '24px', background: 'var(--ov-3, rgba(255,255,255,0.05))', borderRadius: '6px', overflow: 'hidden' }}>
                                        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: (p.projectedDHQ / maxDHQ * 100) + '%', background: tierColor(p.tier), borderRadius: '6px', opacity: 0.6, transition: 'width 0.5s ease' }} />
                                        <div style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', color: 'var(--white)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                            {p.projectedDHQ.toLocaleString()} DHQ
                                        </div>
                                    </div>
                                    <span style={{ color: tierColor(p.tier), fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', minWidth: '90px', textAlign: 'right' }}>
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
	                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px', lineHeight: 1.5 }}>Players within 2 years of their position's value-window end with 2000+ DHQ value. These are your highest-risk assets for dynasty value decline.</div>
                            <div style={{ display: 'flex', gap: '24px', marginBottom: '12px' }}>
                                <div style={{ textAlign: 'center' }}>
                                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', color: arPct2 > 30 ? badColor : arPct2 > 15 ? warnColor : goodColor }}>{arPct2}%</div>
	                                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)' }}>Your DHQ near value cliff by {(parseInt(S2?.season) || 2026) + 2}</div>
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
                                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)' }}>League avg</div>
                                        </>;
                                    })()}
                                </div>
                            </div>
                            {arPlayers2.length > 0 && (
                                <div>
                                    <div style={{ color: 'var(--silver)', fontSize: 'var(--text-body, 1rem)', marginBottom: '6px', fontWeight: 700 }}>Players at risk:</div>
                                    {arPlayers2.slice(0, 5).map((p, i) => (
                                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)' }}>
                                            <span style={{ color: 'var(--silver)' }}>{p.name} ({p.age})</span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ color: badColor }}>{p.dhq.toLocaleString()} DHQ</span>
                                                <span style={{ padding: '2px 8px', background: 'rgba(231,76,60,0.15)', color: badColor, borderRadius: '4px', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, letterSpacing: '0.05em' }}>TRADE NOW</span>
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
        {analyticsViewTab === 'draft' && (() => {
            const dr = d.draft;
            if (!dr) return <div style={{ color: 'var(--silver)' }}>No draft data available.</div>;
            const rounds = Object.keys(dr.winnerDraftProfile || {}).map(Number).sort((a, b) => a - b);
            const S = _SS;
            const myRid = myRoster?.roster_id ?? S?.myRosterId;
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
            const hasDraftOutcomeHistory = draftOutcomes.length > 0 && rounds.length > 0 && hitRounds > 0;

            // KPI card style
            const dKpiCardStyle = {
                background: 'linear-gradient(135deg, var(--surf-solid, rgba(26,26,26,0.95)), var(--surf-solid, rgba(10,10,10,0.98)))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                borderRadius: '14px',
                padding: '20px 18px 14px',
                flex: '1 1 0',
                minWidth: '140px',
            };
            const dKpiNum = { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.2rem', lineHeight: 1, color: 'var(--white)', marginBottom: '2px' };
            const dKpiLabel = { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 };

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
            const leagueSeason = parseInt(currentLeague?.season || activeYear, 10) || new Date().getFullYear();
            const draftRounds = Number(window.App?.LeagueSkin?.resolveDraftRounds?.({
                league: currentLeague,
                leagueSkin: resolvedLeagueSkin,
                drafts: window.S?.drafts || currentLeague?.drafts || [],
                fallbackRounds: currentLeague?.settings?.draft_rounds || 5,
            }) || currentLeague?.settings?.draft_rounds || 5);
            const totalTeams = leagueRosters.length || 12;
            const tradedPicks = _SS.tradedPicks || [];
            const currentDraft = (window.S?.drafts || currentLeague?.drafts || []).find(dft => sameId(dft?.season, leagueSeason) && dft?.draft_order);
            const draftOrder = currentDraft?.draft_order || {};
            const slotToRoster = {};
            if (Object.keys(draftOrder).length) {
                Object.entries(draftOrder).forEach(([userId, slot]) => {
                    const roster = leagueRosters.find(r => sameId(r.owner_id, userId));
                    if (roster?.roster_id != null) slotToRoster[String(slot)] = roster.roster_id;
                });
            }
            const sortedRosters = Object.keys(slotToRoster).length ? leagueRosters : [...leagueRosters].sort((a, b) => {
                const stA = standings.find(s => { const rr = leagueRosters.find(r => sameId(r.owner_id, s.userId)); return sameId(rr?.roster_id, a.roster_id); });
                const stB = standings.find(s => { const rr = leagueRosters.find(r => sameId(r.owner_id, s.userId)); return sameId(rr?.roster_id, b.roster_id); });
                const wA = stA?.wins ?? (a.settings?.wins ?? 0);
                const wB = stB?.wins ?? (b.settings?.wins ?? 0);
                if (wA !== wB) return wA - wB;
                const pfA = (stA?.pointsFor ?? a.settings?.fpts ?? 0) + ((a.settings?.fpts_decimal || 0) / 100);
                const pfB = (stB?.pointsFor ?? b.settings?.fpts ?? 0) + ((b.settings?.fpts_decimal || 0) / 100);
                return pfA - pfB;
            });
            if (!Object.keys(slotToRoster).length) {
                sortedRosters.forEach((r, i) => { slotToRoster[String(i + 1)] = r.roster_id; });
            }
            const pickOrder = {};
            Object.entries(slotToRoster).forEach(([slot, rid]) => {
                if (rid != null) pickOrder[String(rid)] = Number(slot);
            });
            const slotForOriginalRid = (rid) => pickOrder[String(rid)] || Math.ceil(totalTeams / 2);
            const discountSlotValue = (value, yr) => {
                const curYear = parseInt(window.S?.season || currentLeague?.season || activeYear, 10) || new Date().getFullYear();
                const pickYear = parseInt(yr, 10) || curYear;
                const yearsAhead = Math.max(0, pickYear - curYear);
                return Math.round(value * Math.pow(0.88, yearsAhead));
            };
            const pickValue = (yr, rd, slotInRound) => {
                const slot = Math.max(1, Math.min(Number(slotInRound) || Math.ceil(totalTeams / 2), totalTeams));
                const overall = (rd - 1) * totalTeams + slot;
                let value = 0;
                if (typeof window.getPickValueBySlot === 'function') value = window.getPickValueBySlot(rd, slot, totalTeams, draftRounds);
                if (!value && typeof window.getIndustryPickValue === 'function') value = window.getIndustryPickValue(overall, totalTeams, draftRounds);
                if (!value) value = window.App?.PlayerValue?.PICK_VALUES_BY_SLOT?.[overall] || 0;
                if (!value) value = window.App?.LI?.dhqPickValueFn?.(yr, rd, slot) || 0;
                if (value > 0) return discountSlotValue(value, yr);
                return window.App?.PlayerValue?.getPickValue?.(yr, rd, totalTeams) || Math.max(100, 9000 - rd * 1600);
            };
            const pickLabel = (yr, rd, slot, via) => {
                const base = rd + '.' + String(Math.max(1, Number(slot) || 1)).padStart(2, '0');
                const withYear = yr === leagueSeason ? base : String(yr).slice(-2) + ' ' + base;
                return via ? withYear + ' via ' + via : withYear;
            };
            const currentPicks = [];
            const draftYears = skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2];
            for (const yr of draftYears) {
                for (let rd = 1; rd <= draftRounds; rd++) {
                    const mySlot = slotForOriginalRid(myRid);
                    const ownMoved = tradedPicks.find(p => sameId(p.season, yr) && Number(p.round) === rd && sameId(p.roster_id, myRid) && !sameId(p.owner_id, myRid));
                    if (!ownMoved) currentPicks.push({ year: yr, round: rd, slot: mySlot, own: true, label: pickLabel(yr, rd, mySlot), value: pickValue(yr, rd, mySlot) });
                    tradedPicks
                        .filter(p => sameId(p.season, yr) && Number(p.round) === rd && sameId(p.owner_id, myRid) && !sameId(p.roster_id, myRid))
                        .forEach(p => {
                            const fromSlot = slotForOriginalRid(p.roster_id);
                            const fromName = ownerNameSafe(p.roster_id);
                            currentPicks.push({ year: yr, round: rd, slot: fromSlot, own: false, from: fromName, label: pickLabel(yr, rd, fromSlot, fromName), value: pickValue(yr, rd, fromSlot) });
                        });
                }
            }
            const currentPickValue = currentPicks.reduce((s, p) => s + (p.value || 0), 0);
            const earlyPicks = currentPicks.filter(p => p.round <= 2).length;
            const topCurrentPicks = [...currentPicks].sort((a, b) => b.value - a.value || a.year - b.year || a.round - b.round).slice(0, 5);
            const leagueId = currentLeague?.id || currentLeague?.league_id || '';
            const ownerHistory = (() => {
                try {
                    if (window.WrHistory?.getOwnerHistory) return window.WrHistory.getOwnerHistory(leagueId) || {};
                    if (typeof window.buildOwnerHistory === 'function') return window.buildOwnerHistory(leagueId) || {};
                } catch (_) {}
                return {};
            })();
            const historyOwners = Object.values(ownerHistory || {});
            const allSeasonRows = [];
            const championRows = [];
            historyOwners.forEach(owner => {
                const champSeasons = new Set((owner.champSeasons || []).map(String));
                (owner.seasonHistory || []).forEach(season => {
                    const row = { ...season, ownerName: owner.ownerName || owner.teamName || ownerNameSafe(owner.rosterId), rosterId: owner.rosterId };
                    allSeasonRows.push(row);
                    const finish = String(season.finish || '').toLowerCase();
                    if (champSeasons.has(String(season.season)) || finish === 'champion' || Number(season.place) === 1) championRows.push(row);
                });
            });
            const finiteNumber = (value) => {
                const n = Number(value);
                return Number.isFinite(n) ? n : null;
            };
            const avgOf = (values) => {
                const nums = values.map(finiteNumber).filter(v => v != null);
                return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : null;
            };
            const avgChampionWins = avgOf(championRows.map(s => s.wins));
            const avgChampionLosses = avgOf(championRows.map(s => s.losses));
            const avgChampionPF = avgOf(championRows.map(s => s.fpts));
            const seasonCount = new Set(allSeasonRows.map(s => String(s.season || '')).filter(Boolean)).size;
            const uniqueChampionOwners = new Set(championRows.map(s => s.ownerName || s.rosterId).filter(Boolean)).size;
            const movedPickCount = tradedPicks.filter(p => !sameId(p.owner_id, p.roster_id)).length;
            const rosterSlots = (currentLeague?.roster_positions || []).map(pos => String(pos || '').toUpperCase());
            const redraftBuildCue = rosterSlots.includes('K') || rosterSlots.includes('DEF') || rosterSlots.includes('DST') ? 'Late K/DST' : 'Core Skill';
            const championRecordText = avgChampionWins != null
                ? Math.round(avgChampionWins) + '-' + Math.round(avgChampionLosses || 0)
                : 'History pending';
            const historicalProofItems = [
                { label: 'History Loaded', value: seasonCount ? seasonCount + ' seasons' : '\u2014', detail: seasonCount ? 'League history is loaded even though draft outcomes are not.' : 'Historical season records are still loading.', tone: seasonCount ? 'good' : 'warn', color: seasonCount ? goodColor : warnColor },
                { label: 'Title Record', value: championRecordText, detail: championRows.length ? 'Average champion regular-season record.' : 'Champion rows are not available yet.', tone: championRows.length ? 'good' : 'warn', color: championRows.length ? goodColor : warnColor },
                { label: 'Champion PF', value: avgChampionPF != null ? Math.round(avgChampionPF).toLocaleString() : '\u2014', detail: championRows.length ? 'Average points-for by title teams.' : 'Needs season points-for history.', tone: championRows.length ? 'good' : 'warn', color: championRows.length ? goodColor : warnColor },
                { label: 'Pick Trade Reality', value: movedPickCount.toLocaleString(), detail: movedPickCount ? 'Historical pick movement exists in the ledger.' : 'No historical pick trades found; mock trade offers should stay suppressed.', tone: movedPickCount ? 'warn' : 'good', color: movedPickCount ? warnColor : goodColor },
            ];
            const draftProofItems = hasDraftOutcomeHistory ? [
                { label: 'Hit Rate Edge', value: signedNum(Math.round(avgHitAdv * 100), ' pts'), detail: 'Elite tier average hit-rate advantage by round.', tone: toneFromDelta(avgHitAdv), color: avgHitAdv >= 0 ? goodColor : badColor },
                { label: 'R1 Benchmark', value: pctFmt(winnerR1Hit), detail: 'Elite tier first-round hit rate in this league.', tone: 'good', color: goodColor },
                { label: 'Your R1 History', value: pctFmt(myR1Hit), detail: totalMyPicks ? 'Your recorded first-round conversion.' : 'No first-round history loaded yet.', tone: myR1Hit >= winnerR1Hit ? 'good' : 'warn', color: myR1Hit >= winnerR1Hit ? goodColor : warnColor },
                { label: 'Current Capital', value: currentPickValue.toLocaleString(), detail: currentPicks.length + ' current picks, ' + earlyPicks + ' in R1-R2.', tone: earlyPicks >= 3 ? 'good' : 'warn', color: earlyPicks >= 3 ? goodColor : warnColor },
            ] : historicalProofItems;
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
            const curveValues = curveSlots.map(p => {
                const rd = Math.ceil(p / totalTeams);
                const slot = ((p - 1) % totalTeams) + 1;
                return pickValue(leagueSeason, rd, slot);
            });
            const curveMax = Math.max(...curveValues, 1);
            const draftRows = topCurrentPicks.length ? topCurrentPicks.map(p => ({
                kicker: p.own ? 'Owned Pick' : 'Acquired Pick',
                label: p.label,
                detail: p.own ? 'Original pick path' : 'From ' + (p.from || 'another roster'),
                value: (p.value || 0).toLocaleString(),
                color: p.round <= 2 ? 'var(--gold)' : 'var(--k-9b8afb, #9b8afb)',
            })) : [{ kicker: 'Pick Path', label: 'No current picks loaded', detail: 'Draft pick source did not return current inventory.', value: '\u2014' }];
            const historicalRows = [
                { kicker: 'Champion Threshold', label: championRecordText, detail: championRows.length ? 'Average title-team regular-season record in this league.' : 'Waiting for champion season rows.', value: avgChampionPF != null ? Math.round(avgChampionPF).toLocaleString() + ' PF' : '\u2014', color: goodColor },
                { kicker: 'League Parity', label: uniqueChampionOwners ? uniqueChampionOwners + ' title teams' : 'No title map', detail: championRows.length ? uniqueChampionOwners + ' unique champions across ' + championRows.length + ' title seasons.' : 'History has not identified champions yet.', value: championRows.length || '\u2014', color: 'var(--gold)' },
                { kicker: 'Draft Behavior', label: movedPickCount ? 'Pick trades exist' : 'Fixed-slot league', detail: movedPickCount ? 'Use ledger movement when modeling offers.' : 'No historical pick trades found, so mock offers should weight to zero.', value: movedPickCount.toLocaleString(), color: movedPickCount ? warnColor : goodColor },
                { kicker: 'Roster Rule Cue', label: redraftBuildCue, detail: rosterSlots.includes('K') || rosterSlots.includes('DEF') || rosterSlots.includes('DST') ? 'Kicker and D/ST should be timing decisions, not early capital.' : 'No K/DST drag detected in roster slots.', value: draftRounds + ' rounds', color: 'var(--k-4ecdc4, #4ecdc4)' },
            ];
            const buildRows = [
                { kicker: 'Current Inventory', label: currentPicks.length + ' owned picks', detail: skinFeatures.showFuturePicks === false ? 'Current-season redraft board only.' : 'Includes visible future-pick years.', value: currentPickValue.toLocaleString(), color: 'var(--gold)' },
                { kicker: 'Round Shape', label: draftRounds + ' rounds x ' + totalTeams + ' teams', detail: 'Resolved from roster-slot skin rules, not raw Sleeper draft_rounds.', value: (totalTeams * draftRounds).toLocaleString() + ' picks', color: 'var(--k-9b8afb, #9b8afb)' },
                { kicker: 'Early Capital', label: earlyPicks + ' picks in R1-R2', detail: 'Used for anchor-player and tier-break decisions.', value: topCurrentPicks[0]?.label || '\u2014', color: warnColor },
                { kicker: 'AI Trade Weight', label: movedPickCount ? 'Historical rate' : '0% offer bias', detail: 'Mock draft trade behavior follows this league ledger.', value: movedPickCount ? movedPickCount + ' moved' : 'No trades', color: movedPickCount ? warnColor : goodColor },
            ];
            const draftStats = hasDraftOutcomeHistory ? [
                { label: 'Draft Grade', value: grades[gradeIdx], sub: 'hit-rate evidence', color: gradeIdx <= 2 ? goodColor : gradeIdx <= 5 ? warnColor : badColor },
                { label: 'Elite R1 Hit', value: pctFmt(winnerR1Hit), sub: 'winner sample' },
                { label: 'Capital Loaded', value: currentPicks.length || '\u2014', sub: currentPickValue.toLocaleString() + ' DHQ' },
                { label: 'Template Lean', value: topDraftPos, sub: 'early-round position signal' },
            ] : [
                { label: 'History Loaded', value: seasonCount || '\u2014', sub: 'seasons with records', color: seasonCount ? goodColor : warnColor },
                { label: 'Capital Loaded', value: currentPicks.length || '\u2014', sub: currentPickValue.toLocaleString() + ' DHQ' },
                { label: 'Pick Trades', value: movedPickCount, sub: movedPickCount ? 'ledger movement' : 'none in ledger', color: movedPickCount ? warnColor : goodColor },
                { label: 'Build Cue', value: redraftBuildCue, sub: 'roster format' },
            ];

            return (
            <React.Fragment>
                <AnalyticsCommandPanel
                    title="What does this league actually reward in the draft?"
                    thesis="Draft analytics should not be another pick-count dashboard. This lab separates slot value, round hit-rate, current pick path, and the position patterns that have historically produced title rosters."
                    stats={draftStats}
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

                {hasDraftOutcomeHistory ? (
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
                                                    fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', padding: '2px 8px',
                                                    borderRadius: 'var(--card-radius-sm)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)',
                                                    border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                                                }}>{posLabel(pos)} {pctFmt(pct)}</span>
                                            ))}
                                        </div>
                                    </div>
                                    {Object.keys(myProf).length > 0 && (
                                        <div style={{ marginLeft: '65px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                            {Object.entries(myProf).sort((a, b) => b[1] - a[1]).map(([pos, pct]) => (
                                                <span key={pos} style={{
                                                    fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', padding: '1px 6px',
                                                    borderRadius: 'var(--card-radius-sm)', background: 'rgba(78,205,196,0.1)', color: 'var(--k-4ecdc4, #4ecdc4)',
                                                    border: '1px solid rgba(78,205,196,0.2)',
                                                }}>{posLabel(pos)} {pctFmt(pct)}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                            <div style={{ display: 'flex', gap: '16px', marginTop: '8px', fontSize: 'var(--text-label, 0.75rem)' }}>
                                <span style={{ color: 'var(--gold)' }}>{'\u25A0'} Elite Tier</span>
                                <span style={{ color: 'var(--k-4ecdc4, #4ecdc4)' }}>{'\u25A0'} You</span>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="analytics-lab-grid">
                        <div className="analytics-lab-card">
                            <span>Historical League Signals</span>
                            <strong>League History Instead Of Empty Draft Outcomes</strong>
                            <p>This league does not have real draft-outcome rows loaded, so the read shifts to title thresholds, parity, pick-trade reality, and roster-rule pressure.</p>
                            <AnalyticsDataStack rows={historicalRows} />
                        </div>
                        <div className="analytics-lab-card">
                            <span>Redraft Build Map</span>
                            <strong>How To Use The Current Draft Board</strong>
                            <p>The redraft skin turns draft capital into current-season slots only. That keeps the board at 15 owned picks for this league and keeps future-year assets out of the model.</p>
                            <AnalyticsDataStack rows={buildRows} />
                        </div>
                    </div>
                )}
            </React.Fragment>
            );
        })()}

        {/* ═══ MARKET MOVES INTELLIGENCE ═══ */}
        {analyticsViewTab === 'trades' && (() => {
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
            const boughtBarWinner = allBoughtPos.map(pos => ({ label: posLabel(pos), value: (wp.positionsBought || {})[pos] || 0, color: CHART_COLORS?.gold || 'var(--k-d4af37, #d4af37)' }));
            const boughtBarYou = allBoughtPos.map(pos => ({ label: posLabel(pos), value: (mp.positionsBought || {})[pos] || 0, color: 'var(--k-4ecdc4, #4ecdc4)' }));

            // KPI card style
            const tKpiCardStyle = {
                background: 'linear-gradient(135deg, var(--surf-solid, rgba(26,26,26,0.95)), var(--surf-solid, rgba(10,10,10,0.98)))',
                border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                borderRadius: '14px',
                padding: '20px 18px 14px',
                flex: '1 1 0',
                minWidth: '140px',
            };
            const tKpiNum = { fontFamily: 'Rajdhani, sans-serif', fontSize: '2.2rem', lineHeight: 1, color: 'var(--white)', marginBottom: '2px' };
            const tKpiLabel = { fontFamily: 'var(--font-body)', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.7 };

            const valueDeltaColor = mp.avgValueGained >= 0 ? goodColor : badColor;
            const marketProofItems = [
                { label: 'Trade Frequency Edge', value: signedNum(Number((mp.avgTradesPerSeason - wp.avgTradesPerSeason).toFixed(1))), detail: 'Your trades per season vs elite-tier behavior.', tone: toneFromDelta(mp.avgTradesPerSeason - wp.avgTradesPerSeason), color: mp.avgTradesPerSeason >= wp.avgTradesPerSeason ? goodColor : warnColor },
                { label: 'Value Per Deal', value: signedNum(mp.avgValueGained, ' DHQ'), detail: 'Average DHQ gained/lost in completed trades.', tone: toneFromDelta(mp.avgValueGained), color: valueDeltaColor },
                { label: 'FAAB Leverage', value: faabRemaining == null ? '\u2014' : '$' + faabRemaining.toLocaleString(), detail: waiverBudget ? Math.round(faabRemaining / Math.max(waiverBudget, 1) * 100) + '% of budget remaining.' : 'No FAAB budget configured.', tone: faabRemaining == null ? 'warn' : faabRemaining >= waiverBudget * 0.5 ? 'good' : 'warn', color: faabRemaining == null ? 'var(--silver)' : faabRemaining >= waiverBudget * 0.5 ? goodColor : warnColor },
                { label: 'Best Waiver Yield', value: topEffPos ? posLabel(topEffPos[0]) : '\u2014', detail: topEffPos ? (topEffPos[1].dhqPerDollar || 0) + ' DHQ per FAAB dollar.' : 'Bid outcome sample is still thin.', tone: topEffPos ? 'good' : 'warn', color: topEffPos ? goodColor : warnColor },
            ];
            const tradeFlowRows = allBoughtPos.map(pos => ({
                label: posLabel(pos),
                yours: (mp.positionsBought || {})[pos] || 0,
                benchmark: (wp.positionsBought || {})[pos] || 0,
                suffix: '',
                format: v => Math.round(v),
                color: 'var(--k-7c6bf8, #7c6bf8)',
            }));
            const marketRows = [
                { kicker: 'Partner Archetype', label: 'Elite teams trade with', detail: 'Preferred counterparty posture among title teams.', value: cleanPreference(wp.partnerPreference), color: 'var(--gold)' },
                { kicker: 'Your Pattern', label: 'You trade with', detail: 'Your observed partner preference.', value: cleanPreference(mp.partnerPreference), color: 'var(--k-4ecdc4, #4ecdc4)' },
                { kicker: 'Top Price Position', label: topFaabPos ? posLabel(topFaabPos[0]) : 'No FAAB history', detail: topFaabPos ? 'Average winning bid across waiver history.' : 'Transactions have not produced a market map yet.', value: topFaabPos ? '$' + Math.round(topFaabPos[1].avg || 0) : '\u2014', color: warnColor },
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
                        { label: 'High Price Room', value: topFaabPos ? posLabel(topFaabPos[0]) : '\u2014', sub: topFaabPos ? '$' + Math.round(topFaabPos[1].avg || 0) + ' avg bid' : 'bid history thin' },
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
                                <div key={pos}><strong>{posLabel(pos)}</strong><span>${Math.round(info.avg || 0)} avg</span><em>{info.count || 0} bids</em></div>
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
                                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontFamily: 'var(--font-body)' }}>S{trade.season || '?'} W{trade.week || '?'}</span>
                                        <span style={{ fontSize: 'var(--text-label, 0.75rem)', fontFamily: 'var(--font-body)', padding: '2px 8px', borderRadius: '10px', background: wrAlpha(resultColor, '22'), color: resultColor, border: '1px solid ' + wrAlpha(resultColor, '44'), fontWeight: 700 }}>{result}</span>
                                    </div>
                                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', fontFamily: 'var(--font-body)' }}>
                                        {assetListText(trade.gave)} <span style={{ color: 'var(--gold)', margin: '0 4px' }}>{'\u2192'}</span> {assetListText(trade.got)}
                                    </div>
                                    <div style={{ fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', color: netDhq >= 0 ? goodColor : badColor, fontWeight: 700 }}>
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
                            background: 'var(--surf-solid, rgba(26,26,26,0.8))', borderRadius: 'var(--card-radius)', padding: '14px 16px',
                            borderLeft: '4px solid ' + sevColor(a.sev),
                            border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                        }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: sevColor(a.sev), marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                {a.title}
                            </div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', lineHeight: 1.5 }}>{a.msg}</div>
                        </div>
                    ))}
                </div>
                )}
            </React.Fragment>
            );
        })()}

        {/* Phase 8: All Players / Draft Picks / Custom Reports — ex-League Map sub-views
            rendered inline via LeagueMapTab's embed mode. Local state lives in AnalyticsPanel
            so sort/filter/search persist as the user moves between sub-tabs. */}
        {(analyticsViewTab === 'players' || analyticsViewTab === 'picks' || analyticsViewTab === 'reports') && React.createElement(window.AnalyticsLeagueEmbed || (() => null), {
            analyticsTab: analyticsViewTab, standings, currentLeague, playersData, statsData, sleeperUserId,
            myRoster, leagueSkin: resolvedLeagueSkin, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName,
        })}

        </React.Fragment>
        )}
    </div>
    );
}

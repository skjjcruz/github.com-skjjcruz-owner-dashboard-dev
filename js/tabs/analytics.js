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
        // 'assets' merges the former 'players' + 'picks' sub-tabs into one screen
        // with an internal Players/Picks toggle (handled inside LeagueMapTab).
        { key: 'assets', label: 'Players & Picks' },
        // Reports tab strip now reads its full label ('Custom Reports') — navLabel dropped.
        { key: 'reports', label: 'Custom Reports' },
    ];
    const activeSubTab = subTabs.find(t => t.key === analyticsTab) || subTabs[0];
    const analyticsViewTab = activeSubTab.key;
    const analyticsContext = {
        roster: 'Winner-template gaps, room coverage, and roster construction evidence.',
        draft: 'Pick value, hit-rate patterns, and current-pick strategy.',
        trades: 'Trade efficiency, waiver activity, FAAB, and market pressure.',
        assets: 'Full player universe and draft-pick capital in one ledger — toggle Players / Picks.',
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

            // ── Benchmark provenance: every gap KPI rides on the winner set, so disclose how
            //    it was chosen (real playoff brackets vs a current-standings fallback) and its size.
            const winnerSource = d.winnerSource || d.source || 'standings';
            const winnerN = winnerIds.size;
            const benchHigh = winnerSource === 'brackets' && winnerN >= 3;
            const benchConfidence = benchHigh ? 'High' : (winnerN < 2 ? 'Very Low' : 'Low');
            const benchConfColor = benchHigh ? goodColor : (winnerN < 2 ? badColor : warnColor);

            // ── Pick capital coverage (future picks vs the horizon ideal) — already computed by assessTeam.
            const picks = assessment?.picksAssessment || null;
            const pickNet = picks ? (picks.totalPicks - picks.idealTotal) : null;

            // ── Aging-cliff at-risk set, computed ONCE and shared by the Win-Now Pressure chip and
            //    the Aging Cliff Alert (both sides now use the same value-window-end threshold).
            const CLIFF_DHQ = 2000, CLIFF_LEAD = 2;
            const cliffValueEnd = (pos) => typeof window.App?.getValueWindowEnd === 'function'
                ? window.App.getValueWindowEnd(pos)
                : ((window.App?.peakWindows || {})[pos] || [23, 29])[1];
            let rosterCliffTotalDHQ = 0, rosterCliffAtRiskDHQ = 0;
            const rosterAtRiskPlayers = [];
            const _pmCliff = window.App?.LI?.playerMeta || {};
            (allRosters.find(ros => ros.roster_id === myRid)?.players || []).forEach(pid => {
                const dq = playerScores[pid] || 0;
                const mt = _pmCliff[pid] || {};
                rosterCliffTotalDHQ += dq;
                if (!mt.age || !mt.pos) return;
                if (mt.age + CLIFF_LEAD > cliffValueEnd(mt.pos) && dq >= CLIFF_DHQ) {
                    rosterCliffAtRiskDHQ += dq;
                    rosterAtRiskPlayers.push({ name: playersData[pid]?.full_name || mt.name || ('Player ' + pid), age: mt.age, dhq: dq });
                }
            });
            const rosterCliffPct = rosterCliffTotalDHQ > 0 ? Math.round(rosterCliffAtRiskDHQ / rosterCliffTotalDHQ * 100) : 0;
            rosterAtRiskPlayers.sort((a, b) => b.dhq - a.dhq);

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
            // (Removed dead posBarItems/posBarWinnerItems/radarValues — no BarChart/Radar
            //  is rendered in this block; investmentRows is the only consumer of posInvestment.)

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
            // Health rank: convert an un-actionable absolute score into a buy/sell-relative-to-field signal.
            const myRankIdx = teamRankings.findIndex(t => t.isMe);
            const myRank = myRankIdx >= 0 ? myRankIdx + 1 : null;
            const rankPct = (myRank && teamRankings.length > 1) ? Math.round((teamRankings.length - myRank) / (teamRankings.length - 1) * 100) : null;

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
            // (Removed Bench Depth Concern, Total Value Gap, and Strong Compete Window insights —
            //  they restated the Startable Surplus / Champion Value Gap / Win-Now Pressure KPIs.)

            const rosterNeedGaps = (needs || []).map(n => {
                const data = assessment?.posAssessment?.[n.pos] || {};
                // Use the canonical starting requirement; do NOT fabricate a 0/1 deficit when meta is still loading.
                const required = data.startingReq || data.minQuality || data.ideal || null;
                const have = data.nflStarters ?? data.actual ?? null;
                const priority = n.urgency === 'deficit' ? 'critical' : 'high';
                return {
                    priority,
                    pos: n.pos,
                action: (n.urgency === 'deficit' ? 'Add ' : 'Build ') + posLabel(n.pos) + (n.urgency === 'deficit' ? ' starter coverage' : ' depth'),
                detail: posLabel(n.pos) + ' is a current roster ' + n.urgency + ((have != null && required != null) ? ': ' + have + '/' + required + ' starter-quality players by league settings.' : ' — see Coverage Matrix for counts.'),
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
            // Compare present ages on both sides; winners are historical, so time-shifting only
            // your side (the old +timeDelta) biased the delta in time-machine mode.
            const projMyAge = m.avgAge;
            const projWAge = w.avgAge;
            const ageDiffDiag = projMyAge - projWAge;
            const eliteDiffDiag = mElite - wElite;
            const dhqGap = m.avgTotalDHQ - w.avgTotalDHQ;

            // Startable Surplus / Deficit — net value-gated (DHQ>=3000) starters vs league lineup needs.
            let startableSurplus = 0;
            ['QB','RB','WR','TE','K','DEF','DL','LB','DB'].forEach(pos => {
                const have = Math.round(m.posStartable?.[pos] || 0);
                const reqRaw = assessment?.posAssessment?.[pos] || {};
                const req = reqRaw.startingReq || reqRaw.minQuality || 0;
                if (!have && !req) return;
                startableSurplus += (have - req);
            });
            // Roster Value Concentration (top-5 DHQ share) vs the champion template.
            const concMe = Math.round((m.topPlayerConcentration || 0) * 100);
            const concWin = Math.round((w.topPlayerConcentration || 0) * 100);
            const concDelta = concMe - concWin;
            // Win-Now Pressure — the cliff% x window interaction that drives sell timing.
            const winNowScore = (rosterCliffPct >= 25 && compYears <= 2) ? 'CRITICAL' : (rosterCliffPct >= 25) ? 'MANAGED' : (rosterCliffPct >= 15 && compYears <= 1) ? 'ELEVATED' : 'LOW';
            const winNowColor = winNowScore === 'CRITICAL' ? badColor : winNowScore === 'LOW' ? goodColor : warnColor;

            // Operating thesis: drive off the robust tier/window/cliff signals; only lean on the
            // noisy winner-template deltas when the champion sample is trustworthy (winnerN >= 2).
            const rosterStrategy = (winnerN < 2)
                ? (tier === 'REBUILDING' ? 'accumulate youth and picks — you are early in the build (champion benchmark unavailable)' : 'target your weakest starter rooms (champion benchmark unavailable for template comparison)')
                : (tier === 'REBUILDING' || compYears <= 1) ? 'sell aging veterans for youth and picks — your window is closing'
                : (rosterCliffPct >= 25 && compYears <= 2) ? 'win now: cash aging value before the cliff while your window is open'
                : (ageDiffDiag > 1.5 && dhqGap < 0) ? 'sell aging veterans and acquire young elites'
                : (eliteDiffDiag < -1) ? 'buy young elite players to close the talent gap'
                : (dhqGap >= 0 && ageDiffDiag <= 0.5) ? 'hold course — your roster matches the elite tier template'
                : 'target strategic upgrades at your weakest positions';
            const rosterProofItems = [
                { label: 'Champion Value Gap', value: winnerN < 2 ? '—' : signedNum(dhqGap, ' DHQ'), detail: winnerN < 2 ? 'Champion sample too small (' + winnerN + ') to benchmark.' : 'You vs ' + winnerN + '-team ' + (winnerSource === 'brackets' ? 'champion' : 'top-standings') + ' template (avg ' + numFmt(w.avgTotalDHQ) + ' DHQ).', tone: winnerN < 2 ? 'warn' : toneFromDelta(dhqGap), color: winnerN < 2 ? warnColor : (dhqGap >= 0 ? goodColor : badColor) },
                { label: 'Elite Asset Gap', value: winnerN < 2 ? '—' : signedNum(eliteDiffDiag), detail: winnerN < 2 ? 'Champion sample too small to benchmark elites.' : 'Your ' + mElite + ' elites vs ' + wElite + ' for the ' + winnerN + '-team template.', tone: winnerN < 2 ? 'warn' : toneFromDelta(eliteDiffDiag), color: winnerN < 2 ? warnColor : (eliteDiffDiag >= 0 ? goodColor : badColor) },
                { label: 'Startable Surplus', value: signedNum(startableSurplus), detail: startableSurplus >= 0 ? 'Net value-gated (DHQ≥3000) starters above league requirements — your tradeable depth.' : 'You are short ' + Math.abs(startableSurplus) + ' startable bodies vs league lineup needs.', tone: startableSurplus >= 0 ? 'good' : 'bad', color: startableSurplus >= 0 ? goodColor : badColor },
                { label: 'Age Window Delta', value: signedNum(Number(ageDiffDiag.toFixed(1)), ' yrs'), detail: 'Negative = younger than the ' + (winnerN || 0) + '-team template. Compared at present age (avg ' + w.avgAge.toFixed(1) + ' yrs); winners are historical so no time-shift is applied.', tone: Math.abs(ageDiffDiag) <= 1 ? 'good' : ageDiffDiag > 0 ? 'warn' : 'good', color: Math.abs(ageDiffDiag) <= 1 ? goodColor : warnColor },
                { label: 'Top-5 Concentration', value: concMe + '%', detail: winnerN < 2 ? 'Share of roster DHQ in your top 5 assets.' : 'Top-5 share of roster DHQ vs ' + concWin + '% champion template (' + (concDelta > 8 ? 'top-heavy, win-now/fragile' : concDelta < -8 ? 'unusually balanced' : 'balanced') + ').', tone: Math.abs(concDelta) <= 8 ? 'good' : 'warn', color: Math.abs(concDelta) <= 8 ? goodColor : warnColor },
            ];
            const gapRows = (gapsList.length ? gapsList.slice(0, 6) : [{ action: 'No critical construction gap', detail: 'Roster template is not flagging a major room-level deficit.', priority: 'low' }])
                .map(g => ({
                    kicker: (g.source === 'roster-assessment' ? 'Current Need' : 'Champion Template'),
                    label: g.action || g.area || 'Roster signal',
                    detail: g.detail || 'Use module tabs to inspect the player-level evidence behind this room.',
                    value: (g.priority || g.severity || 'low').toUpperCase(),
                    color: sevColor(g.priority || g.severity || 'low'),
                }));
            // Pick Capital Coverage — do you even hold the draft currency to execute the thesis?
            if (picks) {
                gapRows.unshift({
                    kicker: 'Draft Capital',
                    label: (pickNet >= 0 ? 'Pick Surplus' : 'Pick Deficit') + ' (' + picks.totalPicks + '/' + picks.idealTotal + ')',
                    detail: picks.roundsMissing ? picks.roundsMissing + ' draft round(s) with zero picks across your horizon — ammo to close the Elite Asset Gap is ' + (pickNet >= 0 ? 'available' : 'short') + '.' : 'You hold ' + picks.totalPicks + ' future picks vs an ideal of ' + picks.idealTotal + '.',
                    value: (pickNet >= 0 ? '+' : '') + pickNet,
                    color: pickNet >= 0 ? goodColor : (picks.status === 'deficit' ? badColor : warnColor),
                });
            }

            return (
            <React.Fragment>
                <AnalyticsCommandPanel
                    title="What exactly separates this roster from the league's winning build?"
                    thesis={'Analytics is now reading your roster as evidence: winner-template gaps, room-level coverage, age-window risk, and the positions where a move actually changes your title path. Suggested operating thesis: ' + rosterStrategy + '.'}
                    stats={[
                        { label: 'Evidence Set', value: allRosters.length + ' teams', sub: 'live league rosters' },
                        { label: 'Champion Sample', value: winnerN + ' teams', sub: winnerSource === 'brackets' ? 'real bracket champions' : 'standings fallback' },
                        { label: 'Benchmark Confidence', value: benchConfidence, sub: benchHigh ? 'brackets, n>=3' : (winnerN < 2 ? 'sample too small' : 'low-trust template'), color: benchConfColor },
                        { label: 'Current Tier', value: tier || 'UNKNOWN', sub: myRank ? '#' + myRank + ' of ' + teamRankings.length + (rankPct != null ? ' · ' + rankPct + 'th pct' : '') : healthScore + ' health', color: tier === 'REBUILDING' ? badColor : tier === 'CONTENDER' || tier === 'ELITE' ? goodColor : warnColor },
                        { label: 'Win-Now Pressure', value: winNowScore, sub: rosterCliffPct + '% at cliff · ' + compYears + 'yr window (model est.)', color: winNowColor },
                    ]}
                />

                <AnalyticsProofGrid items={rosterProofItems} />

                <div className="analytics-lab-grid">
                    <div className="analytics-lab-card">
                        <span>Champion Blueprint</span>
                        <strong>Position Investment Delta</strong>
                        <p>Bars show your DHQ share by room vs the champion-template share. Shares are zero-sum — being light in one room often just means you are (correctly) heavy in another (e.g. QB in superflex), so read the Gap against your format, not in isolation.</p>
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
                            <div style={aHeaderStyle}><span>YOUR 5-YEAR OUTLOOK</span><span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>Model estimate — ages today's roster, no future trades/draft</span></div>
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
                    const ps2 = window.App?.LI?.playerScores || {};
                    const pm2 = window.App?.LI?.playerMeta || {};
                    // Reuse the shared at-risk set computed once at tab scope (same unified
                    // value-window-end threshold the Win-Now Pressure chip uses).
                    const arPct2 = rosterCliffPct;
                    const arPlayers2 = rosterAtRiskPlayers;
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
                                                    // Use the SAME value-window-end threshold as the 'you' side (was peak-window end — a sign-flipping mismatch).
                                                    const pe = cliffValueEnd(mv.pos);
                                                    if (mv.age + CLIFF_LEAD > pe && dv >= CLIFF_DHQ) lgA += dv;
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
            // (Removed Draft Grade computation — it was the league-wide winner-vs-field spread,
            //  identical for every team and never personal. Replaced by Draft ROI / R1-R2 Anchor.)
            // Compute top draft position for winners
            // Template Lean: restrict to R1-R2 (R1 weighted double) — the old all-round sum let a
            // repeated late-round position outrank a true early anchor despite the 'early-round' label.
            const winnerTopPos = {};
            rounds.filter(rd => rd <= 2).forEach(rd => {
                Object.entries(dr.winnerDraftProfile[rd] || {}).forEach(([pos, pct]) => {
                    winnerTopPos[pos] = (winnerTopPos[pos] || 0) + pct * (rd === 1 ? 2 : 1);
                });
            });
            const topDraftTarget = Object.entries(winnerTopPos).sort((a,b) => b[1] - a[1])[0];
            const hasDraftOutcomeHistory = draftOutcomes.length > 0 && rounds.length > 0 && hitRounds > 0;
            // Winner-benchmark provenance (mirrors the Roster tab): disclose sample size + source.
            const winnerIds = new Set(d.winners || []);
            const winnerSampleN = winnerIds.size;
            const benchSource = d.winnerSource || d.source || 'standings';
            const benchHigh = benchSource === 'brackets' && winnerSampleN >= 3;

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
            const myHitCounts = {};
            rounds.forEach(rd => {
                const myPicks = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid);
                if (!myPicks.length) return;
                myHitCounts[rd] = myPicks.length;
                const hits = myPicks.filter(dp => dp.isHit || dp.isStarter).length;
                myHitRates[rd] = hits / myPicks.length;
            });
            const myR1Hit = myHitRates[1] || 0;
            const winnerR1Hit = (dr.winnerHitRate[1] || {}).winners || 0;
            const topDraftPos = topDraftTarget ? topDraftTarget[0] : null; // null-honest; no 'RB/WR' mask
            // Personal R1 + R1-R2 anchor conversion, with explicit denominators (suppressed when thin).
            const myR1Picks = draftOutcomes.filter(dp => dp.round === 1 && dp.roster_id === myRid);
            const myR1Count = myR1Picks.length;
            const myR1Hits = myR1Picks.filter(dp => dp.isHit || dp.isStarter).length;
            const winnerR1Count = draftOutcomes.filter(dp => dp.round === 1 && winnerIds.has(dp.roster_id)).length;
            const myAnchorPicks = draftOutcomes.filter(dp => dp.roster_id === myRid && dp.round <= 2);
            const myAnchorN = myAnchorPicks.length;
            const myAnchorHits = myAnchorPicks.filter(dp => dp.isHit || dp.isStarter).length;
            const myAnchorRate = myAnchorN ? myAnchorHits / myAnchorN : 0;
            const winnerAnchorN = draftOutcomes.filter(dp => dp.round <= 2 && winnerIds.has(dp.roster_id)).length;
            const winnerAnchorHits = draftOutcomes.filter(dp => dp.round <= 2 && winnerIds.has(dp.roster_id) && (dp.isHit || dp.isStarter)).length;
            const winnerAnchorRate = winnerAnchorN ? winnerAnchorHits / winnerAnchorN : 0;
            // Slot-adjusted personal draft skill: realized normValue vs league-avg normValue at that exact slot.
            const _pickVals = window.App?.LI?.dhqPickValues || {};
            const myRoiSamples = draftOutcomes.filter(dp => dp.roster_id === myRid && (dp.seasonsAvailable || 0) >= 1 && (_pickVals[dp.pick_no]?.avgNorm || 0) > 0).map(dp => ({ realized: dp.normValue || 0, expected: _pickVals[dp.pick_no].avgNorm }));
            const myRoiN = myRoiSamples.length;
            const _roiDiffSum = myRoiSamples.reduce((s, x) => s + (x.realized - x.expected), 0);
            const _roiExpSum = myRoiSamples.reduce((s, x) => s + x.expected, 0);
            const myRoiPct = (myRoiN && _roiExpSum > 0) ? Math.round(_roiDiffSum / _roiExpSum * 100) : null;
            const reachIndex = myRoiN ? Math.round(_roiDiffSum / myRoiN) : null;
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
            const movedPickCount = tradedPicks.filter(p => !sameId(p.owner_id, p.roster_id)).length;
            // Draft-only fallback when no per-pick outcome rows exist (no championship/history filler).
            const historicalProofItems = [
                { label: 'Owned Picks', value: currentPicks.length || '\u2014', detail: currentPickValue.toLocaleString() + ' DHQ across visible years.', tone: 'good', color: goodColor },
                { label: 'Early Capital', value: earlyPicks, detail: 'Picks in R1-R2 to anchor a build.', tone: earlyPicks >= 3 ? 'good' : 'warn', color: earlyPicks >= 3 ? goodColor : warnColor },
                { label: 'Draft Outcomes', value: 'Pending', detail: 'No per-pick outcome rows yet; reads use slot value only.', tone: 'warn', color: warnColor },
            ];
            const draftProofItems = hasDraftOutcomeHistory ? [
                { label: 'League Skill Spread', value: signedNum(Math.round(avgHitAdv * 100), ' pts'), detail: 'Elite-vs-field hit-rate gap across ' + hitRounds + ' rounds (league-wide, not your team).', tone: toneFromDelta(avgHitAdv), color: avgHitAdv >= 0 ? goodColor : badColor },
                { label: 'Elite R1 Benchmark', value: pctFmt(winnerR1Hit), detail: 'Title-tier R1 hit rate (n=' + winnerR1Count + ' winner R1 picks).', tone: winnerR1Count >= 3 ? 'good' : 'warn', color: winnerR1Count >= 3 ? goodColor : warnColor },
                { label: 'Your R1 Conversion', value: myR1Count < 2 ? 'n=' + myR1Count : pctFmt(myR1Hit), detail: myR1Count < 2 ? 'Need 2+ recorded R1 picks; only ' + myR1Count + ' loaded.' : myR1Hits + '/' + myR1Count + ' R1 picks hit (elite ' + pctFmt(winnerR1Hit) + ').', tone: myR1Count < 2 ? 'warn' : (myR1Hit >= winnerR1Hit ? 'good' : 'warn'), color: myR1Count < 2 ? warnColor : (myR1Hit >= winnerR1Hit ? goodColor : warnColor) },
                { label: 'R1-R2 Anchor Conversion', value: myAnchorN < 2 ? 'n=' + myAnchorN : pctFmt(myAnchorRate), detail: myAnchorN < 2 ? 'Need 2+ premium picks; only ' + myAnchorN + ' loaded.' : myAnchorHits + '/' + myAnchorN + ' premium picks hit (elite ' + pctFmt(winnerAnchorRate) + ', n=' + winnerAnchorN + ').', tone: myAnchorN < 2 ? 'warn' : (myAnchorRate >= winnerAnchorRate ? 'good' : 'warn'), color: myAnchorN < 2 ? warnColor : (myAnchorRate >= winnerAnchorRate ? goodColor : warnColor) },
                { label: 'Value vs Slot', value: reachIndex == null ? '\u2014' : signedNum(reachIndex, ' pts'), detail: reachIndex == null ? 'Not enough graded picks to score reach.' : (reachIndex >= 0 ? 'Your picks beat their slot baseline on average.' : 'Your picks underperform their slot baseline (reach signal).'), tone: reachIndex == null ? 'warn' : toneFromDelta(reachIndex), color: reachIndex == null ? warnColor : (reachIndex >= 0 ? goodColor : badColor) },
                { label: 'Current Capital', value: currentPickValue.toLocaleString(), detail: currentPicks.length + ' current picks, ' + earlyPicks + ' in R1-R2.', tone: earlyPicks >= 3 ? 'good' : 'warn', color: earlyPicks >= 3 ? goodColor : warnColor },
                { label: 'Benchmark Confidence', value: benchHigh ? 'High' : 'Low', detail: (benchSource === 'brackets' ? 'Champions from real playoff brackets' : 'Champions inferred from standings (fallback)') + ', n=' + winnerSampleN + '.', tone: benchHigh ? 'good' : 'warn', color: benchHigh ? goodColor : warnColor },
            ] : historicalProofItems;
            const hitRows = rounds.filter(rd => dr.winnerHitRate[rd]).map(rd => ({
                label: 'R' + rd + ((myHitCounts[rd] || 0) < 2 ? ' (n=' + (myHitCounts[rd] || 0) + ')' : ''),
                yours: Math.round(((myHitRates[rd] || 0) * 100)),
                benchmark: Math.round(((dr.winnerHitRate[rd].winners || 0) * 100)),
                suffix: ' pts',
                format: v => Math.round(v) + '%',
                color: (myHitCounts[rd] || 0) < 2 ? 'rgba(192,192,192,0.4)' : ((myHitRates[rd] || 0) >= (dr.winnerHitRate[rd].winners || 0) ? goodColor : warnColor),
            }));
            const curvePickCount = totalTeams * draftRounds;
            const curveSlots = [...new Set([1, 2, 3, 4, Math.ceil(totalTeams / 2), totalTeams, totalTeams + 1, totalTeams * 2, totalTeams * 3, Math.max(1, curvePickCount - Math.floor(curvePickCount * 0.12)), curvePickCount])].filter(p => p <= curvePickCount);
            const curveValues = curveSlots.map(p => {
                const rd = Math.ceil(p / totalTeams);
                const slot = ((p - 1) % totalTeams) + 1;
                return pickValue(leagueSeason, rd, slot);
            });
            const curveMax = Math.max(...curveValues, 1);
            // Owned current-season pick overall-numbers, to overlay your picks onto the value curve.
            const myCurveOveralls = new Set(currentPicks.filter(p => p.year === leagueSeason).map(p => (p.round - 1) * totalTeams + p.slot));
            // Positional Need x Capital \u2014 your thin rooms vs where winners spend early capital.
            let needPosSet = new Set();
            try { const _assess = window.App?.assessTeamFromGlobal?.(myRid) || window.App?.LI?.assessments?.[myRid]; const _pa = _assess?.posAssessment || {}; Object.entries(_pa).forEach(([pos, a]) => { if (a && (a.status === 'deficit' || a.status === 'thin' || (a.diff || 0) < 0)) needPosSet.add(pos); }); } catch (_) {}
            const needMatch = topDraftPos && needPosSet.has(topDraftPos);
            const draftRows = (topCurrentPicks.length ? topCurrentPicks.map(p => ({
                kicker: p.own ? 'Owned Pick' : 'Acquired Pick',
                label: p.label,
                detail: p.own ? 'Original pick path' : 'From ' + (p.from || 'another roster'),
                value: (p.value || 0).toLocaleString(),
                color: p.round <= 2 ? 'var(--gold)' : 'var(--k-9b8afb, #9b8afb)',
            })) : [{ kicker: 'Pick Path', label: 'No current picks loaded', detail: 'Draft pick source did not return current inventory.', value: '\u2014' }])
                .concat((earlyPicks > 0 && needPosSet.size) ? [{ kicker: 'Need x Capital', label: needMatch ? 'Draft-for-need fit' : 'Capital vs needs mismatch', detail: 'Roster needs: ' + [...needPosSet].map(posLabel).join(', ') + '. Winners spend early on ' + (topDraftPos ? posLabel(topDraftPos) : 'skill') + '.', value: earlyPicks + ' early picks', color: needMatch ? goodColor : warnColor }] : []);
            // Slot-adjusted future-pick decay (value lost by holding) for the Capital At Risk stat.
            const futurePicksMine = currentPicks.filter(p => p.year > leagueSeason);
            const valueAtRisk = futurePicksMine.reduce((s, p) => { const yrsAhead = p.year - leagueSeason; const undiscounted = Math.round((p.value || 0) / Math.pow(0.88, yrsAhead)); return s + (undiscounted - (p.value || 0)); }, 0);
            const futureShare = currentPickValue > 0 ? Math.round(futurePicksMine.reduce((s,p)=>s+(p.value||0),0) / currentPickValue * 100) : 0;
            // Fallback (no draft outcomes): draft-relevant pick info only \u2014 no championship/history filler.
            const historicalRows = [
                { kicker: 'Owned Picks', label: currentPicks.length + ' picks', detail: 'Across visible draft years.', value: currentPickValue.toLocaleString() + ' DHQ', color: 'var(--gold)' },
                { kicker: 'Early Capital', label: earlyPicks + ' in R1-R2', detail: 'Premium capital to anchor a tier break.', value: topCurrentPicks[0]?.label || '\u2014', color: earlyPicks >= 3 ? goodColor : warnColor },
            ];
            const buildRows = [
                { kicker: 'Early Capital', label: earlyPicks + ' picks in R1-R2', detail: earlyPicks >= 3 ? 'Enough premium capital to anchor a tier break.' : 'Light on premium capital; trade-up candidates.', value: topCurrentPicks[0]?.label || '\u2014', color: earlyPicks >= 3 ? goodColor : warnColor },
                { kicker: 'Round Shape', label: draftRounds + ' rounds x ' + totalTeams + ' teams', detail: 'Resolved from roster-slot skin rules' + ((!currentLeague?.settings?.draft_rounds && draftRounds === 5) ? ' (fallback estimate).' : '.'), value: (totalTeams * draftRounds).toLocaleString() + ' picks', color: 'var(--k-9b8afb, #9b8afb)' },
            ];
            const draftStats = hasDraftOutcomeHistory ? [
                { label: 'Champion Sample', value: winnerSampleN + ' teams', sub: 'benchmark roster set' },
                { label: 'Draft ROI', value: myRoiN < 3 ? 'n=' + myRoiN : signedNum(myRoiPct, '%'), sub: myRoiN < 3 ? 'need 3+ graded picks' : 'value captured vs slot EV', color: myRoiN < 3 ? warnColor : (myRoiPct >= 0 ? goodColor : badColor) },
                { label: 'Elite R1 Hit', value: pctFmt(winnerR1Hit), sub: winnerR1Count + ' winner R1 picks' },
                { label: 'Capital At Risk', value: skinFeatures.showFuturePicks === false ? '\u2014' : '-' + valueAtRisk.toLocaleString(), sub: skinFeatures.showFuturePicks === false ? 'redraft: no future picks' : futureShare + '% of capital is future', color: valueAtRisk > 0 ? warnColor : goodColor },
                { label: 'Template Lean', value: topDraftPos ? posLabel(topDraftPos) : '\u2014', sub: topDraftPos ? 'winner R1-R2 anchor position' : 'no winner draft profile', color: topDraftPos ? undefined : warnColor },
            ] : [
                { label: 'Owned Picks', value: currentPicks.length || '\u2014', sub: currentPickValue.toLocaleString() + ' DHQ' },
                { label: 'Early Capital', value: earlyPicks, sub: 'R1-R2 picks', color: earlyPicks >= 3 ? goodColor : warnColor },
                { label: 'Capital At Risk', value: skinFeatures.showFuturePicks === false ? '\u2014' : '-' + valueAtRisk.toLocaleString(), sub: skinFeatures.showFuturePicks === false ? 'redraft' : futureShare + '% future', color: valueAtRisk > 0 ? warnColor : goodColor },
                { label: 'Template Lean', value: topDraftPos ? posLabel(topDraftPos) : '\u2014', sub: topDraftPos ? 'winner R1-R2 anchor' : 'no draft profile', color: topDraftPos ? undefined : warnColor },
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
                            {curveValues.map((v, i) => { const owned = myCurveOveralls.has(curveSlots[i]); return <i key={i} title={(owned ? 'YOUR PICK ' : '') + 'P' + curveSlots[i] + ': ' + v} style={{ height: Math.max(5, Math.round(v / curveMax * 100)) + '%', background: owned ? 'var(--gold)' : undefined, outline: owned ? '1px solid var(--gold)' : undefined }} />; })}
                        </div>
                        <div className="analytics-pick-strip" style={{ marginTop: '8px' }}>
                            {curveSlots.slice(0, 7).map((p, i) => <span key={p}>P{p} <em>{curveValues[i].toLocaleString()}</em></span>)}
                        </div>
                        {(() => { const earlies = [...currentPicks].filter(p => p.round <= 3).sort((a,b)=>a.round-b.round||a.slot-b.slot); if (earlies.length < 2) return null; const combo = earlies[earlies.length-1].value + earlies[earlies.length-2].value; const equiv = curveValues.reduce((best, v, i) => Math.abs(v - combo) < Math.abs(best.v - combo) ? { p: curveSlots[i], v } : best, { p: curveSlots[0], v: curveValues[0] }); return <p style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', marginTop: '6px' }}>Consolidation: your {earlies[earlies.length-2].label} + {earlies[earlies.length-1].label} = {combo.toLocaleString()} DHQ, roughly pick P{equiv.p}.</p>; })()}
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
                                const wRdCount = draftOutcomes.filter(dp => dp.round === rd && winnerIds.has(dp.roster_id)).length;
                                const myRdCount = draftOutcomes.filter(dp => dp.round === rd && dp.roster_id === myRid).length;
                                return (
                                <div key={rd} style={{ marginBottom: '10px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                        <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', minWidth: '65px' }}>Round {rd}<span style={{ marginLeft: '6px', fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.6 }}>n={wRdCount}</span></span>
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
                                        <div style={{ marginLeft: '65px', display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                                            <span style={{ fontSize: 'var(--text-micro)', color: 'var(--k-4ecdc4, #4ecdc4)', opacity: 0.7 }}>You n={myRdCount}</span>
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
                            <span>Pick Capital</span>
                            <strong>Draft Board Without Outcome History</strong>
                            <p>This league has no per-pick outcome rows loaded yet, so the read uses slot value and your current pick inventory rather than hit-rate history.</p>
                            <AnalyticsDataStack rows={historicalRows} />
                            {!movedPickCount && <p style={{ fontSize: 'var(--text-micro)', color: 'var(--silver)', opacity: 0.6, marginTop: '6px' }}>Fixed-slot league: no historical pick trades, so trade-up modeling is disabled.</p>}
                        </div>
                        <div className="analytics-lab-card">
                            <span>Build Map</span>
                            <strong>How To Use The Current Draft Board</strong>
                            <p>Capital is the currency here: anchor your early picks, and use the round shape to plan trade-ups and consolidations.</p>
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
            // Winner-benchmark provenance + graded win-rate + FAAB bargain/runway (this tab benchmarks you vs wp.*).
            const winnerN = d.winnerCount != null ? d.winnerCount : (d.winners || []).length;
            const benchSource = d.winnerSource || d.source || 'standings';
            const benchHigh = benchSource === 'brackets' && winnerN >= 3;
            const benchConfColor = benchHigh ? goodColor : warnColor;
            const mySampleN = (tr.myLast5 || []).length;
            const winnerTradeN = wp.totalTrades || 0;
            const myGraded = (mp.tradesWon || 0) + (mp.tradesLost || 0) + (mp.tradesFair || 0);
            const myWinRate = myGraded > 0 ? Math.round((mp.tradesWon || 0) / myGraded * 100) : null;
            const wGraded = (wp.tradesWon || 0) + (wp.tradesLost || 0) + (wp.tradesFair || 0);
            const wWinRate = wGraded > 0 ? Math.round((wp.tradesWon || 0) / wGraded * 100) : null;
            const bargainPos = Object.entries(wa.faabEffByPos || {}).map(([pos, e]) => {
                const med = (wa.leagueFaabProfile?.[pos]?.median) || 0;
                const avgBid = e.avgBid || 0;
                return { pos, med, avgBid, dhqPerDollar: e.dhqPerDollar || 0, underMedian: med > 0 && avgBid < med };
            }).filter(x => x.underMedian).sort((a, b) => b.dhqPerDollar - a.dhqPerDollar);
            const topBargain = bargainPos[0];
            const weeksElapsed = Number(currentLeague?.settings?.leg || currentLeague?.settings?.last_scored_leg || 0);
            const burnPerWeek = (weeksElapsed > 0 && waiverUsed > 0) ? waiverUsed / weeksElapsed : null;
            const runwayWeeks = (burnPerWeek && faabRemaining != null) ? Math.floor(faabRemaining / burnPerWeek) : null;

            const alerts = [];
            if (mySampleN >= 2 && mp.avgTradesPerSeason < lp.avgTradesPerSeason) alerts.push({ sev: 'medium', title: 'Low Trade Volume', msg: 'You trade below league average (' + mp.avgTradesPerSeason + ' vs ' + lp.avgTradesPerSeason + ' per season). Elite tier teams average ' + wp.avgTradesPerSeason + '.' });
            if (mySampleN >= 2 && mp.avgValueGained < 0) alerts.push({ sev: 'high', title: 'Losing Value', msg: 'You\'re losing ' + Math.abs(mp.avgValueGained) + ' DHQ per trade on average. Elite tier teams gain +' + wp.avgValueGained + '.' });
            if (winnerTradeN >= 2 && wp.partnerPreference && wp.partnerPreference !== 'Unknown' && wp.partnerPreference !== mp.partnerPreference) alerts.push({ sev: 'low', title: 'Trade Partner Strategy', msg: 'Title teams most often trade against ' + cleanPreference(wp.partnerPreference) + '-type owners; you favor ' + cleanPreference(mp.partnerPreference) + '-type owners.' });

            // (Removed dead boughtBar* bar-chart items — Trade Flow now renders the net
            //  Buy/Sell posture via allFlowPos/tradeFlowRows; the old buy-only bars were unused.)

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
                { label: 'Trade Frequency Edge', value: signedNum(Number((mp.avgTradesPerSeason - wp.avgTradesPerSeason).toFixed(1))), detail: 'Your trades/season vs elite-tier behavior' + ((window.App?.LI?.leagueYears || []).length ? '.' : ' (season count assumed; league history thin).'), tone: toneFromDelta(mp.avgTradesPerSeason - wp.avgTradesPerSeason), color: mp.avgTradesPerSeason >= wp.avgTradesPerSeason ? goodColor : warnColor },
                { label: 'Value Per Deal', value: signedNum(mp.avgValueGained, ' DHQ'), detail: 'Average DHQ gained/lost in completed trades.', tone: toneFromDelta(mp.avgValueGained), color: valueDeltaColor },
                { label: 'Trade Win Rate', value: myWinRate == null ? '\u2014' : myWinRate + '%', detail: myWinRate == null ? 'No graded trades yet.' : (mp.tradesWon || 0) + 'W / ' + (mp.tradesFair || 0) + 'F / ' + (mp.tradesLost || 0) + 'L vs elite ' + (wWinRate == null ? 'n/a' : wWinRate + '%') + '.', tone: myWinRate == null ? 'warn' : ((wWinRate != null && myWinRate >= wWinRate) || myWinRate >= 50) ? 'good' : 'warn', color: myWinRate == null ? 'var(--silver)' : (myWinRate >= (wWinRate || 50)) ? goodColor : warnColor },
                { label: 'FAAB Leverage', value: faabRemaining == null ? '\u2014' : '$' + faabRemaining.toLocaleString(), detail: waiverBudget ? Math.round(faabRemaining / Math.max(waiverBudget, 1) * 100) + '% of budget remaining.' : 'No FAAB budget configured.', tone: faabRemaining == null ? 'warn' : faabRemaining >= waiverBudget * 0.5 ? 'good' : 'warn', color: faabRemaining == null ? 'var(--silver)' : faabRemaining >= waiverBudget * 0.5 ? goodColor : warnColor },
                { label: 'FAAB Bargain Spot', value: topBargain ? posLabel(topBargain.pos) : '\u2014', detail: topBargain ? 'Avg bid $' + Math.round(topBargain.avgBid) + ' below $' + Math.round(topBargain.med) + ' median, ' + topBargain.dhqPerDollar + ' DHQ/$.' : 'No position is priced below its median yet.', tone: topBargain ? 'good' : 'warn', color: topBargain ? goodColor : warnColor },
                { label: 'Best Waiver Yield', value: (topEffPos && (topEffPos[1].count || 0) >= 2) ? posLabel(topEffPos[0]) : '\u2014', detail: topEffPos ? (topEffPos[1].dhqPerDollar || 0) + ' DHQ/FAAB-$ (hindsight, ' + (topEffPos[1].count || 0) + ' claims).' : 'Bid outcome sample is still thin.', tone: (topEffPos && (topEffPos[1].count || 0) >= 2) ? 'good' : 'warn', color: (topEffPos && (topEffPos[1].count || 0) >= 2) ? goodColor : warnColor },
            ];
            // Net Buy/Sell Posture: positionsSold is already returned by the engine but was unused here.
            const allFlowPos = [...new Set([...Object.keys(wp.positionsBought||{}), ...Object.keys(mp.positionsBought||{}), ...Object.keys(wp.positionsSold||{}), ...Object.keys(mp.positionsSold||{})])].filter(p => p !== 'UNK').sort();
            const tradeFlowRows = allFlowPos.map(pos => ({
                label: posLabel(pos),
                yours: ((mp.positionsBought||{})[pos]||0) - ((mp.positionsSold||{})[pos]||0),
                benchmark: ((wp.positionsBought||{})[pos]||0) - ((wp.positionsSold||{})[pos]||0),
                suffix: '',
                format: v => signedNum(Math.round(v)),
                color: 'var(--k-7c6bf8, #7c6bf8)',
            }));
            const marketRows = [
                { kicker: 'Partner Archetype', label: 'Elite teams trade with', detail: 'Preferred counterparty DNA among title teams.', value: cleanPreference(wp.partnerPreference), color: 'var(--gold)' },
                { kicker: 'Your Pattern', label: 'You trade with', detail: 'Your observed partner-DNA preference.', value: cleanPreference(mp.partnerPreference), color: 'var(--k-4ecdc4, #4ecdc4)' },
                { kicker: 'Winner Trade Timing', label: 'Trade entry point', detail: 'When title teams usually create value via trades (trade timing, not waiver claims).', value: (wa.winnerTiming?.early || 0) >= 0.5 ? 'Early' : (wa.winnerTiming?.mid || 0) >= (wa.winnerTiming?.late || 0) ? 'Mid' : 'Late', color: goodColor },
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
                        { label: 'Elite Volume', value: wp.avgTradesPerSeason, sub: 'trades/season \u00b7 n=' + winnerN },
                        { label: 'High Price Room', value: topFaabPos ? posLabel(topFaabPos[0]) : '\u2014', sub: topFaabPos ? '$' + Math.round(topFaabPos[1].avg || 0) + ' avg bid' : 'bid history thin' },
                        { label: 'FAAB Runway', value: runwayWeeks == null ? (faabRemaining == null ? '\u2014' : '$' + faabRemaining.toLocaleString()) : runwayWeeks + ' wk', sub: runwayWeeks == null ? 'pace est. pending' : '~$' + Math.round(burnPerWeek) + '/wk est.', color: runwayWeeks == null ? undefined : runwayWeeks <= 2 ? warnColor : goodColor },
                        { label: 'Benchmark Confidence', value: benchHigh ? 'High' : 'Low', sub: (benchSource === 'brackets' ? 'bracket' : 'standings') + ', n=' + winnerN, color: benchConfColor },
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
                        <strong>When Winners Trade</strong>
                        <p>When title teams create value via TRADES vs the league baseline (trade timing, not waiver claims).</p>
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
                        <strong>Net Buy/Sell Posture by Position</strong>
                        <p>Positive = net buyer, negative = net seller (acquired minus sold). Gold marker = elite-tier posture.</p>
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
                            // Engine emits `net` (and now a `netDhq` alias); the old code read only netDhq and showed +0/Fair always.
                            const netDhq = Number.isFinite(Number(trade.netDhq)) ? Number(trade.netDhq) : Number(trade.net || 0);
                            const grade = trade.result || (netDhq > 200 ? 'won' : netDhq < -200 ? 'lost' : 'fair');
                            const result = grade === 'won' ? 'Won' : grade === 'lost' ? 'Lost' : 'Fair';
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

                {/* ── BIGGEST WIN / LOSS (all-time, most lopsided) ── */}
                {(tr.myBiggestWin || tr.myBiggestLoss) && (
                <div className="analytics-lab-grid">
                    {tr.myBiggestWin && (
                        <div className="analytics-lab-card">
                            <span>Best Deal</span><strong>Biggest Win</strong>
                            <p style={{ color: goodColor, fontWeight: 700 }}>{signedNum(tr.myBiggestWin.netDhq != null ? tr.myBiggestWin.netDhq : tr.myBiggestWin.net, ' DHQ')}</p>
                            <div className="analytics-mini-table">
                                <div><strong>Got</strong><span>{assetListText(tr.myBiggestWin.got)}</span></div>
                                <div><strong>Gave</strong><span>{assetListText(tr.myBiggestWin.gave)}</span></div>
                            </div>
                        </div>
                    )}
                    {tr.myBiggestLoss && (
                        <div className="analytics-lab-card">
                            <span>Worst Deal</span><strong>Biggest Loss</strong>
                            <p style={{ color: badColor, fontWeight: 700 }}>{signedNum(tr.myBiggestLoss.netDhq != null ? tr.myBiggestLoss.netDhq : tr.myBiggestLoss.net, ' DHQ')}</p>
                            <div className="analytics-mini-table">
                                <div><strong>Got</strong><span>{assetListText(tr.myBiggestLoss.got)}</span></div>
                                <div><strong>Gave</strong><span>{assetListText(tr.myBiggestLoss.gave)}</span></div>
                            </div>
                        </div>
                    )}
                </div>
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
        {(analyticsViewTab === 'assets' || analyticsViewTab === 'reports') && React.createElement(window.AnalyticsLeagueEmbed || (() => null), {
            analyticsTab: analyticsViewTab, standings, currentLeague, playersData, statsData, sleeperUserId,
            myRoster, leagueSkin: resolvedLeagueSkin, activeYear, timeRecomputeTs, setActiveTab, getAcquisitionInfo, getOwnerName,
        })}

        </React.Fragment>
        )}
    </div>
    );
}

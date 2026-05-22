// ══════════════════════════════════════════════════════════════════
// league-detail.js — LeagueDetail: Dashboard, My Team, League Map, Analytics
// This is the main app shell after selecting a league.
// ══════════════════════════════════════════════════════════════════
    const LEAGUE_WR_KEYS  = window.App.WR_KEYS;
    const LeagueStorage = window.App.WrStorage;

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function markdownToHtml(str) {
        return escapeHtml(str).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    }

    function resolvePlatformProvider(league) {
        const registry = window.App?.Platforms || window.Platforms;
        const registered = registry?.getForLeague?.(league);
        if (registered) return registered;

        const platform = league?._platform
            || (league?._mfl ? 'mfl' : league?._espn ? 'espn' : league?._yahoo ? 'yahoo' : 'sleeper');
        const fallbackProviders = {
            sleeper: window.Sleeper?.provider,
            mfl: window.MFL?.provider,
            espn: window.ESPN?.provider,
            yahoo: window.Yahoo?.provider,
        };
        const fallback = fallbackProviders[platform] || null;
        if (fallback && registry?.register) {
            registry.register(fallback);
        }
        return fallback;
    }

    // ══════════════════════════════════════════════════════════════════════════
    // END DRAFT TAB
    // ══════════════════════════════════════════════════════════════════════════

    // League Detail Component
    function LeagueDetail({ league, onBack, sleeperUserId, onOpenSettings, activeTab: propActiveTab, onTabChange }) {
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [playersData, setPlayersData] = useState({});
        const [myRoster, setMyRoster] = useState(null);
        const [standings, setStandings] = useState([]);
        const [viewingOwnerId, setViewingOwnerId] = useState(sleeperUserId);
        const [statsData, setStatsData] = useState({});
        const [projectionsData, setProjectionsData] = useState({});
        const [stats2025Data, setStats2025Data] = useState({});
        const [currentLeague, setCurrentLeague] = useState(league);
        const [activeYear, setActiveYear] = useState(league.season);
        // Platform detection via the unified PlatformProvider registry.
        // Providers know whether they support historical year chains,
        // so feature flags like `isSleeper` (used for year switching UI)
        // are now derived from provider.capabilities instead of hardcoded.
        const _provider = resolvePlatformProvider(currentLeague);
        const isSleeper = _provider?.id === 'sleeper';
        const [trending, setTrending] = useState({ adds: [], drops: [] });
        const [localActiveTab, setLocalActiveTab] = useState('dashboard');
        // Phase 8: any stale/saved state that points at the removed 'league' tab auto-redirects to Analytics.
        useEffect(() => {
            if (localActiveTab === 'league') setLocalActiveTab('analytics');
            if (propActiveTab === 'league' && typeof onTabChange === 'function') onTabChange('analytics');
        }, [localActiveTab, propActiveTab]);
        const activeTab = propActiveTab !== undefined ? propActiveTab : localActiveTab;
        const setActiveTab = onTabChange || setLocalActiveTab;
        const [tradeSubTab, setTradeSubTab] = useState(null); // when set, TradeCalcTab opens this sub-tab
        const [selectedPlayerPid, setSelectedPlayerPid] = useState(null);

        // ── TIME CONTEXT — the temporal lens of the entire app ──
        // Single source of truth. All modules read timeYear and derived helpers.
        const currentSeason = parseInt(league.season) || new Date().getFullYear();
        const [timeYear, setTimeYear] = useState(() => {
            const saved = LeagueStorage.get(LEAGUE_WR_KEYS.TIME_YEAR);
            return saved !== null ? parseInt(saved) : currentSeason;
        });
        const [timeLoading, setTimeLoading] = useState(false);
        const [timeRecomputeTs, setTimeRecomputeTs] = useState(Date.now());
        const [basePlayersData, setBasePlayersData] = useState(null);

        // ── SeasonContext state — reactive data shared with tab components ──
        const [seasonCtxData, setSeasonCtxData] = useState({
            season: league.season || '',
            playerStats: {},
            tradedPicks: [],
            rosters: [],
            myRosterId: null,
            lastUpdated: 0,
        });

        // ── VIEW MODE — Analyst is now the only mode (Brief tab replaces Flash Brief) ──
        const [viewMode, setViewMode] = useState('analyst');
        const isAnalyst = true;

        // Open full player modal instead of mini card
        // selectPlayer is exposed via SeasonContext AND kept on window for legacy consumers
        // Also aliased as openPlayerModal so flash-brief, global-view, etc. all use the same entry point.
        // SI-2: Unified PlayerCard (window.WR.openPlayerCard) is the primary surface.
        // Expose playersData/statsData globally so the unified card host can read them without prop drilling.
        useEffect(() => {
            window.App._playersCache = playersData;
            window._wrStatsData = statsData;
        }, [playersData, statsData]);
        const selectPlayer = useCallback((pid) => {
            // Close any existing inline card / legacy CDN modal first
            setSelectedPlayerPid(null);
            if (typeof window.closeFWPlayerModal === 'function') window.closeFWPlayerModal();
            setTimeout(() => {
                // Primary: unified War Room PlayerCard (SI-2)
                if (window.WR && typeof window.WR.openPlayerCard === 'function') {
                    window.WR.openPlayerCard(pid, { scoringSettings: currentLeague?.scoring_settings || {} });
                    return;
                }
                // Fallbacks (kept for safety during rollout)
                if (typeof window.openFWPlayerModal === 'function') {
                    window.openFWPlayerModal(pid, playersData, statsData, currentLeague?.scoring_settings || {});
                } else {
                    setSelectedPlayerPid(pid);
                }
            }, 10);
        }, [playersData, statsData, currentLeague]);
        window._wrSelectPlayer = selectPlayer;
        window.openPlayerModal = selectPlayer;
        // SI-2 deferred: expose nav + compare globals so the unified PlayerCard's action buttons work.
        window.wrNavigateTab = (tab) => { try { setActiveTab(tab); } catch (_) {} };
        window.wrOpenCompare = (pid) => {
            try {
                // Jump to My Roster → Compare view and pre-select the player's team when possible.
                setActiveTab('myteam');
                const roster = (currentLeague?.rosters || []).find(r => (r.players || []).concat(r.taxi || [], r.reserve || []).includes(String(pid)));
                if (roster) window._wrComparePreselect = roster.roster_id;
                // Defer dispatching a custom event so the tab has time to mount
                setTimeout(() => window.dispatchEvent(new CustomEvent('wr:open-compare', { detail: { pid, rosterId: roster?.roster_id } })), 50);
            } catch (_) { /* noop */ }
        };

        useEffect(() => {
            if (window.S) window.S.activeTab = activeTab;
            window.OD?.track?.('module_viewed', {
                platform: 'warroom',
                leagueId: currentLeague?.league_id || currentLeague?.id || null,
                module: activeTab,
            });
        }, [activeTab, currentLeague?.league_id, currentLeague?.id]);

        // Derived selectors — modules use these, never compute their own
        const isCurrentYear = timeYear === currentSeason;
        const isFutureYear = timeYear > currentSeason;
        const isHistoricalYear = timeYear < currentSeason;
        const timeMode = isFutureYear ? 'future' : isHistoricalYear ? 'historical' : 'current';
        const timeModeLabel = isFutureYear ? 'Projection View' : isHistoricalYear ? 'Historical View' : 'Current Season';
        const timeModeColor = isFutureYear ? '#3498DB' : isHistoricalYear ? '#F0A500' : '#2ECC71';
        const timeDelta = timeYear - currentSeason; // positive = future, negative = past
        // Build available years from the league's actual previous_league_id chain
        const [leagueStartYear, setLeagueStartYear] = useState(currentSeason);
        useEffect(() => {
            let cancelled = false;
            async function walkChain() {
                // Only platforms with a previous_league_id chain (Sleeper)
                // can walk backwards — others fall back to a 4-year span.
                const prov = window.App?.Platforms?.getForLeague?.(currentLeague);
                if (!prov?.capabilities?.hasYearChain) {
                    if (!cancelled) setLeagueStartYear(currentSeason - 4);
                    return;
                }
                let lid = currentLeague?.id;
                let earliest = currentSeason;
                for (let y = currentSeason - 1; y >= 2018 && lid; y--) {
                    try {
                        const info = await fetchLeagueInfo(lid);
                        if (!info?.previous_league_id) break;
                        lid = info.previous_league_id;
                        earliest = y;
                    } catch { break; }
                }
                if (!cancelled) setLeagueStartYear(earliest);
            }
            walkChain();
            return () => { cancelled = true; };
        }, [currentLeague?.id]);
        const timeYears = [];
        for (let y = leagueStartYear; y <= currentSeason + 2; y++) timeYears.push(y);

        // Persist time year
        useEffect(() => { LeagueStorage.set(LEAGUE_WR_KEYS.TIME_YEAR, String(timeYear)); }, [timeYear]);

        // Validate shared dependencies from ReconAI CDN
        useEffect(() => {
            const deps = {
                'dynastyValue': typeof window.dynastyValue === 'function',
                'assessTeamFromGlobal': typeof window.assessTeamFromGlobal === 'function',
                'calcOptimalPPG': typeof window.App?.calcOptimalPPG === 'function',
                'getPlayerAction': typeof window.getPlayerAction === 'function',
                'peakWindows': !!window.App?.peakWindows,
                'normPos': typeof window.App?.normPos === 'function',
            };
            const missing = Object.entries(deps).filter(([, ok]) => !ok).map(([name]) => name);
            if (missing.length) {
                console.warn('[War Room] Missing shared dependencies:', missing.join(', '), '— some features may not work. Try refreshing.');
            }
        }, []);

        // Save base player data on first load (before any age projection)
        // Also expose on window.App for cross-module reads (SOS projection, trade-calc)
        useEffect(() => {
            if (Object.keys(playersData).length > 100) {
                window.App._playersCache = playersData;
                if (!basePlayersData) setBasePlayersData(playersData);
            }
        }, [playersData]);

        // ── SOS engine init — fires once playersData is populated ──
        useEffect(() => {
            if (Object.keys(playersData).length < 100) return;
            if (window.App.SOS?.ready) return;
            const season = String(parseInt(currentLeague?.season) || new Date().getFullYear());
            window.App.SOS?.initialize(season, playersData, () => {
                setTimeRecomputeTs(Date.now()); // trigger KPI + roster re-render
            });
        }, [playersData]);

        // ── PROJECTION ENGINE: canonical implementation lives in js/utils/player-value.js ──
        const projectPlayerValue = window.App.PlayerValue.projectPlayerValue;

        // ── LEGEND PANEL — explains War Room tools without revealing sauce ──
        function LegendPanel() {
            const [open, setOpen] = React.useState(false);
            const [expanded, setExpanded] = React.useState(false);
            const quickItems = [
                { term: 'DHQ Value', def: 'Dynasty value score (0-10,000). Production + age + situation + market.' },
                { term: 'Health Score', def: 'Team grade (0-100). 90+ Elite, 80+ Contender, 70+ Crossroads.' },
                { term: 'Elite Player', def: '7000+ DHQ or top 5 at their position across all league rosters.' },
                { term: 'Compete Window', def: 'Years until your weakest position group ages out.' },
                { term: 'Player Tags', def: 'Tag players as Trade Block, Cut, Untouchable, or Watch. Syncs between apps.' },
                { term: 'Flash Brief', def: 'Quick-action dashboard. Analyst mode shows deep data.' },
            ];
            const fullItems = [
                { cat: 'Valuations', items: [
                    { term: 'DHQ Value', def: 'Dynasty valuation score on a 0-10,000 scale. Combines on-field production, age trajectory, roster situation, positional scarcity, and market consensus. Updated when you refresh data.' },
                    { term: 'Elite Player', def: 'A player with 7000+ DHQ or a top-5 positional rank across all rosters in your league. Championship rosters typically have 2-4 elite assets.' },
                    { term: 'Player Tags', def: 'Tag any player as Trade Block, Cut, Untouchable, or Watch List. Tags sync between War Room and War Room Scout so your decisions carry across both apps.' },
                    { term: 'Trend', def: 'Year-over-year production change as a percentage. A player who went from 15 PPG to 18 PPG has a +20% trend. During the season, trend directly influences DHQ values (up to \u00B18%).' },
                ]},
                { cat: 'Team Assessment', items: [
                    { term: 'Health Score', def: 'Your team\u2019s competitive readiness on a 0-100 scale. 60% is based on your optimal starting lineup strength, 40% on positional depth and coverage. 90+ = Elite tier, 80+ = Contender, 70+ = Crossroads.' },
                    { term: 'Contender Rank', def: 'How you stack up for winning THIS season. Based on your best possible starting lineup PPG compared to every other team in the league.' },
                    { term: 'Dynasty Rank', def: 'Your long-term foundation strength. Based on total DHQ value across your entire roster \u2014 starters, bench, taxi, and picks.' },
                    { term: 'Compete Window', def: 'How many more years your roster can realistically compete before age-related decline forces a rebuild. Based on the age curves of your weakest position group.' },
                ]},
                { cat: 'Trading', items: [
                    { term: 'Owner DNA', def: 'A behavioral profile derived from each owner\u2019s trade history. Types include Fleecer (always wins trades), Stalwart (fair deals only), Dominator (wants to feel like the winner), Acceptor (open to deals), and Desperate (panic trades). Used to predict acceptance likelihood.' },
                    { term: 'Trade Impact', def: 'Before you send a trade, see exactly how it changes your health score, elite count, and competitive tier. Simulates the roster swap and recalculates everything.' },
                    { term: 'Acceptance Likelihood', def: 'Predicted chance the other owner accepts your offer, based on value difference, their DNA type, positional needs, and psychological factors like endowment bias.' },
                ]},
                { cat: 'Flash Brief & Analytics', items: [
                    { term: 'Flash Brief', def: 'Quick-action command dashboard. Shows team diagnosis, prioritized action plan, trade currency, and position investment vs championship winners. Analyst mode reveals deep historical analytics.' },
                    { term: 'Fit Score', def: 'How well a draft prospect fills your specific roster needs. A team thin at RB will see RB prospects scored higher. Based on positional depth analysis.' },
                    { term: 'FAAB Strategy', def: 'Free Agent Acquisition Budget recommendations. War Room analyzes which other teams need the same players and how much budget they have left, then suggests a bid amount to win without overpaying.' },
                ]},
            ];
            return React.createElement('div', { style: { marginBottom: '8px' } },
                React.createElement('button', {
                    onClick: () => setOpen(!open),
                    style: { width: '100%', padding: '10px 16px', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--gold)', fontSize: '0.78rem', fontFamily: 'var(--font-body)', letterSpacing: '0.03em', textAlign: 'left' },
                    onMouseEnter: e => { e.currentTarget.style.background = 'rgba(212,175,55,0.06)'; },
                    onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; }
                }, open ? '\u25BC' : '\u25B6', ' Legend'),
                open && React.createElement('div', { style: { padding: '8px 12px', maxHeight: '300px', overflowY: 'auto' } },
                    React.createElement('button', {
                        onClick: () => setExpanded(true),
                        style: { width: '100%', marginBottom: '10px', padding: '6px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '4px', color: 'var(--gold)', cursor: 'pointer' }
                    }, 'FULL GUIDE \u2192'),
                    ...quickItems.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '8px' } },
                        React.createElement('div', { style: { fontSize: '0.72rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)' } }, item.term),
                        React.createElement('div', { style: { fontSize: '0.68rem', color: 'var(--silver)', lineHeight: 1.4, marginTop: '1px' } }, item.def)
                    ))
                ),
                // Expanded modal overlay — theme-aware so it remains readable in light mode
                expanded && React.createElement('div', {
                    onClick: () => setExpanded(false),
                    style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }
                },
                    React.createElement('div', {
                        onClick: e => e.stopPropagation(),
                        style: { background: 'var(--off-black)', border: '2px solid rgba(212,175,55,0.3)', borderRadius: '14px', width: '100%', maxWidth: '640px', maxHeight: '80vh', overflowY: 'auto', padding: '24px 28px' }
                    },
                        React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' } },
                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--gold)', letterSpacing: '0.06em' } }, 'WAR ROOM GUIDE'),
                            React.createElement('button', { onClick: () => setExpanded(false), style: { background: 'none', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '1.2rem' } }, '\u2715')
                        ),
                        React.createElement('div', { style: { fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.4, marginBottom: '20px' } }, 'Dynasty HQ analyzes your dynasty league to give you an edge in every decision \u2014 trades, drafts, waivers, and roster construction. Here\u2019s what every tool and metric means.'),
                        ...fullItems.map(section => React.createElement('div', { key: section.cat, style: { marginBottom: '20px' } },
                            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em', borderBottom: '1px solid rgba(212,175,55,0.2)', paddingBottom: '4px', marginBottom: '10px' } }, section.cat),
                            ...section.items.map(item => React.createElement('div', { key: item.term, style: { marginBottom: '12px' } },
                                React.createElement('div', { style: { fontSize: '0.84rem', fontWeight: 700, color: 'var(--white)' } }, item.term),
                                React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.4, marginTop: '2px' } }, item.def)
                            ))
                        ))
                    )
                )
            );
        }

        // ── REACTIVE: when timeYear changes, refetch + recompute everything ──
        useEffect(() => {
            if (!basePlayersData || !Object.keys(basePlayersData).length) return;
            let cancelled = false;
            setTimeLoading(true);

            (async () => {
                try {
                    // 1. Fetch stats for selected year (historical has real data, future returns empty)
                    const newStats = await fetchSeasonStats(String(timeYear)).catch(() => ({}));
                    if (cancelled) return;

                    // 2. Update stats state
                    setStatsData(newStats);

                    // 3. Compute projected player data with age progression + DHQ projection
                    const delta = timeYear - currentSeason;
                    const baseLI = window.App?.LI;

                    // CRITICAL: always read from backup (original scores), never from potentially-projected current scores
                    if (baseLI && !baseLI._baseScoresBackup && baseLI.playerScores) {
                        baseLI._baseScoresBackup = { ...baseLI.playerScores };
                    }
                    const originalScores = baseLI?._baseScoresBackup || baseLI?.playerScores || {};

                    if (delta !== 0) {
                        // A. Build projected players with age advancement + projected DHQ as field
                        const projScores = {};
                        const projected = {};
                        Object.entries(basePlayersData).forEach(([pid, p]) => {
                            const baseAge = p.age || 0;
                            const projAge = baseAge ? baseAge + delta : 0;
                            const baseDhq = originalScores[pid] || 0;
                            // Derive YoY trend from prevAvg vs seasonAvg when both are available
                            const pStats = window.S?.playerStats?.[pid];
                            const trendMeta = (() => {
                                const prev = pStats?.prevAvg;
                                const cur  = pStats?.seasonAvg;
                                if (prev > 0 && cur > 0) return { trend: (cur - prev) / prev };
                                return undefined;
                            })();
                            const projDhq = projectPlayerValue(pid, baseDhq, baseAge, p.position || '', delta, trendMeta);
                            projScores[pid] = projDhq;
                            projected[pid] = {
                                ...p,
                                age: projAge || p.age,
                                _projected: true,
                                _baseDhq: baseDhq,
                                _projDhq: projDhq,
                                _delta: delta
                            };
                        });

                        // B. Update playersData state (triggers all child re-renders)
                        setPlayersData(projected);

                        // C. Write projected scores to LI.playerScores — THE source all modules read
                        if (baseLI) {
                            baseLI.playerScores = projScores;
                            baseLI._projectedYear = timeYear;

                            // Debug: log projections
                            if (typeof DEV_MODE !== 'undefined' && DEV_MODE) {
                                const samples = Object.entries(projScores).filter(([,v]) => v > 2000).sort((a,b) => b[1] - a[1]).slice(0, 5);
                                console.log('[TimeContext] Projected DHQ (delta=' + delta + '):');
                                samples.forEach(([pid, projDhq]) => {
                                    const bp = basePlayersData[pid];
                                    const bd = originalScores[pid] || 0;
                                    console.log('  ' + (bp?.full_name || pid) + ': age ' + (bp?.age||'?') + '\u2192' + ((bp?.age||0)+delta) + ', DHQ ' + bd + '\u2192' + projDhq + ' (' + (projDhq >= bd ? '+' : '') + (projDhq - bd) + ')');
                                });
                            }
                        }
                    } else {
                        // Restore base data — original ages and original DHQ scores
                        setPlayersData(basePlayersData);
                        if (baseLI && baseLI._baseScoresBackup) {
                            baseLI.playerScores = { ...baseLI._baseScoresBackup };
                            delete baseLI._projectedYear;
                        }
                    }

                    // D. Also override the dynastyValue() function's source for this render cycle
                    // dynastyValue reads from LI.playerScores which we just updated above.
                    // Clear assessTeamFromGlobal cache so health scores recompute with fresh data.
                    if (window.assessTeamFromGlobal?._cache) window.assessTeamFromGlobal._cache = {};
                    if (window.assessAllTeamsFromGlobal?._cache) window.assessAllTeamsFromGlobal._cache = {};
                    if (window.S) {
                        window.S._timeContextTs = Date.now();
                    }

                    // 4. Update window.S (write-through cache for ReconAI bridge)
                    if (window.S) {
                        window.S.season = String(timeYear);
                        window.S.playerStats = {};
                        Object.entries(newStats).forEach(([pid, s]) => {
                            window.S.playerStats[pid] = {};
                            const pts = typeof calcRawPts === 'function' ? calcRawPts(s) : (s.pts_half_ppr || 0);
                            const gp = s.gp || 0;
                            window.S.playerStats[pid].prevTotal = pts ? Math.round(pts * 10) / 10 : 0;
                            window.S.playerStats[pid].prevAvg = gp > 0 ? Math.round(pts / gp * 10) / 10 : 0;
                            window.S.playerStats[pid].prevRawStats = s;
                        });
                        // Mirror to SeasonContext
                        setSeasonCtxData(prev => ({
                            ...prev,
                            season: String(timeYear),
                            playerStats: window.S.playerStats,
                            lastUpdated: Date.now(),
                        }));
                    }

                    // 5. Force analytics recompute
                    setAnalyticsData(null);

                    // 6. Force ranked teams recompute by bumping timestamp
                    setTimeRecomputeTs(Date.now());

                } catch(e) { console.warn('Time context data load error:', e); }
                if (!cancelled) setTimeLoading(false);
            })();

            return () => { cancelled = true; };
        }, [timeYear, basePlayersData]);

        // handleTimeYearChange is now just a setter — the effect does the work
        function handleTimeYearChange(year) {
            if (year === timeYear) return;
            setTimeYear(year);
            setActiveYear(String(year));
        }
        const [analyticsData, setAnalyticsData] = useState(null);
        const [analyticsTab, setAnalyticsTab] = useState('roster');
        const [rosterFilter, setRosterFilter] = useState('All');
        const [rosterSort, setRosterSort] = useState({ key: 'dhq', dir: 1 });
        const defaultRosterCols = ['pos','age','dhq','posRankLg','ppg','durability','peak','action','sos'];
        const [visibleCols, setVisibleCols] = useState(() => {
            const stored = LeagueStorage.get(LEAGUE_WR_KEYS.ROSTER_COLS);
            const legacyDefault = ['pos','age','dhq','ppg','trend','action'];
            if (Array.isArray(stored) && stored.length) {
                const wasLegacyDefault = stored.length === legacyDefault.length && stored.every((key, idx) => key === legacyDefault[idx]);
                return wasLegacyDefault ? defaultRosterCols : stored;
            }
            return defaultRosterCols;
        });
        const [showColPicker, setShowColPicker] = useState(false);
        const [colPreset, setColPreset] = useState('default');
        const [expandedPid, setExpandedPid] = useState(null);
        const [showAvatarPicker, setShowAvatarPicker] = useState(false);
        const [avatarKey, setAvatarKey] = useState(0); // force re-render when avatar changes
        const [welcomeMode, setWelcomeMode] = useState(false); // centered modal for first-time welcome
        const [showCornerToast, setShowCornerToast] = useState(false); // "I'll be down here" toast
        const [heroStory, setHeroStory] = useState('');
        const [aiStories, setAiStories] = useState([]);
        const [transactions, setTransactions] = useState([]);
        const [rankedTeams, setRankedTeams] = useState([]);
        const [dhqStatus, setDhqStatus] = useState({ loading: false, step: '', progress: 0 });
        const [loadStage, setLoadStage] = useState('');
        const [editingKpi, setEditingKpi] = useState(null); // index being edited, null = not editing
        const [leagueSelectedTeam, setLeagueSelectedTeam] = useState(null);
        const [leagueSort, setLeagueSort] = useState('health');
        const [leagueViewMode, setLeagueViewMode] = useState('roster');
        // Compare was promoted to its own top-level tab (js/tabs/compare.js) — it
        // owns its local compareTeamId state. myTeamView no longer needed now that
        // My Roster doesn't host a Compare sub-view.
        const [leagueViewTab, setLeagueViewTab] = useState('overview'); // top-level: overview | analyst
        const [leagueSubView, setLeagueSubView] = useState('teams'); // sub-tabs below the overview
        const [lpSort, setLpSort] = useState({ key: 'dhq', dir: 1 });
        const [lpFilter, setLpFilter] = useState('');

        // Core KPI metadata — used by computeKpiValue and module widgets
        const KPI_OPTIONS = {
            'health-score':   { label: 'Health Score',    icon: '', category: 'Roster',   tip: 'Blended score: 60% scoring power (contender) + 40% position coverage (dynasty depth). 90+=Elite, 80+=Contender, 70+=Crossroads' },
            'avg-age':        { label: 'DHQ-Wtd Age',     icon: '', category: 'Roster',   tip: 'DHQ-weighted average age. Lower = longer dynasty window' },
            'elite-count':    { label: 'Elite Players',   icon: '', category: 'Roster',   tip: 'Players with 7000+ DHQ or a top-5 rank at their position league-wide. These are your cornerstone assets.' },
            'aging-cliff':    { label: 'Aging Cliff %',   icon: '', category: 'Roster',   tip: '% of DHQ held by players past their value window' },
            'bench-quality':  { label: 'Bench Quality',   icon: '', category: 'Roster',   tip: 'Average DHQ of non-starter roster players' },
            'contender-rank': { label: 'Contender Rank',  icon: '', category: 'League',   tip: 'Win-now rank based on optimal starting lineup PPG vs league. How competitive are you THIS season?' },
            'dynasty-rank':   { label: 'Dynasty Rank',    icon: '', category: 'League',   tip: 'Long-term rank based on total roster DHQ value. How strong is your dynasty foundation?' },
            'window':         { label: 'Compete Window',  icon: '', category: 'Projection',tip: 'Estimated years your roster can compete based on age decay' },
            'hit-rate':       { label: 'Trade Win Rate',  icon: '', category: 'Trades',   tip: 'Percentage of trades where you gained value (won or fair)' },
            'net-trade':      { label: 'Net DHQ/Trade',   icon: '', category: 'Trades',   tip: 'Average DHQ gained or lost per trade' },
            'trade-velocity': { label: 'Trade Velocity',  icon: '', category: 'Trades',   tip: 'Number of trades completed this season' },
            'pick-capital':   { label: 'Pick Capital',    icon: '', category: 'Draft',    tip: 'Total value of your draft picks across next 3 seasons. Includes traded picks.' },
            'draft-roi':      { label: 'Draft ROI',       icon: '', category: 'Draft',    tip: 'Current DHQ of drafted players vs capital spent' },
            'faab-efficiency':{ label: 'FAAB Remaining',  icon: '', category: 'Waivers',  tip: 'Remaining FAAB budget available for waiver claims' },
            'transaction-ticker': { label: 'Transaction Ticker', icon: '', category: 'League', sizes: ['md', 'lg'], tip: 'Recent league transactions: trades, waivers, and free agent moves' },
            'league-standings':   { label: 'League Standings',   icon: '', category: 'League', sizes: ['md', 'lg'], tip: 'Current league standings with W-L records and DHQ totals' },
        };
        // Default 6-widget dashboard — module-based format. Intelligence brief
        // sits at the top as a full-width xl widget so new users land on Alex.
        // v2 default layout — Intel Brief (2×4 tall) left, Field Notes (1×4 narrow) right,
        // one sm from each remaining module fills the last column beside them.
        const DEFAULT_WIDGETS = [
            { id: 'dw0', key: 'intel-brief',        size: 'tall' },
            { id: 'dw1', key: 'field-notes',        size: 'narrow' },
            { id: 'dw2', key: 'roster-pulse',       size: 'sm', primaryMetric: 'health-score' },
            { id: 'dw3', key: 'market-radar',       size: 'sm' },
            { id: 'dw4', key: 'draft-capital',      size: 'sm' },
            { id: 'dw5', key: 'league-landscape',   size: 'sm' },
        ];
        // Migrate legacy formats to current widget object format
        function migrateKpisToWidgets(stored) {
            if (!stored || !Array.isArray(stored)) return DEFAULT_WIDGETS;
            if (stored.length === 0) return DEFAULT_WIDGETS;
            let widgets;
            // Old format v1: array of KPI key strings
            if (typeof stored[0] === 'string') {
                const keyToModule = {
                    'health-score': 'roster', 'avg-age': 'roster', 'elite-count': 'roster',
                    'aging-cliff': 'roster', 'bench-quality': 'roster',
                    'contender-rank': 'competitive', 'dynasty-rank': 'competitive', 'window': 'competitive',
                    'hit-rate': 'trading', 'net-trade': 'trading', 'trade-velocity': 'trading',
                    'pick-capital': 'draft', 'draft-roi': 'draft',
                    'faab-efficiency': 'waivers',
                    'transaction-ticker': 'transaction-ticker',
                    'league-standings': 'league-standings',
                };
                widgets = stored.map((k, i) => ({ id: 'mig_' + i, key: keyToModule[k] || k, size: 'sm', primaryMetric: k }));
            } else {
                // Old format v2: {key, size} without id or primaryMetric
                widgets = stored.map((w, i) => {
                    if (!w.id) w = { ...w, id: 'mig2_' + i };
                    // Map old KPI keys to module keys
                    const legacyKpiModules = {
                        'health-score': 'roster', 'avg-age': 'roster', 'elite-count': 'roster',
                        'aging-cliff': 'roster', 'bench-quality': 'roster', 'portfolio': 'roster',
                        'top5-conc': 'roster', 'starter-gap': 'roster', 'roster-turnover': 'roster',
                        'sched-sos': 'roster',
                        'contender-rank': 'competitive', 'dynasty-rank': 'competitive', 'window': 'competitive',
                        'hit-rate': 'trading', 'net-trade': 'trading', 'trade-velocity': 'trading',
                        'trade-leverage': 'trading', 'partner-wr': 'trading',
                        'pick-capital': 'draft', 'draft-roi': 'draft',
                        'faab-efficiency': 'waivers',
                        'playoff-record': 'competitive', 'playoff-winpct': 'competitive',
                        'champ-appearances': 'competitive', 'dynasty-score': 'competitive',
                    };
                    if (legacyKpiModules[w.key]) {
                        return { ...w, primaryMetric: w.primaryMetric || w.key, key: legacyKpiModules[w.key] };
                    }
                    return w;
                });
            }
            // v3 migration: when the Brief tab was folded into Dashboard, existing
            // users lost their access point to Alex's briefing. Auto-prepend the
            // intelligence-brief widget once if it's not already in their layout.
            // Users who explicitly remove it will keep it removed (the new entry
            // will be persisted to storage by the useEffect below).
            if (!widgets.some(w => w.key === 'intel-brief' || w.key === 'intelligence-brief')) {
                widgets = [{ id: 'mig3_brief', key: 'intel-brief', size: 'xl' }, ...widgets];
            }
            return widgets;
        }
        const [selectedWidgets, setSelectedWidgets] = useState(() =>
            migrateKpisToWidgets(LeagueStorage.get(LEAGUE_WR_KEYS.KPI_SELECTION(currentLeague?.id || ''))) || DEFAULT_WIDGETS
        );
        useEffect(() => {
            LeagueStorage.set(LEAGUE_WR_KEYS.KPI_SELECTION(currentLeague?.id || ''), selectedWidgets);
        }, [selectedWidgets]);

        useEffect(() => {
            LeagueStorage.set(LEAGUE_WR_KEYS.ROSTER_COLS, visibleCols);
        }, [visibleCols]);

        function computeKpiValue(kpiKey) {
            const LI = window.App?.LI || {};
            const scores = LI.playerScores || {};
            const myPlayers = myRoster?.players || [];
            const profile = LI.ownerProfiles?.[myRoster?.roster_id];
            switch(kpiKey) {
                case 'contender-rank': {
                    // PPG-based rank — how competitive are you right now?
                    const league2 = currentLeague;
                    const rp = league2?.roster_positions || [];
                    const ppgRanks = (league2.rosters || []).map(r => {
                        const ppg = typeof window.App?.calcOptimalPPG === 'function'
                            ? window.App.calcOptimalPPG(r.players || [], playersData, window.S?.playerStats || {}, rp)
                            : 0;
                        return { rid: r.roster_id, ppg };
                    }).sort((a, b) => b.ppg - a.ppg);
                    // Offseason fallback: if all PPGs are 0, estimate from DHQ values
                    if (ppgRanks.every(r => r.ppg === 0)) {
                        ppgRanks.forEach(r => {
                            const roster = (currentLeague.rosters || []).find(ros => ros.roster_id === r.rid);
                            const totalDHQ = (roster?.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                            r.ppg = Math.round(totalDHQ / 550); // Same fallback as health score
                        });
                        ppgRanks.sort((a, b) => b.ppg - a.ppg);
                    }
                    const myPPG = ppgRanks.find(r => r.rid === myRoster?.roster_id)?.ppg || 0;
                    const cRank = ppgRanks.findIndex(r => r.rid === myRoster?.roster_id) + 1;
                    const allPPGs = ppgRanks.map(r => r.ppg).sort((a, b) => a - b);
                    return { value: '#' + (cRank || '?') + '/' + standings.length, sub: myPPG > 0 ? 'Win-now rank by ' + myPPG.toFixed(1) + ' PPG' : 'Win-now rank by starter PPG', color: cRank <= 3 ? '#2ECC71' : cRank <= 6 ? 'var(--gold)' : '#E74C3C', sparkData: allPPGs };
                }
                case 'dynasty-rank': {
                    // Total DHQ rank — long-term dynasty strength (players + pick capital)
                    const dVals = (currentLeague.rosters || []).map(r => {
                        const playerDHQ = (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
                        // Add pick capital value
                        let pickDHQ = 0;
                        {
                            const totalTeams = (currentLeague.rosters || []).length || 16;
                            const draftRounds = currentLeague.settings?.draft_rounds || 5;
                            const leagueSeason = parseInt(currentLeague.season) || new Date().getFullYear();
                            for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                                for (let rd = 1; rd <= draftRounds; rd++) {
                                    const pv = typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                    const tradedAway = (window.S?.tradedPicks || []).find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === r.roster_id && p.owner_id !== r.roster_id);
                                    if (!tradedAway) pickDHQ += pv;
                                    const acquired = (window.S?.tradedPicks || []).filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === r.roster_id && p.roster_id !== r.roster_id);
                                    acquired.forEach(() => { pickDHQ += pv; });
                                }
                            }
                        }
                        return { rid: r.roster_id, total: playerDHQ + pickDHQ };
                    }).sort((a, b) => b.total - a.total);
                    const myDTotal = dVals.find(r => r.rid === myRoster?.roster_id)?.total || 0;
                    const dRank = dVals.findIndex(r => r.rid === myRoster?.roster_id) + 1;
                    const allDVals = dVals.map(r => r.total).sort((a, b) => a - b);
                    return { value: '#' + (dRank || '?') + '/' + standings.length, sub: myDTotal > 0 ? Math.round(myDTotal / 1000) + 'K total assets' : 'Dynasty rank', color: dRank <= 3 ? '#2ECC71' : dRank <= 6 ? 'var(--gold)' : '#E74C3C', sparkData: allDVals };
                }
                case 'portfolio': {
                    const total = myPlayers.reduce((s, pid) => s + (scores[pid] || 0), 0);
                    // Spark: all team totals for league comparison
                    const allTotals = (currentLeague.rosters || []).map(r => (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0)).sort((a,b) => a-b);
                    return { value: total.toLocaleString(), sub: 'Total DHQ', color: 'var(--gold)', sparkData: allTotals };
                }
                case 'health-score': {
                    const ranked = rankedTeams.find(t => t.userId === sleeperUserId);
                    const hs = ranked?.healthScore || 0;
                    const allHS = rankedTeams.map(t => t.healthScore || 0).sort((a,b) => a-b);
                    return { value: hs || '\u2014', sub: 'Score', color: hs >= 90 ? '#D4AF37' : hs >= 80 ? '#2ECC71' : hs >= 70 ? 'var(--gold)' : '#E74C3C', sparkData: allHS };
                }
                case 'starter-gap': {
                    const analytics = analyticsData || (typeof runLeagueAnalytics === 'function' ? runLeagueAnalytics() : null);
                    const gap = analytics?.roster?.gaps?.find(g => g.severity === 'high') || analytics?.roster?.gaps?.[0];
                    if (gap) {
                        const area = gap.area || 'Unknown';
                        const delta = typeof gap.delta === 'number' ? (gap.delta > 0 ? '+' : '') + gap.delta.toFixed(gap.delta < 1 ? 2 : 0) : gap.delta;
                        return { value: delta, sub: area + ' (' + gap.severity + ')', color: gap.severity === 'high' ? '#E74C3C' : '#F0A500' };
                    }
                    return { value: '\u2714', sub: 'No major gaps', color: '#2ECC71' };
                }
                case 'avg-age': {
                    if (!myPlayers.length) return { value: '\u2014', sub: 'Avg age', color: 'var(--silver)' };
                    const totalDhq = myPlayers.reduce((s, pid) => s + (scores[pid] || 1), 0);
                    const weightedAge = myPlayers.reduce((s, pid) => s + ((playersData[pid]?.age || 26) * (scores[pid] || 1)), 0);
                    const avg = totalDhq > 0 ? weightedAge / totalDhq : 26;
                    return { value: avg.toFixed(1), sub: 'Avg age', color: avg <= 25 ? '#2ECC71' : avg <= 27 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'top5-conc': {
                    const vals = myPlayers.map(pid => scores[pid] || 0).sort((a,b) => b - a);
                    const total = vals.reduce((s,v) => s + v, 0);
                    const top5 = vals.slice(0, 5).reduce((s,v) => s + v, 0);
                    const pct = total > 0 ? Math.round(top5 / total * 100) : 0;
                    return { value: pct + '%', sub: 'In top 5 players', color: pct >= 65 ? '#E74C3C' : pct >= 50 ? 'var(--gold)' : '#2ECC71' };
                }
                case 'hit-rate': {
                    if (!profile || !profile.trades) return { value: '\u2014', sub: 'Trade win rate', color: 'var(--silver)' };
                    const total = (profile.tradesWon || 0) + (profile.tradesLost || 0) + (profile.tradesFair || 0);
                    const rate = total > 0 ? Math.round(((profile.tradesWon || 0) + (profile.tradesFair || 0)) / total * 100) : 0;
                    return { value: rate + '%', sub: 'Win/fair rate', color: rate >= 60 ? '#2ECC71' : rate >= 40 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'faab-efficiency': {
                    const budget = myRoster?.settings?.waiver_budget || 0;
                    const spent = myRoster?.settings?.waiver_budget_used || 0;
                    if (!budget) return { value: '\u2014', sub: 'No FAAB', color: 'var(--silver)' };
                    const remaining = budget - spent;
                    return { value: '$' + remaining, sub: '$' + budget + ' budget', color: remaining > budget * 0.5 ? '#2ECC71' : remaining > budget * 0.25 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'net-trade': {
                    if (!profile) return { value: '\u2014', sub: 'Net DHQ/trade', color: 'var(--silver)' };
                    const avg = profile.avgValueDiff || 0;
                    return { value: (avg >= 0 ? '+' : '') + Math.round(avg), sub: 'Avg per trade', color: avg >= 100 ? '#2ECC71' : avg >= 0 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'trade-velocity': {
                    if (!profile) return { value: '\u2014', sub: 'Trades', color: 'var(--silver)' };
                    return { value: profile.trades || 0, sub: 'Total trades', color: (profile.trades || 0) >= 4 ? '#2ECC71' : (profile.trades || 0) >= 2 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'window': {
                    if (!myPlayers.length) return { value: '\u2014', sub: 'Window', color: 'var(--silver)' };
                    const rp = currentLeague?.roster_positions || [];
                    const posWindows = {};
                    const windowStarters = myRoster?.starters || [];
                    windowStarters.forEach(pid => {
                        if (!pid || pid === '0') return;
                        const p = playersData[pid];
                        if (!p) return;
                        const pos = p.position;
                        const nPos = pos === 'DE' || pos === 'DT' ? 'DL' : pos === 'CB' || pos === 'S' ? 'DB' : pos === 'OLB' || pos === 'ILB' ? 'LB' : pos;
                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                            ? window.App.getValueWindowEnd(nPos)
                            : ((window.App.peakWindows || {})[nPos] || [24, 29])[1];
                        const yrsLeft = Math.max(0, valueEnd - (p.age || 25));
                        if (!posWindows[nPos]) posWindows[nPos] = [];
                        posWindows[nPos].push(yrsLeft);
                    });
                    let minWindow = 99;
                    Object.entries(posWindows).forEach(([pos, yrs]) => {
                        if (yrs.length > 0) {
                            const avg = yrs.reduce((s, y) => s + y, 0) / yrs.length;
                            if (avg < minWindow) minWindow = avg;
                        }
                    });
                    const windowYrs = minWindow === 99 ? 0 : Math.round(minWindow);
                    return { value: windowYrs > 0 ? windowYrs + 'yr' : 'Closed', sub: 'Weakest position group', color: windowYrs >= 5 ? '#2ECC71' : windowYrs >= 2 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'aging-cliff': {
                    const total = myPlayers.reduce((s, pid) => s + (scores[pid] || 0), 0);
                    const pastPeak = myPlayers.reduce((s, pid) => {
                        const p = playersData[pid]; if (!p) return s;
                        const pos = p.position; const age = p.age || 26;
                        const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                            ? window.App.getValueWindowEnd(pos)
                            : ((window.App.peakWindows || {})[pos] || [24, 29])[1];
                        return age > valueEnd ? s + (scores[pid] || 0) : s;
                    }, 0);
                    const pct = total > 0 ? Math.round(pastPeak / total * 100) : 0;
                    return { value: pct + '%', sub: 'Past value DHQ', color: pct <= 20 ? '#2ECC71' : pct <= 35 ? '#F0A500' : '#E74C3C' };
                }
                case 'partner-wr': {
                    if (!profile || !profile.tradesWon) return { value: '\u2014', sub: 'Partner W/R', color: 'var(--silver)' };
                    const total = (profile.tradesWon || 0) + (profile.tradesLost || 0);
                    return { value: (profile.tradesWon || 0) + '-' + (profile.tradesLost || 0), sub: 'Trade W-L', color: (profile.tradesWon || 0) > (profile.tradesLost || 0) ? '#2ECC71' : '#E74C3C' };
                }
                case 'elite-count': {
                    if (typeof window.App?.countElitePlayers === 'function') {
                        const elites = window.App.countElitePlayers(myPlayers);
                        return { value: elites + ' elite' + (elites !== 1 ? 's' : ''), sub: '7000+ or top 5 pos', color: elites >= 3 ? '#2ECC71' : elites >= 1 ? 'var(--gold)' : '#E74C3C' };
                    }
                    // Elite = 7000+ DHQ or top 5 at their position league-wide
                    const posRanks = {};
                    (currentLeague.rosters || []).forEach(r => (r.players || []).forEach(pid => {
                        const pos = playersData[pid]?.position;
                        const nPos2 = pos === 'DE' || pos === 'DT' ? 'DL' : pos === 'CB' || pos === 'S' ? 'DB' : pos === 'OLB' || pos === 'ILB' ? 'LB' : pos;
                        if (!posRanks[nPos2]) posRanks[nPos2] = [];
                        posRanks[nPos2].push({ pid: String(pid), dhq: scores[pid] || 0 });
                    }));
                    Object.values(posRanks).forEach(arr => arr.sort((a, b) => b.dhq - a.dhq));
                    const myPidSet = new Set(myPlayers.map(String));
                    const elitePidSet = new Set();
                    let elites = 0;
                    Object.values(posRanks).forEach(arr => {
                        arr.slice(0, 5).forEach(p => { if (myPidSet.has(p.pid)) elitePidSet.add(p.pid); });
                    });
                    myPlayers.forEach(pid => {
                        const id = String(pid);
                        if ((scores[pid] || scores[id] || 0) >= 7000) elitePidSet.add(id);
                    });
                    elites = elitePidSet.size;
                    return { value: elites + ' elite' + (elites !== 1 ? 's' : ''), sub: '7000+ or top 5 pos', color: elites >= 3 ? '#2ECC71' : elites >= 1 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'bench-quality': {
                    const starters = new Set(myRoster?.starters || []);
                    const benchVals = myPlayers.filter(pid => !starters.has(pid)).map(pid => scores[pid] || 0);
                    const avg = benchVals.length ? Math.round(benchVals.reduce((s,v) => s + v, 0) / benchVals.length) : 0;
                    return { value: avg.toLocaleString(), sub: 'Avg bench DHQ', color: avg >= 2500 ? '#2ECC71' : avg >= 1500 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'playoff-record': {
                    const brackets = window.App?.LI?.bracketData || {};
                    let pw = 0, pl = 0;
                    const numPlayoffTeams = currentLeague?.settings?.playoff_teams || 6;
                    Object.values(brackets).forEach(({ winners }) => {
                        if (!winners?.length) return;
                        // Find true playoff matchups: exclude consolation games
                        // In Sleeper brackets, first-round matchups have t1/t2 as seed numbers.
                        // Only count matchups that feed into the championship (highest round).
                        const maxRound = Math.max(...winners.map(m => m.r || 0));
                        // Determine real playoff matchup IDs: start from championship and trace back
                        const realMatchIds = new Set();
                        // Championship game
                        const champGame = winners.find(m => m.r === maxRound);
                        if (champGame) {
                            realMatchIds.add(champGame.m);
                            // Trace feeder matchups backwards through rounds
                            const queue = [champGame];
                            while (queue.length) {
                                const g = queue.shift();
                                // t1_from and t2_from reference the matchup IDs that feed into this game
                                // In Sleeper: t1_from.w means "winner of matchup t1_from", etc.
                                const feeders = winners.filter(fm => {
                                    // A matchup feeds this one if its winner/loser advances here
                                    return fm.m === g.t1_from?.w || fm.m === g.t1_from?.l || fm.m === g.t2_from?.w || fm.m === g.t2_from?.l
                                        || fm.m === g.t1 || fm.m === g.t2;
                                });
                                feeders.forEach(f => { if (!realMatchIds.has(f.m)) { realMatchIds.add(f.m); queue.push(f); } });
                            }
                        }
                        // If tracing didn't work (simple bracket), fall back: only count top rounds
                        // For N playoff teams, there are ceil(log2(N)) real rounds
                        const realRounds = Math.ceil(Math.log2(numPlayoffTeams));
                        const minPlayoffRound = maxRound - realRounds + 1;
                        winners.forEach(m => {
                            const isReal = realMatchIds.size > 1 ? realMatchIds.has(m.m) : (m.r >= minPlayoffRound);
                            if (!isReal) return;
                            if (m.w === myRoster?.roster_id) pw++;
                            if (m.l === myRoster?.roster_id) pl++;
                        });
                    });
                    return { value: pw + '-' + pl, sub: 'Playoff W-L', color: pw > pl ? '#2ECC71' : pw < pl ? '#E74C3C' : 'var(--silver)' };
                }
                case 'playoff-winpct': {
                    const brackets2 = window.App?.LI?.bracketData || {};
                    let pw2 = 0, pl2 = 0;
                    const numPlayoffTeams2 = currentLeague?.settings?.playoff_teams || 6;
                    Object.values(brackets2).forEach(({ winners }) => {
                        if (!winners?.length) return;
                        const maxRound = Math.max(...winners.map(m => m.r || 0));
                        const realRounds = Math.ceil(Math.log2(numPlayoffTeams2));
                        const minPlayoffRound = maxRound - realRounds + 1;
                        const realMatchIds = new Set();
                        const champGame = winners.find(m => m.r === maxRound);
                        if (champGame) {
                            realMatchIds.add(champGame.m);
                            const queue = [champGame];
                            while (queue.length) {
                                const g = queue.shift();
                                const feeders = winners.filter(fm => fm.m === g.t1_from?.w || fm.m === g.t1_from?.l || fm.m === g.t2_from?.w || fm.m === g.t2_from?.l || fm.m === g.t1 || fm.m === g.t2);
                                feeders.forEach(f => { if (!realMatchIds.has(f.m)) { realMatchIds.add(f.m); queue.push(f); } });
                            }
                        }
                        winners.forEach(m => {
                            const isReal = realMatchIds.size > 1 ? realMatchIds.has(m.m) : (m.r >= minPlayoffRound);
                            if (!isReal) return;
                            if (m.w === myRoster?.roster_id) pw2++;
                            if (m.l === myRoster?.roster_id) pl2++;
                        });
                    });
                    const total = pw2 + pl2;
                    const pct = total > 0 ? Math.round(pw2 / total * 100) : 0;
                    return { value: pct + '%', sub: 'Win rate (' + total + ' games)', color: pct >= 60 ? '#2ECC71' : pct >= 40 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'champ-appearances': {
                    const champs2 = window.App?.LI?.championships || {};
                    const apps = Object.values(champs2).filter(c => c.champion === myRoster?.roster_id || c.runnerUp === myRoster?.roster_id).length;
                    return { value: apps, sub: 'Finals appearances', color: apps > 0 ? '#D4AF37' : 'var(--silver)' };
                }
                case 'dynasty-score': {
                    const champs3 = window.App?.LI?.championships || {};
                    const brackets3 = window.App?.LI?.bracketData || {};
                    let titles = 0, runners = 0, playoffApps = 0;
                    Object.values(champs3).forEach(c => {
                        if (c.champion === myRoster?.roster_id) titles++;
                        if (c.runnerUp === myRoster?.roster_id) runners++;
                        if (c.champion === myRoster?.roster_id || c.runnerUp === myRoster?.roster_id || (c.semiFinals||[]).includes(myRoster?.roster_id)) playoffApps++;
                    });
                    const score = titles * 3 + runners + playoffApps;
                    return { value: score, sub: titles + ' titles, ' + runners + ' runner-ups', color: score >= 5 ? '#D4AF37' : score >= 2 ? '#2ECC71' : 'var(--silver)' };
                }
                case 'draft-roi': {
                    const profile3 = window.App?.LI?.ownerProfiles?.[myRoster?.roster_id];
                    const draftPicks = (window.App?.LI?.draftOutcomes || []).filter(d => d.roster_id === myRoster?.roster_id);
                    const hits = draftPicks.filter(d => d.isStarter).length;
                    const total = draftPicks.length;
                    const rate = total > 0 ? Math.round(hits / total * 100) : 0;
                    return { value: rate + '%', sub: hits + '/' + total + ' became starters', color: rate >= 50 ? '#2ECC71' : rate >= 30 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'roster-turnover': {
                    const profile4 = window.App?.LI?.ownerProfiles?.[myRoster?.roster_id];
                    const trades = profile4?.trades || 0;
                    return { value: trades, sub: 'Trades this cycle', color: trades >= 5 ? '#2ECC71' : trades >= 2 ? 'var(--gold)' : 'var(--silver)' };
                }
                case 'pick-capital': {
                    let totalPickValue = 0;
                    let pickCount = 0;
                    const totalTeams = (currentLeague.rosters || []).length || 16;
                    const draftRounds = currentLeague.settings?.draft_rounds || 5;
                    const leagueSeason = parseInt(currentLeague.season) || new Date().getFullYear();
                    const tp = window.S?.tradedPicks || [];
                    for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
                        for (let rd = 1; rd <= draftRounds; rd++) {
                            const tradedAway = tp.find(p => parseInt(p.season) === yr && p.round === rd && p.roster_id === myRoster?.roster_id && p.owner_id !== myRoster?.roster_id);
                            if (!tradedAway) {
                                totalPickValue += typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                pickCount++;
                            }
                            const acquired = tp.filter(p => parseInt(p.season) === yr && p.round === rd && p.owner_id === myRoster?.roster_id && p.roster_id !== myRoster?.roster_id);
                            acquired.forEach(() => {
                                totalPickValue += typeof getIndustryPickValue === 'function' ? getIndustryPickValue((rd - 1) * totalTeams + Math.ceil(totalTeams / 2), totalTeams, draftRounds) : window.App.PlayerValue?.getPickValue?.(yr, rd, totalTeams) ?? 0;
                                pickCount++;
                            });
                        }
                    }
                    return { value: totalPickValue > 0 ? Math.round(totalPickValue / 1000) + 'K' : '\u2014', sub: pickCount + ' picks over 3 years', color: totalPickValue >= 20000 ? '#2ECC71' : totalPickValue >= 10000 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'trade-leverage': {
                    const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
                    const myStrengths = assess?.strengths || [];
                    let leverageCount = 0;
                    (currentLeague.rosters || []).forEach(r => {
                        if (r.roster_id === myRoster?.roster_id) return;
                        const theirAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(r.roster_id) : null;
                        const theirNeeds = (theirAssess?.needs || []).map(n => n.pos);
                        if (myStrengths.some(s => theirNeeds.includes(s))) leverageCount++;
                    });
                    return { value: leverageCount, sub: leverageCount + ' teams need your surplus', color: leverageCount >= 6 ? '#2ECC71' : leverageCount >= 3 ? 'var(--gold)' : '#E74C3C' };
                }
                case 'sched-sos': {
                    const sosMod = window.App?.SOS;
                    if (!sosMod?.ready) return { value: '\u2014', sub: 'Loading SOS\u2026', color: 'var(--silver)' };
                    const starters = myRoster?.starters || [];
                    const teamSOS = sosMod.getTeamSOS(starters, playersData);
                    if (!teamSOS) return { value: '\u2014', sub: 'No SOS data', color: 'var(--silver)' };
                    // sparkData: all teams' avg ranks for comparison
                    const sparkData = (currentLeague.rosters || []).map(r => {
                        const sos = sosMod.getTeamSOS(r.starters || [], playersData);
                        return sos?.avgRank || 16;
                    }).sort((a, b) => a - b);
                    return {
                        value: teamSOS.avgRank,
                        sub: teamSOS.label + ' schedule (avg rank)',
                        color: teamSOS.color,
                        sparkData,
                    };
                }
                default: return { value: '\u2014', sub: '', color: 'var(--silver)' };
            }
        }
        const [reconPanelOpen, setReconPanelOpen] = useState(false);
        const [showNotifications, setShowNotifications] = useState(false);
        // showAlerts removed — alerts now live on Brief tab
        const [briefDraftInfo, setBriefDraftInfo] = useState(null);
        const [sidebarOpen, setSidebarOpen] = useState(false);
        const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
            try { return localStorage.getItem('wr_sidebar_collapsed') === '1'; } catch (_) { return false; }
        });
        useEffect(() => {
            try { localStorage.setItem('wr_sidebar_collapsed', sidebarCollapsed ? '1' : '0'); } catch (_) {}
        }, [sidebarCollapsed]);
        const [gmStrategyOpen, setGmStrategyOpen] = useState(false);
        // Expose for cross-module access (draft-room "Edit GM Strategy" button)
        window._wrSetActiveTab = setActiveTab;
        window._wrSetGmStrategyOpen = setGmStrategyOpen;
        const GM_STRATEGY_DEFAULT = { mode: 'balanced', riskTolerance: 'moderate', positionalNeeds: {}, untouchable: [], targets: [], notes: '' };
        const [gmStrategy, setGmStrategy] = useState(() =>
            LeagueStorage.get(LEAGUE_WR_KEYS.GM_STRATEGY(currentLeague?.league_id)) || GM_STRATEGY_DEFAULT
        );
        const gmStrategyInitRef = useRef(true);
        useEffect(() => {
            if (currentLeague?.league_id) {
                LeagueStorage.set(LEAGUE_WR_KEYS.GM_STRATEGY(currentLeague.league_id), gmStrategy);
                // Expose to window for AI context
                window._wrGmStrategy = gmStrategy;
                // Log deliberate updates (skip initial load)
                if (gmStrategyInitRef.current) { gmStrategyInitRef.current = false; }
                else { window.wrLogAction?.('\uD83D\uDCCA', 'Updated GM strategy', 'roster', { actionType: 'gm-strategy' }); }
            }
        }, [gmStrategy, currentLeague?.league_id]);

        // Fetch draft info for Brief tab (Sleeper only — other platforms don't have this endpoint)
        useEffect(() => {
            if (!isSleeper) return;
            if (!currentLeague?.id && !currentLeague?.league_id) return;
            fetch('https://api.sleeper.app/v1/league/' + (currentLeague.league_id || currentLeague.id) + '/drafts')
                .then(r => r.ok ? r.json() : [])
                .then(drafts => {
                    const upcoming = drafts.find(d => d.status === 'pre_draft') || drafts[0];
                    if (upcoming) setBriefDraftInfo(upcoming);
                })
                .catch(err => window.wrLog('flashBrief.draftFetch', err));
        }, [currentLeague, isSleeper]);

        // Auto-generate notifications from league data
        const notifications = useMemo(() => {
            const notes = [];
            const txnsRaw = window.S?.transactions || {};
            const txns = Array.isArray(txnsRaw) ? txnsRaw : Object.values(txnsRaw).flat();
            const myPids = new Set(myRoster?.players || []);

            // Players on my roster that are trending down
            txns.filter(t => t.type === 'free_agent' || t.type === 'waiver').forEach(t => {
                const drops = Object.keys(t.drops || {});
                drops.forEach(pid => {
                    if (myPids.has(pid)) {
                        notes.push({ type: 'warn', text: (playersData[pid]?.full_name || pid) + ' was dropped by another team', time: t.created });
                    }
                });
                const adds = Object.keys(t.adds || {});
                adds.forEach(pid => {
                    const dhq = window.App?.LI?.playerScores?.[pid] || 0;
                    if (dhq > 3000 && !myPids.has(pid)) {
                        notes.push({ type: 'info', text: (playersData[pid]?.full_name || pid) + ' (' + dhq.toLocaleString() + ' DHQ) was picked up', time: t.created });
                    }
                });
            });

            // Trades involving my position needs
            txns.filter(t => t.type === 'trade').slice(0, 5).forEach(t => {
                const rids = t.roster_ids || [];
                if (rids.includes(myRoster?.roster_id)) {
                    notes.push({ type: 'trade', text: 'You completed a trade', time: t.created });
                }
            });

            return notes.sort((a, b) => (b.time || 0) - (a.time || 0)).slice(0, 10);
        }, [playersData, myRoster]);
        // GM Onboarding wizard state
        const gmIsUnconfigured = gmStrategy.mode === 'balanced' && !(gmStrategy.untouchable?.length) && !gmStrategy.notes && !(gmStrategy.targets?.length);
        const [gmOnboardStep, setGmOnboardStep] = useState(0); // 0=not started, 1-4=steps, 5=done
        const [reconMessages, setReconMessages] = useState(() => {
            const saved = LeagueStorage.get(LEAGUE_WR_KEYS.CHAT(currentLeague?.league_id));
            return (Array.isArray(saved) && saved.length > 1) ? saved
                : [{ role: 'assistant', content: 'Ask me anything about your league, team, or players.' }];
        });
        const [reconInput, setReconInput] = useState('');

        useEffect(() => {
            if (activeTab === 'analytics' && !analyticsData && window.App?.LI_LOADED) {
                const data = typeof runLeagueAnalytics === 'function' ? runLeagueAnalytics() : null;
                setAnalyticsData(data);
            }
        }, [activeTab, analyticsData, timeRecomputeTs]);

        // Auto-populate home page content when data is ready
        useEffect(() => {
            if (rankedTeams.length > 0 && !heroStory) {
                setHeroStory(computeDataDrivenHero());
            }
            if (rankedTeams.length > 0 && aiStories.length === 0) {
                generateAiStories();
            }
        }, [rankedTeams, transactions]);

        // Keyboard shortcut: Cmd/Ctrl+K to toggle ReconAI panel
        useEffect(() => {
          const handler = e => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
              e.preventDefault();
              setReconPanelOpen(prev => !prev);
            }
          };
          window.addEventListener('keydown', handler);
          return () => window.removeEventListener('keydown', handler);
        }, []);

        // First-time welcome — auto-open chat with Alex's intro
        useEffect(() => {
          if (!myRoster?.players?.length || !currentLeague?.league_id) return;
          const welcomeKey = LEAGUE_WR_KEYS.WELCOMED(currentLeague.league_id);
          if (LeagueStorage.get(welcomeKey)) return;
          LeagueStorage.set(welcomeKey, '1');
          // Small delay so the app finishes rendering first
          const t = setTimeout(() => {
            setWelcomeMode(true);
            setReconPanelOpen(true);
            setReconMessages([{
              role: 'assistant',
              // Phase 10/1: strategy is now driven by GM Mode (header badge + GM's Office),
              // not a per-chat prompt. Welcome copy references the persistent badge instead.
              content: 'Hey! I\'m **Alex Ingram** — your AI General Manager. I\'ll be sitting in the war room with you, analyzing your roster, scouting trade targets, and helping you build a dynasty.\n\nA few things to get us started:\n\n' +
                '\u2022 **Ask me anything** — trades, waivers, draft strategy, player analysis\n' +
                '\u2022 **Your GM Mode** (top of every page) already tells me whether we\'re rebuilding, competing, or winning now — change it anytime in GM\'s Office\n\n' +
                'Let\'s get to work. What\'s on your mind? \u2014 Alex',
              onboardChoices: [
                { label: 'What should I do?', value: 'advice' },
                { label: 'Pick Alex\'s look', value: 'avatar' }
              ]
            }]);
            setGmOnboardStep(0); // reset so strategy onboarding can trigger next
          }, 1500);
          return () => clearTimeout(t);
        }, [myRoster?.players?.length, currentLeague?.league_id]);

        // Handle welcome choices — exit welcome mode, show corner toast
        function handleWelcomeChoice(value) {
          setWelcomeMode(false);
          if (value === 'strategy') {
            setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined })),
              { role: 'user', content: 'Set my strategy' }
            ]);
            startGmOnboarding();
          } else if (value === 'advice') {
            setReconMessages(prev => prev.map(m => ({ ...m, onboardChoices: undefined })));
            sendReconMessage('What are the top 3 moves I should make right now?');
          } else if (value === 'avatar') {
            setReconMessages(prev => prev.map(m => ({ ...m, onboardChoices: undefined })));
            setShowAvatarPicker(true);
          }
          // Show "I'll be down here" toast after transition
          if (value !== 'strategy' && value !== 'advice') {
            setReconPanelOpen(false);
            setTimeout(() => {
              setShowCornerToast(true);
              setTimeout(() => setShowCornerToast(false), 4000);
            }, 300);
          }
        }

        // Auto-trigger GM onboarding when panel opens with unconfigured strategy
        // Phase 10/1: auto-triggered in-chat GM strategy onboarding removed.
        // Strategy is now configured via the persistent GM Mode badge + GM's Office.
        // Leaving startGmOnboarding() callable via the dead 'strategy' welcome-choice branch
        // as a safety net in case any legacy link still passes value='strategy'.

        // Persist chat messages to localStorage (cap at 20 messages)
        useEffect(() => {
          if (!currentLeague?.league_id || reconMessages.length <= 1) return;
          // Don't persist if last message is loading indicator
          const last = reconMessages[reconMessages.length - 1];
          if (last?.content === '...') return;
          const toSave = reconMessages.slice(-20).map(m => ({ role: m.role, content: m.content }));
          LeagueStorage.set(LEAGUE_WR_KEYS.CHAT(currentLeague.league_id), toSave);
        }, [reconMessages, currentLeague?.league_id]);

        // Compute power rankings when DHQ engine finishes or standings change
        useEffect(() => {
            if (!standings.length) return;
            function computeRankings() {
                // Use assessAllTeamsFromGlobal (batch) for consistency with League Map view
                const allAssess = (typeof window.assessAllTeamsFromGlobal === 'function' ? window.assessAllTeamsFromGlobal() : []);
                const assessMap = {};
                allAssess.forEach(a => { if (a?.rosterId) assessMap[a.rosterId] = a; });
                const ranked = standings.map(t => {
                    const r = currentLeague.rosters.find(r => r.owner_id === t.userId);
                    const totalDHQ = r?.players?.reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0) || 0;
                    let healthScore = 0;
                    let tierColor = 'var(--silver)';
                    const assessment = r ? assessMap[r.roster_id] : null;
                    if (assessment) {
                        healthScore = assessment.healthScore || 0;
                        const tier = (assessment.tier || '').toUpperCase();
                        tierColor = tier === 'ELITE' ? '#D4AF37' : tier === 'CONTENDER' ? '#2ECC71' : tier === 'CROSSROADS' ? '#F0A500' : tier === 'REBUILDING' ? '#E74C3C' : 'var(--silver)';
                    }
                    return { ...t, totalDHQ, healthScore, tierColor };
                }).sort((a,b) => {
                    if (b.healthScore !== a.healthScore) return b.healthScore - a.healthScore;
                    return b.totalDHQ - a.totalDHQ;
                });
                setRankedTeams(ranked);
            }
            // Always compute immediately (shows DHQ-based values if LI loaded, zeros if not)
            computeRankings();
            // If LI hasn't loaded yet, poll until it does and recompute with real health scores
            if (!window.App?.LI_LOADED) {
                const interval = setInterval(() => {
                    if (window.App?.LI_LOADED) { computeRankings(); clearInterval(interval); }
                }, 1500);
                // Safety: also recompute after a short delay in case LI loaded between render and effect
                const timeout = setTimeout(() => { if (window.App?.LI_LOADED) computeRankings(); }, 500);
                return () => { clearInterval(interval); clearTimeout(timeout); };
            }
        }, [standings, currentLeague, timeRecomputeTs, statsData]);

        useEffect(() => {
            loadLeagueDetails();
        }, [currentLeague]);

        async function loadLeagueDetails() {
            try {
                // Clear assessment caches for THIS league so health scores compute fresh.
                // Key by league ID — switching back to a previously-loaded league can
                // reuse its cache if the underlying data hasn't changed.
                const leagueKey = currentLeague.league_id || currentLeague.id || '';
                if (window.assessTeamFromGlobal?._cache) {
                    // Only clear entries for the current league, not all leagues
                    const cache = window.assessTeamFromGlobal._cache;
                    Object.keys(cache).forEach(k => { if (k.startsWith(leagueKey + '_') || !k.includes('_')) delete cache[k]; });
                }
                if (window.assessAllTeamsFromGlobal?._cache) {
                    window.assessAllTeamsFromGlobal._cache[leagueKey] = null;
                }

                if (!currentLeague.rosters || !currentLeague.users) {
                    throw new Error('League missing roster or user data');
                }

                const myRosterData = currentLeague._mfl && currentLeague._mflFranchiseId
                    ? currentLeague.rosters.find(r => r.roster_id === currentLeague._mflFranchiseId)
                    : currentLeague.rosters.find(r => r.owner_id === sleeperUserId);
                setMyRoster(myRosterData);

                // Compute standings immediately (no fetch needed)
                const standingsData = currentLeague.rosters.map(roster => {
                    const user = currentLeague.users.find(u => u.user_id === roster.owner_id);
                    return {
                        rosterId: roster.roster_id,
                        userId: roster.owner_id,
                        displayName: user?.display_name || user?.username || 'Unknown',
                        avatar: user?.avatar,
                        teamName: roster.metadata?.team_name || user?.metadata?.team_name || '',
                        wins: roster.settings?.wins || 0,
                        losses: roster.settings?.losses || 0,
                        ties: roster.settings?.ties || 0,
                        pointsFor: roster.settings?.fpts || 0,
                        division: roster.settings?.division || 0
                    };
                }).sort((a, b) => {
                    if (b.wins !== a.wins) return b.wins - a.wins;
                    if (a.losses !== b.losses) return a.losses - b.losses;
                    return b.pointsFor - a.pointsFor;
                });
                setStandings(standingsData);

                // Show dashboard immediately with what we have
                setLoading(false);
                setLoadStage('Loading player data...');

                // ── Unified platform provider pipeline ──────────────────
                // Replaces the old _isSleeper ? A : B branching. Each of the
                // four platforms (sleeper/mfl/espn/yahoo) implements the
                // same hydrate() contract — see shared/platform-provider.js.
                const provider = resolvePlatformProvider(currentLeague);
                if (!provider) {
                    const platform = currentLeague?._platform
                        || (currentLeague?._mfl ? 'mfl' : currentLeague?._espn ? 'espn' : currentLeague?._yahoo ? 'yahoo' : 'sleeper');
                    throw new Error('No ' + platform + ' platform provider loaded. Reload the page and try again.');
                }
                setLoadStage('Loading ' + provider.displayName + ' data...');

                // Pre-fetch two things ALL providers need as hydrate context:
                //   1. The Sleeper player DB — source of truth for player
                //      names, positions, teams. Non-Sleeper platforms use
                //      this to build their crosswalk to resolve native IDs
                //      to Sleeper IDs.
                //   2. NFL state — gives us the current week, needed for
                //      bucketing transactions and fetching matchups.
                const [sleeperPlayers, nflState] = await Promise.all([
                    fetchAllPlayers().catch(() => ({})),
                    fetchJSON(`${SLEEPER_BASE_URL}/state/nfl`).catch(() => ({})),
                ]);
                const currentWeek = nflState?.display_week || nflState?.week || (currentLeague.settings?.leg || 1);

                // Hydrate the league through the provider — single call
                // that replaces the old per-platform fetch pipelines.
                const hydrated = await provider.hydrate(currentLeague, {
                    sleeperPlayers,
                    currentWeek,
                    currentSeason: currentLeague.season || activeYear,
                    prevSeason: STATS_YEAR,
                    nflState,
                });

                // Pull enrichment out of _extras (Sleeper only — others empty)
                const stats       = hydrated._extras?.stats       || {};
                const projections = hydrated._extras?.projections || {};
                const prevStats   = hydrated._extras?.prevStats   || {};

                // Merge platform-specific extras into the Sleeper player DB.
                // For Sleeper this is a no-op; for MFL/ESPN/Yahoo this adds
                // IDP players and other platform-only records that the
                // Sleeper DB doesn't have.
                const players = { ...sleeperPlayers, ...(hydrated.players || {}) };

                // Use the hydrated rosters — for non-Sleeper, these now have
                // Sleeper-resolved player IDs (the whole point of the
                // provider rebuild step). For Sleeper, these are the fresh
                // fetchRosters result.
                const rosters     = (hydrated.rosters && hydrated.rosters.length) ? hydrated.rosters : (currentLeague.rosters || []);
                const leagueUsers = (hydrated.leagueUsers && hydrated.leagueUsers.length) ? hydrated.leagueUsers : (currentLeague.users || []);
                const tradedPicks = hydrated.tradedPicks || [];
                const matchupsData = hydrated.matchups || [];

                // Patch currentLeague in place so downstream useEffects
                // (computeRankings etc.) see the resolved rosters. React
                // won't re-render from this mutation, but setStandings /
                // setRankedTeams below trigger re-renders anyway.
                currentLeague.rosters = rosters;
                if (leagueUsers.length) currentLeague.users = leagueUsers;

                // Re-resolve myRosterData now that rosters may have changed
                const freshMyRoster = provider.id === 'mfl' && currentLeague._mflFranchiseId
                    ? rosters.find(r => r.roster_id === currentLeague._mflFranchiseId)
                    : rosters.find(r => r.owner_id === sleeperUserId) || myRosterData;
                if (freshMyRoster && freshMyRoster !== myRosterData) setMyRoster(freshMyRoster);
                const myRoster = freshMyRoster || myRosterData;

                setStatsData(stats);
                setProjectionsData(projections);
                setStats2025Data(prevStats);
                setPlayersData(players);
                setLoadStage('Computing values...');

                // Bridge to DHQ engine immediately
                if (window.App) {
                    if (!window.S) window.S = {};
                    window.S.players = players;
                    window.S.playerStats = {};
                    window.S.rosters = rosters;
                    window.S.leagueUsers = leagueUsers;
                    window.S.leagues = [{ league_id: currentLeague.id, name: currentLeague.name, scoring_settings: currentLeague.scoring_settings, roster_positions: currentLeague.roster_positions, settings: currentLeague.settings }];
                    // Invalidate any previously-loaded weekly points from a different
                    // league before kicking off the fresh fetch below.
                    if (window.S.weeklyPlayerPointsLeagueId && window.S.weeklyPlayerPointsLeagueId !== currentLeague.id) {
                        window.S.weeklyPlayerPoints = {};
                        window.S.weeklyPlayerPointsLeagueId = null;
                    }
                    window.S.currentLeagueId = currentLeague.id;
                    window.S.season = activeYear;
                    window.S.nflState = hydrated.nflState && Object.keys(hydrated.nflState).length ? hydrated.nflState : nflState;
                    window.S.currentWeek = currentWeek;
                    window.S.tradedPicks = window.App?.normalizeTradedPicks
                        ? window.App.normalizeTradedPicks(rosters, tradedPicks)
                        : tradedPicks;
                    window.S.matchups = matchupsData;
                    window.S.drafts = hydrated.drafts || [];

                    // Rolling PPG — fetch all played weeks' matchups in parallel
                    // so we can compute last-N-games PPG for each player. Runs
                    // in the background; consumers listen for wr:weekly-points-loaded.
                    // Only runs for Sleeper (other providers don't have this endpoint shape).
                    // Single-flight + league-tagged: rapidly switching leagues must not
                    // let a stale fetch from league A overwrite league B's results.
                    const _wppLeagueId = currentLeague.id || currentLeague.league_id;
                    if (provider.id === 'sleeper' && _wppLeagueId && currentWeek > 0) {
                        const fetchToken = (window._wppFetchToken = (window._wppFetchToken || 0) + 1);
                        const fetchLeagueId = _wppLeagueId;
                        (async () => {
                            try {
                                const weeks = [];
                                const maxWeek = Math.min(18, Math.max(1, currentWeek));
                                for (let w = 1; w <= maxWeek; w++) weeks.push(w);
                                const results = await Promise.all(weeks.map(w =>
                                    fetch('https://api.sleeper.app/v1/league/' + fetchLeagueId + '/matchups/' + w)
                                        .then(r => r.ok ? r.json() : [])
                                        .catch(() => [])
                                ));
                                // Guard: abort if a newer fetch has started or the
                                // active league has changed under us.
                                if (fetchToken !== window._wppFetchToken) return;
                                const activeLeagueId = window.S?.currentLeagueId;
                                if (activeLeagueId && activeLeagueId !== fetchLeagueId) return;
                                const wpp = {};
                                weeks.forEach((w, i) => {
                                    const wk = {};
                                    (results[i] || []).forEach(m => {
                                        if (m && m.players_points) {
                                            Object.entries(m.players_points).forEach(([pid, pts]) => {
                                                if (pts != null) wk[pid] = pts;
                                            });
                                        }
                                    });
                                    wpp[w] = wk;
                                });
                                window.S.weeklyPlayerPoints = wpp;
                                window.S.weeklyPlayerPointsLeagueId = fetchLeagueId;
                                window.dispatchEvent(new CustomEvent('wr:weekly-points-loaded', { detail: { leagueId: fetchLeagueId } }));
                            } catch (e) { /* non-fatal */ }
                        })();
                    }
                    window.S.myRosterId = myRoster?.roster_id;
                    window.S.platform = provider.id;   // canonical marker
                    const _isNonSleeper = provider.id !== 'sleeper';
                    window.S.myUserId = _isNonSleeper
                        ? (myRoster?.owner_id || currentLeague._mflFranchiseId || sleeperUserId)
                        : sleeperUserId;
                    const _userId = window.S.myUserId;
                    const _userName = _isNonSleeper ? (myRoster?._owner_name || 'Owner') : (sleeperUsername || '');
                    window.S.user = { user_id: _userId, display_name: _userName, username: _userName };

                    // Bridge helper functions for dhq-ai.js context builders
                    const _p = players || {};
                    window.myR = () => (window.S.rosters || []).find(r => r.roster_id === window.S.myRosterId);
                    window.pName = pid => _p[pid]?.full_name || pid;
                    window.pPos = pid => _p[pid]?.position || '';
                    window.pAge = pid => _p[pid]?.age || 0;
                    window.pM = pos => { if (['DE','DT'].includes(pos)) return 'DL'; if (['CB','S','FS','SS'].includes(pos)) return 'DB'; if (['OLB','ILB','MLB'].includes(pos)) return 'LB'; return pos; };
                    window.dynastyValue = pid => window.App?.LI?.playerScores?.[pid] || 0;
                    window.getFAAB = () => {
                        const league = window.S.leagues?.[0];
                        const my = window.myR();
                        const isFAAB = (league?.settings?.waiver_type === 2) || (league?.settings?.waiver_budget > 0);
                        const budget = isFAAB ? (league?.settings?.waiver_budget || 0) : 0;
                        const spent = my?.settings?.waiver_budget_used || 0;
                        const minBid = isFAAB ? (league?.settings?.waiver_budget_min ?? 0) : 0;
                        return { budget, spent, remaining: Math.max(0, budget - spent), isFAAB, minBid };
                    };
                    window.loadMentality = () => {
                        const gm = window._wrGmStrategy || {};
                        const modeMap = { contend: 'winnow', rebuild: 'rebuild', balanced: 'balanced' };
                        return { mentality: modeMap[gm.mode] || 'balanced', neverDrop: (gm.untouchable || []).map(pid => _p[pid]?.full_name || pid).join(', '), notes: gm.notes || '' };
                    };
                    window.App.myR = window.myR;
                    window.App.pName = window.pName;
                    window.App.pPos = window.pPos;
                    window.App.pAge = window.pAge;
                    window.App.pM = window.pM;
                    window.App.dynastyValue = window.dynastyValue;
                    window.App.getFAAB = window.getFAAB;
                    window.App.loadMentality = window.loadMentality;

                    // Rolling PPG helper — returns avg points over the last N
                    // games where the player actually played (> minPts threshold).
                    // Uses window.S.weeklyPlayerPoints populated by the background
                    // weekly fetch above. Returns 0 if no data yet.
                    window.App.computeRollingPPG = function (pid, lastN, minPts) {
                        const wpp = window.S?.weeklyPlayerPoints || {};
                        const weeks = Object.keys(wpp).map(Number).sort((a, b) => b - a);
                        const threshold = minPts == null ? 0.1 : minPts;
                        const games = [];
                        for (const w of weeks) {
                            const pts = wpp[w]?.[pid];
                            if (pts != null && pts >= threshold) {
                                games.push(pts);
                                if (games.length >= (lastN || 5)) break;
                            }
                        }
                        if (!games.length) return 0;
                        return +(games.reduce((a, b) => a + b, 0) / games.length).toFixed(1);
                    };

                    // Load AI keys from localStorage so callClaude can use them
                    const savedProvider = localStorage.getItem('dynastyhq_provider') || 'gemini';
                    const savedKey = localStorage.getItem('dynastyhq_' + savedProvider + '_key') || localStorage.getItem('dynastyhq_gemini_key') || localStorage.getItem('dynastyhq_anthropic_key') || '';
                    if (savedKey) { window.S.aiProvider = savedProvider; window.S.apiKey = savedKey; }

                    // Bridge stats data — use prevStats (2025) as base, overlay current season
                    Object.entries(prevStats).forEach(([pid, s]) => {
                        if (!window.S.playerStats[pid]) window.S.playerStats[pid] = {};
                        const pts = calcRawPts(s);
                        const gp = s.gp || 0;
                        window.S.playerStats[pid].prevTotal = pts ? Math.round(pts * 10) / 10 : 0;
                        window.S.playerStats[pid].prevAvg = gp > 0 ? Math.round(pts / gp * 10) / 10 : 0;
                        window.S.playerStats[pid].prevRawStats = s;
                    });
                    // Overlay current season stats if available
                    Object.entries(stats).forEach(([pid, s]) => {
                        if (!window.S.playerStats[pid]) window.S.playerStats[pid] = {};
                        const pts = calcRawPts(s);
                        const gp = s.gp || 0;
                        if (gp > 0) {
                            window.S.playerStats[pid].seasonTotal = pts ? Math.round(pts * 10) / 10 : 0;
                            window.S.playerStats[pid].seasonAvg = Math.round(pts / gp * 10) / 10;
                        }
                    });

                    // Mirror to SeasonContext so tab components can use React state
                    setSeasonCtxData({
                        season: activeYear,
                        playerStats: window.S.playerStats,
                        tradedPicks: tradedPicks || [],
                        rosters: currentLeague.rosters || [],
                        myRosterId: myRosterData?.roster_id || null,
                        lastUpdated: Date.now(),
                    });
                }

                setLoadStage('Building league intelligence...');

                // Flatten hydrated transactions (already bucketed by week
                // from the provider) and merge in DHQ historical trades.
                // This replaces the old per-platform transaction fetch.
                let allTxns = [];
                Object.values(hydrated.transactions || {}).forEach(wk => {
                    allTxns = allTxns.concat(wk || []);
                });
                allTxns.sort((a, b) => (b.created || 0) - (a.created || 0));

                // Merge DHQ historical trades (pre-analyzed with value data)
                // Deduplicate by timestamp so the provider's recent txns
                // aren't doubled.
                if (window.App?.LI?.tradeHistory?.length > 0) {
                    const existingTradeTs = new Set(allTxns.filter(t => t.type === 'trade').map(t => t.created || 0));
                    const histTrades = window.App.LI.tradeHistory
                        .filter(t => !existingTradeTs.has(t.ts || 0))
                        .map(t => ({ ...t, type: 'trade', status: 'complete', created: t.ts || 0, _fromDHQ: true }));
                    allTxns = [...allTxns, ...histTrades].sort((a, b) => (b.created || 0) - (a.created || 0));
                }

                // Populate window.S.transactions keyed by week for
                // free-agency.js / flash-brief.js consumers.
                if (window.S) {
                    const txnsByWeek = {};
                    allTxns.forEach(t => {
                        const key = 'w' + (t.leg ?? t.week ?? 0);
                        if (!txnsByWeek[key]) txnsByWeek[key] = [];
                        txnsByWeek[key].push(t);
                    });
                    window.S.transactions = txnsByWeek;
                }
                setTransactions(allTxns.slice(0, 50));

                // Trending — if the provider supplied it (Sleeper), use that;
                // otherwise fall back to Sleeper's global trending endpoint
                // so all platforms see league-wide trends.
                if (hydrated.trending?.adds || hydrated.trending?.drops) {
                    setTrending({
                        adds: hydrated.trending.adds || [],
                        drops: hydrated.trending.drops || [],
                    });
                } else if (window.Sleeper?.fetchTrending) {
                    (async () => {
                        try {
                            const [adds, drops] = await Promise.all([
                                window.Sleeper.fetchTrending('add', 24, 15),
                                window.Sleeper.fetchTrending('drop', 24, 15),
                            ]);
                            setTrending({ adds: adds || [], drops: drops || [] });
                        } catch (e) { window.wrLog && window.wrLog('trending.fetch', e); }
                    })();
                }

                // Paint the dashboard shell before DHQ starts, then await DHQ.
                // This lets React commit the initial render (standings, rosters,
                // nav) while DHQ computes — user sees the page immediately, then
                // DHQ values populate once loadLeagueIntel finishes.
                setLoadStage('');
                // Yield to the browser so the render commits before DHQ blocks
                await new Promise(r => setTimeout(r, 0));

                if (typeof window.App?.loadLeagueIntel === 'function' && !window.App.LI_LOADED) {
                    setDhqStatus({ loading: true, step: 'Analyzing league history...', progress: 20 });
                    try {
                        await window.App.loadLeagueIntel();
                        console.log('[War Room] DHQ engine loaded:', Object.keys(window.App.LI?.playerScores || {}).length, 'players valued');
                        setDhqStatus({ loading: false, step: 'Complete!', progress: 100 });
                        setStatsData(prev => ({ ...prev })); // force re-render
                        setTimeRecomputeTs(Date.now()); // refresh KPIs and rankings
                    } catch (e) {
                        console.warn('[War Room] DHQ engine error:', e);
                        setDhqStatus({ loading: false, step: 'Error: ' + e.message, progress: 0 });
                    }
                }

                // Load rookie prospect data from enrichment CSVs (fire-and-forget)
                if (typeof window.loadRookieProspects === 'function') {
                    window.loadRookieProspects().then(cache => {
                        console.log('[War Room] Rookie enrichment loaded:', cache?.count || 0, 'prospects');
                        setTimeRecomputeTs(Date.now()); // refresh to show enriched data
                    }).catch(e => console.warn('[War Room] Rookie data load failed:', e));
                }

                // Load player tags (syncs with ReconAI)
                if (window.OD?.loadPlayerTags) {
                    window.OD.loadPlayerTags(currentLeague.id || currentLeague.league_id).then(tags => {
                        window._playerTags = tags || {};
                        setTimeRecomputeTs(Date.now()); // force re-render to show tags
                    }).catch(err => window.wrLog('tags.load', err));
                }

                // Show tutorial for first-time users
                if (typeof window.startWRTutorial === 'function') {
                    setTimeout(window.startWRTutorial, 1000);
                }

                // Load league docs context for commissioner mode (fire-and-forget)
                if (window.OD?.getLeagueDocsContext) {
                    window.OD.getLeagueDocsContext(currentLeague.id || currentLeague.league_id).then(ctx => {
                        if (ctx) window._leagueDocsContext = ctx;
                    }).catch(() => {});
                }

            } catch (err) {
                console.error('Failed to load league details:', err);
                setError(err.message || 'Failed to load league details');
                setLoading(false);
                setLoadStage('');
            }
        }

        async function switchYear(year) {
            if (year === activeYear) return;
            // Year switching requires a previous_league_id chain — check the
            // platform provider capability instead of hardcoding Sleeper.
            const provider = resolvePlatformProvider(currentLeague);
            if (!provider?.capabilities?.hasYearChain) {
                console.warn('[War Room] Year switching not supported for ' + (provider?.displayName || 'this platform'));
                return;
            }
            setLoading(true);
            setError(null);
            setActiveYear(year);
            setTimeYear(parseInt(year));
            try {
                const targetYear = parseInt(year);
                const currentYear = parseInt(activeYear);
                let targetLeagueId = null;

                if (targetYear < currentYear) {
                    // Going backward: walk previous_league_id chain
                    let leagueId = currentLeague.id;
                    for (let y = currentYear; y > targetYear && leagueId; y--) {
                        const leagueInfo = await fetchLeagueInfo(leagueId);
                        leagueId = leagueInfo?.previous_league_id || null;
                    }
                    targetLeagueId = leagueId;
                } else {
                    // Going forward: get user leagues for target year, then check which one chains back to current league
                    const userLeagues = await fetchUserLeagues(sleeperUserId, year);
                    for (const lg of userLeagues) {
                        // Walk this league's previous_league_id chain to see if it connects to our current league
                        let checkId = lg.previous_league_id;
                        let steps = targetYear - currentYear;
                        while (steps > 1 && checkId) {
                            const info = await fetchLeagueInfo(checkId);
                            checkId = info?.previous_league_id || null;
                            steps--;
                        }
                        if (checkId === currentLeague.id) {
                            targetLeagueId = lg.league_id;
                            break;
                        }
                    }
                    // Fallback: match by name if chain doesn't connect
                    if (!targetLeagueId) {
                        const nameMatch = userLeagues.find(l => l.name === currentLeague.name);
                        targetLeagueId = nameMatch ? nameMatch.league_id : (userLeagues[0] ? userLeagues[0].league_id : null);
                    }
                }

                if (!targetLeagueId) {
                    setError('No leagues found for ' + year);
                    setLoading(false);
                    return;
                }

                const [leagueInfo, rosters, users] = await Promise.all([
                    fetchLeagueInfo(targetLeagueId),
                    fetchLeagueRosters(targetLeagueId),
                    fetchLeagueUsers(targetLeagueId)
                ]);
                setViewingOwnerId(sleeperUserId);
                setCurrentLeague({
                    id: targetLeagueId,
                    name: leagueInfo.name,
                    season: year,
                    scoring_settings: leagueInfo.scoring_settings || {},
                    roster_positions: leagueInfo.roster_positions || [],
                    settings: leagueInfo.settings || {},
                    rosters,
                    users
                });
            } catch (err) {
                console.error('Failed to switch year:', err);
                setError('Failed to load ' + year + ' data');
                setLoading(false);
            }
        }

        function getPlayerName(playerId) {
            const player = playersData[playerId];
            if (!player) return `Player ${playerId}`;
            return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
        }

        function getPlayerPosition(playerId) {
            const player = playersData[playerId];
            return player?.position || '??';
        }

        function getPlayerTeam(playerId) {
            const player = playersData[playerId];
            return player?.team || '';
        }

        // Compute fantasy pts using the league's actual scoring_settings weights,
        // applied to raw stat fields — works for both offensive and IDP players.
        // Mirrors the Team Comps page's fantasyPointsFromScoring() approach:
        // always use scoring_settings when available so IDP defensive stats aren't
        // silently zeroed out by Sleeper's pre-calculated pts_half_ppr = 0.
        function calcRawPts(s) {
            return window.App.calcRawPts(s, currentLeague?.scoring_settings);
        }

        function getPlayerStats(playerId) {
            const player = playersData[playerId];
            // Always show STATS_YEAR totals; fall back to current-season data for historical year views
            const s = stats2025Data[playerId] || statsData[playerId];
            const p = projectionsData[playerId];

            // Years of experience
            const yrs = player?.years_exp != null ? player.years_exp : '-';

            // Fantasy points — uses league scoring_settings for IDP players
            const rawPts = calcRawPts(s);
            const pts = rawPts !== null ? Number(rawPts).toFixed(1) : '-';

            // Games played
            const gp = s?.gp != null ? s.gp : '-';

            // Average points per game
            let avg = '-';
            if (rawPts !== null && s?.gp && s.gp > 0) {
                avg = (rawPts / s.gp).toFixed(1);
            }

            // Projected points — use Sleeper projections when available, otherwise 2025 season totals
            const rawProj = p ? (p.pts_half_ppr ?? p.pts_ppr ?? p.pts_std ?? null) : null;
            const rawPts2025 = calcRawPts(stats2025Data[playerId]);
            const proj = rawProj !== null ? Number(rawProj).toFixed(1) : (rawPts2025 !== null ? Number(rawPts2025).toFixed(1) : '-');

            return { yrs, pts, gp, avg, proj };
        }

        function getPositionColor(pos) {
            const colors = { QB: '#FF6B6B', RB: '#4ECDC4', WR: '#45B7D1', TE: '#F7DC6F', K: '#BB8FCE', DEF: '#85929E' };
            return colors[pos] || 'var(--silver)';
        }

        // Dashboard helpers
        function timeAgo(ts) {
            if (!ts) return '';
            // Sleeper API returns seconds; convert to ms. Guard against already-ms values.
            const tsMs = ts > 1e12 ? ts : ts * 1000;
            const diff = Date.now() - tsMs;
            if (diff < 0) return 'just now';
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return 'just now';
            if (mins < 60) return mins + 'm ago';
            const hrs = Math.floor(mins / 60);
            if (hrs < 24) return hrs + 'h ago';
            const days = Math.floor(hrs / 24);
            if (days < 30) return days + 'd ago';
            return Math.floor(days / 30) + 'mo ago';
        }

        function getOwnerName(rosterId) {
            const roster = currentLeague.rosters?.find(r => r.roster_id === rosterId);
            const user = currentLeague.users?.find(u => u.user_id === roster?.owner_id);
            return user?.display_name || user?.username || 'Unknown';
        }

        function computeDataDrivenHero() {
            const parts = [];
            if (rankedTeams.length) {
                const top = rankedTeams[0];
                const myRank = rankedTeams.findIndex(t => t.userId === sleeperUserId) + 1;
                parts.push(top.displayName + ' leads the power rankings with a ' + top.healthScore + ' health score and ' + top.wins + '-' + top.losses + ' record.');
                if (myRank && myRank !== 1) {
                    const me = rankedTeams[myRank - 1];
                    parts.push('You sit at #' + myRank + ' (' + me.wins + '-' + me.losses + ') with ' + (me.totalDHQ||0).toLocaleString() + ' total DHQ.');
                } else if (myRank === 1) {
                    parts.push('You hold the top spot in the league.');
                }
            }
            const recentTrade = transactions.find(t => t.type === 'trade');
            if (recentTrade) {
                const addPids = Object.keys(recentTrade.adds || {});
                const names = addPids.slice(0, 2).map(pid => getPlayerName(pid)).filter(Boolean).join(' and ');
                if (names) parts.push('Latest trade: ' + names + ' changed hands between ' + getOwnerName(recentTrade.roster_ids?.[0]) + ' and ' + getOwnerName(recentTrade.roster_ids?.[1]) + '.');
            }
            return parts.join(' ') || 'Welcome to your War Room. League intelligence is loading.';
        }

        async function generateHeroStory() {
            // Try AI first, fall back to data-driven
            if (typeof dhqAI === 'function' || typeof window.dhqAI === 'function' || typeof window.callClaude === 'function') {
                setHeroStory('Generating...');
                try {
                    const ctx = typeof dhqContext === 'function' ? dhqContext(true) : '';
                    const prompt = "Write a 3-4 sentence sports journalist narrative about the current state of this dynasty league. Focus on the biggest storyline this week — trades, injuries, power shifts, or playoff implications. Write in the style of The Athletic — dramatic, informed, specific. Use owner names and player names when possible.";
                    const aiFn = typeof dhqAI === 'function' ? dhqAI : window.dhqAI;
                    const reply = await aiFn('home-chat', prompt, ctx);
                    if (reply) { setHeroStory(reply); return; }
                } catch(e) { console.warn('Hero story AI failed, using data-driven:', e); }
            }
            setHeroStory(computeDataDrivenHero());
        }

        async function generateAiStories() {
            setAiStories([{ icon: '\u23F3', category: 'Generating...', headline: 'Analyzing league data...', body: '' }]);
            try {
                const stories = [];
                const trades = transactions.filter(t => t.type === 'trade');
                if (trades.length > 0) {
                    const bigTrade = trades[0];
                    const addPids = Object.keys(bigTrade.adds || {});
                    const addNames = addPids.slice(0, 3).map(pid => getPlayerName(pid)).join(', ');
                    const totalVal = addPids.reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
                    stories.push({
                        icon: '\uD83E\uDD1D', category: 'Trade of the Week',
                        headline: addNames ? addNames + ' change hands in blockbuster deal' : 'Latest trade shakes up league landscape',
                        body: getOwnerName(bigTrade.roster_ids?.[0]) + ' and ' + getOwnerName(bigTrade.roster_ids?.[1]) + ' swapped ' + addPids.length + ' player' + (addPids.length !== 1 ? 's' : '') + '. Combined DHQ value: ' + totalVal.toLocaleString() + '.'
                    });
                } else {
                    stories.push({ icon: '\uD83E\uDD1D', category: 'Trade Watch', headline: 'Trade market remains quiet', body: 'No trades completed recently. The league is in a holding pattern.' });
                }
                if (rankedTeams.length > 0) {
                    const top = rankedTeams[0];
                    const bottom = rankedTeams[rankedTeams.length - 1];
                    stories.push({
                        icon: '\uD83D\uDCCA', category: 'Power Shift',
                        headline: top.displayName + ' holds the top spot in power rankings',
                        body: 'Health score of ' + top.healthScore + ' and ' + top.totalDHQ.toLocaleString() + ' total DHQ. ' + top.displayName + ' leads at ' + top.wins + '-' + top.losses + '. ' + bottom.displayName + ' trails at #' + rankedTeams.length + '.'
                    });
                }
                if (myRoster?.players?.length) {
	                    const agingPlayers = myRoster.players
	                        .map(pid => ({ pid, player: playersData[pid], dhq: window.App?.LI?.playerScores?.[pid] || 0 }))
	                        .filter(p => {
                                if (!p.player || p.dhq <= 1000) return false;
                                const valueEnd = typeof window.App?.getValueWindowEnd === 'function'
                                    ? window.App.getValueWindowEnd(p.player.position)
                                    : ((window.App.peakWindows || {})[p.player.position] || [24, 29])[1];
                                return p.player.age > valueEnd;
                            })
                        .sort((a,b) => b.dhq - a.dhq)
                        .slice(0, 3);
                    if (agingPlayers.length > 0) {
                        const names = agingPlayers.map(p => (p.player.full_name || getPlayerName(p.pid)) + ' (' + p.player.age + ')').join(', ');
	                        stories.push({ icon: '\u23F0', category: 'Aging Watch', headline: 'Your veterans past the value window', body: names + ' \u2014 high-value assets past their position curve. Consider selling high before value erodes.' });
                    } else {
                        stories.push({ icon: '\uD83C\uDF31', category: 'Youth Movement', headline: 'Your roster skews young', body: 'No significant aging concerns. Your dynasty foundation is built for the long haul.' });
                    }
                }
                if (typeof dhqAI === 'function' && window.App?.LI_LOADED) {
                    try {
                        const ctx = dhqContext(true);
                        const reply = await dhqAI('home-chat', 'Write one punchy 2-sentence sports headline and body about the most interesting dynasty angle in this league right now. Focus on a specific team or player. Format exactly: HEADLINE: [headline]\\nBODY: [body]', ctx);
                        if (reply) {
                            const headlineMatch = reply.match(/HEADLINE:\s*(.+)/i);
                            const bodyMatch = reply.match(/BODY:\s*(.+)/is);
                            if (headlineMatch) {
                                stories.push({ icon: '\uD83E\uDD16', category: 'AI Insight', headline: headlineMatch[1].trim(), body: bodyMatch ? bodyMatch[1].trim() : reply });
                            }
                        }
                    } catch(e) { window.wrLog('aiStory.generate', e); }
                }
                setAiStories(stories.slice(0, 3));
            } catch(e) {
                console.warn('AI stories error:', e);
                setAiStories([{ icon: '\u26A0\uFE0F', category: 'Error', headline: 'Could not generate stories', body: 'Please try again later.' }]);
            }
        }

        // GM Onboarding wizard — conversational strategy setup
        function startGmOnboarding() {
          if (gmOnboardStep > 0) return;
          setGmOnboardStep(1);
          setReconMessages([{
            role: 'assistant',
            content: 'Welcome to the War Room. I\'m Alex — your AI General Manager. Before we get started, let me learn how you want to run this team.\n\n**First things first — are we competing for a title this year, or building for the future?**',
            onboardChoices: [
              { label: 'Win Now', value: 'contend' },
              { label: 'Balanced', value: 'balanced' },
              { label: 'Rebuilding', value: 'rebuild' }
            ]
          }]);
        }

        function handleOnboardChoice(value) {
          const step = gmOnboardStep;
          if (step === 1) {
            const modeLabels = { contend: 'Win Now', balanced: 'Balanced', rebuild: 'Rebuilding' };
            setGmStrategy(prev => ({ ...prev, mode: value }));
            setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined })),
              { role: 'user', content: modeLabels[value] },
              { role: 'assistant', content: value === 'contend'
                ? 'Aggressive. I like it. We\'re going all-in.\n\n**How do you want to play it — conservative and calculated, or willing to swing big?**'
                : value === 'rebuild'
                ? 'Smart. Let\'s stack assets and build a dynasty.\n\n**How aggressive should we be with trades — swing for the fences, or play it safe?**'
                : 'Flexible. We\'ll compete while keeping an eye on the future.\n\n**How aggressive should we be with trades?**',
                onboardChoices: [
                  { label: 'Conservative', value: 'conservative' },
                  { label: 'Moderate', value: 'moderate' },
                  { label: 'Aggressive', value: 'aggressive' }
                ]
              }
            ]);
            setGmOnboardStep(2);
          } else if (step === 2) {
            setGmStrategy(prev => ({ ...prev, riskTolerance: value }));
            const topPlayers = (myRoster?.players || [])
              .sort((a, b) => (window.App?.LI?.playerScores?.[b] || 0) - (window.App?.LI?.playerScores?.[a] || 0))
              .slice(0, 6);
            setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined })),
              { role: 'user', content: value.charAt(0).toUpperCase() + value.slice(1) },
              { role: 'assistant', content: 'Got it.\n\n**Anyone on your roster you\'d never trade? Your untouchables.** Tap to select — or skip if everyone has a price.',
                onboardChoices: topPlayers.map(pid => ({
                  label: (playersData[pid]?.full_name || pid),
                  value: pid,
                  multi: true
                })),
                onboardMulti: true,
                onboardSkip: true
              }
            ]);
            setGmOnboardStep(3);
          } else if (step === 3) {
            // value is array of pids or 'skip'
            if (value !== 'skip' && Array.isArray(value) && value.length) {
              setGmStrategy(prev => ({ ...prev, untouchable: value }));
              const names = value.map(pid => playersData[pid]?.full_name || pid).join(', ');
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'Untouchable: ' + names }
              ]);
            } else {
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'Everyone has a price' }
              ]);
            }
            setReconMessages(prev => [...prev,
              { role: 'assistant', content: '**Last question — any positions you\'re actively targeting in trades?** Tap all that apply, or skip.',
                onboardChoices: ['QB','RB','WR','TE','DL','LB','DB','Picks'].map(t => ({ label: t, value: t, multi: true })),
                onboardMulti: true,
                onboardSkip: true
              }
            ]);
            setGmOnboardStep(4);
          } else if (step === 4) {
            if (value !== 'skip' && Array.isArray(value) && value.length) {
              setGmStrategy(prev => ({ ...prev, targets: value }));
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'Targeting: ' + value.join(', ') }
              ]);
            } else {
              setReconMessages(prev => [...prev.map(m => ({ ...m, onboardChoices: undefined, onboardMulti: undefined, onboardSkip: undefined })),
                { role: 'user', content: 'No specific targets' }
              ]);
            }
            setGmOnboardStep(5);
            // Generate strategy assessment
            setReconMessages(prev => [...prev, { role: 'assistant', content: '...' }]);
            (async () => {
              try {
                const ctx = typeof dhqContext === 'function' ? dhqContext(false) : '';
                const reply = typeof dhqAI === 'function'
                  ? await dhqAI('strategy-analysis', 'Give me a 3-sentence personalized strategic assessment of my team based on my GM strategy settings. Be direct and specific.', ctx)
                  : 'Strategy saved. Ask me anything about your team.';
                setReconMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: reply };
                  return updated;
                });
              } catch (e) {
                setReconMessages(prev => {
                  const updated = [...prev];
                  updated[updated.length - 1] = { role: 'assistant', content: 'Strategy locked in. Let\'s get to work — ask me anything. — Alex' };
                  return updated;
                });
              }
            })();
          }
        }

        // Multi-select state for onboarding
        const [onboardSelections, setOnboardSelections] = useState([]);

        // ReconAI: send message
	        async function sendReconMessage(text) {
	          if (!text?.trim()) return;
	          window.OD?.track?.('alex_prompt_sent', {
	            platform: 'warroom',
	            leagueId: currentLeague?.league_id || currentLeague?.id || null,
	            module: activeTab,
	            metadata: { chars: text.trim().length },
	          });
	          // Free tier: 1 AI call per day
          if (!canUseAI()) {
            setReconMessages(prev => [...prev, { role: 'user', content: text.trim() }, { role: 'assistant', content: 'You\'ve used your free AI query for today. Upgrade to War Room Scout ($4.99/mo) or War Room ($9.99/mo) for unlimited AI access.' }]);
            return;
          }
          // Only track local daily use if NOT using server AI (server handles its own rate limiting)
          if (!(typeof hasServerAI === 'function' && hasServerAI())) trackAIUse();
          setReconInput('');
          const userMsg = { role: 'user', content: text.trim() };
          setReconMessages(prev => [...prev, userMsg, { role: 'assistant', content: '...' }]);
          try {
            let context = '';
            if (typeof dhqContext === 'function') context = dhqContext(true);
            if (window._leagueDocsContext) {
                context += '\n\n--- LEAGUE DOCUMENTS ---\n' + window._leagueDocsContext;
            }
            // Phase 1: inject GM mode preamble so Alex's advice matches the GM's strategy
            try {
                const gm = window.WR?.GmMode?.describe?.(gmStrategy?.mode);
                if (gm && gm.prompt) {
                    context = '--- GM MODE DIRECTIVE ---\n' + gm.prompt + '\n\n' + context;
                }
            } catch (e) { /* ignore */ }
            const messages = [...reconMessages.slice(-4), userMsg].map((m, i, arr) => {
              if (m.role === 'user' && i === arr.length - 1) {
                return { role: 'user', content: context + '\n\n' + m.content };
              }
              if (m.role === 'assistant' && m.content.length > 400) {
                return { role: 'assistant', content: m.content.substring(0, 400) + '...' };
              }
              return m;
            });
            // Route requests to optimal prompt type
            const isScoutRequest = /^Scout\s/i.test(text.trim());
            const isRookieScout = /SEARCH FOR CURRENT INFO.*scouting report|Full dynasty scouting report/i.test(text.trim());
            const aiType = isRookieScout ? 'rookie-scout' : isScoutRequest ? 'trade-scout' : 'home-chat';
            const reply = typeof dhqAI === 'function'
              ? await dhqAI(aiType, null, null, { messages })
              : typeof callClaude === 'function'
                ? await callClaude(messages)
                : 'AI not available. Add an API key in Settings.';
            setReconMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: reply };
              return updated;
            });
          } catch(e) {
            console.warn('[Alex Ingram] AI error:', e.message);
            setReconMessages(prev => {
              const updated = [...prev];
              updated[updated.length - 1] = { role: 'assistant', content: 'Error: ' + e.message };
              return updated;
            });
          }
        }

        // ReconAI: contextual chips
        function getReconChips() {
          const base = [
            { label: 'What should I do?', prompt: 'What are the top 3 moves I should make right now?' },
          ];
          // Contextual starter prompt based on current tab
          const starters = {
            analytics: { label: 'What are my biggest weaknesses?', prompt: 'Analyze my team and tell me what my biggest weaknesses are — positional gaps, age concerns, and depth issues.' },
            myteam: { label: 'Who should I trade?', prompt: 'Looking at my roster, which players should I be actively trying to trade and what kind of return should I target?' },
            trades: { label: 'Best trade partner right now?', prompt: 'Which owner in my league is the best trade partner for me right now? Consider roster needs, tendencies, and mutual fit.' },
            fa: { label: 'Best waiver pickup this week?', prompt: 'Who is the best waiver wire pickup I should target this week based on my roster needs and available players?' },
            draft: { label: 'Best pick at my spot?', prompt: 'Given my draft position and roster needs, who is the best player I should target with my next pick?' },
          };
          const starter = starters[activeTab];
          const chips = starter ? [starter, ...base] : [...base];

          if (activeTab === 'dashboard') return [...chips,
            { label: 'Top 3 moves', prompt: 'What are the top 3 moves I should make right now?' },
            { label: 'League pulse', prompt: 'Give me a quick pulse check on my league — who is rising, falling, and what moves are being made.' },
            { label: 'League recap', prompt: 'Summarize the key storylines in my league right now.' },
            { label: 'Power rankings', prompt: 'Give me your power rankings for this league with one-line analysis per team.' },
          ];
          if (activeTab === 'myteam') return [...chips,
            { label: 'Roster grade', prompt: 'Grade my roster position by position and identify the biggest weakness.' },
            { label: 'Who to sell?', prompt: 'Which players on my roster should I sell high on right now?' },
          ];
          if (activeTab === 'league') return [...chips,
            { label: 'League overview', prompt: 'Give me a quick overview of every team in the league — strengths, weaknesses, and dynasty outlook.' },
            { label: 'Trade partners', prompt: 'Which teams in the league are the best trade partners for me right now and why?' },
          ];
          if (activeTab === 'analytics') return [...chips,
            { label: 'Explain my gaps', prompt: 'Based on the winner analysis, what are my biggest gaps and how do I close them?' },
            { label: 'Draft strategy', prompt: 'Based on historical draft success in this league, what should my draft strategy be?' },
          ];
          if (activeTab === 'trades') return [...chips,
            { label: 'Best trade targets', prompt: 'Who are my best trade targets right now based on roster needs and trade partner compatibility?' },
            { label: 'Sell high candidates', prompt: 'Which players on my roster should I sell high on in a trade?' },
          ];
          if (activeTab === 'fa') return [...chips,
            { label: 'Best pickup?', prompt: 'Who is the best available free agent I should target right now?' },
            { label: 'FAAB advice', prompt: 'How should I spend my remaining FAAB budget?' },
          ];
          if (activeTab === 'draft') return [...chips,
            { label: 'Who at my pick?', prompt: 'Who should I target with my draft picks this year?' },
            { label: 'Draft strategy', prompt: 'What should my draft strategy be based on my roster needs?' },
          ];
          return chips;
        }

        if (error) {
            return (
                <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--white)', padding: '2rem', textAlign: 'center' }}>
                    <div style={{ color: '#E74C3C', fontSize: '1.5rem', marginBottom: '1rem' }}>Error Loading League</div>
                    <div style={{ color: 'var(--silver)', marginBottom: '2rem' }}>{error}</div>
                    <button onClick={onBack} style={{ padding: '0.75rem 1.5rem', background: 'var(--gold)', border: 'none', borderRadius: '8px', color: 'var(--black)', fontFamily: 'var(--font-body)', fontSize: '1rem', fontWeight: '700', cursor: 'pointer' }}>← Back to Dashboard</button>
                </div>
            );
        }

        if (loading) {
            return (
                <div className="app-container" style={{ paddingBottom: '60px' }}>
                    {/* Skeleton left nav */}
                    <div style={{ position:'fixed', left:0, top:0, bottom:0, width:'160px', background:'var(--black)', borderRight:'1px solid rgba(212,175,55,0.2)', padding:'16px 0', zIndex:100 }}>
                        <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.3rem', color:'var(--gold)', padding:'0 16px', marginBottom:'20px' }}>WAR ROOM</div>
                        {['Home','My Team','League','Analytics','Trades','Free Agency','Draft'].map((label,i) => (
                            <div key={i} style={{ padding:'10px 16px', fontSize:'0.82rem', fontFamily: 'var(--font-body)', color: i===0?'var(--gold)':'rgba(255,255,255,0.3)', borderLeft: i===0?'3px solid var(--gold)':'3px solid transparent', background: i===0?'rgba(212,175,55,0.12)':'transparent' }}>{label}</div>
                        ))}
                    </div>
                    {/* Skeleton main content */}
                    <div style={{ marginLeft:'160px', padding:'24px 32px' }}>
                        <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.1rem', color:'var(--gold)', marginBottom:'16px' }}>{currentLeague.name}</div>
                        {/* KPI skeleton row */}
                        <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'12px', marginBottom:'24px' }}>
                            <SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI /><SkeletonKPI />
                        </div>
                        {/* Hero skeleton */}
                        <div className="skel-card" style={{ height:'120px', marginBottom:'20px' }}>
                            <div className="skel skel-line" style={{ width:'70%' }} />
                            <div className="skel skel-line" style={{ width:'90%' }} />
                            <div className="skel skel-line" style={{ width:'50%' }} />
                        </div>
                        {/* Two-column skeleton */}
                        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>
                            <div className="skel-card"><div className="skel skel-line" style={{width:'40%',marginBottom:'12px'}} /><SkeletonRows count={5} /></div>
                            <div className="skel-card"><div className="skel skel-line" style={{width:'40%',marginBottom:'12px'}} /><SkeletonRows count={5} /></div>
                        </div>
                    </div>
                </div>
            );
        }

        // Currently viewed roster
        const viewingRoster = currentLeague.rosters.find(r => r.owner_id === viewingOwnerId) || myRoster;
        const viewingOwner = standings.find(t => t.userId === viewingOwnerId);
        const isViewingMyTeam = viewingOwnerId === sleeperUserId;

        // Stat column style shared by header and rows
        const statColStyle = { width: '42px', textAlign: 'center', fontSize: '0.76rem', flexShrink: 0 };

        // Column header row for stat columns — merged into section labels
        const statLabels = ['DHQ', 'YRS', 'PTS', 'GP', 'AVG', 'PROJ'];

        function SectionLabel({ label, color, borderColor, borderWidth }) {
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '0.5rem',
                    paddingBottom: '0.4rem',
                    borderBottom: `${borderWidth || '1px'} solid ${borderColor || color}`,
                    gap: '0.5rem'
                }}>
                    <span style={{ width: '36px', flexShrink: 0 }}></span>
                    <span style={{ flex: 1, color: color, fontSize: '0.85rem', fontWeight: '700', letterSpacing: '0.08em' }}>{label}</span>
                    {statLabels.map(l => (
                        <span key={l} style={{ ...statColStyle, color: 'var(--gold)', fontWeight: '700', letterSpacing: '0.05em', opacity: 0.8 }}>{l}</span>
                    ))}
                </div>
            );
        }

        // PlayerRow with gold position box, clickable name, 5 stat columns
        function PlayerRow({ playerId, section }) {
            const pos = getPlayerPosition(playerId);
            const stats = getPlayerStats(playerId);
            const team = getPlayerTeam(playerId);
            const borderColor = section === 'starter' ? 'var(--gold)' : section === 'ir' ? '#E74C3C' : section === 'taxi' ? '#3498DB' : 'transparent';
            const bgColor = section === 'starter' ? 'rgba(212, 175, 55, 0.05)' : section === 'ir' ? 'rgba(231, 76, 60, 0.05)' : section === 'taxi' ? 'rgba(52, 152, 219, 0.05)' : 'rgba(255, 255, 255, 0.02)';
            return (
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0.45rem 0.6rem',
                    marginBottom: '0.3rem',
                    background: bgColor,
                    borderLeft: borderColor !== 'transparent' ? `3px solid ${borderColor}` : 'none',
                    borderRadius: '4px',
                    gap: '0.5rem'
                }}>
                    {/* Gold position box */}
                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: '36px',
                        flexShrink: 0,
                        fontSize: '0.76rem',
                        fontWeight: '700',
                        color: getPositionColor(pos),
                        border: '1.5px solid var(--gold)',
                        borderRadius: '3px',
                        padding: '2px 0',
                        background: 'rgba(212, 175, 55, 0.08)',
                        letterSpacing: '0.02em'
                    }}>
                        {pos}
                    </span>
                    {/* Player name + team — opens shared player card */}
                    <a
                        href="#"
                        onClick={e => { e.preventDefault(); if (window._wrSelectPlayer) window._wrSelectPlayer(playerId); }}
                        style={{
                            flex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            color: 'var(--white)',
                            fontSize: '0.92rem',
                            overflow: 'hidden',
                            textDecoration: 'none',
                            transition: 'color 0.2s',
                            minWidth: 0,
                            cursor: 'pointer'
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = 'var(--gold)'}
                        onMouseLeave={e => e.currentTarget.style.color = 'var(--white)'}
                    >
                        <div style={{ width: '28px', height: '28px', flexShrink: 0 }}>
                        <img
                            src={`https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`}
                            alt=""
                            onError={e => { e.target.style.display = 'none'; }}
                            style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }}
                        />
                        </div>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {getPlayerName(playerId)} <span style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.65 }}>{team}</span>
                        </span>
                    </a>
                    {/* DHQ dynasty value */}
                    {(() => {
                      const dhq = window.App?.LI?.playerScores?.[playerId] || 0;
                      if (!dhq) return <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.6, fontSize: '0.76rem' }}>—</span>;
                      const col = dhq >= 7000 ? '#2ECC71' : dhq >= 4000 ? '#D4AF37' : dhq >= 2000 ? 'var(--silver)' : 'rgba(255,255,255,0.4)';
                      return <span style={{ ...statColStyle, color: col, fontWeight: '700', fontFamily: 'var(--font-body)', fontSize: '0.72rem', minWidth: '42px' }}>{dhq.toLocaleString()}</span>;
                    })()}
                    {/* Stat columns: YRS PTS GP AVG PROJ */}
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.yrs}</span>
                    <span style={{ ...statColStyle, color: 'var(--gold)', fontWeight: '700' }}>{stats.pts}</span>
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.gp}</span>
                    <span style={{ ...statColStyle, color: 'var(--silver)', opacity: 0.7 }}>{stats.avg}</span>
                    <span style={{ ...statColStyle, color: '#4ECDC4', fontWeight: '600' }}>{stats.proj}</span>
                </div>
            );
        }

        // Reusable roster section renderer
        function RosterSection({ roster }) {
            if (!roster) return <div style={{ textAlign: 'center', color: 'var(--silver)', padding: '2rem' }}>No roster found</div>;
            const starters = roster.starters || [];
            const reserve = roster.reserve || [];
            const taxi = roster.taxi || [];
            const bench = (roster.players || []).filter(p => !starters.includes(p) && !reserve.includes(p) && !taxi.includes(p));

            return (
                <>
                    {starters.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="STARTERS" color="var(--gold)" borderColor="var(--gold)" borderWidth="2px" />
                            {starters.map((id, i) => <PlayerRow key={i} playerId={id} section="starter" />)}
                        </div>
                    )}
                    {bench.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="BENCH" color="var(--silver)" borderColor="rgba(255,255,255,0.15)" />
                            {bench.map((id, i) => <PlayerRow key={i} playerId={id} section="bench" />)}
                        </div>
                    )}
                    {reserve.length > 0 && (
                        <div style={{ marginBottom: '1.25rem' }}>
                            <SectionLabel label="INJURED RESERVE" color="#E74C3C" borderColor="rgba(231,76,60,0.3)" />
                            {reserve.map((id, i) => <PlayerRow key={i} playerId={id} section="ir" />)}
                        </div>
                    )}
                    {taxi.length > 0 && (
                        <div>
                            <SectionLabel label="TAXI SQUAD" color="#3498DB" borderColor="rgba(52,152,219,0.3)" />
                            {taxi.map((id, i) => <PlayerRow key={i} playerId={id} section="taxi" />)}
                        </div>
                    )}
                </>
            );
        }

        // --- My Team Tab helpers ---
        function getAcquisitionInfo(pid, rosterId) {
            const sameRoster = (a, b) => String(a) === String(b);
            const getAddOwner = (txn, playerId) => txn?.adds ? (txn.adds[playerId] ?? txn.adds[String(playerId)]) : undefined;
            const txnDate = (created) => {
                const raw = Number(created || 0);
                if (!raw) return null;
                return new Date(raw > 1000000000000 ? raw : raw * 1000);
            };
            const fmtDate = (d) => d && !Number.isNaN(d.getTime())
                ? d.toLocaleDateString('en-US', {month:'short', day:'numeric', year: '2-digit'})
                : '\u2014';
            // Check manual override first
            try {
                const overrides = JSON.parse(localStorage.getItem('wr_acquired_overrides') || '{}');
                if (overrides[pid]) return overrides[pid];
            } catch {}

            // Collect ALL transactions from window.S.transactions (all weeks) + recent list
            const allTxns = [];
            const txnMap = window.S?.transactions || {};
            if (typeof txnMap === 'object' && !Array.isArray(txnMap)) {
                Object.values(txnMap).forEach(arr => { if (Array.isArray(arr)) allTxns.push(...arr); });
            }
            // Also include the component-level transactions
            if (transactions?.length) allTxns.push(...transactions);
            // Deduplicate by transaction_id
            const seen = new Set();
            const txns = allTxns.filter(t => {
                const key = t.transaction_id || (t.created + '-' + t.type);
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            }).sort((a, b) => (b.created || 0) - (a.created || 0));

            // Check waiver/FA transactions (most recent first)
            for (const t of txns) {
                const addOwner = getAddOwner(t, pid);
                if ((t.type === 'waiver' || t.type === 'free_agent') && addOwner != null && sameRoster(addOwner, rosterId)) {
                    const cost = t.settings?.waiver_bid || 0;
                    const d = txnDate(t.created);
                    const date = fmtDate(d);
                    return { method: t.type === 'waiver' ? 'Waiver' : 'FA', date, cost: cost > 0 ? '$' + cost : '', season: d ? String(d.getFullYear()) : '', week: t.leg || t.week || 0 };
                }
            }
            // Check trades — search LI trade history
            const trades = window.App?.LI?.tradeHistory || [];
            for (const t of trades) {
                if (!t.sides) continue;
                const side = t.sides[rosterId] || t.sides[String(rosterId)];
                if (side && side.players && side.players.some(p => String(p) === String(pid))) {
                    const season = t.season || '';
                    const week = t.week || '';
                    // Identify partner (other roster on the trade)
                    const partners = (t.roster_ids || Object.keys(t.sides)).filter(r => String(r) !== String(rosterId));
                    const partnerRid = partners[0];
                    // window.S.leagueUsers is the canonical key (set in the hydrate
                    // block above). Using .users used to silently return no match.
                    const users = window.S?.leagueUsers || [];
                    const rosters = window.S?.rosters || [];
                    const partnerRoster = rosters.find(r => String(r.roster_id) === String(partnerRid));
                    const partnerUser = users.find(u => u.user_id === partnerRoster?.owner_id);
                    const partnerName = partnerUser?.display_name || partnerUser?.metadata?.team_name || (partnerRid != null ? 'T' + partnerRid : '');
                    const date = season + (week ? ' W' + week : '');
                    return { method: 'Traded', date, cost: partnerName ? 'from ' + partnerName : '', season, week };
                }
            }
            // Fallback: check raw transaction data for trades
            for (const t of txns) {
                const addOwner = getAddOwner(t, pid);
                if (t.type === 'trade' && addOwner != null && sameRoster(addOwner, rosterId)) {
                    const d = txnDate(t.created);
                    const date = fmtDate(d);
                    return { method: 'Traded', date, cost: '', season: d ? String(d.getFullYear()) : '', week: t.leg || 0 };
                }
            }
            // Check draft outcomes
            const drafts = window.App?.LI?.draftOutcomes || [];
            const draftPick = drafts.find(d => String(d.pid) === String(pid) && sameRoster(d.roster_id, rosterId));
            if (draftPick) {
                // Format as "2024 2.03" when we know the pick slot, else "2024 R2"
                const totalTeams = window.S?.league?.total_rosters || (window.S?.rosters?.length) || 12;
                const slotInRound = draftPick.pick_no != null && totalTeams ? (((draftPick.pick_no - 1) % totalTeams) + 1) : null;
                const slotStr = slotInRound != null ? (draftPick.round + '.' + String(slotInRound).padStart(2, '0')) : ('R' + draftPick.round);
                return { method: 'Drafted', date: draftPick.season + ' ' + slotStr, cost: '', season: draftPick.season, week: 0 };
            }
            // Default: original/keeper
            return { method: 'Original', date: '\u2014', cost: '', season: '', week: 0 };
        }

        const sidebarWidth = sidebarCollapsed ? 72 : 176;
        const iconPaths = {
            home: ['M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1v-8.5Z'],
            roster: ['M12 3l7 3.5v5.2c0 4.5-3 7.5-7 8.3-4-.8-7-3.8-7-8.3V6.5L12 3Z', 'M8.7 12.2l2.1 2.1 4.5-4.7'],
            compare: ['M7 7h10M7 17h10', 'M9 4 6 7l3 3', 'M15 14l3 3-3 3'],
            trade: ['M7 7h11m0 0-3-3m3 3-3 3', 'M17 17H6m0 0 3 3m-3-3 3-3'],
            fa: ['M12 3v18', 'M7 7.5c0-1.8 2-3 5-3 2.8 0 4.8 1.2 4.8 3.4 0 2.4-2.2 3.2-4.8 3.2S7.2 12 7.2 14.4 9.4 18 12.3 18c2.3 0 4.2-.8 5.1-2.2'],
            draft: ['M12 3l8 16H4L12 3Z', 'M12 8v5'],
            analytics: ['M5 19V9', 'M12 19V5', 'M19 19v-7'],
            film: ['M4 7h16v10H4z', 'M8 7l2-3h4l2 3', 'M10 11l4 2-4 2v-4Z'],
            office: ['M4 8h16v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V8Z', 'M9 8V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3', 'M4 12h16', 'M10 14h4'],
            trophy: ['M8 4h8v4a4 4 0 0 1-8 0V4Z', 'M6 5H4v2a3 3 0 0 0 4 2', 'M18 5h2v2a3 3 0 0 1-4 2', 'M12 12v5', 'M8 21h8', 'M9 17h6'],
            calendar: ['M5 5h14v15H5z', 'M8 3v4', 'M16 3v4', 'M5 9h14'],
            strategy: ['M12 3l7 7-7 11-7-11 7-7Z', 'M12 8v5l3 2'],
            settings: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z', 'M12 3v2', 'M12 19v2', 'M3 12h2', 'M19 12h2', 'M5.6 5.6 7 7', 'M17 17l1.4 1.4', 'M18.4 5.6 17 7', 'M7 17l-1.4 1.4'],
            refresh: ['M21 12a9 9 0 0 1-14.8 6.9', 'M3 12A9 9 0 0 1 17.8 5.1', 'M17 3v4h4', 'M7 21v-4H3'],
        };
        const renderNavIcon = (key) => React.createElement('svg', {
            className: 'wr-sidebar-icon',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': 'true',
        }, ...(iconPaths[key] || iconPaths.home).map((d, idx) => React.createElement('path', { key: idx, d })));

        const _seasonCtxValue = { ...seasonCtxData, selectPlayer };

        return (
          <window.App.SeasonContext.Provider value={_seasonCtxValue}>
            <div className="app-container" style={{ paddingBottom: '60px' }}>
                {/* DHQ Loading Bubble */}
                {dhqStatus.loading && (
                    <div style={{
                        position: 'fixed', bottom: '24px', left: '80px', zIndex: 300,
                        background: 'var(--black)', border: '2px solid rgba(212,175,55,0.4)',
                        borderRadius: '16px', padding: '16px 20px', minWidth: '280px',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                        animation: 'fadeSlideUp 0.3s ease'
                    }}>
                        <style>{`@keyframes fadeSlideUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}@keyframes dhqSpin{from{transform:rotate(0)}to{transform:rotate(360deg)}}`}</style>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                            <div style={{
                                width: '20px', height: '20px', border: '2px solid rgba(212,175,55,0.3)',
                                borderTopColor: 'var(--gold)', borderRadius: '50%',
                                animation: 'dhqSpin 0.8s linear infinite'
                            }}></div>
                            <div>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', color: 'var(--gold)', fontWeight: 700, letterSpacing: '0.04em' }}>BUILDING LEAGUE INTELLIGENCE</div>
                                <div style={{ fontSize: '0.78rem', color: 'var(--silver)', marginTop: '2px' }}>{dhqStatus.step}</div>
                            </div>
                        </div>
                        <div style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '4px', height: '4px', overflow: 'hidden' }}>
                            <div style={{
                                width: dhqStatus.progress + '%', height: '100%',
                                background: 'linear-gradient(90deg, var(--gold), #F0A500)',
                                borderRadius: '4px', transition: 'width 0.5s ease'
                            }}></div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginTop: '6px', opacity: 0.6 }}>
                            {dhqStatus.progress < 50 ? 'Analyzing league history, stats, drafts, and transactions. First load takes ~15 seconds, then it\'s cached.' :
                             dhqStatus.progress < 80 ? 'Scoring every player in your league\'s scoring system...' :
                             'Almost done — blending market data and computing trade values.'}
                        </div>
                    </div>
                )}

                {/* Mobile hamburger toggle */}
                <button onClick={() => setSidebarOpen(!sidebarOpen)} style={{
                    display: 'none', position: 'fixed', top: '10px', left: '10px', zIndex: 201,
                    background: 'var(--black)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '6px',
                    padding: '6px 10px', cursor: 'pointer', color: 'var(--gold)', fontSize: '1.2rem', lineHeight: 1
                }} className="wr-hamburger">{sidebarOpen ? '\u2715' : '\u2630'}</button>
                <style>{`@media(max-width:767px){html,body,#root{max-width:100%;overflow-x:hidden}.wr-hamburger{display:block !important}.wr-sidebar{left:-220px !important;transform:none !important}.wr-sidebar.open{left:0 !important}.wr-main-content{margin-left:0 !important;width:100% !important;max-width:100vw;overflow-x:hidden;box-sizing:border-box}}`}</style>

                {/* Mobile overlay */}
                {sidebarOpen && <div onClick={() => setSidebarOpen(false)} style={{ display: 'none', position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 99 }} className="wr-sidebar-overlay" />}
                <style>{`@media(max-width:767px){.wr-sidebar-overlay{display:block !important}}`}</style>

                {/* Left Navigation */}
                <div className={'wr-sidebar' + (sidebarOpen ? ' open' : '') + (sidebarCollapsed ? ' is-collapsed' : '')} style={{
                    position: 'fixed', left: 0, top: 0, bottom: 0, width: sidebarWidth + 'px',
                    background: 'var(--black)', borderRight: '1px solid rgba(212,175,55,0.2)',
                    display: 'flex', flexDirection: 'column',
                    padding: '16px 0', zIndex: 100, transition: 'width 0.18s ease, transform 0.2s ease'
                }}>
                    {/* Logo — click to go home */}
                    <div className="wr-sidebar-brand" onClick={onBack} style={{ padding: '0 14px', marginBottom: sidebarCollapsed ? '10px' : '14px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px' }} title="Back to Dynasty HQ home">
                      <img src="icon-192.png" alt="Dynasty HQ" style={{ width: '28px', height: '28px', borderRadius: '6px' }} onError={e => { e.target.style.display = 'none'; }} />
                      <div className="wr-sidebar-wordmark">
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.06em', lineHeight: 1.1 }}>DYNASTY HQ</div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.5, fontFamily: 'var(--font-body)', letterSpacing: '0.04em' }}>WAR ROOM</div>
                      </div>
                      {(() => {
                        const champs = window.App?.LI?.championships || {};
                        const cnt = Object.values(champs).filter(c => c.champion === myRoster?.roster_id).length;
                        if (cnt > 0) return <span style={{ fontSize: '0.7rem', color: 'var(--gold)' }} title={cnt + 'x Champion'}>{'\uD83C\uDFC6'}</span>;
                        return null;
                      })()}
                    </div>

                    <button
                        className="wr-sidebar-toggle"
                        onClick={() => setSidebarCollapsed(prev => !prev)}
                        title={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        aria-label={sidebarCollapsed ? 'Expand menu' : 'Collapse menu'}
                        style={{ width: sidebarCollapsed ? '34px' : 'calc(100% - 24px)', height: '30px', margin: '0 12px 12px' }}
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {sidebarCollapsed ? <path d="M9 6l6 6-6 6" /> : <path d="M15 6l-6 6 6 6" />}
                        </svg>
                        {!sidebarCollapsed && <span style={{ marginLeft: '8px', fontSize: '0.66rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Hide Menu</span>}
                    </button>

                    {/* Alerts removed — rolled into Brief */}

                    {/* Sidebar Search */}
                    {!sidebarCollapsed && React.createElement(function SidebarSearch() {
                        const [q, setQ] = React.useState('');
                        const [results, setResults] = React.useState([]);
                        const inputRef = React.useRef(null);
                        React.useEffect(() => {
                            if (!q || q.length < 2) { setResults([]); return; }
                            const lower = q.toLowerCase();
                            const matches = [];
                            // Search players
                            Object.entries(playersData || {}).forEach(([pid, p]) => {
                                if (matches.length >= 6) return;
                                const name = p.full_name || '';
                                if (name.toLowerCase().includes(lower)) matches.push({ type: 'player', pid, name, pos: p.position || '?', team: p.team || 'FA' });
                            });
                            // Search tabs
                            [{ label: 'Home', tab: 'dashboard' }, { label: 'My Roster', tab: 'myteam' }, { label: 'Trade Center', tab: 'trades' }, { label: 'Free Agency', tab: 'fa' }, { label: 'Draft Command', tab: 'draft' }, { label: 'Analytics', tab: 'analytics' }, { label: 'GM\'s Office', tab: 'alex' }, { label: 'Trophy Room', tab: 'trophies' }].forEach(t => {
                                if (t.label.toLowerCase().includes(lower)) matches.push({ type: 'tab', label: t.label, tab: t.tab });
                            });
                            setResults(matches.slice(0, 8));
                        }, [q]);
                        return React.createElement('div', { style: { padding: '4px 12px 8px', position: 'relative' } },
                            React.createElement('input', {
                                ref: inputRef, type: 'text', placeholder: 'Search...', value: q,
                                onChange: e => setQ(e.target.value),
                                onKeyDown: e => { if (e.key === 'Escape') { setQ(''); setResults([]); } },
                                style: { width: '100%', padding: '7px 10px 7px 28px', fontSize: '0.72rem', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '6px', color: 'var(--silver)', fontFamily: 'var(--font-body)', outline: 'none', boxSizing: 'border-box' }
                            }),
                            React.createElement('svg', { viewBox: '0 0 24 24', width: 12, height: 12, fill: 'none', stroke: 'rgba(212,175,55,0.4)', strokeWidth: 2, style: { position: 'absolute', left: '20px', top: '11px', pointerEvents: 'none' } },
                                React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
                                React.createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
                            ),
                            results.length > 0 && React.createElement('div', { style: { position: 'absolute', left: '12px', right: '12px', top: '100%', background: '#0d0d0d', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '0 0 8px 8px', zIndex: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: '240px', overflowY: 'auto' } },
                                results.map((r, i) => React.createElement('div', {
                                    key: i,
                                    onClick: () => {
                                        if (r.type === 'player') { setSidebarOpen(false); selectPlayer(r.pid); }
                                        else if (r.type === 'tab') { setSidebarOpen(false); setActiveTab(r.tab); }
                                        setQ(''); setResults([]);
                                    },
                                    style: { padding: '6px 10px', cursor: 'pointer', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: '6px', borderBottom: '1px solid rgba(255,255,255,0.04)' },
                                    onMouseEnter: e => e.currentTarget.style.background = 'rgba(212,175,55,0.08)',
                                    onMouseLeave: e => e.currentTarget.style.background = 'transparent',
                                },
                                    r.type === 'player'
                                        ? [
                                            React.createElement('span', { key: 'n', style: { color: 'var(--white)', fontWeight: 500, flex: 1 } }, r.name),
                                            React.createElement('span', { key: 'p', style: { fontSize: '0.6rem', color: window.App?.POS_COLORS?.[window.App.normPos(r.pos)] || 'var(--silver)', fontWeight: 700 } }, window.App.normPos(r.pos)),
                                        ]
                                        : React.createElement('span', { style: { color: 'var(--gold)', fontWeight: 600 } }, '\u2192 ' + r.label)
                                ))
                            )
                        );
                    })}

                    {/* Nav items — grouped: FRONT OFFICE / LEAGUE / DOSSIER / SETTINGS. */}
                    {[
                        { section: 'FRONT OFFICE' },
                        { label: 'Home', tab: 'dashboard', iconKey: 'home' },
                        { label: 'My Roster', tab: 'myteam', iconKey: 'roster' },
                        { label: 'Compare', tab: 'compare', iconKey: 'compare' },
                        { section: 'LEAGUE' },
                        { label: 'Trade Center', tab: 'trades', iconKey: 'trade' },
                        { label: 'Free Agency', tab: 'fa', iconKey: 'fa' },
                        { label: 'Draft', tab: 'draft', iconKey: 'draft' },
                        { label: 'Analytics', tab: 'analytics', iconKey: 'analytics' },
                        { section: 'DOSSIER' },
                        { label: 'GM\'s Office', tab: 'alex', iconKey: 'office' },
                        { label: 'Trophy Room', tab: 'trophies', iconKey: 'trophy' },
                        { label: 'Calendar', tab: 'calendar', iconKey: 'calendar' },
                        { section: 'SETTINGS' },
                        { label: 'Settings', action: () => onOpenSettings && onOpenSettings(), iconKey: 'settings' },
                    ].map((item, i) => {
                        if (item.section) {
                            // Hairline divider only — section labels removed for a
                            // cleaner list. The grouping rhythm still reads via the
                            // thin rule between clusters. First section renders no
                            // top rule since there's nothing above it in the nav.
                            if (i === 0) return null;
                            return (
                                <div key={i} className="wr-sidebar-divider" style={{ height: '1px', margin: '8px 16px', background: 'rgba(255,255,255,0.06)' }} aria-hidden="true" />
                            );
                        }
                        const isActive = item.tab && (activeTab === item.tab || (item.tab === 'alex' && activeTab === 'strategy'));
                        return (
                        <button key={i} onClick={() => { setSidebarOpen(false); item.tab ? setActiveTab(item.tab) : item.action ? item.action() : window.location.href = item.url; }}
                            className="wr-sidebar-nav-btn"
                            style={{
                                width: '100%', padding: sidebarCollapsed ? '10px 0' : '9px 16px 9px 20px', border: 'none',
                                background: isActive ? 'rgba(212,175,55,0.12)' : 'transparent',
                                borderLeft: isActive ? '3px solid var(--gold)' : '3px solid transparent',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'flex-start', gap: '9px',
                                transition: 'all 0.15s',
                                color: isActive ? 'var(--gold)' : 'var(--silver)',
                                fontSize: '0.78rem', fontFamily: 'var(--font-body)',
                                fontWeight: isActive ? 700 : 400,
                                letterSpacing: '0.03em', textAlign: 'left',
                                position: 'relative',
                            }}
                            onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'rgba(212,175,55,0.06)'; }}
                            onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
                        >
                            {sidebarCollapsed && renderNavIcon(item.iconKey)}
                            {!sidebarCollapsed && <span className="wr-sidebar-label" style={{ flex: 1 }}>{item.label}</span>}
                            {item.isNew && <span className="wr-sidebar-new-badge" style={{
                                fontSize: '0.48rem', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
                                padding: '1px 5px', borderRadius: '3px',
                                background: 'rgba(46,204,113,0.2)', color: '#2ECC71',
                                letterSpacing: '0.08em',
                            }}>NEW</span>}
                        </button>
                        );
                    })}

                    {/* Spacer */}
                    <div style={{ flex: 1 }}></div>

                    {/* Sync Status */}
                    <div className="wr-sidebar-extra" style={{ fontSize: '0.76rem', color: window.App?.LI_LOADED ? '#2ECC71' : 'var(--silver)', textAlign: 'center', fontFamily: 'var(--font-body)', opacity: 0.7, marginBottom: '4px' }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: window.App?.LI_LOADED ? '#2ECC71' : 'var(--silver)', margin: '0 auto 2px' }}></div>
                        {window.App?.LI_LOADED ? 'Synced' : 'Loading'}
                    </div>

                    {/* Legend / Guide */}
                    {!sidebarCollapsed && React.createElement(LegendPanel)}

                    {/* Refresh Button */}
                    <button onClick={async () => {
                        try {
                            localStorage.removeItem('dhq_leagueintel_v9');
                            localStorage.removeItem('dhq_leagueintel_v10');
                            Object.keys(localStorage).filter(k => k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                            try { sessionStorage.removeItem('fw_players_cache'); } catch(e) { window.wrLog('refresh.sessionClear', e); }
                            window._wrPlayersCache = null;
                            if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; window._liLoading = false; }
                        } catch(e) { window.wrLog('refresh.cleanup', e); }
                        await loadLeagueDetails();
                    }} style={{
                        width: '100%', padding: '10px 16px', border: 'none',
                        background: 'transparent', cursor: 'pointer', display: 'flex',
                        alignItems: 'center', transition: 'all 0.15s', color: 'var(--gold)',
                        fontSize: '0.78rem', fontFamily: 'var(--font-body)',
                        letterSpacing: '0.03em', textAlign: 'left', marginBottom: '8px'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.06)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    title="Reload DHQ values, league history, and AI data"
                    >
                        {sidebarCollapsed ? renderNavIcon('refresh') : 'Refresh Data'}
                    </button>
                </div>

                {/* Main content shifted right */}
                <div className="wr-main-content" style={{ marginLeft: sidebarWidth + 'px', width: 'calc(100% - ' + sidebarWidth + 'px)' }}>
                {/* Header — collapsed into a single left-aligned strip.
                    Removed: redundant "{year} SEASON" subtitle (year picker below handles this)
                    and the duplicate league-name/team-count in the time context bar. */}
                <header className="header" style={{ position: 'relative', marginBottom: '0', paddingTop: '0.6rem', paddingBottom: '0.6rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '10px' }}>
                        <div className="header-title" style={{ fontSize: '1.05rem' }}>{currentLeague.name}</div>
                        <button onClick={onBack} style={{ padding: '4px 12px', fontSize: '0.66rem', fontFamily: 'var(--font-body)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', background: 'rgba(212,175,55,0.10)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>SWITCH</button>
                        {(() => {
                            const gm = window.WR?.GmMode?.describe?.(gmStrategy?.mode || 'compete');
                            if (!gm) return null;
                            return React.createElement('button', {
                                key: 'gm-badge-' + gm.id,
                                onClick: () => setActiveTab && setActiveTab('strategy'),
                                title: 'GM Mode — edit in GM\'s Office',
                                style: {
                                    padding: '4px 10px 4px 8px', display: 'inline-flex', alignItems: 'center', gap: '6px',
                                    fontSize: '0.66rem', fontFamily: 'var(--font-body)', fontWeight: 700,
                                    textTransform: 'uppercase', letterSpacing: '0.06em',
                                    background: gm.badgeColor + '22', color: gm.badgeColor,
                                    border: '1px solid ' + gm.badgeColor + '66',
                                    borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap'
                                }
                            },
                                React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: gm.badgeColor } }),
                                'GM · ' + gm.label
                            );
                        })()}
                    </div>
                </header>

                {/* Load stage progress indicator */}
                {loadStage && (
                    <div style={{
                        padding: '6px 16px', background: 'rgba(212,175,55,0.06)',
                        borderBottom: '1px solid rgba(212,175,55,0.1)',
                        fontSize: '0.78rem', color: 'var(--gold)', fontFamily: 'var(--font-body)',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}>
                        <div style={{ width: '12px', height: '12px', border: '2px solid rgba(212,175,55,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'dhqSpin 0.8s linear infinite' }}></div>
                        {loadStage}
                    </div>
                )}

                {/* ── GLOBAL TIME CONTEXT BAR ── */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '8px clamp(12px, 4vw, 24px)', flexWrap: 'wrap',
                    background: 'rgba(0,0,0,0.4)', borderBottom: '1px solid rgba(212,175,55,0.12)',
                    position: 'sticky', top: 0, zIndex: 50
                }}>
                    {/* Year pills */}
                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', minWidth: 0 }}>
                        {timeYears.map(yr =>
                            <button key={yr} onClick={() => handleTimeYearChange(yr)} style={{
                                padding: '4px 10px', fontSize: '0.76rem', fontFamily: 'var(--font-body)',
                                fontWeight: timeYear === yr ? 700 : 400,
                                background: timeYear === yr ? 'var(--gold)' : 'rgba(255,255,255,0.03)',
                                color: timeYear === yr ? 'var(--black)' : 'var(--silver)',
                                border: timeYear === yr ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.06)',
                                borderRadius: '4px', cursor: 'pointer', transition: 'all 0.15s'
                            }}>{yr}</button>
                        )}
                    </div>
                    {/* League name/team-count moved to the main header to avoid duplication. */}
                    <div style={{ marginLeft: 'auto' }}></div>
                    {/* Time mode badge */}
                    <span style={{
                        fontSize: '0.72rem', fontWeight: 700, color: timeModeColor,
                        background: timeModeColor + '15', border: '1px solid ' + timeModeColor + '30',
                        padding: '2px 10px', borderRadius: '12px',
                        fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em'
                    }}>{timeModeLabel}</span>
                    {/* Loading indicator */}
                    {timeLoading && <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <div style={{ width: '10px', height: '10px', border: '2px solid rgba(212,175,55,0.3)', borderTopColor: 'var(--gold)', borderRadius: '50%', animation: 'dhqSpin 0.8s linear infinite' }} />
                        <span style={{ fontSize: '0.72rem', color: 'var(--gold)' }}>Recomputing...</span>
                    </div>}
                </div>

                {/* Time mode banner — visible when not viewing current season */}
                {!isCurrentYear && <div style={{
                    padding: '8px 24px', display: 'flex', alignItems: 'center', gap: '8px',
                    background: timeModeColor + '10', borderBottom: '1px solid ' + timeModeColor + '30'
                }}>
                    <span style={{ fontSize: '0.82rem', color: timeModeColor, fontWeight: 700, fontFamily: 'var(--font-body)' }}>
                        {isFutureYear ? 'FUTURE PROJECTION' : 'HISTORICAL VIEW'}: {timeYear}
                    </span>
                    <span style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.6 }}>
                        {isFutureYear ? 'Player ages projected +' + timeDelta + 'yr. Values and stats are estimates.' : 'Showing ' + timeYear + ' season stats. Roster composition reflects current state.'}
                    </span>
                    <button onClick={() => handleTimeYearChange(currentSeason)} style={{ marginLeft: 'auto', fontSize: '0.74rem', padding: '3px 10px', background: 'transparent', border: '1px solid ' + timeModeColor, color: timeModeColor, borderRadius: '4px', cursor: 'pointer', fontFamily: 'var(--font-body)' }}>Back to {currentSeason}</button>
                </div>}

                {/* Debug panel (dev only) */}
                {DEV_DEBUG && <div style={{ padding: '4px 24px', background: 'rgba(255,0,0,0.04)', borderBottom: '1px solid rgba(255,0,0,0.1)', fontSize: '0.7rem', fontFamily: 'monospace', color: '#F0A500' }}>
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '2px' }}>
                        <span>year={timeYear}</span>
                        <span>mode={timeMode}</span>
                        <span>tab={activeTab}</span>
                        <span>delta={timeDelta}</span>
                        <span>recompute={new Date(timeRecomputeTs).toLocaleTimeString()}</span>
                        <span>stats={Object.keys(statsData).length}</span>
                        <span>projected={window.App?.LI?._projectedYear || 'none'}</span>
                    </div>
                    {isFutureYear && window.App?.LI?.playerScores && (() => {
                        const scores = window.App.LI.playerScores;
                        const backup = window.App.LI._baseScoresBackup || {};
                        const samples = Object.entries(scores).filter(([,v]) => v > 2000).sort((a,b) => b[1] - a[1]).slice(0, 4);
                        return <div style={{ display: 'flex', gap: '12px', fontSize: '0.65rem', color: '#3498DB' }}>
                            {samples.map(([pid, projDhq]) => {
                                const baseDhq = backup[pid] || projDhq;
                                const p = playersData[pid];
                                const diff = projDhq - baseDhq;
                                return <span key={pid}>{p?.full_name?.split(' ').pop() || pid}: {baseDhq}→{projDhq} ({diff >= 0 ? '+' : ''}{diff})</span>;
                            })}
                        </div>;
                    })()}
                </div>}

                {/* Tab Content Routing — Brief tab folded into Dashboard as widgets */}
                <div className="wr-content-frame">
                {activeTab === 'trades' ? (
                    <TradeCalcTab
                        playersData={playersData}
                        statsData={statsData}
                        myRoster={myRoster}
                        standings={standings}
                        currentLeague={currentLeague}
                        sleeperUserId={sleeperUserId}
                        timeRecomputeTs={timeRecomputeTs}
                        viewMode={viewMode}
                        initialSubTab={tradeSubTab}
                        onSubTabConsumed={() => setTradeSubTab(null)}
                    />
                ) : activeTab === 'myteam' ? <MyTeamTab
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    standings={standings}
                    sleeperUserId={sleeperUserId}
                    rosterFilter={rosterFilter}
                    setRosterFilter={setRosterFilter}
                    rosterSort={rosterSort}
                    setRosterSort={setRosterSort}
                    visibleCols={visibleCols}
                    setVisibleCols={setVisibleCols}
                    expandedPid={expandedPid}
                    setExpandedPid={setExpandedPid}
                    showColPicker={showColPicker}
                    setShowColPicker={setShowColPicker}
                    colPreset={colPreset}
                    setColPreset={setColPreset}
                    gmStrategy={gmStrategy}
                    setGmStrategy={setGmStrategy}
                    gmStrategyOpen={gmStrategyOpen}
                    setGmStrategyOpen={setGmStrategyOpen}
                    setAlexAvatar={setAlexAvatar}
                    setAvatarKey={setAvatarKey}
                    setActiveTab={setActiveTab}
                    setReconPanelOpen={setReconPanelOpen}
                    sendReconMessage={sendReconMessage}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : activeTab === 'league' ? <LeagueMapTab
                    leagueViewTab={leagueViewTab}
                    setLeagueViewTab={setLeagueViewTab}
                    leagueSelectedTeam={leagueSelectedTeam}
                    setLeagueSelectedTeam={setLeagueSelectedTeam}
                    leagueSort={leagueSort}
                    setLeagueSort={setLeagueSort}
                    leagueSubView={leagueSubView}
                    setLeagueSubView={setLeagueSubView}
                    leagueViewMode={leagueViewMode}
                    setLeagueViewMode={setLeagueViewMode}
                    lpSort={lpSort}
                    setLpSort={setLpSort}
                    lpFilter={lpFilter}
                    setLpFilter={setLpFilter}
                    standings={standings}
                    currentLeague={currentLeague}
                    playersData={playersData}
                    statsData={statsData}
                    sleeperUserId={sleeperUserId}
                    myRoster={myRoster}
                    activeYear={activeYear}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : activeTab === 'analytics' ? <AnalyticsPanel
                    analyticsData={analyticsData}
                    analyticsTab={analyticsTab}
                    setAnalyticsTab={setAnalyticsTab}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    standings={standings}
                    playersData={playersData}
                    statsData={statsData}
                    stats2025Data={stats2025Data}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    setTimeRecomputeTs={setTimeRecomputeTs}
                    activeYear={activeYear}
                    setActiveTab={setActiveTab}
                    viewingOwnerId={viewingOwnerId}
                    setViewingOwnerId={setViewingOwnerId}
                    timeDelta={timeDelta}
                    timeYear={timeYear}
                    setTradeSubTab={setTradeSubTab}
                    getOwnerName={getOwnerName}
                    getAcquisitionInfo={getAcquisitionInfo}
                /> : activeTab === 'fa' ? <FreeAgencyTab
                    playersData={playersData}
                    statsData={statsData}
                    prevStatsData={stats2025Data}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    sleeperUserId={sleeperUserId}
                    timeRecomputeTs={timeRecomputeTs}
                    viewMode={viewMode}
                    briefDraftInfo={briefDraftInfo}
                /> : activeTab === 'draft' ? <DraftTab
                    playersData={playersData}
                    statsData={statsData}
                    myRoster={myRoster}
                    currentLeague={currentLeague}
                    sleeperUserId={sleeperUserId}
                    setReconPanelOpen={setReconPanelOpen}
                    sendReconMessage={sendReconMessage}
                    timeRecomputeTs={timeRecomputeTs}
                    viewMode={viewMode}
                /> : activeTab === 'trophies' ? <TrophyRoomTab
                    currentLeague={currentLeague}
                    playersData={playersData}
                    myRoster={myRoster}
                    sleeperUserId={sleeperUserId}
                /> : activeTab === 'calendar' ? <CalendarTab
                    currentLeague={currentLeague}
                    myRoster={myRoster}
                /> : (activeTab === 'alex' || activeTab === 'strategy') ? (typeof window.AlexInsightsTab === 'function' ? React.createElement(window.AlexInsightsTab, {
                    currentLeague, myRoster, playersData, statsData,
                    stats2025Data, standings, sleeperUserId,
                    timeRecomputeTs, setActiveTab,
                    gmStrategy, setGmStrategy,
                    // Old tab=strategy URLs land on the Strategy sub-view inside GM's Office.
                    initialSubTab: activeTab === 'strategy' ? 'strategy' : null,
                }) : <div style={{ padding: '40px', textAlign: 'center', color: 'var(--silver)' }}>GM's Office module not loaded.</div>
                ) : activeTab === 'compare' ? (typeof window.CompareTab === 'function' ? React.createElement(window.CompareTab, {
                    currentLeague, myRoster, playersData, statsData, stats2025Data,
                    standings, sleeperUserId,
                }) : <div style={{ padding: '40px', textAlign: 'center', color: 'var(--silver)' }}>Compare module not loaded.</div>
                ) : (
                <DashboardPanel
                    selectedWidgets={selectedWidgets}
                    setSelectedWidgets={setSelectedWidgets}
                    editingKpi={editingKpi}
                    setEditingKpi={setEditingKpi}
                    computeKpiValue={computeKpiValue}
                    KPI_OPTIONS={KPI_OPTIONS}
                    rankedTeams={rankedTeams}
                    sleeperUserId={sleeperUserId}
                    setActiveTab={setActiveTab}
                    transactions={transactions}
                    standings={standings}
                    currentLeague={currentLeague}
                    playersData={playersData}
                    myRoster={myRoster}
                    getOwnerName={getOwnerName}
                    getPlayerName={getPlayerName}
                    timeAgo={timeAgo}
                    briefDraftInfo={briefDraftInfo}
                />
                )}
                </div>
                </div>{/* end marginLeft wrapper */}

            {selectedPlayerPid && typeof window.openFWPlayerModal !== 'function' && <PlayerInlineCard
                pid={selectedPlayerPid}
                playersData={playersData}
                statsData={statsData}
                onClose={() => setSelectedPlayerPid(null)}
                onFullProfile={() => {
                  try {
                    if (typeof window.openFWPlayerModal === 'function') {
                      const sc = currentLeague?.scoring_settings || {};
                      window.openFWPlayerModal(selectedPlayerPid, playersData, statsData, sc);
                    } else {
                      console.warn('[War Room] openFWPlayerModal not loaded');
                    }
                  } catch(e) { console.error('[War Room] Player modal error:', e); }
                }}
            />}

            {/* Alex Ingram Chat — centered welcome or bottom-right */}
            {reconPanelOpen && <div style={welcomeMode ? {
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: '480px', maxHeight: '600px',
              background: '#0a0b0d', border: '2px solid rgba(212,175,55,0.4)',
              borderRadius: '20px', zIndex: 300,
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 24px 80px rgba(0,0,0,0.8), 0 0 0 1px rgba(212,175,55,0.15), 0 0 120px rgba(212,175,55,0.06)',
              animation: 'wrFadeIn 0.3s ease'
            } : {
              position: 'fixed', bottom: '80px', right: '24px',
              width: '380px', maxHeight: '520px',
              background: '#0a0b0d', border: '2px solid rgba(212,175,55,0.3)',
              borderRadius: '16px', zIndex: 200,
              display: 'flex', flexDirection: 'column',
              boxShadow: '0 12px 48px rgba(0,0,0,0.6), 0 0 0 1px rgba(212,175,55,0.1)',
              animation: 'wrFadeIn 0.2s ease'
            }}>
            {/* Welcome backdrop */}
            {welcomeMode && <div onClick={() => { setWelcomeMode(false); setReconPanelOpen(false); setTimeout(() => { setShowCornerToast(true); setTimeout(() => setShowCornerToast(false), 4000); }, 300); }} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)', zIndex: -1 }} />}
              {/* Header */}
              <div style={{
                padding: '12px 16px', borderBottom: '1px solid rgba(212,175,55,0.2)',
                display: 'flex', alignItems: 'center', gap: '8px',
                background: 'rgba(212,175,55,0.06)', borderRadius: '14px 14px 0 0'
              }}>
                <div key={avatarKey} onClick={e => { e.stopPropagation(); setShowAvatarPicker(p => !p); }} style={{ cursor: 'pointer' }} title="Change Alex's avatar">
                  <AlexAvatar size={30} />
                </div>
                <div>
                  <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', color: 'var(--gold)', letterSpacing: '0.04em', lineHeight: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>{(() => { const k = localStorage.getItem('wr_alex_avatar') || 'brain'; const m = { brain:'\u{1F9E0}', target:'\u{1F3AF}', chart:'\u{1F4CA}', football:'\u{1F3C8}', bolt:'\u26A1', fire:'\u{1F525}', medal:'\u{1F396}\uFE0F', trophy:'\u{1F3C6}' }; return m[k] || ''; })()}Alex Ingram</div>
                  <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.5 }}>AI General Manager</div>
                </div>
                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Cmd+K</span>
                <span style={{ flex: 1 }}></span>
                {reconMessages.length > 1 && (
                  <button onClick={() => {
                    setReconMessages([{ role: 'assistant', content: 'Fresh start. What\'s on your mind? — Alex' }]);
                    setGmOnboardStep(5);
                    LeagueStorage.remove(LEAGUE_WR_KEYS.CHAT(currentLeague?.league_id));
                  }} title="Clear chat history" style={{
                    background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                    fontSize: '0.62rem', padding: '2px 4px', fontFamily: 'var(--font-body)', letterSpacing: '0.04em'
                  }}>CLEAR</button>
                )}
                <button onClick={() => setReconPanelOpen(false)} style={{
                  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
                  fontSize: '1rem', padding: '2px'
                }}>&#10005;</button>
              </div>

              {/* Avatar picker (toggled) */}
              {showAvatarPicker && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(212,175,55,0.04)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '6px', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Choose Alex's look</div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {ALEX_AVATARS.map(av => (
                      <button key={av.id} onClick={() => { setAlexAvatar(av.id); setShowAvatarPicker(false); setAvatarKey(k => k+1); }} style={{
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px',
                        padding: '6px', background: getAlexAvatar() === av.id ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.03)',
                        border: '1px solid ' + (getAlexAvatar() === av.id ? 'var(--gold)' : 'rgba(255,255,255,0.08)'),
                        borderRadius: '8px', cursor: 'pointer', minWidth: '56px'
                      }}>
                        {av.src ? (
                          <img src={av.src} alt={av.label} style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '36px', height: '36px', borderRadius: '6px', background: 'linear-gradient(135deg, #D4AF37, #B8941E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.72rem', fontWeight: 800, color: '#0A0A0A', fontFamily: 'Rajdhani, sans-serif' }}>AI</div>
                        )}
                        <span style={{ fontSize: '0.58rem', color: 'var(--silver)', textAlign: 'center' }}>{av.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Context chips */}
              <div style={{ padding: '6px 12px', display: 'flex', gap: '4px', flexWrap: 'wrap', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                {getReconChips().map((chip, i) => (
                  <button key={i} onClick={() => sendReconMessage(chip.prompt)}
                    style={{
                      padding: '3px 8px', fontSize: '0.72rem', borderRadius: '14px',
                      border: '1px solid rgba(212,175,55,0.25)', background: 'rgba(212,175,55,0.06)',
                      color: 'var(--gold)', cursor: 'pointer', fontFamily: 'inherit'
                    }}>
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* Messages */}
              <div style={{
                flex: 1, overflow: 'auto', padding: '10px 12px',
                display: 'flex', flexDirection: 'column', gap: '6px',
                maxHeight: '320px'
              }}>
                {reconMessages.map((msg, i) => (
                  msg.role === 'user' ? (
                    <div key={i} style={{
                      alignSelf: 'flex-end', maxWidth: '85%', padding: '8px 12px', borderRadius: '12px',
                      fontSize: '0.78rem', lineHeight: 1.4,
                      background: 'rgba(124,107,248,0.12)', border: '1px solid rgba(124,107,248,0.18)',
                      color: 'var(--text-primary)'
                    }} dangerouslySetInnerHTML={{ __html: markdownToHtml(msg.content) }} />
                  ) : (
                    <div key={i} style={{
                      alignSelf: 'flex-start', maxWidth: '90%', padding: '8px 10px',
                      background: 'rgba(212,175,55,0.04)', borderLeft: '3px solid rgba(212,175,55,0.4)',
                      borderRadius: '0 10px 10px 0'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                        <AlexAvatar size={20} />
                        <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.72rem', color: 'var(--gold)', letterSpacing: '0.03em' }}>Alex Ingram</span>
                      </div>
                      {(() => {
                        const tradeMatch = msg.content.match(/<!--\s*TRADE_CARD:([\s\S]*?)-->/);
                        const textContent = msg.content.replace(/<!--\s*TRADE_CARD:[\s\S]*?-->/, '').trim();
                        let tradeCard = null;
                        if (tradeMatch) {
                          try { tradeCard = JSON.parse(tradeMatch[1].trim()); } catch {}
                        }
                        return (
                          <React.Fragment>
                            <div style={{ fontSize: '0.78rem', lineHeight: 1.4, color: 'var(--text-primary)' }}
                              dangerouslySetInnerHTML={{ __html: markdownToHtml(textContent) }} />
                            {tradeCard && (
                              <div style={{ marginTop: '10px', background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '10px', padding: '10px', fontSize: '0.76rem' }}>
                                <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>
                                  Proposed Trade{tradeCard.target ? ' → ' + tradeCard.target : ''}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'start' }}>
                                  <div>
                                    <div style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>You Give</div>
                                    {(tradeCard.yourSide || []).map((a, j) => (
                                      <div key={j} style={{ padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                                        <span style={{ color: 'var(--silver)', fontSize: '0.68rem', marginLeft: '4px' }}>{a.dhq?.toLocaleString()} DHQ</span>
                                      </div>
                                    ))}
                                    <div style={{ marginTop: '4px', fontWeight: 700, color: 'var(--gold)', fontSize: '0.72rem' }}>
                                      Total: {(tradeCard.yourSide || []).reduce((s, a) => s + (a.dhq || 0), 0).toLocaleString()}
                                    </div>
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', fontSize: '1.2rem', color: 'var(--gold)', paddingTop: '16px' }}>{'\u21C4'}</div>
                                  <div>
                                    <div style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px', fontFamily: 'var(--font-body)', textTransform: 'uppercase' }}>You Get</div>
                                    {(tradeCard.theirSide || []).map((a, j) => (
                                      <div key={j} style={{ padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                        <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                                        <span style={{ color: 'var(--silver)', fontSize: '0.68rem', marginLeft: '4px' }}>{a.dhq?.toLocaleString()} DHQ</span>
                                      </div>
                                    ))}
                                    <div style={{ marginTop: '4px', fontWeight: 700, color: 'var(--gold)', fontSize: '0.72rem' }}>
                                      Total: {(tradeCard.theirSide || []).reduce((s, a) => s + (a.dhq || 0), 0).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                                {/* Fairness bar */}
                                {(() => {
                                  const yours = (tradeCard.yourSide || []).reduce((s, a) => s + (a.dhq || 0), 0);
                                  const theirs = (tradeCard.theirSide || []).reduce((s, a) => s + (a.dhq || 0), 0);
                                  const diff = theirs - yours;
                                  const pct = yours > 0 ? Math.round((diff / yours) * 100) : 0;
                                  const color = pct >= 5 ? '#2ECC71' : pct >= -5 ? 'var(--gold)' : '#E74C3C';
                                  const label = pct >= 5 ? 'You win by ' + pct + '%' : pct >= -5 ? 'Fair trade' : 'You lose by ' + Math.abs(pct) + '%';
                                  return (
                                    <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}>
                                        <div style={{ width: Math.min(100, 50 + pct) + '%', height: '100%', background: color, borderRadius: '2px' }} />
                                      </div>
                                      <span style={{ fontSize: '0.68rem', color, fontFamily: 'var(--font-body)' }}>{label}</span>
                                    </div>
                                  );
                                })()}
                                {/* Action buttons */}
                                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                                  {tradeCard.sleeperDM && (
                                    <button onClick={() => { navigator.clipboard.writeText(tradeCard.sleeperDM); }} style={{
                                      padding: '5px 12px', fontSize: '0.7rem', fontFamily: 'var(--font-body)',
                                      background: 'linear-gradient(135deg, #7c6bf8, #9b8afb)', color: '#fff',
                                      border: 'none', borderRadius: '14px', cursor: 'pointer'
                                    }}>Copy DM</button>
                                  )}
                                  <button onClick={() => {
                                    const saved = LeagueStorage.get(LEAGUE_WR_KEYS.SAVED_TRADES(currentLeague?.league_id)) || [];
                                    saved.push({ ...tradeCard, savedAt: Date.now() });
                                    LeagueStorage.set(LEAGUE_WR_KEYS.SAVED_TRADES(currentLeague?.league_id), saved.slice(-20));
                                  }} style={{
                                    padding: '5px 12px', fontSize: '0.7rem', fontFamily: 'var(--font-body)',
                                    background: 'rgba(212,175,55,0.08)', color: 'var(--gold)',
                                    border: '1px solid rgba(212,175,55,0.2)', borderRadius: '14px', cursor: 'pointer'
                                  }}>Save</button>
                                </div>
                              </div>
                            )}
                          </React.Fragment>
                        );
                      })()}
                      {/* Onboarding choice buttons */}
                      {msg.onboardChoices && (
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '8px' }}>
                          {msg.onboardChoices.map(c => {
                            const isSelected = msg.onboardMulti && onboardSelections.includes(c.value);
                            return (
                              <button key={c.value} onClick={() => {
                                if (msg.onboardMulti) {
                                  setOnboardSelections(prev => prev.includes(c.value) ? prev.filter(v => v !== c.value) : [...prev, c.value]);
                                } else if (gmOnboardStep === 0 && ['strategy','advice','avatar'].includes(c.value)) {
                                  handleWelcomeChoice(c.value);
                                } else {
                                  handleOnboardChoice(c.value);
                                }
                              }} style={{
                                padding: '6px 14px', fontSize: '0.76rem', fontFamily: 'var(--font-body)',
                                background: isSelected ? 'var(--gold)' : 'rgba(212,175,55,0.08)',
                                color: isSelected ? 'var(--black)' : 'var(--gold)',
                                border: '1px solid rgba(212,175,55,0.3)',
                                borderRadius: '16px', cursor: 'pointer', transition: 'all 0.15s'
                              }}>{c.label}{isSelected ? ' \u2713' : ''}</button>
                            );
                          })}
                          {msg.onboardMulti && (
                            <React.Fragment>
                              {onboardSelections.length > 0 && (
                                <button onClick={() => { handleOnboardChoice(onboardSelections); setOnboardSelections([]); }} style={{
                                  padding: '6px 14px', fontSize: '0.76rem', fontFamily: 'var(--font-body)',
                                  background: 'linear-gradient(135deg, #2ECC71, #27AE60)', color: '#fff',
                                  border: 'none', borderRadius: '16px', cursor: 'pointer'
                                }}>Confirm ({onboardSelections.length})</button>
                              )}
                              {msg.onboardSkip && (
                                <button onClick={() => { handleOnboardChoice('skip'); setOnboardSelections([]); }} style={{
                                  padding: '6px 14px', fontSize: '0.76rem', fontFamily: 'var(--font-body)',
                                  background: 'rgba(255,255,255,0.04)', color: 'var(--silver)',
                                  border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', cursor: 'pointer'
                                }}>Skip</button>
                              )}
                            </React.Fragment>
                          )}
                        </div>
                      )}
                    </div>
                  )
                ))}
              </div>

              {/* Input */}
              <div style={{
                padding: '10px 12px', borderTop: '1px solid rgba(255,255,255,0.07)',
                display: 'flex', gap: '8px', background: '#111318', borderRadius: '0 0 14px 14px'
              }}>
                <input
                  value={reconInput}
                  onChange={e => setReconInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendReconMessage(reconInput); }}
                  placeholder="Ask anything..."
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    color: 'var(--text-primary)', fontSize: '0.82rem', fontFamily: 'inherit'
                  }}
                />
                <button onClick={() => sendReconMessage(reconInput)} style={{
                  background: 'linear-gradient(135deg, #7c6bf8, #9b8afb)',
                  border: 'none', borderRadius: '8px', width: '32px', height: '32px',
                  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="2.5">
                    <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
                  </svg>
                </button>
              </div>
            </div>}

            {/* "I'll be down here" toast */}
            {showCornerToast && (
              <div style={{
                position: 'fixed', bottom: '82px', right: '24px',
                background: '#0a0b0d', border: '1px solid rgba(212,175,55,0.3)',
                borderRadius: '12px', padding: '10px 16px', zIndex: 202,
                boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                animation: 'wrFadeIn 0.3s ease', maxWidth: '220px'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <AlexAvatar size={22} />
                  <span style={{ fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.4 }}>I'll be down here if you need me {'\uD83D\uDC47'}</span>
                </div>
              </div>
            )}

            {/* Alex Ingram Bubble Button — bottom right corner */}
            <button onClick={() => { setReconPanelOpen(!reconPanelOpen); setWelcomeMode(false); }} style={{
              position: 'fixed', bottom: '24px', right: '24px',
              width: '52px', height: '52px', borderRadius: '14px',
              background: reconPanelOpen ? 'rgba(212,175,55,0.15)' : 'transparent',
              border: '2px solid rgba(212,175,55,0.4)',
              cursor: 'pointer', zIndex: 201,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 20px rgba(212,175,55,0.3)',
              transition: 'all 0.2s', overflow: 'hidden', padding: 0
            }}>
              {reconPanelOpen
                ? <span style={{ color: 'var(--gold)', fontSize: '1.2rem' }}>&#10005;</span>
                : <AlexAvatar size={48} />
              }
            </button>

            </div>
          </window.App.SeasonContext.Provider>
        );
    }
    window.LeagueDetail = LeagueDetail;

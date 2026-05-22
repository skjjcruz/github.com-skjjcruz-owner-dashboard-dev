// ══════════════════════════════════════════════════════════════════
// app.js — OwnerDashboard (root component) + ReactDOM.render
// Must load LAST — depends on all other modules.
// ══════════════════════════════════════════════════════════════════
    const APP_WR_KEYS  = window.App.WR_KEYS;
    const AppStorage = window.App.WrStorage;
    const WR_HOST = window.location.hostname || '';
    const PLATFORM_SANDBOX_ACCESS = WR_HOST.includes('sandbox') || ['localhost', '127.0.0.1'].includes(WR_HOST);
    const MFL_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    function platformAccessAllowed(platform) {
        platform = platform || 'sleeper';
        return platform === 'sleeper' || PLATFORM_SANDBOX_ACCESS;
    }
    function platformBetaMessage(platform) {
        const labels = { espn: 'ESPN', mfl: 'MFL', yahoo: 'Yahoo' };
        return (labels[platform] || 'This platform') + ' is currently available only in the sandbox beta.';
    }
    window.App.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    window.App.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
    window.PLATFORM_SANDBOX_ACCESS = PLATFORM_SANDBOX_ACCESS;
    window.MFL_SANDBOX_ACCESS = MFL_SANDBOX_ACCESS;
    window.platformAccessAllowed = platformAccessAllowed;

    // ── Notes from the Front — Field Log feed from Scout sessions ──
    var FL_CAT_COLORS = { trade:'#D4AF37', roster:'#2ECC71', draft:'#3498DB', waivers:'#9B59B6', research:'#E67E22', note:'#808080' };
    var FL_CAT_ICONS  = { trade:'🔄', roster:'📋', draft:'🎯', waivers:'📡', research:'🔍', note:'📝' };

    function FieldLogPanel(props) {
        var leagues = props.leagues || [];
        var onOpenLeague = props.onOpenLeague;
        var _s1 = React.useState(null);  var entries = _s1[0]; var setEntries = _s1[1];
        var _s2 = React.useState(false); var syncing = _s2[0]; var setSyncing = _s2[1];
        var _s3 = React.useState(0);     var lastRefresh = _s3[0]; var setLastRefresh = _s3[1];
        var _s4 = React.useState(false); var noSupabase = _s4[0]; var setNoSupabase = _s4[1];

        React.useEffect(function() {
            if (!window.OD || !window.OD.loadFieldLog) { setNoSupabase(true); setEntries([]); return; }
            setNoSupabase(false);
            window.OD.loadFieldLog(window.S?.currentLeagueId || null, 60)
                .then(function(data) { setEntries(data || []); })
                .catch(function() { setEntries([]); });
        }, [lastRefresh]);

        // Auto-refresh field log every 60 seconds
        React.useEffect(function() {
            var interval = setInterval(function() { setLastRefresh(Date.now()); }, 60000);
            return function() { clearInterval(interval); };
        }, []);

        var grouped = React.useMemo(function() {
            if (!entries || !entries.length) return [];
            var groups = {};
            entries.forEach(function(e) {
                var d = new Date(e.ts);
                var key = d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' });
                if (!groups[key]) groups[key] = { label: key, ts: e.ts, items: [] };
                groups[key].items.push(e);
            });
            return Object.values(groups).sort(function(a,b) { return b.ts - a.ts; });
        }, [entries]);

        function handleManualSync() {
            if (!window.OD || !window.OD.syncPendingFieldLog) return;
            setSyncing(true);
            window.OD.syncPendingFieldLog().catch(function(){}).then(function() {
                setLastRefresh(Date.now());
                setSyncing(false);
            });
        }

        var pendingCount = (entries || []).filter(function(e) { return e.syncStatus === 'pending' || e.syncStatus === 'failed'; }).length;

        return React.createElement('div', { className: 'product-card', style: { gridColumn: '1 / -1' } },
            // Header row
            React.createElement('div', { className: 'product-card-header', style: { marginBottom: '0.75rem' } },
                React.createElement('div', { style: { width:40,height:40,borderRadius:10,background:'rgba(124,107,248,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:'1.2rem',flexShrink:0 } }, '📋'),
                React.createElement('div', { style: { flex:1 } },
                    React.createElement('div', { className: 'product-card-title' }, 'NOTES FROM THE FRONT'),
                    React.createElement('div', { className: 'product-card-subtitle' }, 'Intel logged in your Scout sessions')
                ),
                React.createElement('button', { onClick: handleManualSync, disabled: syncing, style: { flexShrink:0,background:'none',border:'1px solid rgba(124,107,248,0.4)',borderRadius:6,color:'#7c6bf8',fontSize:'0.72rem',padding:'4px 10px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,opacity:syncing?0.5:1 } },
                    syncing ? '↻ Syncing…' : '↻ Refresh'
                )
            ),
            // Body
            entries === null
                ? React.createElement('div', { style: { padding:'1rem 0',textAlign:'center',color:'var(--silver)',fontSize:'0.78rem' } }, 'Loading field log…')
                : entries.length === 0
                ? (noSupabase
                    ? React.createElement('div', { style: { padding:'1.5rem 0',textAlign:'center' } },
                        React.createElement('div', { style: { fontSize:'1.6rem',marginBottom:'0.5rem' } }, '🔌'),
                        React.createElement('div', { style: { fontSize:'0.78rem',color:'var(--silver)',lineHeight:1.6 } }, 'Connect your Scout account to see field notes.')
                      )
                    : React.createElement('div', { style: { padding:'1.5rem 0',textAlign:'center' } },
                        React.createElement('div', { style: { fontSize:'2rem',marginBottom:'0.5rem' } }, '📋'),
                        React.createElement('div', { style: { fontSize:'0.78rem',color:'var(--silver)',lineHeight:1.6 } }, 'No field log entries yet. Actions you take in War Room Scout — trade scenarios, draft targets, waiver bids — will appear here automatically after syncing.')
                      )
                  )
                : React.createElement('div', { style: { maxHeight:'340px',overflowY:'auto',paddingRight:'2px' } },
                    grouped.map(function(group) {
                        return React.createElement('div', { key: group.label, style: { marginBottom:'14px' } },
                            React.createElement('div', { style: { fontSize:'0.64rem',fontWeight:700,color:'var(--silver)',textTransform:'uppercase',letterSpacing:'0.08em',padding:'0 0 5px',borderBottom:'1px solid rgba(255,255,255,0.06)',marginBottom:'6px',opacity:0.7 } }, group.label),
                            group.items.map(function(entry, idx) {
                                var timeStr = new Date(entry.ts).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
                                var catColor = FL_CAT_COLORS[entry.category] || '#808080';
                                var targetLeague = entry.leagueId ? leagues.find(function(l) { return l.id === entry.leagueId; }) : null;
                                return React.createElement('div', { key: entry.id || idx, style: { display:'flex',gap:'8px',alignItems:'flex-start',padding:'5px 0',borderBottom:'1px solid rgba(255,255,255,0.03)' } },
                                    React.createElement('span', { style: { fontSize:'0.88rem',flexShrink:0,marginTop:'1px' } }, entry.icon || FL_CAT_ICONS[entry.category] || '📋'),
                                    React.createElement('div', { style: { flex:1,minWidth:0 } },
                                        React.createElement('div', { style: { fontSize:'0.8rem',color:'var(--white)',lineHeight:1.35 } }, entry.text),
                                        entry.players && entry.players.length > 0 && React.createElement('div', { style: { fontSize:'0.68rem',color:'#7c6bf8',marginTop:'2px' } }, entry.players.map(function(p){ return p.name||p; }).join(', ')),
                                        entry.context && React.createElement('div', { style: { fontSize:'0.72rem',color:'var(--silver)',marginTop:'2px',fontStyle:'italic',opacity:0.8,lineHeight:1.3 } }, entry.context),
                                        React.createElement('div', { style: { display:'flex',gap:'5px',alignItems:'center',marginTop:'3px',flexWrap:'wrap' } },
                                            React.createElement('span', { style: { fontSize:'0.64rem',color:catColor,fontWeight:700,textTransform:'uppercase' } }, entry.category),
                                            React.createElement('span', { style: { fontSize:'0.64rem',color:'var(--silver)',opacity:0.4 } }, '·'),
                                            React.createElement('span', { style: { fontSize:'0.64rem',color:'var(--silver)',opacity:0.6 } }, timeStr),
                                            targetLeague && React.createElement('span', { style: { fontSize:'0.64rem',color:'var(--silver)',opacity:0.4 } }, '·'),
                                            targetLeague && React.createElement('span', { style: { fontSize:'0.64rem',color:'var(--silver)',opacity:0.7 } }, targetLeague.name)
                                        )
                                    ),
                                    targetLeague && onOpenLeague && React.createElement('button', { onClick: function(){ onOpenLeague(targetLeague, entry.category); }, style: { flexShrink:0,background:'none',border:'1px solid rgba(212,175,55,0.35)',borderRadius:4,color:'var(--gold)',fontSize:'0.62rem',padding:'2px 7px',cursor:'pointer',fontFamily:'inherit',fontWeight:700,marginTop:'1px' } }, 'OPEN →')
                                );
                            })
                        );
                    })
                  ),
            // Footer
            entries !== null && pendingCount > 0 && React.createElement('div', { style: { marginTop:'8px',paddingTop:'8px',borderTop:'1px solid rgba(255,255,255,0.06)',fontSize:'0.68rem',color:'var(--silver)',opacity:0.7 } }, pendingCount + ' entries pending sync from Scout. Open War Room Scout to push them.')
        );
    }

    // ── ESPN Connect Card ─────────────────────────────────────────
    function ESPNConnectCard({ leagues, connecting, error, onConnect, onSelectLeague, reconBase }) {
        const [leagueId, setLeagueId]   = React.useState('');
        const [espnS2, setEspnS2]       = React.useState('');
        const [swid, setSwid]           = React.useState('');
        const [showCreds, setShowCreds] = React.useState(false);

        const RED = '#cc0000';
        const RED_BG = 'rgba(204,0,0,0.08)';
        const RED_BORDER = 'rgba(204,0,0,0.3)';

        function espnScoutUrl(numericId) {
            return reconBase + '?espn_league=' + numericId;
        }

        if (leagues.length > 0) {
            return React.createElement('div', null,
                leagues.map(function(l) {
                    return React.createElement('div', {
                        key: l.id,
                        style: { display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: RED_BG, border: '1px solid ' + RED_BORDER, borderRadius: 10, marginBottom: 8, cursor: 'pointer' },
                        onClick: function() { onSelectLeague(l); }
                    },
                        React.createElement('div', { style: { width: 32, height: 32, borderRadius: 8, background: RED, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 } },
                            React.createElement('span', { style: { fontSize: 13, fontWeight: 800, color: '#fff' } }, 'E')
                        ),
                        React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: '0.86rem', fontWeight: 600, color: 'var(--white)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, l.name),
                            React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', marginTop: 2 } },
                                (l.rosters || []).length + ' teams · ' + l.season + ' · ESPN'
                            )
                        ),
                        React.createElement('span', { style: { fontSize: '0.64rem', fontWeight: 800, background: RED, color: '#fff', borderRadius: 4, padding: '2px 6px', flexShrink: 0 } }, 'ESPN')
                    );
                }),
                React.createElement('a', {
                    href: espnScoutUrl(leagues[0]._espnLeagueId),
                    target: '_blank', rel: 'noopener noreferrer',
                    className: 'hub-cta',
                    style: { textDecoration: 'none', background: RED, marginTop: 4, display: 'block', textAlign: 'center', padding: '10px', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700, color: '#fff', letterSpacing: '.06em' }
                }, 'OPEN IN WAR ROOM SCOUT →'),
                React.createElement('button', {
                    onClick: function() { /* allow reconnecting */ },
                    style: { background: 'none', border: 'none', color: 'var(--silver)', fontSize: '0.72rem', cursor: 'pointer', marginTop: 6, padding: 0 }
                }, '+ Connect another league')
            );
        }

        return React.createElement('div', null,
            React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.6 } },
                'Connect any ESPN Fantasy Football league. Your League ID is in the URL: fantasy.espn.com/football/league?leagueId=',
                React.createElement('strong', { style: { color: 'var(--white)' } }, '123456')
            ),
            React.createElement('input', {
                placeholder: 'ESPN League ID (e.g. 123456)',
                value: leagueId,
                onChange: function(e) { setLeagueId(e.target.value); },
                onKeyDown: function(e) { if (e.key === 'Enter') onConnect(leagueId, espnS2, swid); },
                style: { width: '100%', fontSize: '0.9rem', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--white)', boxSizing: 'border-box', marginBottom: 8, fontFamily: 'inherit' }
            }),
            React.createElement('div', {
                onClick: function() { setShowCreds(!showCreds); },
                style: { fontSize: '0.72rem', color: 'var(--silver)', cursor: 'pointer', marginBottom: showCreds ? 8 : 0, display: 'flex', alignItems: 'center', gap: 4 }
            },
                React.createElement('span', null, showCreds ? '▾' : '▸'),
                ' Private league? Add cookies for access'
            ),
            showCreds && React.createElement('div', { style: { marginBottom: 8 } },
                React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', lineHeight: 1.5, marginBottom: 6 } },
                    'F12 → Application → Cookies → fantasy.espn.com — copy espn_s2 and SWID values.'
                ),
                React.createElement('input', {
                    placeholder: 'espn_s2 cookie value',
                    type: 'password',
                    value: espnS2,
                    onChange: function(e) { setEspnS2(e.target.value); },
                    style: { width: '100%', fontSize: '0.78rem', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--white)', boxSizing: 'border-box', marginBottom: 6, fontFamily: 'monospace' }
                }),
                React.createElement('input', {
                    placeholder: 'SWID cookie value {XXXXXXXX-...}',
                    value: swid,
                    onChange: function(e) { setSwid(e.target.value); },
                    style: { width: '100%', fontSize: '0.78rem', padding: '8px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--white)', boxSizing: 'border-box', fontFamily: 'monospace' }
                })
            ),
            error && React.createElement('div', { style: { fontSize: '0.75rem', color: '#E74C3C', marginBottom: 8, padding: '6px 10px', background: 'rgba(231,76,60,0.08)', borderRadius: 6, lineHeight: 1.5 } }, error),
            React.createElement('button', {
                onClick: function() { onConnect(leagueId, espnS2, swid); },
                disabled: connecting,
                style: { width: '100%', padding: '10px', background: connecting ? 'rgba(204,0,0,0.5)' : RED, color: '#fff', border: 'none', borderRadius: 8, fontSize: '0.82rem', fontWeight: 700, cursor: connecting ? 'not-allowed' : 'pointer', letterSpacing: '.05em', fontFamily: 'inherit' }
            }, connecting ? 'Connecting...' : 'CONNECT ESPN LEAGUE')
        );
    }

    // Main Dashboard
    function OwnerDashboard() {
        const [showSettings, setShowSettings] = useState(false);
        const [loading, setLoading] = useState(true);
        const [error, setError] = useState(null);
        const [sleeperUser, setSleeperUser] = useState(null);
        const [selectedYear, setSelectedYear] = useState('2026');
        const [sleeperLeagues, setSleeperLeagues] = useState([]);
        const [activeLeagueId, setActiveLeagueId] = useState(null);
        const [selectedLeague, setSelectedLeague] = useState(null);
        const [proMode, setProMode] = useState(false); // Empire Dashboard mode
        // Lifted tab state for browser history navigation
        const [activeTab, setActiveTab] = useState('dashboard');
        const isNavigatingRef = React.useRef(false);
        const initialRouteAppliedRef = React.useRef(false);
        // ESPN state
        const [espnLeagues, setEspnLeagues] = useState([]);
        const [espnConnecting, setEspnConnecting] = useState(false);
        // MFL state
        const [mflLeagues, setMflLeagues] = useState([]);
        const [mflConnecting, setMflConnecting] = useState(false);
        const [mflError, setMflError] = useState(null);
        const [mflFranchises, setMflFranchises] = useState(null);
        const [mflPendingResult, setMflPendingResult] = useState(null);
        const visibleEspnLeagues = PLATFORM_SANDBOX_ACCESS ? espnLeagues : [];
        const visibleMflLeagues = PLATFORM_SANDBOX_ACCESS ? mflLeagues : [];
        const [espnError, setEspnError] = useState(null);
        // Display name state
        const [customDisplayName, setCustomDisplayName] = useState(() => {
            return localStorage.getItem('od_display_name') || '';
        });

        // Cloud sync — load from Supabase on mount
        useEffect(() => {
            if (window.OD?.loadDisplayName) {
                window.OD.loadDisplayName().then(name => {
                    if (name) { setCustomDisplayName(name); localStorage.setItem('od_display_name', name); }
                }).catch(err => window.wrLog('app.loadDisplayName', err));
            }
        }, []);
        const leagueMates = React.useMemo(() => {
            const seen = new Set();
            // seed with current user's id so we exclude ourselves
            if (sleeperUser?.user_id) seen.add(sleeperUser.user_id);
            const mates = [];
            sleeperLeagues.forEach(league => {
                (league.users || []).forEach(u => {
                    const uid = u.user_id;
                    if (uid && !seen.has(uid)) {
                        seen.add(uid);
                        mates.push(u);
                    }
                });
            });
            return mates.sort((a, b) => (a.display_name || a.username || '').localeCompare(b.display_name || b.username || ''));
        }, [sleeperLeagues, sleeperUser]);

        const AVAILABLE_YEARS = ['2023', '2024', '2025', '2026'];

        // ── Browser History Navigation ──
        function buildHash(leagueId, tab) {
            return '#league=' + leagueId + '&tab=' + (tab || 'dashboard');
        }
        function routeUrl(hash) {
            const query = new URLSearchParams(window.location.search || '');
            query.delete('league');
            query.delete('leagueId');
            query.delete('tab');
            const qs = query.toString();
            return window.location.pathname + (qs ? '?' + qs : '') + (hash || '');
        }
        function parseHash(hash) {
            const params = new URLSearchParams((hash || '').replace('#', ''));
            const query = new URLSearchParams(window.location.search || '');
            // Legacy 'brief' tab was folded into dashboard — redirect old bookmarks
            const rawTab = params.get('tab') || query.get('tab') || 'dashboard';
            const tab = rawTab === 'brief' ? 'dashboard' : rawTab;
            return {
                leagueId: params.get('league') || query.get('league') || query.get('leagueId'),
                tab,
            };
        }

        useEffect(() => {
            if (sleeperUsername) loadSleeperData();
        }, [selectedYear]);

        async function loadSleeperData() {
            setLoading(true);
            setError(null);

            try {
                const user = await fetchSleeperUser(sleeperUsername);
                if (!user) {
                    setError("Couldn't find that Sleeper username — check spelling and try again");
                    setLoading(false);
                    return;
                }
                setSleeperUser(user);

                const leagues = await fetchUserLeagues(user.user_id, selectedYear);

                const leaguesWithDetails = await Promise.all(
                    leagues.map(async (league) => {
                        try {
                            const [rosters, users] = await Promise.all([
                                fetchLeagueRosters(league.league_id),
                                fetchLeagueUsers(league.league_id)
                            ]);

                            const myRoster = rosters.find(r => r.owner_id === user.user_id);
                            
                            return {
                                id: league.league_id,
                                name: league.name,
                                wins: myRoster?.settings?.wins || 0,
                                losses: myRoster?.settings?.losses || 0,
                                ties: myRoster?.settings?.ties || 0,
                                season: selectedYear,
                                scoring_settings: league.scoring_settings || {},
                                roster_positions: league.roster_positions || [],
                                settings: league.settings || {},
                                rosters,
                                users
                            };
                        } catch (e) {
                            console.error(`Failed to load league ${league.name}:`, e);
                            return null;
                        }
                    })
                );

                const validLeagues = leaguesWithDetails.filter(l => l !== null);
                setSleeperLeagues(validLeagues);
                setLoading(false);
            } catch (err) {
                console.error('Failed to load Sleeper data:', err);
                setError('Failed to load Sleeper data. Please refresh.');
                setLoading(false);
            }
        }

        // Hook must be above the early return to maintain consistent hook order
        const [reconLeagueId, setReconLeagueId] = useState(null);

        // popstate listener for back/forward navigation — MUST be before early return
        React.useEffect(() => {
            function onPopState(e) {
                isNavigatingRef.current = true;
                const state = e.state;
                const hashRoute = parseHash(window.location.hash);
                const nextState = state || (hashRoute.leagueId ? { view: 'league', leagueId: hashRoute.leagueId, tab: hashRoute.tab } : null);
                if (nextState && nextState.view === 'league' && nextState.leagueId) {
                    const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
                    const league = allLeagues.find(l => String(l.id) === String(nextState.leagueId));
                    if (league) {
                        setActiveLeagueId(league.id);
                        setSelectedLeague(league);
                        // Legacy 'brief' tab folded into dashboard
                        const restoredTab = nextState.tab === 'brief' ? 'dashboard' : (nextState.tab || 'dashboard');
                        setActiveTab(restoredTab);
                    }
                } else {
                    setSelectedLeague(null);
                    setActiveTab('dashboard');
                }
                setTimeout(() => { isNavigatingRef.current = false; }, 0);
            }
            window.addEventListener('popstate', onPopState);
            if (!history.state) {
                const route = parseHash(window.location.hash);
                const state = route.leagueId
                    ? { view: 'league', leagueId: route.leagueId, tab: route.tab }
                    : { view: 'hub' };
                history.replaceState(state, '', routeUrl(window.location.hash));
            }
            return () => window.removeEventListener('popstate', onPopState);
        }, [sleeperLeagues, espnLeagues, mflLeagues]);

        React.useEffect(() => {
            if (initialRouteAppliedRef.current) return;
            const route = parseHash(window.location.hash);
            if (!route.leagueId) {
                if (!loading) initialRouteAppliedRef.current = true;
                return;
            }
            const allLeagues = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
            if (!allLeagues.length) return;
            const league = allLeagues.find(l => String(l.id) === String(route.leagueId));
            if (!league) {
                if (!loading) initialRouteAppliedRef.current = true;
                return;
            }
            initialRouteAppliedRef.current = true;
            isNavigatingRef.current = true;
            setActiveLeagueId(league.id);
            setSelectedLeague(league);
            setActiveTab(route.tab || 'dashboard');
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_ID, league.id);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_NAME, league.name);
            history.replaceState(
                { view: 'league', leagueId: league.id, tab: route.tab || 'dashboard' },
                '',
                routeUrl(buildHash(league.id, route.tab || 'dashboard'))
            );
            setTimeout(() => { isNavigatingRef.current = false; }, 0);
        }, [loading, sleeperLeagues, espnLeagues, mflLeagues]);

        // Show Empire Dashboard (Pro mode)
        // eslint-disable-next-line no-undef
        const _EmpireDash = typeof EmpireDashboard === 'function' ? EmpireDashboard : null;
        const [empirePlayersLoaded, setEmpirePlayersLoaded] = useState(false);
        const [empirePlayers, setEmpirePlayers] = useState({});

        // Load player database + DHQ engine when Pro mode activates
        useEffect(() => {
            if (!proMode || empirePlayersLoaded) return;
            (async () => {
                try {
                    // Load 10k player database (league-independent, cached 1hr)
                    const players = await window.App.fetchAllPlayers();
                    setEmpirePlayers(players || {});
                    // Ensure window.S exists for assessment functions
                    if (!window.S) window.S = {};
                    window.S.players = players;
                    // Populate rosters from all leagues into window.S for assessments
                    const allRosters = [];
                    const allUsers = [];
                    const allLeaguesList = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues];
                    allLeaguesList.forEach(l => {
                        (l.rosters || []).forEach(r => { if (!allRosters.find(x => x.roster_id === r.roster_id)) allRosters.push(r); });
                        (l.users || []).forEach(u => { if (!allUsers.find(x => x.user_id === u.user_id)) allUsers.push(u); });
                    });
                    window.S.rosters = allRosters;
                    window.S.leagueUsers = allUsers;
                    window.S.myUserId = sleeperUser?.user_id;
                    window.S.user = sleeperUser;
                    // Fetch traded picks for all leagues in parallel
                    const allTradedPicks = [];
                    await Promise.allSettled(allLeaguesList.map(async l => {
                        const lid = l.id || l.league_id;
                        if (!lid) return;
                        try {
                            const tp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/traded_picks').then(r => r.ok ? r.json() : []);
                            if (tp?.length) {
                                const norm = window.App?.normalizeTradedPicks;
                                l.tradedPicks = norm ? norm(l.rosters || [], tp) : tp;
                                allTradedPicks.push(...l.tradedPicks);
                            }
                        } catch {}
                    }));
                    window.S.tradedPicks = allTradedPicks;
                    // Load DHQ engine if not already loaded
                    if (typeof window.App?.loadLeagueIntel === 'function' && !window.App.LI_LOADED) {
                        await window.App.loadLeagueIntel().catch(() => {});
                    }
                    setEmpirePlayersLoaded(true);
                } catch (e) { console.warn('[Empire] Data load error:', e); setEmpirePlayersLoaded(true); }
            })();
        }, [proMode, empirePlayersLoaded]);

        if (proMode && !selectedLeague && _EmpireDash) {
            return (
                <ErrorBoundary>
                    <_EmpireDash
                        allLeagues={[...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues]}
                        playersData={empirePlayers}
                        sleeperUserId={sleeperUser?.user_id}
                        onEnterLeague={(league) => {
                            handleSelectLeague(league);
                        }}
                        onBack={() => {
                            setProMode(false);
                            if (!isNavigatingRef.current) {
                                history.pushState({ view: 'hub' }, '', routeUrl(''));
                            }
                        }}
                    />
                </ErrorBoundary>
            );
        }

        // Show league detail if selected
        const LeagueDetail = window.LeagueDetail;
        if (selectedLeague) {
            return <>
                <ErrorBoundary>
                    <LeagueDetail
                        league={selectedLeague}
                        onBack={() => {
                            setSelectedLeague(null);
                            setActiveTab('dashboard');
                            // Return to Empire Dashboard if Pro mode was active, otherwise hub
                            if (!isNavigatingRef.current) {
                                history.pushState({ view: proMode ? 'pro' : 'hub' }, '', routeUrl(''));
                            }
                        }}
                        activeTab={activeTab}
                        onTabChange={handleTabChange}
                        sleeperUserId={sleeperUser?.user_id}
                        onOpenSettings={() => setShowSettings(true)}
                    />
                </ErrorBoundary>
                {showSettings && (
                    <SettingsModal
                        onClose={() => setShowSettings(false)}
                        initDisplayName={customDisplayName}
                        onDisplayNameSave={(name) => {
                            setCustomDisplayName(name);
                            window.OD.saveDisplayName(name);
                        }}
                        leagueMates={leagueMates}
                    />
                )}
            </>;
        }

        // ── Shared helpers ──
        const lastLeagueId = AppStorage.get(APP_WR_KEYS.LAST_LEAGUE_ID);
        const lastLeagueName = AppStorage.get(APP_WR_KEYS.LAST_LEAGUE_NAME);
        const displayName = sleeperUser
            ? (customDisplayName || sleeperUser.display_name || sleeperUser.username || sleeperUsername).toUpperCase()
            : (customDisplayName || 'COMMANDER').toUpperCase();

        const RECONAI_BASE = 'https://jcc100218.github.io/ReconAI/';
        function reconUrl(leagueId) {
            return leagueId ? RECONAI_BASE + '?league=' + leagueId : RECONAI_BASE;
        }

        function leagueHealth(league) {
            const gp = league.wins + league.losses + (league.ties || 0);
            const wp = gp > 0 ? Math.round((league.wins / gp) * 100) : null;
            const myRoster = league.rosters?.find(r => r.owner_id === sleeperUser?.user_id);
            const rosterSlots = league.roster_positions?.filter(p => p !== 'BN' && p !== 'IR' && p !== 'TAXI').length || 0;
            const filled = myRoster?.starters?.filter(s => s && s !== '0').length || 0;
            const fillPct = rosterSlots > 0 ? Math.round((filled / rosterSlots) * 100) : null;
            return { gp, wp, fillPct, teamCount: league.rosters?.length || 0 };
        }

        // Pro tier icon (SVG shield with star)
        function ProTierIcon({ size }) {
            const s = size || 24;
            return React.createElement('svg', { viewBox: '0 0 24 24', width: s, height: s, fill: 'none', xmlns: 'http://www.w3.org/2000/svg' },
                React.createElement('path', { d: 'M12 2L3 7v6c0 5.25 3.83 10.18 9 11.38C17.17 23.18 21 18.25 21 13V7L12 2z', fill: 'url(#proGrad)', stroke: '#D4AF37', strokeWidth: '1' }),
                React.createElement('path', { d: 'M12 7l1.545 3.13 3.455.503-2.5 2.437.59 3.43L12 14.885 8.91 16.5l.59-3.43-2.5-2.437 3.455-.503L12 7z', fill: '#0A0A0A', stroke: '#B8941E', strokeWidth: '0.5' }),
                React.createElement('defs', null,
                    React.createElement('linearGradient', { id: 'proGrad', x1: '3', y1: '2', x2: '21', y2: '24' },
                        React.createElement('stop', { offset: '0%', stopColor: '#D4AF37' }),
                        React.createElement('stop', { offset: '100%', stopColor: '#8B6914' })
                    )
                )
            );
        }
        window.ProTierIcon = ProTierIcon;

        function LeagueSelector({ onSelect, accent }) {
            const accentColor = 'var(--gold)';
            const accentBg = 'rgba(212,175,55,0.08)';
            const accentBorder = 'rgba(212,175,55,0.3)';
            if (!sleeperUsername) return null;
            if (loading) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--silver)', fontSize: '0.82rem' }}>Loading leagues...</div>;
            if (error) return <div style={{ padding: '0.75rem', textAlign: 'center', color: '#E74C3C', fontSize: '0.82rem' }}>{error}</div>;
            if (sleeperLeagues.length === 0) return <div style={{ padding: '1rem', textAlign: 'center', color: 'var(--silver)', fontSize: '0.82rem' }}>No leagues found for {selectedYear}</div>;

            const tier = typeof getUserTier === 'function' ? getUserTier() : 'free';
            const isPaid = tier === 'pro' || tier === 'warroom' || tier === 'war_room' || tier === 'commissioner';
            const showProCard = true; // Always show — changes label based on tier

            return (
                <div className="hub-league-selector">
                    <label>Select League</label>

                    {/* Pro tier card — launcher for paid, upgrade for free */}
                    {showProCard && !isPaid && (
                        <div onClick={() => { if (typeof window.showProLaunchPage === 'function') window.showProLaunchPage(); else window.location.href = 'landing.html'; }}
                            style={{ cursor: 'pointer', marginBottom: '12px', borderRadius: '12px', padding: '14px 16px', background: 'linear-gradient(135deg, rgba(212,175,55,0.12), rgba(212,175,55,0.04))', border: '1.5px solid rgba(212,175,55,0.35)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.18s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.6)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(212,175,55,0.15)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.35)'; e.currentTarget.style.boxShadow = 'none'; }}>
                            <div style={{ width: '36px', height: '36px', flexShrink: 0 }}><ProTierIcon size={36} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)' }}>Upgrade to War Room</span>
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--gold)', background: 'rgba(212,175,55,0.15)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '10px', padding: '1px 7px', letterSpacing: '0.04em' }}>$4.99/mo</span>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.6 }}>Unlock full AI analysis · All leagues · Owner DNA</div>
                            </div>
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="rgba(212,175,55,0.5)" strokeWidth="2.5" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                    )}
                    {showProCard && isPaid && (
                        <div onClick={() => setProMode(true)}
                            style={{ cursor: 'pointer', marginBottom: '12px', borderRadius: '12px', padding: '14px 16px', background: 'linear-gradient(135deg, rgba(212,175,55,0.1), rgba(0,0,0,0.3))', border: '1.5px solid rgba(212,175,55,0.4)', display: 'flex', alignItems: 'center', gap: '12px', transition: 'all 0.18s' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.7)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(212,175,55,0.2)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.4)'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'none'; }}>
                            <div style={{ width: '36px', height: '36px', flexShrink: 0 }}><ProTierIcon size={36} /></div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                                    <span style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--gold)' }}>Launch Empire Dashboard</span>
                                    <span style={{ fontSize: '0.6rem', fontWeight: 700, color: '#2ECC71', background: 'rgba(46,204,113,0.15)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: '10px', padding: '1px 7px', letterSpacing: '0.04em' }}>PRO</span>
                                </div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.6 }}>All {sleeperLeagues.length} league{sleeperLeagues.length !== 1 ? 's' : ''} · Cross-league intel · Player exposure</div>
                            </div>
                            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="var(--gold)" strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                        </div>
                    )}

                    <div className="hub-league-list">
                        {sleeperLeagues.map(l => {
                            const h = leagueHealth(l);
                            const recordCol = h.wp === null ? 'var(--silver)' : h.wp >= 60 ? 'var(--win-green)' : h.wp < 40 ? 'var(--loss-red)' : 'var(--silver)';
                            const fillCol = h.fillPct === null ? 'var(--silver)' : h.fillPct >= 90 ? 'var(--win-green)' : h.fillPct >= 70 ? 'var(--silver)' : 'var(--loss-red)';
                            return (
                                <div key={l.id} className="hub-league-item" onClick={() => onSelect(l)}
                                    onMouseEnter={e => { e.currentTarget.style.borderColor = accentColor; e.currentTarget.style.background = accentBg; }}
                                    onMouseLeave={e => { e.currentTarget.style.borderColor = accentBorder; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</div>
                                        <div style={{ display: 'flex', gap: '8px', marginTop: '3px', fontSize: '0.72rem', color: 'var(--silver)' }}>
                                            <span>{h.teamCount}T</span>
                                            <span style={{ color: recordCol, fontWeight: 700 }}>{l.wins}-{l.losses}{l.ties > 0 ? '-'+l.ties : ''}</span>
                                            {h.fillPct !== null && <span style={{ color: fillCol }}>{h.fillPct}% filled</span>}
                                        </div>
                                    </div>
                                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={accentColor} strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}><polyline points="9 18 15 12 9 6"/></svg>
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        function handleSelectLeague(league) {
            setActiveLeagueId(league.id);
            setSelectedLeague(league);
            setActiveTab('dashboard');
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_ID, league.id);
            AppStorage.set(APP_WR_KEYS.LAST_LEAGUE_NAME, league.name);
            if (!isNavigatingRef.current) {
                history.pushState({ view: 'league', leagueId: league.id, tab: 'dashboard' }, '', routeUrl(buildHash(league.id, 'dashboard')));
            }
        }

        function handleTabChange(tab) {
            setActiveTab(tab);
            if (!isNavigatingRef.current && selectedLeague) {
                history.pushState({ view: 'league', leagueId: selectedLeague.id, tab }, '', routeUrl(buildHash(selectedLeague.id, tab)));
            }
        }

        async function handleESPNConnect(leagueId, espnS2, swid) {
            if (!platformAccessAllowed('espn')) { setEspnError(platformBetaMessage('espn')); return; }
            if (!leagueId) { setEspnError('Enter your ESPN league ID'); return; }
            const numericId = leagueId.replace(/\D/g, '');
            if (!numericId) { setEspnError('League ID must be a number from your ESPN URL'); return; }
            if (!window.ESPN) { setEspnError('ESPN connector not loaded — refresh and try again'); return; }
            setEspnConnecting(true);
            setEspnError(null);
            try {
                const year = parseInt(selectedYear);
                // Persist credentials for Scout deep-link
                if (espnS2) localStorage.setItem('espn_s2', espnS2);
                if (swid)   localStorage.setItem('espn_swid', swid);
                const result = await window.ESPN.connectLeague(numericId, year, espnS2 || null, swid || null);
                const league = {
                    id:              result.league.league_id,
                    name:            result.league.name,
                    season:          String(year),
                    wins:            0, losses: 0, ties: 0,
                    rosters:         result.rosters,
                    scoring_settings: result.league.scoring_settings,
                    roster_positions: result.league.roster_positions,
                    settings:         result.league.settings || {},
                    _espn:            true,
                    _espnLeagueId:    numericId,
                };
                setEspnLeagues(prev => {
                    const filtered = prev.filter(l => l._espnLeagueId !== numericId);
                    return [...filtered, league];
                });
            } catch (e) {
                setEspnError(e.message || 'ESPN connection failed');
            } finally {
                setEspnConnecting(false);
            }
        }

        async function handleMFLConnect(leagueId, year, apiKey) {
            if (!platformAccessAllowed('mfl')) { setMflError(platformBetaMessage('mfl')); return; }
            if (!leagueId) { setMflError('Enter your MFL League ID'); return; }
            if (!window.MFL) { setMflError('MFL connector not loaded — refresh and try again'); return; }
            setMflConnecting(true);
            setMflError(null);
            try {
                const raw = await window.MFL.fetchLeague(leagueId, year, apiKey || null);
                if (!raw?.leagueData?.league) throw new Error('Invalid MFL league data. Check your League ID and year.');
                // Build crosswalk (empty Sleeper players — rebuilds when full DB loads)
                const mflPlayerArr = raw.playersData?.players?.player || [];
                const allMflPlayers = Array.isArray(mflPlayerArr) ? mflPlayerArr : [mflPlayerArr];
                const crosswalk = window.MFL.buildCrosswalk({}, allMflPlayers, year);
                const result = window.MFL.mapToSleeperState(raw, leagueId, year, crosswalk);
                // Extract franchise list for picker
                const franchises = raw.leagueData?.league?.franchises?.franchise || [];
                const franchiseArr = Array.isArray(franchises) ? franchises : [franchises];
                // Store credentials
                localStorage.setItem('mfl_league_id', leagueId);
                localStorage.setItem('mfl_year', String(year));
                if (apiKey) localStorage.setItem('mfl_api_key', apiKey);
                setMflPendingResult(result);
                setMflFranchises(franchiseArr);
            } catch (e) {
                setMflError(e.message || 'MFL connection failed');
            } finally {
                setMflConnecting(false);
            }
        }

        function finalizeMFLConnect(franchiseId) {
            if (!platformAccessAllowed('mfl')) return;
            const result = mflPendingResult;
            if (!result) return;
            const league = {
                id: result.league.league_id,
                name: result.league.name,
                season: result.league.season,
                wins: 0, losses: 0, ties: 0,
                rosters: result.rosters,
                scoring_settings: result.league.scoring_settings,
                roster_positions: result.league.roster_positions,
                settings: result.league.settings || {},
                users: result.leagueUsers,
                _mfl: true,
                _mflLeagueId: localStorage.getItem('mfl_league_id'),
                _mflFranchiseId: franchiseId || null,
            };
            setMflLeagues(prev => {
                const filtered = prev.filter(l => l._mflLeagueId !== league._mflLeagueId);
                return [...filtered, league];
            });
            setMflFranchises(null);
            setMflPendingResult(null);
            handleSelectLeague(league);
        }

        // Search connected leagues across active production platforms.
        const resumeLeague = [...sleeperLeagues, ...visibleEspnLeagues, ...visibleMflLeagues].find(l => l.id === lastLeagueId);

        return (
            <div className="app-container">
                {/* ── Header ── */}
                <header className="header">
                    <div className="header-brand">
                        <img src="icon-192.png" alt="Logo" style={{ width:'44px',height:'44px',borderRadius:'10px',boxShadow:'0 2px 12px rgba(212,175,55,.3)' }} />
                        <div className="header-text">
                            <h1 className="owner-name" style={{ fontSize:'1.1rem',letterSpacing:'.06em' }}>WAR ROOM</h1>
                            <div className="header-subtitle">{String(displayName)}</div>
                        </div>
                    </div>
                    <a href={RECONAI_BASE} onClick={() => localStorage.setItem('fw_preferred_view','scout')} style={{ fontSize:'0.72rem',color:'var(--gold)',textDecoration:'none',fontWeight:700,padding:'4px 10px',border:'1px solid rgba(212,175,55,.25)',borderRadius:'6px',whiteSpace:'nowrap',marginRight:'8px' }} title="Switch to Scout mobile view">Scout</a>
                    <svg className="settings-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" onClick={() => setShowSettings(true)} style={{ cursor: 'pointer' }}>
                        <circle cx="12" cy="12" r="3" stroke="var(--gold)"/>
                        <path d="M12 1v6m0 6v6m-5.2-7.8l-4.3-4.2m12.9 0l4.3 4.2M1 12h6m6 0h6m-7.8 5.2l-4.2 4.3m0-12.9l4.2 4.3" stroke="var(--gold)"/>
                    </svg>
                </header>

                {/* ── Session Strip ── */}
                {resumeLeague && !loading && (
                    <div className="session-strip">
                        <span className="session-strip-label">Last Session:</span>
                        <span className="session-strip-league">{lastLeagueName}</span>
                        <button className="session-strip-btn primary" onClick={() => handleSelectLeague(resumeLeague)}>Resume</button>
                        <button className="session-strip-btn secondary" onClick={() => handleSelectLeague(resumeLeague)}>View Alerts</button>
                        <button className="session-strip-btn secondary" onClick={() => handleSelectLeague(resumeLeague)}>Open Draft Room</button>
                    </div>
                )}

                {/* ── 4 Platform Cards ── */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', padding: '0 12px' }}>

                    {/* ──── SLEEPER ──── */}
                    <div className="product-card" style={{ borderColor: 'rgba(26,153,170,0.3)', background: 'linear-gradient(135deg, rgba(26,153,170,0.04), transparent)' }}>
                        <div className="product-card-header">
                            <div className="product-card-icon" style={{ background: 'linear-gradient(135deg, #1a99aa, #147d8a)', boxShadow: '0 3px 12px rgba(26,153,170,0.25)' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--white)" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
                            </div>
                            <div>
                                <div className="product-card-title">SLEEPER</div>
                                <div className="product-card-subtitle">{sleeperUsername ? sleeperLeagues.length + ' league' + (sleeperLeagues.length !== 1 ? 's' : '') + ' synced' : 'Connect your account'}</div>
                            </div>
                        </div>
                        <div className="product-card-body">
                            {!sleeperUsername ? (
                                <div className="hub-connect-card">
                                    <input id="wr-sleeper-input" placeholder="Sleeper username" onKeyDown={e => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) { localStorage.setItem('od_auth_v1', JSON.stringify({sleeperUsername:v})); window.location.reload(); } } }} />
                                    <button className="hub-cta gold" onClick={() => { const v = document.getElementById('wr-sleeper-input')?.value?.trim(); if (v) { localStorage.setItem('od_auth_v1', JSON.stringify({sleeperUsername:v})); window.location.reload(); } }}>CONNECT</button>
                                    <button className="hub-cta ghost" style={{ marginTop: '6px' }} onClick={() => { localStorage.setItem('od_auth_v1', JSON.stringify({sleeperUsername:'jcc100218'})); AppStorage.set(APP_WR_KEYS.DEMO_MODE, '1'); window.location.reload(); }}>Demo League</button>
                                </div>
                            ) : (
                                <>
                                    <LeagueSelector onSelect={handleSelectLeague} accent="gold" />
                                    {resumeLeague ? (
                                        <button className="hub-cta gold" onClick={() => handleSelectLeague(resumeLeague)}>ENTER {lastLeagueName?.toUpperCase()}</button>
                                    ) : sleeperLeagues.length > 0 ? (
                                        <button className="hub-cta gold" onClick={() => handleSelectLeague(sleeperLeagues[0])}>ENTER {sleeperLeagues[0].name?.toUpperCase()}</button>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </div>

                    {/* ──── ESPN ──── HIDDEN — infrastructure preserved, UI removed */}

                    {/* ──── MFL — sandbox beta only ──── */}
                    {platformAccessAllowed('mfl') && <div className="product-card" style={{ borderColor: 'rgba(46,125,50,0.3)', background: 'linear-gradient(135deg, rgba(46,125,50,0.04), transparent)' }}>
                        <div className="product-card-header">
                            <div className="product-card-icon" style={{ background: 'linear-gradient(135deg, #2e7d32, #1b5e20)', boxShadow: '0 3px 12px rgba(46,125,50,0.25)' }}>
                                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--white)" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/></svg>
                            </div>
                            <div>
                                <div className="product-card-title">MFL</div>
                                <div className="product-card-subtitle">{visibleMflLeagues.length > 0 ? visibleMflLeagues.length + ' league' + (visibleMflLeagues.length !== 1 ? 's' : '') + ' synced' : 'MyFantasyLeague connector'}</div>
                            </div>
                        </div>
                        <div className="product-card-body">
                            {/* Connected leagues */}
                            {visibleMflLeagues.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                    {visibleMflLeagues.map(l => (
                                        <button key={l.id} className="hub-cta gold" style={{ marginBottom: '4px', width: '100%' }} onClick={() => handleSelectLeague(l)}>
                                            ENTER {l.name?.toUpperCase()}
                                        </button>
                                    ))}
                                </div>
                            )}
                            {/* Franchise picker */}
                            {mflFranchises && (
                                <div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--gold)', marginBottom: '8px', fontWeight: 700 }}>Select your team:</div>
                                    <div style={{ maxHeight: '200px', overflow: 'auto' }}>
                                        {mflFranchises.map(f => (
                                            <button key={f.id} onClick={() => finalizeMFLConnect(f.id)}
                                                style={{ display: 'block', width: '100%', padding: '8px 10px', marginBottom: '4px', background: 'rgba(46,125,50,0.08)', border: '1px solid rgba(46,125,50,0.25)', borderRadius: '6px', color: 'var(--white)', fontSize: '0.78rem', fontFamily: 'var(--font-body)', cursor: 'pointer', textAlign: 'left' }}>
                                                {f.name || f.owner_name || ('Team ' + f.id)}
                                            </button>
                                        ))}
                                    </div>
                                    <button onClick={() => { setMflFranchises(null); setMflPendingResult(null); }} style={{ fontSize: '0.72rem', color: 'var(--silver)', background: 'none', border: 'none', cursor: 'pointer', marginTop: '6px' }}>Cancel</button>
                                </div>
                            )}
                            {/* Connect form */}
                            {!mflFranchises && (
                                <div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginBottom: '8px' }}>Enter your MFL League ID and year to connect.</div>
                                    <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
                                        <input id="wr-mfl-id" placeholder="League ID" style={{ flex: 1, padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '6px', color: 'var(--white)', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }} />
                                        <input id="wr-mfl-year" placeholder="Year" defaultValue="2026" style={{ width: '70px', padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '6px', color: 'var(--white)', fontSize: '0.82rem', fontFamily: 'var(--font-body)', textAlign: 'center' }} />
                                    </div>
                                    <details style={{ marginBottom: '8px' }}>
                                        <summary style={{ fontSize: '0.72rem', color: 'var(--silver)', cursor: 'pointer', opacity: 0.7 }}>Private league? Add API key</summary>
                                        <input id="wr-mfl-apikey" placeholder="API Key (optional)" style={{ width: '100%', marginTop: '6px', padding: '8px 10px', background: 'var(--charcoal)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '6px', color: 'var(--white)', fontSize: '0.82rem', fontFamily: 'var(--font-body)' }} />
                                    </details>
                                    {mflError && <div style={{ fontSize: '0.72rem', color: '#E74C3C', marginBottom: '8px' }}>{mflError}</div>}
                                    <button className="hub-cta gold" disabled={mflConnecting} onClick={() => {
                                        const id = document.getElementById('wr-mfl-id')?.value?.trim();
                                        const yr = document.getElementById('wr-mfl-year')?.value?.trim() || '2026';
                                        const apiKey = document.getElementById('wr-mfl-apikey')?.value?.trim() || '';
                                        handleMFLConnect(id, yr, apiKey);
                                    }}>{mflConnecting ? 'Connecting...' : 'CONNECT MFL'}</button>
                                </div>
                            )}
                        </div>
                    </div>}

                    {/* ──── YAHOO ──── HIDDEN — infrastructure preserved, UI removed */}

                </div>

                {showSettings && (
                    <SettingsModal
                        onClose={() => setShowSettings(false)}
                        initDisplayName={customDisplayName}
                        onDisplayNameSave={(name) => {
                            setCustomDisplayName(name);
                            window.OD.saveDisplayName(name);
                        }}
                        leagueMates={leagueMates}
                    />
                )}

            </div>
        );
    }

    ReactDOM.render(<OwnerDashboard />, document.getElementById('root'));

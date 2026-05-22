// js/tabs/compare.js - CompareTab: standalone team-vs-team comparison.
//
// Shows team-vs-team roster strength, position edges, H2H history, and a
// full per-position roster diff.
//
// Depends on: window.App.LI (playerScores, championships, bracketData),
//             window.App.normPos / POS_COLORS / peakWindows / calcPPG.
// Exposes:    window.CompareTab

function CompareTab({
    currentLeague,
    myRoster,
    playersData,
    statsData,
    stats2025Data,
    standings,
    sleeperUserId,
}) {
    const sameId = (a, b) => String(a) === String(b);
    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
    const [compareTeamId, setCompareTeamId] = React.useState(() => {
        try {
            const preselect = window._wrComparePreselect;
            if (preselect != null && preselect !== '') return String(preselect);
            const stored = localStorage.getItem('wr_compare_team_' + (leagueId || 'default'));
            return stored || null;
        } catch { return null; }
    });
    const [compareScope, setCompareScope] = React.useState(() => {
        try { return localStorage.getItem('wr_compare_scope_' + (leagueId || 'default')) || 'duel'; } catch { return 'duel'; }
    });
    const [manualCompareIds, setManualCompareIds] = React.useState(() => {
        try {
            const raw = localStorage.getItem('wr_compare_group_' + (leagueId || 'default'));
            return raw ? JSON.parse(raw).map(String) : [];
        } catch { return []; }
    });
    const [selectedDivision, setSelectedDivision] = React.useState(() => {
        try { return localStorage.getItem('wr_compare_division_' + (leagueId || 'default')) || ''; } catch { return ''; }
    });
    const [h2hState, setH2hState] = React.useState({ loading: false, meetings: [], error: null, loadedFor: null });

    React.useEffect(() => {
        const onOpenCompare = (event) => {
            const rid = event?.detail?.rosterId || window._wrComparePreselect;
            if (rid != null && rid !== '') {
                setCompareScope('duel');
                setCompareTeamId(String(rid));
            }
        };
        window.addEventListener('wr:open-compare', onOpenCompare);
        return () => window.removeEventListener('wr:open-compare', onOpenCompare);
    }, []);

    React.useEffect(() => {
        if (!leagueId || !compareTeamId) return;
        try { localStorage.setItem('wr_compare_team_' + leagueId, String(compareTeamId)); } catch {}
    }, [leagueId, compareTeamId]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_scope_' + leagueId, compareScope); } catch {}
    }, [leagueId, compareScope]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_group_' + leagueId, JSON.stringify(manualCompareIds)); } catch {}
    }, [leagueId, manualCompareIds]);
    React.useEffect(() => {
        if (!leagueId) return;
        try { localStorage.setItem('wr_compare_division_' + leagueId, selectedDivision); } catch {}
    }, [leagueId, selectedDivision]);

    React.useEffect(() => {
        let cancelled = false;
        const theirRoster = (currentLeague?.rosters || []).find(r => sameId(r.roster_id, compareTeamId));
        const rootLeagueId = currentLeague?.league_id || currentLeague?.id;
        const myOwnerId = myRoster?.owner_id;
        const theirOwnerId = theirRoster?.owner_id;
        const platform = currentLeague?._platform || (currentLeague?._mfl ? 'mfl' : currentLeague?._espn ? 'espn' : currentLeague?._yahoo ? 'yahoo' : 'sleeper');
        const canLoadSleeperHistory = platform === 'sleeper' && rootLeagueId && theirRoster && myOwnerId && theirOwnerId;

        if (compareScope !== 'duel') {
            setH2hState({ loading: false, meetings: [], error: null, loadedFor: null });
            return;
        }

        if (!compareTeamId || !canLoadSleeperHistory) {
            setH2hState({ loading: false, meetings: [], error: platform === 'sleeper' ? null : 'H2H history is only available for Sleeper leagues right now.', loadedFor: compareTeamId });
            return;
        }

        async function fetchJson(url) {
            try {
                const res = await fetch(url);
                return res.ok ? res.json() : null;
            } catch {
                return null;
            }
        }

        async function loadHistoricalH2H() {
            const cacheKey = 'wr_compare_h2h_v3_' + rootLeagueId + '_' + myOwnerId + '_' + theirOwnerId;
            try {
                const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
                if (cached && Date.now() - cached.ts < 6 * 60 * 60 * 1000 && Array.isArray(cached.meetings)) {
                    return cached.meetings;
                }
            } catch {}

            const sleeperBase = 'https://api.sleeper.app/v1';
            const chain = [];
            const seen = new Set();
            let lid = String(rootLeagueId);
            let hops = 0;

            while (lid && lid !== '0' && !seen.has(lid) && hops < 12) {
                seen.add(lid);
                const fetchedInfo = await fetchJson(sleeperBase + '/league/' + lid);
                const info = sameId(lid, rootLeagueId)
                    ? Object.assign({}, fetchedInfo || {}, currentLeague || {})
                    : fetchedInfo;
                if (!info) break;
                chain.push({ leagueId: lid, info, season: String(info.season || '') });
                lid = (fetchedInfo?.previous_league_id || info.previous_league_id) ? String(fetchedInfo?.previous_league_id || info.previous_league_id) : '';
                hops += 1;
            }

            const meetings = [];
            const currentSeason = Number(currentLeague?.season || 0);

            for (const seasonEntry of chain) {
                const info = seasonEntry.info || {};
                const season = String(info.season || seasonEntry.season || '');
                const rosters = sameId(seasonEntry.leagueId, rootLeagueId) && Array.isArray(currentLeague?.rosters)
                    ? currentLeague.rosters
                    : await fetchJson(sleeperBase + '/league/' + seasonEntry.leagueId + '/rosters');
                if (!Array.isArray(rosters) || !rosters.length) continue;

                const historicalMine = rosters.find(r => sameId(r.owner_id, myOwnerId))
                    || (sameId(seasonEntry.leagueId, rootLeagueId) ? rosters.find(r => sameId(r.roster_id, myRoster?.roster_id)) : null);
                const historicalTheirs = rosters.find(r => sameId(r.owner_id, theirOwnerId))
                    || (sameId(seasonEntry.leagueId, rootLeagueId) ? rosters.find(r => sameId(r.roster_id, theirRoster?.roster_id)) : null);
                if (!historicalMine || !historicalTheirs) continue;

                const playoffStart = Number(info.settings?.playoff_week_start) || Number(currentLeague?.settings?.playoff_week_start) || 15;
                const maxWeek = Math.max(1, Math.min(18, playoffStart - 1));
                const weeks = Array.from({ length: maxWeek }, (_, i) => i + 1);
                const weeklyMatchups = await Promise.all(weeks.map(w =>
                    fetchJson(sleeperBase + '/league/' + seasonEntry.leagueId + '/matchups/' + w).then(rows => ({ week: w, rows: Array.isArray(rows) ? rows : [] }))
                ));

                weeklyMatchups.forEach(({ week, rows }) => {
                    const grouped = {};
                    rows.forEach(row => {
                        if (!row || row.roster_id == null || row.matchup_id == null) return;
                        const key = String(row.matchup_id);
                        (grouped[key] = grouped[key] || []).push(row);
                    });

                    Object.values(grouped).forEach(pair => {
                        const me = pair.find(row => sameId(row.roster_id, historicalMine.roster_id));
                        const them = pair.find(row => sameId(row.roster_id, historicalTheirs.roster_id));
                        if (!me || !them) return;
                        const myPts = Number(me.points || 0);
                        const theirPts = Number(them.points || 0);
                        const played = myPts > 0 || theirPts > 0 || (Number(season) && Number(season) < currentSeason);
                        if (!played) return;
                        meetings.push({
                            season,
                            week,
                            myPoints: myPts,
                            theirPoints: theirPts,
                            result: myPts > theirPts ? 'W' : myPts < theirPts ? 'L' : 'T',
                            margin: +(myPts - theirPts).toFixed(2),
                            matchupId: me.matchup_id,
                        });
                    });
                });
            }

            meetings.sort((a, b) => Number(b.season) - Number(a.season) || b.week - a.week);
            try { localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), meetings })); } catch {}
            return meetings;
        }

        setH2hState({ loading: true, meetings: [], error: null, loadedFor: compareTeamId });
        loadHistoricalH2H()
            .then(meetings => {
                if (!cancelled) setH2hState({ loading: false, meetings, error: null, loadedFor: compareTeamId });
            })
            .catch(() => {
                if (!cancelled) setH2hState({ loading: false, meetings: [], error: 'Unable to load H2H history.', loadedFor: compareTeamId });
            });

        return () => { cancelled = true; };
    }, [leagueId, compareScope, compareTeamId, myRoster?.owner_id, myRoster?.roster_id, currentLeague?.rosters?.length]);

    if (!myRoster) {
        return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;
    }

    const normPos = window.App.normPos;
    const posColors = window.App.POS_COLORS || {};
    const scores = window.App?.LI?.playerScores || {};
    const allPositions = ['QB','RB','WR','TE','K','DL','LB','DB'];
    const rosterById = {};
    (currentLeague?.rosters || []).forEach(r => { rosterById[String(r.roster_id)] = r; });
    const getRosterTotal = (roster) => (roster?.players || []).reduce((sum, pid) => sum + (scores[pid] || scores[String(pid)] || 0), 0);
    const myTotal = getRosterTotal(myRoster);
    const getOwnerName = (roster, fallback) => {
        const user = (currentLeague?.users || []).find(u => sameId(u.user_id, roster?.owner_id));
        return user?.metadata?.team_name || user?.display_name || fallback || ('Team ' + (roster?.roster_id ?? ''));
    };
    const leagueSeason = parseInt(currentLeague?.season, 10) || new Date().getFullYear();
    const draftRounds = Number(currentLeague?.settings?.draft_rounds || 5);
    const leagueTeamCount = (currentLeague?.rosters || []).length || 12;
    const tradedPicks = window.S?.tradedPicks || [];
    const pickMidSlot = Math.ceil(leagueTeamCount / 2);
    const getPickValue = (year, round) => {
        const rd = Number(round) || 1;
        const pickNumber = (rd - 1) * leagueTeamCount + pickMidSlot;
        if (typeof window.getIndustryPickValue === 'function') return window.getIndustryPickValue(pickNumber, leagueTeamCount, draftRounds);
        const sharedValue = window.App?.PlayerValue?.getPickValue?.(year, rd, leagueTeamCount, pickMidSlot);
        if (sharedValue != null) return sharedValue;
        return Math.max(500, 10000 - rd * 2000);
    };
    const getDraftCapital = (roster) => {
        const rid = roster?.roster_id;
        const picks = [];
        if (rid == null) return { picks, totalValue: 0, count: 0, byRound: {}, byYear: {}, topPicks: [], label: '0 picks' };

        for (let yr = leagueSeason; yr <= leagueSeason + 2; yr++) {
            for (let rd = 1; rd <= draftRounds; rd++) {
                const tradedAway = tradedPicks.find(p => parseInt(p.season, 10) === yr && Number(p.round) === rd && sameId(p.roster_id, rid) && !sameId(p.owner_id, rid));
                if (!tradedAway) {
                    const value = getPickValue(yr, rd);
                    picks.push({
                        year: yr,
                        round: rd,
                        own: true,
                        value,
                        label: yr === leagueSeason ? 'R' + rd : "'" + String(yr).slice(-2) + ' R' + rd,
                    });
                }

                tradedPicks
                    .filter(p => parseInt(p.season, 10) === yr && Number(p.round) === rd && sameId(p.owner_id, rid) && !sameId(p.roster_id, rid))
                    .forEach(p => {
                        const fromRoster = rosterById[String(p.roster_id)];
                        const fromName = getOwnerName(fromRoster, 'Team ' + p.roster_id);
                        const value = getPickValue(yr, rd);
                        picks.push({
                            year: yr,
                            round: rd,
                            own: false,
                            from: fromName,
                            value,
                            label: (yr === leagueSeason ? 'R' + rd : "'" + String(yr).slice(-2) + ' R' + rd) + ' via ' + fromName,
                        });
                    });
            }
        }

        const byRound = {};
        const byYear = {};
        picks.forEach(p => {
            byRound[p.round] = (byRound[p.round] || 0) + 1;
            byYear[p.year] = (byYear[p.year] || 0) + 1;
        });
        const totalValue = picks.reduce((sum, p) => sum + (p.value || 0), 0);
        const topPicks = [...picks].sort((a, b) => b.value - a.value || a.year - b.year || a.round - b.round).slice(0, 4);
        return {
            picks,
            totalValue,
            count: picks.length,
            byRound,
            byYear,
            topPicks,
            label: picks.length + ' picks',
        };
    };
    const getFaab = (roster) => {
        const isFaab = currentLeague?.settings?.waiver_type === 2 || Number(currentLeague?.settings?.waiver_budget || 0) > 0;
        const budget = isFaab ? Number(currentLeague?.settings?.waiver_budget || 100) : 0;
        const spent = Number(roster?.settings?.waiver_budget_used || 0);
        const remaining = budget ? Math.max(0, budget - spent) : 0;
        return {
            isFaab,
            budget,
            spent,
            remaining,
            pct: budget ? Math.round(remaining / budget * 100) : 0,
            label: budget ? '$' + remaining + ' / $' + budget : 'No FAAB',
        };
    };
    const myName = getOwnerName(myRoster, 'You');
    const allTeamOptions = (standings || [])
        .map(t => {
            const roster = rosterById[String(t.rosterId)];
            const dhq = getRosterTotal(roster);
            return { ...t, roster, dhq, gap: Math.abs(dhq - myTotal), name: t.displayName || getOwnerName(roster, 'Team ' + t.rosterId) };
        })
        .filter(t => t.roster);
    const opponentOptions = (standings || [])
        .filter(t => !sameId(t.rosterId, myRoster.roster_id))
        .map(t => {
            const roster = rosterById[String(t.rosterId)];
            const dhq = getRosterTotal(roster);
            return { ...t, roster, dhq, gap: Math.abs(dhq - myTotal), name: t.displayName || getOwnerName(roster, 'Team ' + t.rosterId) };
        })
        .filter(t => t.roster);

    const metadata = currentLeague?.metadata || {};
    const getDivisionKey = (roster) => String(roster?.settings?.division ?? 0);
    const getDivisionName = (key) => metadata['division_' + key + '_name'] || metadata['division_' + key] || (key === '0' ? 'Division 0' : 'Division ' + key);
    const divisions = {};
    allTeamOptions.forEach(t => {
        const key = getDivisionKey(t.roster);
        if (!divisions[key]) divisions[key] = [];
        divisions[key].push(t);
    });
    const divisionKeys = Object.keys(divisions).sort((a, b) => Number(a) - Number(b));
    const myDivision = getDivisionKey(myRoster);
    const activeDivision = selectedDivision || myDivision || divisionKeys[0] || '0';
    const validOpponentIdSet = new Set(opponentOptions.map(t => String(t.rosterId)));
    const cleanManualIds = manualCompareIds.filter(id => validOpponentIdSet.has(String(id)));
    const defaultGroupIds = [...opponentOptions]
        .sort((a, b) => b.dhq - a.dhq)
        .slice(0, Math.min(3, opponentOptions.length))
        .map(t => String(t.rosterId));
    const selectedGroupIds = cleanManualIds.length >= 2 ? cleanManualIds : defaultGroupIds;
    const selectedGroupTeams = selectedGroupIds
        .map(id => opponentOptions.find(t => sameId(t.rosterId, id)))
        .filter(Boolean);
    const selectedDivisionTeams = (divisions[activeDivision] || [])
        .filter(t => !sameId(t.rosterId, myRoster.roster_id));
    const selectedLeagueTeams = opponentOptions;
    const setScope = (scope) => {
        setCompareScope(scope);
        if (scope === 'duel' && !compareTeamId && opponentOptions[0]) setCompareTeamId(String(opponentOptions[0].rosterId));
    };
    const toggleManualTeam = (id) => {
        const key = String(id);
        setManualCompareIds(prev => prev.map(String).includes(key) ? prev.filter(x => String(x) !== key) : [...prev.map(String), key]);
    };
    const pickManualPreset = (preset) => {
        if (preset === 'threats') setManualCompareIds([...opponentOptions].sort((a, b) => b.dhq - a.dhq).slice(0, 4).map(t => String(t.rosterId)));
        else if (preset === 'closest') setManualCompareIds([...opponentOptions].sort((a, b) => a.gap - b.gap).slice(0, 4).map(t => String(t.rosterId)));
        else if (preset === 'division') setManualCompareIds(selectedDivisionTeams.map(t => String(t.rosterId)));
        else if (preset === 'clear') setManualCompareIds([]);
    };

    const statsRefForField = statsData || {};
    const stats2025RefForField = stats2025Data || {};
    const derivedStatsRefForField = window.S?.playerStats || {};
    const scoringForField = currentLeague?.scoring_settings || {};
    const calcFieldPPG = (pid) => {
        const st = statsRefForField[pid] || statsRefForField[String(pid)] || {};
        const prev = stats2025RefForField[pid] || stats2025RefForField[String(pid)] || {};
        const curGP = Number(st.gp || 0);
        const prevGP = Number(prev.gp || 0);
        const curPts = curGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(st, scoringForField) : null;
        const prevPts = prevGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(prev, scoringForField) : null;
        const derived = derivedStatsRefForField[pid] || derivedStatsRefForField[String(pid)] || {};
        if (curGP > 0 && curPts != null) return +(curPts / curGP).toFixed(1);
        if (prevGP > 0 && prevPts != null) return +(prevPts / prevGP).toFixed(1);
        return derived.seasonAvg || derived.prevAvg || 0;
    };
    const enrichFieldPlayer = (pid) => {
        const p = playersData?.[pid] || playersData?.[String(pid)];
        if (!p) return null;
        const pos = normPos(p.position);
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { peak: (window.App?.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
        const valueEnd = curve.decline?.[1] || 32;
        const peakEnd = curve.peak?.[1] || 29;
        const age = p.age || null;
        return {
            pid,
            p,
            pos,
            age,
            team: p.team || 'FA',
            yrsExp: p.years_exp || 0,
            ppg: calcFieldPPG(pid),
            dhq: scores[pid] || scores[String(pid)] || 0,
            peakYrs: age ? Math.max(0, peakEnd - age) : 0,
            valueYrs: age ? Math.max(0, valueEnd - age) : 0,
            pastValue: age ? age > valueEnd : false,
        };
    };
    const starterDhqForRoster = (roster) => (roster?.starters || [])
        .filter(pid => pid && pid !== '0')
        .reduce((sum, pid) => sum + (scores[pid] || scores[String(pid)] || 0), 0);
    const teamProfile = (teamOption, isMine) => {
        const roster = isMine ? myRoster : teamOption?.roster;
        if (!roster) return null;
        const players = (roster.players || []).map(enrichFieldPlayer).filter(Boolean);
        const posTotals = {};
        const posTop = {};
        allPositions.forEach(pos => {
            const atPos = players.filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
            posTotals[pos] = atPos.reduce((s, p) => s + p.dhq, 0);
            posTop[pos] = atPos[0] || null;
        });
        const total = getRosterTotal(roster);
        const starterTotal = starterDhqForRoster(roster);
        const pickCapital = getDraftCapital(roster);
        const faab = getFaab(roster);
        const pastValue = players.reduce((sum, p) => sum + (p.pastValue ? p.dhq : 0), 0);
        const topPlayer = [...players].sort((a, b) => b.dhq - a.dhq)[0] || null;
        return {
            roster,
            rosterId: String(roster.roster_id),
            isMine: !!isMine,
            name: isMine ? myName : (teamOption?.name || getOwnerName(roster, 'Team ' + roster.roster_id)),
            record: (roster.settings?.wins || 0) + '-' + (roster.settings?.losses || 0),
            division: getDivisionKey(roster),
            total,
            starterTotal,
            posTotals,
            posTop,
            players,
            pickCapital,
            faab,
            totalAssets: total + pickCapital.totalValue,
            topPlayer,
            pastValuePct: total > 0 ? Math.round(pastValue / total * 100) : 0,
        };
    };
    const openPlayerCard = (pid) => {
        if (!pid) return;
        if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
        else if (typeof window._wrSelectPlayer === 'function') window._wrSelectPlayer(pid);
    };

    const pageStyle = { padding: '22px 26px 60px', maxWidth: '1540px', margin: '0 auto' };
    const panelStyle = { background: 'var(--black)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px' };
    const labelStyle = { fontSize: '0.62rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.66 };
    const mono = { fontFamily: 'JetBrains Mono, monospace' };
    const muted = { color: 'var(--silver)', opacity: 0.72 };
    const selectStyle = {
        padding: '9px 14px',
        fontSize: '0.82rem',
        fontFamily: 'var(--font-body)',
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(212,175,55,0.32)',
        borderRadius: '6px',
        color: 'var(--white)',
        minWidth: '280px',
    };
    const quickButtonStyle = (active) => ({
        padding: '8px 10px',
        background: active ? 'rgba(212,175,55,0.16)' : 'rgba(255,255,255,0.035)',
        border: '1px solid ' + (active ? 'rgba(212,175,55,0.46)' : 'rgba(255,255,255,0.08)'),
        borderRadius: '6px',
        color: active ? 'var(--gold)' : 'var(--silver)',
        textAlign: 'left',
        cursor: 'pointer',
        minWidth: '142px',
    });

    const renderLanding = () => (
        <div style={{ ...panelStyle, padding: '28px', color: 'var(--silver)' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.2rem', color: 'var(--white)', fontWeight: 700, marginBottom: '6px' }}>
                Choose a matchup lens
            </div>
            <div style={{ fontSize: '0.86rem', lineHeight: 1.5, maxWidth: '620px' }}>
                Compare is strongest when it answers a specific question: who can beat you now, who is closest long term, and where the roster edge actually lives.
            </div>
        </div>
    );

    const scopeButtonStyle = (active) => ({
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid ' + (active ? 'rgba(212,175,55,0.55)' : 'rgba(255,255,255,0.09)'),
        background: active ? 'rgba(212,175,55,0.16)' : 'rgba(255,255,255,0.035)',
        color: active ? 'var(--gold)' : 'var(--silver)',
        fontFamily: 'Rajdhani, sans-serif',
        fontWeight: 800,
        fontSize: '0.92rem',
        cursor: 'pointer',
    });
    const smallButtonStyle = (active) => ({
        padding: '6px 9px',
        borderRadius: '6px',
        border: '1px solid ' + (active ? 'rgba(212,175,55,0.48)' : 'rgba(255,255,255,0.08)'),
        background: active ? 'rgba(212,175,55,0.14)' : 'rgba(255,255,255,0.03)',
        color: active ? 'var(--gold)' : 'var(--silver)',
        fontSize: '0.72rem',
        fontWeight: 800,
        cursor: 'pointer',
    });
    const renderScopeControls = () => (
        <div className="wr-module-nav">
            {[
                ['duel', 'Duel', '1 opponent'],
                ['group', 'Group', '2+ teams'],
                ['division', 'Division', 'league divisions'],
                ['league', 'League', 'all teams'],
            ].map(([key, label, sub]) => (
                <button key={key} className={compareScope === key ? 'is-active' : ''} onClick={() => setScope(key)}>
                    {label}<span>{sub}</span>
                </button>
            ))}
        </div>
    );
    const renderFieldControls = () => {
        if (compareScope === 'group') {
            return (
                <div style={{ ...panelStyle, padding: '12px', marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
                        <div>
                            <div style={{ ...labelStyle, color: 'var(--gold)', opacity: 1 }}>Group Builder</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.68 }}>Pick any 2 or more opponents for a custom field.</div>
                        </div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            <button onClick={() => pickManualPreset('threats')} style={smallButtonStyle(false)}>Top 4 DHQ</button>
                            <button onClick={() => pickManualPreset('closest')} style={smallButtonStyle(false)}>Closest 4</button>
                            <button onClick={() => pickManualPreset('division')} style={smallButtonStyle(false)}>My Division</button>
                            <button onClick={() => pickManualPreset('clear')} style={smallButtonStyle(false)}>Clear</button>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '7px' }}>
                        {opponentOptions.map(t => {
                            const active = selectedGroupIds.map(String).includes(String(t.rosterId));
                            const manualActive = manualCompareIds.map(String).includes(String(t.rosterId));
                            return (
                                <button key={t.rosterId} onClick={() => toggleManualTeam(t.rosterId)} style={{
                                    padding: '8px 9px',
                                    borderRadius: '6px',
                                    border: '1px solid ' + (manualActive ? 'rgba(212,175,55,0.46)' : 'rgba(255,255,255,0.07)'),
                                    background: manualActive ? 'rgba(212,175,55,0.12)' : active ? 'rgba(255,255,255,0.055)' : 'rgba(255,255,255,0.025)',
                                    color: manualActive ? 'var(--gold)' : 'var(--silver)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                }}>
                                    <div style={{ fontWeight: 850, color: manualActive ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</div>
                                    <div style={{ ...mono, fontSize: '0.66rem', opacity: 0.66, marginTop: '2px' }}>{t.dhq.toLocaleString()} DHQ</div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            );
        }
        if (compareScope === 'division') {
            return (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
                    {divisionKeys.map(key => (
                        <button key={key} onClick={() => setSelectedDivision(key)} style={quickButtonStyle(key === activeDivision)}>
                            <div style={{ fontSize: '0.58rem', textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.72 }}>{getDivisionName(key)}</div>
                            <div style={{ ...mono, fontSize: '0.68rem', marginTop: '2px' }}>{(divisions[key] || []).length} teams</div>
                        </button>
                    ))}
                </div>
            );
        }
        return null;
    };

    const renderFieldAnalysis = (selectedTeams, fieldLabel, fieldSub) => {
        const opponents = selectedTeams.filter(Boolean);
        if (!opponents.length) {
            return <div style={{ ...panelStyle, padding: '24px', color: 'var(--silver)' }}>Select at least two teams to build a field comparison.</div>;
        }
        const myProfile = teamProfile(null, true);
        const opponentProfiles = opponents.map(t => teamProfile(t, false)).filter(Boolean);
        const profiles = [myProfile, ...opponentProfiles].filter(Boolean);
        const sortedProfiles = [...profiles].sort((a, b) => b.totalAssets - a.totalAssets);
        const myRank = sortedProfiles.findIndex(p => p.isMine) + 1;
        const fieldAvg = opponentProfiles.length ? Math.round(opponentProfiles.reduce((s, p) => s + p.total, 0) / opponentProfiles.length) : 0;
        const starterAvg = opponentProfiles.length ? Math.round(opponentProfiles.reduce((s, p) => s + p.starterTotal, 0) / opponentProfiles.length) : 0;
        const pickAvg = opponentProfiles.length ? Math.round(opponentProfiles.reduce((s, p) => s + (p.pickCapital?.totalValue || 0), 0) / opponentProfiles.length) : 0;
        const faabAvg = opponentProfiles.length ? Math.round(opponentProfiles.reduce((s, p) => s + (p.faab?.remaining || 0), 0) / opponentProfiles.length) : 0;
        const percentile = profiles.length > 1 ? Math.round((1 - ((myRank - 1) / (profiles.length - 1))) * 100) : 100;
        const posDiffs = allPositions.map(pos => {
            const avg = opponentProfiles.length ? opponentProfiles.reduce((s, p) => s + (p.posTotals[pos] || 0), 0) / opponentProfiles.length : 0;
            return { pos, avg, mine: myProfile.posTotals[pos] || 0, diff: Math.round((myProfile.posTotals[pos] || 0) - avg) };
        });
        const strongest = [...posDiffs].sort((a, b) => b.diff - a.diff)[0];
        const weakest = [...posDiffs].sort((a, b) => a.diff - b.diff)[0];
        const maxTotal = Math.max(1, ...profiles.map(p => p.totalAssets));
        const maxStarter = Math.max(1, ...profiles.map(p => p.starterTotal));
        const maxByPos = {};
        allPositions.forEach(pos => { maxByPos[pos] = Math.max(1, ...profiles.map(p => p.posTotals[pos] || 0)); });
        const bestByPos = {};
        allPositions.forEach(pos => {
            bestByPos[pos] = [...profiles].sort((a, b) => (b.posTotals[pos] || 0) - (a.posTotals[pos] || 0))[0]?.rosterId;
        });
        const divisionProfiles = {};
        profiles.forEach(p => {
            if (!divisionProfiles[p.division]) divisionProfiles[p.division] = [];
            divisionProfiles[p.division].push(p);
        });
        const breakdownProfiles = profiles.length <= 4 ? profiles : [];
        const positionBreakdowns = breakdownProfiles.length ? allPositions.map(pos => {
            const columns = breakdownProfiles.map(profile => {
                const playersAtPos = (profile.players || []).filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
                return {
                    profile,
                    total: playersAtPos.reduce((s, r) => s + r.dhq, 0),
                    players: playersAtPos,
                };
            });
            const maxLen = Math.max(0, ...columns.map(col => col.players.length));
            const leader = [...columns].sort((a, b) => b.total - a.total)[0];
            return { pos, columns, maxLen, leaderId: leader?.profile?.rosterId };
        }).filter(summary => summary.maxLen > 0) : [];
        const fieldCards = [
            { label: 'Asset Rank', value: '#' + myRank + ' of ' + profiles.length, sub: percentile + 'th percentile incl. picks', color: myRank <= Math.ceil(profiles.length / 3) ? '#2ECC71' : myRank <= Math.ceil(profiles.length * 0.66) ? 'var(--gold)' : '#E74C3C' },
            { label: 'Roster vs Field', value: (myProfile.total - fieldAvg > 0 ? '+' : '') + (myProfile.total - fieldAvg).toLocaleString(), sub: myProfile.total.toLocaleString() + ' vs ' + fieldAvg.toLocaleString() + ' avg', color: myProfile.total >= fieldAvg ? '#2ECC71' : '#E74C3C' },
            { label: 'Starter vs Field', value: (myProfile.starterTotal - starterAvg > 0 ? '+' : '') + (myProfile.starterTotal - starterAvg).toLocaleString(), sub: myProfile.starterTotal.toLocaleString() + ' vs ' + starterAvg.toLocaleString() + ' avg', color: myProfile.starterTotal >= starterAvg ? '#2ECC71' : '#E74C3C' },
            { label: 'Picks vs Field', value: ((myProfile.pickCapital.totalValue - pickAvg) > 0 ? '+' : '') + (myProfile.pickCapital.totalValue - pickAvg).toLocaleString(), sub: myProfile.pickCapital.count + ' picks vs ' + Math.round(opponentProfiles.reduce((s, p) => s + (p.pickCapital?.count || 0), 0) / Math.max(opponentProfiles.length, 1)) + ' avg', color: myProfile.pickCapital.totalValue >= pickAvg ? '#2ECC71' : '#E74C3C' },
            { label: 'FAAB vs Field', value: myProfile.faab.isFaab ? ((myProfile.faab.remaining - faabAvg) > 0 ? '+$' : '-$') + Math.abs(myProfile.faab.remaining - faabAvg).toLocaleString() : '—', sub: myProfile.faab.label, color: !myProfile.faab.isFaab ? 'var(--silver)' : myProfile.faab.remaining >= faabAvg ? '#2ECC71' : '#E74C3C' },
            { label: 'Best Room', value: strongest?.pos || '-', sub: strongest ? ((strongest.diff > 0 ? '+' : '') + strongest.diff.toLocaleString() + ' vs avg') : '-', color: '#2ECC71' },
            { label: 'Danger Room', value: weakest?.pos || '-', sub: weakest ? ((weakest.diff > 0 ? '+' : '') + weakest.diff.toLocaleString() + ' vs avg') : '-', color: weakest?.diff < 0 ? '#E74C3C' : 'var(--gold)' },
        ];

        const renderTeamChip = (profile) => (
            <div key={profile.rosterId} style={{ padding: '9px 10px', background: profile.isMine ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)', border: '1px solid ' + (profile.isMine ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.07)'), borderRadius: '7px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline' }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                        <div style={{ fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.66, marginTop: '2px' }}>{profile.record} - {getDivisionName(profile.division)}</div>
                        <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.52, marginTop: '2px' }}>{profile.pickCapital.count} picks · {profile.faab.isFaab ? '$' + profile.faab.remaining + ' FAAB' : 'No FAAB'}</div>
                    </div>
                    <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--silver)', fontWeight: 800 }}>{profile.totalAssets.toLocaleString()}</div>
                </div>
                <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', marginTop: '8px' }}>
                    <div style={{ width: (profile.totalAssets / maxTotal * 100) + '%', height: '100%', background: profile.isMine ? 'var(--gold)' : '#7C6BF8' }}></div>
                </div>
            </div>
        );
        const renderFieldPlayerCell = (player, column, rowBestDhq) => {
            if (!player) {
                return (
                    <div style={{
                        minHeight: '46px',
                        padding: '8px',
                        borderRadius: '6px',
                        border: '1px solid rgba(255,255,255,0.04)',
                        background: 'rgba(255,255,255,0.018)',
                        color: 'rgba(255,255,255,0.28)',
                        fontSize: '0.72rem',
                        display: 'flex',
                        alignItems: 'center',
                    }}>No player</div>
                );
            }
            const isRowBest = player.dhq > 0 && player.dhq === rowBestDhq;
            const isMine = column.profile.isMine;
            const dhqCol = player.dhq >= 7000 ? '#2ECC71' : player.dhq >= 4000 ? '#3498DB' : player.dhq >= 1000 ? 'var(--silver)' : 'rgba(255,255,255,0.5)';
            return (
                <div onClick={() => openPlayerCard(player.pid)} style={{
                    minHeight: '46px',
                    padding: '8px',
                    borderRadius: '6px',
                    border: '1px solid ' + (isRowBest ? 'rgba(46,204,113,0.28)' : isMine ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.055)'),
                    background: isRowBest ? 'rgba(46,204,113,0.07)' : isMine ? 'rgba(212,175,55,0.045)' : 'rgba(255,255,255,0.024)',
                    cursor: 'pointer',
                    minWidth: 0,
                }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', minWidth: 0 }}>
                        <img src={'https://sleepercdn.com/content/nfl/players/thumb/'+player.pid+'.jpg'} onError={e=>e.target.style.display='none'} style={{ width:'24px',height:'24px',borderRadius:'50%',objectFit:'cover', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--white)', fontSize: '0.76rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{player.p?.full_name || '?'}</div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.66, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {player.team} {player.age != null ? '· ' + player.age + 'yo' : ''}{player.ppg > 0 ? ' · ' + player.ppg + ' PPG' : ''} · {player.peakYrs > 0 ? player.peakYrs + 'yr peak' : player.valueYrs + 'yr value'}
                            </div>
                        </div>
                        <div style={{ ...mono, color: dhqCol, fontSize: '0.72rem', fontWeight: 850, flexShrink: 0 }}>{player.dhq > 0 ? player.dhq.toLocaleString() : '-'}</div>
                    </div>
                </div>
            );
        };
        const renderFieldRosterBreakdown = () => {
            if (profiles.length > 4) {
                return (
                    <div style={{ ...panelStyle, padding: '14px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                        <div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 850, color: 'var(--white)', letterSpacing: 0 }}>Full Breakdown</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66, marginTop: '2px' }}>Available for up to 4 total teams so the player-level columns stay readable.</div>
                        </div>
                        <div style={{ ...mono, color: 'var(--gold)', fontSize: '0.76rem', fontWeight: 850 }}>{profiles.length} teams selected</div>
                    </div>
                );
            }

            return (
                <div style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                        <div>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Full Breakdown</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.62, marginTop: '2px' }}>Player-level rooms across {profiles.length} teams. Click any player to open the card.</div>
                        </div>
                        <div style={{ ...mono, color: 'var(--silver)', fontSize: '0.72rem' }}>{profiles.length} teams</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '8px', marginBottom: '12px' }}>
                        {profiles.map(profile => (
                            <div key={'capital-' + profile.rosterId} style={{ padding: '10px', borderRadius: '7px', background: profile.isMine ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.025)', border: '1px solid ' + (profile.isMine ? 'rgba(212,175,55,0.26)' : 'rgba(255,255,255,0.06)') }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', marginBottom: '7px' }}>
                                    <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                                    <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--silver)', fontSize: '0.72rem', fontWeight: 850 }}>{profile.totalAssets.toLocaleString()}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '7px' }}>
                                    <div>
                                        <div style={labelStyle}>Roster</div>
                                        <div style={{ ...mono, color: 'var(--white)', fontSize: '0.72rem', fontWeight: 850 }}>{profile.total.toLocaleString()}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>Picks</div>
                                        <div style={{ ...mono, color: profile.pickCapital.totalValue >= myProfile.pickCapital.totalValue ? '#2ECC71' : 'var(--silver)', fontSize: '0.72rem', fontWeight: 850 }}>{Math.round(profile.pickCapital.totalValue / 1000)}k</div>
                                        <div style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.56 }}>{profile.pickCapital.count} picks</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>FAAB</div>
                                        <div style={{ ...mono, color: profile.faab.isFaab ? (profile.faab.remaining >= myProfile.faab.remaining ? '#2ECC71' : 'var(--silver)') : 'rgba(255,255,255,0.32)', fontSize: '0.72rem', fontWeight: 850 }}>{profile.faab.isFaab ? '$' + profile.faab.remaining : '—'}</div>
                                        <div style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.56 }}>{profile.faab.isFaab ? profile.faab.pct + '%' : 'No FAAB'}</div>
                                    </div>
                                </div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.58, marginTop: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    Best picks: {profile.pickCapital.topPicks.length ? profile.pickCapital.topPicks.slice(0, 2).map(p => p.label).join(' · ') : 'None'}
                                </div>
                            </div>
                        ))}
                    </div>
                    {positionBreakdowns.map(summary => {
                        const maxTotalAtPos = Math.max(1, ...summary.columns.map(col => col.total));
                        return (
                            <div key={'field-breakdown-' + summary.pos} style={{ ...panelStyle, overflow: 'hidden', marginBottom: '12px' }}>
                                <div style={{ padding: '10px', background: (posColors[summary.pos] || '#666') + '14', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                    <div style={{ display: 'grid', gridTemplateColumns: '72px repeat(' + summary.columns.length + ', minmax(0, 1fr))', gap: '8px', alignItems: 'end' }}>
                                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.78rem', fontWeight: 900, color: posColors[summary.pos] || 'var(--silver)' }}>{summary.pos}</div>
                                        {summary.columns.map(column => {
                                            const isLeader = summary.leaderId === column.profile.rosterId;
                                            return (
                                                <div key={summary.pos + '-head-' + column.profile.rosterId} style={{ minWidth: 0 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '6px', alignItems: 'baseline' }}>
                                                        <span style={{ color: column.profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{column.profile.name}</span>
                                                        <span style={{ ...mono, color: isLeader ? '#2ECC71' : 'var(--silver)', fontSize: '0.68rem', fontWeight: 850 }}>{column.total.toLocaleString()}</span>
                                                    </div>
                                                    <div style={{ height: '4px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden', marginTop: '5px' }}>
                                                        <div style={{ width: (column.total / maxTotalAtPos * 100) + '%', height: '100%', background: isLeader ? '#2ECC71' : column.profile.isMine ? 'var(--gold)' : '#7C6BF8' }}></div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                {Array.from({ length: summary.maxLen }).map((_, rowIdx) => {
                                    const rowBestDhq = Math.max(0, ...summary.columns.map(column => column.players[rowIdx]?.dhq || 0));
                                    return (
                                        <div key={summary.pos + '-row-' + rowIdx} style={{ display: 'grid', gridTemplateColumns: '72px repeat(' + summary.columns.length + ', minmax(0, 1fr))', gap: '8px', padding: '7px 10px', borderBottom: '1px solid rgba(255,255,255,0.035)', alignItems: 'stretch' }}>
                                            <div style={{ ...mono, color: 'var(--silver)', opacity: 0.56, fontSize: '0.68rem', alignSelf: 'center' }}>#{rowIdx + 1}</div>
                                            {summary.columns.map(column => (
                                                <div key={summary.pos + '-' + rowIdx + '-' + column.profile.rosterId} style={{ minWidth: 0 }}>
                                                    {renderFieldPlayerCell(column.players[rowIdx], column, rowBestDhq)}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            );
        };

        return (
            <div>
                <div style={{ ...panelStyle, padding: '18px 20px', marginBottom: '14px', background: 'linear-gradient(135deg, rgba(212,175,55,0.055), rgba(52,152,219,0.045))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '14px' }}>
                        <div>
                            <div style={labelStyle}>{fieldLabel}</div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: 'var(--white)', fontWeight: 850, letterSpacing: 0 }}>You vs {opponentProfiles.length} team field</div>
                            <div style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.72 }}>{fieldSub}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={labelStyle}>Field Read</div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.15rem', fontWeight: 850, color: myProfile.total >= fieldAvg ? '#2ECC71' : '#E74C3C', letterSpacing: 0 }}>
                                {myProfile.total >= fieldAvg ? 'You are above this field' : 'This field is above you'}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.7 }}>
                                {strongest?.pos || 'Roster'} is your best pressure point; {weakest?.pos || 'depth'} is the watch spot.
                            </div>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '9px' }}>
                        {fieldCards.map(card => (
                            <div key={card.label} style={{ padding: '10px', background: 'rgba(0,0,0,0.24)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '7px' }}>
                                <div style={labelStyle}>{card.label}</div>
                                <div style={{ ...mono, fontSize: '1rem', color: card.color, fontWeight: 850, marginTop: '5px' }}>{card.value}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.66, marginTop: '2px' }}>{card.sub}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))', gap: '14px', marginBottom: '14px' }}>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', marginBottom: '12px' }}>
                            <div>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 850, color: 'var(--white)', letterSpacing: 0 }}>Field Ranking</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66 }}>Roster value, starter value, draft capital, FAAB, and best player.</div>
                            </div>
                            <div style={{ ...mono, color: 'var(--gold)', fontWeight: 850 }}>{profiles.length} teams</div>
                        </div>
                        <div style={{ display: 'grid', gap: '7px' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '34px minmax(140px,1.15fr) minmax(74px,.58fr) minmax(74px,.58fr) minmax(74px,.58fr) minmax(58px,.46fr) minmax(54px,.4fr) minmax(52px,.4fr) minmax(86px,.62fr)', gap: '8px', padding: '0 9px 2px', fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.54, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                <span>#</span><span>Team</span><span>Assets</span><span>Roster</span><span>Start</span><span>Picks</span><span>FAAB</span><span>Rooms</span><span>Edge</span>
                            </div>
                            {sortedProfiles.map((profile, idx) => {
                                const roomsWon = allPositions.filter(pos => (profile.posTotals[pos] || 0) > (myProfile.posTotals[pos] || 0)).length;
                                const roomsLost = allPositions.filter(pos => (profile.posTotals[pos] || 0) < (myProfile.posTotals[pos] || 0)).length;
                                const diff = profile.totalAssets - myProfile.totalAssets;
                                return (
                                    <div key={profile.rosterId} style={{ display: 'grid', gridTemplateColumns: '34px minmax(140px,1.15fr) minmax(74px,.58fr) minmax(74px,.58fr) minmax(74px,.58fr) minmax(58px,.46fr) minmax(54px,.4fr) minmax(52px,.4fr) minmax(86px,.62fr)', gap: '8px', alignItems: 'center', padding: '8px 9px', borderRadius: '7px', background: profile.isMine ? 'rgba(212,175,55,0.11)' : 'rgba(255,255,255,0.025)', border: '1px solid ' + (profile.isMine ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.055)'), fontSize: '0.72rem' }}>
                                        <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--silver)', fontWeight: 850 }}>#{idx + 1}</div>
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                                            <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.62 }}>{getDivisionName(profile.division)} - {profile.record}</div>
                                        </div>
                                        <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800 }}>{profile.totalAssets.toLocaleString()}</div>
                                        <div style={{ ...mono, color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800 }}>{profile.total.toLocaleString()}</div>
                                        <div>
                                            <div style={{ ...mono, color: 'var(--silver)', fontWeight: 800 }}>{profile.starterTotal.toLocaleString()}</div>
                                            <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}><div style={{ width: (profile.starterTotal / maxStarter * 100) + '%', height: '100%', background: profile.isMine ? 'var(--gold)' : '#7C6BF8' }}></div></div>
                                        </div>
                                        <div style={{ ...mono, color: profile.pickCapital.totalValue >= myProfile.pickCapital.totalValue ? '#2ECC71' : 'var(--silver)', fontWeight: 800 }}>{Math.round(profile.pickCapital.totalValue / 1000)}k</div>
                                        <div style={{ ...mono, color: profile.faab.isFaab ? (profile.faab.remaining >= myProfile.faab.remaining ? '#2ECC71' : 'var(--silver)') : 'rgba(255,255,255,0.32)', fontWeight: 800 }}>{profile.faab.isFaab ? '$' + profile.faab.remaining : '—'}</div>
                                        <div style={{ color: profile.isMine ? 'var(--silver)' : roomsWon > roomsLost ? '#E74C3C' : roomsWon < roomsLost ? '#2ECC71' : 'var(--silver)' }}>
                                            {profile.isMine ? 'You' : roomsWon + '-' + roomsLost}
                                        </div>
                                        <div style={{ minWidth: 0, color: profile.isMine ? 'var(--gold)' : diff > 0 ? '#E74C3C' : '#2ECC71', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {profile.isMine ? (profile.topPlayer?.p?.full_name || 'Top player') : (diff > 0 ? '+' : '') + diff.toLocaleString()}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 850, color: 'var(--white)', letterSpacing: 0, marginBottom: '12px' }}>Position Heatmap</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(112px,1.2fr) repeat(8,minmax(38px,1fr))', gap: '5px', alignItems: 'stretch' }}>
                            <div style={{ ...labelStyle }}>Team</div>
                            {allPositions.map(pos => <div key={pos} style={{ ...labelStyle, textAlign: 'center', color: posColors[pos] || 'var(--silver)' }}>{pos}</div>)}
                            {sortedProfiles.map(profile => (
                                <React.Fragment key={'hm-' + profile.rosterId}>
                                    <div style={{ padding: '7px 6px', borderRadius: '5px', background: profile.isMine ? 'rgba(212,175,55,0.11)' : 'rgba(255,255,255,0.025)', color: profile.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{profile.name}</div>
                                    {allPositions.map(pos => {
                                        const val = profile.posTotals[pos] || 0;
                                        const isBest = bestByPos[pos] === profile.rosterId;
                                        const isMine = profile.isMine;
                                        return (
                                            <div key={profile.rosterId + '-' + pos} title={profile.name + ' ' + pos + ': ' + val.toLocaleString()} style={{ padding: '6px 5px', borderRadius: '5px', background: isBest ? 'rgba(46,204,113,0.14)' : isMine ? 'rgba(212,175,55,0.09)' : 'rgba(255,255,255,0.025)', border: '1px solid ' + (isBest ? 'rgba(46,204,113,0.22)' : 'rgba(255,255,255,0.04)'), textAlign: 'center' }}>
                                                <div style={{ ...mono, fontSize: '0.66rem', color: isBest ? '#2ECC71' : isMine ? 'var(--gold)' : 'var(--silver)', fontWeight: 800 }}>{Math.round(val / 1000)}k</div>
                                                <div style={{ height: '3px', background: 'rgba(255,255,255,0.06)', borderRadius: '2px', marginTop: '4px', overflow: 'hidden' }}><div style={{ width: (val / maxByPos[pos] * 100) + '%', height: '100%', background: isBest ? '#2ECC71' : isMine ? 'var(--gold)' : '#7C6BF8' }}></div></div>
                                            </div>
                                        );
                                    })}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </div>

                {renderFieldRosterBreakdown()}

                {divisionKeys.length > 1 && (compareScope === 'division' || compareScope === 'league') ? (
                    <div style={{ ...panelStyle, padding: '14px', marginBottom: '14px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.05rem', fontWeight: 850, color: 'var(--white)', letterSpacing: 0, marginBottom: '10px' }}>Division Boards</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                            {Object.entries(divisionProfiles).sort(([a], [b]) => Number(a) - Number(b)).map(([key, list]) => (
                                <div key={key} style={{ padding: '10px', borderRadius: '7px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ color: 'var(--gold)', fontWeight: 850, marginBottom: '8px' }}>{getDivisionName(key)}</div>
                                    {[...list].sort((a, b) => b.total - a.total).map((p, idx) => (
                                        <div key={p.rosterId} style={{ display: 'grid', gridTemplateColumns: '24px 1fr auto', gap: '7px', alignItems: 'center', padding: '5px 0', borderTop: idx ? '1px solid rgba(255,255,255,0.045)' : 'none' }}>
                                            <div style={{ ...mono, color: p.isMine ? 'var(--gold)' : 'var(--silver)' }}>#{idx + 1}</div>
                                            <div style={{ color: p.isMine ? 'var(--gold)' : 'var(--white)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                                            <div style={{ ...mono, color: 'var(--silver)', fontSize: '0.68rem' }}>{p.total.toLocaleString()}</div>
                                        </div>
                                    ))}
                                </div>
                            ))}
                        </div>
                    </div>
                ) : null}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '8px' }}>
                    {profiles.map(renderTeamChip)}
                </div>
            </div>
        );
    };

    return (
      <div style={pageStyle}>
        <div className="wr-module-strip">
          <div className="wr-module-context">
            <span>Compare</span>
            <strong>{compareScope === 'duel' ? 'Head to Head' : compareScope === 'group' ? 'Custom Group' : compareScope === 'division' ? 'Division View' : 'League Field'}</strong>
            <em>Team edges, owner history, roster pressure, picks, and FAAB.</em>
          </div>
          <div className="wr-module-actions">
            {renderScopeControls()}
            {compareScope === 'duel' ? (
                <select className="wr-module-select" value={compareTeamId || ''} onChange={e => setCompareTeamId(e.target.value || null)} style={selectStyle}>
                  <option value="">Select team to compare...</option>
                  {opponentOptions.map(t => (
                    <option key={t.rosterId} value={String(t.rosterId)}>{t.name} ({t.wins || 0}-{t.losses || 0})</option>
                  ))}
                </select>
            ) : (
                <div style={{ ...mono, color: 'var(--silver)', fontSize: '0.76rem' }}>
                    {compareScope === 'group' ? (cleanManualIds.length >= 2 ? selectedGroupTeams.length + ' selected' : cleanManualIds.length ? cleanManualIds.length + ' of 2 needed' : 'default field')
                        : compareScope === 'division' ? getDivisionName(activeDivision)
                        : opponentOptions.length + ' opponents'}
                </div>
            )}
          </div>
        </div>

        {compareScope === 'duel' ? (
        <React.Fragment>
        {!compareTeamId && renderLanding()}

        {compareTeamId && (() => {
            const theirRoster = (currentLeague.rosters || []).find(r => sameId(r.roster_id, compareTeamId));
            if (!theirRoster) return renderLanding();

            const theirName = getOwnerName(theirRoster, 'Opponent');
            const myPlayers = myRoster.players || [];
            const theirPlayers = theirRoster.players || [];
            const theirTotal = getRosterTotal(theirRoster);
            const totalDhq = Math.max(1, myTotal + theirTotal);
            const myDhqPct = (myTotal / totalDhq) * 100;
            const myWins = myRoster.settings?.wins || 0;
            const myLosses = myRoster.settings?.losses || 0;
            const theirWins = theirRoster.settings?.wins || 0;
            const theirLosses = theirRoster.settings?.losses || 0;
            const myWinPct = (myWins + myLosses) > 0 ? myWins / (myWins + myLosses) : 0;
            const theirWinPct = (theirWins + theirLosses) > 0 ? theirWins / (theirWins + theirLosses) : 0;
            const myColor = 'var(--gold)';
            const theirColor = '#7C6BF8';
            const statsRef = statsData || {};
            const stats2025Ref = stats2025Data || {};
            const derivedStatsRef = window.S?.playerStats || {};
            const scoring = currentLeague?.scoring_settings || {};

            const calcPlayerPPG = (pid) => {
                const st = statsRef[pid] || statsRef[String(pid)] || statsData?.[pid] || {};
                const prev = stats2025Ref?.[pid] || stats2025Ref?.[String(pid)] || {};
                const curGP = Number(st.gp || 0);
                const prevGP = Number(prev.gp || 0);
                const curPts = curGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(st, scoring) : null;
                const prevPts = prevGP > 0 && typeof window.App?.calcRawPts === 'function' ? window.App.calcRawPts(prev, scoring) : null;
                const curPPG = curGP > 0 && curPts != null ? +(curPts / curGP).toFixed(1) : 0;
                const prevPPG = prevGP > 0 && prevPts != null ? +(prevPts / prevGP).toFixed(1) : 0;
                const derived = derivedStatsRef[pid] || derivedStatsRef[String(pid)] || {};
                return curPPG > 0 ? curPPG : prevPPG > 0 ? prevPPG : (derived.seasonAvg || derived.prevAvg || 0);
            };

            const starterDhq = (roster) => (roster?.starters || [])
                .filter(pid => pid && pid !== '0')
                .reduce((sum, pid) => sum + (scores[pid] || scores[String(pid)] || 0), 0);
            const myStarterDhq = starterDhq(myRoster);
            const theirStarterDhq = starterDhq(theirRoster);
            const myPickCapital = getDraftCapital(myRoster);
            const theirPickCapital = getDraftCapital(theirRoster);
            const myFaab = getFaab(myRoster);
            const theirFaab = getFaab(theirRoster);
            const myAssetTotal = myTotal + myPickCapital.totalValue;
            const theirAssetTotal = theirTotal + theirPickCapital.totalValue;
            const pickValueDiff = myPickCapital.totalValue - theirPickCapital.totalValue;
            const pickCountDiff = myPickCapital.count - theirPickCapital.count;
            const enrich = (pid) => {
                const p = playersData?.[pid] || playersData?.[String(pid)];
                if (!p) return null;
                const pos = normPos(p.position);
                const curve = typeof window.App?.getAgeCurve === 'function'
                    ? window.App.getAgeCurve(pos)
                    : { build: [22, 24], peak: (window.App?.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
                const [, pHi] = curve.peak || [24, 29];
                const declineHi = curve.decline?.[1] || 32;
                const age = p.age || null;
                return {
                    pid,
                    p,
                    pos,
                    dhq: scores[pid] || scores[String(pid)] || 0,
                    age,
                    team: p.team || 'FA',
                    yrsExp: p.years_exp || 0,
                    peakYrs: age ? Math.max(0, pHi - age) : 0,
                    valueYrs: age ? Math.max(0, declineHi - age) : 0,
                    ppg: calcPlayerPPG(pid),
                };
            };

            const enrichedMine = myPlayers.map(enrich).filter(Boolean);
            const enrichedTheirs = theirPlayers.map(enrich).filter(Boolean);
            const positionSummaries = allPositions.map(pos => {
                const myAtPos = enrichedMine.filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
                const theirAtPos = enrichedTheirs.filter(r => r.pos === pos).sort((a, b) => b.dhq - a.dhq);
                const myPosDHQ = myAtPos.reduce((s, x) => s + x.dhq, 0);
                const theirPosDHQ = theirAtPos.reduce((s, x) => s + x.dhq, 0);
                return {
                    pos,
                    myAtPos,
                    theirAtPos,
                    myPosDHQ,
                    theirPosDHQ,
                    diff: myPosDHQ - theirPosDHQ,
                    topMine: myAtPos[0],
                    topTheirs: theirAtPos[0],
                    count: Math.max(myAtPos.length, theirAtPos.length),
                };
            }).filter(p => p.count > 0);

            const youLead = positionSummaries.filter(p => p.diff > 0).length;
            const theyLead = positionSummaries.filter(p => p.diff < 0).length;
            const biggestEdges = [...positionSummaries].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 4);
            const leverage = [...positionSummaries].filter(p => p.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 2);
            const exposures = [...positionSummaries].filter(p => p.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 2);
            const verdict = myTotal >= theirTotal && youLead >= theyLead
                ? 'You hold the roster edge'
                : myTotal >= theirTotal
                    ? 'Your value edge is concentrated'
                    : youLead > theyLead
                        ? 'You win more rooms, they win bigger'
                        : 'Opponent has the roster edge';
            const verdictColor = myTotal >= theirTotal ? '#2ECC71' : '#E74C3C';

            const champs = window.App?.LI?.championships || {};
            const myChamps = Object.values(champs).filter(c => sameId(c.champion, myRoster.roster_id)).length;
            const theirChamps = Object.values(champs).filter(c => sameId(c.champion, compareTeamId)).length;
            const brackets = window.App?.LI?.bracketData || {};
            let myPW = 0, myPL = 0, theirPW = 0, theirPL = 0;
            Object.values(brackets).forEach(({ winners }) => {
                (winners || []).forEach(m => {
                    if (sameId(m.w, myRoster.roster_id)) myPW++;
                    if (sameId(m.l, myRoster.roster_id)) myPL++;
                    if (sameId(m.w, compareTeamId)) theirPW++;
                    if (sameId(m.l, compareTeamId)) theirPL++;
                });
            });

            const meetings = h2hState.loadedFor && sameId(h2hState.loadedFor, compareTeamId) ? h2hState.meetings : [];
            const h2hWins = meetings.filter(m => m.result === 'W').length;
            const h2hLosses = meetings.filter(m => m.result === 'L').length;
            const h2hTies = meetings.filter(m => m.result === 'T').length;
            const avgFor = meetings.length ? meetings.reduce((s, m) => s + m.myPoints, 0) / meetings.length : 0;
            const avgAgainst = meetings.length ? meetings.reduce((s, m) => s + m.theirPoints, 0) / meetings.length : 0;
            const lastMeeting = meetings[0];
            let streak = 'None';
            if (lastMeeting) {
                const streakResult = lastMeeting.result;
                let streakCount = 0;
                for (const m of meetings) {
                    if (m.result !== streakResult) break;
                    streakCount += 1;
                }
                streak = (streakResult === 'W' ? 'Won ' : streakResult === 'L' ? 'Lost ' : 'Tied ') + streakCount;
            }

            const statCards = [
                { label: 'Asset DHQ', value: (myAssetTotal - theirAssetTotal > 0 ? '+' : '') + (myAssetTotal - theirAssetTotal).toLocaleString(), sub: myAssetTotal.toLocaleString() + ' vs ' + theirAssetTotal.toLocaleString() + ' incl. picks', color: myAssetTotal >= theirAssetTotal ? '#2ECC71' : '#E74C3C' },
                { label: 'Roster DHQ', value: (myTotal - theirTotal > 0 ? '+' : '') + (myTotal - theirTotal).toLocaleString(), sub: myTotal.toLocaleString() + ' vs ' + theirTotal.toLocaleString(), color: myTotal >= theirTotal ? '#2ECC71' : '#E74C3C' },
                { label: 'Starter DHQ', value: (myStarterDhq - theirStarterDhq > 0 ? '+' : '') + (myStarterDhq - theirStarterDhq).toLocaleString(), sub: myStarterDhq.toLocaleString() + ' vs ' + theirStarterDhq.toLocaleString(), color: myStarterDhq >= theirStarterDhq ? '#2ECC71' : '#E74C3C' },
                { label: 'Pick Value', value: (pickValueDiff > 0 ? '+' : '') + pickValueDiff.toLocaleString(), sub: Math.round(myPickCapital.totalValue / 1000) + 'k vs ' + Math.round(theirPickCapital.totalValue / 1000) + 'k pick DHQ', color: pickValueDiff >= 0 ? '#2ECC71' : '#E74C3C' },
                { label: 'Pick Count', value: (pickCountDiff > 0 ? '+' : '') + pickCountDiff, sub: myPickCapital.count + ' picks vs ' + theirPickCapital.count + ' picks', color: pickCountDiff >= 0 ? '#2ECC71' : '#E74C3C' },
                { label: 'FAAB', value: myFaab.isFaab ? ((myFaab.remaining - theirFaab.remaining > 0 ? '+$' : '-$') + Math.abs(myFaab.remaining - theirFaab.remaining).toLocaleString()) : '—', sub: myFaab.isFaab ? '$' + myFaab.remaining + ' vs $' + theirFaab.remaining + ' left' : 'No FAAB budget', color: !myFaab.isFaab ? 'var(--silver)' : myFaab.remaining >= theirFaab.remaining ? '#2ECC71' : '#E74C3C' },
                { label: 'Position Edges', value: youLead + '-' + theyLead, sub: 'rooms won', color: youLead >= theyLead ? '#2ECC71' : '#E74C3C' },
                { label: 'All-Time H2H', value: h2hState.loading ? 'Loading' : h2hWins + '-' + h2hLosses + (h2hTies ? '-' + h2hTies : ''), sub: meetings.length ? avgFor.toFixed(1) + '-' + avgAgainst.toFixed(1) + ' avg' : (h2hState.error || 'no meetings found'), color: h2hWins >= h2hLosses ? '#2ECC71' : '#E74C3C' },
                { label: 'Titles', value: myChamps + '-' + theirChamps, sub: 'championships', color: myChamps >= theirChamps ? '#2ECC71' : '#E74C3C' },
                { label: 'Playoffs', value: myPW + '-' + myPL + ' / ' + theirPW + '-' + theirPL, sub: 'you / them', color: myPW >= theirPW ? '#2ECC71' : '#E74C3C' },
            ];

            const renderMiniPlayer = (r) => r
                ? <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.p?.full_name || '?'}</span>
                : <span style={{ color: 'var(--silver)', opacity: 0.38 }}>No player</span>;

            const openCard = (pid) => {
                if (!pid) return;
                if (window.WR && typeof window.WR.openPlayerCard === 'function') window.WR.openPlayerCard(pid);
                else if (typeof window._wrSelectPlayer === 'function') window._wrSelectPlayer(pid);
            };

            const renderRosterCell = (r, opponent, rival) => {
                if (!r) return <span style={{ color: 'var(--silver)', opacity: 0.32, fontSize: '0.72rem', padding: '7px 10px', display: 'inline-block' }}>-</span>;
                const dhqCol = r.dhq >= 7000 ? '#2ECC71' : r.dhq >= 4000 ? '#3498DB' : r.dhq >= 1000 ? 'var(--silver)' : 'rgba(255,255,255,0.5)';
                const winsDhq = rival && r.dhq > rival.dhq;
                return (
                    <div onClick={() => openCard(r.pid)} style={{
                        padding: '7px 10px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        fontSize: '0.78rem',
                        background: winsDhq ? 'rgba(46,204,113,0.045)' : 'transparent',
                        cursor: 'pointer',
                        borderRight: opponent ? 'none' : '1px solid rgba(255,255,255,0.04)',
                    }}>
                        <img src={'https://sleepercdn.com/content/nfl/players/thumb/'+r.pid+'.jpg'} onError={e=>e.target.style.display='none'} style={{ width:'22px',height:'22px',borderRadius:'50%',objectFit:'cover', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'var(--white)', fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.p?.full_name || '?'}</div>
                            <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.68, marginTop: '1px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                <span>{r.team}</span>
                                {r.age != null ? <span>{r.age}yo</span> : null}
                                {r.ppg > 0 ? <span>{r.ppg} PPG</span> : null}
                                <span>{r.yrsExp}y exp</span>
                                <span>{r.peakYrs > 0 ? r.peakYrs + 'yr peak' : r.valueYrs + 'yr value'}</span>
                            </div>
                        </div>
                        <span style={{ ...mono, fontWeight: 700, fontSize: '0.76rem', color: dhqCol, flexShrink: 0 }}>{r.dhq > 0 ? r.dhq.toLocaleString() : '-'}</span>
                    </div>
                );
            };

            return (
              <div>
                <div style={{ ...panelStyle, padding: '18px 20px', marginBottom: '16px', background: 'linear-gradient(135deg, rgba(212,175,55,0.065), rgba(124,107,248,0.055))' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 1fr) minmax(220px, 0.9fr) minmax(180px, 1fr)', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
                        <div>
                            <div style={labelStyle}>You</div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: myColor, fontWeight: 800, letterSpacing: 0 }}>{myName}</div>
                            <div style={{ ...mono, fontSize: '0.82rem', color: 'var(--silver)' }}>{myWins}-{myLosses} current record</div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ ...labelStyle, marginBottom: '4px' }}>Matchup Read</div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.25rem', fontWeight: 800, color: verdictColor, letterSpacing: 0 }}>{verdict}</div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.72, marginTop: '3px' }}>
                                {biggestEdges[0]?.pos || 'Roster'} is the biggest swing: {(biggestEdges[0]?.diff || 0) > 0 ? '+' : ''}{(biggestEdges[0]?.diff || 0).toLocaleString()} DHQ.
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={labelStyle}>Opponent</div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: theirColor, fontWeight: 800, letterSpacing: 0 }}>{theirName}</div>
                            <div style={{ ...mono, fontSize: '0.82rem', color: 'var(--silver)' }}>{theirWins}-{theirLosses} current record</div>
                        </div>
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '6px' }}>
                            <span style={{ ...mono, color: myColor, fontWeight: 800 }}>{myTotal.toLocaleString()} <span style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6 }}>DHQ</span></span>
                            <span style={{ ...labelStyle, alignSelf: 'center' }}>Roster Share</span>
                            <span style={{ ...mono, color: theirColor, fontWeight: 800 }}>{theirTotal.toLocaleString()} <span style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6 }}>DHQ</span></span>
                        </div>
                        <div style={{ display: 'flex', height: '12px', borderRadius: '6px', overflow: 'hidden', background: 'rgba(255,255,255,0.055)' }}>
                            <div style={{ width: myDhqPct + '%', background: 'linear-gradient(90deg, var(--gold), rgba(212,175,55,0.78))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '6px', fontSize: '0.58rem', color: '#0A0A0A', fontWeight: 800 }}>
                                {myDhqPct >= 12 ? Math.round(myDhqPct) + '%' : ''}
                            </div>
                            <div style={{ width: (100 - myDhqPct) + '%', background: 'linear-gradient(90deg, rgba(124,107,248,0.78), #7C6BF8)', display: 'flex', alignItems: 'center', paddingLeft: '6px', fontSize: '0.58rem', color: '#0A0A0A', fontWeight: 800 }}>
                                {(100 - myDhqPct) >= 12 ? Math.round(100 - myDhqPct) + '%' : ''}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '9px' }}>
                        {statCards.map(card => (
                            <div key={card.label} style={{ padding: '10px', background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '7px' }}>
                                <div style={labelStyle}>{card.label}</div>
                                <div style={{ ...mono, fontSize: '1rem', fontWeight: 800, color: card.color, marginTop: '5px' }}>{card.value}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.64, marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.sub}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(340px, 0.75fr)', gap: '14px', marginBottom: '16px' }}>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <div>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontWeight: 800, fontSize: '1.05rem', letterSpacing: 0 }}>Position Edge Matrix</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66 }}>Total roster value by room, sorted by positional importance.</div>
                            </div>
                            <div style={{ ...mono, fontSize: '0.82rem', color: youLead >= theyLead ? '#2ECC71' : '#E74C3C', fontWeight: 800 }}>{youLead}-{theyLead}</div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '9px' }}>
                            {positionSummaries.map(summary => {
                                const total = Math.max(1, summary.myPosDHQ + summary.theirPosDHQ);
                                const minePct = summary.myPosDHQ / total * 100;
                                const edgeColor = summary.diff > 0 ? '#2ECC71' : summary.diff < 0 ? '#E74C3C' : 'var(--silver)';
                                return (
                                    <div key={summary.pos} style={{ padding: '10px', background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '7px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '7px' }}>
                                            <span style={{ fontWeight: 900, color: posColors[summary.pos] || 'var(--gold)' }}>{summary.pos}</span>
                                            <span style={{ ...mono, color: edgeColor, fontWeight: 800, fontSize: '0.78rem' }}>{summary.diff > 0 ? '+' : ''}{summary.diff.toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', height: '5px', borderRadius: '3px', overflow: 'hidden', background: 'rgba(255,255,255,0.06)', marginBottom: '8px' }}>
                                            <div style={{ width: minePct + '%', background: 'var(--gold)' }}></div>
                                            <div style={{ width: (100 - minePct) + '%', background: theirColor }}></div>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.68rem' }}>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ color: myColor, fontWeight: 800, marginBottom: '2px' }}>{summary.myPosDHQ.toLocaleString()}</div>
                                                <div style={muted}>{renderMiniPlayer(summary.topMine)}</div>
                                            </div>
                                            <div style={{ minWidth: 0, textAlign: 'right' }}>
                                                <div style={{ color: theirColor, fontWeight: 800, marginBottom: '2px' }}>{summary.theirPosDHQ.toLocaleString()}</div>
                                                <div style={muted}>{renderMiniPlayer(summary.topTheirs)}</div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontWeight: 800, fontSize: '1.05rem', letterSpacing: 0, marginBottom: '10px' }}>H2H History</div>
                        {h2hState.loading ? (
                            <div style={{ color: 'var(--silver)', fontSize: '0.82rem', padding: '10px 0' }}>Loading owner-vs-owner history...</div>
                        ) : meetings.length ? (
                            <React.Fragment>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '10px' }}>
                                    {[
                                        ['Record', h2hWins + '-' + h2hLosses + (h2hTies ? '-' + h2hTies : '')],
                                        ['Last', lastMeeting ? lastMeeting.season + ' W' + lastMeeting.week : '-'],
                                        ['Streak', streak],
                                    ].map(([label, value]) => (
                                        <div key={label} style={{ padding: '8px', background: 'rgba(255,255,255,0.03)', borderRadius: '6px' }}>
                                            <div style={labelStyle}>{label}</div>
                                            <div style={{ ...mono, fontWeight: 800, color: 'var(--white)', fontSize: '0.82rem', marginTop: '4px' }}>{value}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ display: 'grid', gap: '6px' }}>
                                    {meetings.slice(0, 6).map(m => (
                                        <div key={m.season + '-' + m.week + '-' + m.matchupId} style={{ display: 'grid', gridTemplateColumns: '60px 1fr auto', alignItems: 'center', gap: '8px', padding: '7px 8px', background: 'rgba(255,255,255,0.025)', borderRadius: '6px', fontSize: '0.74rem' }}>
                                            <div style={{ ...mono, color: 'var(--silver)', opacity: 0.72 }}>{m.season} W{m.week}</div>
                                            <div style={{ color: m.result === 'W' ? '#2ECC71' : m.result === 'L' ? '#E74C3C' : 'var(--silver)', fontWeight: 800 }}>{m.result} {m.myPoints.toFixed(2)}-{m.theirPoints.toFixed(2)}</div>
                                            <div style={{ ...mono, color: m.margin >= 0 ? '#2ECC71' : '#E74C3C' }}>{m.margin > 0 ? '+' : ''}{m.margin.toFixed(2)}</div>
                                        </div>
                                    ))}
                                    {meetings.length > 6 ? <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.58, textAlign: 'center', paddingTop: '4px' }}>+{meetings.length - 6} older meetings cached</div> : null}
                                </div>
                            </React.Fragment>
                        ) : (
                            <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.8rem', lineHeight: 1.45 }}>
                                {h2hState.error || 'No completed regular-season meetings found between these current owners.'}
                            </div>
                        )}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ ...labelStyle, color: 'var(--gold)', opacity: 1, marginBottom: '8px' }}>Where you can press</div>
                        {leverage.length ? leverage.map(item => (
                            <div key={item.pos} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <span style={{ color: posColors[item.pos] || 'var(--white)', fontWeight: 800 }}>{item.pos}</span>
                                <span style={{ color: 'var(--silver)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderMiniPlayer(item.topMine)} over {renderMiniPlayer(item.topTheirs)}</span>
                                <span style={{ ...mono, color: '#2ECC71', fontWeight: 800 }}>+{item.diff.toLocaleString()}</span>
                            </div>
                        )) : <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.8rem' }}>No clear surplus edge. This matchup is more about player-level choices.</div>}
                    </div>
                    <div style={{ ...panelStyle, padding: '14px' }}>
                        <div style={{ ...labelStyle, color: '#E74C3C', opacity: 1, marginBottom: '8px' }}>Where they can hurt you</div>
                        {exposures.length ? exposures.map(item => (
                            <div key={item.pos} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '7px 0', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <span style={{ color: posColors[item.pos] || 'var(--white)', fontWeight: 800 }}>{item.pos}</span>
                                <span style={{ color: 'var(--silver)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{renderMiniPlayer(item.topTheirs)} over {renderMiniPlayer(item.topMine)}</span>
                                <span style={{ ...mono, color: '#E74C3C', fontWeight: 800 }}>{item.diff.toLocaleString()}</span>
                            </div>
                        )) : <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.8rem' }}>No obvious room where this opponent has a strong value edge.</div>}
                    </div>
                </div>

                <div style={{ ...panelStyle, padding: '14px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'baseline', marginBottom: '10px' }}>
                        <div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontWeight: 800, fontSize: '1.05rem', letterSpacing: 0 }}>Draft Picks & FAAB</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66 }}>Future capital is included in Asset DHQ; FAAB stays separate as waiver leverage.</div>
                        </div>
                        <div style={{ ...mono, color: myAssetTotal >= theirAssetTotal ? '#2ECC71' : '#E74C3C', fontWeight: 850 }}>{myAssetTotal >= theirAssetTotal ? '+' : ''}{(myAssetTotal - theirAssetTotal).toLocaleString()} assets</div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        {[
                            { name: myName, pickCapital: myPickCapital, faab: myFaab, assetTotal: myAssetTotal, mine: true },
                            { name: theirName, pickCapital: theirPickCapital, faab: theirFaab, assetTotal: theirAssetTotal, mine: false },
                        ].map(side => (
                            <div key={side.name} style={{ padding: '10px', borderRadius: '7px', background: side.mine ? 'rgba(212,175,55,0.08)' : 'rgba(124,107,248,0.055)', border: '1px solid ' + (side.mine ? 'rgba(212,175,55,0.24)' : 'rgba(124,107,248,0.18)') }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'baseline', marginBottom: '8px' }}>
                                    <div style={{ color: side.mine ? myColor : theirColor, fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{side.name}</div>
                                    <div style={{ ...mono, color: 'var(--white)', fontSize: '0.76rem', fontWeight: 850 }}>{side.assetTotal.toLocaleString()}</div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '8px' }}>
                                    <div>
                                        <div style={labelStyle}>Pick Value</div>
                                        <div style={{ ...mono, color: side.pickCapital.totalValue >= myPickCapital.totalValue ? '#2ECC71' : 'var(--silver)', fontWeight: 850 }}>{Math.round(side.pickCapital.totalValue / 1000)}k</div>
                                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.58 }}>draft DHQ</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>Pick Count</div>
                                        <div style={{ ...mono, color: side.pickCapital.count >= myPickCapital.count ? '#2ECC71' : 'var(--silver)', fontWeight: 850 }}>{side.pickCapital.count}</div>
                                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.58 }}>{Object.entries(side.pickCapital.byRound || {}).slice(0, 3).map(([rd, ct]) => 'R' + rd + ':' + ct).join('  ') || 'No picks'}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>Best Picks</div>
                                        <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.76, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{side.pickCapital.topPicks.length ? side.pickCapital.topPicks.slice(0, 2).map(p => p.label).join(' · ') : 'None'}</div>
                                    </div>
                                    <div>
                                        <div style={labelStyle}>FAAB</div>
                                        <div style={{ ...mono, color: side.faab.isFaab ? (side.faab.remaining >= myFaab.remaining ? '#2ECC71' : 'var(--silver)') : 'rgba(255,255,255,0.32)', fontWeight: 850 }}>{side.faab.isFaab ? '$' + side.faab.remaining : '—'}</div>
                                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.58 }}>{side.faab.isFaab ? side.faab.pct + '% left' : 'No FAAB'}</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.72rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Full Roster by Position</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.62 }}>Click any player to open the player card.</div>
                    </div>
                    {positionSummaries.map(summary => {
                        const maxLen = Math.max(summary.myAtPos.length, summary.theirAtPos.length);
                        const total = Math.max(1, summary.myPosDHQ + summary.theirPosDHQ);
                        const myPosPct = summary.myPosDHQ / total * 100;
                        return (
                            <div key={summary.pos} style={{ marginBottom: '12px', ...panelStyle, overflow: 'hidden' }}>
                                <div style={{ padding: '9px 10px 10px', background: (posColors[summary.pos] || '#666') + '14', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', gap: '10px' }}>
                                        <span style={{ fontFamily: 'var(--font-body)', fontSize: '0.75rem', fontWeight: 900, color: posColors[summary.pos] || 'var(--silver)' }}>{summary.pos}</span>
                                        <div style={{ display: 'flex', gap: '12px', fontSize: '0.72rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                                            <span style={{ color: summary.myPosDHQ >= summary.theirPosDHQ ? '#2ECC71' : 'var(--silver)' }}>You: {summary.myPosDHQ.toLocaleString()}</span>
                                            <span style={{ color: summary.theirPosDHQ >= summary.myPosDHQ ? '#2ECC71' : 'var(--silver)' }}>Them: {summary.theirPosDHQ.toLocaleString()}</span>
                                            <span style={{ fontWeight: 800, color: summary.diff > 0 ? '#2ECC71' : summary.diff < 0 ? '#E74C3C' : 'var(--silver)' }}>{summary.diff > 0 ? '+' : ''}{summary.diff.toLocaleString()}</span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
                                        <div title={'You: ' + Math.round(myPosPct) + '%'} style={{ width: myPosPct + '%', background: 'linear-gradient(90deg, var(--gold), rgba(212,175,55,0.78))', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: '4px', fontSize: '0.5rem', color: '#0A0A0A', fontWeight: 800 }}>
                                            {myPosPct >= 18 ? Math.round(myPosPct) + '%' : ''}
                                        </div>
                                        <div title={'Them: ' + Math.round(100 - myPosPct) + '%'} style={{ width: (100 - myPosPct) + '%', background: 'linear-gradient(90deg, rgba(124,107,248,0.76), #7C6BF8)', display: 'flex', alignItems: 'center', paddingLeft: '4px', fontSize: '0.5rem', color: '#0A0A0A', fontWeight: 800 }}>
                                            {(100 - myPosPct) >= 18 ? Math.round(100 - myPosPct) + '%' : ''}
                                        </div>
                                    </div>
                                </div>
                                {Array.from({ length: maxLen }).map((_, i) => {
                                    const mine = summary.myAtPos[i];
                                    const theirs = summary.theirAtPos[i];
                                    return (
                                        <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                                            {renderRosterCell(mine, false, theirs)}
                                            {renderRosterCell(theirs, true, mine)}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
              </div>
            );
          })()}
        </React.Fragment>
        ) : (
        <React.Fragment>
            {renderFieldControls()}
            {compareScope === 'group'
                ? renderFieldAnalysis(selectedGroupTeams, 'Custom Group', cleanManualIds.length >= 2 ? 'Manual selection across the league.' : 'Showing a default 3-team field until you pick at least 2 teams.')
                : compareScope === 'division'
                    ? renderFieldAnalysis(selectedDivisionTeams, getDivisionName(activeDivision), 'Division lens using Sleeper roster division settings.')
                    : renderFieldAnalysis(selectedLeagueTeams, 'Full League', 'Every opponent in the league, ranked against your roster.')}
        </React.Fragment>
        )}
      </div>
    );
}

window.CompareTab = CompareTab;

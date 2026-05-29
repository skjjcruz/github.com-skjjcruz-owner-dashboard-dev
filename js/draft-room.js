// ══════════════════════════════════════════════════════════════════
// draft-room.js — DraftTab component (Flash Brief, Big Board)
// ══════════════════════════════════════════════════════════════════
    const DRAFT_WR_KEYS  = window.App.WR_KEYS;
    const DraftStorage = window.App.WrStorage;
    // ══════════════════════════════════════════════════════════════════════════
    // END FREE AGENCY TAB
    // ══════════════════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════════════════
    // DRAFT TAB — migrated from draft-warroom.html
    // ══════════════════════════════════════════════════════════════════════════
    function DraftTab({ playersData, statsData, myRoster, currentLeague, leagueSkin, sleeperUserId, setReconPanelOpen, sendReconMessage, timeRecomputeTs, viewMode }) {
        const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
        const skinFeatures = resolvedLeagueSkin?.features || {};
        const valueShortLabel = resolvedLeagueSkin?.vocabulary?.valueShortLabel || 'DHQ';
        const draftCapitalLabel = skinFeatures.showFuturePicks === false ? 'draft capital' : 'future capital';
        const leagueKey = currentLeague?.league_id || currentLeague?.id || '';
        const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
        const fallbackDraftRounds = currentLeague.settings?.draft_rounds || 5;
        const sameId = (a, b) => String(a ?? '') === String(b ?? '');
        const [draftSort, setDraftSort] = useState({ key: 'dhq', dir: -1 });
        const [draftView, setDraftView] = useState('command'); // 'command' | 'board' | 'mock' | 'live'
        const [draftInfo, setDraftInfo] = useState(null);
        const draftVariant = useMemo(() => {
            try {
                return window.DraftCC?.state?.detectDraftVariant?.({
                    currentLeague,
                    draft: draftInfo,
                    fallback: 'rookie',
                }) || 'rookie';
            } catch (e) {
                return 'rookie';
            }
        }, [currentLeague, draftInfo, timeRecomputeTs]);
        const isRookieDraft = draftVariant === 'rookie';
        const isSeasonalDraft = !isRookieDraft && (resolvedLeagueSkin?.state?.isSeasonal || skinFeatures.showFuturePicks === false);
        const draftRounds = useMemo(() => {
            return window.App?.LeagueSkin?.resolveDraftRounds?.({
                league: currentLeague,
                leagueSkin: resolvedLeagueSkin,
                draft: draftInfo,
                drafts: window.S?.drafts || currentLeague?.drafts || [],
                fallbackRounds: fallbackDraftRounds,
            }) || fallbackDraftRounds;
        }, [currentLeague, resolvedLeagueSkin, draftInfo, fallbackDraftRounds, timeRecomputeTs]);
        const draftPoolNoun = isRookieDraft ? 'prospects' : 'players';
        const pickYears = useMemo(
            () => skinFeatures.showFuturePicks === false ? [leagueSeason] : [leagueSeason, leagueSeason + 1, leagueSeason + 2],
            [leagueSeason, skinFeatures.showFuturePicks]
        );
        const boardStorageKey = DRAFT_WR_KEYS.BIGBOARD_DRAFT
            ? DRAFT_WR_KEYS.BIGBOARD_DRAFT(leagueKey, draftVariant)
            : DRAFT_WR_KEYS.BIGBOARD(leagueKey);
        const [boardData, setBoardData] = useState(() => DraftStorage.get(boardStorageKey, DraftStorage.get(DRAFT_WR_KEYS.BIGBOARD(leagueKey), null)));
        const [draftedPids, setDraftedPids] = useState(new Set());
        const [boardNotes, setBoardNotes] = useState({});
        const [boardTags, setBoardTags] = useState({}); // pid -> 'target'|'avoid'|'sleeper'|'must'
        const [boardMode, setBoardMode] = useState('dhq'); // 'dhq' | 'ai' | 'my'
        const [myBoardOrder, setMyBoardOrder] = useState([]); // custom ordered pid array
        const [boardPosFilter, setBoardPosFilter] = useState(''); // '' | 'QB' | 'RB' | 'WR' | 'TE' | 'DL' | 'LB' | 'DB'
        const [boardTeamFilter, setBoardTeamFilter] = useState(''); // '' | NFL team abbr
        const [boardRoundFilter, setBoardRoundFilter] = useState(''); // '' | '1'..'7' | 'UDFA'
        const [boardSort, setBoardSort] = useState({ key: 'dhq', dir: -1 }); // sortable columns
        const [expandedDraftPid, setExpandedDraftPid] = useState(null);
        const [scoutDrawerPid, setScoutDrawerPid] = useState(null);
        const [dragPid, setDragPid] = useState(null); // currently dragging pid
        const [draftStrategyEditing, setDraftStrategyEditing] = useState(false);
        const draftStrategyKey = 'wr_draft_strategy_' + leagueKey;
        const [customDraftStrategy, setCustomDraftStrategy] = useState(() => {
            try { return localStorage.getItem(draftStrategyKey) || ''; } catch(e) { return ''; }
        });
        const [pickFocus, setPickFocus] = useState(() => window._wrDraftPickFocus || null);
        const [flashAnalystPresetId, setFlashAnalystPresetId] = useState('league-history');
        const [flashAnalystRoundLimit, setFlashAnalystRoundLimit] = useState('1');
        const [flashAnalystReports, setFlashAnalystReports] = useState([]);
        const [flashAnalystStatus, setFlashAnalystStatus] = useState('idle');
        const [flashAnalystError, setFlashAnalystError] = useState('');
        const [showFuturePickCapital, setShowFuturePickCapital] = useState(false);
        const [liveAutoStartToken, setLiveAutoStartToken] = useState(0);

        const tradedPicks = useMemo(() => {
            const leagueRows = Array.isArray(currentLeague?.tradedPicks) ? currentLeague.tradedPicks : [];
            const globalRows = Array.isArray(window.S?.tradedPicks) ? window.S.tradedPicks : [];
            const taggedGlobalRows = globalRows.filter(p => {
                const pickLeague = p?.league_id || p?.leagueId;
                return pickLeague && sameId(pickLeague, leagueKey);
            });
            const rosterIds = new Set((currentLeague?.rosters || []).map(r => String(r?.roster_id ?? '')).filter(Boolean));
            const activeSeasons = new Set([leagueSeason, leagueSeason + 1, leagueSeason + 2].map(String));
            const untaggedGlobalRows = globalRows.filter(p => {
                if (p?.league_id || p?.leagueId) return false;
                if (!activeSeasons.has(String(p?.season ?? ''))) return false;
                return rosterIds.has(String(p?.roster_id ?? '')) || rosterIds.has(String(p?.owner_id ?? ''));
            });
            const exactRows = [...leagueRows, ...taggedGlobalRows];
            const sourceRows = exactRows.length ? exactRows : untaggedGlobalRows;
            const seen = new Set();
            return sourceRows.filter(p => {
                const key = [p?.season, p?.round, p?.roster_id, p?.owner_id].map(v => String(v ?? '')).join(':');
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
        }, [currentLeague?.tradedPicks, currentLeague?.rosters, leagueKey, leagueSeason, timeRecomputeTs]);

        useEffect(() => {
            const openPickFocus = (event) => {
                const next = event?.detail || window._wrDraftPickFocus || null;
                if (!next) return;
                setPickFocus(next);
                setDraftView('command');
            };
            window.addEventListener('wr:open-draft-pick-context', openPickFocus);
            openPickFocus({ detail: window._wrDraftPickFocus });
            return () => window.removeEventListener('wr:open-draft-pick-context', openPickFocus);
        }, []);

        const normPos = window.App.normPos;
        const posLabel = pos => window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos);
        const rosterState = window.App?.getRosterDataState?.({ roster: myRoster, currentLeague, rosters: currentLeague?.rosters }) || { isUsable: true };
        const leagueSize = currentLeague?.rosters?.length || currentLeague?.settings?.num_teams || window.S?.rosters?.length || 12;
        const [rookieMarket, setRookieMarket] = useState({ rows: {}, ladders: {}, scaleFactor: 1 });

        useEffect(() => {
            let cancelled = false;
            const scoring = currentLeague?.scoring_settings || {};
            const rosterPositions = currentLeague?.roster_positions || [];
            const isSF = rosterPositions.some(slot => ['SUPER_FLEX', 'QB_FLEX', 'OP'].includes(String(slot).toUpperCase()));
            const pprVal = scoring.rec != null && scoring.rec >= 0.9 ? 1 : scoring.rec != null && scoring.rec >= 0.4 ? 0.5 : 0;
            const totalTeams = currentLeague?.rosters?.length || window.S?.rosters?.length || 12;
            const url = `https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=${isSF ? 2 : 1}&numTeams=${totalTeams}&ppr=${pprVal}`;
            fetch(url)
                .then(r => r.ok ? r.json() : [])
                .then(data => {
                    if (cancelled || !Array.isArray(data) || !data.length) return;
                    const scores = window.App?.LI?.playerScores || {};
                    const matched = data
                        .filter(d => {
                            const sid = d.player?.sleeperId;
                            return sid && d.player?.position !== 'PICK' && d.value > 0 && scores[sid] > 0 && playersData?.[sid]?.years_exp !== 0;
                        })
                        .map(d => ({ sid: d.player.sleeperId, fcVal: d.value, dhqVal: scores[d.player.sleeperId] }))
                        .sort((a, b) => b.fcVal - a.fcVal);
                    let scaleFactor = 1;
                    if (matched.length >= 10) {
                        const ratios = matched.slice(0, 20).map(m => m.dhqVal / m.fcVal).sort((a, b) => a - b);
                        scaleFactor = ratios[Math.floor(ratios.length / 2)] || 1;
                    }
                    const rows = {};
                    data.forEach(d => {
                        const sid = d.player?.sleeperId;
                        if (!sid || d.player?.position === 'PICK' || !d.value) return;
                        rows[sid] = {
                            value: d.value,
                            scaled: Math.round(d.value * scaleFactor),
                            overallRank: d.overallRank || 999,
                            positionRank: d.positionRank || 999,
                        };
                    });
                    const meta = window.App?.LI?.playerMeta || {};
                    const ladders = {};
                    ['QB', 'RB', 'WR', 'TE'].forEach(pos => {
                        ladders[pos] = Object.entries(scores)
                            .filter(([sid, score]) => {
                                if (!score || score <= 0) return false;
                                if (playersData?.[sid]?.years_exp === 0) return false;
                                const playerPos = normPos(meta[sid]?.pos || playersData?.[sid]?.position || '');
                                return playerPos === pos;
                            })
                            .sort((a, b) => b[1] - a[1])
                            .map(([, score]) => score);
                    });
                    window.App._rookieMarketRows = rows;
                    setRookieMarket({ rows, ladders, scaleFactor });
                })
                .catch(e => { if (window.wrLog) window.wrLog('draft.rookieMarket', e); });
            return () => { cancelled = true; };
        }, [currentLeague?.league_id, currentLeague?.id, currentLeague?.season, playersData, timeRecomputeTs]);

        const rookiePeerMultiplier = (pos, positionRank) => {
            if (pos === 'RB') {
                if (positionRank <= 5) return 1.08;
                if (positionRank <= 12) return 1.00;
                if (positionRank <= 24) return 0.94;
                return 0.86;
            }
            if (pos === 'WR') {
                if (positionRank <= 12) return 1.02;
                if (positionRank <= 24) return 0.96;
                if (positionRank <= 36) return 0.90;
                return 0.82;
            }
            if (pos === 'QB') {
                if (positionRank <= 12) return 0.96;
                if (positionRank <= 24) return 0.90;
                return 0.80;
            }
            if (pos === 'TE') {
                if (positionRank <= 6) return 0.96;
                if (positionRank <= 18) return 0.88;
                return 0.80;
            }
            return 0.90;
        };

        const calibratedRookieDHQ = (pid, player, engineDHQ) => {
            const row = rookieMarket.rows?.[pid];
            const pos = normPos(player?.position);
            if (!row || !['QB', 'RB', 'WR', 'TE'].includes(pos)) return engineDHQ || 0;
            const marketDHQ = row.scaled || row.value || 0;
            if (!marketDHQ) return engineDHQ || 0;
            const ladder = rookieMarket.ladders?.[pos] || [];
            const peerDHQ = ladder[Math.max(0, row.positionRank - 1)] || 0;
            const peerTarget = peerDHQ ? Math.round(peerDHQ * rookiePeerMultiplier(pos, row.positionRank)) : 0;
            const base = peerTarget || marketDHQ;
            const marketGuard = row.value ? Math.round(row.value * (pos === 'RB' ? 0.85 : pos === 'WR' ? 0.82 : 0.72)) : 0;
            const calibrated = Math.round(base * 0.80 + marketDHQ * 0.20);
            return Math.min(10000, Math.max(marketGuard, calibrated));
        };

        // Build my picks
        const myPicks = useMemo(() => {
            const picks = [];
            const myRid = myRoster?.roster_id;
            if (myRid == null) return picks;
            pickYears.forEach(yr => {
                for (let rd = 1; rd <= draftRounds; rd++) {
                    const tradedAway = tradedPicks.find(p =>
                        parseInt(p.season, 10) === yr
                        && Number(p.round) === rd
                        && sameId(p.roster_id, myRid)
                        && !sameId(p.owner_id, myRid)
                    );
                    if (!tradedAway) picks.push({ year: yr, round: rd, own: true, originalRosterId: myRid });
                    const acquired = tradedPicks.filter(p =>
                        parseInt(p.season, 10) === yr
                        && Number(p.round) === rd
                        && sameId(p.owner_id, myRid)
                        && !sameId(p.roster_id, myRid)
                    );
                    acquired.forEach(a => picks.push({ year: yr, round: rd, own: false, from: a.roster_id, originalRosterId: a.roster_id }));
                }
            });
            return picks;
        }, [tradedPicks, myRoster?.roster_id, pickYears, draftRounds]);

        // Find rookies — Sleeper + CSV enrichment from The Beast
        const rookies = useMemo(() => {
            const rp = currentLeague?.roster_positions || [];
            const leagueHasIDP = rp.some(s => ['DL','DE','DT','LB','DB','CB','S','IDP_FLEX'].includes(s));

            // Step 1: Sleeper rookies
            const sleeperRookies = Object.entries(playersData)
                .filter(([pid, p]) => {
                    if (p.years_exp !== 0) return false;
                    const name = p.full_name || '';
                    if (!name || /Duplicate|Invalid|DUP/i.test(name)) return false;
                    if (!p.position || ['HC','OC','DC','GM'].includes(p.position)) return false;
                    if (p.status === 'Inactive') return false;
                    const hasValue = (window.App?.LI?.playerScores?.[pid] || 0) > 0;
                    const isIDP = ['DL','DE','DT','NT','IDL','EDGE','LB','OLB','ILB','MLB','DB','CB','S','SS','FS'].includes(p.position);
                    if (isIDP && !leagueHasIDP) return false;
                    // OL is never a fantasy scoring position — exclude offensive linemen
                    const isOL = ['OL','OT','OG','G','C','T','IOL'].includes(p.position);
                    if (isOL) return false;
                    return hasValue || p.team;
                })
                .map(([pid, p]) => {
                    const csv = typeof window.findProspect === 'function' ? window.findProspect((p.first_name || '') + ' ' + (p.last_name || '')) : null;
                    // The DHQ engine is the canonical value. Consensus rank and NFL
                    // capital are context on the card, not a second scoring pass.
                    const fcVal = window.App?.LI?.playerScores?.[pid] || 0;
                    let dhq;
                    if (fcVal > 0) {
                        dhq = calibratedRookieDHQ(pid, p, fcVal);
                    } else if (csv) {
                        // No engine/market score yet: fall back to the scouting model.
                        dhq = csv.dynastyValue || 0;
                    } else {
                        dhq = 0;
                    }
                    dhq = Math.min(10000, Math.max(0, dhq));
                    return { pid, p, dhq, csv };
                });

            // Step 2: CSV-only prospects (from enrichment but not in Sleeper)
            // Normalize names: lowercase, strip apostrophes/dots/suffixes so "De'Zhaun" === "Dezhaun".
            const normName = s => (s || '').toLowerCase().replace(/[''`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
            const sleeperNames = new Set(sleeperRookies.map(r => normName(r.p.full_name)));
            // Also collect the CSV-prospect identities Sleeper rookies link to via
            // findProspect — handles nickname mismatches (e.g., Sleeper "KC Concepcion"
            // → CSV "Kevin Concepcion" — both should be one row, not two).
            const linkedCsvPids = new Set(sleeperRookies.map(r => r.csv?.pid).filter(Boolean));
            const csvOnly = [];
            if (typeof window.getProspects === 'function') {
                const allCsv = window.getProspects();
                if (allCsv && allCsv.length) {
                    allCsv.forEach(csv => {
                        if (sleeperNames.has(normName(csv.name))) return;
                        if (linkedCsvPids.has(csv.pid)) return;
                        const pos = normPos(csv.mappedPos || csv.pos) || csv.pos;
                        const isIDP = ['DL','LB','DB','EDGE'].includes(pos);
                        if (isIDP && !leagueHasIDP) return;
                        // OL is never a fantasy scoring position — exclude offensive linemen
                        if (['OL','OT','OG','G','C','T','IOL'].includes(pos)) return;
                        // Build synthetic player object
                        const nameParts = (csv.name || '').split(' ');
                        csvOnly.push({
                            pid: 'csv_' + (csv.name || '').toLowerCase().replace(/[^a-z]/g, '_'),
                            p: {
                                full_name: csv.name,
                                first_name: nameParts[0] || '',
                                last_name: nameParts.slice(1).join(' ') || '',
                                position: csv.pos || '?',
                                college: csv.college,
                                years_exp: 0,
                                age: csv.age ? parseFloat(csv.age) : null,
                                team: null,
                                height: csv.size ? parseInt(csv.size.replace("'", "").split('"')[0]) * 12 + parseInt((csv.size.match(/'(\d+)/)?.[1]) || 0) : null,
                                weight: csv.weight ? parseInt(csv.weight) : null,
                            },
                            dhq: csv.draftScore || 0,
                            csv,
                            isCSVOnly: true,
                        });
                    });
                }
            }

            return [...sleeperRookies, ...csvOnly].sort((a, b) => {
                // Sort by CSV rank first (if available), then DHQ
                const aRank = a.csv?.rank || 9999;
                const bRank = b.csv?.rank || 9999;
                if (aRank !== bRank) return aRank - bRank;
                return b.dhq - a.dhq;
            });
        }, [playersData, timeRecomputeTs, rookieMarket]);

        const draftPoolRows = useMemo(() => {
            if (isRookieDraft) return rookies;
            const stateFns = window.DraftCC?.state;
            if (!stateFns?.buildPool) return rookies;
            const rounds = Number(draftInfo?.settings?.rounds || draftRounds || currentLeague?.settings?.draft_rounds || 0);
            const teams = Number(draftInfo?.settings?.teams || leagueSize || currentLeague?.settings?.num_teams || 0);
            const totalPicks = Math.max(0, rounds * teams);
            const pool = stateFns.buildPool({
                variant: draftVariant,
                playersData,
                maxSize: Math.max(300, totalPicks + 80),
            }) || [];
            return pool.map(row => {
                const player = playersData?.[row.pid] || {};
                const name = row.name || player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || String(row.pid || '');
                const parts = name.split(/\s+/).filter(Boolean);
                const yearsExp = row.yearsExp ?? row.years_exp ?? player.years_exp ?? player.yearsExp;
                return {
                    pid: row.pid,
                    p: {
                        ...player,
                        full_name: name,
                        first_name: player.first_name || parts[0] || '',
                        last_name: player.last_name || parts.slice(1).join(' ') || '',
                        position: row.pos || row.position || player.position,
                        team: row.team || player.team,
                        college: row.college || player.college || player.metadata?.college,
                        age: row.age ?? player.age,
                        birth_date: row.birth_date || player.birth_date,
                        years_exp: yearsExp,
                    },
                    dhq: Number(row.dhq || row.val || 0),
                    csv: row.csv || null,
                    isRookie: !!row.isRookie,
                    source: row.source || '',
                    consensusRank: row.consensusRank || row.rank || null,
                    rank: row.rank || row.consensusRank || null,
                };
            });
        }, [isRookieDraft, rookies, draftVariant, playersData, draftInfo, draftRounds, currentLeague?.settings, leagueSize, timeRecomputeTs]);

        const posColors = window.App.POS_COLORS;

        function draftSortIndicator(key) { return draftSort.key === key ? (draftSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''; }
        function handleDraftSort(key) { setDraftSort(prev => prev.key === key ? { ...prev, dir: prev.dir * -1 } : { key, dir: -1 }); }

        const sortedRookies = useMemo(() => {
            let filtered = draftPoolRows.slice();
            if (boardPosFilter) filtered = filtered.filter(r => normPos(r.p.position) === boardPosFilter);
            return filtered.sort((a, b) => {
                const dir = draftSort.dir;
                const k = draftSort.key;
                if (k === 'name') {
                    const na = (a.p.full_name || ((a.p.first_name || '') + ' ' + (a.p.last_name || '')).trim()).toLowerCase();
                    const nb = (b.p.full_name || ((b.p.first_name || '') + ' ' + (b.p.last_name || '')).trim()).toLowerCase();
                    return dir * na.localeCompare(nb);
                }
                if (k === 'pos') return dir * ((normPos(a.p.position) || '').localeCompare(normPos(b.p.position) || ''));
                if (k === 'age') return dir * ((a.p.age || 0) - (b.p.age || 0));
                if (k === 'dhq') return dir * (a.dhq - b.dhq);
                if (k === 'college') return dir * ((a.p.college || a.p.metadata?.college || '').localeCompare(b.p.college || b.p.metadata?.college || ''));
                return 0;
            }).slice(0, 50);
        }, [draftPoolRows, draftSort, boardPosFilter]);

        // Team assessment for roster needs (drives needBonus in scoring)
        const assess = useMemo(() => typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null, [myRoster, timeRecomputeTs]);

        // Determine active view: global viewMode overrides to 'command' when set
        const activeView = viewMode === 'command' ? 'command' : draftView;

        useEffect(() => {
            if (!isRookieDraft && boardRoundFilter) setBoardRoundFilter('');
        }, [isRookieDraft, boardRoundFilter]);

        useEffect(() => {
            const next = DraftStorage.get(boardStorageKey, DraftStorage.get(DRAFT_WR_KEYS.BIGBOARD(leagueKey), null));
            setBoardData(next);
            if (!next) {
                setDraftedPids(new Set());
                setBoardNotes({});
                setBoardTags({});
                setMyBoardOrder([]);
                setBoardMode('dhq');
            }
        }, [boardStorageKey, leagueKey]);

        // Restore board data from localStorage
        useEffect(() => {
            if (boardData) {
                if (boardData.tags) setBoardTags(boardData.tags);
                if (boardData.notes) setBoardNotes(boardData.notes);
                if (boardData.drafted) setDraftedPids(new Set(boardData.drafted));
                if (boardData.myOrder) setMyBoardOrder(boardData.myOrder);
                if (['dhq', 'ai', 'my'].includes(boardData.activeLane || boardData.boardMode)) setBoardMode(boardData.activeLane || boardData.boardMode);
            }
        }, [boardData]);

        // Fetch draft countdown info from Sleeper
        useEffect(() => {
            if (!currentLeague?.id) return;
            fetch('https://api.sleeper.app/v1/league/' + (currentLeague.league_id || currentLeague.id) + '/drafts')
                .then(r => r.ok ? r.json() : [])
                .then(drafts => {
                    const upcoming = drafts.find(d => d.status === 'pre_draft') || drafts[0];
                    if (upcoming) setDraftInfo(upcoming);
                })
                .catch(err => window.wrLog('draft.draftFetch', err));
        }, [currentLeague]);

        // Helper: get player display name
        const pName = (p) => p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown';

        const boardPoolForContext = useMemo(() => draftPoolRows.map(r => {
            const pos = normPos(r.p?.position || r.csv?.mappedPos || r.csv?.pos || '');
            return {
                pid: r.pid,
                csvPid: r.csv?.pid || null,
                name: pName(r.p),
                pos,
                position: pos,
                dhq: Number(r.dhq || 0),
                val: Number(r.dhq || 0),
                age: r.p?.age || r.csv?.age || null,
                tier: r.csv?.tier || null,
                consensusRank: r.consensusRank || r.csv?.consensusRank || r.csv?.rank || null,
                rank: r.rank || r.csv?.rank || null,
                nflTeam: r.csv?.nflTeam || r.p?.team || null,
                school: r.csv?.college || r.p?.college || r.p?.metadata?.college || null,
                photoUrl: 'https://sleepercdn.com/content/nfl/players/thumb/' + r.pid + '.jpg',
                csv: r.csv || null,
                isRookie: !!r.isRookie,
                source: r.source || null,
            };
        }), [draftPoolRows]);

        const boardContextForRoom = useMemo(() => {
            try {
                if (!window.DraftCC?.context?.buildBoardContext) return null;
                return window.DraftCC.context.buildBoardContext({
                    leagueId: leagueKey,
                    currentLeague,
                    pool: boardPoolForContext,
                    userAssessment: assess,
                    draftType: draftVariant,
                });
            } catch (e) {
                if (window.wrLog) window.wrLog('draftRoom.boardContext', e);
                return null;
            }
        }, [leagueKey, currentLeague, boardPoolForContext, assess, draftVariant]);

        const aiRecommendedOrder = useMemo(() => {
            const fromContext = boardContextForRoom?.lanes?.ai?.order || boardContextForRoom?.lanes?.AI?.order || [];
            if (fromContext.length) return fromContext;
            return draftPoolRows.slice()
                .sort((a, b) => Number(b.dhq || 0) - Number(a.dhq || 0))
                .map(r => r.pid);
        }, [boardContextForRoom, draftPoolRows]);

        const applyAiOrderToUserBoard = useCallback((scope = 'master') => {
            if (!aiRecommendedOrder.length) return;
            if (scope === 'position' && boardPosFilter) {
                const positionSet = new Set(draftPoolRows.filter(r => normPos(r.p.position) === boardPosFilter).map(r => r.pid));
                setMyBoardOrder(prev => {
                    const base = prev.length ? prev.slice() : aiRecommendedOrder.slice();
                    const locked = base.filter(pid => !positionSet.has(pid));
                    const rankedPosition = aiRecommendedOrder.filter(pid => positionSet.has(pid));
                    const insertAt = Math.max(0, base.findIndex(pid => positionSet.has(pid)));
                    if (insertAt < 0) return rankedPosition.concat(locked);
                    const next = locked.slice();
                    next.splice(insertAt, 0, ...rankedPosition);
                    return next;
                });
            } else {
                setMyBoardOrder(aiRecommendedOrder.slice());
            }
            setBoardMode('my');
            setDraftView('board');
        }, [aiRecommendedOrder, boardPosFilter, draftPoolRows, normPos]);

        // Auto-save board data to localStorage on changes. The AI order is saved
        // so mocks, context, and the visible Big Board share one recommendation source.
        useEffect(() => {
            DraftStorage.set(boardStorageKey,
                {
                    tags: boardTags,
                    notes: boardNotes,
                    drafted: Array.from(draftedPids),
                    aiOrder: aiRecommendedOrder,
                    myOrder: myBoardOrder,
                    activeLane: boardMode,
                    lineage: {
                        source: 'wr_bigboard',
                        seededFrom: myBoardOrder.length ? null : 'ai',
                        aiGeneratedAt: new Date().toISOString(),
                        userLastEditedAt: new Date().toISOString(),
                    },
                    updatedAt: new Date().toISOString(),
                });
        }, [boardTags, boardNotes, draftedPids, aiRecommendedOrder, myBoardOrder, boardMode, boardStorageKey]);

        const draftProjectionMeta = useMemo(() => {
            const rosters = currentLeague?.rosters || window.S?.rosters || [];
            const users = currentLeague?.users || window.S?.leagueUsers || [];
            const myUid = window.S?.user?.user_id || sleeperUserId || '';
            const myRid = myRoster?.roster_id;
            const sleeperOrder = draftInfo?.draft_order || {};
            const slotToRoster = {};
            const hasRealDraftOrder = Object.keys(sleeperOrder).length > 0;

            if (hasRealDraftOrder) {
                Object.entries(sleeperOrder).forEach(([userId, slot]) => {
                    const roster = rosters.find(r => sameId(r.owner_id, userId));
                    const user = users.find(u => sameId(u.user_id, userId));
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                    slotToRoster[slot] = { rosterId: roster?.roster_id, ownerName: name, userId };
                });
            } else {
                const sorted = [...rosters].sort((a, b) => {
                    const aw = a.settings?.wins || 0;
                    const bw = b.settings?.wins || 0;
                    if (aw !== bw) return aw - bw;
                    const ap = (a.settings?.fpts || 0) + (a.settings?.fpts_decimal || 0) / 100;
                    const bp = (b.settings?.fpts || 0) + (b.settings?.fpts_decimal || 0) / 100;
                    return ap - bp;
                });
                sorted.forEach((r, i) => {
                    const user = users.find(u => sameId(u.user_id, r.owner_id));
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + (i + 1);
                    slotToRoster[i + 1] = { rosterId: r.roster_id, ownerName: name, userId: r.owner_id };
                });
            }

            const totalTeams = draftInfo?.settings?.teams || currentLeague?.settings?.num_teams || Math.max(leagueSize, Object.keys(slotToRoster).length || 12);
            const mappedRosterIds = new Set(Object.values(slotToRoster).map(e => e.rosterId).filter(Boolean));
            const unmappedRosters = rosters.filter(r => !mappedRosterIds.has(r.roster_id));
            let ghostIdx = 0;
            for (let slot = 1; slot <= totalTeams; slot++) {
                if (slotToRoster[slot]) continue;
                const r = unmappedRosters[ghostIdx++] || {};
                const user = r.owner_id ? users.find(u => sameId(u.user_id, r.owner_id)) : null;
                const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                slotToRoster[slot] = { rosterId: r.roster_id || null, ownerName: name, userId: r.owner_id || null };
            }

            let mySlot = null;
            Object.entries(slotToRoster).some(([slot, info]) => {
                if (sameId(info.userId, myUid) || sameId(info.rosterId, myRid)) {
                    mySlot = parseInt(slot, 10);
                    return true;
                }
                return false;
            });
            if (!mySlot && myRid != null) {
                mySlot = 1;
                slotToRoster[1] = { rosterId: myRid, ownerName: 'YOU', userId: myUid || null };
            }

            const rounds = draftInfo?.settings?.rounds || draftRounds || currentLeague?.settings?.draft_rounds || 5;
            const draftType = draftInfo?.type || 'snake';
            const pickOwnership = {};
            for (let rd = 1; rd <= rounds; rd++) {
                for (let slot = 1; slot <= totalTeams; slot++) {
                    const origInfo = slotToRoster[slot] || {};
                    const origRid = origInfo.rosterId;
                    const traded = tradedPicks.find(tp =>
                        Number(tp.round) === rd
                        && sameId(tp.roster_id, origRid)
                        && !sameId(tp.owner_id, origRid)
                        && sameId(tp.season, leagueSeason)
                    );
                    if (traded) {
                        const newOwner = rosters.find(r => sameId(r.roster_id, traded.owner_id));
                        const newUser = users.find(u => sameId(u.user_id, newOwner?.owner_id));
                        pickOwnership[rd + '-' + slot] = {
                            ownerName: newUser?.metadata?.team_name || newUser?.display_name || 'Team',
                            rosterId: traded.owner_id,
                            traded: true,
                            originalOwner: origInfo.ownerName,
                        };
                    } else {
                        pickOwnership[rd + '-' + slot] = {
                            ownerName: origInfo.ownerName || 'Team ' + slot,
                            rosterId: origRid,
                            traded: false,
                        };
                    }
                }
            }

            return {
                mySlot: mySlot || Math.min(6, totalTeams),
                slotToRoster,
                pickOwnership,
                numTeams: totalTeams,
                rounds,
                draftType,
            };
        }, [currentLeague, myRoster, sleeperUserId, draftInfo, draftRounds, leagueSize, tradedPicks, leagueSeason]);

        const draftStrategyProfile = useMemo(() => {
            try {
                if (window.DraftCC?.state?.loadDraftStrategyProfile) {
                    return window.DraftCC.state.loadDraftStrategyProfile(leagueKey, { variant: draftVariant });
                }
            } catch (e) {
                if (window.wrLog) window.wrLog('draftRoom.strategyProfile', e);
            }
            return null;
        }, [leagueKey, draftVariant, timeRecomputeTs]);

        const draftProjectionState = useMemo(() => {
            const stateFns = window.DraftCC?.state || {};
            const pickOrder = stateFns.buildPickOrder
                ? stateFns.buildPickOrder(draftProjectionMeta.rounds, draftProjectionMeta.numTeams, draftProjectionMeta.draftType, draftProjectionMeta.slotToRoster, draftProjectionMeta.pickOwnership)
                : [];
            const base = stateFns.initialDraftState ? stateFns.initialDraftState({
                leagueId: leagueKey,
                season: leagueSeason,
                variant: draftVariant,
                mode: 'solo',
                rounds: draftProjectionMeta.rounds,
                leagueSize: draftProjectionMeta.numTeams,
                draftType: draftProjectionMeta.draftType,
                userRosterId: myRoster?.roster_id || null,
                userSlot: draftProjectionMeta.mySlot,
                draftTuning: draftStrategyProfile?.tuning || stateFns.DEFAULT_DRAFT_TUNING,
                strategyProfile: draftStrategyProfile,
            }) : {
                leagueId: leagueKey,
                season: leagueSeason,
                variant: draftVariant,
                mode: 'solo',
                rounds: draftProjectionMeta.rounds,
                leagueSize: draftProjectionMeta.numTeams,
                draftType: draftProjectionMeta.draftType,
                userRosterId: myRoster?.roster_id || null,
                userSlot: draftProjectionMeta.mySlot,
                draftTuning: draftStrategyProfile?.tuning || {},
                strategyProfile: draftStrategyProfile,
            };
            const next = {
                ...base,
                pool: boardPoolForContext,
                originalPool: boardPoolForContext,
                pickOrder,
                personas: {},
            };
            try {
                if (window.DraftCC?.context?.buildDraftContext) {
                    next.draftContext = window.DraftCC.context.buildDraftContext({
                        state: next,
                        leagueId: leagueKey,
                        currentLeague,
                        myRoster,
                        pool: boardPoolForContext,
                        pickOrder,
                    });
                }
            } catch (e) {
                if (window.wrLog) window.wrLog('draftRoom.projectionContext', e);
            }
            return next;
        }, [leagueKey, leagueSeason, currentLeague, myRoster, boardPoolForContext, draftProjectionMeta, draftStrategyProfile, draftVariant]);

        const flashRoundOptions = useMemo(() => {
            const maxRounds = Math.max(1, Math.min(100, Number(draftProjectionMeta.rounds || draftRounds || 1)));
            return Array.from({ length: maxRounds }, (_, idx) => String(idx + 1));
        }, [draftProjectionMeta.rounds, draftRounds]);

        const flashAnalystPresetOptions = useMemo(() => {
            const presets = window.DraftCC?.analystMock?.PRESETS || [];
            const realisticIds = ['league-history', 'my-board', 'trade-heavy'];
            const labels = {
                'league-history': 'Reality',
                'my-board': 'My Board',
                'trade-heavy': 'Market',
            };
            return realisticIds
                .map(id => {
                    const preset = presets.find(p => p.id === id);
                    return preset ? { ...preset, label: labels[id] || preset.label } : null;
                })
                .filter(Boolean);
        }, []);

        const flashAnalystPreviewReports = useMemo(() => {
            const engine = window.DraftCC?.analystMock;
            if (!engine?.generateProjectedMock || !boardPoolForContext.length || !flashAnalystPresetOptions.length) return [];
            return flashAnalystPresetOptions.map(preset => {
                try {
                    return engine.generateProjectedMock({
                        state: draftProjectionState,
                        draftMeta: draftProjectionMeta,
                        playersData,
                        currentLeague,
                        myRoster,
                        presetId: preset.id,
                        roundLimit: 1,
                        pickOrder: draftProjectionState.pickOrder,
                    });
                } catch (e) {
                    if (window.wrLog) window.wrLog('draftRoom.flashAnalystPreview', e);
                    return null;
                }
            }).filter(Boolean);
        }, [boardPoolForContext.length, flashAnalystPresetOptions, draftProjectionState, draftProjectionMeta, playersData, currentLeague, myRoster]);

        const generateFlashAnalystMock = useCallback(() => {
            const engine = window.DraftCC?.analystMock;
            if (!engine?.generateProjectedMock || !boardPoolForContext.length) return;
            setFlashAnalystStatus('running');
            setFlashAnalystError('');
            try {
                const report = engine.generateProjectedMock({
                    state: draftProjectionState,
                    draftMeta: draftProjectionMeta,
                    playersData,
                    currentLeague,
                    myRoster,
                    presetId: flashAnalystPresetId,
                    roundLimit: flashAnalystRoundLimit,
                    pickOrder: draftProjectionState.pickOrder,
                });
                setFlashAnalystReports(prev => [report].concat(prev.filter(r => r.presetId !== report.presetId)).slice(0, 3));
                setFlashAnalystStatus('ready');
            } catch (e) {
                if (window.wrLog) window.wrLog('draftRoom.flashAnalystMock', e);
                setFlashAnalystError(e?.message || 'Projection failed.');
                setFlashAnalystStatus('error');
            }
        }, [boardPoolForContext.length, draftProjectionState, draftProjectionMeta, playersData, currentLeague, myRoster, flashAnalystPresetId, flashAnalystRoundLimit]);

        const activeFlashAnalystReport = flashAnalystReports.find(r => r.presetId === flashAnalystPresetId) || null;
        const activeFlashPreviewReport = flashAnalystPreviewReports.find(r => r.presetId === flashAnalystPresetId) || flashAnalystPreviewReports[0] || null;
        const activeFlashAlexBrief = useMemo(() => {
            const engine = window.DraftCC?.analystMock;
            if (!engine?.formatAlexSlackBrief || !activeFlashAnalystReport) return null;
            return engine.formatAlexSlackBrief(activeFlashAnalystReport, draftProjectionState, { maxLines: 'all' });
        }, [activeFlashAnalystReport, draftProjectionState]);

        const openDraftPlayer = useCallback((pid) => {
            if (!pid) return;
            if (window.WR?.openPlayerCard) window.WR.openPlayerCard(pid);
            else if (window._wrSelectPlayer) window._wrSelectPlayer(pid);
        }, []);

        // Jump to Big Board and open the player's expanded scouting card.
        // Clears filters so the row is visible, then scrolls it into view.
        const openInBigBoard = useCallback((pid) => {
            if (!pid) return;
            setBoardPosFilter('');
            setBoardTeamFilter('');
            setBoardRoundFilter('');
            setExpandedDraftPid(pid);
            setDraftView('board');
            setTimeout(() => {
                const el = document.querySelector('[data-draft-pid="' + String(pid) + '"]');
                if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
        }, []);

        const slotMap = useMemo(() => {
            const mappedFromDraft = {};
            Object.entries(draftProjectionMeta?.slotToRoster || {}).forEach(([slot, info]) => {
                if (info?.rosterId != null) mappedFromDraft[String(info.rosterId)] = Number(slot);
            });
            if (Object.keys(mappedFromDraft).length) return mappedFromDraft;

            const rosters = currentLeague?.rosters || window.S?.rosters || [];
            const sorted = [...rosters].sort((a, b) => {
                const aW = a.settings?.wins || 0;
                const bW = b.settings?.wins || 0;
                if (aW !== bW) return aW - bW;
                const aP = (a.settings?.fpts || 0) + (a.settings?.fpts_decimal || 0) / 100;
                const bP = (b.settings?.fpts || 0) + (b.settings?.fpts_decimal || 0) / 100;
                return aP - bP;
            });
            const m = {};
            sorted.forEach((r, i) => { m[String(r.roster_id)] = i + 1; });
            return m;
        }, [draftProjectionMeta?.slotToRoster, currentLeague?.rosters, timeRecomputeTs]);

        const slotFor = useCallback((pk) => {
            if (!pk) return null;
            const src = pk.own ? myRoster?.roster_id : pk.from;
            return src != null ? slotMap[String(src)] : null;
        }, [slotMap, myRoster?.roster_id]);

        const fmtPick = useCallback((pk) => {
            if (!pk) return '--';
            const slot = slotFor(pk);
            return pk.year + ' ' + pk.round + '.' + (slot ? String(slot).padStart(2, '0') : '??');
        }, [slotFor]);

        const fmtDhq = n => Number(n || 0).toLocaleString();
        const pickValueFor = useCallback((pk) => {
            const slot = slotFor(pk);
            if (!slot) return 0;
            try {
                const resolved = window.DraftCC?.state?.resolveDraftPickValue?.({
                    season: pk.year,
                    round: pk.round,
                    slot,
                    totalTeams: leagueSize,
                    leagueSize,
                    draftRounds,
                });
                return Number(resolved?.value || 0) || 0;
            } catch (_) {
                return 0;
            }
        }, [slotFor, leagueSize, draftRounds]);
        const pickCapitalRows = useMemo(() => {
            return pickYears.map(yr => {
                const picks = myPicks
                    .filter(pk => pk.year === yr)
                    .sort((a, b) => {
                        if (a.round !== b.round) return a.round - b.round;
                        return (slotFor(a) || 99) - (slotFor(b) || 99);
                    })
                    .map(pk => ({ ...pk, slot: slotFor(pk), value: pickValueFor(pk) }));
                return {
                    year: yr,
                    picks,
                    totalValue: picks.reduce((sum, pk) => sum + Number(pk.value || 0), 0),
                };
            });
        }, [pickYears, myPicks, slotFor, pickValueFor]);
        const currentCapitalRow = pickCapitalRows.find(row => row.year === leagueSeason) || { year: leagueSeason, picks: [], totalValue: 0 };
        const futureCapitalRows = pickCapitalRows.filter(row => row.year !== leagueSeason);
        const totalPickCapital = pickCapitalRows.reduce((sum, row) => sum + row.totalValue, 0);
        const futurePickCapital = futureCapitalRows.reduce((sum, row) => sum + row.totalValue, 0);

        // Next pick info
        const nextPick = useMemo(() => {
            return myPicks
                .filter(pk => pk.year === leagueSeason)
                .slice()
                .sort((a, b) => {
                    if (a.round !== b.round) return a.round - b.round;
                    return (slotFor(a) || 99) - (slotFor(b) || 99);
                })[0] || null;
        }, [myPicks, leagueSeason, slotFor]);

        const nextSlot = nextPick ? slotFor(nextPick) : null;
        const nextPickOverall = nextPick ? ((nextPick.round - 1) * leagueSize) + (nextSlot || Math.ceil(leagueSize / 2)) : null;
        const picksBeforeNext = nextPickOverall ? Math.max(0, nextPickOverall - 1) : 0;
        const highestCurrentPickRound = Math.max(1, ...myPicks.filter(pk => pk.year === leagueSeason).map(pk => Number(pk.round || 1)));
        const nextPickLabel = nextPick ? fmtPick(nextPick).replace(String(leagueSeason) + ' ', '') : 'next pick';

        const leagueDraftProfile = useMemo(() => {
            const scoring = currentLeague?.scoring_settings || {};
            const rosterSlots = currentLeague?.roster_positions || [];
            const starters = {};
            rosterSlots.forEach(slot => {
                const raw = String(slot || '').toUpperCase();
                if (raw === 'BN' || raw === 'IR' || raw === 'TAXI') return;
                const pos = raw === 'SUPER_FLEX' || raw === 'OP' || raw === 'QB_FLEX' ? 'QB'
                    : raw === 'FLEX' || raw === 'WRRB_FLEX' ? 'WR'
                    : raw === 'REC_FLEX' || raw === 'WRRBTE_FLEX' ? 'WR'
                    : normPos(raw) || raw;
                starters[pos] = (starters[pos] || 0) + 1;
            });
            const rec = Number(scoring.rec || 0);
            const tePremium = Number(scoring.bonus_rec_te || scoring.rec_te_bonus || 0);
            const idpKeys = ['solo_tkl', 'tackle_solo', 'tackle', 'sack', 'int', 'pass_defended', 'idp_tkl_solo'];
            const idpWeight = idpKeys.reduce((sum, key) => sum + Math.max(0, Number(scoring[key] || 0)), 0);
            const multiplierFor = (pos) => {
                const p = normPos(pos) || pos;
                let mult = 1 + Math.min(0.22, (starters[p] || 0) * 0.035);
                if (p === 'QB' && ((starters.QB || 0) >= 2 || rosterSlots.some(s => ['SUPER_FLEX', 'OP', 'QB_FLEX'].includes(String(s || '').toUpperCase())))) mult += 0.18;
                if (p === 'TE' && (tePremium > 0 || rec >= 1)) mult += tePremium > 0 ? 0.16 : 0.06;
                if (p === 'RB' && rec >= 1) mult += 0.05;
                if (p === 'WR' && rec >= 1) mult += 0.04;
                if (['DL', 'LB', 'DB'].includes(p) && idpWeight > 0) mult += Math.min(0.18, idpWeight / 55);
                return mult;
            };
            const formatBits = [];
            if ((starters.QB || 0) >= 2 || rosterSlots.some(s => ['SUPER_FLEX', 'OP', 'QB_FLEX'].includes(String(s || '').toUpperCase()))) formatBits.push('QB/SF');
            if (rec >= 1) formatBits.push('PPR');
            if (tePremium > 0) formatBits.push('TE premium');
            if (idpWeight > 0) formatBits.push('IDP');
            return { starters, multiplierFor, label: formatBits.length ? formatBits.join(' + ') : 'league format' };
        }, [currentLeague?.scoring_settings, currentLeague?.roster_positions, normPos]);

        const alexRosterNote = useCallback((pos, priorityScore, targetName, targetDhq) => {
            const p = normPos(pos) || pos || 'this position';
            const target = targetName || 'a clean tier fit';
            const dhqText = targetDhq ? ' (' + fmtDhq(targetDhq) + ' ' + valueShortLabel + ')' : '';
            const pickText = nextPickLabel || 'our next pick';
            if (priorityScore >= 300) {
                if (p === 'QB') return 'I see QB as a real lineup pressure point. If ' + target + dhqText + ' reaches ' + pickText + ', I would rather solve the weekly ceiling problem than chase a luxury tier.';
                if (p === 'TE') return 'I see TE as the cleanest way to change our roster shape. If ' + target + dhqText + ' survives to ' + pickText + ', I want to attack it before the cliff turns ugly.';
                if (['DL', 'LB', 'DB'].includes(p)) return 'I see ' + p + ' as an IDP pressure spot, not a vanity pick. If ' + target + dhqText + ' is there, it keeps us from paying future capital after the room realizes the tier is gone.';
                return 'I see ' + p + ' as a real roster pressure point. If ' + target + dhqText + ' reaches ' + pickText + ', I want to close that gap while the ' + valueShortLabel + ' value still lines up.';
            }
            if (priorityScore >= 200) {
                if (p === 'RB') return 'I read RB as a depth and age-risk lane. I do not want to force it, but ' + target + dhqText + ' should be a tie-breaker if the board flattens.';
                if (p === 'WR') return 'I read WR as a depth squeeze more than an emergency. Keep ' + target + dhqText + ' active, but only jump if the tier holds real value at ' + pickText + '.';
                return 'I read ' + p + ' as an active lane, not a panic spot. ' + target + dhqText + ' matters if the board gives us the value, but I would still let ' + valueShortLabel + ' settle the tie.';
            }
            return 'I would keep ' + p + ' on the watch list. ' + target + dhqText + ' is useful if the room lets value fall, but this should not pull us away from a better tier.';
        }, [normPos, nextPickLabel, fmtDhq, valueShortLabel]);

        const pressureProjectionReport = useMemo(() => {
            const engine = window.DraftCC?.analystMock;
            if (!engine?.generateProjectedMock || !boardPoolForContext.length) return null;
            try {
                const roundLimit = Math.max(1, Math.min(Number(draftProjectionMeta.rounds || draftRounds || 1), highestCurrentPickRound));
                return engine.generateProjectedMock({
                    state: draftProjectionState,
                    draftMeta: draftProjectionMeta,
                    playersData,
                    currentLeague,
                    myRoster,
                    presetId: 'league-history',
                    roundLimit,
                    pickOrder: draftProjectionState.pickOrder,
                });
            } catch (e) {
                if (window.wrLog) window.wrLog('draftRoom.pressureProjection', e);
                return null;
            }
        }, [boardPoolForContext.length, draftProjectionState, draftProjectionMeta, playersData, currentLeague, myRoster, highestCurrentPickRound, draftRounds]);
        const draftPredictionReport = activeFlashAnalystReport || pressureProjectionReport || activeFlashPreviewReport;

        // Lifted from the Big Board so both the board and the Flash Brief scouting
        // drawer can compute the same value rank + tier + scouting bits per player.
        const isSeasonalDraftCtx = !isRookieDraft;
        const hasDraftCapital = useCallback((cs = {}) => Number(cs.draftRound) > 0 || Number(cs.draftPick) > 0, []);
        const isTrueUdfa = useCallback((cs = {}) => !!cs.isUDFA && !hasDraftCapital(cs), [hasDraftCapital]);

        const valueRankMaps = useMemo(() => {
            const rows = draftPoolRows
                .filter(r => Number(r.dhq || 0) > 0)
                .slice()
                .sort((a, b) => Number(b.dhq || 0) - Number(a.dhq || 0));
            const valueRank = new Map(rows.map((r, i) => [String(r.pid), i + 1]));
            const posLists = {};
            rows.forEach(r => {
                const pos = normPos(r.p?.position) || r.p?.position || 'UNK';
                (posLists[pos] = posLists[pos] || []).push(String(r.pid));
            });
            return { valueRank, posLists };
        }, [draftPoolRows, normPos]);

        const valueTierMeta = useCallback((dhq, rank) => {
            const score = Number(dhq || 0);
            if ((rank && rank <= 12) || score >= 8000) return { label: 'Elite', order: 1, detail: 'round-winning anchor' };
            if ((rank && rank <= 36) || score >= 6000) return { label: 'Core', order: 2, detail: 'weekly starter core' };
            if ((rank && rank <= 84) || score >= 3600) return { label: 'Starter', order: 3, detail: 'lineup starter tier' };
            if ((rank && rank <= 160) || score >= 1600) return { label: 'Depth', order: 4, detail: 'bench and matchup depth' };
            return { label: 'Stream', order: 5, detail: 'streamer or watch-list tier' };
        }, []);

        const generatedScoutingBits = useCallback((row, context) => {
            const player = row.p || {};
            const name = pName(player);
            const pos = context.pos || normPos(player.position) || player.position || 'POS';
            const team = context.team || player.team || 'FA';
            const age = context.age || player.age || null;
            const rank = context.valueRank;
            const posRank = context.posRank;
            const tier = context.tierMeta || valueTierMeta(row.dhq, rank);
            const rankText = rank ? '#' + rank + ' overall' + (posRank ? ', ' + posLabel(pos) + posRank : '') : 'unranked value';
            const roleByPos = {
                QB: 'weekly ceiling, rushing/pass-volume profile, and schedule insulation',
                RB: 'touch share, goal-line path, reception floor, and injury fragility',
                WR: 'target share, route role, quarterback environment, and spike-week ceiling',
                TE: 'route participation, red-zone usage, and whether he separates from the replacement tier',
                K: 'offense quality, indoor/weather exposure, and weekly streamability',
                DEF: 'pressure rate, turnover chances, schedule pockets, and matchup streamability',
            };
            const role = roleByPos[pos] || 'weekly role, team context, and replacement-level gap';
            const ageText = age ? ' At age ' + age + ', the risk lens is durability and role stability more than long-term development.' : '';
            const teamText = team && team !== 'FA'
                ? name + ' is tied to ' + team + ', so the scouting question is ' + role + '.'
                : name + ' is not carrying a clean team label here, so I would treat the board value as stronger than the environment tag until news clarifies it.';
            const planText = tier.label === 'Elite'
                ? 'Draft plan: treat him as an anchor. Do not overthink small fit nits if he falls below his value tier.'
                : tier.label === 'Core'
                    ? 'Draft plan: take him when roster construction needs a bankable weekly starter and the board is leaving the tier intact.'
                    : tier.label === 'Starter'
                        ? 'Draft plan: useful if the build needs points now; pass if a cleaner ceiling tier is still available.'
                        : 'Draft plan: this is a bench/streaming decision. Let ADP, roster need, and schedule break the tie.';
            return [
                name + ' grades as a ' + tier.label.toLowerCase() + ' ' + posLabel(pos) + ' in this format (' + rankText + ', ' + fmtDhq(row.dhq) + ' ' + valueShortLabel + ').',
                teamText + ageText,
                'Alex read: focus on ' + role + '. Value tier says how far above replacement he is; roster need says whether we should be the one paying that price.',
                planText,
            ];
        }, [normPos, valueTierMeta, valueShortLabel]);

        // Top prospects by DHQ — fit was removed; needs handled downstream via needBonus.
        const topProspects = useMemo(() => {
            return draftPoolRows.slice(0, 160);
        }, [draftPoolRows]);

        // Single source of truth for "who's likely gone before our next pick".
        // Prefers the analyst-mock projection (which models owner reach) and falls
        // back to a raw DHQ-rank heuristic when no projection is loaded yet.
        const pidsGoneBeforePick = useMemo(() => {
            const set = new Set();
            if (!nextPickOverall) return set;
            const projected = (draftPredictionReport?.picks || [])
                .filter(p => Number(p.overall) < Number(nextPickOverall));
            if (projected.length) {
                projected.forEach(p => { if (p.pid != null) set.add(String(p.pid)); });
                return set;
            }
            topProspects
                .filter(r => !draftedPids.has(r.pid))
                .slice(0, Math.max(0, picksBeforeNext))
                .forEach(r => { if (r.pid != null) set.add(String(r.pid)); });
            return set;
        }, [draftPredictionReport, topProspects, draftedPids, nextPickOverall, picksBeforeNext]);

        const availableAtNextPick = useCallback((r) => {
            if (!r || r.pid == null) return false;
            if (draftedPids.has(r.pid)) return false;
            if (!nextPickOverall) return true;
            return !pidsGoneBeforePick.has(String(r.pid));
        }, [draftedPids, nextPickOverall, pidsGoneBeforePick]);

        // Strategy recommendation — must be declared before recommendations (which depends on it)
        const strategyRec = useMemo(() => {
            if (!rosterState.isUsable) return { type: 'sync', label: 'Sync roster', reason: 'Roster targeting is paused until player IDs finish loading.' };
            if (!assess || !assess.needs || !assess.needs.length) return { type: 'bpa', label: 'Go BPA', reason: 'No clear positional needs detected.' };
            const critical = assess.needs.filter(n => n.urgency === 'deficit');
            if (critical.length > 0) {
                return { type: 'target', label: 'Target ' + critical[0].pos, reason: critical[0].pos + ' is a critical need (' + critical.length + ' deficit position' + (critical.length > 1 ? 's' : '') + ').' };
            }
            return { type: 'bpa', label: 'Go BPA', reason: 'Needs are thin but not critical. Take the best player available.' };
        }, [rosterState.isUsable, assess]);

        // Scored, sorted prospects available at the user's next pick. Source of truth
        // shared by `recommendations` (top 8) and `needLabels` (per-position best).
        const scoredAvailable = useMemo(() => {
            if (!rosterState.isUsable) return [];
            const targetPos = (strategyRec?.type === 'target' && strategyRec?.label) ? strategyRec.label.replace('Target ', '') : null;

            return topProspects
                .map((r, i) => ({ ...r, expectedRank: i + 1 }))
                .filter(availableAtNextPick)
                .map(r => {
                    const pos = normPos(r.p.position) || r.p.position;
                    const hasCapital = Number(r.csv?.draftRound) > 0 || Number(r.csv?.draftPick) > 0;
                    const isUdfaOnly = !!r.csv?.isUDFA && !hasCapital;
                    const needEntry = assess?.needs?.find(n => n.pos === pos);
                    const needBonus = needEntry?.urgency === 'deficit' ? 1700 : needEntry ? 850 : 0;
                    const targetBonus = targetPos && pos === targetPos ? 1200 : 0;
                    // Pure BPA: DHQ + need bonus + target bonus. Availability is enforced
                    // by `availableAtNextPick`, so no slot-matching bias is needed.
                    const score = r.dhq * 0.58 + needBonus + targetBonus;
                    const availability = !nextPickOverall ? 72
                        : r.expectedRank <= nextPickOverall + 2 ? 54
                        : r.expectedRank <= nextPickOverall + leagueSize ? 73
                        : 88;
                    const draftCapital = r.csv?.draftRound
                        ? 'NFL R' + r.csv.draftRound + (r.csv.draftPick ? ' P' + r.csv.draftPick : '')
                        : (isUdfaOnly ? 'UDFA' : 'Capital TBD');
                    const posName = posLabel(pos);
                    const reason = needEntry
                        ? (needEntry.urgency === 'deficit' ? 'Closes a critical ' + posName + ' room while staying near board value.' : 'Adds useful ' + posName + ' depth without reaching past the tier.')
                        : 'Best-player-available candidate with enough value to override lesser needs.';
                    const riskLabel = r.csv?.risk || (r.csv?.draftRound && r.csv.draftRound <= 2 ? 'Lower risk' : isUdfaOnly ? 'Long shot' : 'Market risk');
                    return { ...r, pos, needEntry, score, availability, draftCapital, reason, riskLabel };
                })
                .sort((a, b) => b.score - a.score);
        }, [rosterState.isUsable, topProspects, availableAtNextPick, strategyRec, nextPickOverall, assess, leagueSize]);

        // Top recommendations for next pick (slice of the scored list).
        const recommendations = useMemo(() => scoredAvailable.slice(0, 8), [scoredAvailable]);

        const likelyGoneBeforePick = useMemo(() => {
            if (!nextPickOverall) return [];
            const projected = (draftPredictionReport?.picks || [])
                .filter(p => Number(p.overall) < Number(nextPickOverall))
                .map(p => ({
                    pos: normPos(p.pos) || p.pos || 'UNK',
                    name: p.name,
                    source: 'analyst',
                }));
            if (projected.length) return projected;
            return topProspects
                .filter(r => !draftedPids.has(r.pid))
                .slice(0, Math.max(0, picksBeforeNext))
                .map(r => ({
                    pos: normPos(r.p.position) || r.p.position || 'UNK',
                    name: pName(r.p),
                    source: 'board',
                }));
        }, [draftPredictionReport, topProspects, draftedPids, nextPickOverall, picksBeforeNext]);

        const positionRunRows = useMemo(() => {
            const map = {};
            likelyGoneBeforePick.forEach(r => {
                const pos = r.pos || 'UNK';
                if (!map[pos]) map[pos] = { pos, count: 0, names: [] };
                map[pos].count += 1;
                if (map[pos].names.length < 2) map[pos].names.push(r.name);
            });
            return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 6);
        }, [likelyGoneBeforePick]);

        const classDepthRows = useMemo(() => {
            const map = {};
            const topPlayersByPos = {};
            topProspects
                .slice()
                .sort((a, b) => {
                    const aPos = normPos(a.p.position) || a.p.position || 'UNK';
                    const bPos = normPos(b.p.position) || b.p.position || 'UNK';
                    const aScore = Number(a.dhq || 0) * leagueDraftProfile.multiplierFor(aPos);
                    const bScore = Number(b.dhq || 0) * leagueDraftProfile.multiplierFor(bPos);
                    return bScore - aScore;
                })
                .slice(0, 60)
                .forEach(r => {
                const pos = normPos(r.p.position) || r.p.position || 'UNK';
                if (!map[pos]) map[pos] = { pos, count: 0, top: pName(r.p), topPid: r.pid };
                map[pos].count += 1;
                (topPlayersByPos[pos] = topPlayersByPos[pos] || []).push(r);
            });
            return Object.values(map).sort((a, b) => b.count - a.count || a.pos.localeCompare(b.pos)).map(row => {
                const starterCount = leagueDraftProfile.starters[row.pos] || 0;
                const formatLabel = leagueDraftProfile.label;
                const pool = topPlayersByPos[row.pos] || [];
                const topName = pool[0] ? pName(pool[0].p) : row.top;
                const topCollege = pool[0]?.csv?.college || pool[0]?.p?.college || '';
                const topCapital = (() => {
                    const dr = Number(pool[0]?.csv?.draftRound) || 0;
                    if (dr === 1) return 'Round 1 capital';
                    if (dr === 2) return 'Round 2 capital';
                    if (dr === 3) return 'Round 3 capital';
                    if (dr >= 4) return 'Day 3 capital';
                    return '';
                })();
                const cliffPlayer = pool[Math.min(pool.length - 1, Math.max(0, Math.ceil(pool.length * 0.6)))];
                const cliffName = cliffPlayer ? pName(cliffPlayer.p) : '';
                const cliffDhq = cliffPlayer?.dhq > 0 ? fmtDhq(cliffPlayer.dhq) : '';
                const pedigreeBits = [topCapital, topCollege].filter(Boolean);
                const pedigree = pedigreeBits.length ? ' (' + pedigreeBits.join(' / ') + ')' : '';
                const sentences = [];
                if (row.count >= 14) {
                    sentences.push(row.count + ' top-60 ' + posLabel(row.pos) + ' prospects after adjusting for ' + formatLabel + ' — real depth at this position.');
                    if (topName) sentences.push(topName + pedigree + ' anchors the tier' + (cliffName && cliffName !== topName ? '; depth still lives down to ' + cliffName + (cliffDhq ? ' (' + cliffDhq + ')' : '') : '') + '.');
                    sentences.push('We can stay patient, let the room spend early capital, then attack the value pocket before the tier dries up.');
                } else if (row.count <= 6) {
                    sentences.push('Only ' + row.count + ' top-60 ' + posLabel(row.pos) + ' prospect' + (row.count === 1 ? '' : 's') + ' under ' + formatLabel + (starterCount ? ' — and the lineup starts ' + starterCount + ' ' + posLabel(row.pos) + '.' : '.'));
                    if (topName) sentences.push(topName + pedigree + ' is the top name; nothing should be assumed to fall.');
                    sentences.push('If this position matters to our build, we move on the tier early rather than wait for value.');
                } else {
                    sentences.push(row.count + ' top-60 ' + posLabel(row.pos) + ' prospects after adjusting for ' + formatLabel + ' — workable but not deep.');
                    if (topName) sentences.push(topName + pedigree + ' is the headliner' + (cliffName && cliffName !== topName ? '; ' + cliffName + ' marks the next tier break' + (cliffDhq ? ' (' + cliffDhq + ')' : '') : '') + '.');
                    sentences.push('Track the cliff, then let ' + valueShortLabel + ' decide if the board stays flat.');
                }
                return { ...row, alexBlurb: sentences.join(' ') };
            });
        }, [topProspects, normPos, leagueDraftProfile]);

        const needLabels = useMemo(() => {
            if (!rosterState.isUsable) return [];
            const urgencyScore = urgency => {
                const u = String(urgency || '').toLowerCase();
                if (u.includes('deficit') || u.includes('critical')) return 300;
                if (u.includes('thin') || u.includes('high')) return 200;
                return 100;
            };
            const projectedPicks = draftPredictionReport?.picks || [];

            // Rich per-position rationale that weaves in college, NFL capital,
            // landing team, age, and which player at this position the room is
            // about to take before our pick. Falls back gracefully when fields
            // are missing.
            const buildRosterNote = (target, pos, priorityScore) => {
                if (!target) {
                    return 'No clean ' + pos + ' target survives our pick — let the board come to us and reassess.';
                }
                const name = pName(target.p);
                const firstName = target.p?.first_name || name.split(' ')[0];
                const college = target.csv?.college || target.p?.college || target.p?.metadata?.college || '';
                const nflTeam = target.csv?.nflTeam || target.p?.team || '';
                const dRound = Number(target.csv?.draftRound) || 0;
                const isUDFA = !!target.csv?.isUDFA && !dRound;
                const ageRaw = Number(target.p?.age) || (target.csv?.age ? parseFloat(target.csv.age) : 0);
                const age = ageRaw > 0 && ageRaw < 35 ? Math.round(ageRaw) : 0;
                const dhqText = target.dhq > 0 ? fmtDhq(target.dhq) + ' ' + valueShortLabel : '';
                const slot = nextPickLabel || 'our next pick';

                let capital = '';
                if (dRound === 1) capital = 'Round 1 NFL capital';
                else if (dRound === 2) capital = 'Round 2 capital';
                else if (dRound === 3) capital = 'Round 3 capital';
                else if (dRound >= 4) capital = 'Day 3 (R' + dRound + ') capital';
                else if (isUDFA) capital = 'UDFA dart throw';

                const pedigreeBits = [capital, college, nflTeam ? 'in ' + nflTeam : ''].filter(Boolean);
                const pedigree = pedigreeBits.length ? ' (' + pedigreeBits.join(' / ') + ')' : '';

                const posGone = projectedPicks
                    .filter(p => Number(p.overall) < (nextPickOverall || Infinity)
                        && (normPos(p.pos) || p.pos) === pos)
                    .sort((a, b) => Number(b.overall) - Number(a.overall));
                const lastGone = posGone[0];
                const lastGoneSlot = lastGone
                    ? lastGone.round + '.' + String(lastGone.slot).padStart(2, '0')
                    : '';

                const sentences = [];
                if (priorityScore >= 300) {
                    sentences.push(pos + ' is a real lineup pressure point — ' + name + pedigree + ' is the clean way to close it at ' + slot + (dhqText ? ' (' + dhqText + ' value)' : '') + '.');
                } else if (priorityScore >= 200) {
                    sentences.push(pos + ' is a depth squeeze, not a panic spot. ' + name + pedigree + ' is the active target' + (dhqText ? ' at ' + dhqText : '') + '.');
                } else {
                    sentences.push(pos + ' stays on watch — ' + name + pedigree + ' is the name to monitor if value falls' + (dhqText ? ' (' + dhqText + ')' : '') + '.');
                }

                if (lastGone && posGone.length >= 2) {
                    sentences.push(posGone.length + ' ' + pos + 's are projected off before our pick (' + lastGone.name + ' at ' + lastGoneSlot + '), so this tier could move fast.');
                } else if (lastGone) {
                    sentences.push(lastGone.name + ' is projected to come off at ' + lastGoneSlot + '; ' + firstName + ' sits in the next tier behind him.');
                }

                if (age && age <= 21) {
                    sentences.push('Age curve still in front of him at ' + age + '.');
                }

                return sentences.join(' ');
            };

            return (assess?.needs || [])
                .map((raw, idx) => {
                    const item = typeof raw === 'string' ? { pos: raw, urgency: 'thin' } : raw;
                    const pos = normPos(item?.pos) || item?.pos;
                    const target = scoredAvailable.find(r => (normPos(r.pos || r.p?.position) || r.pos) === pos);
                    const urgency = item?.urgency || item?.level || 'thin';
                    const score = urgencyScore(urgency) + Math.max(0, 40 - idx * 8) + (Number(item?.count || 0) ? Math.max(0, 18 - Number(item.count) * 3) : 0);
                    const targetName = target ? pName(target.p) : null;
                    const priorityScore = urgencyScore(urgency);
                    const alexBlurb = buildRosterNote(target, pos, priorityScore);
                    return {
                        ...item,
                        pos,
                        urgency,
                        score,
                        priorityLabel: priorityScore >= 300 ? 'Critical priority' : priorityScore >= 200 ? 'High priority' : 'Watch priority',
                        targetName,
                        targetPid: target?.pid || '',
                        targetDhq: target?.dhq || 0,
                        alexBlurb,
                    };
                })
                .filter(n => n.pos && !['K', 'P'].includes(n.pos))
                .sort((a, b) => b.score - a.score)
                .slice(0, 6);
        }, [rosterState.isUsable, assess, scoredAvailable, draftPredictionReport, nextPickOverall, nextPickLabel, normPos]);

        const userMockRows = useMemo(() => {
            const picks = (draftPredictionReport?.picks || []).filter(p =>
                sameId(p.rosterId, myRoster?.roster_id)
                || (!p.rosterId && Number(p.slot) === Number(draftProjectionMeta.mySlot))
            );
            return picks
                .filter(pick => !['K', 'P'].includes(normPos(pick.pos)) || Number(pick.round || 0) >= 6)
                .map(pick => {
                    const pos = normPos(pick.pos) || pick.pos;
                    const fallback = 'We should take ' + pick.name + ' here only if the room leaves us this exact value pocket. The reason is ' + posLabel(pos) + ' utility for our build, not simply that he is the next player on the board.';
                    const rawImpact = pick.alexCommentary?.roomImpact || pick.alexCommentary?.teamImpact || pick.note || fallback;
                    let impact = String(rawImpact || fallback).trim()
                        .replace(/^[^.]+ projects to take [^.]+\.?\s*/i, '')
                        .replace(/^(This roster|The roster)\s+/i, 'We ');
                    if (/^For your build,\s*this becomes/i.test(impact)) {
                        impact = impact.replace(/^For your build,\s*this becomes/i, 'We should use this as');
                    } else if (/^For your build,/i.test(impact)) {
                        impact = impact.replace(/^For your build,\s*/i, 'We should ');
                    } else if (/^For you,/i.test(impact)) {
                        impact = impact.replace(/^For you,\s*/i, 'We should account for how ');
                    }
                    return {
                        ...pick,
                        pos,
                        pickLabel: pick.round + '.' + String(pick.slot).padStart(2, '0'),
                        school: pick.school || pick.college || 'School TBD',
                        nflTeam: pick.nflTeam || pick.team || 'Team TBD',
                        photoUrl: pick.photoUrl || (pick.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + pick.pid + '.jpg' : ''),
                        impact: /^we\b/i.test(impact) ? impact : 'We should ' + impact.charAt(0).toLowerCase() + impact.slice(1),
                        driverText: (pick.drivers || []).slice(0, 3).map(d => d.label).join(' - ') || 'projection',
                    };
                });
        }, [draftPredictionReport, myRoster?.roster_id, draftProjectionMeta.mySlot]);

        const compactPickLabel = useCallback((pk) => {
            if (!pk) return '--';
            return fmtPick(pk).replace(String(leagueSeason) + ' ', '');
        }, [fmtPick, leagueSeason]);

        const alexPickPlanText = useCallback((pick, pos, targetName, targetNeed, idx) => {
            const label = pick ? compactPickLabel(pick) : (idx ? 'later pick' : nextPickLabel);
            const needWord = targetNeed?.priorityLabel ? targetNeed.priorityLabel.toLowerCase() : 'board value';
            const posName = posLabel(pos);
            if (targetNeed) {
                return 'At ' + label + ', I want ' + targetName + ' because ' + posName + ' is already one of our real roster pressure points. This is not just taking the top name left; it is using the pick to fix a lineup problem while the value is still defendable.';
            }
            if (pos === 'QB') return 'At ' + label + ', I would only take ' + targetName + ' if the room leaves us a real QB value pocket. The point is insulation and weekly ceiling, not collecting another name.';
            if (pos === 'RB') return 'At ' + label + ', ' + targetName + ' makes sense if we need a younger value swing against the roster age curve. I would not force RB over a cleaner tier at another position.';
            if (['DL', 'LB', 'DB'].includes(pos)) return 'At ' + label + ', ' + targetName + ' is an IDP value bet. I would take it only if the room has not already drained the tier before our pick.';
            return 'At ' + label + ', I would use ' + targetName + ' as a ' + needWord + ' checkpoint. If the board is flat, this is the kind of pick that keeps our build flexible without sacrificing ' + valueShortLabel + '.';
        }, [compactPickLabel, nextPickLabel]);

        // Alex's Recommended Draft — simulates Alex's pick at each of the user's
        // slots in sequence. At each pick we treat as "gone" the projected picks
        // from other rosters before that overall (plus anything Alex already
        // recommended at an earlier user pick), then score the remaining pool
        // with the same composite formula as `scoredAvailable`.
        const aiDraftPathRows = useMemo(() => {
            if (!rosterState.isUsable) return [];
            const myPickList = currentCapitalRow.picks.slice(0, 5);
            if (!myPickList.length) return [];

            const targetPos = (strategyRec?.type === 'target' && strategyRec?.label)
                ? strategyRec.label.replace('Target ', '')
                : null;
            const projectedPicks = draftPredictionReport?.picks || [];
            const myRosterId = myRoster?.roster_id;
            const claimed = new Set();
            const claimedByPos = {};

            // Build a varied, data-rich rationale per pick — leans on CSV scouting
            // (NFL capital, college, landing team, age) plus position-run context
            // (who at this position has already come off the board, by what slot).
            const buildPickRationale = (r, pos, pk, pickOverall) => {
                const name = pName(r.p);
                const firstName = (r.p?.first_name || name.split(' ')[0] || 'this pick');
                const slot = compactPickLabel(pk);
                const need = needLabels.find(n => n.pos === pos);
                const alreadyClaimed = claimedByPos[pos] || 0;

                const college = r.csv?.college || r.p?.college || r.p?.metadata?.college || '';
                const nflTeam = r.csv?.nflTeam || r.p?.team || '';
                const dRound = Number(r.csv?.draftRound) || 0;
                const isUDFA = !!r.csv?.isUDFA && !dRound;
                const ageRaw = Number(r.p?.age) || (r.csv?.age ? parseFloat(r.csv.age) : 0);
                const age = ageRaw > 0 && ageRaw < 35 ? Math.round(ageRaw) : 0;
                const consensusRank = r.consensusRank || r.csv?.rank || 0;
                const risk = r.csv?.risk || '';

                let capital = '';
                if (dRound === 1) capital = 'Round 1 NFL capital';
                else if (dRound === 2) capital = 'Round 2 capital';
                else if (dRound === 3) capital = 'Round 3 capital';
                else if (dRound >= 4) capital = 'Day 3 (R' + dRound + ') capital';
                else if (isUDFA) capital = 'UDFA dart throw';

                let pedigree = '';
                if (capital && college && nflTeam) pedigree = ' — ' + capital + ', ' + college + ' / ' + nflTeam;
                else if (capital && college) pedigree = ' — ' + capital + ' out of ' + college;
                else if (capital && nflTeam) pedigree = ' — ' + capital + ' / ' + nflTeam;
                else if (college && nflTeam) pedigree = ' — ' + college + ' to ' + nflTeam;
                else if (capital) pedigree = ' (' + capital + ')';
                else if (college) pedigree = ' out of ' + college;
                else if (nflTeam) pedigree = ' (landing in ' + nflTeam + ')';

                const posGone = projectedPicks
                    .filter(p => Number(p.overall) < pickOverall && (normPos(p.pos) || p.pos) === pos)
                    .sort((a, b) => Number(b.overall) - Number(a.overall));
                const lastGone = posGone[0];
                const lastGoneSlot = lastGone
                    ? lastGone.round + '.' + String(lastGone.slot).padStart(2, '0')
                    : '';

                const dhqText = r.dhq > 0 ? fmtDhq(r.dhq) + ' ' + valueShortLabel : '';

                const sentences = [];
                if (alreadyClaimed >= 1) {
                    sentences.push('At ' + slot + ', ' + name + pedigree + ' doubles up the ' + pos + ' room — second swing now that we have already anchored the position.');
                } else if (lastGone && posGone.length >= 2) {
                    sentences.push('At ' + slot + ', ' + posGone.length + ' ' + pos + 's are off the board (' + lastGone.name + ' just went at ' + lastGoneSlot + '); ' + name + pedigree + ' is the next clean tier for us.');
                } else if (lastGone) {
                    sentences.push('At ' + slot + ', ' + name + pedigree + ' is our ' + pos + ' answer after ' + lastGone.name + ' came off at ' + lastGoneSlot + '.');
                } else if (need?.urgency === 'deficit') {
                    sentences.push('At ' + slot + ', ' + name + pedigree + ' closes our ' + pos + ' deficit before the position run forces our hand.');
                } else if (need) {
                    sentences.push('At ' + slot + ', ' + name + pedigree + ' shores up a ' + pos + ' depth squeeze without reaching past the tier.');
                } else {
                    sentences.push('At ' + slot + ', ' + name + pedigree + ' is the strongest piece left on our board.');
                }

                // Second sentence: value + need framing, or pure BPA framing
                if (need && alreadyClaimed === 0 && dhqText) {
                    const needWord = need.urgency === 'deficit' ? 'a deficit slot' : 'a real depth squeeze';
                    sentences.push(pos + ' is ' + needWord + ' on our build, and ' + dhqText + ' is honest value at this pick.');
                } else if (alreadyClaimed >= 1 && dhqText) {
                    sentences.push('At ' + dhqText + ', this is the kind of depth move that keeps the build flexible.');
                } else if (dhqText) {
                    sentences.push(dhqText + ' on the board — value over a positional reach.');
                }

                // Optional third sentence: risk/age tag if it adds something
                if (risk && /high|long.?shot|boom|bust/i.test(risk)) {
                    sentences.push('Risk tag: ' + risk + (age ? ' at age ' + age : '') + '.');
                } else if (age && age <= 21 && firstName) {
                    sentences.push(firstName + ' is a ' + age + '-year-old prospect — age curve still in front of him.');
                } else if (consensusRank && consensusRank <= 36) {
                    sentences.push('Consensus board has him in the top ' + (consensusRank <= 12 ? '12' : consensusRank <= 24 ? '24' : '36') + ' of this class.');
                }

                return sentences.join(' ');
            };

            return myPickList.map((pk, idx) => {
                const pickOverall = ((Number(pk.round || 1) - 1) * leagueSize)
                    + (slotFor(pk) || draftProjectionMeta.mySlot || idx + 1);
                // Pids the room has consumed before this pick. Skip my own roster's
                // projected picks because Alex's plan overrides them.
                const gone = new Set();
                if (projectedPicks.length) {
                    projectedPicks.forEach(p => {
                        if (Number(p.overall) >= pickOverall) return;
                        if (myRosterId != null && sameId(p.rosterId, myRosterId)) return;
                        if (p.pid != null) gone.add(String(p.pid));
                    });
                } else {
                    topProspects
                        .filter(r => !draftedPids.has(r.pid))
                        .slice(0, Math.max(0, pickOverall - 1))
                        .forEach(r => { if (r.pid != null) gone.add(String(r.pid)); });
                }
                claimed.forEach(pid => gone.add(pid));

                const top = topProspects
                    .map((r, i) => ({ ...r, expectedRank: i + 1 }))
                    .filter(r => {
                        if (r.pid == null) return false;
                        if (draftedPids.has(r.pid)) return false;
                        if (gone.has(String(r.pid))) return false;
                        const pos = normPos(r.p.position) || r.p.position;
                        return !['K', 'P'].includes(pos);
                    })
                    .map(r => {
                        const pos = normPos(r.p.position) || r.p.position;
                        const needEntry = assess?.needs?.find(n => n.pos === pos);
                        // Decay need bonus as Alex has already claimed players at this position
                        // earlier in the sequence — prevents the simulation from stacking the
                        // same position when one good fit is already locked in.
                        const alreadyFilled = claimedByPos[pos] || 0;
                        let needBonus = 0;
                        if (needEntry?.urgency === 'deficit') {
                            needBonus = alreadyFilled === 0 ? 1700 : alreadyFilled === 1 ? 600 : 0;
                        } else if (needEntry) {
                            needBonus = alreadyFilled === 0 ? 850 : alreadyFilled === 1 ? 300 : 0;
                        }
                        const targetBonus = targetPos && pos === targetPos && alreadyFilled === 0 ? 1200 : 0;
                        // Pure BPA: DHQ + need bonus + target bonus. Availability is enforced
                        // by the `gone` filter above, so high-DHQ steals beat slot-matching players.
                        const score = r.dhq * 0.58 + needBonus + targetBonus;
                        return { row: r, pos, score };
                    })
                    .sort((a, b) => b.score - a.score)[0];

                if (!top) return null;
                const { row: r, pos } = top;
                const targetName = pName(r.p);
                const targetNeed = needLabels.find(n => n.pos === pos);
                const impact = buildPickRationale(r, pos, pk, pickOverall);
                claimed.add(String(r.pid));
                claimedByPos[pos] = (claimedByPos[pos] || 0) + 1;

                return {
                    pid: r.pid,
                    overall: pickOverall,
                    pickLabel: compactPickLabel(pk),
                    name: targetName,
                    pos,
                    school: r.csv?.college || r.p?.college || r.p?.metadata?.college || 'School TBD',
                    nflTeam: r.csv?.nflTeam || r.p?.team || 'Team TBD',
                    photoUrl: r.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + r.pid + '.jpg' : '',
                    dhq: r.dhq || 0,
                    impact,
                    driverText: targetNeed ? 'roster pressure' : valueShortLabel + ' tier value',
                    source: 'recommendation',
                };
            }).filter(Boolean);
        }, [
            rosterState.isUsable, currentCapitalRow.picks, draftPredictionReport,
            myRoster?.roster_id, topProspects, draftedPids, assess, strategyRec,
            leagueSize, slotFor, draftProjectionMeta.mySlot, normPos,
            compactPickLabel, needLabels,
        ]);

        const requestFullDraftReport = useCallback(() => {
            if (typeof setReconPanelOpen !== 'function' || typeof sendReconMessage !== 'function') return;
            if (!rosterState.isUsable) { alert(rosterState.message); return; }
            setReconPanelOpen(true);
            const needs = needLabels.map(n => n.pos + (n.urgency === 'deficit' ? ' critical' : '')).join(', ') || 'balanced';
            const picks = myPicks.filter(p => p.year === leagueSeason).map(fmtPick).join(', ') || 'unknown';
            const prompt = isRookieDraft
                ? `SEARCH THE WEB for current ${leagueSeason} NFL draft prospect rankings. Generate a full ${skinFeatures.showDynastyValue === false ? 'rookie draft' : 'dynasty rookie draft'} plan.\n\n` +
                    `League size: ${leagueSize}\nMy needs: ${needs}\nMy picks: ${picks}\n\n` +
                    `Cover: position tiers, best fits at my slots, players worth moving up for, trade-down pockets, and avoid zones. Use specific prospect names.`
                : `Generate a full ${leagueSeason} redraft plan from the current player pool.\n\n` +
                    `League size: ${leagueSize}\nMy needs: ${needs}\nMy draft slots: ${picks}\n\n` +
                    `Cover: positional tiers, early-round build paths, mid-round targets, late values, kicker/DST timing, and avoid zones. Use specific player names from the board.`;
            sendReconMessage(prompt);
        }, [setReconPanelOpen, sendReconMessage, rosterState.isUsable, rosterState.message, needLabels, myPicks, leagueSeason, leagueSize, fmtPick, isRookieDraft, skinFeatures.showDynastyValue]);

        const requestClassOverview = useCallback(() => {
            if (typeof setReconPanelOpen !== 'function' || typeof sendReconMessage !== 'function') return;
            setReconPanelOpen(true);
            sendReconMessage(
                isRookieDraft
                    ? 'Give me a concise ' + leagueSeason + ' rookie class overview by position, including class strengths, cliff points, and where my current picks should attack.'
                    : 'Give me a concise ' + leagueSeason + ' redraft board overview by position, including tier cliffs, scarce pockets, and where my draft slots should attack.'
            );
        }, [setReconPanelOpen, sendReconMessage, leagueSeason, isRookieDraft]);

        // Tag button helper
        const tagDefs = { target: { icon: '\u2605', color: '#2ECC71', label: 'Target' }, avoid: { icon: '\u2717', color: '#E74C3C', label: 'Avoid' }, sleeper: { icon: '\u26A1', color: '#3498DB', label: 'Sleeper' }, must: { icon: '\u2B50', color: '#D4AF37', label: 'Must' } };

        const draftViewLabels = { command: 'Flash Brief', board: 'Big Board', mock: 'Mock Draft Center', live: 'Live Draft' };
        const draftViewContext = {
            command: 'Your picks, board value, and draft-room priorities.',
            board: isRookieDraft ? 'Prospect board, tags, tiers, and saved scouting views.' : 'Full player board, tags, tiers, and saved redraft views.',
            mock: 'Scenario testing, roster impact, and draft capital outcomes.',
            live: 'Live Sleeper mirror with your board, roster build, and opponent intel.'
        };
        const launchLiveDraft = () => {
            setLiveAutoStartToken(Date.now());
            setDraftView('live');
        };
        const pickFocusLabel = pickFocus?.label || (pickFocus ? `${pickFocus.year || ''} R${pickFocus.round || '?'}` : '');
        const pickFocusSummary = pickFocus
            ? [
                pickFocus.currentOwnerName ? `Current owner: ${pickFocus.currentOwnerName}` : null,
                pickFocus.originalOwnerName ? `Original: ${pickFocus.originalOwnerName}` : null,
                pickFocus.status || null,
                pickFocus.value ? `${Number(pickFocus.value).toLocaleString()} ${valueShortLabel}` : null,
              ].filter(Boolean).join(' - ')
            : '';
        const clearPickFocus = () => {
            window._wrDraftPickFocus = null;
            setPickFocus(null);
        };

        const renderAnalystFlash = () => (
            <section className="draft-hq-action-card draft-analyst-flash">
                <div className="draft-hq-panel-head draft-alex-head">
                    <span>Alex Analyst Mock</span>
                    <em>{activeFlashAnalystReport ? activeFlashAnalystReport.label + ' - ' + activeFlashAnalystReport.assumptions.rounds + ' round' + (Number(activeFlashAnalystReport.assumptions.rounds) === 1 ? '' : 's') : '1st round ready'}</em>
                    <button type="button" className="draft-alex-generate" disabled={flashAnalystStatus === 'running' || !boardPoolForContext.length} onClick={generateFlashAnalystMock}>
                        {flashAnalystStatus === 'running' ? 'Generating' : activeFlashAnalystReport ? 'Refresh' : 'Generate'}
                    </button>
                </div>
                <div className="draft-alex-toolbar">
                    <div className="draft-alex-presets">
                        {flashAnalystPresetOptions.map(preset => (
                            <button key={preset.id} type="button" className={flashAnalystPresetId === preset.id ? 'is-active' : ''} onClick={() => setFlashAnalystPresetId(preset.id)}>
                                {preset.label}
                            </button>
                        ))}
                    </div>
                    <label className="draft-alex-rounds">
                        <span>Rounds</span>
                        <select value={flashAnalystRoundLimit} onChange={e => setFlashAnalystRoundLimit(e.target.value)}>
                            {flashRoundOptions.map(round => (
                                <option key={round} value={round} style={{ background: '#111' }}>{round}R</option>
                            ))}
                            <option value="full" style={{ background: '#111' }}>Full</option>
                        </select>
                    </label>
                </div>
                {activeFlashAlexBrief ? (
                    <div className="draft-alex-message">
                        <div className="draft-alex-avatar">A</div>
                        <div className="draft-alex-body">
                            <div className="draft-alex-meta">
                                <strong>{activeFlashAlexBrief.author}</strong>
                                <span>{activeFlashAlexBrief.headline}</span>
                            </div>
                            <p>{activeFlashAlexBrief.intro}</p>
                            <div className="draft-alex-user-path">
                                <strong>Your path</strong>
                                <span>{activeFlashAlexBrief.userPath}</span>
                            </div>
                            <div className="draft-alex-pick-list">
                                {activeFlashAlexBrief.pickLines.map(line => (
                                    <div key={line.overall} className={'draft-alex-pick-line' + (line.isUser ? ' is-user' : '')} role="button" tabIndex={0} title="Open player card" onClick={() => openDraftPlayer(line.pid)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDraftPlayer(line.pid); } }}>
                                        <span className="draft-alex-pick-no">{line.pickLabel}</span>
                                        <img className="draft-alex-player-photo" src={line.photoUrl} alt="" onError={e => e.currentTarget.style.visibility = 'hidden'} />
                                        <span className="draft-alex-pick-main">
                                            <strong>{line.player} <em>{line.pos}</em></strong>
                                            <small>{line.nflTeam} - {line.school}</small>
                                            <i>{line.commentary}</i>
                                        </span>
                                        <span className="draft-alex-pick-value">
                                            <strong>{line.dhq}</strong>
                                            <small>{line.value}</small>
                                            <em>{line.driver}</em>
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <div className="draft-alex-footer">
                                <span>{activeFlashAlexBrief.footer}</span>
                                <button type="button" onClick={() => setDraftView('mock')}>Open Mock Center</button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="draft-alex-preview-board">
                        {activeFlashPreviewReport ? (
                            <div className="draft-alex-preview-picks">
                                {(activeFlashPreviewReport.picks || []).slice(0, draftProjectionMeta.numTeams || leagueSize).map(pick => (
                                    <button key={activeFlashPreviewReport.presetId + '-' + pick.overall} type="button" title="Open player card" onClick={e => { e.stopPropagation(); openDraftPlayer(pick.pid); }}>
                                        <span>{pick.round}.{String(pick.slot).padStart(2, '0')} · {pick.pos || 'POS'} · {pick.nflTeam || pick.team || 'NFL'}</span>
                                        <em>{pick.ownerName || ('Team ' + pick.slot)}</em>
                                        <b>{pick.name}</b>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <div className="draft-alex-empty">
                                <strong>First-round mocks are loading.</strong>
                                <span>{flashAnalystError || 'Alex will publish league-reality, board-lens, and trade-market snapshots here.'}</span>
                            </div>
                        )}
                    </div>
                )}
            </section>
        );

        return (
            <div style={{ padding: 'var(--card-pad, 14px 16px)' }}>
                <div className={'wr-module-strip' + (activeView === 'live' || activeView === 'mock' ? ' is-compact' : '')}>
                    {(activeView !== 'live' && activeView !== 'mock') && (
                        <div className="wr-module-context">
                            <span>Draft</span>
                            <strong>{draftViewLabels[activeView] || 'Flash Brief'}</strong>
                            <em>{draftViewContext[activeView] || draftViewContext.command}</em>
                        </div>
                    )}
                    <div className="wr-module-actions">
                    <div className="wr-module-nav">
                    <button type="button" className={activeView === 'command' ? 'is-active' : ''} onClick={() => setDraftView('command')}>Flash Brief</button>
                    <button type="button" className={activeView === 'board' ? 'is-active' : ''} onClick={() => setDraftView('board')}>Big Board</button>
                    <button type="button" className={activeView === 'mock' ? 'is-active' : ''} onClick={() => setDraftView('mock')}>Mock Draft Center</button>
                    </div>
                    <button type="button" className={'wr-live-draft-action' + (activeView === 'live' ? ' is-active' : '')} onClick={launchLiveDraft}>Follow Live Draft</button>
                    </div>
                </div>

                {pickFocus && (
                    <div className="draft-pick-context-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', background: 'rgba(212,175,55,0.08)', border: '1px solid rgba(212,175,55,0.24)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                        <div style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: '0.68rem', color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Pick Focus</span>
                            <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.9rem', fontFamily: 'Rajdhani, sans-serif' }}>{pickFocusLabel}</strong>
                            <em style={{ display: 'block', color: 'var(--silver)', fontSize: '0.74rem', fontStyle: 'normal' }}>{pickFocusSummary || 'Opened from the pick ledger.'}</em>
                        </div>
                        <button type="button" onClick={clearPickFocus} style={{ background: 'transparent', border: '1px solid rgba(212,175,55,0.32)', borderRadius: '4px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.72rem', padding: '4px 10px', textTransform: 'uppercase' }}>Clear</button>
                    </div>
                )}

                {/* ═══════════════════ VIEW 1: FLASH BRIEF ═══════════════════ */}
                {activeView === 'command' && (
                    <div className="draft-hq-shell">
                        <div className="draft-hq-hero">
                            <section className="draft-hq-panel draft-hq-capital-targeting">
                                <div className="draft-hq-panel-head">
                                    <span>Draft Capital + Roster Targeting</span>
                                    <em>{myPicks.length} picks - {fmtDhq(totalPickCapital)} {valueShortLabel}</em>
                                </div>
                                <div className="draft-pick-group">
                                    {[currentCapitalRow].map(row => {
                                        const yearPicks = row.picks;
                                        return (
                                            <div key={row.year}>
                                                <div className="draft-pick-year"><span>{row.year}</span><em>{yearPicks.length} picks - {fmtDhq(row.totalValue)} {valueShortLabel}</em></div>
                                                {yearPicks.length ? (
                                                    <div className="draft-pick-chipline">
                                                        {yearPicks.map((pk, i) => {
                                                            const cls = (pk === nextPick ? 'is-next ' : '') + (!pk.own ? 'is-acquired' : '');
                                                            return <span key={row.year + '-' + pk.round + '-' + i} className={cls.trim()} title={(pk.own ? 'Your native pick' : ('Acquired from roster ' + pk.from)) + (pk.value ? ' - ' + fmtDhq(pk.value) + ' ' + valueShortLabel : '')}>{fmtPick(pk)}{pk.value ? ' - ' + fmtDhq(pk.value) : ''}</span>;
                                                        })}
                                                    </div>
                                                ) : <div className="draft-empty">No picks in this year.</div>}
                                            </div>
                                        );
                                    })}
                                    {futureCapitalRows.length > 0 && (
                                    <button type="button" className="draft-future-toggle" onClick={() => setShowFuturePickCapital(v => !v)}>
                                        <strong>{showFuturePickCapital ? 'v' : '>'}</strong>
                                        <span>{showFuturePickCapital ? (skinFeatures.showFuturePicks === false ? 'Hide other pick years' : 'Hide future picks') : (skinFeatures.showFuturePicks === false ? 'Show other pick years' : 'Show future picks')}</span>
                                        <em>{futureCapitalRows.reduce((sum, row) => sum + row.picks.length, 0)} picks - {fmtDhq(futurePickCapital)} {valueShortLabel}</em>
                                    </button>
                                    )}
                                    {showFuturePickCapital && futureCapitalRows.map(row => {
                                        const yearPicks = row.picks;
                                        return (
                                            <div key={row.year}>
                                                <div className="draft-pick-year"><span>{row.year}</span><em>{yearPicks.length} picks - {fmtDhq(row.totalValue)} {valueShortLabel}</em></div>
                                                {yearPicks.length ? (
                                                    <div className="draft-pick-chipline">
                                                        {yearPicks.map((pk, i) => {
                                                            const cls = !pk.own ? 'is-acquired' : '';
                                                            return <span key={row.year + '-' + pk.round + '-' + i} className={cls} title={(pk.own ? 'Your native pick' : ('Acquired from roster ' + pk.from)) + (pk.value ? ' - ' + fmtDhq(pk.value) + ' ' + valueShortLabel : '')}>{fmtPick(pk)}{pk.value ? ' - ' + fmtDhq(pk.value) : ''}</span>;
                                                        })}
                                                    </div>
                                                ) : <div className="draft-empty">No picks in this year.</div>}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="draft-hq-subhead">Roster Targeting</div>
                                <div className="draft-target-header">
                                    <span>Pos</span>
                                    <span>Urgency</span>
                                    <span>Best Target</span>
                                    <span>Alex Note</span>
                                </div>
                                <div className="draft-run-list">
                                    {needLabels.length ? needLabels.map(n => (
                                        <div key={n.pos} className="draft-run-note-row draft-target-row">
                                            <strong style={{ color: posColors[n.pos] || 'var(--gold)' }}>{n.pos}</strong>
                                            <span>{n.priorityLabel}</span>
                                            <em>
                                                {n.targetName ? (
                                                    <>
                                                        <button type="button" onClick={() => openDraftPlayer(n.targetPid)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(212,175,55,0.35)' }}>{n.targetName}</button>
                                                        {n.targetDhq ? ' - ' + fmtDhq(n.targetDhq) + ' ' + valueShortLabel : ''}
                                                        <button type="button" onClick={() => setBoardTags(prev => ({ ...prev, [n.targetPid]: 'target' }))} style={{ marginLeft: 6, border: '1px solid rgba(212,175,55,0.24)', background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', borderRadius: 5, padding: '2px 5px', fontSize: '0.54rem', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>Tag</button>
                                                    </>
                                                ) : (n.count ? n.count + ' players' : 'no clean target loaded')}
                                            </em>
                                            <p>{n.alexBlurb}</p>
                                        </div>
                                    )) : <div className="draft-empty">No urgent roster gaps detected. Bias to value and tiers.</div>}
                                </div>
                            </section>

                            <aside className="draft-hq-actions">
                                <div className="draft-hq-action-card">
                                    <strong>Draft Plan</strong>
                                    <p>Generate AI scouting and class reads, then apply them to your board.</p>
                                    <div className="draft-card-actions draft-card-actions-grouped">
                                        <div className="draft-card-actions-row">
                                            <button type="button" disabled={!rosterState.isUsable} title={!rosterState.isUsable ? rosterState.message : 'Generate draft scouting report'} onClick={requestFullDraftReport}>{rosterState.isUsable ? 'Generate Report' : 'Sync Required'}</button>
                                            <button type="button" onClick={requestClassOverview}>Class Read</button>
                                        </div>
                                        <div className="draft-card-actions-row">
                                            <button type="button" disabled={!aiRecommendedOrder.length} onClick={() => applyAiOrderToUserBoard('master')}>Apply to Board</button>
                                            <button type="button" disabled={!aiRecommendedOrder.length || !boardPosFilter} onClick={() => applyAiOrderToUserBoard('position')}>Apply Position</button>
                                        </div>
                                    </div>
                                </div>
                                {renderAnalystFlash()}
                            </aside>
                        </div>

                        {!rosterState.isUsable && window.App?.renderRosterDataBlocker?.(rosterState, {
                            title: 'Draft roster targeting paused',
                            message: 'Pick inventory is still visible, but need-based targeting is hidden until roster IDs finish loading.',
                            detail: rosterState.detail,
                            actionLabel: 'Refresh Data',
                            style: { marginBottom: '14px', minHeight: '170px' },
                        })}

                        <div className="draft-hq-grid">
                            <section className="draft-hq-panel">
                                <div className="draft-hq-panel-head">
                                    <span>Alex's Recommended Draft</span>
                                    <em>{aiDraftPathRows.length ? aiDraftPathRows.length + ' recommended picks' : 'waiting on projection'}</em>
                                </div>
                                <div className="draft-rec-list">
                                    {aiDraftPathRows.length ? aiDraftPathRows.map((pick, i) => (
                                        <div
                                            key={pick.overall + '-' + pick.pid}
                                            className={'draft-rec-card draft-user-mock-card' + (i === 0 ? ' is-primary' : '')}
                                            role="button"
                                            tabIndex={0}
                                            title="Open scouting card in Big Board"
                                            onClick={() => setScoutDrawerPid(pick.pid)}
                                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setScoutDrawerPid(pick.pid); } }}
                                        >
                                            <span className="draft-rec-rank">{pick.pickLabel}</span>
                                            <img className="draft-rec-photo" src={pick.photoUrl} alt="" onError={e => e.currentTarget.style.visibility = 'hidden'} />
                                            <span className="draft-rec-main">
                                                <strong>{pick.name} <small>{pick.pos}</small></strong>
                                                <em>{pick.nflTeam} - {pick.school} - {pick.driverText}</em>
                                            </span>
                                            <span className="draft-rec-score">
                                                <strong style={{ color: 'var(--gold)' }}>{fmtDhq(pick.dhq)}</strong>
                                                <span>{valueShortLabel}</span>
                                            </span>
                                            <span className="draft-rec-reason">{pick.impact}</span>
                                            <span className="draft-rec-actions">
                                                <button type="button" onClick={e => { e.stopPropagation(); setScoutDrawerPid(pick.pid); }}>Scout</button>
                                                <button type="button" onClick={e => { e.stopPropagation(); setBoardTags(prev => ({ ...prev, [pick.pid]: 'target' })); }}>Tag Target</button>
                                                <button type="button" onClick={e => { e.stopPropagation(); setDraftView('mock'); }}>Mock It</button>
                                            </span>
                                        </div>
                                    )) : <div className="draft-empty">No clean AI path yet. Sync the draft board or roster data, then Alex will publish our pick plan here.</div>}
                                </div>
                            </section>

                            <section className="draft-hq-panel">
                                <div className="draft-hq-panel-head">
                                    <span>Board Pressure</span>
                                    <em>{nextPickOverall ? 'before ' + nextPickLabel : 'pre-draft'}</em>
                                </div>
                                <div className="draft-run-list">
                                    {positionRunRows.length ? positionRunRows.map(row => (
                                        <div key={row.pos}>
                                            <strong style={{ color: posColors[row.pos] || 'var(--gold)' }}>{row.pos}</strong>
                                            <span>{row.count} likely gone</span>
                                            <em>{row.names.join(', ')}</em>
                                        </div>
                                    )) : <div className="draft-empty">No pick-pressure read yet.</div>}
                                </div>

                                <div className="draft-hq-subhead">Class Depth</div>
                                <div className="draft-run-list">
                                    {classDepthRows.map(row => (
                                        <div key={row.pos} className="draft-run-note-row">
                                            <strong style={{ color: posColors[row.pos] || 'var(--gold)' }}>{row.pos}</strong>
                                            <span>{row.count} top-60 {draftPoolNoun}</span>
                                            <em>
                                                <button type="button" onClick={() => openDraftPlayer(row.topPid)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'rgba(212,175,55,0.35)' }}>{row.top}</button>
                                                <button type="button" onClick={() => setBoardTags(prev => ({ ...prev, [row.topPid]: 'target' }))} style={{ marginLeft: 6, border: '1px solid rgba(212,175,55,0.24)', background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', borderRadius: 5, padding: '2px 5px', fontSize: '0.54rem', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>Tag</button>
                                            </em>
                                            <p>{row.alexBlurb}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                        {scoutDrawerPid && (() => {
                            const r = draftPoolRows.find(row => String(row.pid) === String(scoutDrawerPid));
                            if (!r) return null;
                            const pos = normPos(r.p.position) || r.p.position;
                            const cs = r.csv || {};
                            const team = cs.nflTeam || r.p?.team || '';
                            const college = cs.college || r.p.college || r.p.metadata?.college || '';
                            const age = r.p.age || (cs.age ? parseFloat(cs.age) : null)
                                || (r.p.birth_date ? Math.floor((Date.now() - new Date(r.p.birth_date).getTime()) / 31557600000) : (r.p.years_exp === 0 ? 21 : null));
                            const valueRank = valueRankMaps.valueRank.get(String(r.pid)) || null;
                            const posList = valueRankMaps.posLists[pos] || [];
                            const posRank = posList.indexOf(String(r.pid)) >= 0 ? posList.indexOf(String(r.pid)) + 1 : null;
                            const tierMeta = valueTierMeta(r.dhq, valueRank);
                            const sizeStr = cs.size || (r.p?.height ? Math.floor(r.p.height / 12) + "'" + (r.p.height % 12) : '');
                            const wtStr = cs.weight || r.p?.weight || '';
                            const speedStr = cs.speed || '';
                            const profileStr = [sizeStr, wtStr && wtStr + ' lb', speedStr && speedStr + ' 40'].filter(Boolean).join(' / ') || '-';
                            const draftRound = Number(cs.draftRound) || 0;
                            const draftPick = Number(cs.draftPick) || 0;
                            const draftStr = draftRound
                                ? 'R' + draftRound + (draftPick ? '.' + String(draftPick).padStart(2, '0') : '')
                                : draftPick ? '#' + draftPick : isTrueUdfa(cs) ? 'UDFA' : 'Capital TBD';
                            const rankStr = (isRookieDraft && (cs.consensusRank || cs.rank))
                                ? '#' + Math.round(cs.consensusRank || cs.rank)
                                : (valueRank ? '#' + valueRank : '-');
                            const tierStr = (isRookieDraft && cs.tier) ? cs.tier : tierMeta.label;
                            const summaryBits = String(cs.summary || '')
                                .split(/(?<=[.!?])\s+/)
                                .map(s => s.trim())
                                .filter(Boolean)
                                .slice(0, 4);
                            const reportBits = isSeasonalDraftCtx
                                ? generatedScoutingBits(r, { pos, team, age, valueRank, posRank, tierMeta })
                                : (summaryBits.length ? summaryBits : generatedScoutingBits(r, { pos, team, age, valueRank, posRank, tierMeta }));
                            const compText = cs.nflComp || cs.comp || '';
                            const photoSrc = r.isCSVOnly && cs.espnId
                                ? 'https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/' + cs.espnId + '.png&w=96&h=70'
                                : 'https://sleepercdn.com/content/nfl/players/thumb/' + r.pid + '.jpg';
                            // Drawer shows one player; tier coloring lived on the Big Board column
                            // for scannability. Here we just keep the value readable in white.
                            const dhqC = 'var(--white)';
                            const detailLabel = { display: 'block', color: 'var(--gold)', fontSize: '0.58rem', fontFamily: 'var(--font-body)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
                            const detailBox = { border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)', borderRadius: 8, padding: '9px 10px', minWidth: 0 };
                            return (
                                <div className="draft-scout-drawer-backdrop" onClick={() => setScoutDrawerPid(null)}>
                                    <div className="draft-scout-drawer" onClick={e => e.stopPropagation()}>
                                        <div className="draft-scout-drawer-head">
                                            <img src={photoSrc} alt="" onError={e => e.currentTarget.style.display = 'none'} className="draft-scout-drawer-photo" />
                                            <div className="draft-scout-drawer-title">
                                                <strong>{pName(r.p)} <small>{pos}</small></strong>
                                                <em>{[team, college].filter(Boolean).join(' · ') || 'Team / school TBD'}{age ? ' · age ' + age : ''}</em>
                                            </div>
                                            <button type="button" className="draft-scout-drawer-close" onClick={() => setScoutDrawerPid(null)} aria-label="Close scouting card">×</button>
                                        </div>
                                        <div className="draft-scout-drawer-body">
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 0.72fr) minmax(420px, 1.28fr)', gap: 10, marginBottom: 12 }}>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Card Snapshot</span>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 5 }}>
                                                        {[
                                                            [valueShortLabel, r.dhq > 0 ? r.dhq.toLocaleString() : '-'],
                                                            ['Rank', rankStr],
                                                            ['Tier', tierStr],
                                                            ['Draft', draftStr],
                                                            ['Team', team || 'TBD'],
                                                            ['Age', age || '-'],
                                                            ['Profile', profileStr],
                                                        ].map(([label, value]) => (
                                                            <div key={label} style={{ border: '1px solid rgba(255,255,255,0.055)', borderRadius: 6, padding: '6px 7px', background: 'rgba(255,255,255,0.02)' }}>
                                                                <em style={{ display: 'block', color: 'var(--silver)', opacity: 0.58, fontStyle: 'normal', fontSize: '0.52rem', textTransform: 'uppercase' }}>{label}</em>
                                                                <strong style={{ display: 'block', color: label === valueShortLabel ? dhqC : 'var(--white)', fontSize: '0.68rem', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Scouting Report</span>
                                                    <div style={{ display: 'grid', gap: 6 }}>
                                                        {reportBits.map((bit, bi) => (
                                                            <div key={bi} style={{ color: 'var(--white)', opacity: 0.92, fontSize: '0.72rem', lineHeight: 1.45, border: '1px solid rgba(255,255,255,0.055)', borderRadius: 6, padding: '7px 8px', background: 'rgba(255,255,255,0.018)' }}>{bit}</div>
                                                        ))}
                                                    </div>
                                                    {compText && <div style={{ color: 'var(--white)', opacity: 0.82, fontSize: '0.68rem', marginTop: 7 }}>Comp: {compText}</div>}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                                <button type="button" onClick={() => { setScoutDrawerPid(null); openInBigBoard(r.pid); }} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(212,175,55,0.12)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>OPEN IN BIG BOARD</button>
                                                <a href={(isSeasonalDraftCtx ? 'https://www.pro-football-reference.com/search/search.fcgi?search=' : 'https://www.sports-reference.com/cfb/search/search.fcgi?search=') + encodeURIComponent(pName(r.p))} target="_blank" rel="noopener" style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.12)', color: '#3498DB', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>{isSeasonalDraftCtx ? 'PRO STATS' : 'COLLEGE STATS'}</a>
                                                <a href={'https://www.youtube.com/results?search_query=' + encodeURIComponent(pName(r.p) + ' highlights ' + leagueSeason)} target="_blank" rel="noopener" style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.12)', color: '#E74C3C', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>HIGHLIGHTS</a>
                                                <a href={'https://www.fantasypros.com/nfl/players/' + encodeURIComponent(((r.p.first_name || '') + '-' + (r.p.last_name || '')).toLowerCase().replace(/[^a-z-]/g, '')) + '.php'} target="_blank" rel="noopener" style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.15)', color: '#3498DB', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>FANTASYPROS</a>
                                                <button type="button" onClick={() => { setBoardTags(prev => ({ ...prev, [r.pid]: prev[r.pid] === 'target' ? undefined : 'target' })); }} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(46,204,113,0.12)', color: '#2ECC71', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>{boardTags[r.pid] === 'target' ? 'UNTAG TARGET' : 'TAG TARGET'}</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                )}

                {/* ═══════════════════ VIEW 2: BIG BOARD ═══════════════════ */}
                {activeView === 'board' && (() => {
                    // Helpers: parse size like "6'4" → inches, draft sort key (drafted first)
                    const parseSizeIn = s => { const m = String(s||'').match(/(\d+)'?\s*(\d+)?/); return m ? parseInt(m[1])*12 + (parseInt(m[2])||0) : 0; };
                    const hasDraftCapital = (cs = {}) => Number(cs.draftRound) > 0 || Number(cs.draftPick) > 0;
                    const isTrueUdfa = (cs = {}) => !!cs.isUDFA && !hasDraftCapital(cs);
                    const showDraftCapitalColumn = !isSeasonalDraft;
                    const draftSortKey = r => {
                        const cs = r.csv || {};
                        if (hasDraftCapital(cs)) return (Number(cs.draftRound) || 99) * 1000 + (Number(cs.draftPick) || 999);
                        if (isTrueUdfa(cs)) return 9000;
                        return 9999;
                    };
                    const valueRankRows = draftPoolRows
                        .filter(r => Number(r.dhq || 0) > 0)
                        .slice()
                        .sort((a, b) => Number(b.dhq || 0) - Number(a.dhq || 0));
                    const valueRankMap = new Map(valueRankRows.map((r, i) => [String(r.pid), i + 1]));
                    const posRankMaps = {};
                    valueRankRows.forEach(r => {
                        const pos = normPos(r.p?.position) || r.p?.position || 'UNK';
                        if (!posRankMaps[pos]) posRankMaps[pos] = [];
                        posRankMaps[pos].push(String(r.pid));
                    });
                    const valueTierMeta = (dhq, rank, posRank) => {
                        const score = Number(dhq || 0);
                        if (rank && rank <= 12 || score >= 8000) return { label: 'Elite', order: 1, detail: 'round-winning anchor' };
                        if (rank && rank <= 36 || score >= 6000) return { label: 'Core', order: 2, detail: 'weekly starter core' };
                        if (rank && rank <= 84 || score >= 3600) return { label: 'Starter', order: 3, detail: 'lineup starter tier' };
                        if (rank && rank <= 160 || score >= 1600) return { label: 'Depth', order: 4, detail: 'bench and matchup depth' };
                        return { label: 'Stream', order: 5, detail: 'streamer or watch-list tier' };
                    };
                    const generatedScoutingBits = (row, context) => {
                        const player = row.p || {};
                        const name = pName(player);
                        const pos = context.pos || normPos(player.position) || player.position || 'POS';
                        const team = context.team || player.team || 'FA';
                        const age = context.age || player.age || null;
                        const rank = context.valueRank;
                        const posRank = context.posRank;
                        const tier = context.tierMeta || valueTierMeta(row.dhq, rank, posRank);
                        const rankText = rank ? '#' + rank + ' overall' + (posRank ? ', ' + posLabel(pos) + posRank : '') : 'unranked value';
                        const roleByPos = {
                            QB: 'weekly ceiling, rushing/pass-volume profile, and schedule insulation',
                            RB: 'touch share, goal-line path, reception floor, and injury fragility',
                            WR: 'target share, route role, quarterback environment, and spike-week ceiling',
                            TE: 'route participation, red-zone usage, and whether he separates from the replacement tier',
                            K: 'offense quality, indoor/weather exposure, and weekly streamability',
                            DEF: 'pressure rate, turnover chances, schedule pockets, and matchup streamability',
                        };
                        const role = roleByPos[pos] || 'weekly role, team context, and replacement-level gap';
                        const ageText = age ? ' At age ' + age + ', the risk lens is durability and role stability more than long-term development.' : '';
                        const teamText = team && team !== 'FA'
                            ? name + ' is tied to ' + team + ', so the scouting question is ' + role + '.'
                            : name + ' is not carrying a clean team label here, so I would treat the board value as stronger than the environment tag until news clarifies it.';
                        const planText = tier.label === 'Elite'
                            ? 'Draft plan: treat him as an anchor. Do not overthink small fit nits if he falls below his value tier.'
                            : tier.label === 'Core'
                                ? 'Draft plan: take him when roster construction needs a bankable weekly starter and the board is leaving the tier intact.'
                                : tier.label === 'Starter'
                                    ? 'Draft plan: useful if the build needs points now; pass if a cleaner ceiling tier is still available.'
                                    : 'Draft plan: this is a bench/streaming decision. Let ADP, roster need, and schedule break the tie.';
                        return [
                            name + ' grades as a ' + tier.label.toLowerCase() + ' ' + posLabel(pos) + ' in this format (' + rankText + ', ' + fmtDhq(row.dhq) + ' ' + valueShortLabel + ').',
                            teamText + ageText,
                            'Alex read: focus on ' + role + '. Value tier says how far above replacement he is; roster need says whether we should be the one paying that price.',
                            planText,
                        ];
                    };

                    // Apply filters: position, team, round
                    let dhqBoardPlayers = [...draftPoolRows];
                    if (boardPosFilter) dhqBoardPlayers = dhqBoardPlayers.filter(r => normPos(r.p.position) === boardPosFilter);
                    if (boardTeamFilter) dhqBoardPlayers = dhqBoardPlayers.filter(r => (r.csv?.nflTeam || r.p?.team || '') === boardTeamFilter);
                    if (isRookieDraft && boardRoundFilter) dhqBoardPlayers = dhqBoardPlayers.filter(r => {
                        const cs = r.csv || {};
                        if (boardRoundFilter === 'UDFA') return isTrueUdfa(cs);
                        return String(cs.draftRound) === boardRoundFilter;
                    });
                    if (boardSort.key) {
                        dhqBoardPlayers.sort((a, b) => {
                            let va, vb;
                            const k = boardSort.key;
                            if (k === 'dhq') { va = a.dhq; vb = b.dhq; }
                            else if (k === 'name') { va = (a.p.full_name || '').toLowerCase(); vb = (b.p.full_name || '').toLowerCase(); }
                            else if (k === 'pos') { va = normPos(a.p.position) || ''; vb = normPos(b.p.position) || ''; }
                            else if (k === 'age') { va = a.p.age || (a.p.birth_date ? Math.floor((Date.now() - new Date(a.p.birth_date).getTime()) / 31557600000) : 99); vb = b.p.age || (b.p.birth_date ? Math.floor((Date.now() - new Date(b.p.birth_date).getTime()) / 31557600000) : 99); }
                            else if (k === 'school') { va = ((isSeasonalDraft ? (a.csv?.nflTeam || a.p?.team) : (a.csv?.college || a.p.college)) || '').toLowerCase(); vb = ((isSeasonalDraft ? (b.csv?.nflTeam || b.p?.team) : (b.csv?.college || b.p.college)) || '').toLowerCase(); }
                            else if (k === 'team')   { va = (a.csv?.nflTeam || a.p?.team || '').toLowerCase(); vb = (b.csv?.nflTeam || b.p?.team || '').toLowerCase(); }
                            else if (k === 'draft')  { va = draftSortKey(a); vb = draftSortKey(b); }
                            else if (k === 'rank')   { va = a.csv?.consensusRank ?? a.csv?.rank ?? valueRankMap.get(String(a.pid)) ?? 9999; vb = b.csv?.consensusRank ?? b.csv?.rank ?? valueRankMap.get(String(b.pid)) ?? 9999; }
                            else if (k === 'tier')   { va = a.csv?.tier ?? valueTierMeta(a.dhq, valueRankMap.get(String(a.pid))).order; vb = b.csv?.tier ?? valueTierMeta(b.dhq, valueRankMap.get(String(b.pid))).order; }
                            else if (k === 'size')   { va = parseSizeIn(a.csv?.size) || (a.p?.height || 0); vb = parseSizeIn(b.csv?.size) || (b.p?.height || 0); }
                            else if (k === 'weight') { va = parseFloat(a.csv?.weight) || parseFloat(a.p?.weight) || 0; vb = parseFloat(b.csv?.weight) || parseFloat(b.p?.weight) || 0; }
                            else if (k === 'speed')  { va = parseFloat(a.csv?.speed) || 99; vb = parseFloat(b.csv?.speed) || 99; }
                            else { va = 0; vb = 0; }
                            if (typeof va === 'string') return va < vb ? -boardSort.dir : va > vb ? boardSort.dir : 0;
                            return ((va || 0) - (vb || 0)) * boardSort.dir;
                        });
                    }

                    const aiSeedOrder = aiRecommendedOrder.length ? aiRecommendedOrder : draftPoolRows.map(r => r.pid);

                    // Drag handlers
                    const handleDragStart = (pid) => setDragPid(pid);
                    const handleDragOver = (e) => e.preventDefault();
                    const handleDrop = (targetPid) => {
                        if (!dragPid || dragPid === targetPid) return;
                        setMyBoardOrder(prev => {
                            const order = prev.length ? [...prev] : aiSeedOrder.slice();
                            const fromIdx = order.indexOf(dragPid);
                            const toIdx = order.indexOf(targetPid);
                            if (fromIdx === -1 || toIdx === -1) return order;
                            order.splice(fromIdx, 1);
                            order.splice(toIdx, 0, dragPid);
                            return order;
                        });
                        setDragPid(null);
                        if (boardMode !== 'my') setBoardMode('my');
                    };
                    const handleBoardMove = (pid, delta) => {
                        setMyBoardOrder(prev => {
                            const order = prev.length ? [...prev] : aiSeedOrder.slice();
                            const fromIdx = order.indexOf(pid);
                            if (fromIdx === -1) return order;
                            const toIdx = Math.max(0, Math.min(order.length - 1, fromIdx + delta));
                            if (fromIdx === toIdx) return order;
                            const [moved] = order.splice(fromIdx, 1);
                            order.splice(toIdx, 0, moved);
                            return order;
                        });
                        if (boardMode !== 'my') setBoardMode('my');
                    };

                    const buildOrderedPlayers = (order) => {
                        const cleanOrder = Array.isArray(order) && order.length ? order : draftPoolRows.map(r => r.pid);
                        const ordered = cleanOrder.map(pid => draftPoolRows.find(r => r.pid === pid)).filter(Boolean);
                        const inOrder = new Set(cleanOrder);
                        draftPoolRows.forEach(r => { if (!inOrder.has(r.pid)) ordered.push(r); });
                        return ordered;
                    };
                    const applyActiveFilters = (players) => {
                        let out = players.slice();
                        if (boardPosFilter) out = out.filter(r => normPos(r.p.position) === boardPosFilter);
                        if (boardTeamFilter) out = out.filter(r => (r.csv?.nflTeam || r.p?.team || '') === boardTeamFilter);
                        if (isRookieDraft && boardRoundFilter) out = out.filter(r => {
                            const cs = r.csv || {};
                            if (boardRoundFilter === 'UDFA') return isTrueUdfa(cs);
                            return String(cs.draftRound) === boardRoundFilter;
                        });
                        return out;
                    };

                    // User Board starts from the AI recommendation, then becomes manual on first edit.
                    if (myBoardOrder.length === 0 && aiSeedOrder.length) setMyBoardOrder(aiSeedOrder);
                    const aiBoardPlayers = applyActiveFilters(buildOrderedPlayers(aiSeedOrder));
                    const myOrder = myBoardOrder.length ? myBoardOrder : aiSeedOrder;
                    const myBoardPlayers = applyActiveFilters(buildOrderedPlayers(myOrder));

                    // Compact board renderer (used for both sides)
                    const sortArrow = (key) => boardSort.key === key ? (boardSort.dir === -1 ? ' \u25BC' : ' \u25B2') : '';
                    const toggleSort = (key) => setBoardSort(prev => prev.key === key ? { ...prev, dir: prev.dir * -1 } : { key, dir: ['name','school','team','rank','tier','draft','speed','age'].includes(key) ? 1 : -1 });
                    const sortHdr = { cursor: 'pointer', userSelect: 'none' };
                    const renderCompactBoard = (players, isDhq) => {
                        const boardGridCols = isSeasonalDraft
                            ? '58px minmax(220px, 1.25fr) 96px 88px 68px 72px 64px minmax(156px, 0.95fr) 92px'
                            : '58px minmax(205px, 1.15fr) minmax(128px, 0.82fr) 88px 64px 58px 82px 64px 58px minmax(156px, 0.95fr) 92px';
                        const boardHeaderCell = (label, key, extra = {}) => (
                            <div onClick={key ? () => toggleSort(key) : undefined} style={{ ...sortHdr, ...extra }}>
                                {label}{key ? sortArrow(key) : ''}
                            </div>
                        );
                        const chip = (label, color, bg) => (
                            <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 16, padding: '0 5px', borderRadius: 4, background: bg || 'rgba(255,255,255,0.045)', color: color || 'var(--silver)', fontSize: '0.54rem', fontFamily: 'var(--font-body)', fontWeight: 800, whiteSpace: 'nowrap' }}>{label}</span>
                        );
                        const snapshotCell = (value, color, extra = {}) => (
                            <div style={{ padding: '4px 7px', minWidth: 0, ...extra }}>
                                <strong style={{ display: 'block', color: color || 'var(--white)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '-'}</strong>
                            </div>
                        );
                        const detailLabel = { display: 'block', color: 'var(--gold)', fontSize: '0.58rem', fontFamily: 'var(--font-body)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
                        const detailBox = { border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)', borderRadius: 8, padding: '9px 10px', minWidth: 0 };

                        return (
		                        <div style={{ background: 'var(--black)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '8px', maxHeight: 'none', overflowX: 'auto', overflowY: 'clip' }}>
	                          <div style={{ minWidth: '100%' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: boardGridCols, minHeight: '34px', background: 'rgba(212,175,55,0.08)', borderBottom: '2px solid rgba(212,175,55,0.2)', fontSize: '0.66rem', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
                                <div style={{ textAlign: 'center' }}>#</div>
                                {boardHeaderCell('Player', 'name', { padding: '0 8px' })}
                                {boardHeaderCell(isSeasonalDraft ? 'NFL Team' : 'College', isSeasonalDraft ? 'team' : 'school', { padding: '0 8px' })}
                                {boardHeaderCell(valueShortLabel, 'dhq', { padding: '0 8px' })}
                                {boardHeaderCell('Rank', 'rank', { padding: '0 8px' })}
                                {boardHeaderCell('Tier', 'tier', { padding: '0 8px' })}
                                {showDraftCapitalColumn && boardHeaderCell('Draft', 'draft', { padding: '0 8px' })}
                                {showDraftCapitalColumn && boardHeaderCell('Team', 'team', { padding: '0 8px' })}
                                {boardHeaderCell('Age', 'age', { padding: '0 8px' })}
                                {boardHeaderCell('Profile', 'size', { padding: '0 8px' })}
                                <div style={{ textAlign: 'center' }}>{isDhq ? 'Open' : 'Board'}</div>
                            </div>
                            {players.map((r, idx) => {
                                const pos = normPos(r.p.position) || r.p.position;
                                const dhqC = r.dhq >= 7000 ? '#2ECC71' : r.dhq >= 4000 ? '#3498DB' : r.dhq >= 2000 ? 'var(--silver)' : 'rgba(255,255,255,0.3)';
                                const isDrafted = draftedPids.has(r.pid);
                                const tag = boardTags[r.pid];
                                const note = boardNotes[r.pid] || '';
                                const isExp = expandedDraftPid === r.pid;
                                const age = r.p.age || (r.csv?.age ? parseFloat(r.csv.age) : null) || (r.p.birth_date ? Math.floor((Date.now() - new Date(r.p.birth_date).getTime()) / 31557600000) : (r.p.years_exp === 0 ? 21 : null));
                                const college = r.csv?.college || r.p.college || r.p.metadata?.college || '';
                                const cs = r.csv || {};
                                const team = cs.nflTeam || r.p?.team || '';
                                const sizeStr = cs.size || (r.p?.height ? Math.floor(r.p.height/12)+"'"+(r.p.height%12) : '');
                                const wtStr = cs.weight || r.p?.weight || '';
                                const speedStr = cs.speed || '';
                                const draftRound = Number(cs.draftRound) || 0;
                                const draftPick = Number(cs.draftPick) || 0;
                                const draftStr = draftRound
                                    ? 'R' + draftRound + (draftPick ? '.' + String(draftPick).padStart(2,'0') : '')
                                    : draftPick ? '#' + draftPick : isTrueUdfa(cs) ? 'UDFA' : '';
                                const draftCol = draftRound === 1 ? '#2ECC71' : draftRound && draftRound <= 3 ? 'var(--gold)' : isTrueUdfa(cs) ? 'var(--silver)' : 'rgba(255,255,255,0.42)';
                                const valueRank = valueRankMap.get(String(r.pid)) || null;
                                const posRankList = posRankMaps[pos] || [];
                                const posRank = posRankList.indexOf(String(r.pid)) >= 0 ? posRankList.indexOf(String(r.pid)) + 1 : null;
                                const tierMeta = valueTierMeta(r.dhq, valueRank, posRank);
                                const rankStr = (isRookieDraft && (cs.consensusRank || cs.rank)) ? '#' + Math.round(cs.consensusRank || cs.rank) : (valueRank ? '#' + valueRank : '-');
                                const tierStr = (isRookieDraft && cs.tier) ? cs.tier : tierMeta.label;
                                const compText = cs.nflComp || cs.comp || '';
                                const teamFitInsight = team ? (() => {
                                    if (isSeasonalDraft) {
                                        const rankPhrase = valueRank ? '#' + valueRank + ' overall' : 'a scored board player';
                                        if (pos === 'QB') return 'For redraft, I am reading ' + team + ' through weekly ceiling, rushing/volume outs, and matchup insulation. At ' + rankPhrase + ', the question is whether he gives you a points edge over the next QB tier.';
                                        if (pos === 'RB') return 'For redraft, I am reading ' + team + ' through touch security, pass-game work, goal-line access, and injury fragility. At ' + rankPhrase + ', volume certainty matters more than long-term profile.';
                                        if (pos === 'WR') return 'For redraft, I am reading ' + team + ' through target share, quarterback quality, route role, and spike-week ceiling. At ' + rankPhrase + ', the bet is weekly starter leverage, not future asset growth.';
                                        if (pos === 'TE') return 'For redraft, I am reading ' + team + ' through route participation and red-zone access. At ' + rankPhrase + ', he has to separate from replacement-level tight ends quickly.';
                                        if (pos === 'K') return 'For redraft, I am reading ' + team + ' through offense quality and schedule. Kicker value is a timing decision, not a board anchor.';
                                        if (pos === 'DEF') return 'For redraft, I am reading ' + team + ' through pressure rate, turnover chances, and early schedule. D/ST value should stay matchup-aware.';
                                        return 'For redraft, I am reading ' + team + ' through current-season role, weekly replacement gap, and schedule pressure.';
                                    }
                                    const capitalTier = draftRound === 1
                                        ? 'a priority-plan rookie'
                                        : draftRound && draftRound <= 3
                                            ? 'an early-rotation bet'
                                            : draftRound
                                                ? 'a developmental swing'
                                                : isTrueUdfa(cs)
                                                    ? 'a camp-competition flyer'
                                                    : 'a landing-spot bet';
                                    if (pos === 'QB') return 'I read ' + team + ' as a runway question: he stacks up as ' + capitalTier + ', but his ' + valueShortLabel + ' only climbs fast if the depth chart gives him real starts or a clear succession path.';
                                    if (pos === 'RB') return 'On ' + team + ', I am weighing touch path over raw traits. He stacks up as ' + capitalTier + '; the value jumps if pass-game work or goal-line access is actually available.';
                                    if (pos === 'WR') return 'On ' + team + ', I care about target path and role clarity. He stacks up as ' + capitalTier + '; I want to know whether he is beating veterans for snaps or waiting on an injury.';
                                    if (pos === 'TE') return 'On ' + team + ', I am checking patience versus payoff. He stacks up as ' + capitalTier + '; tight ends need route volume before the profile matters for our board.';
                                    if (['DL', 'LB', 'DB', 'ED'].includes(pos)) return 'On ' + team + ', I am mapping role to scoring. He stacks up as ' + capitalTier + '; full-time snaps and stat-friendly alignment matter more than the helmet.';
                                    if (pos === 'K') return 'On ' + team + ', I am treating this as a roster-stability read. He stacks up as ' + capitalTier + ', but I would not let kicker security outrank real roster value.';
                                    return 'On ' + team + ', I am treating this as a role-and-capital check. He stacks up as ' + capitalTier + '; the question is whether the team gives him enough usage to make the ' + valueShortLabel + ' real.';
                                })() : '';
                                const summaryBits = String(cs.summary || '')
                                    .split(/(?<=[.!?])\s+/)
                                    .map(s => s.trim())
                                    .filter(Boolean)
                                    .slice(0, 4);
                                const reportBits = isSeasonalDraft
                                    ? generatedScoutingBits(r, { pos, team, age, valueRank, posRank, tierMeta })
                                    : (summaryBits.length ? summaryBits : generatedScoutingBits(r, { pos, team, age, valueRank, posRank, tierMeta }));
                                const profileStr = [sizeStr, wtStr && wtStr + ' lb', speedStr && speedStr + ' 40'].filter(Boolean).join(' / ') || '-';
                                const photoSrc = r.isCSVOnly && cs.espnId ? `https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/${cs.espnId}.png&w=96&h=70` : `https://sleepercdn.com/content/nfl/players/thumb/${r.pid}.jpg`;
                                const openPlayerDetail = () => setExpandedDraftPid(prev => {
                                    const next = prev === r.pid ? null : r.pid;
                                    if (next) window.OD?.trackDraftPlayerExpanded?.(r.pid, {
                                        platform: 'warroom',
                                        module: 'draft',
                                        leagueId: window.S?.currentLeagueId || null,
                                        metadata: { boardMode, source: 'draft_board' },
                                    });
                                    return next;
                                });
                                return (
                                    <React.Fragment key={r.pid}>
                                    <div
                                        data-draft-pid={r.pid}
                                        draggable={!isDhq}
                                        onDragStart={!isDhq ? () => handleDragStart(r.pid) : undefined}
                                        onDragOver={!isDhq ? handleDragOver : undefined}
                                        onDrop={!isDhq ? () => handleDrop(r.pid) : undefined}
                                        onClick={openPlayerDetail}
                                        style={{ display: 'grid', gridTemplateColumns: boardGridCols, alignItems: 'center', minHeight: '42px', opacity: isDrafted ? 0.35 : 1, borderBottom: isExp ? 'none' : '1px solid rgba(255,255,255,0.035)', cursor: 'pointer', background: isExp ? 'rgba(212,175,55,0.065)' : idx % 2 === 1 ? 'rgba(255,255,255,0.016)' : 'transparent', transition: 'background 0.1s', position: 'relative' }}
                                        onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'rgba(212,175,55,0.04)'; }}
                                        onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = idx % 2 === 1 ? 'rgba(255,255,255,0.016)' : 'transparent'; }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: idx < 3 ? 'var(--gold)' : 'var(--silver)', fontWeight: 800 }}>
                                            <span>{idx + 1}</span>
                                            {!isDhq && (
                                                <span style={{ display: 'inline-grid', gap: 2 }}>
                                                    <button type="button" title="Move up" onClick={e => { e.stopPropagation(); handleBoardMove(r.pid, -1); }} style={{ width: 16, height: 14, lineHeight: 1, border: '1px solid rgba(212,175,55,0.25)', borderRadius: 3, background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.52rem', padding: 0 }}>▲</button>
                                                    <button type="button" title="Move down" onClick={e => { e.stopPropagation(); handleBoardMove(r.pid, 1); }} style={{ width: 16, height: 14, lineHeight: 1, border: '1px solid rgba(212,175,55,0.25)', borderRadius: 3, background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.52rem', padding: 0 }}>▼</button>
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, padding: '5px 7px' }}>
                                            <div style={{ width: 28, height: 28, flexShrink: 0 }}>
                                                <img src={photoSrc} alt="" onError={e => e.target.style.display='none'} style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', objectPosition: 'top', border: '1px solid rgba(212,175,55,0.22)' }} />
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                    <strong style={{ color: 'var(--white)', fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: isDrafted ? 'line-through' : 'none' }}>{pName(r.p)}</strong>
                                                    {chip(pos, posColors[pos] || 'var(--silver)', (posColors[pos] || '#666') + '22')}
                                                </div>
                                            </div>
                                        </div>
                                        {snapshotCell(isSeasonalDraft ? (team || 'FA') : (college || 'School TBD'), isSeasonalDraft && team ? '#2ECC71' : 'var(--silver)')}
                                        {snapshotCell(r.dhq > 0 ? r.dhq.toLocaleString() : '-', dhqC)}
                                        {snapshotCell(rankStr)}
                                        {snapshotCell(tierStr)}
                                        {showDraftCapitalColumn && snapshotCell(draftStr || 'Capital TBD', draftCol)}
                                        {showDraftCapitalColumn && snapshotCell(team || 'TBD', team ? '#2ECC71' : 'var(--silver)')}
                                        {snapshotCell(age || '-')}
                                        {snapshotCell(profileStr, speedStr && parseFloat(speedStr) <= 4.45 ? '#2ECC71' : 'var(--white)')}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 6px' }}>
                                            <button type="button" onClick={e => { e.stopPropagation(); openPlayerDetail(); }}
                                                style={{ fontSize: '0.55rem', padding: '3px 6px', border: '1px solid rgba(212,175,55,0.22)', borderRadius: 5, cursor: 'pointer', background: isExp ? 'rgba(212,175,55,0.14)' : 'rgba(255,255,255,0.035)', color: isExp ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', fontWeight: 800 }}>
                                                {isExp ? 'Hide' : 'Open'}
                                            </button>
                                            {!isDhq && (
                                                <button type="button" onClick={e => { e.stopPropagation(); setDraftedPids(prev => { const n = new Set(prev); if (n.has(r.pid)) n.delete(r.pid); else n.add(r.pid); return n; }); }}
                                                    style={{ fontSize: '0.55rem', padding: '3px 6px', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, cursor: 'pointer', background: isDrafted ? 'rgba(231,76,60,0.15)' : 'rgba(255,255,255,0.035)', color: isDrafted ? '#E74C3C' : 'var(--silver)', fontFamily: 'var(--font-body)', fontWeight: 800 }}>
                                                    {isDrafted ? 'Undo' : 'Off'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {isExp && (
                                        <div style={{ borderBottom: '2px solid rgba(212,175,55,0.25)', background: 'rgba(0,0,0,0.28)', padding: '13px 14px 15px', animation: 'wrFadeIn 0.2s ease' }}>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 0.72fr) minmax(420px, 1.28fr)', gap: 9, marginBottom: 10 }}>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Card Snapshot</span>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 5 }}>
                                                        {[
                                                            [valueShortLabel, r.dhq > 0 ? r.dhq.toLocaleString() : '-'],
                                                            ['Rank', rankStr],
                                                            ['Tier', tierStr],
                                                            ...(showDraftCapitalColumn ? [['Draft', draftStr || 'Capital TBD']] : []),
                                                            ['Team', team || 'TBD'],
                                                            ['Age', age || '-'],
                                                            ['Profile', [sizeStr, wtStr && wtStr + ' lb', speedStr && speedStr + ' 40'].filter(Boolean).join(' / ') || '-'],
                                                        ].map(([label, value]) => (
                                                            <div key={label} style={{ border: '1px solid rgba(255,255,255,0.055)', borderRadius: 6, padding: '6px 7px', background: 'rgba(255,255,255,0.02)' }}>
                                                                <em style={{ display: 'block', color: 'var(--silver)', opacity: 0.58, fontStyle: 'normal', fontSize: '0.52rem', textTransform: 'uppercase' }}>{label}</em>
                                                                <strong style={{ display: 'block', color: label === valueShortLabel ? dhqC : 'var(--white)', fontSize: '0.68rem', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Scouting Report</span>
                                                    <div style={{ display: 'grid', gap: 6 }}>
                                                        {reportBits.map((bit, bi) => (
                                                            <div key={bi} style={{ color: 'var(--silver)', fontSize: '0.72rem', lineHeight: 1.45, border: '1px solid rgba(255,255,255,0.055)', borderRadius: 6, padding: '7px 8px', background: 'rgba(255,255,255,0.018)' }}>{bit}</div>
                                                        ))}
                                                    </div>
                                                    {compText && <div style={{ color: 'var(--white)', opacity: 0.82, fontSize: '0.68rem', marginTop: 7 }}>Comp: {compText}</div>}
                                                    {teamFitInsight && (
                                                        <div style={{ border: '1px solid rgba(46,204,113,0.18)', background: 'rgba(46,204,113,0.045)', borderRadius: 6, padding: '7px 8px', marginTop: 7 }}>
                                                            <span style={{ display: 'block', color: '#2ECC71', fontSize: '0.56rem', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Alex NFL Fit</span>
                                                            <div style={{ color: 'var(--silver)', fontSize: '0.7rem', lineHeight: 1.42 }}>{teamFitInsight}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <InlineCareerStats pid={r.pid} pos={pos} player={r.p} scoringSettings={currentLeague?.scoring_settings} statsData={statsData} />

                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) minmax(260px,0.9fr)', gap: 10, alignItems: 'start', marginTop: 10 }}>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Front Office Notes</span>
                                                    <textarea value={note} onChange={e => setBoardNotes(prev => ({...prev, [r.pid]: e.target.value}))} onClick={e => e.stopPropagation()} placeholder={'Add your scouting notes on ' + pName(r.p) + '...'} style={{ width: '100%', minHeight: 82, padding: '8px 10px', fontSize: '0.76rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, color: 'var(--silver)', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5, outline: 'none' }} />
                                                </div>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Research / Actions</span>
                                                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 9 }}>
                                                        {Object.entries(tagDefs).map(([tKey, tDef]) => (
                                                            <button key={tKey} type="button" onClick={(e) => { e.stopPropagation(); const wasActive = boardTags[r.pid] === tKey; setBoardTags(prev => ({ ...prev, [r.pid]: prev[r.pid] === tKey ? undefined : tKey })); if (!wasActive) { window.wrLogAction?.('TAG', 'Tagged ' + pName(r.p) + ' on draft board', 'draft', { players: [{ name: pName(r.p) }], actionType: 'board-tag' }); } }} style={{ padding: '4px 9px', fontSize: '0.64rem', fontFamily: 'var(--font-body)', fontWeight: 800, borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (tag === tKey ? tDef.color : 'rgba(255,255,255,0.12)'), background: tag === tKey ? tDef.color + '25' : 'rgba(255,255,255,0.03)', color: tag === tKey ? tDef.color : 'var(--silver)' }}>{tDef.label}</button>
                                                        ))}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                                        <a href={(isSeasonalDraft ? 'https://www.pro-football-reference.com/search/search.fcgi?search=' : 'https://www.sports-reference.com/cfb/search/search.fcgi?search=') + encodeURIComponent(pName(r.p))} target="_blank" rel="noopener" title={isSeasonalDraft ? 'Open Pro Football Reference player search in a new tab' : 'Open Sports Reference college stats in a new tab'} onClick={e => e.stopPropagation()} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.12)', color: '#3498DB', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>{isSeasonalDraft ? 'PRO STATS' : 'COLLEGE STATS'}</a>
                                                        <a href={'https://www.youtube.com/results?search_query=' + encodeURIComponent(pName(r.p) + ' highlights ' + leagueSeason)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.12)', color: '#E74C3C', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>HIGHLIGHTS</a>
                                                        <a href={'https://www.fantasypros.com/nfl/players/' + encodeURIComponent(((r.p.first_name || '') + '-' + (r.p.last_name || '')).toLowerCase().replace(/[^a-z-]/g, '')) + '.php'} target="_blank" rel="noopener" title="Open FantasyPros player news and profile in a new tab" aria-label={'Open FantasyPros news for ' + pName(r.p)} onClick={e => e.stopPropagation()} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.15)', color: '#3498DB', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>FANTASYPROS NEWS</a>
                                                        <button type="button" onClick={e => {
                                                            e.stopPropagation();
                                                            const name = pName(r.p);
                                                            const sections = [];
                                                            if (cs.summary) sections.push(cs.summary);
                                                            if (cs.strengths) sections.push('Strengths: ' + cs.strengths);
                                                            if (cs.weaknesses) sections.push('Weaknesses: ' + cs.weaknesses);
                                                            if (cs.nflComp || cs.comp) sections.push('NFL Comp: ' + (cs.nflComp || cs.comp));
                                                            if (cs.notes) sections.push(cs.notes);
                                                            const fullText = sections.join('\n\n') || cs.summary || '';
                                                            window.dispatchEvent(new CustomEvent('wr:scouting-generate', { detail: { pid: r.pid, playerName: name, pos, college, summary: cs.summary || '', fullText } }));
                                                            if (typeof sendReconMessage === 'function') {
                                                                setReconPanelOpen(true);
                                                                const context = isSeasonalDraft ? (posLabel(pos) + ', ' + (team || 'FA') + ', age ' + (age || 'unknown') + ', ' + rankStr + ' board rank, ' + tierStr + ' tier') : (posLabel(pos) + ', ' + college);
                                                                sendReconMessage('Give me a full ' + (isSeasonalDraft ? 'redraft NFL player scouting report' : 'rookie scouting report') + ' on ' + name + ' (' + context + '). Include role, production profile, weekly floor, ceiling, risk, comparable players, and where I should draft him in this league format.');
                                                            }
                                                        }} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'rgba(124,107,248,0.15)', color: '#9b8afb', border: '1px solid rgba(124,107,248,0.3)', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>ASK ALEX</button>
                                                        <button type="button" onClick={e => { e.stopPropagation(); setExpandedDraftPid(null); }} style={{ padding: '7px 10px', fontSize: '0.68rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>COLLAPSE</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    </React.Fragment>
                                );
                            })}
                            {players.length === 0 && <div style={{ padding: '12px', textAlign: 'center', color: 'var(--silver)', opacity: 0.5, fontSize: '0.76rem' }}>No players match filter</div>}
                          </div>
                        </div>
                        );
                    };

                    // Build NFL team list from draft rows that have a team set.
                    const teamSet = new Set();
                    draftPoolRows.forEach(r => { const t = r.csv?.nflTeam || r.p?.team; if (t) teamSet.add(t); });
                    const availableTeams = Array.from(teamSet).sort();
                    const boardModeOptions = [
                        { k: 'dhq', label: 'Default Board', sub: valueShortLabel + ' value rank', detail: 'Canonical value order from the value engine.' },
                        { k: 'ai', label: 'AI Recommended', sub: 'GM strategy fit', detail: 'Re-ranked for your strategy, roster pressure, and league format.' },
                        { k: 'my', label: 'User Board', sub: 'editable front office board', detail: myBoardOrder.length ? 'Manual order with your notes, tags, and draft prep.' : 'Starts from AI Recommended, then becomes yours when edited.' },
                    ];
                    const activeBoardInfo = boardModeOptions.find(opt => opt.k === boardMode) || boardModeOptions[0];
                    const visibleBoardPlayers = boardMode === 'my' ? myBoardPlayers : boardMode === 'ai' ? aiBoardPlayers : dhqBoardPlayers;
                    const manualSignalCount = Object.keys(boardNotes || {}).length + Object.values(boardTags || {}).filter(Boolean).length;

                    return (
                    <div>
                        <section style={{ border: '1px solid rgba(212,175,55,0.18)', borderRadius: 10, background: 'linear-gradient(135deg, rgba(212,175,55,0.08), rgba(255,255,255,0.018))', padding: '14px 15px', marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
                                <div style={{ minWidth: 0 }}>
	                                    <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: '0.66rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{isRookieDraft ? 'Draft Big Board' : 'Redraft Big Board'}</div>
                                    <h3 style={{ margin: 0, color: 'var(--white)', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.22rem', lineHeight: 1.05 }}>{activeBoardInfo.label}</h3>
                                    <p style={{ margin: '4px 0 0', color: 'var(--silver)', opacity: 0.72, fontSize: '0.76rem', lineHeight: 1.45 }}>{activeBoardInfo.detail}</p>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(74px,1fr))', gap: 6, minWidth: 250 }}>
                                    {[
                                        { label: 'Players', value: visibleBoardPlayers.length },
                                        { label: 'Notes/Tags', value: manualSignalCount },
                                        { label: 'AI Seed', value: aiBoardPlayers.length ? 'Ready' : 'Build' },
                                    ].map(item => (
                                        <div key={item.label} style={{ padding: '7px 8px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(0,0,0,0.18)' }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.6, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</span>
                                            <strong style={{ display: 'block', color: 'var(--gold)', fontFamily: 'JetBrains Mono, monospace', fontSize: '0.7rem', marginTop: 2 }}>{item.value}</strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
                                {boardModeOptions.map(opt => (
                                    <button key={opt.k} type="button" onClick={() => setBoardMode(opt.k)} style={{
                                        padding: '9px 11px',
                                        borderRadius: 8,
                                        border: '1px solid ' + (boardMode === opt.k ? 'rgba(212,175,55,0.52)' : 'rgba(255,255,255,0.08)'),
                                        background: boardMode === opt.k ? 'rgba(212,175,55,0.14)' : 'rgba(255,255,255,0.025)',
                                        color: boardMode === opt.k ? 'var(--gold)' : 'var(--silver)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: 'var(--font-body)',
                                    }}>
                                        <strong style={{ display: 'block', color: boardMode === opt.k ? 'var(--gold)' : 'var(--white)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{opt.label}</strong>
                                        <span style={{ display: 'block', opacity: 0.66, fontSize: '0.62rem', marginTop: 2 }}>{opt.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        {/* Position filters */}
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button onClick={() => setBoardPosFilter('')} style={{ padding: '4px 10px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', borderRadius: '14px', cursor: 'pointer', border: '1px solid ' + (!boardPosFilter ? 'rgba(212,175,55,0.3)' : 'rgba(255,255,255,0.08)'), background: !boardPosFilter ? 'rgba(212,175,55,0.12)' : 'transparent', color: !boardPosFilter ? 'var(--gold)' : 'var(--silver)' }}>Master</button>
                            {(typeof getLeaguePositions === 'function' ? getLeaguePositions() : ['QB','RB','WR','TE','K','DEF','DL','LB','DB']).map(pos => (
                                <button key={pos} onClick={() => setBoardPosFilter(boardPosFilter === pos ? '' : pos)} style={{ padding: '4px 10px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', borderRadius: '14px', cursor: 'pointer', border: '1px solid ' + (boardPosFilter === pos ? (posColors[pos] || '#666') + '55' : 'rgba(255,255,255,0.08)'), background: boardPosFilter === pos ? (posColors[pos] || '#666') + '18' : 'transparent', color: boardPosFilter === pos ? posColors[pos] : 'var(--silver)' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</button>
                            ))}
                            <span style={{ marginLeft: 'auto', fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.4 }}>Click row to expand {'\u00B7'} Use arrows or drag to reorder My Board</span>
                        </div>

                        {/* Team & Round filters */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Team</span>
                                <select value={boardTeamFilter} onChange={e => setBoardTeamFilter(e.target.value)} style={{ padding: '3px 6px', fontSize: '0.7rem', fontFamily: 'JetBrains Mono, monospace', background: 'rgba(255,255,255,0.04)', color: boardTeamFilter ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (boardTeamFilter ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.1)'), borderRadius: '6px', cursor: 'pointer', outline: 'none' }}>
                                    <option value="">All teams</option>
                                    {availableTeams.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
	                            {isRookieDraft && (
	                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
	                                <span style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '2px' }}>Round</span>
	                                {[
	                                    { k: '', label: 'All' },
	                                    { k: '1', label: 'R1' },
	                                    { k: '2', label: 'R2' },
	                                    { k: '3', label: 'R3' },
	                                    { k: '4', label: 'R4' },
	                                    { k: '5', label: 'R5' },
	                                    { k: '6', label: 'R6' },
	                                    { k: '7', label: 'R7' },
	                                    { k: 'UDFA', label: 'UDFA' },
	                                ].map(opt => (
	                                    <button key={opt.k} onClick={() => setBoardRoundFilter(boardRoundFilter === opt.k ? '' : opt.k)} style={{ padding: '3px 8px', fontSize: '0.66rem', fontFamily: 'var(--font-body)', borderRadius: '10px', cursor: 'pointer', border: '1px solid ' + (boardRoundFilter === opt.k ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'), background: boardRoundFilter === opt.k ? 'rgba(212,175,55,0.14)' : 'transparent', color: boardRoundFilter === opt.k ? 'var(--gold)' : 'var(--silver)' }}>{opt.label}</button>
	                                ))}
	                            </div>
	                            )}
                            {(boardTeamFilter || boardRoundFilter) && (
                                <button onClick={() => { setBoardTeamFilter(''); setBoardRoundFilter(''); }} style={{ marginLeft: 'auto', padding: '3px 10px', fontSize: '0.64rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', cursor: 'pointer' }}>Clear</button>
                            )}
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8, color: 'var(--silver)', opacity: 0.65, fontSize: '0.68rem' }}>
                                <span>{activeBoardInfo.label} - {visibleBoardPlayers.length} visible players</span>
                                <span>{boardMode === 'my' ? 'Drag rows to reorder - click a player for notes' : 'Switch to User Board to edit rank order'}</span>
                            </div>
                            {renderCompactBoard(visibleBoardPlayers, boardMode !== 'my')}
                        </div>

                    </div>
                    );
                })()}

                {/* ═══════════════════ VIEW 3: MOCK DRAFT CENTER ═══════════════════ */}
                {activeView === 'mock' && (() => {
                    const DraftCC = window.DraftCommandCenter;
                    if (typeof DraftCC === 'function') {
                        return (
                            <DraftCC
                                playersData={playersData}
                                myRoster={myRoster}
                                currentLeague={currentLeague}
                                draftRounds={draftRounds}
                            />
                        );
                    }
                    return (
                        <div style={{ padding: '20px', color: '#E74C3C', textAlign: 'center', fontSize: '0.9rem' }}>
                            Mock Draft Center failed to load. Check console for errors.
                        </div>
                    );
                })()}

                {/* ═══════════════════ VIEW 4: FOLLOW LIVE DRAFT ═══════════════════ */}
                {activeView === 'live' && (() => {
                    const DraftCC = window.DraftCommandCenter;
                    if (typeof DraftCC === 'function') {
                        return (
                            <DraftCC
                                playersData={playersData}
                                myRoster={myRoster}
                                currentLeague={currentLeague}
                                draftRounds={draftRounds}
                                forcedMode="live-sync"
                                autoStartLiveToken={liveAutoStartToken}
                            />
                        );
                    }
                    return (
                        <div style={{ padding: '20px', color: '#E74C3C', textAlign: 'center', fontSize: '0.9rem' }}>
                            Live Draft Follower failed to load. Check console for errors.
                        </div>
                    );
                })()}

            </div>
        );
    }

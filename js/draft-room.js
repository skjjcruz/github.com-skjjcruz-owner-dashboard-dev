// ══════════════════════════════════════════════════════════════════
// draft-room.js — DraftTab component (Flash Brief, Big Board)
// ══════════════════════════════════════════════════════════════════
    const DRAFT_WR_KEYS  = window.App.WR_KEYS;
    const DraftStorage = window.App.WrStorage;
    // Seeded phrase variation so two notes from the same template branch never
    // read identically. Seed off something stable (pid + position) and a row
    // keeps its wording across re-renders while its neighbours differ.
    const avPick = (seed, arr) => (window.AlexVoice ? window.AlexVoice.pick(seed, arr) : arr[0]);
    // Rotated pick — spreads variants across rows by index so same-tier
    // neighbours don't open with the same sentence on a hash collision.
    const avPickRot = (seed, arr, off) => (window.AlexVoice ? window.AlexVoice.pickRot(seed, arr, off) : arr[(off | 0) % arr.length]);
    // Content signature of a Big Board snapshot (manual order, AI order, tags,
    // notes, drafted, active lane). Used to tell a real cross-view edit apart from a
    // view's own echo so the Draft tab and live draft room can share one store
    // without clobbering each other or looping, while still persisting every field
    // the auto-save used to write.
    const boardSyncSig = (b) => {
        if (!b) return '';
        try {
            return JSON.stringify({
                my: b.myOrder || [],
                ai: b.aiOrder || [],
                tags: b.tags || {},
                notes: b.notes || {},
                drafted: (b.drafted || []).slice().sort(),
                lane: b.activeLane || b.boardMode || 'dhq',
            });
        } catch (e) { return ''; }
    };
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
        // Last board signature this view has persisted or absorbed. When a write
        // arrives from the live draft room (shared store) we stamp the incoming
        // signature here first, so the auto-save effect that fires as we hydrate
        // recognises the data as already-current and skips re-writing it — no echo,
        // no stale-order clobber.
        const boardSyncSigRef = useRef('');
        const [draftedPids, setDraftedPids] = useState(new Set());
        // Players already taken in the live draft. Seeded from the persisted
        // live-sync state so a freshly opened Draft tab strikes them through
        // immediately, then kept live by the wr:live-draft-picks broadcast the
        // command center emits on every pick. Held apart from the manual "Off"
        // marks in draftedPids so neither overwrites the other.
        const [liveDraftedPids, setLiveDraftedPids] = useState(() => {
            try {
                const lid = window.S?.currentLeagueId || leagueKey;
                const d = window.DraftCC?.state?.loadFromLocal?.(lid, 'live-sync')?.draftedPids;
                return d ? new Set(Object.keys(d)) : new Set();
            } catch (e) { return new Set(); }
        });
        const [boardNotes, setBoardNotes] = useState({});
        const [boardTags, setBoardTags] = useState({}); // pid -> 'target'|'avoid'|'sleeper'|'must'
        const [boardMode, setBoardMode] = useState('dhq'); // 'dhq' | 'ai' | 'my'
        const [myBoardOrder, setMyBoardOrder] = useState([]); // custom ordered pid array
        const [boardPosFilter, setBoardPosFilter] = useState(''); // '' | 'QB' | 'RB' | 'WR' | 'TE' | 'DL' | 'LB' | 'DB'
        const [boardSearch, setBoardSearch] = useState(''); // player/team/college lookup
        const [boardTeamFilter, setBoardTeamFilter] = useState(''); // '' | NFL team abbr
        const [boardRoundFilter, setBoardRoundFilter] = useState(''); // '' | '1'..'7' | 'UDFA'
        const [boardSort, setBoardSort] = useState({ key: 'dhq', dir: -1 }); // sortable columns
        const [expandedDraftPid, setExpandedDraftPid] = useState(null);
        const [scoutDrawerPid, setScoutDrawerPid] = useState(null);
        const [nflFitAI, setNflFitAI] = useState({}); // pid -> live web-search "Alex NFL Fit" read (premium)
        const [dragPid, setDragPid] = useState(null); // currently dragging pid
        const [draftStrategyEditing, setDraftStrategyEditing] = useState(false);
        const draftStrategyKey = 'wr_draft_strategy_' + leagueKey;
        const [customDraftStrategy, setCustomDraftStrategy] = useState(() => {
            try { return localStorage.getItem(draftStrategyKey) || ''; } catch(e) { return ''; }
        });
        const [pickFocus, setPickFocus] = useState(() => window._wrDraftPickFocus || null);
        // AI-upgraded roster-target notes, keyed by position. Empty until/unless
        // a real AI call resolves; the seeded template always renders underneath.
        const [aiRosterNotes, setAiRosterNotes] = useState({});
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

        // On-demand "Alex NFL Fit" live read: when a board row is expanded, fetch a
        // premium web-search-enriched fit blurb. fetchNFLFitNews dedupes/caches and
        // returns null on the free tier, so the deterministic narrative stays the
        // baseline. Only fires for the currently-expanded player to limit LLM cost.
        useEffect(() => {
            const pid = expandedDraftPid;
            if (!pid || typeof window.App?.fetchNFLFitNews !== 'function') return;
            const row = (draftPoolRows || []).find(x => String(x.pid) === String(pid));
            if (!row) return;
            const cs = row.csv || {};
            let cancelled = false;
            window.App.fetchNFLFitNews(pid, {
                player: row.p, dhq: row.dhq, isRookie: isRookieDraft,
                capital: { round: Number(cs.draftRound) || 0, pick: Number(cs.draftPick) || 0, nflTeam: cs.nflTeam || row.p?.team || '', isUDFA: !!cs.isUDFA },
            }).then(text => { if (!cancelled && text) setNflFitAI(prev => (prev[pid] === text ? prev : { ...prev, [pid]: text })); })
              .catch(() => {});
            return () => { cancelled = true; };
        }, [expandedDraftPid]);

        // Jump straight into Follow Live Draft when the league header "Draft Live"
        // chip is clicked. The chip lives in league-detail, so it sets a flag +
        // fires this event; the mount-time flag check covers the case where the
        // Draft tab (and this module) wasn't mounted yet when the chip was clicked.
        useEffect(() => {
            const openLive = () => {
                window._wrOpenLiveDraft = false;
                setLiveAutoStartToken(Date.now());
                setDraftView('live');
            };
            window.addEventListener('wr:open-live-draft', openLive);
            if (window._wrOpenLiveDraft) openLive();
            return () => window.removeEventListener('wr:open-live-draft', openLive);
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
                            // Use the canonical 0–10000 dynasty value so CSV-only
                            // prospects sit on the same axis as Sleeper-matched rookies.
                            // draftScore is a 0–~15 scale and would sort these to the
                            // bottom as if worthless. Fall back to draftScore only if no
                            // canonical value exists.
                            dhq: Math.min(10000, Math.max(0, csv.dynastyValue || csv.baseDynastyValue || csv.draftCapitalValue || csv.draftScore || 0)),
                            csv,
                            isCSVOnly: true,
                        });
                    });
                }
            }

            // Consolidate any duplicate identities (e.g. a Sleeper-matched rookie and
            // a CSV-only synthetic that slipped past the name dedup above). Keep one
            // row per normalized name, preferring the real Sleeper entry, then the
            // higher dynasty value.
            const byName = new Map();
            [...sleeperRookies, ...csvOnly].forEach(row => {
                const key = normName(row.p.full_name || ((row.p.first_name || '') + ' ' + (row.p.last_name || '')).trim());
                if (!key) { byName.set(Symbol(), row); return; }
                const existing = byName.get(key);
                if (!existing) { byName.set(key, row); return; }
                const better = (!row.isCSVOnly && existing.isCSVOnly) ? row
                    : (row.isCSVOnly && !existing.isCSVOnly) ? existing
                    : (row.dhq || 0) >= (existing.dhq || 0) ? row : existing;
                byName.set(key, better);
            });
            return Array.from(byName.values()).sort((a, b) => {
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
            const payload = {
                tags: boardTags,
                notes: boardNotes,
                drafted: Array.from(draftedPids),
                aiOrder: aiRecommendedOrder,
                myOrder: myBoardOrder,
                activeLane: boardMode,
            };
            // Skip the write when nothing the user owns actually changed since the
            // last value we persisted or absorbed from the live draft room. This is
            // what stops a hydration from the shared store echoing straight back out
            // (and overwriting a fresher live edit with our now-stale in-memory copy).
            const sig = boardSyncSig(payload);
            if (sig === boardSyncSigRef.current) return;
            boardSyncSigRef.current = sig;
            DraftStorage.set(boardStorageKey,
                {
                    ...payload,
                    lineage: {
                        source: 'wr_bigboard',
                        seededFrom: myBoardOrder.length ? null : 'ai',
                        aiGeneratedAt: new Date().toISOString(),
                        userLastEditedAt: new Date().toISOString(),
                    },
                    updatedAt: new Date().toISOString(),
                });
        }, [boardTags, boardNotes, draftedPids, aiRecommendedOrder, myBoardOrder, boardMode, boardStorageKey]);

        // Re-hydrate from the shared Big Board store when the live draft room (or
        // another tab) edits the same league's board. Without this, the Draft tab's
        // Big Board only reads on mount and silently drifts from the live draft's
        // User Board even though both persist to the same key. We stamp the incoming
        // signature first so the auto-save above treats the hydration as current.
        useEffect(() => {
            const legacyKey = DRAFT_WR_KEYS.BIGBOARD(leagueKey);
            const absorb = (value) => {
                if (!value) return;
                boardSyncSigRef.current = boardSyncSig(value);
                setBoardData(value);
            };
            const onBoardWrite = (e) => {
                const d = e?.detail;
                if (!d || (d.key !== boardStorageKey && d.key !== legacyKey)) return;
                if (boardSyncSig(d.value) === boardSyncSigRef.current) return; // our own echo
                absorb(d.value);
            };
            // Cross-tab fallback (the native CustomEvent only fires in-document):
            const onStorage = (e) => {
                if (!e || (e.key !== boardStorageKey && e.key !== legacyKey) || e.newValue == null) return;
                let value = null;
                try { value = JSON.parse(e.newValue); } catch (err) { return; }
                if (boardSyncSig(value) === boardSyncSigRef.current) return;
                absorb(value);
            };
            window.addEventListener('wr:bigboard-write', onBoardWrite);
            window.addEventListener('storage', onStorage);
            return () => {
                window.removeEventListener('wr:bigboard-write', onBoardWrite);
                window.removeEventListener('storage', onStorage);
            };
        }, [boardStorageKey, leagueKey]);

        // Keep the User Board's strike-throughs in step with the live draft: each
        // pick the command center makes arrives here as a wr:live-draft-picks event
        // carrying the full taken-player set, which re-renders the board instantly.
        useEffect(() => {
            const onLivePicks = (e) => {
                const d = e?.detail;
                if (!d) return;
                const lid = window.S?.currentLeagueId || leagueKey;
                if (d.leagueId && lid && String(d.leagueId) !== String(lid)) return;
                setLiveDraftedPids(new Set(d.drafted || []));
            };
            window.addEventListener('wr:live-draft-picks', onLivePicks);
            return () => window.removeEventListener('wr:live-draft-picks', onLivePicks);
        }, [leagueKey]);

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
            const seed = 'arn:' + p + ':' + (targetName || '');
            if (priorityScore >= 300) {
                if (p === 'QB') return avPick(seed, [
                    'QB is the spot that decides our weeks. If ' + target + dhqText + ' gets to ' + pickText + ', I\'m taking the ceiling over some luxury pick every time.',
                    'We need to solve QB, plain and simple. ' + target + dhqText + ' at ' + pickText + ' fixes the weekly floor — I don\'t want to chase a shinier name and leave the hole open.',
                ]);
                if (p === 'TE') return avPick(seed, [
                    'TE is the fastest way to change our roster shape. If ' + target + dhqText + ' falls to ' + pickText + ', I want him before the cliff gets ugly.',
                    'I\'d attack TE here — ' + target + dhqText + ' at ' + pickText + ' is the kind of swing that separates us once the position dries up.',
                ]);
                if (['DL', 'LB', 'DB'].includes(p)) return avPick(seed, [
                    p + ' is a real IDP pressure spot, not a vanity grab. Get ' + target + dhqText + ' now and we don\'t pay future capital once the room wakes up to the tier.',
                    'Don\'t sleep on ' + p + '. ' + target + dhqText + ' keeps us from overpaying later when everyone realizes the IDP tier is gone.',
                ]);
                return avPick(seed, [
                    p + ' is a real pressure point for us. If ' + target + dhqText + ' reaches ' + pickText + ', I want to close that gap while the ' + valueShortLabel + ' value still lines up.',
                    'We can\'t keep ignoring ' + p + '. ' + target + dhqText + ' at ' + pickText + ' is the clean fix while the value\'s still there.',
                ]);
            }
            if (priorityScore >= 200) {
                if (p === 'RB') return avPick(seed, [
                    'RB is a depth-and-age question for us. I won\'t force it, but ' + target + dhqText + ' is the tie-breaker if the board flattens.',
                    'I\'m not reaching for RB, but keep ' + target + dhqText + ' in mind — a younger swing against our age curve is worth it if value cooperates.',
                ]);
                if (p === 'WR') return avPick(seed, [
                    'WR is more of a squeeze than an emergency. Keep ' + target + dhqText + ' live, but only jump if the tier still holds value at ' + pickText + '.',
                    'No panic at WR — ' + target + dhqText + ' is worth a look at ' + pickText + ' if the value\'s real, otherwise let it ride.',
                ]);
                return avPick(seed, [
                    p + ' is an active lane, not a panic spot. ' + target + dhqText + ' matters if the board hands us the value, but I\'d still let ' + valueShortLabel + ' settle the tie.',
                    'I\'ve got ' + p + ' on the radar. ' + target + dhqText + ' is in play, just don\'t let it pull us off a cleaner ' + valueShortLabel + ' value.',
                ]);
            }
            return avPick(seed, [
                p + ' stays on the watch list. ' + target + dhqText + ' is useful if the room lets value fall, but it shouldn\'t pull us off a better tier.',
                'I\'d keep ' + p + ' in the back pocket — ' + target + dhqText + ' only if he slides, never at the cost of a stronger pick.',
            ]);
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
            const seed = 'scout:' + pos + ':' + (row.pid || name);
            const ageText = age ? ' ' + avPick(seed + ':age', [
                'At ' + age + ', I\'m watching durability and role stability more than upside.',
                'He\'s ' + age + ', so this is about staying healthy and holding the role, not projection.',
                'Age ' + age + ' means the question is consistency, not ceiling.',
            ]) : '';
            const teamText = team && team !== 'FA'
                ? avPick(seed + ':team', [
                    name + ' lands in ' + team + ', so the real question is ' + role + '.',
                    'Tied to ' + team + ', what I care about with ' + name + ' is ' + role + '.',
                    'With ' + name + ' in ' + team + ', it comes down to ' + role + '.',
                  ])
                : avPick(seed + ':noteam', [
                    name + ' doesn\'t have a clean landing spot yet, so I\'d trust the board value over the situation until news clears it up.',
                    'No firm team for ' + name + ' right now — I\'d lean on the value tier and wait for the role to clarify.',
                  ]);
            const planText = tier.label === 'Elite'
                ? avPick(seed + ':plan', [
                    'Plan: treat him as an anchor. Don\'t overthink small fit nits if he ever slips below tier.',
                    'Plan: this is a cornerstone — take him and don\'t let little concerns talk you out of it.',
                  ])
                : tier.label === 'Core'
                    ? avPick(seed + ':plan', [
                        'Plan: grab him when we need a bankable weekly starter and the tier\'s still intact.',
                        'Plan: he\'s a starter you can count on — pull the trigger when the board leaves the tier sitting.',
                      ])
                    : tier.label === 'Starter'
                        ? avPick(seed + ':plan', [
                            'Plan: fine if we need points now; pass if a cleaner ceiling tier is still on the board.',
                            'Plan: useful for the build, but don\'t reach past a higher-upside name to get him.',
                          ])
                        : avPick(seed + ':plan', [
                            'Plan: this is a bench/streaming call — let ADP, need, and schedule break the tie.',
                            'Plan: depth dart. Take him late if the matchup math or roster need says so.',
                          ]);
            const gradeText = avPick(seed + ':grade', [
                name + ' grades out as a ' + tier.label.toLowerCase() + ' ' + posLabel(pos) + ' in this format (' + rankText + ', ' + fmtDhq(row.dhq) + ' ' + valueShortLabel + ').',
                'I\'ve got ' + name + ' as a ' + tier.label.toLowerCase() + ' ' + posLabel(pos) + ' for us — ' + rankText + ', ' + fmtDhq(row.dhq) + ' ' + valueShortLabel + '.',
            ]);
            const readText = avPick(seed + ':read', [
                'My read: it\'s about ' + role + '. The value tier tells you how far above replacement he is; the need tells you whether we should be the one paying for it.',
                'Bottom line — focus on ' + role + '. Value says how good, need says whether it\'s our problem to solve.',
            ]);
            return [
                gradeText,
                teamText + ageText,
                readText,
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
                const posName = posLabel(row.pos);
                const seed = 'cd:' + row.pos + ':' + (row.topPid || topName);
                const sentences = [];
                if (row.count >= 14) {
                    sentences.push(avPick(seed + ':deep', [
                        'This is a deep ' + posName + ' class — ' + row.count + ' in the top 60 once you adjust for ' + formatLabel + '.',
                        row.count + ' ' + posName + 's crack the top 60 in ' + formatLabel + ', so there\'s real meat on the bone here.',
                        'No shortage of ' + posName + 's this year: ' + row.count + ' of them grade top-60 for our format.',
                    ]));
                    if (topName) sentences.push(avPick(seed + ':deeptop', [
                        topName + pedigree + ' is the headliner' + (cliffName && cliffName !== topName ? ', and the depth runs all the way to ' + cliffName + (cliffDhq ? ' (' + cliffDhq + ')' : '') : '') + '.',
                        topName + pedigree + ' leads it off' + (cliffName && cliffName !== topName ? '; you can still find a body as late as ' + cliffName + (cliffDhq ? ' (' + cliffDhq + ')' : '') : '') + '.',
                    ]));
                    sentences.push(avPick(seed + ':deepplan', [
                        'I\'d let the room burn early capital here and pick off the value pocket before the tier dries up.',
                        'No reason to rush — sit back, let others overpay, then strike when the value lands in our lap.',
                        'Patience pays at ' + posName + '. Let it come to us instead of reaching.',
                    ]));
                } else if (row.count <= 6) {
                    sentences.push(avPick(seed + ':thin', [
                        posName + ' is bone-dry this class — only ' + row.count + ' top-60 name' + (row.count === 1 ? '' : 's') + ' in ' + formatLabel + (starterCount ? ', and we start ' + starterCount + ' of them.' : '.'),
                        'There\'s barely a ' + posName + ' tier here: ' + row.count + ' top-60 prospect' + (row.count === 1 ? '' : 's') + ' under ' + formatLabel + (starterCount ? ' against ' + starterCount + ' starting slot' + (starterCount === 1 ? '' : 's') + '.' : '.'),
                        'Thin at ' + posName + ' — ' + row.count + ' top-60 option' + (row.count === 1 ? '' : 's') + ' for ' + formatLabel + (starterCount ? ', and the lineup demands ' + starterCount + '.' : '.'),
                    ]));
                    if (topName) sentences.push(avPick(seed + ':thintop', [
                        topName + pedigree + ' is basically the tier — don\'t assume anyone falls.',
                        topName + pedigree + ' is the name, and I wouldn\'t bet on him sliding.',
                    ]));
                    sentences.push(avPick(seed + ':thinplan', [
                        'If ' + posName + ' matters to our build, we take the tier early instead of praying for value.',
                        'This is a "go get it" spot — wait on ' + posName + ' and we get left out.',
                        'When it\'s this shallow, you move first and ask questions later.',
                    ]));
                } else {
                    sentences.push(avPick(seed + ':mid', [
                        posName + ' is workable but not deep — ' + row.count + ' top-60 names in ' + formatLabel + '.',
                        'Middle-of-the-road ' + posName + ' class: ' + row.count + ' top-60 prospects for our format.',
                        row.count + ' ' + posName + 's grade top-60 in ' + formatLabel + ' — enough to work with, not enough to sleep on.',
                    ]));
                    if (topName) sentences.push(avPick(seed + ':midtop', [
                        topName + pedigree + ' headlines it' + (cliffName && cliffName !== topName ? ', and ' + cliffName + ' marks where the next tier breaks' + (cliffDhq ? ' (' + cliffDhq + ')' : '') : '') + '.',
                        topName + pedigree + ' is the top of the board' + (cliffName && cliffName !== topName ? '; watch for the drop-off around ' + cliffName + (cliffDhq ? ' (' + cliffDhq + ')' : '') : '') + '.',
                    ]));
                    sentences.push(avPick(seed + ':midplan', [
                        'Keep an eye on the cliff and let ' + valueShortLabel + ' tell us whether to pounce or wait.',
                        'Track where it falls off, then let the board value make the call.',
                        'I\'d watch the tier break and stay flexible.',
                    ]));
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
            const buildRosterNote = (target, pos, priorityScore, rowIdx) => {
                if (!target) {
                    return 'No clean ' + pos + ' target survives our pick — let the board come to us and reassess.';
                }
                const name = pName(target.p);
                const firstName = target.p?.first_name || name.split(' ')[0];
                const nflTeam = target.csv?.nflTeam || target.p?.team || '';
                const dRound = Number(target.csv?.draftRound) || 0;
                const isUDFA = !!target.csv?.isUDFA && !dRound;
                const ageRaw = Number(target.p?.age) || (target.csv?.age ? parseFloat(target.csv.age) : 0);
                const age = ageRaw > 0 && ageRaw < 35 ? Math.round(ageRaw) : 0;
                const dhqText = target.dhq > 0 ? fmtDhq(target.dhq) + ' ' + valueShortLabel : '';
                const slot = nextPickLabel || 'our next pick';

                let pickShort = '';
                if (dRound === 1) pickShort = 'R1';
                else if (dRound === 2) pickShort = 'R2';
                else if (dRound === 3) pickShort = 'R3';
                else if (dRound >= 4) pickShort = 'Day 3';
                else if (isUDFA) pickShort = 'UDFA';

                const pedigreeBits = [pickShort, nflTeam].filter(Boolean);
                const pedigree = pedigreeBits.length ? ' (' + pedigreeBits.join(', ') + ')' : '';

                const posGone = projectedPicks
                    .filter(p => Number(p.overall) < (nextPickOverall || Infinity)
                        && (normPos(p.pos) || p.pos) === pos)
                    .sort((a, b) => Number(b.overall) - Number(a.overall));
                const lastGone = posGone[0];
                const lastGoneSlot = lastGone
                    ? lastGone.round + '.' + String(lastGone.slot).padStart(2, '0')
                    : '';

                const seed = 'rn:' + pos + ':' + (target.pid || name);
                const ri = rowIdx | 0;
                const val = dhqText ? dhqText + ' of value' : '';
                const sentences = [];
                if (priorityScore >= 300) {
                    sentences.push(avPickRot(seed + ':crit', [
                        pos + ' is where this roster actually hurts, and ' + name + pedigree + ' is the cleanest patch on the board at ' + slot + (dhqText ? ' — ' + val : '') + '.',
                        'We can\'t keep punting ' + pos + '. ' + name + pedigree + ' is the one I\'d lock in at ' + slot + (dhqText ? ', and ' + dhqText + ' is honest money there' : '') + '.',
                        name + pedigree + ' is my answer at ' + pos + ' — it\'s a real pressure point for us and he\'s sitting right there at ' + slot + (dhqText ? ' for ' + dhqText : '') + '.',
                        'If I\'m honest, ' + pos + ' is the hole that costs us weeks. ' + name + pedigree + ' fixes it at ' + slot + (dhqText ? ' (' + dhqText + ')' : '') + '.',
                    ], ri));
                } else if (priorityScore >= 200) {
                    sentences.push(avPickRot(seed + ':high', [
                        pos + ' isn\'t an emergency yet, but it\'s thinning out. ' + name + pedigree + ' keeps us honest there' + (dhqText ? ' at ' + dhqText : '') + '.',
                        'I like ' + name + pedigree + ' as our ' + pos + ' play — no need to panic, just don\'t let the tier walk past you' + (dhqText ? ' (' + dhqText + ')' : '') + '.',
                        'We could use another ' + pos + ', and ' + name + pedigree + ' is the name I\'d circle' + (dhqText ? ' — ' + dhqText : '') + '.',
                        name + pedigree + ' shores up ' + pos + ' without making us reach' + (dhqText ? '; ' + dhqText + ' is fair here' : '') + '.',
                    ], ri));
                } else {
                    sentences.push(avPickRot(seed + ':watch', [
                        pos + ' stays on the back burner — ' + name + pedigree + ' is who I\'d watch if the value falls to us' + (dhqText ? ' (' + dhqText + ')' : '') + '.',
                        'No rush at ' + pos + ', but keep ' + name + pedigree + ' in your back pocket' + (dhqText ? ' at ' + dhqText : '') + '.',
                        'I\'m not chasing ' + pos + ' here. ' + name + pedigree + ' only matters if he slides' + (dhqText ? ', and ' + dhqText + ' would make it easy' : '') + '.',
                    ], ri));
                }

                if (lastGone && posGone.length >= 2) {
                    sentences.push(avPick(seed + ':run', [
                        'Heads up — ' + posGone.length + ' ' + pos + 's are projected gone by then (' + lastGone.name + ' at ' + lastGoneSlot + '), so this tier can dry up fast.',
                        'The room is hammering ' + pos + ': ' + posGone.length + ' off the board before us, ' + lastGone.name + ' the last at ' + lastGoneSlot + '. Don\'t wait too long.',
                        posGone.length + ' ' + pos + 's come off ahead of us (' + lastGone.name + ' around ' + lastGoneSlot + ') — if you want this tier, you move early.',
                    ]));
                } else if (lastGone) {
                    sentences.push(avPick(seed + ':one', [
                        lastGone.name + ' is the one projected to go just ahead of us at ' + lastGoneSlot + '; ' + firstName + ' is the next man up.',
                        'Once ' + lastGone.name + ' goes around ' + lastGoneSlot + ', ' + firstName + ' is sitting right behind him.',
                    ]));
                }

                if (age && age <= 21) {
                    sentences.push(avPick(seed + ':age', [
                        'And he\'s only ' + age + ' — the whole runway is still in front of him.',
                        'At ' + age + ', you\'re buying the front of the age curve, not the back.',
                        firstName + '\'s ' + age + ', so the dynasty math works for us for years.',
                    ]));
                }

                return sentences.join(' ');
            };

            // Structured facts for a target — same inputs the template uses, but
            // exposed so the AI upgrade can advocate with real data instead of
            // re-evaluating the pick from a bare name + value.
            const targetFacts = (target, pos) => {
                if (!target) return null;
                const college = target.csv?.college || target.p?.college || target.p?.metadata?.college || '';
                const nflTeam = target.csv?.nflTeam || target.p?.team || '';
                const dRound = Number(target.csv?.draftRound) || 0;
                const isUDFA = !!target.csv?.isUDFA && !dRound;
                const ageRaw = Number(target.p?.age) || (target.csv?.age ? parseFloat(target.csv.age) : 0);
                const age = ageRaw > 0 && ageRaw < 35 ? Math.round(ageRaw) : null;
                let capital = '';
                if (dRound === 1) capital = 'NFL Round 1 capital';
                else if (dRound === 2) capital = 'NFL Round 2 capital';
                else if (dRound === 3) capital = 'NFL Round 3 capital';
                else if (dRound >= 4) capital = 'NFL Day 3 (R' + dRound + ') capital';
                else if (isUDFA) capital = 'UDFA';
                const posGone = (draftPredictionReport?.picks || [])
                    .filter(p => Number(p.overall) < (nextPickOverall || Infinity) && (normPos(p.pos) || p.pos) === pos)
                    .sort((a, b) => Number(b.overall) - Number(a.overall));
                const lastGone = posGone[0];
                return {
                    capital: capital || null,
                    college: college || null,
                    team: nflTeam || null,
                    age,
                    goneBeforePick: posGone.length,
                    lastGoneName: lastGone?.name || null,
                    lastGoneSlot: lastGone ? lastGone.round + '.' + String(lastGone.slot).padStart(2, '0') : null,
                };
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
                    const alexBlurb = buildRosterNote(target, pos, priorityScore, idx);
                    return {
                        ...item,
                        pos,
                        urgency,
                        score,
                        priorityLabel: priorityScore >= 300 ? 'Critical priority' : priorityScore >= 200 ? 'High priority' : 'Watch priority',
                        targetName,
                        targetPid: target?.pid || '',
                        targetDhq: target?.dhq || 0,
                        targetFacts: targetFacts(target, pos),
                        alexBlurb,
                    };
                })
                .filter(n => n.pos && !['K', 'P'].includes(n.pos))
                .sort((a, b) => b.score - a.score)
                .slice(0, 6);
        }, [rosterState.isUsable, assess, scoredAvailable, draftPredictionReport, nextPickOverall, nextPickLabel, normPos]);

        // Template-first AI upgrade for the Roster Targeting notes. One batched
        // dhqAI call (not six) returns a line per position in Alex's configured
        // voice; we parse "POS: note" lines and swap them in over the seeded
        // template. If AI is unavailable or the call fails, the template stands.
        useEffect(() => {
            const AV = window.AlexVoice;
            if (!AV || !AV.hasAI() || !needLabels.length) return;
            const targets = needLabels.filter(n => n.targetName);
            if (!targets.length) return;
            const sig = targets.map(n => n.pos + ':' + n.targetName + ':' + (n.priorityLabel || '')).join('|')
                + '@' + (nextPickLabel || '') + '#' + (leagueKey || '');
            const cacheKey = 'flash-targets:' + sig;
            const cached = AV.getCached(cacheKey);
            if (cached) { setAiRosterNotes(cached); return; }
            let cancelled = false;
            const context = JSON.stringify({
                pick: nextPickLabel || 'our next pick',
                valueLabel: valueShortLabel,
                targets: targets.map(n => ({
                    pos: n.pos,
                    priority: n.priorityLabel,
                    target: n.targetName,
                    value: n.targetDhq || null,
                    capital: n.targetFacts?.capital || undefined,
                    college: n.targetFacts?.college || undefined,
                    landingTeam: n.targetFacts?.team || undefined,
                    age: n.targetFacts?.age || undefined,
                    samePositionGoneBeforeOurPick: n.targetFacts?.goneBeforePick || undefined,
                    lastOneOffTheBoard: n.targetFacts?.lastGoneName
                        ? n.targetFacts.lastGoneName + ' at ' + n.targetFacts.lastGoneSlot
                        : undefined,
                })),
            });
            const message = 'These are MY pre-set roster targets for the upcoming draft — one per position, each already chosen as the best player likely to reach our pick. '
                + 'For each one, sell me on the pick in your own voice, like you\'re leaning over my shoulder in the war room. '
                + 'IMPORTANT: do not second-guess, re-rank, or suggest looking elsewhere — assume the listed player IS our pick and make the case FOR him. '
                + 'Build the case from the data I gave you: his NFL draft capital, college, landing team, age (younger = more runway), the position\'s priority for us, and how many at his position are projected gone before our pick (a thinning tier = move now). '
                + 'Use the specific numbers and names. Confident and decisive, never wishy-washy. '
                + 'Max two sentences each. No bullet symbols, no preamble. Return exactly one line per position formatted as "POS: note" (e.g. "QB: ...").';
            AV.enhance({
                type: 'strategy-analysis',
                message,
                context,
                cacheKey,
                fallback: null,
                transform: (raw) => {
                    // Scan for "POS: note" segments. Works whether the model
                    // returns one line per position or a single run-on string
                    // (sanitize() collapses newlines), and skips any preamble.
                    const map = {};
                    const re = /\b(QB|RB|WR|TE|DL|LB|DB|FB|K)\s*[:\-—]\s*([\s\S]*?)(?=\b(?:QB|RB|WR|TE|DL|LB|DB|FB|K)\s*[:\-—]|$)/gi;
                    let m;
                    while ((m = re.exec(raw))) {
                        const note = m[2].trim().replace(/\s+/g, ' ');
                        if (note.length > 4) map[m[1].toUpperCase()] = note;
                    }
                    return Object.keys(map).length ? map : null;
                },
            }).then(map => { if (!cancelled && map) setAiRosterNotes(map); });
            return () => { cancelled = true; };
        }, [needLabels, nextPickLabel, leagueKey, valueShortLabel]);

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
            const seed = 'app:' + pos + ':' + (targetName || '') + ':' + label;
            if (targetNeed) {
                return avPick(seed, [
                    'At ' + label + ', I want ' + targetName + ' because ' + posName + ' is already a real pressure point for us. This isn\'t taking the top name left — it\'s using the pick to fix a lineup problem while the value still holds.',
                    'At ' + label + ', give me ' + targetName + '. ' + posName + ' is a hole we have to close, and the value\'s still defendable here.',
                ]);
            }
            if (pos === 'QB') return avPick(seed, [
                'At ' + label + ', I\'d only take ' + targetName + ' if the room leaves us a real QB value pocket. It\'s about insulation and weekly ceiling, not collecting another name.',
                'At ' + label + ', ' + targetName + ' is a yes only if QB value falls to us — I\'m chasing ceiling, not a roster trophy.',
            ]);
            if (pos === 'RB') return avPick(seed, [
                'At ' + label + ', ' + targetName + ' works if we want a younger swing against our age curve. I won\'t force RB over a cleaner tier somewhere else.',
                'At ' + label + ', I\'d take ' + targetName + ' as an age-curve bet — but not at the cost of a better tier at another spot.',
            ]);
            if (['DL', 'LB', 'DB'].includes(pos)) return avPick(seed, [
                'At ' + label + ', ' + targetName + ' is an IDP value bet — only if the room hasn\'t already drained the tier before us.',
                'At ' + label + ', I\'ll grab ' + targetName + ' on the IDP side, provided the tier survives to our pick.',
            ]);
            return avPick(seed, [
                'At ' + label + ', I\'d treat ' + targetName + ' as a ' + needWord + ' checkpoint. If the board\'s flat, this is the kind of pick that keeps us flexible without giving up ' + valueShortLabel + '.',
                'At ' + label + ', ' + targetName + ' is my ' + needWord + ' fallback — flexible value when the board doesn\'t give us anything cleaner.',
            ]);
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

                const nflTeam = r.csv?.nflTeam || r.p?.team || '';
                const dRound = Number(r.csv?.draftRound) || 0;
                const isUDFA = !!r.csv?.isUDFA && !dRound;
                const ageRaw = Number(r.p?.age) || (r.csv?.age ? parseFloat(r.csv.age) : 0);
                const age = ageRaw > 0 && ageRaw < 35 ? Math.round(ageRaw) : 0;
                const consensusRank = r.consensusRank || r.csv?.rank || 0;
                const risk = r.csv?.risk || '';

                let pickShort = '';
                if (dRound === 1) pickShort = 'R1';
                else if (dRound === 2) pickShort = 'R2';
                else if (dRound === 3) pickShort = 'R3';
                else if (dRound >= 4) pickShort = 'Day 3';
                else if (isUDFA) pickShort = 'UDFA';

                const pedBits = [pickShort, nflTeam].filter(Boolean);
                const pedigree = pedBits.length ? ' (' + pedBits.join(', ') + ')' : '';

                const posGone = projectedPicks
                    .filter(p => Number(p.overall) < pickOverall && (normPos(p.pos) || p.pos) === pos)
                    .sort((a, b) => Number(b.overall) - Number(a.overall));
                const lastGone = posGone[0];
                const lastGoneSlot = lastGone
                    ? lastGone.round + '.' + String(lastGone.slot).padStart(2, '0')
                    : '';

                const dhqText = r.dhq > 0 ? fmtDhq(r.dhq) + ' ' + valueShortLabel : '';

                const seed = 'pr:' + pos + ':' + (r.pid || name) + ':' + pickOverall;
                const sentences = [];
                if (alreadyClaimed >= 1) {
                    sentences.push(avPick(seed + ':dbl', [
                        'At ' + slot + ', I\'m doubling up on ' + pos + ' with ' + name + pedigree + ' — second swing now that we\'ve already anchored the spot.',
                        'We\'ve got the ' + pos + ' anchor, so at ' + slot + ' I take another bite with ' + name + pedigree + '.',
                    ]));
                } else if (lastGone && posGone.length >= 2) {
                    sentences.push(avPick(seed + ':run', [
                        'At ' + slot + ', ' + posGone.length + ' ' + pos + 's are already gone (' + lastGone.name + ' just went at ' + lastGoneSlot + '), so ' + name + pedigree + ' is our next clean tier.',
                        'The ' + pos + ' run is on — ' + posGone.length + ' off the board by ' + slot + ', ' + lastGone.name + ' the last at ' + lastGoneSlot + '. ' + name + pedigree + ' is who I grab.',
                    ]));
                } else if (lastGone) {
                    sentences.push(avPick(seed + ':after', [
                        'At ' + slot + ', ' + name + pedigree + ' is our ' + pos + ' answer right after ' + lastGone.name + ' came off at ' + lastGoneSlot + '.',
                        'Once ' + lastGone.name + ' goes at ' + lastGoneSlot + ', I\'m on ' + name + pedigree + ' at ' + slot + ' to cover ' + pos + '.',
                    ]));
                } else if (need?.urgency === 'deficit') {
                    sentences.push(avPick(seed + ':def', [
                        'At ' + slot + ', ' + name + pedigree + ' closes our ' + pos + ' deficit before the run forces our hand.',
                        'I take ' + name + pedigree + ' at ' + slot + ' to patch ' + pos + ' while we still can.',
                    ]));
                } else if (need) {
                    sentences.push(avPick(seed + ':shore', [
                        'At ' + slot + ', ' + name + pedigree + ' shores up ' + pos + ' without making us reach.',
                        name + pedigree + ' at ' + slot + ' adds the ' + pos + ' depth we want, no reach required.',
                    ]));
                } else {
                    sentences.push(avPick(seed + ':bpa', [
                        'At ' + slot + ', ' + name + pedigree + ' is simply the best piece left on our board.',
                        'Easy call at ' + slot + ' — ' + name + pedigree + ' is the strongest name available to us.',
                    ]));
                }

                // Second sentence: value + need framing, or pure BPA framing
                if (need && alreadyClaimed === 0 && dhqText) {
                    const needWord = need.urgency === 'deficit' ? 'a deficit slot' : 'a real depth squeeze';
                    sentences.push(avPick(seed + ':val', [
                        pos + ' is ' + needWord + ' for us, and ' + dhqText + ' is honest value right here.',
                        'With ' + pos + ' being ' + needWord + ', ' + dhqText + ' is more than fair at this pick.',
                    ]));
                } else if (alreadyClaimed >= 1 && dhqText) {
                    sentences.push(avPick(seed + ':val2', [
                        'At ' + dhqText + ', this is the kind of depth move that keeps our build flexible.',
                        dhqText + ' for a depth swing like this is exactly how we stay nimble.',
                    ]));
                } else if (dhqText) {
                    sentences.push(avPick(seed + ':val3', [
                        dhqText + ' on the board — I\'ll take value over a positional reach every time.',
                        'That\'s ' + dhqText + ' sitting there; value wins over forcing a position.',
                    ]));
                }

                // Optional third sentence: risk/age tag if it adds something
                if (risk && /high|long.?shot|boom|bust/i.test(risk)) {
                    sentences.push(avPick(seed + ':risk', [
                        'Fair warning — he\'s a ' + risk.toLowerCase() + (age ? ' at ' + age : '') + ', so know what you\'re signing up for.',
                        'Risk\'s real here: ' + risk.toLowerCase() + (age ? ' at age ' + age : '') + '.',
                    ]));
                } else if (age && age <= 21 && firstName) {
                    sentences.push(avPick(seed + ':age', [
                        firstName + '\'s only ' + age + ' — the whole age curve is still in front of him.',
                        'And at ' + age + ', ' + firstName + ' has years of runway left.',
                    ]));
                } else if (consensusRank && consensusRank <= 36) {
                    const band = consensusRank <= 12 ? '12' : consensusRank <= 24 ? '24' : '36';
                    sentences.push(avPick(seed + ':rank', [
                        'Consensus has him top ' + band + ' in this class, so we\'re not out on a limb.',
                        'The industry\'s got him top ' + band + ' too — this isn\'t just my board talking.',
                    ]));
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

        // Saved Alex reports (draft plans / class reads) — local cache + server sync.
        const [savedReports, setSavedReports] = useState([]);
        useEffect(() => {
            let alive = true;
            const load = () => {
                const lid = window.S?.currentLeagueId || null;
                const SR = window.WR?.SavedReports;
                if (SR?.syncFromServer) {
                    SR.syncFromServer(lid).then(rows => { if (alive) setSavedReports(rows || []); }).catch(() => {});
                } else if (SR?.listLocal) {
                    if (alive) setSavedReports(SR.listLocal(lid));
                }
            };
            load();
            const onSaved = () => load();
            window.addEventListener('wr:report-saved', onSaved);
            return () => { alive = false; window.removeEventListener('wr:report-saved', onSaved); };
        }, []);

        const requestFullDraftReport = useCallback(() => {
            if (!rosterState.isUsable) { alert(rosterState.message); return; }
            const needs = needLabels.map(n => n.pos + (n.urgency === 'deficit' ? ' critical' : '')).join(', ') || 'balanced';
            const picks = myPicks.filter(p => p.year === leagueSeason).map(fmtPick).join(', ') || 'unknown';
            const prompt = isRookieDraft
                ? `SEARCH THE WEB for current ${leagueSeason} NFL draft prospect rankings. Generate a full ${skinFeatures.showDynastyValue === false ? 'rookie draft' : 'dynasty rookie draft'} plan.\n\n` +
                    `League size: ${leagueSize}\nMy needs: ${needs}\nMy picks: ${picks}\n\n` +
                    `Cover: position tiers, best fits at my slots, players worth moving up for, trade-down pockets, and avoid zones. Use specific prospect names.`
                : `Generate a full ${leagueSeason} redraft plan from the current player pool.\n\n` +
                    `League size: ${leagueSize}\nMy needs: ${needs}\nMy draft slots: ${picks}\n\n` +
                    `Cover: positional tiers, early-round build paths, mid-round targets, late values, kicker/DST timing, and avoid zones. Use specific player names from the board.`;
            window.dispatchEvent(new CustomEvent('wr:ask-open', { detail: { title: leagueSeason + ' Draft Plan', prompt, kind: 'draft-plan' } }));
        }, [rosterState.isUsable, rosterState.message, needLabels, myPicks, leagueSeason, leagueSize, fmtPick, isRookieDraft, skinFeatures.showDynastyValue]);

        const requestClassOverview = useCallback(() => {
            const prompt = isRookieDraft
                ? 'Give me a concise ' + leagueSeason + ' rookie class overview by position, including class strengths, cliff points, and where my current picks should attack.'
                : 'Give me a concise ' + leagueSeason + ' redraft board overview by position, including tier cliffs, scarce pockets, and where my draft slots should attack.';
            window.dispatchEvent(new CustomEvent('wr:ask-open', { detail: { title: leagueSeason + ' Class Read', prompt, kind: 'class-read' } }));
        }, [leagueSeason, isRookieDraft]);

        // Tag button helper
        const tagDefs = { target: { icon: '\u2605', color: 'var(--good)', label: 'Target' }, avoid: { icon: '\u2717', color: 'var(--bad)', label: 'Avoid' }, sleeper: { icon: '\u26A1', color: 'var(--k-3498db, #3498db)', label: 'Sleeper' }, must: { icon: '\u2B50', color: 'var(--gold)', label: 'Must' } };

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
                                <option key={round} value={round} style={{ background: 'var(--k-111111, #111111)' }}>{round}R</option>
                            ))}
                            <option value="full" style={{ background: 'var(--k-111111, #111111)' }}>Full</option>
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
            <div style={{ padding: 'var(--card-pad, 16px 18px)' }}>
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
                    <div className="draft-pick-context-banner" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-md)', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', borderRadius: 'var(--card-radius-sm)', padding: 'var(--card-pad-sm)', marginBottom: 'var(--space-md)' }}>
                        <div style={{ minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>Pick Focus</span>
                            <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.9rem', fontFamily: 'var(--font-title)' }}>{pickFocusLabel}</strong>
                            <em style={{ display: 'block', color: 'var(--silver)', fontSize: '0.74rem', fontStyle: 'normal' }}>{pickFocusSummary || 'Opened from the pick ledger.'}</em>
                        </div>
                        <button type="button" onClick={clearPickFocus} style={{ background: 'transparent', border: '1px solid var(--acc-line2, rgba(212,175,55,0.32))', borderRadius: 'var(--card-radius-sm)', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontSize: '0.72rem', padding: '4px 10px', minHeight: '44px', textTransform: 'uppercase' }}>Clear</button>
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
                                                        <button type="button" onClick={() => openDraftPlayer(n.targetPid)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--acc-line2, rgba(212,175,55,0.35))' }}>{n.targetName}</button>
                                                        {n.targetDhq ? ' - ' + fmtDhq(n.targetDhq) + ' ' + valueShortLabel : ''}
                                                        <button type="button" onClick={() => setBoardTags(prev => ({ ...prev, [n.targetPid]: 'target' }))} style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', borderRadius: 5, padding: '1px 7px', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>Tag</button>
                                                    </>
                                                ) : (n.count ? n.count + ' players' : 'no clean target loaded')}
                                            </em>
                                            <p>{aiRosterNotes[n.pos] || n.alexBlurb}</p>
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
                                    {savedReports.length > 0 && (
                                        <div style={{ marginTop: 10, borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.06))', paddingTop: 8 }}>
                                            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--silver)', opacity: 0.6, marginBottom: 6 }}>Saved Reports</div>
                                            {savedReports.slice(0, 6).map(r => (
                                                <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
                                                    <button type="button" title="Reopen report" onClick={() => window.dispatchEvent(new CustomEvent('wr:ask-show', { detail: { title: r.title, prompt: r.prompt, answer: r.content, kind: r.kind } }))} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 0, color: 'var(--silver)', cursor: 'pointer', font: 'inherit', fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: 0 }}>
                                                        <span style={{ color: 'var(--gold)' }}>{'★'}</span> {r.title} <span style={{ opacity: 0.45 }}>{new Date(r.createdAt).toLocaleDateString()}</span>
                                                    </button>
                                                    <button type="button" title="Remove from list" onClick={() => { const lid = window.S?.currentLeagueId || null; window.WR?.SavedReports?.remove?.(lid, r.id); setSavedReports(prev => prev.filter(x => x.id !== r.id)); }} style={{ flexShrink: 0, background: 'transparent', border: 0, color: 'var(--silver)', opacity: 0.5, cursor: 'pointer', fontSize: 'var(--text-micro, 0.6875rem)', padding: '0 2px' }}>{'✕'}</button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
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
                                                <button type="button" onClick={() => openDraftPlayer(row.topPid)} style={{ border: 0, background: 'transparent', color: 'inherit', padding: 0, font: 'inherit', cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'var(--acc-line2, rgba(212,175,55,0.35))' }}>{row.top}</button>
                                                <button type="button" onClick={() => setBoardTags(prev => ({ ...prev, [row.topPid]: 'target' }))} style={{ marginLeft: 6, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', color: 'var(--gold)', borderRadius: 5, padding: '1px 7px', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', cursor: 'pointer' }}>Tag</button>
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
                            const detailLabel = { display: 'block', color: 'var(--gold)', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
                            const detailBox = { border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: 'var(--card-radius-sm)', padding: '9px 10px', minWidth: 0 };
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
                                                            <div key={label} style={{ border: '1px solid var(--ov-4, rgba(255,255,255,0.055))', borderRadius: 6, padding: '6px 7px', background: 'var(--ov-1, rgba(255,255,255,0.02))' }}>
                                                                <em style={{ display: 'block', color: 'var(--silver)', opacity: 0.58, fontStyle: 'normal', fontSize: 'var(--text-micro)', textTransform: 'uppercase' }}>{label}</em>
                                                                <strong style={{ display: 'block', color: label === valueShortLabel ? dhqC : 'var(--white)', fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Scouting Report</span>
                                                    <div style={{ display: 'grid', gap: 6 }}>
                                                        {reportBits.map((bit, bi) => (
                                                            <div key={bi} style={{ color: 'var(--white)', opacity: 0.92, fontSize: '0.72rem', lineHeight: 1.45, border: '1px solid var(--ov-4, rgba(255,255,255,0.055))', borderRadius: 6, padding: '7px 8px', background: 'var(--ov-1, rgba(255,255,255,0.018))' }}>{bit}</div>
                                                        ))}
                                                    </div>
                                                    {compText && <div style={{ color: 'var(--white)', opacity: 0.82, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 7 }}>Comp: {compText}</div>}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                                <button type="button" onClick={() => { setScoutDrawerPid(null); openInBigBoard(r.pid); }} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>OPEN IN BIG BOARD</button>
                                                <a href={(isSeasonalDraftCtx ? 'https://www.pro-football-reference.com/search/search.fcgi?search=' : 'https://www.sports-reference.com/cfb/search/search.fcgi?search=') + encodeURIComponent(pName(r.p))} target="_blank" rel="noopener" style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.12)', color: 'var(--k-3498db, #3498db)', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>{isSeasonalDraftCtx ? 'PRO STATS' : 'COLLEGE STATS'}</a>
                                                <a href={'https://www.youtube.com/results?search_query=' + encodeURIComponent(pName(r.p) + ' highlights ' + leagueSeason)} target="_blank" rel="noopener" style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.12)', color: 'var(--bad)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>HIGHLIGHTS</a>
                                                <a href={'https://www.fantasypros.com/nfl/players/' + encodeURIComponent(((r.p.first_name || '') + '-' + (r.p.last_name || '')).toLowerCase().replace(/[^a-z-]/g, '')) + '.php'} target="_blank" rel="noopener" style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.15)', color: 'var(--k-3498db, #3498db)', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>FANTASYPROS</a>
                                                <button type="button" onClick={() => { setBoardTags(prev => ({ ...prev, [r.pid]: prev[r.pid] === 'target' ? undefined : 'target' })); }} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(46,204,113,0.12)', color: 'var(--good)', border: '1px solid rgba(46,204,113,0.3)', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>{boardTags[r.pid] === 'target' ? 'UNTAG TARGET' : 'TAG TARGET'}</button>
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

                    // Drag handlers — mirror the live Big Board exactly. Setting
                    // dataTransfer in onDragStart (and dropEffect in onDragOver) is
                    // what actually initiates the native drag on iPad/WKWebView;
                    // without it the touch falls back to selecting text.
                    const handleDragStart = (e, pid) => {
                        setDragPid(pid);
                        try {
                            if (e?.dataTransfer) {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', String(pid));
                            }
                        } catch (_) {}
                    };
                    const handleDragOver = (e) => {
                        e.preventDefault();
                        try { if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'; } catch (_) {}
                    };
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
                        // Auto cross-off players already taken in the live draft (parallel to
                        // the live Command Center board), merged with manual "Off" marks.
                        // liveDraftedPids is kept current by the wr:live-draft-picks listener
                        // above, so this re-renders the instant a pick lands in the live draft.
                        const liveDrafted = liveDraftedPids;
                        const boardGridCols = isSeasonalDraft
                            ? '58px minmax(220px, 1.25fr) 96px 88px 68px 72px 64px minmax(156px, 0.95fr) 92px'
                            : '58px minmax(205px, 1.15fr) minmax(128px, 0.82fr) 88px 64px 58px 82px 64px 58px minmax(156px, 0.95fr) 92px';
                        const boardHeaderCell = (label, key, extra = {}) => (
                            <div onClick={key ? () => toggleSort(key) : undefined} style={{ ...sortHdr, ...extra }}>
                                {label}{key ? sortArrow(key) : ''}
                            </div>
                        );
                        const chip = (label, color, bg) => (
                            <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 16, padding: '0 5px', borderRadius: 4, background: bg || 'var(--ov-3, rgba(255,255,255,0.045))', color: color || 'var(--silver)', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', fontWeight: 800, whiteSpace: 'nowrap' }}>{label}</span>
                        );
                        const snapshotCell = (value, color, extra = {}) => (
                            <div style={{ padding: '4px 7px', minWidth: 0, ...extra }}>
                                <strong style={{ display: 'block', color: color || 'var(--white)', fontFamily: 'var(--font-body)', fontSize: '0.72rem', lineHeight: 1.15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '-'}</strong>
                            </div>
                        );
                        const detailLabel = { display: 'block', color: 'var(--gold)', fontSize: 'var(--text-micro)', fontFamily: 'var(--font-body)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 };
                        const detailBox = { border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', background: 'var(--ov-2, rgba(255,255,255,0.025))', borderRadius: 'var(--card-radius-sm)', padding: '9px 10px', minWidth: 0 };

                        return (
		                        <div style={{ background: 'var(--black)', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.15))', borderRadius: 'var(--card-radius-sm)', maxHeight: 'none', overflowX: 'auto', WebkitOverflowScrolling: 'touch', overflowY: 'clip' }}>
	                          <div style={{ minWidth: '100%' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: boardGridCols, minHeight: '34px', background: 'var(--acc-fill2, rgba(212,175,55,0.08))', borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', alignItems: 'center', position: 'sticky', top: 0, zIndex: 1 }}>
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
                                const dhqC = r.dhq >= 7000 ? 'var(--good)' : r.dhq >= 4000 ? 'var(--k-3498db, #3498db)' : r.dhq >= 2000 ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))';
                                // Match on Sleeper pid (how the live draft keys picks) and
                                // fall back to the CSV prospect id for rookies that aren't
                                // linked to a Sleeper player.
                                const isDrafted = draftedPids.has(r.pid)
                                    || liveDrafted.has(r.pid) || liveDrafted.has(String(r.pid))
                                    || (r.csv?.pid != null && liveDrafted.has(String(r.csv.pid)));
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
                                const draftCol = draftRound === 1 ? 'var(--good)' : draftRound && draftRound <= 3 ? 'var(--gold)' : isTrueUdfa(cs) ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.42))';
                                const valueRank = valueRankMap.get(String(r.pid)) || null;
                                const posRankList = posRankMaps[pos] || [];
                                const posRank = posRankList.indexOf(String(r.pid)) >= 0 ? posRankList.indexOf(String(r.pid)) + 1 : null;
                                const tierMeta = valueTierMeta(r.dhq, valueRank, posRank);
                                const rankStr = (isRookieDraft && (cs.consensusRank || cs.rank)) ? '#' + Math.round(cs.consensusRank || cs.rank) : (valueRank ? '#' + valueRank : '-');
                                const tierStr = (isRookieDraft && cs.tier) ? cs.tier : tierMeta.label;
                                const compText = cs.nflComp || cs.comp || '';
                                // "Alex NFL Fit" — real-situation read built from the signals the DHQ
                                // engine already computes (depth-chart role, the specific teammates
                                // blocking him + their PPG, status, trend) plus NFL draft capital /
                                // landing spot. Premium users get a live web-search read layered on
                                // via the nflFitAI effect (rendered below). Falls back to a terse line
                                // when no signals are available (e.g. a CSV-only prospect with no role).
                                // Compute the fit UNCONDITIONALLY and gate on the narrative (like the
                                // player card does). Previously the whole block was gated on `team`, so
                                // most rookie-draft prospects (no NFL team yet) got no fit read at all —
                                // that's why "Alex NFL Fit" fired inconsistently. computeNFLFit returns a
                                // narrative even with no landing spot (its "Unsettled" branch).
                                const _nflFit = (typeof window.App.computeNFLFit === 'function')
                                    ? window.App.computeNFLFit(r.pid, {
                                        pos, player: r.p, dhq: r.dhq, isRookie: isRookieDraft,
                                        capital: { round: draftRound, pick: draftPick, nflTeam: team, isUDFA: isTrueUdfa(cs) },
                                    })
                                    : null;
                                const teamFitInsight = (_nflFit && _nflFit.narrative)
                                    || (team
                                        ? ('On ' + team + ", the role isn't settled yet — I'd trust the board value over the situation until it clears.")
                                        : "The landing spot isn't set yet — I'd trust the board value until it clears.");
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
                                        onDragStart={!isDhq ? (e) => handleDragStart(e, r.pid) : undefined}
                                        onDragOver={!isDhq ? handleDragOver : undefined}
                                        onDragEnd={!isDhq ? () => setDragPid(null) : undefined}
                                        onDrop={!isDhq ? () => handleDrop(r.pid) : undefined}
                                        onClick={openPlayerDetail}
                                        style={{ display: 'grid', gridTemplateColumns: boardGridCols, alignItems: 'center', minHeight: '42px', opacity: isDrafted ? 0.35 : (dragPid === r.pid ? 0.5 : 1), borderBottom: isExp ? 'none' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', cursor: !isDhq ? 'grab' : 'pointer', background: isExp ? 'var(--acc-fill1, rgba(212,175,55,0.065))' : idx % 2 === 1 ? 'var(--ov-1, rgba(255,255,255,0.016))' : 'transparent', transition: 'background 0.1s', position: 'relative', ...(!isDhq ? { userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' } : {}) }}
                                        onMouseEnter={e => { if (!isExp) e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.04))'; }}
                                        onMouseLeave={e => { if (!isExp) e.currentTarget.style.background = idx % 2 === 1 ? 'var(--ov-1, rgba(255,255,255,0.016))' : 'transparent'; }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, fontFamily: 'var(--font-body)', fontSize: '0.74rem', color: idx < 3 ? 'var(--gold)' : 'var(--silver)', fontWeight: 800 }}>
                                            <span>{idx + 1}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, padding: '5px 7px' }}>
                                            <div style={{ width: 28, height: 28, flexShrink: 0 }}>
                                                <img src={photoSrc} alt="" onError={e => e.target.style.display='none'} style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))' }} />
                                            </div>
                                            <div style={{ minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                                                    <strong style={{ color: 'var(--white)', fontSize: '0.76rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textDecoration: isDrafted ? 'line-through' : 'none' }}>{pName(r.p)}</strong>
                                                    {chip(pos, posColors[pos] || 'var(--silver)', (posColors[pos] || 'var(--k-666666, #666666)') + '22')}
                                                </div>
                                            </div>
                                        </div>
                                        {snapshotCell(isSeasonalDraft ? (team || 'FA') : (college || 'School TBD'), isSeasonalDraft && team ? 'var(--good)' : 'var(--silver)')}
                                        {snapshotCell(r.dhq > 0 ? r.dhq.toLocaleString() : '-', dhqC)}
                                        {snapshotCell(rankStr)}
                                        {snapshotCell(tierStr)}
                                        {showDraftCapitalColumn && snapshotCell(draftStr || 'Capital TBD', draftCol)}
                                        {showDraftCapitalColumn && snapshotCell(team || 'TBD', team ? 'var(--good)' : 'var(--silver)')}
                                        {snapshotCell(age || '-')}
                                        {snapshotCell(profileStr, speedStr && parseFloat(speedStr) <= 4.45 ? 'var(--good)' : 'var(--white)')}
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 6px' }}>
                                            <button type="button" onClick={e => { e.stopPropagation(); openPlayerDetail(); }}
                                                style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '3px 6px', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: 5, cursor: 'pointer', background: isExp ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'var(--ov-3, rgba(255,255,255,0.035))', color: isExp ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', fontWeight: 800 }}>
                                                {isExp ? 'Hide' : 'Open'}
                                            </button>
                                            {!isDhq && (
                                                <button type="button" onClick={e => { e.stopPropagation(); setDraftedPids(prev => { const n = new Set(prev); if (n.has(r.pid)) n.delete(r.pid); else n.add(r.pid); return n; }); }}
                                                    style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '3px 6px', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 5, cursor: 'pointer', background: isDrafted ? 'rgba(231,76,60,0.15)' : 'var(--ov-3, rgba(255,255,255,0.035))', color: isDrafted ? 'var(--bad)' : 'var(--silver)', fontFamily: 'var(--font-body)', fontWeight: 800 }}>
                                                    {isDrafted ? 'Undo' : 'Off'}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                    {isExp && (
                                        <div style={{ borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.25))', background: 'rgba(0,0,0,0.28)', padding: '13px 14px 15px', animation: 'wrFadeIn 0.2s ease' }}>
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
                                                            <div key={label} style={{ border: '1px solid var(--ov-4, rgba(255,255,255,0.055))', borderRadius: 6, padding: '6px 7px', background: 'var(--ov-1, rgba(255,255,255,0.02))' }}>
                                                                <em style={{ display: 'block', color: 'var(--silver)', opacity: 0.58, fontStyle: 'normal', fontSize: 'var(--text-micro)', textTransform: 'uppercase' }}>{label}</em>
                                                                <strong style={{ display: 'block', color: label === valueShortLabel ? dhqC : 'var(--white)', fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</strong>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Scouting Report</span>
                                                    <div style={{ display: 'grid', gap: 6 }}>
                                                        {reportBits.map((bit, bi) => (
                                                            <div key={bi} style={{ color: 'var(--silver)', fontSize: '0.72rem', lineHeight: 1.45, border: '1px solid var(--ov-4, rgba(255,255,255,0.055))', borderRadius: 6, padding: '7px 8px', background: 'var(--ov-1, rgba(255,255,255,0.018))' }}>{bit}</div>
                                                        ))}
                                                    </div>
                                                    {compText && <div style={{ color: 'var(--white)', opacity: 0.82, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 7 }}>Comp: {compText}</div>}
                                                    {teamFitInsight && (
                                                        <div style={{ border: '1px solid rgba(46,204,113,0.18)', background: 'rgba(46,204,113,0.045)', borderRadius: 6, padding: '7px 8px', marginTop: 7 }}>
                                                            <span style={{ display: 'block', color: 'var(--good)', fontSize: 'var(--text-micro)', fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>Alex NFL Fit{nflFitAI[r.pid] ? ' · Live' : ''}</span>
                                                            <div style={{ color: 'var(--silver)', fontSize: '0.7rem', lineHeight: 1.42 }}>{nflFitAI[r.pid] || teamFitInsight}</div>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            <InlineCareerStats pid={r.pid} pos={pos} player={r.p} scoringSettings={currentLeague?.scoring_settings} statsData={statsData} />

                                            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px,1fr) minmax(260px,0.9fr)', gap: 10, alignItems: 'start', marginTop: 10 }}>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Front Office Notes</span>
                                                    <textarea value={note} onChange={e => setBoardNotes(prev => ({...prev, [r.pid]: e.target.value}))} onClick={e => e.stopPropagation()} placeholder={'Add your scouting notes on ' + pName(r.p) + '...'} style={{ width: '100%', minHeight: 82, padding: '8px 10px', fontSize: '0.76rem', background: 'var(--ov-2, rgba(255,255,255,0.03))', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))', borderRadius: 6, color: 'var(--silver)', fontFamily: 'inherit', resize: 'vertical', lineHeight: 1.5, outline: 'none' }} />
                                                </div>
                                                <div style={detailBox}>
                                                    <span style={detailLabel}>Research / Actions</span>
                                                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 9 }}>
                                                        {Object.entries(tagDefs).map(([tKey, tDef]) => (
                                                            <button key={tKey} type="button" onClick={(e) => { e.stopPropagation(); const wasActive = boardTags[r.pid] === tKey; setBoardTags(prev => ({ ...prev, [r.pid]: prev[r.pid] === tKey ? undefined : tKey })); if (!wasActive) { window.wrLogAction?.('TAG', 'Tagged ' + pName(r.p) + ' on draft board', 'draft', { players: [{ name: pName(r.p) }], actionType: 'board-tag' }); } }} style={{ padding: '4px 9px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', fontWeight: 800, borderRadius: 6, cursor: 'pointer', border: '1px solid ' + (tag === tKey ? tDef.color : 'var(--ov-6, rgba(255,255,255,0.12))'), background: tag === tKey ? wrAlpha(tDef.color, '25') : 'var(--ov-2, rgba(255,255,255,0.03))', color: tag === tKey ? tDef.color : 'var(--silver)' }}>{tDef.label}</button>
                                                        ))}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                                                        <a href={(isSeasonalDraft ? 'https://www.pro-football-reference.com/search/search.fcgi?search=' : 'https://www.sports-reference.com/cfb/search/search.fcgi?search=') + encodeURIComponent(pName(r.p))} target="_blank" rel="noopener" title={isSeasonalDraft ? 'Open Pro Football Reference player search in a new tab' : 'Open Sports Reference college stats in a new tab'} onClick={e => e.stopPropagation()} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.12)', color: 'var(--k-3498db, #3498db)', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>{isSeasonalDraft ? 'PRO STATS' : 'COLLEGE STATS'}</a>
                                                        <a href={'https://www.youtube.com/results?search_query=' + encodeURIComponent(pName(r.p) + ' highlights ' + leagueSeason)} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.12)', color: 'var(--bad)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>HIGHLIGHTS</a>
                                                        <a href={'https://www.fantasypros.com/nfl/players/' + encodeURIComponent(((r.p.first_name || '') + '-' + (r.p.last_name || '')).toLowerCase().replace(/[^a-z-]/g, '')) + '.php'} target="_blank" rel="noopener" title="Open FantasyPros player news and profile in a new tab" aria-label={'Open FantasyPros news for ' + pName(r.p)} onClick={e => e.stopPropagation()} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(52,152,219,0.15)', color: 'var(--k-3498db, #3498db)', border: '1px solid rgba(52,152,219,0.3)', borderRadius: 6, textDecoration: 'none', fontWeight: 800 }}>FANTASYPROS NEWS</a>
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
                                                        }} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'rgba(124,107,248,0.15)', color: 'var(--purple)', border: '1px solid rgba(124,107,248,0.3)', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>ASK ALEX</button>
                                                        <button type="button" onClick={e => { e.stopPropagation(); setExpandedDraftPid(null); }} style={{ padding: '7px 10px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: 6, cursor: 'pointer', fontWeight: 800 }}>COLLAPSE</button>
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
                    const allBoardPlayers = boardMode === 'my' ? myBoardPlayers : boardMode === 'ai' ? aiBoardPlayers : dhqBoardPlayers;
                    const boardQuery = boardSearch.trim().toLowerCase();
                    const visibleBoardPlayers = !boardQuery ? allBoardPlayers : allBoardPlayers.filter(r => {
                        const name = pName(r.p).toLowerCase();
                        const team = String(r.csv?.nflTeam || r.p?.team || '').toLowerCase();
                        const college = String(r.csv?.college || r.p?.college || r.p?.metadata?.college || '').toLowerCase();
                        return name.includes(boardQuery) || team.includes(boardQuery) || college.includes(boardQuery);
                    });
                    const manualSignalCount = Object.keys(boardNotes || {}).length + Object.values(boardTags || {}).filter(Boolean).length;

                    return (
                    <div>
                        <section style={{ border: '1px solid var(--acc-fill3, rgba(212,175,55,0.18))', borderRadius: 'var(--card-radius)', background: 'linear-gradient(135deg, var(--acc-fill2, rgba(212,175,55,0.08)), var(--ov-1, rgba(255,255,255,0.018)))', padding: '14px 15px', marginBottom: 12 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 12 }}>
                                <div style={{ minWidth: 0 }}>
	                                    <div style={{ color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>{isRookieDraft ? 'Draft Big Board' : 'Redraft Big Board'}</div>
                                    <h3 style={{ margin: 0, color: 'var(--white)', fontFamily: 'var(--font-title)', fontSize: '1.22rem', lineHeight: 1.05 }}>{activeBoardInfo.label}</h3>
                                    <p style={{ margin: '4px 0 0', color: 'var(--silver)', opacity: 0.72, fontSize: '0.76rem', lineHeight: 1.45 }}>{activeBoardInfo.detail}</p>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(74px,1fr))', gap: 6, minWidth: 250 }}>
                                    {[
                                        { label: 'Players', value: visibleBoardPlayers.length },
                                        { label: 'Notes/Tags', value: manualSignalCount },
                                        { label: 'AI Seed', value: aiBoardPlayers.length ? 'Ready' : 'Build' },
                                    ].map(item => (
                                        <div key={item.label} style={{ padding: '7px 8px', borderRadius: 'var(--card-radius-sm)', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', background: 'rgba(0,0,0,0.18)' }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.6, fontSize: 'var(--text-micro)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{item.label}</span>
                                            <strong style={{ display: 'block', color: 'var(--gold)', fontFamily: 'var(--font-mono)', fontSize: '0.7rem', marginTop: 2 }}>{item.value}</strong>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 8 }}>
                                {boardModeOptions.map(opt => (
                                    <button key={opt.k} type="button" onClick={() => setBoardMode(opt.k)} style={{
                                        padding: '9px 11px',
                                        borderRadius: 'var(--card-radius-sm)',
                                        border: '1px solid ' + (boardMode === opt.k ? 'var(--acc-line4, rgba(212,175,55,0.52))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                        background: boardMode === opt.k ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'var(--ov-2, rgba(255,255,255,0.025))',
                                        color: boardMode === opt.k ? 'var(--gold)' : 'var(--silver)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: 'var(--font-body)',
                                    }}>
                                        <strong style={{ display: 'block', color: boardMode === opt.k ? 'var(--gold)' : 'var(--white)', fontSize: '0.74rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{opt.label}</strong>
                                        <span style={{ display: 'block', opacity: 0.66, fontSize: 'var(--text-micro, 0.6875rem)', marginTop: 2 }}>{opt.sub}</span>
                                    </button>
                                ))}
                            </div>
                        </section>

                        {/* Player search */}
                        <div style={{ position: 'relative', marginBottom: '8px' }}>
                            <input
                                type="text"
                                value={boardSearch}
                                onChange={e => setBoardSearch(e.target.value)}
                                placeholder="Search players, teams, colleges..."
                                style={{ width: '100%', padding: '9px 30px 9px 12px', minHeight: '44px', fontSize: '0.8rem', fontFamily: 'var(--font-body)', background: 'var(--ov-2, rgba(255,255,255,0.03))', color: 'var(--white)', border: '1px solid ' + (boardSearch ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'), borderRadius: '10px', outline: 'none', boxSizing: 'border-box' }}
                            />
                            {boardSearch && (
                                <button onClick={() => setBoardSearch('')} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--silver)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '4px' }} aria-label="Clear search">{'×'}</button>
                            )}
                        </div>

                        {/* Position filters */}
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <button onClick={() => setBoardPosFilter('')} style={{ padding: '4px 10px', minHeight: '44px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', borderRadius: '14px', cursor: 'pointer', border: '1px solid ' + (!boardPosFilter ? 'var(--acc-line2, rgba(212,175,55,0.3))' : 'var(--ov-5, rgba(255,255,255,0.08))'), background: !boardPosFilter ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'transparent', color: !boardPosFilter ? 'var(--gold)' : 'var(--silver)' }}>Master</button>
                            {(typeof getLeaguePositions === 'function' ? getLeaguePositions() : ['QB','RB','WR','TE','K','DEF','DL','LB','DB']).map(pos => (
                                <button key={pos} onClick={() => setBoardPosFilter(boardPosFilter === pos ? '' : pos)} style={{ padding: '4px 10px', minHeight: '44px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', borderRadius: '14px', cursor: 'pointer', border: '1px solid ' + (boardPosFilter === pos ? (posColors[pos] || 'var(--k-666666, #666666)') + '55' : 'var(--ov-5, rgba(255,255,255,0.08))'), background: boardPosFilter === pos ? (posColors[pos] || 'var(--k-666666, #666666)') + '18' : 'transparent', color: boardPosFilter === pos ? posColors[pos] : 'var(--silver)' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</button>
                            ))}
                            <span style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.4 }}>Click row to expand {'\u00B7'} Drag a player to reorder My Board</span>
                        </div>

                        {/* Team & Round filters */}
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Team</span>
                                <select value={boardTeamFilter} onChange={e => setBoardTeamFilter(e.target.value)} style={{ padding: '3px 6px', minHeight: '44px', fontSize: '0.7rem', fontFamily: 'var(--font-mono)', background: 'var(--ov-3, rgba(255,255,255,0.04))', color: boardTeamFilter ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (boardTeamFilter ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: '6px', cursor: 'pointer', outline: 'none' }}>
                                    <option value="">All teams</option>
                                    {availableTeams.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                            </div>
	                            {isRookieDraft && (
	                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
	                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: '2px' }}>Round</span>
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
	                                    <button key={opt.k} onClick={() => setBoardRoundFilter(boardRoundFilter === opt.k ? '' : opt.k)} style={{ padding: '3px 8px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', borderRadius: '10px', cursor: 'pointer', border: '1px solid ' + (boardRoundFilter === opt.k ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'), background: boardRoundFilter === opt.k ? 'var(--acc-fill3, rgba(212,175,55,0.14))' : 'transparent', color: boardRoundFilter === opt.k ? 'var(--gold)' : 'var(--silver)' }}>{opt.label}</button>
	                                ))}
	                            </div>
	                            )}
                            {(boardTeamFilter || boardRoundFilter) && (
                                <button onClick={() => { setBoardTeamFilter(''); setBoardRoundFilter(''); }} style={{ marginLeft: 'auto', padding: '3px 10px', minHeight: '44px', fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '10px', cursor: 'pointer' }}>Clear</button>
                            )}
                        </div>

                        <div style={{ marginBottom: '14px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8, color: 'var(--silver)', opacity: 0.65, fontSize: 'var(--text-micro, 0.6875rem)' }}>
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
                        <div style={{ padding: '20px', color: 'var(--bad)', textAlign: 'center', fontSize: '0.9rem' }}>
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
                        <div style={{ padding: '20px', color: 'var(--bad)', textAlign: 'center', fontSize: '0.9rem' }}>
                            Live Draft Follower failed to load. Check console for errors.
                        </div>
                    );
                })()}

                {/* Dedicated Alex answer window for Flash Brief report buttons —
                    command-center (which normally mounts this) isn't rendered on this view. */}
                {activeView === 'command' && window.DraftCC && window.DraftCC.AskAnswerWindow
                    ? React.createElement(window.DraftCC.AskAnswerWindow, { state: null })
                    : null}

            </div>
        );
    }

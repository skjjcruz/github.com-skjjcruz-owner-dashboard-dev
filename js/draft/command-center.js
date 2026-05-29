// ══════════════════════════════════════════════════════════════════
// js/draft/command-center.js — <DraftCommandCenter/> main shell
//
// The 6-panel desktop dashboard. Owns draftState via useReducer, renders
// three row bands: header (60px) · top (Big Board / Draft Grid / Opponent
// Intel) · bottom (Live Analytics / Alex Stream). Wires the CPU auto-pick
// loop, speed control, localStorage auto-save, and the setup flow.
//
// Phase 1 replaces the old <MockDraftPanel/> when the feature flag
// `localStorage.wr_draft_cc_enabled` is on (default). Flip it off in
// devtools to fall back to the original MockDraftSimulator.
//
// Depends on: all js/draft/* modules above (styles, scouting, persona,
//             cpu-engine, state, big-board, draft-grid, opponent-intel,
//             alex-stream, live-analytics)
// Exposes:    window.DraftCommandCenter (React component)
//             window.DraftCC.featureFlag (localStorage key helper)
// ══════════════════════════════════════════════════════════════════

(function() {
    const { DRAFT_CC_LAYOUT, FONT_UI, FONT_DISPL, FONT_MONO, panelCard, bpBucket } = window.DraftCC.styles;
    const SpeedMap = { slow: 1600, medium: 700, fast: 250, paused: -1 };

    const FEATURE_FLAG_KEY = 'wr_draft_cc_enabled';
    function isFeatureEnabled() {
        try {
            const v = localStorage.getItem(FEATURE_FLAG_KEY);
            // Default ON — user must explicitly set to 'false' to disable
            return v !== 'false';
        } catch (e) { return true; }
    }

    // ── Top-level shell ──────────────────────────────────────────────
    // Reorder a draft pool by the selected saved board lane. Players not in the
    // saved order keep their original DHQ-sorted position at the tail. Refreshes
    // consensusRank so reach/steal detection reflects the board the user picked.
    function applyUserBigBoardOrder(pool, leagueId, draftType) {
        if (!Array.isArray(pool) || !pool.length || !leagueId) return pool;
        try {
            const saved = window.DraftCC?.context?._private?.loadStoredBoard
                ? window.DraftCC.context._private.loadStoredBoard(leagueId, draftType)
                : null;
            const lane = saved?.activeLane || saved?.boardMode || 'dhq';
            const savedOrder = lane === 'ai' && Array.isArray(saved?.aiOrder) && saved.aiOrder.length
                ? saved.aiOrder
                : lane === 'my' && Array.isArray(saved?.myOrder) && saved.myOrder.length
                    ? saved.myOrder
                    : null;
            if (!savedOrder || !savedOrder.length) return pool;
            const rank = new Map();
            savedOrder.forEach((pid, i) => rank.set(String(pid), i));
            const getRank = p => {
                if (rank.has(String(p.pid))) return rank.get(String(p.pid));
                if (p.csvPid && rank.has(String(p.csvPid))) return rank.get(String(p.csvPid));
                return Infinity;
            };
            const reordered = pool.slice().sort((a, b) => {
                const ra = getRank(a);
                const rb = getRank(b);
                if (ra !== rb) return ra - rb;
                return (b.dhq || 0) - (a.dhq || 0);
            });
            reordered.forEach((p, i) => { p.consensusRank = i + 1; });
            return reordered;
        } catch (e) {
            if (window.wrLog) window.wrLog('cc.bigboardOrder', e);
            return pool;
        }
    }

    function normalizeDraftName(name) {
        return (name || '').toLowerCase().replace(/[''`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
    }

    function formatTradeAssetPick(pick) {
        if (!pick) return '';
        return 'R' + pick.round + '.' + String(pick.slot || 0).padStart(2, '0');
    }

    function formatTradeAssetPlayer(pid) {
        const p = window.S?.players?.[pid] || {};
        const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        return full || pid;
    }

    function formatTradePackageSide(proposal, side) {
        const picks = side === 'my' ? (proposal?.myGive || []) : (proposal?.theirGive || []);
        const players = side === 'my' ? (proposal?.myGivePlayers || []) : (proposal?.theirGivePlayers || []);
        const faab = side === 'my' ? (proposal?.myGiveFaab || 0) : (proposal?.theirGiveFaab || 0);
        const items = [];
        picks.slice(0, 2).forEach(p => items.push(formatTradeAssetPick(p)));
        players.slice(0, 1).forEach(pid => items.push(formatTradeAssetPlayer(pid)));
        const displayedAssets = Math.min(2, picks.length) + Math.min(1, players.length);
        if (faab > 0) items.push('$' + faab + ' FAAB');
        const remaining = Math.max(0, picks.length + players.length - displayedAssets);
        if (remaining) items.push('+' + remaining);
        return items.length ? items.join(', ') : 'No assets';
    }

    function liveTradeTimingLabel(tradeWindow) {
        if (tradeWindow?.onClock) return 'On clock now';
        if (tradeWindow?.picksAway === 1) return 'Next pick';
        return (tradeWindow?.picksAway || 0) + ' picks away';
    }

    function describeLiveTradeWindow(tradeWindow) {
        const suggestion = tradeWindow?.suggestion || {};
        const proposal = suggestion.proposal || {};
        const give = formatTradePackageSide(proposal, 'my');
        const get = formatTradePackageSide(proposal, 'their');
        return liveTradeTimingLabel(tradeWindow) + ' at ' + tradeWindow.pickLabel + ': '
            + (suggestion.label || tradeWindow.motive || 'Trade window') + ' with ' + tradeWindow.teamName
            + '. Give ' + give + '; get ' + get + '. '
            + tradeWindow.likelihood + '% acceptance vs ' + tradeWindow.acceptanceLine + '% Buyer Line.';
    }

    function formatLiveClockTime(ts) {
        if (!ts) return 'not checked yet';
        try {
            return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
        } catch (_) {
            return 'recently';
        }
    }

    function sleeperDraftUrl(draftId) {
        return draftId ? 'https://sleeper.com/draft/nfl/' + draftId : '';
    }

    function detectSleeperDraftVariant(draft, currentLeague, fallback = 'startup') {
        try {
            return window.DraftCC?.state?.detectDraftVariant?.({
                currentLeague,
                draft,
                fallback,
            }) || fallback;
        } catch (_) {
            return fallback;
        }
    }

    function liveDraftSetupPatch(draft, currentLeague) {
        if (!draft?.draft_id) return {};
        const rounds = draft.settings?.rounds || 0;
        const variant = detectSleeperDraftVariant(draft, currentLeague);
        const patch = {
            sleeperDraftId: draft.draft_id,
            variant,
            liveDraftMeta: {
                draftId: draft.draft_id,
                status: draft.status || '',
                startTime: draft.start_time || null,
                type: draft.type || '',
                rounds,
                teams: draft.settings?.teams || 0,
                variant,
            },
        };
        if (rounds) patch.rounds = rounds;
        if (draft.settings?.teams) patch.leagueSize = draft.settings.teams;
        if (draft.type) patch.draftType = draft.type;
        return patch;
    }

    function pickLaunchableLiveDraft(drafts) {
        return (Array.isArray(drafts) ? drafts : [])
            .filter(d => d.status === 'drafting' || d.status === 'pre_draft')
            .sort((a, b) => {
                if (a.status !== b.status) return a.status === 'drafting' ? -1 : 1;
                return (a.start_time || Infinity) - (b.start_time || Infinity);
            })[0] || null;
    }

    function refreshRookieValuesFromEngine(saved, stateFns, playersData) {
        if (!saved || saved.variant !== 'rookie' || !stateFns?.buildPool) return saved;
        const freshPool = stateFns.buildPool({ variant: 'rookie', playersData, maxSize: 200 });
        if (!freshPool?.length) return saved;

        const byPid = new Map();
        const byCsvPid = new Map();
        const byName = new Map();
        freshPool.forEach(p => {
            byPid.set(String(p.pid), p);
            if (p.csvPid) byCsvPid.set(String(p.csvPid), p);
            byName.set(normalizeDraftName(p.name), p);
        });
        const findFresh = p => byPid.get(String(p?.pid)) || byCsvPid.get(String(p?.pid)) || byCsvPid.get(String(p?.csvPid)) || byName.get(normalizeDraftName(p?.name));
        const mergeFresh = p => {
            const fresh = findFresh(p);
            return fresh ? { ...p, ...fresh, reasoning: p.reasoning || fresh.reasoning, confidence: p.confidence || fresh.confidence } : p;
        };

        return {
            ...saved,
            pool: (saved.pool || []).map(mergeFresh).sort((a, b) => (b.dhq || 0) - (a.dhq || 0)),
            originalPool: freshPool.slice(),
            picks: (saved.picks || []).map(mergeFresh),
        };
    }

    function DraftCommandCenter({ playersData, myRoster, currentLeague, draftRounds: propRounds, forcedMode, autoStartLiveToken }) {
        const stateFns = window.DraftCC.state;

        // Phase 5+: mount-time fetch for the league's drafts so upcomingSettings
        // is populated even when window.S.drafts is empty (which is common —
        // the main app's Draft Room tab fetches it separately into draft-room.js).
        const [fetchedDrafts, setFetchedDrafts] = React.useState(null);
        const leagueIdForFetch = currentLeague?.league_id || currentLeague?.id;
        React.useEffect(() => {
            if (!leagueIdForFetch) return;
            let cancelled = false;
            const fn = window.Sleeper?.fetchDrafts || (async (lid) => {
                const resp = await fetch('https://api.sleeper.app/v1/league/' + lid + '/drafts');
                return resp.ok ? resp.json() : [];
            });
            fn(leagueIdForFetch).then(d => {
                if (!cancelled) setFetchedDrafts(Array.isArray(d) ? d : []);
            }).catch(() => { if (!cancelled) setFetchedDrafts([]); });
            return () => { cancelled = true; };
        }, [leagueIdForFetch]);

        // Default setup from real Sleeper draft data
        const draftMeta = React.useMemo(() => {
            const rosters = window.S?.rosters || currentLeague?.rosters || [];
            const users = window.S?.leagueUsers || currentLeague?.users || [];
            const myUid = window.S?.user?.user_id || '';
            const myRid = myRoster?.roster_id;
            const tradedPicks = window.S?.tradedPicks || [];
            const leagueSeason = String(currentLeague?.season || new Date().getFullYear());
            // Prefer mount-fetched drafts, then window.S cache, then currentLeague synthetic fallback
            const drafts = (fetchedDrafts && fetchedDrafts.length) ? fetchedDrafts : (window.S?.drafts || []);
            const upcoming = drafts.find(d => d.status === 'pre_draft')
                || drafts.find(d => d.status === 'drafting')
                || drafts[0];
            const sleeperOrder = upcoming?.draft_order || {};

            const slotToRoster = {};
            const hasRealDraftOrder = Object.keys(sleeperOrder).length > 0;
            if (hasRealDraftOrder) {
                Object.entries(sleeperOrder).forEach(([userId, slot]) => {
                    const roster = rosters.find(r => r.owner_id === userId);
                    const user = users.find(u => u.user_id === userId);
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                    slotToRoster[slot] = { rosterId: roster?.roster_id, ownerName: name, userId };
                });
            } else {
                const sorted = [...rosters].sort((a, b) => {
                    const wa = a.settings?.wins || 0;
                    const wb = b.settings?.wins || 0;
                    if (wa !== wb) return wa - wb;
                    return (a.settings?.fpts || 0) - (b.settings?.fpts || 0);
                });
                sorted.forEach((r, i) => {
                    const user = users.find(u => u.user_id === r.owner_id);
                    const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + (i + 1);
                    slotToRoster[i + 1] = { rosterId: r.roster_id, ownerName: name, userId: r.owner_id };
                });
            }

            // Compute total teams — prefer upcoming.settings.teams, then league settings, then roster count
            const fallbackTeams = (rosters.length) || 12;
            const totalTeams = (upcoming?.settings?.teams)
                || (currentLeague?.settings?.num_teams)
                || (window.S?.leagues?.[0]?.settings?.num_teams)
                || Math.max(Object.keys(slotToRoster).length, fallbackTeams);

            // Fill in any missing slots with remaining rosters (round-robin over
            // ghost/unmapped rosters). When draft_order is partial (e.g., only
            // the user is mapped), this keeps every slot populated so downstream
            // code like buildPickOrder + isUserTurn works correctly.
            const mappedRosterIds = new Set(Object.values(slotToRoster).map(e => e.rosterId).filter(Boolean));
            const unmappedRosters = rosters.filter(r => !mappedRosterIds.has(r.roster_id));
            let ghostIdx = 0;
            for (let slot = 1; slot <= totalTeams; slot++) {
                if (slotToRoster[slot]) continue;
                const r = unmappedRosters[ghostIdx++] || {};
                const user = r.owner_id ? users.find(u => u.user_id === r.owner_id) : null;
                const name = user?.metadata?.team_name || user?.display_name || user?.username || 'Team ' + slot;
                slotToRoster[slot] = {
                    rosterId: r.roster_id || null,
                    ownerName: name,
                    userId: r.owner_id || null,
                };
            }

            let mySlot = null;
            for (const [slot, info] of Object.entries(slotToRoster)) {
                if (info.userId === myUid || info.rosterId === myRid) {
                    mySlot = parseInt(slot, 10);
                    break;
                }
            }

            const numTeams = totalTeams;

            // If we couldn't find the user in the draft_order mapping (common in
            // demo/test leagues with unmapped users), force them into slot 1.
            if (!mySlot && myRid != null) {
                const forcedSlot = 1;
                mySlot = forcedSlot;
                slotToRoster[forcedSlot] = {
                    rosterId: myRid,
                    ownerName: 'YOU',
                    userId: myUid || null,
                };
            }

            // Build pick ownership (traded picks)
            const pickOwnership = {};
            for (let rd = 1; rd <= (propRounds || 5); rd++) {
                for (let slot = 1; slot <= numTeams; slot++) {
                    const origInfo = slotToRoster[slot] || {};
                    const origRid = origInfo.rosterId;
                    const traded = tradedPicks.find(tp =>
                        tp.round === rd && tp.roster_id === origRid &&
                        tp.owner_id !== origRid && String(tp.season) === leagueSeason
                    );
                    if (traded) {
                        const newOwner = rosters.find(r => r.roster_id === traded.owner_id);
                        const newUser = users.find(u => u.user_id === newOwner?.owner_id);
                        const newName = newUser?.metadata?.team_name || newUser?.display_name || 'Team';
                        pickOwnership[rd + '-' + slot] = {
                            ownerName: newName,
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

            // Phase 5+: surface the upcoming draft's full settings so Solo mode
            // defaults can match the league's scheduled draft. Prefer the real
            // draft object; fall back to currentLeague.settings which always
            // has draft_rounds + num_teams on a synced Sleeper league.
            const legacyLeagueSettings = currentLeague?.settings || window.S?.leagues?.[0]?.settings || {};
            const draftVariant = stateFns.detectDraftVariant
                ? stateFns.detectDraftVariant({ currentLeague, draft: upcoming, fallback: 'startup' })
                : detectSleeperDraftVariant(upcoming, currentLeague);
            const upcomingSettings = upcoming ? {
                draftId: upcoming.draft_id,
                rounds: upcoming.settings?.rounds || legacyLeagueSettings.draft_rounds || null,
                teams:  upcoming.settings?.teams  || legacyLeagueSettings.num_teams || null,
                type:   upcoming.type || null,
                variant: draftVariant,
                startTime: upcoming.start_time || null,
                status:  upcoming.status || null,
                season:  upcoming.season || null,
            } : (legacyLeagueSettings.draft_rounds || legacyLeagueSettings.num_teams ? {
                draftId: null,
                rounds: legacyLeagueSettings.draft_rounds || null,
                teams:  legacyLeagueSettings.num_teams || null,
                type:   null,
                variant: draftVariant,
                startTime: null,
                status:  null,
                season:  null,
            } : null);

            return {
                mySlot: mySlot || Math.min(6, numTeams),
                slotToRoster,
                pickOwnership,
                numTeams,
                draftType: upcoming?.type || 'snake',
                draftVariant,
                upcomingSettings,
            };
        }, [myRoster, currentLeague, propRounds, fetchedDrafts]);

        // Reducer + initial state (load from localStorage if possible)
        const [state, dispatch] = React.useReducer(
            stateFns.reducer,
            null,
            () => {
                let saved = stateFns.loadFromLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
                if (saved && saved.phase !== 'setup') {
                    saved = refreshRookieValuesFromEngine(saved, stateFns, playersData);
                    // Recompose personas — we strip them on save, so rehydrate from the live DNA map
                    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                    let draftDnaMap = {};
                    try {
                        if (window.DraftHistory?.loadDraftDNA) {
                            draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                        }
                    } catch (e) {}
                    saved.personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);
	                    // Old saves stripped originalPool; new saves preserve it.
	                    if (!saved.originalPool || !saved.originalPool.length) {
	                        saved.originalPool = saved.pool.slice();
	                    }
	                    const historicalTradeSignal = window.DraftCC.tradeSimulator?.historicalDraftPickTradeSignal?.({
	                        ...saved,
	                        leagueId,
	                        draftContext: saved.draftContext || { tradedPicks: window.S?.tradedPicks || [] },
	                        tradedPicks: window.S?.tradedPicks || [],
	                    });
	                    if (historicalTradeSignal && historicalTradeSignal.activity <= 0 && saved.activeOffer && saved.activeOffer.cpuInitiated !== false) {
	                        const resumeSpeed = saved.activeOffer?.resumeSpeed || 'normal';
	                        saved.activeOffer = null;
	                        if (saved.speed === 'paused') saved.speed = resumeSpeed;
	                    }
	                    // Re-apply the user's custom Big Board order on resume so changes
                    // to the board since the draft was saved are reflected immediately.
                    saved.pool = applyUserBigBoardOrder(saved.pool, leagueId, saved.variant);
                    return saved;
                }
                // Phase 5+: prefer the league's scheduled upcoming draft settings
                // so Solo defaults match whatever's actually scheduled in Sleeper.
                const upcoming = draftMeta.upcomingSettings;
                const initial = stateFns.initialDraftState({
                    leagueId: currentLeague?.league_id || currentLeague?.id || '',
                    season: currentLeague?.season,
                    rounds: upcoming?.rounds || propRounds || 5,
                    leagueSize: upcoming?.teams || draftMeta.numTeams,
                    draftType: upcoming?.type || draftMeta.draftType || 'snake',
                    variant: upcoming?.variant || draftMeta.draftVariant || 'startup',
                    userRosterId: myRoster?.roster_id,
                    userSlot: draftMeta.mySlot,
                    // Honor forced mode (e.g., live-sync from the Follow Live Draft tab)
                    mode: forcedMode || 'solo',
                });
                const learning = !forcedMode && stateFns.buildRecapLearningDefaults
                    ? stateFns.buildRecapLearningDefaults(initial.leagueId, {
                        variant: initial.variant,
                        baseTuning: initial.draftTuning,
                    })
                    : null;
                const strategyProfile = stateFns.loadDraftStrategyProfile
                    ? stateFns.loadDraftStrategyProfile(initial.leagueId, {
                        variant: initial.variant,
                        baseTuning: learning?.suggestedTuning || initial.draftTuning,
                        recapLearning: learning,
                    })
                    : null;
                const draftTuning = strategyProfile?.tuning
                    ? stateFns.applyDraftStrategyProfileToTuning?.(strategyProfile, learning?.suggestedTuning || initial.draftTuning) || strategyProfile.tuning
                    : (learning?.suggestedTuning || initial.draftTuning);
                return {
                    ...initial,
                    draftTuning,
                    recapLearning: learning,
                    strategyProfile,
                };
            }
        );

        // Resume banner is only shown when we're still in setup phase but have a saved draft
        const [showResume, setShowResume] = React.useState(false);

        // Phase 5+: sync setup defaults when draftMeta updates post-mount (e.g.
        // after the async Sleeper drafts fetch resolves). Only applies during
        // setup phase — we don't want to clobber an in-progress draft.
        const draftMetaSignature = draftMeta.mySlot + '|' + draftMeta.numTeams + '|' + (draftMeta.upcomingSettings?.rounds || '') + '|' + (draftMeta.upcomingSettings?.type || '') + '|' + (draftMeta.upcomingSettings?.variant || draftMeta.draftVariant || '');
        React.useEffect(() => {
            // Only sync when we're in setup — drafting/complete phases are locked in
            if (state.phase !== 'setup') return;
            const upcoming = draftMeta.upcomingSettings;
            const patch = {};
            if (draftMeta.mySlot && state.userSlot !== draftMeta.mySlot) patch.userSlot = draftMeta.mySlot;
            if (draftMeta.numTeams && state.leagueSize !== draftMeta.numTeams) patch.leagueSize = draftMeta.numTeams;
            if (upcoming?.rounds && state.rounds !== upcoming.rounds) patch.rounds = upcoming.rounds;
            if (upcoming?.type && state.draftType !== upcoming.type) patch.draftType = upcoming.type;
            if (upcoming?.variant && state.variant === 'startup' && state.variant !== upcoming.variant) patch.variant = upcoming.variant;
            if (Object.keys(patch).length) {
                dispatch({ type: 'SETUP_CHANGE', payload: patch });
            }
        }, [draftMetaSignature, state.phase]);

        const [viewport, setViewport] = React.useState(() => bpBucket());
        React.useEffect(() => {
            const onResize = () => setViewport(bpBucket());
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }, []);

        // Wait for CSV prospects to load (for rookie variant)
        const [csvReady, setCsvReady] = React.useState(window.DraftCC.scouting?.isLoaded || false);
        React.useEffect(() => {
            if (csvReady) return;
            let cancelled = false;
            window.DraftCC.scouting?.ready?.then(() => {
                if (!cancelled) setCsvReady(true);
            });
            return () => { cancelled = true; };
        }, [csvReady]);

        // Auto-save to localStorage (debounced 500ms)
        const saveTimerRef = React.useRef(null);
        React.useEffect(() => {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            saveTimerRef.current = setTimeout(() => {
                stateFns.saveToLocal(state, forcedMode);
            }, 500);
            return () => clearTimeout(saveTimerRef.current);
        }, [state]);

        // Current slot + whose turn is it
        // isUserTurn prefers rosterId match (post-trade ownership), but falls back
        // to teamIdx match for leagues where rosterId is null (e.g., unmapped slots).
        const currentSlot = state.pickOrder[state.currentIdx] || null;
        const liveStateRef = React.useRef(state);
        React.useEffect(() => {
            liveStateRef.current = state;
        }, [state]);
        const userIdx = (state.userSlot || 1) - 1;
        // In mock modes the user picks their slot via the dropdown, which doesn't
        // rewrite pickOrder rosterIds — the slot they picked still has some ghost
        // roster's ID. Match on slot number in those modes so the DRAFT button shows.
        const isMockMode = state.mode !== 'live-sync';
        const isUserTurn = state.phase === 'drafting' && !!currentSlot && (
            currentSlot.rosterId === state.userRosterId ||
            (isMockMode && currentSlot.slot === state.userSlot) ||
            (currentSlot.rosterId == null && currentSlot.teamIdx === userIdx)
        );
        const isDone = state.phase === 'complete';

        // CPU auto-pick loop
        const cpuTimerRef = React.useRef(null);
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
            if (state.mode === 'live-sync') return; // Live sync: picks come from Sleeper poll, not AI
            if (state.mode === 'manual') return; // Manual mode: user records every pick
            if (state.activeOffer) return;
            if (isUserTurn) return;
            if (isDone) return;
            if (state.speed === 'paused') return;
            if (state.overrideMode) return; // User is manually picking for the CPU team

            const delay = SpeedMap[state.speed] ?? 700;
            cpuTimerRef.current = setTimeout(() => {
                const slot = state.pickOrder[state.currentIdx];
                if (!slot || slot.rosterId === state.userRosterId) return;

                // Phase 5: Ghost replay mode — use historical pick instead of AI
                if (state.mode === 'ghost' && state.replay && state.replay.replayPicks) {
                    const replayPick = state.replay.replayPicks[state.currentIdx];
                    if (replayPick) {
                        dispatch({
                            type: 'MAKE_PICK',
                            player: {
                                pid: replayPick.pid,
                                name: replayPick.name,
                                pos: replayPick.pos,
                                dhq: replayPick.dhq,
                                photoUrl: replayPick.photoUrl,
                                college: replayPick.college,
                            },
                            isUser: false,
                            reasoning: replayPick.reasoning,
                            confidence: 1.0,
                        });
                        return;
                    }
                }

                const persona = state.personas?.[slot.rosterId] || null;
                const teamRoster = state.teamRosters?.[slot.teamIdx] || [];
                let pick = null;
                let reasoning = null;
                let confidence = null;
                try {
                    if (persona && window.DraftCC.cpuEngine) {
                        // Phase 1 deferred: inject GM mode weights into draft context so downstream
                        // MockEngine logic can bias BPA / youth / need per the user's chosen mode.
                        const gmCtx = (function () {
                            try {
                                const leagueId = (state.leagueId || window.S?.leagues?.[0]?.league_id);
                                const desc = window.WR?.GmMode?.describe?.(window.WR.GmMode.getMode(leagueId));
                                return desc ? { gmMode: desc.id, draftWeights: desc.draftWeights } : {};
                            } catch (_) { return {}; }
                        })();
                        const draftCtx = state.draftContext || null;
                        const result = window.DraftCC.cpuEngine.personaPick(
                            persona,
                            state.pool,
                            slot.round,
                            slot.overall,
                            Object.assign({
                                teamRoster,
                                draftTuning: state.draftTuning,
                                draftContext: draftCtx,
                                boardContext: draftCtx?.boardContext || null,
                                ownerIntel: persona?.ownerIntel || draftCtx?.ownerContext?.[String(slot.rosterId)] || null,
                            }, gmCtx)
                        );
                        if (result) {
                            pick = result.player;
                            reasoning = result.reasoning;
                            confidence = result.confidence;
                        }
                    }
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.cpuPick', e);
                }

                // Fallback: best DHQ
                if (!pick && state.pool.length) {
                    pick = state.pool[0];
                    reasoning = { primary: 'BPA fallback', baseVal: pick.dhq, nudges: [] };
                }

                if (pick) {
                    dispatch({ type: 'MAKE_PICK', player: pick, isUser: false, reasoning, confidence });
                }
            }, delay);

            return () => clearTimeout(cpuTimerRef.current);
        }, [state.phase, state.currentIdx, state.speed, state.mode, state.overrideMode, isUserTurn, isDone]);

        // ── Phase 3: CPU trade offer generation ──────────────────────
        // After each completed pick, roll for a trade offer. Cooldown prevents spam.
        const lastOfferIdxRef = React.useRef(-Infinity);
        const lastPickCountRef = React.useRef(0);
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
            if (state.mode === 'live-sync' || state.mode === 'manual') return;
            if (state.activeOffer) return;            // don't stack offers
            if (state.proposerDrawer) return;         // user is building their own
            if (state.picks.length === lastPickCountRef.current) return;
            lastPickCountRef.current = state.picks.length;

            const lastPick = state.picks[state.picks.length - 1];
            if (!lastPick || lastPick.isUser) return; // only after CPU picks

            // Small delay so the UI breathes between pick + offer
            const t = setTimeout(() => {
                try {
                    const offer = window.DraftCC.tradeSimulator?.maybeGenerateTradeOffer(
                        state,
                        lastPick.rosterId,
                        { lastOfferPickIdx: lastOfferIdxRef.current }
                    );
                    if (offer) {
                        lastOfferIdxRef.current = state.currentIdx;
                        dispatch({ type: 'OFFER_TRADE', offer });
                    }
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.tradeGen', e);
                }
            }, 300);

            return () => clearTimeout(t);
        }, [state.currentIdx, state.phase, state.mode, state.activeOffer, state.proposerDrawer]);

        // ── Phase 5: Live Sync polling loop ─────────────────────────
        // When mode==='live-sync' and phase==='drafting', start polling the
        // Sleeper draft every 5s. Each new pick is converted to our state.pick
        // shape and dispatched as MAKE_PICK so the rest of the pipeline (grid,
        // Alex stream, reach/steal detection) reacts normally.
        //
        // Strictly read-only — never writes picks back to Sleeper.
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            if (state.phase !== 'drafting') return;
            if (!state.sleeperDraftId) return;
            if (!window.DraftCC.liveSync) return;

            const normPos = window.App?.normPos || (p => p);
            const getDHQ = (pid) => window.App?.LI?.playerScores?.[pid] || 0;

            const initialPickNo = Math.max(
                Number(state.liveSync?.lastPickNo || 0),
                Number(state.currentIdx || 0)
            );
            const seenPickKeys = (state.picks || [])
                .map(p => p.sleeperPickNo ? ('no:' + p.sleeperPickNo) : null)
                .filter(Boolean);

            window.DraftCC.liveSync.start(state.sleeperDraftId, (sleeperPicks, snapshot) => {
                const active = liveStateRef.current || state;
                const activePlayersData = window.S?.players || {};
                const mapped = (sleeperPicks || []).map(sleeperPick => {
                    const pid = sleeperPick.player_id;
                    const p = activePlayersData[pid] || {};
                    const poolMatch = (active.pool || []).find(x => String(x.pid) === String(pid))
                        || (active.originalPool || []).find(x => String(x.pid) === String(pid));
                    const player = {
                        pid,
                        name: poolMatch?.name || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown',
                        pos: poolMatch?.pos || normPos(p.position) || p.position || '?',
                        dhq: poolMatch?.dhq || getDHQ(pid),
                        consensusRank: poolMatch?.consensusRank || null,
                        photoUrl: poolMatch?.photoUrl || ('https://sleepercdn.com/content/nfl/players/thumb/' + pid + '.jpg'),
                        college: poolMatch?.college || p.college || '',
                        tier: poolMatch?.tier || null,
                        csv: poolMatch?.csv || null,
                    };
                    return {
                        sleeperPick,
                        player,
                        reasoning: { primary: 'Live Sleeper pick', baseVal: player.dhq, nudges: [] },
                        confidence: 1.0,
                    };
                });
                const staleReason = window.DraftCC.liveSync?._private?.liveSyncStaleReason
                    ? window.DraftCC.liveSync._private.liveSyncStaleReason(snapshot)
                    : null;
                dispatch({
                    type: 'APPLY_LIVE_SYNC_PICKS',
                    picks: mapped,
                    status: {
                        status: staleReason
                            ? 'stale'
                            : snapshot?.draftStatus === 'complete'
                                ? 'complete'
                                : 'mirroring',
                        draftStatus: snapshot?.draftStatus || '',
                        remotePickCount: snapshot?.remotePickCount || 0,
                        lastPickNo: snapshot?.lastPickNo || initialPickNo,
                        remoteMaxPickNo: snapshot?.remoteMaxPickNo || 0,
                        duplicateCount: snapshot?.duplicateCount || 0,
                        missedPickCount: snapshot?.gapCount || 0,
                        missingPickNos: snapshot?.missingPickNos || [],
                        conflictCount: snapshot?.conflictCount || 0,
                        conflictPickNos: snapshot?.conflictPickNos || [],
                        invalidPickCount: snapshot?.invalidPickCount || 0,
                        remoteBehind: !!snapshot?.remoteBehind,
                        lastPollAt: Date.now(),
                        stale: !!staleReason,
                        error: staleReason,
                    },
                });
            }, {
                initialPickNo,
                seenPickKeys,
                onStatus: status => dispatch({ type: 'LIVE_SYNC_STATUS', payload: status }),
            });

            return () => {
                if (window.DraftCC.liveSync?.isRunning?.()) {
                    window.DraftCC.liveSync.stop();
                }
            };
        }, [state.mode, state.phase, state.sleeperDraftId, state.userRosterId]);

        // ── Live-Sync variant auto-correction ──────────────────────────
        // When resuming a live-sync draft, the saved state's `variant` can be
        // stale if the user started it before we auto-detected Sleeper draft
        // variants. Fetch the Sleeper draft meta once and rebuild only before
        // any picks have been dispatched.
        //
        // Only rebuilds when picks.length === 0 — we refuse to clobber a pool
        // that already has picks dispatched against it.
        const variantFixedRef = React.useRef(false);
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            if (!state.sleeperDraftId) return;
            if (state.phase === 'setup') return;
            if (variantFixedRef.current) return;
            variantFixedRef.current = true;

            (async () => {
                try {
                    const resp = await fetch('https://api.sleeper.app/v1/draft/' + state.sleeperDraftId);
                    if (!resp.ok) return;
                    const meta = await resp.json();
                    const detectedVariant = stateFns.detectDraftVariant
                        ? stateFns.detectDraftVariant({ currentLeague, draft: meta, fallback: state.variant || 'startup' })
                        : detectSleeperDraftVariant(meta, currentLeague, state.variant || 'startup');
                    if (!detectedVariant || state.variant === detectedVariant) return;
                    if (state.picks && state.picks.length > 0) {
                        if (window.wrLog) window.wrLog('cc.variantMismatch', { sleeperDraftId: state.sleeperDraftId, saved: state.variant, detected: detectedVariant, picks: state.picks.length });
                        return;
                    }
                    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                    const totalPicks = Number(state.rounds || meta?.settings?.rounds || 0) * Number(state.leagueSize || meta?.settings?.teams || 0);
                    const maxPoolSize = detectedVariant === 'redraft'
                        ? Math.max(300, totalPicks + 80)
                        : 200;
                    let newPool = stateFns.buildPool({ variant: detectedVariant, playersData, maxSize: maxPoolSize });
                    newPool = applyUserBigBoardOrder(newPool, leagueId, detectedVariant);
                    dispatch({ type: 'SETUP_CHANGE', payload: { variant: detectedVariant, pool: newPool, originalPool: newPool.slice() } });
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.variantAutoCorrect', e);
                }
            })();
        }, [state.mode, state.sleeperDraftId, state.phase]);

        // ── Phase 4: Alex AI trigger effects ────────────────────────
        // Fires rule-based events (always free) and Sonnet AI events (budget-limited)
        // after each completed pick. Triggers: R1 pick, user pick, reach/steal, round change.
        const lastAlexPickCountRef = React.useRef(0);
        const lastAlexRoundRef = React.useRef(0);
        const alexSonnetCooldownRef = React.useRef(0);
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
            if (state.picks.length === lastAlexPickCountRef.current) return;
            const prevCount = lastAlexPickCountRef.current;
            lastAlexPickCountRef.current = state.picks.length;

            const lastPick = state.picks[state.picks.length - 1];
            if (!lastPick) return;
            const projectedAlexRead = lastPick.alexCommentary?.streamText || lastPick.reasoning?.alexCommentary?.streamText || '';

            // Round change banner (rule-triggered, free)
            if (lastPick.round !== lastAlexRoundRef.current && lastAlexRoundRef.current > 0) {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: 'R',
                        color: 'var(--gold)',
                        title: 'Round ' + lastPick.round + ' begins',
                        text: state.pickOrder.length - state.currentIdx + ' picks remain.',
                        relatedPickNo: lastPick.overall,
                    },
                });
            }
            lastAlexRoundRef.current = lastPick.round;

            // Pick line (rule-triggered, free) — every pick gets a line
            dispatch({
                type: 'ALEX_EVENT_ADD',
                event: {
                    type: projectedAlexRead ? 'ai' : (lastPick.isUser ? 'user' : 'rule'),
                    badge: projectedAlexRead ? 'A' : (lastPick.isUser ? '★' : '•'),
                    color: projectedAlexRead ? 'var(--gold)' : (lastPick.isUser ? 'var(--gold)' : 'var(--silver)'),
                    title: projectedAlexRead
                        ? 'Alex read · R' + lastPick.round + '.' + String(lastPick.slot).padStart(2, '0') + ' · ' + lastPick.name
                        : 'R' + lastPick.round + '.' + String(lastPick.slot).padStart(2, '0') + ' · ' + lastPick.name,
                    text: projectedAlexRead || ((lastPick.isUser ? 'You selected ' : '') + lastPick.pos + (lastPick.dhq > 0 ? ' · ' + lastPick.dhq.toLocaleString() + ' DHQ' : '')),
                    relatedPickNo: lastPick.overall,
                },
            });

            // Reach/steal detection (rule-triggered, free)
            if (lastPick.consensusRank && Math.abs(lastPick.overall - lastPick.consensusRank) > 8) {
                const isSteal = lastPick.overall > lastPick.consensusRank;
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: isSteal ? '↓' : '↑',
                        color: isSteal ? '#2ECC71' : '#E74C3C',
                        title: (isSteal ? 'STEAL' : 'REACH') + ' · ' + lastPick.name,
                        text: lastPick.pos + ' taken at pick #' + lastPick.overall + ' vs. consensus #' + Math.round(lastPick.consensusRank),
                        relatedPickNo: lastPick.overall,
                    },
                });
            }

            // Sonnet AI event (budget-limited)
            // Triggers: R1 pick, user pick, reach beyond threshold
            // Throttle: at most once per 3 picks
            const sonnetUsed = state.alex.alexSpend.sonnet || 0;
            const budget = state.alex.alexSpend.budget || 12;
            const shouldFireAI =
                sonnetUsed < budget &&
                (state.currentIdx - alexSonnetCooldownRef.current >= 3 || lastPick.isUser) &&
                (
                    lastPick.round === 1 ||              // R1 pick
                    lastPick.isUser ||                   // user's own pick
                    (lastPick.consensusRank && Math.abs(lastPick.overall - lastPick.consensusRank) > 10)  // big reach/steal
                );

            if (shouldFireAI && typeof window.dhqAI === 'function') {
                alexSonnetCooldownRef.current = state.currentIdx;
                const persona = state.personas?.[lastPick.rosterId];
                const reasoning = lastPick.reasoning || {};
                const nudgesText = (reasoning.nudges || []).slice(0, 3).map(n => n.name + ' ' + (n.pct >= 0 ? '+' : '') + n.pct + '%').join(', ');
                const userPersona = state.personas?.[state.userRosterId];
                const ownerIntelText = window.DraftCC?.context?.summarizeOwnerIntel
                    ? window.DraftCC.context.summarizeOwnerIntel(persona?.ownerIntel || state.draftContext?.ownerContext?.[String(lastPick.rosterId)])
                    : '';
                const contextLines = [
                    `Draft pick: ${lastPick.name} (${lastPick.pos}) at R${lastPick.round}.${String(lastPick.slot).padStart(2, '0')}, overall #${lastPick.overall}.`,
                    `By: ${persona?.teamName || 'Team ' + lastPick.teamIdx}, DNA: ${persona?.draftDna?.label || '—'}, Trade DNA: ${persona?.tradeDna?.label || '—'}, Posture: ${persona?.posture?.label || '—'}.`,
                    ownerIntelText ? `Owner intel: ${ownerIntelText}.` : '',
                    nudgesText ? `Picker reasoning: ${nudgesText}.` : '',
                    lastPick.isUser ? `THIS IS THE USER'S OWN PICK. Grade it for them honestly.` : '',
                    userPersona ? `User's team needs: ${(userPersona.assessment?.needs || []).slice(0, 3).map(n => typeof n === 'string' ? n : n?.pos).join(', ')}.` : '',
                ].filter(Boolean).join(' ');

                dispatch({ type: 'ALEX_SET_THINKING', thinking: true });
                dispatch({ type: 'ALEX_SPEND_SONNET' });

                const prompt = lastPick.isUser
                    ? `React to the user's draft pick in 1-2 sentences. Be Alex the draft analyst — direct, punchy, in character. Say if it's a good fit, a reach, or a steal. Context: ${contextLines}`
                    : `React to this draft pick in 1-2 sentences as Alex the draft analyst. Tell the user what this pick reveals about the opposing team's strategy. Context: ${contextLines}`;

                const messages = [{ role: 'user', content: prompt }];
                window.dhqAI('pick-analysis', prompt, contextLines, { messages })
                    .then(response => {
                        const replyText = typeof response === 'string' ? response : (response?.content || response?.text || '');
                        if (!replyText) return;
                        dispatch({
                            type: 'ALEX_EVENT_ADD',
                            event: {
                                type: 'ai',
                                badge: '✦',
                                color: 'var(--gold)',
                                title: lastPick.isUser ? 'Alex grades your pick' : 'Alex · ' + (persona?.teamName || 'CPU') + ' take',
                                text: replyText.slice(0, 350),
                                relatedPickNo: lastPick.overall,
                            },
                        });
                    })
                    .catch(e => {
                        if (window.wrLog) window.wrLog('alex.pickAnalysis', e);
                    })
                    .finally(() => {
                        dispatch({ type: 'ALEX_SET_THINKING', thinking: false });
                    });
            }
        }, [state.picks.length, state.phase]);

        // ── P2E: Live trade-window readout ─────────────────────────────
        // Live drafts stay read-only, but Alex should still flag actionable
        // windows based on owner intel, remaining picks, and buyer-line odds.
        const liveTradeAlertRef = React.useRef('');
        React.useEffect(() => {
            if (state.mode !== 'live-sync') return;
            if (state.phase !== 'drafting') return;
            const windows = window.DraftCC.tradeSimulator?.buildLiveTradeWindows?.(state, { lookahead: 5 }) || [];
            const best = windows[0];
            if (!best) return;
            const alertFloor = Math.max((best.acceptanceLine || 70) - 8, best.suggestion?.evaluation?.counterLine || 0);
            if ((best.likelihood || 0) < alertFloor) return;
            const key = [state.currentIdx, best.rosterId, best.suggestion?.id].join(':');
            if (liveTradeAlertRef.current === key) return;
            liveTradeAlertRef.current = key;

            const clears = best.likelihood >= best.acceptanceLine;
            dispatch({
                type: 'ALEX_EVENT_ADD',
                event: {
                    type: 'rule',
                    badge: 'T',
                    color: clears ? '#2ECC71' : 'var(--gold)',
                    title: 'Live trade window · ' + best.teamName,
                    text: describeLiveTradeWindow(best) + ' ' + (clears ? 'This clears their line.' : 'This is close enough to stage before the room moves.'),
                    relatedPickNo: best.overall || null,
                },
            });
        }, [state.mode, state.phase, state.currentIdx, state.pickOrder, state.personas, state.tradedAssets, state.draftTuning, state.picks.length]);

        // ── Actions ──────────────────────────────────────────────────
        const onStartDraft = React.useCallback(async (override = null) => {
            const overridePatch = override && typeof override === 'object' && !override.nativeEvent && !override.preventDefault
                ? override
                : null;
            const activeState = overridePatch ? { ...state, ...overridePatch } : state;
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            const recapLearning = stateFns.buildRecapLearningDefaults
                ? stateFns.buildRecapLearningDefaults(leagueId, {
                    variant: activeState.variant,
                    baseTuning: activeState.draftTuning,
                })
                : null;
            const activeStrategyProfile = activeState.strategyProfile || (stateFns.loadDraftStrategyProfile
                ? stateFns.loadDraftStrategyProfile(leagueId, {
                    variant: activeState.variant,
                    baseTuning: recapLearning?.suggestedTuning || activeState.draftTuning,
                    recapLearning,
                })
                : null);
            const learnedTuning = activeStrategyProfile?.tuning
                ? (stateFns.applyDraftStrategyProfileToTuning?.(activeStrategyProfile, activeState.draftTuning) || activeStrategyProfile.tuning)
                : (recapLearning?.sampleSize ? (recapLearning.suggestedTuning || activeState.draftTuning) : activeState.draftTuning);

            const totalPicks = Number(activeState.rounds || 0) * Number(activeState.leagueSize || 0);
            const maxPoolSize = activeState.variant === 'redraft'
                ? Math.max(300, totalPicks + 80)
                : 200;
            let pool = stateFns.buildPool({
                variant: activeState.variant,
                playersData,
                maxSize: maxPoolSize,
            });
            pool = applyUserBigBoardOrder(pool, leagueId, activeState.variant);
            const originalPool = pool.slice();
            let pickOrder = stateFns.buildPickOrder(
                activeState.rounds,
                activeState.leagueSize,
                activeState.draftType,
                draftMeta.slotToRoster,
                draftMeta.pickOwnership
            );
            if (activeState.mode !== 'live-sync' && activeState.userRosterId != null) {
                const selectedSlotInfo = draftMeta.slotToRoster?.[activeState.userSlot] || {};
                pickOrder = pickOrder.map(p => {
                    if (p.slot === activeState.userSlot) {
                        return { ...p, rosterId: activeState.userRosterId, ownerName: 'YOU', traded: p.traded };
                    }
                    if (draftMeta.mySlot && p.slot === draftMeta.mySlot && draftMeta.mySlot !== activeState.userSlot) {
                        return {
                            ...p,
                            rosterId: selectedSlotInfo.rosterId || p.rosterId,
                            ownerName: selectedSlotInfo.ownerName || p.ownerName,
                        };
                    }
                    return p;
                });
            }

            // Compose personas
            let draftDnaMap = {};
            try {
                if (window.DraftHistory?.loadDraftDNA) {
                    draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                }
            } catch (e) {}
            const personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);

            // P2: analyst projected mock scenario handoff. Stages projected
            // picks before the user's first turn so they can rehearse the room.
            let prePicks = [];
            let narrative = null;
            if (activeState.mode === 'scenario' && activeState.analystScenario?.picks?.length && window.DraftCC.analystMock?.applyProjectedScenario) {
                const result = window.DraftCC.analystMock.applyProjectedScenario(activeState, pool, pickOrder, activeState.analystScenario);
                if (result) {
                    pool = result.pool;
                    pickOrder = result.pickOrder;
                    prePicks = result.prePicks || [];
                    narrative = result.narrative;
                }
            } else if (activeState.mode === 'scenario' && activeState.scenarioId) {
                const result = window.DraftCC.scenarios?.applyScenario(activeState, pool, pickOrder, activeState.scenarioId);
                if (result) {
                    pool = result.pool;
                    pickOrder = result.pickOrder;
                    prePicks = result.prePicks || [];
                    narrative = result.narrative;
                }
            }

            // Phase 5: ghost replay — fetch picks and stage them
            let replay = null;
            if (activeState.mode === 'ghost') {
                if (!activeState.sleeperDraftId) {
                    alert('Ghost Replay mode requires selecting a draft from the Replay Source list.');
                    return;
                }
                try {
                    const sleeperPicks = await window.DraftCC.ghostReplay.loadReplayPicks(activeState.sleeperDraftId);
                    if (sleeperPicks.length) {
                        replay = window.DraftCC.ghostReplay.buildReplayState(activeState, sleeperPicks);
                        narrative = '👻 GHOST REPLAY · ' + sleeperPicks.length + ' picks loaded. Use the scrubber to time-travel.';
                    } else {
                        alert('The selected draft has no picks yet — nothing to replay. Pick a completed draft, or try Live Sync mode for a draft in progress.');
                        return;
                    }
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.ghostLoad', e);
                    alert('Failed to fetch draft picks from Sleeper: ' + (e?.message || 'unknown error'));
                    return;
                }
            }

            // Phase 5: live sync — validate that a draft was picked
            let liveDraftStatus = '';
            if (activeState.mode === 'live-sync') {
                if (!activeState.sleeperDraftId) {
                    alert('Live Sync mode requires selecting an upcoming or in-progress draft from the Live Sync Source list.');
                    return;
                }
                liveDraftStatus = activeState.liveDraftMeta?.status || '';
                narrative = liveDraftStatus === 'pre_draft'
                    ? '📡 LIVE SYNC · Waiting room open. War Room will mirror Sleeper as soon as picks begin.'
                    : '📡 LIVE SYNC · Mirroring draft from Sleeper every 5s. Read-only — no picks are sent back.';
            }

            const draftContext = window.DraftCC?.context?.buildDraftContext
                ? window.DraftCC.context.buildDraftContext({
                    state: {
                        ...activeState,
                        phase: 'drafting',
                        pool,
                        pickOrder,
                        personas,
                        picks: prePicks,
                        currentIdx: prePicks.length,
                        draftTuning: learnedTuning,
                        recapLearning,
                        strategyProfile: activeStrategyProfile,
                    },
                    currentLeague,
                    myRoster,
                    playersData,
                    pool,
                    pickOrder,
                    personas,
                    draftMeta,
                })
                : null;

            dispatch({
                type: 'START_DRAFT',
                pool,
                pickOrder,
                personas,
                draftContext,
                originalPool,
                draftTuning: learnedTuning,
                recapLearning,
                strategyProfile: activeStrategyProfile,
                prePicks,
                narrative,
                replay,
                liveDraftStatus,
                setupPatch: overridePatch || null,
            });

            // Phase 2: async DraftHistory sync (mirrors Scout draft-ui.js:1977)
            if (window.DraftHistory?.syncDraftDNA && leagueId) {
                window.DraftHistory.syncDraftDNA(leagueId).then(map => {
                    if (!map) return;
                    const normalize = window.DraftCC.persona.normalizeDraftDna;
                    const payload = {};
                    Object.entries(map).forEach(([rid, raw]) => {
                        payload[rid] = normalize(raw);
                    });
                    dispatch({ type: 'MERGE_DRAFT_DNA', payload });
                }).catch(() => { /* ok, fallback persists */ });
            }
        }, [
            state.variant,
            state.rounds,
            state.leagueSize,
            state.draftType,
            state.userRosterId,
            state.userSlot,
            state.mode,
            state.scenarioId,
            state.sleeperDraftId,
            state.draftTuning,
            state.strategyProfile,
            state.analystScenario,
            draftMeta,
            playersData,
            currentLeague,
        ]);

        const liveAutoStartedRef = React.useRef('');
        React.useEffect(() => {
            if (forcedMode !== 'live-sync') return;
            if (!autoStartLiveToken) return;
            if (state.phase !== 'setup') return;
            if (!Array.isArray(fetchedDrafts)) return;
            let cancelled = false;
            const launch = async () => {
                let liveDraft = pickLaunchableLiveDraft(fetchedDrafts);
                if (!liveDraft && leagueIdForFetch && window.DraftCC?.ghostReplay?.listLeagueChainDrafts) {
                    try {
                        liveDraft = pickLaunchableLiveDraft(await window.DraftCC.ghostReplay.listLeagueChainDrafts(leagueIdForFetch));
                    } catch (_) {}
                }
                if (cancelled || !liveDraft?.draft_id) return;
                const key = autoStartLiveToken + ':' + liveDraft.draft_id;
                if (liveAutoStartedRef.current === key) return;
                liveAutoStartedRef.current = key;
                const patch = liveDraftSetupPatch(liveDraft, currentLeague);
                dispatch({ type: 'SETUP_CHANGE', payload: patch });
                onStartDraft(patch);
            };
            launch();
            return () => { cancelled = true; };
        }, [forcedMode, autoStartLiveToken, state.phase, fetchedDrafts, leagueIdForFetch, onStartDraft]);

        // ── Phase 2: predictions refresh ────────────────────────────
        // Recompute willReach / willPassOn / likelyPick for every persona
        // at the start of each round. Cached per round in draftState.personas[rid].predictions.
        const lastPredRoundRef = React.useRef(-1);
        const personaSignature = Object.keys(state.personas || {}).length;
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
            if (!currentSlot) return;
            const round = currentSlot.round;
            if (round === lastPredRoundRef.current) return;
            if (!personaSignature) return;

            lastPredRoundRef.current = round;
            const payload = {};
            Object.entries(state.personas).forEach(([rid, persona]) => {
                try {
                    const draftCtx = state.draftContext || null;
                    const preds = window.DraftCC.cpuEngine.computePredictions(
                        persona,
                        state.pool,
                        round,
                        currentSlot.overall,
                        {
                            draftTuning: state.draftTuning,
                            draftContext: draftCtx,
                            boardContext: draftCtx?.boardContext || null,
                            ownerIntel: persona?.ownerIntel || draftCtx?.ownerContext?.[String(rid)] || null,
                        }
                    );
                    payload[rid] = preds;
                } catch (e) {
                    if (window.wrLog) window.wrLog('cc.computePreds', e);
                }
            });
            if (Object.keys(payload).length) {
                dispatch({ type: 'UPDATE_PREDICTIONS', payload, round });
            }
        }, [state.phase, currentSlot?.round, personaSignature]);

        const onExit = React.useCallback(() => {
            // Phase 5: stop live-sync polling if it's running
            if (window.DraftCC.liveSync?.isRunning?.()) {
                window.DraftCC.liveSync.stop();
            }
            stateFns.clearLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
            dispatch({ type: 'RESET' });
            setShowResume(false);
        }, [currentLeague]);

        const onResumeYes = React.useCallback(() => {
            setShowResume(false);
            // Rebuild personas (we don't persist them)
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';
            let draftDnaMap = {};
            try {
                if (window.DraftHistory?.loadDraftDNA) {
                    draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                }
            } catch (e) {}
            const personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);
            const draftContext = window.DraftCC?.context?.buildDraftContext
                ? window.DraftCC.context.buildDraftContext({
                    state: { ...state, personas },
                    currentLeague,
                    myRoster,
                    playersData,
                    pool: state.pool,
                    pickOrder: state.pickOrder,
                    personas,
                    draftMeta,
                })
                : state.draftContext || null;
            dispatch({ type: 'HYDRATE', state: { personas, originalPool: state.originalPool?.length ? state.originalPool : state.pool.slice(), draftContext } });
        }, [currentLeague, myRoster, playersData, draftMeta, state]);

        const onResumeNo = React.useCallback(() => {
            stateFns.clearLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
            dispatch({ type: 'RESET' });
            setShowResume(false);
        }, [currentLeague]);

        // Phase 3: open the trade proposer drawer for a given CPU roster
        const onPropose = React.useCallback((rosterId) => {
            if (!rosterId || String(rosterId) === String(state.userRosterId)) return;
            dispatch({ type: 'OPEN_PROPOSER', targetRosterId: rosterId });
        }, [state.userRosterId]);

        // ── Render ───────────────────────────────────────────────────
        // Mobile redirect
        if (viewport === 'mobile') {
            return <MobileFeed state={state} dispatch={dispatch} onStart={onStartDraft} isUserTurn={isUserTurn} currentSlot={currentSlot} />;
        }

        // Setup phase
        if (state.phase === 'setup') {
            return (
                <SetupScreen
                    state={state}
                    dispatch={dispatch}
                    draftMeta={draftMeta}
                    playersData={playersData}
                    currentLeague={currentLeague}
                    myRoster={myRoster}
                    csvReady={csvReady}
                    showResume={showResume}
                    onStartDraft={onStartDraft}
                    onResumeYes={onResumeYes}
                    onResumeNo={onResumeNo}
                    forcedMode={forcedMode}
                />
            );
        }

        // Drafting / complete phase → Command Center grid
        return (
            <CommandCenterGrid
                state={state}
                dispatch={dispatch}
                isUserTurn={isUserTurn}
                currentSlot={currentSlot}
                onExit={onExit}
                onPropose={onPropose}
                viewport={viewport}
            />
        );
    }

    // ── Setup screen ─────────────────────────────────────────────────
    function SetupScreen({ state, dispatch, draftMeta, playersData, currentLeague, myRoster, csvReady, showResume, onStartDraft, onResumeYes, onResumeNo, forcedMode }) {
        const [showOther, setShowOther] = React.useState(false);
        const selStyle = {
            width: '100%',
            padding: '8px 10px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(212,175,55,0.2)',
            borderRadius: '6px',
            color: 'var(--white)',
            fontSize: '0.82rem',
            fontFamily: FONT_UI,
            outline: 'none',
            cursor: 'pointer',
        };

        const update = (patch) => dispatch({ type: 'SETUP_CHANGE', payload: patch });
        const upcoming = draftMeta.upcomingSettings || null;
        const totalPicks = (state.rounds || 0) * (state.leagueSize || 0);
        const poolCount = state.variant === 'rookie'
            ? (window.getProspects?.()?.length || state.pool?.length || 0)
            : (state.pool?.length || Object.keys(window.App?.LI?.playerScores || {}).length || 0);
        const previewOrder = window.DraftCC?.state?.buildPickOrder
            ? window.DraftCC.state.buildPickOrder(state.rounds, state.leagueSize, state.draftType, draftMeta.slotToRoster || {}, draftMeta.pickOwnership || {})
            : [];
        const ownedPreview = previewOrder.filter(p => Number(p.rosterId) === Number(state.userRosterId)).slice(0, 6);
        const userPickPreview = ownedPreview.length ? ownedPreview : previewOrder.filter(p => Number(p.slot) === Number(state.userSlot)).slice(0, 6);
        const slotOwner = draftMeta.slotToRoster?.[state.userSlot]?.ownerName || (state.userSlot === draftMeta.mySlot ? 'You' : 'Team ' + state.userSlot);
	        const fallbackPickPreview = Array.from({ length: Math.min(6, state.rounds || 0) }, (_, i) => {
	            const round = i + 1;
	            const slot = state.draftType === 'snake' && round % 2 === 0 ? state.leagueSize - state.userSlot + 1 : state.userSlot;
	            const overall = ((round - 1) * state.leagueSize) + slot;
	            const pickValue = window.DraftCC?.state?.resolveDraftPickValue?.({
	                season: window.S?.season,
	                round,
	                slot,
	                overall,
	                leagueSize: state.leagueSize,
	                rounds: state.rounds,
	            });
	            return { round, slot, overall, value: pickValue?.value || 0, ownerName: slotOwner, traded: false };
	        });
	        const pickPreviewRows = userPickPreview.length ? userPickPreview : fallbackPickPreview;
	        const fmtDhqValue = n => Number(n || 0) > 0 ? Number(n || 0).toLocaleString() + ' DHQ' : 'value pending';
        const variantLabels = {
            startup: 'Dynasty Start Up pool',
            rookie: 'Rookie pool',
            redraft: 'Redraft pool',
        };
        const poolChoices = [
            { id: 'startup', label: 'Dynasty Start Up', sub: 'DHQ-ranked dynasty board' },
            { id: 'rookie', label: 'rookie', sub: csvReady ? (window.getProspects?.()?.length || 0) + ' prospects loaded' : 'loading CSV...' },
            { id: 'redraft', label: 'redraft', sub: 'current-season adapter' },
        ];
        const setupSummary = [
            variantLabels[state.variant] || 'Dynasty Start Up pool',
            state.draftType === 'snake' ? 'Snake draft' : 'Linear draft',
            state.rounds + ' rounds',
            state.leagueSize + ' teams',
        ].join(' - ');
        const paceLabel = state.mode === 'manual'
            ? 'manual entry'
            : state.mode === 'live-sync'
                ? 'Sleeper mirror'
                : state.speed + ' CPU';
        const roundOptions = (() => {
            const opts = new Set(Array.from({ length: 100 }, (_, i) => i + 1));
            [state.rounds, upcoming?.rounds].forEach(v => {
                const n = Number(v || 0);
                if (n > 0) opts.add(n);
            });
            return [...opts].sort((a, b) => a - b);
        })();
        const leagueSizeOptions = (() => {
            const opts = new Set(Array.from({ length: 29 }, (_, i) => i + 4));
            [state.leagueSize, upcoming?.teams, draftMeta.numTeams].forEach(v => {
                const n = Number(v || 0);
                if (n > 0) opts.add(n);
            });
            return [...opts].sort((a, b) => a - b);
        })();
        const upcomingPatch = () => {
            if (!upcoming) return {};
            const patch = { mode: 'solo' };
            if (upcoming.rounds) patch.rounds = Number(upcoming.rounds);
            if (upcoming.teams) patch.leagueSize = Number(upcoming.teams);
            if (upcoming.type) patch.draftType = upcoming.type;
            if (upcoming.variant) patch.variant = upcoming.variant;
            if (draftMeta.mySlot) patch.userSlot = draftMeta.mySlot;
            if (myRoster?.roster_id) patch.userRosterId = myRoster.roster_id;
            return patch;
        };
        const applyUpcomingDraft = () => {
            const patch = upcomingPatch();
            if (Object.keys(patch).length) update(patch);
        };
        const startUpcomingDraft = () => {
            const patch = upcomingPatch();
            if (Object.keys(patch).length) update(patch);
            onStartDraft(patch);
        };
        const matchesUpcoming = !!upcoming
            && (!upcoming.rounds || Number(state.rounds) === Number(upcoming.rounds))
            && (!upcoming.teams || Number(state.leagueSize) === Number(upcoming.teams))
            && (!upcoming.type || String(state.draftType) === String(upcoming.type))
            && (!upcoming.variant || String(state.variant) === String(upcoming.variant))
            && (!draftMeta.mySlot || Number(state.userSlot) === Number(draftMeta.mySlot));
        const upcomingStart = upcoming?.startTime
            ? new Date(upcoming.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
            : (upcoming?.status === 'drafting' ? 'in progress' : 'not scheduled');
        const upcomingStatus = upcoming?.status
            ? String(upcoming.status).replace('_', ' ')
            : (upcoming ? 'league settings' : 'custom mock');
        const structureFields = [
            {
                label: 'Draft Rounds',
                value: state.rounds,
                onChange: e => update({ rounds: Math.max(1, Math.min(100, Number(e.target.value) || 1)) }),
                options: roundOptions,
                suffix: ' rounds',
            },
            {
                label: 'League Size',
                value: state.leagueSize,
                onChange: e => {
                    const n = Number(e.target.value) || state.leagueSize;
                    update({ leagueSize: n, userSlot: Math.min(state.userSlot, n) });
                },
                options: leagueSizeOptions,
                suffix: ' teams',
            },
        ];

        return (
            <div className="draft-setup-shell">
                {!forcedMode && showResume && (
                    <div style={{
                        padding: '12px 16px',
                        background: 'linear-gradient(90deg, rgba(212,175,55,0.12), rgba(212,175,55,0.02))',
                        border: '1px solid rgba(212,175,55,0.35)',
                        borderRadius: '8px',
                        marginBottom: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                    }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', marginBottom: '2px' }}>Resume draft in progress?</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--silver)' }}>
                                {state.picks.length} picks made - Round {state.pickOrder[state.currentIdx]?.round || '?'}
                            </div>
                        </div>
                        <button onClick={onResumeYes} style={{ padding: '6px 16px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '5px', fontWeight: 700, cursor: 'pointer', fontSize: '0.76rem', fontFamily: FONT_UI }}>Resume</button>
                        <button onClick={onResumeNo} style={{ padding: '6px 12px', background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '5px', cursor: 'pointer', fontSize: '0.74rem', fontFamily: FONT_UI }}>Discard</button>
                    </div>
                )}

                {forcedMode === 'live-sync' ? (
                    <section className="draft-setup-panel draft-live-only-picker" style={{ borderColor: 'rgba(124,107,248,0.26)' }}>
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'minmax(0, 1fr) auto',
                            gap: '16px',
                            alignItems: 'center',
                            padding: '4px 2px 14px',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                            marginBottom: '14px',
                        }}>
                            <div>
                                <div style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '0.72rem', fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 4 }}>
                                    Follow Live Draft
                                </div>
                                <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1.22rem', fontWeight: 900 }}>
                                    Opening the live command room
                                </div>
                                <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.76rem', marginTop: 4, lineHeight: 1.45 }}>
                                    I will auto-select the league's active or next scheduled Sleeper draft, then mirror it with your board, roster build, and opponent intel.
                                </div>
                            </div>
                            <div style={{
                                minWidth: 150,
                                padding: '10px 12px',
                                borderRadius: 7,
                                border: '1px solid rgba(155,138,251,0.28)',
                                background: 'rgba(155,138,251,0.07)',
                                textAlign: 'center',
                            }}>
                                <div style={{ color: 'rgba(214,208,255,0.98)', fontSize: '0.58rem', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Live Sync</div>
                                <div style={{ color: 'var(--white)', fontFamily: FONT_MONO, fontSize: '0.9rem', fontWeight: 800, marginTop: 3 }}>one-click</div>
                            </div>
                        </div>
                        <LiveSyncDraftPicker state={state} update={update} leagueId={state.leagueId} currentLeague={currentLeague} launchOnly />
                    </section>
                ) : (
                    <>
                        {state.mode === 'scenario' && <ScenarioPicker state={state} update={update} />}
                        {state.mode === 'ghost' && <GhostDraftPicker state={state} update={update} leagueId={state.leagueId} />}

                        <div className="draft-setup-grid draft-setup-grid-pro">
                        <section className={'draft-setup-panel draft-setup-league-card' + (matchesUpcoming ? ' is-synced' : '')}>
                            <div className="draft-league-primary">
                                <div className="draft-league-copy">
                                    <span>League Upcoming Draft</span>
                                    <strong>{upcoming ? `${upcoming.rounds || '?'} rounds x ${upcoming.teams || '?'} teams` : 'No scheduled draft detected'}</strong>
                                    <em>{upcoming ? `${upcoming.type || 'snake'} - ${upcomingStatus} - ${upcomingStart}` : 'Custom mock settings are available below.'}</em>
                                </div>
                                <div className="draft-league-actions">
                                    <button type="button" onClick={applyUpcomingDraft} disabled={!upcoming}>
                                        {matchesUpcoming ? 'USING LEAGUE SETTINGS' : 'USE LEAGUE SETTINGS'}
                                    </button>
                                    <button type="button" className="is-primary" onClick={startUpcomingDraft} disabled={!upcoming || (state.variant === 'rookie' && !csvReady)}>
                                        MOCK UPCOMING DRAFT
                                    </button>
                                </div>
                            </div>
                            <div className="draft-league-metrics">
                                <div><span>Rounds</span><strong>{upcoming?.rounds || state.rounds || '--'}</strong><em>1-100 supported</em></div>
                                <div><span>Teams</span><strong>{upcoming?.teams || state.leagueSize || '--'}</strong><em>league size</em></div>
                                <div><span>Your slot</span><strong>{draftMeta.mySlot || state.userSlot || '--'}</strong><em>{slotOwner}</em></div>
                                <div><span>Format</span><strong>{upcoming?.type || state.draftType}</strong><em>{variantLabels[state.variant] || state.variant.replace('_', ' ')}</em></div>
                            </div>
                        </section>

                    <section className="draft-setup-panel draft-setup-config-card">
                        <div className="draft-hq-panel-head">
                            <span>Draft Setup</span>
                            <em>{setupSummary}</em>
                        </div>
                        <div className="draft-setup-label">Pool Type</div>
                        <div className="draft-setup-choice draft-setup-choice-pro">
                            {poolChoices.map(choice => (
                                <button key={choice.id} type="button" className={state.variant === choice.id ? 'is-active' : ''} onClick={() => update({ variant: choice.id })}>
                                    {choice.label}
                                    <span>{choice.sub}</span>
                                </button>
                            ))}
                        </div>

                        <div className="draft-setup-field-grid">
                            {structureFields.map(field => (
                                <div key={field.label}>
                                    <div className="draft-setup-label">{field.label}</div>
                                    <select value={field.value} onChange={field.onChange} style={selStyle}>
                                        {field.options.map(v => <option key={v} value={v} style={{ background: '#111' }}>{v}{field.suffix === ' rounds' && v === 1 ? ' round' : field.suffix}</option>)}
                                    </select>
                                </div>
                            ))}
                            <div>
                                <div className="draft-setup-label">Your Draft Position</div>
                                <select value={state.userSlot} onChange={e => update({ userSlot: +e.target.value })} style={selStyle}>
                                    {Array.from({ length: state.leagueSize }, (_, i) => {
                                        const slot = i + 1;
                                        const info = draftMeta.slotToRoster[slot];
                                        const isMine = slot === draftMeta.mySlot;
                                        const ownerLabel = info?.ownerName ? ' - ' + info.ownerName : '';
                                        return <option key={slot} value={slot} style={{ background: '#111' }}>{slot}.01{ownerLabel}{isMine ? ' (YOU)' : ''}</option>;
                                    })}
                                </select>
                            </div>
                            <div>
                                <div className="draft-setup-label">Draft Order</div>
                                <select value={state.draftType} onChange={e => update({ draftType: e.target.value })} style={selStyle}>
                                    <option value="snake" style={{ background: '#111' }}>Snake</option>
                                    <option value="linear" style={{ background: '#111' }}>Linear</option>
                                </select>
                            </div>
                        </div>

                        {state.mode !== 'manual' ? (
                            <>
                                <div className="draft-setup-label" style={{ marginTop: 12 }}>CPU Speed</div>
                                <div className="draft-setup-speed">
                                    {['slow', 'medium', 'fast'].map(v => (
                                        <button key={v} type="button" className={state.speed === v ? 'is-active' : ''} onClick={() => update({ speed: v })}>{v}</button>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="draft-setup-note" style={{ marginTop: 10 }}>
                                Manual entry records the room pick by pick without CPU autopicks.
                            </div>
                        )}

                        <div className="draft-setup-secondary">
                            <button type="button" onClick={() => setShowOther(v => !v)}>
                                <span>{showOther ? 'Hide advanced mock options' : 'Advanced mock options'}</span>
                                <span>{state.mode === 'manual' ? 'Manual room active' : state.mode === 'scenario' ? 'Scenario active' : state.mode === 'ghost' ? 'Ghost active' : 'Manual - Scenarios - Ghost replay - Templates'}</span>
                            </button>
                            {showOther && (
                                <div className="draft-setup-other">
                                    <ModeSelector state={state} update={update} />
                                    <TemplateLoader state={state} dispatch={dispatch} />
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="draft-setup-panel is-start draft-setup-launch-card">
                        <div className="draft-hq-panel-head">
                            <span>Pick Path Preview</span>
                            <em>{paceLabel}</em>
                        </div>
                        <div className="draft-setup-kpis">
                            <div><span>Your slot</span><strong>{state.userSlot} of {state.leagueSize}</strong><em>{slotOwner}</em></div>
                            <div><span>Total picks</span><strong>{totalPicks}</strong><em>{state.rounds} rounds</em></div>
                            <div><span>Pool</span><strong>{poolCount || '--'}</strong><em>{state.variant === 'rookie' ? 'prospects' : 'players'}</em></div>
                            <div><span>Format</span><strong>{state.draftType}</strong><em>{variantLabels[state.variant] || state.variant.replace('_', ' ')}</em></div>
                        </div>
                        <button
                            type="button"
                            className="draft-setup-start"
                            onClick={() => onStartDraft()}
                            disabled={state.variant === 'rookie' && !csvReady}
	                            style={{
	                                background: state.variant === 'rookie' && !csvReady ? 'rgba(212,175,55,0.3)' : 'var(--gold)',
	                                color: 'var(--black)',
	                                borderColor: state.variant === 'rookie' && !csvReady ? 'rgba(212,175,55,0.3)' : 'var(--gold)',
	                            }}
	                        >
	                            {state.variant === 'rookie' && !csvReady ? 'LOADING PROSPECTS...' : 'START MOCK DRAFT'}
	                        </button>
                        <div className="draft-setup-label" style={{ marginBottom: 6 }}>Your first picks</div>
                        <div className="draft-setup-timeline">
                            {pickPreviewRows.map((p, i) => (
	                                <div key={p.round + '-' + p.slot + '-' + i}>
	                                    <strong>{p.round}.{String(p.slot).padStart(2, '0')}</strong>
	                                    <span>Overall {p.overall} - {p.ownerName || slotOwner}</span>
	                                    <em>{fmtDhqValue(p.value)}{p.traded ? ' - acquired' : ''}</em>
	                                </div>
	                            ))}
                        </div>
                        <div className="draft-setup-note" style={{ marginTop: 10 }}>
                            {setupSummary}. Owner DNA, needs, draft history, and your saved Big Board order will drive the room.
                        </div>
                    </section>
                        </div>
                        {state.mode !== 'manual' && (
                            <section className="draft-setup-panel draft-setup-strategy-card">
                                <DraftStrategyStudio state={state} update={update} />
                            </section>
                        )}
                        <DraftLearningPanel
                            state={state}
                            update={update}
                        />
                    </>
                )}
            </div>
        );
    }

    function DraftLearningPanel({ state, update }) {
        const helpers = window.DraftCC?.state || {};
        const [refresh, setRefresh] = React.useState(0);
        if (!helpers.listDraftRecaps || !helpers.buildRecapLearningDefaults) return null;
        const recaps = helpers.listDraftRecaps(state.leagueId).slice(0, 5);
        const learning = helpers.buildRecapLearningDefaults(state.leagueId, {
            variant: state.variant,
            baseTuning: state.draftTuning,
        });
        if (!recaps.length && !learning?.sampleSize) return null;

        const fmt = n => Number(n || 0).toLocaleString();
        const when = ts => {
            if (!ts) return 'saved recap';
            try {
                return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
            } catch (_) {
                return 'saved recap';
            }
        };
        const applyLearning = () => {
            if (!learning?.sampleSize || !learning.suggestedTuning) return;
            update({ draftTuning: learning.suggestedTuning, recapLearning: learning });
        };
        const exportRecap = (recap) => {
            if (!recap) return;
            const text = helpers.formatDraftShareReport
                ? helpers.formatDraftShareReport(recap)
                : helpers.formatDraftRecapText?.(recap);
            if (!text) return;
            const blob = new Blob([text], { type: 'text/markdown' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'war-room-draft-recap-' + (recap.savedAt || Date.now()) + '.md';
            a.click();
            URL.revokeObjectURL(url);
        };
        const deleteRecap = (id) => {
            if (!id || !helpers.deleteDraftRecap) return;
            helpers.deleteDraftRecap(state.leagueId, id);
            setRefresh(v => v + 1);
        };
        const tuningLabels = [
            ['ownerDna', 'Owner DNA'],
            ['classValue', 'Class Value'],
            ['needFit', 'Roster Fit'],
            ['tradeActivity', 'Trades'],
            ['variance', 'Variance'],
        ];

        return (
            <section className="draft-setup-panel" style={{ marginTop: 14, marginBottom: 14 }}>
                <div className="draft-hq-panel-head">
                    <span>Draft Learning Archive</span>
                    <em>{learning?.sampleSize || 0} recap{learning?.sampleSize === 1 ? '' : 's'} feeding mock defaults</em>
                </div>
                {learning?.sampleSize > 0 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(260px,0.8fr)', gap: 12, alignItems: 'start', marginBottom: 12 }}>
                        <div>
                            <div style={{ color: 'var(--white)', fontWeight: 800, fontSize: '0.78rem', marginBottom: 4 }}>
                                Recap learning is active for {state.variant.replace('_', ' ')} mocks.
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.75, fontSize: '0.7rem', lineHeight: 1.5 }}>
                                {(learning.notes || []).slice(0, 3).join(' ') || 'Saved recaps are available for future mock context.'}
                            </div>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                                {tuningLabels.map(([key, label]) => (
                                    <span key={key} style={{ fontSize: '0.58rem', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', background: 'rgba(255,255,255,0.025)' }}>
                                        {label} {learning.suggestedTuning?.[key] ?? '--'}
                                    </span>
                                ))}
                            </div>
                            <button type="button" onClick={applyLearning} style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid rgba(212,175,55,0.32)', background: 'rgba(212,175,55,0.12)', color: 'var(--gold)', fontFamily: FONT_UI, fontWeight: 800, cursor: 'pointer', fontSize: '0.68rem' }}>
                                APPLY LEARNED DEFAULTS
                            </button>
                        </div>
                    </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 8 }}>
                    {recaps.map(recap => (
                        <div key={(recap.id || recap.savedAt) + '-' + refresh} style={{ padding: '10px 11px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <strong style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '1.08rem', lineHeight: 1 }}>{recap.grade?.letter || '?'}</strong>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ color: 'var(--white)', fontWeight: 800, fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{recap.variant || 'draft'} recap</div>
                                    <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.6rem' }}>{when(recap.savedAt)}</div>
                                </div>
                            </div>
                            <div style={{ color: 'var(--silver)', fontSize: '0.66rem', lineHeight: 1.45, minHeight: 36 }}>
                                #{recap.rank || '-'} league rank - {fmt(recap.totalDHQ)} DHQ - {recap.actionPlan?.length || 0} actions
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                <button type="button" onClick={() => exportRecap(recap)} style={{ flex: 1, padding: '5px 7px', borderRadius: 5, border: '1px solid rgba(212,175,55,0.24)', background: 'rgba(212,175,55,0.08)', color: 'var(--gold)', fontFamily: FONT_UI, fontWeight: 800, cursor: 'pointer', fontSize: '0.58rem' }}>EXPORT</button>
                                <button type="button" onClick={() => deleteRecap(recap.id)} style={{ padding: '5px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: 'var(--silver)', fontFamily: FONT_UI, fontWeight: 700, cursor: 'pointer', fontSize: '0.58rem' }}>DELETE</button>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    function AnalystMockPanel({ state, dispatch, draftMeta, playersData, currentLeague, myRoster }) {
        const engine = window.DraftCC?.analystMock;
        const presets = engine?.PRESETS || [];
        const [presetId, setPresetId] = React.useState('league-history');
        const [roundLimit, setRoundLimit] = React.useState('full');
        const [reports, setReports] = React.useState([]);
        const [activeId, setActiveId] = React.useState(null);
        const [filters, setFilters] = React.useState({ team: 'all', round: 'all', pos: 'ALL', focus: 'all', query: '' });
        const [expandedOverall, setExpandedOverall] = React.useState(null);
        const active = reports.find(r => r.id === activeId) || reports[0] || null;
        const analystRoundOptions = React.useMemo(() => {
            const maxRounds = Math.max(1, Math.min(100, Number(state.rounds || 1)));
            return Array.from({ length: maxRounds }, (_, idx) => String(idx + 1));
        }, [state.rounds]);
        React.useEffect(() => {
            if (!active?.picks?.length) return;
            const stillValid = active.picks.some(p => Number(p.overall) === Number(expandedOverall));
            if (stillValid) return;
            const firstUser = active.summary?.userPicks?.[0];
            setExpandedOverall(firstUser?.overall || active.picks[0].overall);
        }, [active?.id]);
        if (!engine || !presets.length) return null;

        const generate = () => {
            const report = engine.generateProjectedMock({
                state,
                draftMeta,
                playersData,
                currentLeague,
                myRoster,
                presetId,
                roundLimit,
            });
            setReports(prev => [report].concat(prev.filter(r => r.id !== report.id)).slice(0, 4));
            setActiveId(report.id);
        };
        const useAsScenario = () => {
            if (!active) return;
            dispatch({
                type: 'SETUP_CHANGE',
                payload: {
                    mode: 'scenario',
                    scenarioId: null,
                    analystScenario: active,
                },
            });
        };
        const driverLabel = (counts) => {
            const order = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
            return order.slice(0, 3).map(([k, v]) => k.replace(/_/g, ' ') + ' ' + v).join(' - ') || 'No drivers yet';
        };
        const fmt = n => {
            const v = Number(n || 0);
            if (Math.abs(v) >= 1000) return (v / 1000).toFixed(v >= 10000 ? 0 : 1) + 'k';
            return String(Math.round(v));
        };
        const patchFilters = patch => setFilters(prev => ({ ...prev, ...patch }));
        const filteredPicks = active
            ? (engine.applyReportFilters ? engine.applyReportFilters(active, filters, state) : active.picks)
            : [];
        const brief = active?.summary?.reportBrief || null;
        const teamOptions = active ? Array.from(new Map(active.picks.map(p => {
            const key = String(p.rosterId || p.ownerName || p.slot);
            return [key, { key, label: p.ownerName || ('Team ' + p.slot) }];
        })).values()).sort((a, b) => a.label.localeCompare(b.label)) : [];
        const roundOptions = active ? Array.from(new Set(active.picks.map(p => Number(p.round)))).sort((a, b) => a - b) : [];
        const posOptions = active ? Array.from(new Set(active.picks.map(p => String(p.pos || '?').toUpperCase()))).sort() : [];
        const focusCount = id => {
            if (!active) return 0;
            if (id === 'all') return active.picks.length;
            if (id === 'my') return active.summary?.userPicks?.length || 0;
            if (id === 'reaches') return active.summary?.reaches?.length || 0;
            if (id === 'steals') return active.summary?.steals?.length || 0;
            if (id === 'trades') return active.summary?.tradeSignals?.length || 0;
            if (id === 'high') return active.picks.filter(p => p.confidence === 'high').length;
            if (id === 'owner_history') return active.picks.filter(p => (p.drivers || []).some(d => d.code === 'owner_history')).length;
            if (id === 'need') return active.picks.filter(p => p.alexCommentary?.meta?.needHit || (p.drivers || []).some(d => d.code === 'need')).length;
            return 0;
        };
        const focusOptions = [
            { id: 'all', label: 'All' },
            { id: 'my', label: 'My Picks' },
            { id: 'reaches', label: 'Reaches' },
            { id: 'steals', label: 'Steals' },
            { id: 'trades', label: 'Trade Heat' },
            { id: 'high', label: 'High Certainty' },
            { id: 'owner_history', label: 'Owner DNA' },
            { id: 'need', label: 'Need Fits' },
        ];
        const controlStyle = {
            padding: '7px 9px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(212,175,55,0.2)',
            borderRadius: '6px',
            color: 'var(--white)',
            fontSize: '0.68rem',
            fontFamily: FONT_UI,
            outline: 'none',
            minWidth: 0,
        };
        const chipStyle = activeChip => ({
            padding: '5px 8px',
            borderRadius: '5px',
            border: '1px solid ' + (activeChip ? 'rgba(212,175,55,0.46)' : 'rgba(255,255,255,0.08)'),
            background: activeChip ? 'rgba(212,175,55,0.13)' : 'rgba(255,255,255,0.025)',
            color: activeChip ? 'var(--gold)' : 'var(--silver)',
            cursor: 'pointer',
            fontSize: '0.58rem',
            fontFamily: FONT_UI,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
        });
        const preset = engine.presetFor(presetId);
        const comparison = active && reports.length > 1 && engine.compareReports
            ? engine.compareReports([active].concat(reports.filter(r => r.id !== active.id)), state)
            : null;

        return (
            <section className="draft-setup-panel" style={{ marginTop: 12 }}>
                <div className="draft-hq-panel-head">
                    <span>Analyst Projected Mock</span>
                    <em>{preset.label} - {roundLimit === 'full' ? 'full draft' : roundLimit + ' round' + (Number(roundLimit) === 1 ? '' : 's')}</em>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 12, alignItems: 'start' }}>
                    <div>
                        <div className="draft-setup-choice" style={{ marginTop: 6, marginBottom: 10, gridTemplateColumns: 'repeat(3, 1fr)' }}>
                            {presets.map(p => (
                                <button key={p.id} type="button" className={presetId === p.id ? 'is-active' : ''} onClick={() => setPresetId(p.id)}>
                                    {p.label}
                                    <span>{p.desc}</span>
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <select value={roundLimit} onChange={e => setRoundLimit(e.target.value)} style={{
                                padding: '7px 10px',
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(212,175,55,0.2)',
                                borderRadius: '6px',
                                color: 'var(--white)',
                                fontSize: '0.76rem',
                                fontFamily: FONT_UI,
                                outline: 'none',
                            }}>
                                {analystRoundOptions.map(round => (
                                    <option key={round} value={round} style={{ background: '#111' }}>{round} round{Number(round) === 1 ? '' : 's'}</option>
                                ))}
                                <option value="full" style={{ background: '#111' }}>Full draft</option>
                            </select>
                            <button type="button" onClick={generate} style={{
                                padding: '8px 14px',
                                background: 'var(--gold)',
                                color: 'var(--black)',
                                border: '1px solid var(--gold)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '0.72rem',
                                fontFamily: FONT_UI,
                                fontWeight: 800,
                                letterSpacing: '0.04em',
                            }}>GENERATE LEAGUE MOCK</button>
                            {active && (
                                <button type="button" onClick={useAsScenario} style={{
                                    padding: '8px 12px',
                                    background: 'rgba(46,204,113,0.12)',
                                    color: '#2ECC71',
                                    border: '1px solid rgba(46,204,113,0.35)',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.72rem',
                                    fontFamily: FONT_UI,
                                    fontWeight: 800,
                                }}>REHEARSE THIS PROJECTION</button>
                            )}
                        </div>
                    </div>
                    <div style={{
                        minHeight: 190,
                        padding: '10px 12px',
                        background: 'rgba(255,255,255,0.025)',
                        border: '1px solid rgba(212,175,55,0.12)',
                        borderRadius: '8px',
                    }}>
                        {!active && (
                            <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.72rem', lineHeight: 1.55 }}>
                                Generate a league-specific pick-by-pick projection using draft order, owner profiles, saved boards, roster needs, and tuning assumptions.
                            </div>
                        )}
                        {active && (
                            <div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6, marginBottom: 8 }}>
                                    <div><span style={{ display: 'block', fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase' }}>Picks</span><strong style={{ color: 'var(--gold)', fontFamily: FONT_MONO }}>{active.summary.totalPicks}</strong></div>
                                    <div><span style={{ display: 'block', fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase' }}>Your Picks</span><strong style={{ color: '#2ECC71', fontFamily: FONT_MONO }}>{active.summary.userPicks.length}</strong></div>
                                    <div><span style={{ display: 'block', fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase' }}>Basis</span><strong style={{ color: 'var(--white)', fontFamily: FONT_MONO }}>{active.basis}</strong></div>
                                </div>
                                {brief && (
                                    <div style={{
                                        marginBottom: 9,
                                        padding: '8px 9px',
                                        background: 'rgba(212,175,55,0.055)',
                                        border: '1px solid rgba(212,175,55,0.16)',
                                        borderRadius: '7px',
                                    }}>
                                        <div style={{ color: 'var(--gold)', fontSize: '0.56rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 900, fontFamily: FONT_UI, marginBottom: 3 }}>Report Brief</div>
                                        <div style={{ color: 'var(--white)', fontSize: '0.66rem', lineHeight: 1.35, fontFamily: FONT_UI }}>{brief.headline}</div>
                                        <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.58rem', lineHeight: 1.35, marginTop: 4, fontFamily: FONT_UI }}>{brief.userPath}</div>
                                    </div>
                                )}
                                {brief && (
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6, marginBottom: 9 }}>
                                        <div style={{ padding: '7px 8px', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)', borderRadius: 6 }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Pressure</span>
                                            <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.72rem', fontFamily: FONT_MONO, marginTop: 2 }}>{brief.positionPressure?.[0] ? brief.positionPressure[0].key + ' x' + brief.positionPressure[0].count : 'Even'}</strong>
                                        </div>
                                        <div style={{ padding: '7px 8px', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)', borderRadius: 6 }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Value Team</span>
                                            <strong style={{ display: 'block', color: '#2ECC71', fontSize: '0.68rem', fontFamily: FONT_UI, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{brief.valueTeams?.[0]?.ownerName || '—'}</strong>
                                        </div>
                                        <div style={{ padding: '7px 8px', border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)', borderRadius: 6 }}>
                                            <span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Watch</span>
                                            <strong style={{ display: 'block', color: 'var(--gold)', fontSize: '0.72rem', fontFamily: FONT_MONO, marginTop: 2 }}>{(active.summary.reaches?.length || 0) + (active.summary.steals?.length || 0) + (active.summary.tradeSignals?.length || 0)}</strong>
                                        </div>
                                    </div>
                                )}
                                <div style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.65, marginBottom: 8 }}>{driverLabel(active.summary.driverCounts)}</div>
                                <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                                    {reports.map(r => (
                                        <button key={r.id} type="button" onClick={() => setActiveId(r.id)} style={{
                                            padding: '3px 7px',
                                            borderRadius: '4px',
                                            border: '1px solid ' + (active.id === r.id ? 'rgba(212,175,55,0.45)' : 'rgba(255,255,255,0.08)'),
                                            background: active.id === r.id ? 'rgba(212,175,55,0.12)' : 'transparent',
                                            color: active.id === r.id ? 'var(--gold)' : 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: '0.56rem',
                                            fontFamily: FONT_UI,
                                        }}>{r.label}</button>
                                    ))}
                                </div>
                                {comparison?.ready && (
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(3,minmax(0,1fr))',
                                        gap: 6,
                                        marginBottom: 9,
                                        padding: '7px 8px',
                                        background: 'rgba(155,138,251,0.055)',
                                        border: '1px solid rgba(155,138,251,0.18)',
                                        borderRadius: 7,
                                    }}>
                                        <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: '0.5rem', textTransform: 'uppercase' }}>Changed Picks</span><strong style={{ color: 'rgba(214,208,255,0.98)', fontFamily: FONT_MONO, fontSize: '0.68rem' }}>{comparison.changedPickCount}</strong></div>
                                        <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: '0.5rem', textTransform: 'uppercase' }}>Target Risk</span><strong style={{ color: comparison.summary.targetRisk ? '#F0A500' : '#2ECC71', fontFamily: FONT_MONO, fontSize: '0.68rem' }}>{comparison.summary.targetRisk}</strong></div>
                                        <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.62, fontSize: '0.5rem', textTransform: 'uppercase' }}>Top Grade</span><strong style={{ color: 'var(--gold)', fontFamily: FONT_UI, fontSize: '0.66rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{comparison.teamGrades?.[0]?.letter || '?'} · {comparison.teamGrades?.[0]?.ownerName || '—'}</strong></div>
                                    </div>
                                )}
                                <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 0.62fr 0.62fr 1fr', gap: 6, marginBottom: 7 }}>
                                    <select value={filters.team} onChange={e => patchFilters({ team: e.target.value })} style={controlStyle}>
                                        <option value="all" style={{ background: '#111' }}>All teams</option>
                                        {teamOptions.map(t => <option key={t.key} value={t.key} style={{ background: '#111' }}>{t.label}</option>)}
                                    </select>
                                    <select value={filters.round} onChange={e => patchFilters({ round: e.target.value })} style={controlStyle}>
                                        <option value="all" style={{ background: '#111' }}>All rounds</option>
                                        {roundOptions.map(r => <option key={r} value={r} style={{ background: '#111' }}>R{r}</option>)}
                                    </select>
                                    <select value={filters.pos} onChange={e => patchFilters({ pos: e.target.value })} style={controlStyle}>
                                        <option value="ALL" style={{ background: '#111' }}>All pos</option>
                                        {posOptions.map(pos => <option key={pos} value={pos} style={{ background: '#111' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</option>)}
                                    </select>
                                    <input value={filters.query} onChange={e => patchFilters({ query: e.target.value })} placeholder="Search report..." style={{ ...controlStyle, width: '100%' }} />
                                </div>
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 8 }}>
                                    {focusOptions.map(f => (
                                        <button key={f.id} type="button" onClick={() => patchFilters({ focus: f.id })} style={chipStyle(filters.focus === f.id)}>
                                            {f.label} <span style={{ opacity: 0.62, fontFamily: FONT_MONO }}>{focusCount(f.id)}</span>
                                        </button>
                                    ))}
                                    {(filters.team !== 'all' || filters.round !== 'all' || filters.pos !== 'ALL' || filters.focus !== 'all' || filters.query) && (
                                        <button type="button" onClick={() => setFilters({ team: 'all', round: 'all', pos: 'ALL', focus: 'all', query: '' })} style={chipStyle(false)}>Clear</button>
                                    )}
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--silver)', opacity: 0.68, fontSize: '0.56rem', fontFamily: FONT_UI, marginBottom: 5 }}>
                                    <span>{filteredPicks.length} of {active.picks.length} projected picks</span>
                                    <span>{brief?.roundSummaries?.length || 0} rounds · {brief?.teamSummaries?.length || 0} teams</span>
                                </div>
                                <div style={{ maxHeight: 520, overflowY: 'auto', paddingRight: 3 }}>
                                    {!filteredPicks.length && (
                                        <div style={{ padding: 14, color: 'var(--silver)', opacity: 0.68, fontSize: '0.68rem', textAlign: 'center' }}>No picks match the current report filters.</div>
                                    )}
                                    {filteredPicks.map(p => {
                                        const expanded = Number(expandedOverall) === Number(p.overall);
                                        const isReach = (active.summary.reaches || []).some(x => Number(x.overall) === Number(p.overall));
                                        const isSteal = (active.summary.steals || []).some(x => Number(x.overall) === Number(p.overall));
                                        const isTrade = (active.summary.tradeSignals || []).some(x => Number(x.overall) === Number(p.overall));
                                        const isMine = String(p.rosterId || '') === String(state.userRosterId || '') || (!p.rosterId && Number(p.slot) === Number(state.userSlot));
                                        const borderColor = isMine ? 'rgba(46,204,113,0.34)' : expanded ? 'rgba(212,175,55,0.34)' : 'rgba(255,255,255,0.055)';
                                        return (
                                            <div key={p.overall} onClick={() => setExpandedOverall(expanded ? null : p.overall)} role="button" tabIndex={0} style={{
                                                marginBottom: 6,
                                                padding: '7px 8px',
                                                border: '1px solid ' + borderColor,
                                                background: expanded ? 'rgba(212,175,55,0.065)' : isMine ? 'rgba(46,204,113,0.04)' : 'rgba(255,255,255,0.018)',
                                                borderRadius: 7,
                                                cursor: 'pointer',
                                            }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: '42px minmax(0,1fr) 62px', gap: 8, alignItems: 'start' }}>
                                                    <span style={{ color: isMine ? '#2ECC71' : 'var(--gold)', fontFamily: FONT_MONO, fontSize: '0.64rem' }}>{p.round}.{String(p.slot).padStart(2, '0')}</span>
                                                    <span style={{ minWidth: 0 }}>
                                                        <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name} <span style={{ color: 'var(--gold)', fontSize: '0.58rem' }}>{p.pos}</span></strong>
                                                        <em style={{ display: 'block', color: 'var(--silver)', opacity: 0.66, fontSize: '0.58rem', fontStyle: 'normal', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.ownerName}</em>
                                                    </span>
                                                    <span style={{ textAlign: 'right' }}>
                                                        <span style={{ display: 'block', color: p.confidence === 'high' ? '#2ECC71' : p.confidence === 'medium' ? 'var(--gold)' : 'var(--silver)', fontSize: '0.54rem', textTransform: 'uppercase', fontWeight: 900 }}>{p.confidence}</span>
                                                        <span style={{ display: 'block', color: isSteal ? '#2ECC71' : isReach ? '#E74C3C' : 'var(--silver)', fontFamily: FONT_MONO, fontSize: '0.56rem', marginTop: 2 }}>{isSteal ? 'STEAL' : isReach ? 'REACH' : isTrade ? 'TRADE' : fmt(p.dhq)}</span>
                                                    </span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 5 }}>
                                                    {isMine && <span style={chipStyle(true)}>Your pick</span>}
                                                    {(p.drivers || []).slice(0, 3).map(d => <span key={d.code} style={{ ...chipStyle(false), cursor: 'default', padding: '3px 6px', fontSize: '0.51rem' }}>{d.label}</span>)}
                                                </div>
                                                {expanded && (
                                                    <div style={{ marginTop: 7, paddingTop: 7, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                                        <div style={{ color: 'var(--silver)', opacity: 0.78, fontSize: '0.6rem', lineHeight: 1.38, fontFamily: FONT_UI, marginBottom: 7 }}>{p.note}</div>
                                                        {p.alexCommentary && (
                                                            <div style={{ padding: '7px 8px', background: 'rgba(212,175,55,0.055)', border: '1px solid rgba(212,175,55,0.14)', borderRadius: 6 }}>
                                                                <div style={{ color: 'var(--gold)', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 900, marginBottom: 4 }}>Alex Pick Read</div>
                                                                <div style={{ display: 'grid', gap: 5 }}>
                                                                    {[p.alexCommentary.teamImpact, p.alexCommentary.ownerFit, p.alexCommentary.boardRead, p.alexCommentary.roomImpact, p.alexCommentary.pivot].filter(Boolean).map((line, idx) => (
                                                                        <div key={idx} style={{ color: idx === 2 ? 'var(--white)' : 'var(--silver)', opacity: idx === 2 ? 0.92 : 0.75, fontSize: '0.6rem', lineHeight: 1.35, fontFamily: FONT_UI }}>{line}</div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 5, marginTop: 7 }}>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: '0.48rem', textTransform: 'uppercase' }}>DHQ</span><strong style={{ color: 'var(--gold)', fontFamily: FONT_MONO, fontSize: '0.64rem' }}>{fmt(p.dhq)}</strong></div>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: '0.48rem', textTransform: 'uppercase' }}>Board</span><strong style={{ color: 'var(--white)', fontFamily: FONT_MONO, fontSize: '0.64rem' }}>{p.consensusRank ? '#' + Math.round(p.consensusRank) : '—'}</strong></div>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: '0.48rem', textTransform: 'uppercase' }}>Tier</span><strong style={{ color: 'var(--white)', fontFamily: FONT_MONO, fontSize: '0.64rem' }}>{p.tier || '—'}</strong></div>
                                                            <div><span style={{ display: 'block', color: 'var(--silver)', opacity: 0.55, fontSize: '0.48rem', textTransform: 'uppercase' }}>Alt</span><strong style={{ color: 'var(--white)', fontFamily: FONT_UI, fontSize: '0.58rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{(p.alternatives || [])[0]?.name || '—'}</strong></div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </section>
        );
    }

    function DraftStrategyStudio({ state, update }) {
        const helpers = window.DraftCC?.state || {};
        const presets = (helpers.getDraftStrategyPresets?.() || []).filter(p => !p.hidden);
        const currentProfile = state.strategyProfile || (helpers.loadDraftStrategyProfile
            ? helpers.loadDraftStrategyProfile(state.leagueId, {
                variant: state.variant,
                baseTuning: state.draftTuning,
                recapLearning: state.recapLearning,
            })
            : null);
        const activePresetId = currentProfile?.presetId || 'front-office-blend';
        const [saveState, setSaveState] = React.useState('idle');
        const buildProfile = (presetId, extra = {}) => helpers.buildDraftStrategyProfile
            ? helpers.buildDraftStrategyProfile({
                leagueId: state.leagueId,
                presetId,
                variant: state.variant,
                baseTuning: state.draftTuning,
                recapLearning: state.recapLearning,
                gmMode: currentProfile?.gmMode,
                ...extra,
            })
            : null;
        const persistProfile = (profile) => {
            if (!profile) return;
            const saved = helpers.saveDraftStrategyProfile
                ? helpers.saveDraftStrategyProfile(state.leagueId, profile)
                : profile;
            const next = saved || profile;
            update({ strategyProfile: next, draftTuning: next.tuning || state.draftTuning });
            setSaveState('saved');
            setTimeout(() => setSaveState('idle'), 1800);
        };
        const applyPreset = (preset) => {
            const profile = buildProfile(preset.id, { label: preset.label, philosophy: preset.philosophy });
            persistProfile(profile);
        };
        const saveCustom = () => {
            const profile = buildProfile('custom-studio', {
                label: 'Custom Studio',
                philosophy: 'Hand-tuned by the GM.',
                tuning: state.draftTuning,
                source: 'custom_studio',
            });
            persistProfile(profile);
        };
        const signal = currentProfile?.aiSignals || {};
        const signalRows = [
            ['Owner history', signal.ownerHistory ?? state.draftTuning?.ownerDna],
            ['Class crop', signal.classCrop ?? state.draftTuning?.classValue],
            ['Roster fit', signal.rosterFit ?? state.draftTuning?.needFit],
            ['Trades', signal.tradeMode || (Number(state.draftTuning?.tradeActivity || 0) <= 3 ? 'off' : 'normal')],
            ['Variance', signal.varianceModel || 'balanced'],
        ];
        const compact = bpBucket() === 'mobile';

        if (!presets.length) return <DraftTuningControls state={state} update={update} />;

        return (
            <div style={{ marginTop: '14px' }}>
                <div className="draft-setup-label">AI GM Strategy Studio</div>
                <div style={{
                    display: 'grid',
                    gap: 10,
                    padding: '10px 12px',
                    marginTop: '6px',
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(212,175,55,0.12)',
                    borderRadius: '8px',
                }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))', gap: 6 }}>
                        {presets.map(preset => {
                            const active = activePresetId === preset.id;
                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    onClick={() => applyPreset(preset)}
                                    style={{
                                        minHeight: 68,
                                        padding: '8px 9px',
                                        borderRadius: 7,
                                        border: active ? '1px solid rgba(212,175,55,0.55)' : '1px solid rgba(255,255,255,0.08)',
                                        background: active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.025)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: FONT_UI,
                                    }}
                                >
                                    <div style={{ color: active ? 'var(--gold)' : 'var(--white)', fontWeight: 900, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{preset.shortLabel || preset.label}</div>
                                    <div style={{ color: 'var(--silver)', opacity: 0.66, fontSize: '0.56rem', lineHeight: 1.35, marginTop: 4 }}>{preset.philosophy}</div>
                                </button>
                            );
                        })}
                    </div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: compact ? '1fr' : 'minmax(0, 1.1fr) minmax(220px, 0.9fr)',
                        gap: 10,
                        alignItems: 'start',
                    }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: 'var(--white)', fontWeight: 900, fontSize: '0.8rem', fontFamily: FONT_UI }}>
                                {currentProfile?.label || 'Front Office Blend'}
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.45, marginTop: 3 }}>
                                {currentProfile?.philosophy || 'Balanced board, owner history, roster fit, and normal trade pressure.'}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 8 }}>
                                {signalRows.map(([label, value]) => (
                                    <span key={label} style={{ fontSize: '0.56rem', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, padding: '3px 5px', background: 'rgba(255,255,255,0.025)' }}>
                                        {label} {typeof value === 'number' ? value + '%' : value}
                                    </span>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: 'grid', gap: 6 }}>
                            <button
                                type="button"
                                onClick={saveCustom}
                                style={{ padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(212,175,55,0.32)', background: 'rgba(212,175,55,0.12)', color: 'var(--gold)', fontFamily: FONT_UI, fontWeight: 900, cursor: 'pointer', fontSize: '0.66rem' }}
                            >
                                {saveState === 'saved' ? 'SAVED TO LEAGUE' : 'SAVE PROFILE'}
                            </button>
                            <div style={{ color: 'var(--silver)', opacity: 0.58, fontSize: '0.58rem', lineHeight: 1.35, fontFamily: FONT_UI }}>
                                {currentProfile?.saved ? 'League profile active.' : 'GM mode default active.'}
                            </div>
                        </div>
                    </div>
                    <DraftTuningControls state={state} update={update} />
                </div>
            </div>
        );
    }

    function DraftTuningControls({ state, update }) {
        const t = state.draftTuning || {};
        const patch = (key, value) => {
            const nextTuning = { ...t, [key]: Number(value) };
            const helpers = window.DraftCC?.state || {};
            const strategyProfile = helpers.buildDraftStrategyProfile
                ? helpers.buildDraftStrategyProfile({
                    leagueId: state.leagueId,
                    presetId: 'custom-studio',
                    label: 'Custom Studio',
                    philosophy: 'Hand-tuned by the GM.',
                    variant: state.variant,
                    baseTuning: nextTuning,
                    tuning: nextTuning,
                    gmMode: state.strategyProfile?.gmMode,
                    recapLearning: state.recapLearning,
                    source: 'unsaved_custom',
                })
                : { ...(state.strategyProfile || {}), presetId: 'custom-studio', label: 'Custom Studio', tuning: nextTuning, saved: false };
            update({ draftTuning: nextTuning, strategyProfile: { ...strategyProfile, saved: false } });
        };
        const rows = [
            { key: 'ownerDna', label: 'Owner DNA', left: 'Class-agnostic', right: 'History-heavy' },
            { key: 'classValue', label: 'Class Value', left: 'Loose tiers', right: 'Board discipline' },
            { key: 'needFit', label: 'Roster Fit', left: 'BPA', right: 'Need-driven' },
            { key: 'tradeActivity', label: 'Trade Activity', left: 'No trades', right: 'Aggressive' },
            { key: 'variance', label: 'Pick Variance', left: 'Predictable', right: 'Chaotic' },
        ];
        return (
            <div>
                <div className="draft-setup-label">Model Tuning</div>
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '10px 12px',
                    marginTop: '6px',
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(212,175,55,0.12)',
                    borderRadius: '8px',
                }}>
                    {rows.map(row => {
                        const value = t[row.key] ?? (row.key === 'ownerDna' ? 70 : row.key === 'classValue' ? 65 : row.key === 'needFit' ? 60 : row.key === 'tradeActivity' ? 50 : 45);
                        return (
                            <div key={row.key}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <span style={{ flex: 1, fontSize: '0.66rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: FONT_UI }}>{row.label}</span>
                                    <span style={{ fontSize: '0.66rem', color: 'var(--white)', fontFamily: FONT_MONO, minWidth: 34, textAlign: 'right' }}>{value}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={value}
                                    onChange={e => patch(row.key, e.target.value)}
                                    style={{ width: '100%', accentColor: 'var(--gold)' }}
                                />
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.55, fontFamily: FONT_UI, marginTop: '-1px' }}>
                                    <span>{row.left}</span>
                                    <span>{row.right}</span>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Phase 5: ModeSelector ────────────────────────────────────────
    // Live Sync moved to its own top-level tab ("Follow Live Draft").
    function ModeSelector({ state, update }) {
        const modes = [
            { id: 'manual',   label: 'Manual Room',  desc: 'Record every pick yourself',           icon: '✍' },
            { id: 'scenario', label: 'Scenario',     desc: 'Canned "what-if" scenarios',          icon: '🎯' },
            { id: 'ghost',    label: 'Ghost Replay', desc: 'Replay a prior Sleeper draft',        icon: '👻' },
        ];
        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '6px',
                }}>Advanced Mock Mode</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '6px' }}>
                    {modes.map(m => {
                        const isActive = state.mode === m.id;
                        return (
                            <button key={m.id} onClick={() => update({ mode: m.id })} style={{
                                padding: '10px 8px',
                                background: isActive ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.03)',
                                border: '1px solid ' + (isActive ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                                borderRadius: '6px',
                                color: isActive ? 'var(--gold)' : 'var(--silver)',
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                fontFamily: FONT_UI,
                                cursor: 'pointer',
                            }}>
                                <div style={{ fontSize: '1rem', marginBottom: '3px' }}>{m.icon}</div>
                                <div>{m.label}</div>
                                <div style={{ fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.6, marginTop: '2px' }}>{m.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Phase 5: ScenarioPicker ──────────────────────────────────────
    function ScenarioPicker({ state, update }) {
        const presets = window.DraftCC.scenarios?.presets || [];
        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '6px',
                }}>Scenario</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {presets.map(p => {
                        const isActive = state.scenarioId === p.id;
                        return (
                            <button key={p.id} onClick={() => update({ scenarioId: p.id })} style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '10px',
                                padding: '10px 14px',
                                background: isActive ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                                border: '1px solid ' + (isActive ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                                borderRadius: '6px',
                                color: 'var(--white)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                fontFamily: FONT_UI,
                            }}>
                                <span style={{ fontSize: '1.4rem', flexShrink: 0 }}>{p.icon}</span>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: isActive ? 'var(--gold)' : 'var(--white)' }}>{p.name}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.7, marginTop: '2px' }}>{p.desc}</div>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    // ── Phase 5: GhostDraftPicker ────────────────────────────────────
    // Pulls drafts from THIS league only, walking the previous_league_id chain
    // backward so dynasty continuations from prior seasons are included.
    function GhostDraftPicker({ state, update, leagueId }) {
        const [drafts, setDrafts] = React.useState(null);
        const [loading, setLoading] = React.useState(false);
        const [progress, setProgress] = React.useState('');

        React.useEffect(() => {
            if (!leagueId) return;
            setLoading(true);
            setProgress('Loading drafts from this league…');
            window.DraftCC.ghostReplay.listLeagueChainDrafts(leagueId)
                .then(d => {
                    setDrafts(d || []);
                    setProgress('');
                })
                .catch(e => {
                    setDrafts([]);
                    setProgress('Error: ' + (e?.message || 'unknown'));
                    if (window.wrLog) window.wrLog('ghostPicker.list', e);
                })
                .finally(() => setLoading(false));
        }, [leagueId]);

        const completeDrafts = (drafts || []).filter(d => d.status === 'complete');
        const otherDrafts = (drafts || []).filter(d => d.status !== 'complete');

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '6px',
                }}>
                    <div style={{
                        fontSize: '0.64rem',
                        fontWeight: 700,
                        color: 'var(--gold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        flex: 1,
                    }}>Replay Source</div>
                    {!loading && drafts && (
                        <span style={{ fontSize: '0.56rem', color: 'var(--silver)', opacity: 0.6 }}>
                            {completeDrafts.length} complete · {otherDrafts.length} other
                        </span>
                    )}
                </div>
                {loading && (
                    <div style={{
                        fontSize: '0.72rem',
                        color: 'var(--silver)',
                        padding: '10px 14px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '5px',
                    }}>
                        {progress || 'Loading drafts from Sleeper…'}
                    </div>
                )}
                {!loading && drafts && drafts.length === 0 && (
                    <div style={{
                        padding: '10px 14px',
                        background: 'rgba(231,76,60,0.08)',
                        border: '1px solid rgba(231,76,60,0.25)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: '#E74C3C',
                    }}>
                        No drafts found for this league.
                    </div>
                )}
                {!loading && drafts && drafts.length > 0 && completeDrafts.length === 0 && (
                    <div style={{
                        padding: '10px 14px',
                        background: 'rgba(240,165,0,0.08)',
                        border: '1px solid rgba(240,165,0,0.3)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: '#F0A500',
                        marginBottom: '6px',
                        lineHeight: 1.5,
                    }}>
                        ⚠ This league has no completed drafts yet. Try <strong>Solo</strong> or <strong>Scenario</strong> mode, or <strong>Live Sync</strong> to mirror a draft in progress.
                    </div>
                )}
                {!loading && completeDrafts.length > 0 && (
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '3px',
                        maxHeight: 280,
                        overflowY: 'auto',
                        paddingRight: 4,
                    }}>
                        {completeDrafts.map(d => {
                            const isActive = state.sleeperDraftId === d.draft_id;
                            return (
                                <button key={d.draft_id}
                                    onClick={() => update({ sleeperDraftId: d.draft_id })}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '8px 12px',
                                        background: isActive ? 'rgba(212,175,55,0.14)' : 'rgba(255,255,255,0.03)',
                                        border: '1px solid ' + (isActive ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                                        borderRadius: '5px',
                                        color: 'var(--white)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: FONT_UI,
                                        fontSize: '0.72rem',
                                    }}>
                                    <span style={{
                                        fontSize: '0.58rem',
                                        color: 'var(--gold)',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        minWidth: 42,
                                    }}>{d.season}</span>
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {d.type || 'snake'} · {d.settings?.rounds || '?'}R × {d.settings?.teams || '?'}T
                                        {d.leagueName && <span style={{ color: 'var(--silver)', opacity: 0.6, marginLeft: 6 }}>· {d.leagueName}</span>}
                                    </span>
                                    <span style={{
                                        fontSize: '0.54rem',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: 'rgba(46,204,113,0.15)',
                                        color: '#2ECC71',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.04em',
                                        fontWeight: 700,
                                    }}>complete</span>
                                </button>
                            );
                        })}
                    </div>
                )}
                {/* In-progress / not-started drafts still render as informational so users see them */}
                {!loading && otherDrafts.length > 0 && (
                    <div style={{ marginTop: '8px' }}>
                        <div style={{
                            fontSize: '0.54rem',
                            color: 'var(--silver)',
                            opacity: 0.5,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            marginBottom: '3px',
                        }}>In progress / upcoming ({otherDrafts.length})</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: 100, overflowY: 'auto' }}>
                            {otherDrafts.slice(0, 10).map(d => (
                                <div key={d.draft_id}
                                    title={d.status === 'pre_draft' ? 'Not started yet — no picks to replay' : 'Draft in progress — use Live Sync mode instead'}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '5px 10px',
                                        background: 'rgba(255,255,255,0.015)',
                                        border: '1px dashed rgba(255,255,255,0.05)',
                                        borderRadius: '4px',
                                        color: 'var(--silver)',
                                        cursor: 'not-allowed',
                                        fontFamily: FONT_UI,
                                        fontSize: '0.62rem',
                                        opacity: 0.45,
                                    }}>
                                    <span style={{ fontSize: '0.52rem', fontWeight: 700, minWidth: 42 }}>{d.season}</span>
                                    <span style={{
                                        flex: 1,
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>{(d.leagueName || 'Unknown').slice(0, 30)} · {d.type || 'snake'} · {d.settings?.teams || '?'}T</span>
                                    <span style={{
                                        fontSize: '0.5rem',
                                        padding: '1px 5px',
                                        borderRadius: '3px',
                                        background: 'rgba(240,165,0,0.12)',
                                        color: '#F0A500',
                                        textTransform: 'uppercase',
                                        fontWeight: 700,
                                    }}>{d.status === 'pre_draft' ? 'upcoming' : d.status}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // ── Phase 5: LiveSyncDraftPicker ─────────────────────────────────
    // Shows only pre_draft / drafting status drafts from this league's chain.
    // A live sync source must be something currently scheduled or in-flight —
    // completed drafts would be ghost replay territory.
    function LiveSyncDraftPicker({ state, update, leagueId, currentLeague, launchOnly = false }) {
        const [drafts, setDrafts] = React.useState(null);
        const [loading, setLoading] = React.useState(false);

        React.useEffect(() => {
            if (!leagueId) return;
            setLoading(true);
            window.DraftCC.ghostReplay.listLeagueChainDrafts(leagueId)
                .then(d => setDrafts(d || []))
                .catch(() => setDrafts([]))
                .finally(() => setLoading(false));
        }, [leagueId]);

        // Filter to only drafts we can actually sync against
        const liveDrafts = (drafts || [])
            .filter(d => d.status === 'pre_draft' || d.status === 'drafting')
            // Sort: drafting first (most urgent), then pre_draft by start_time asc (next up)
            .sort((a, b) => {
                if (a.status !== b.status) return a.status === 'drafting' ? -1 : 1;
                return (a.start_time || Infinity) - (b.start_time || Infinity);
            });
        const liveDraftSignature = liveDrafts.map(d => d.draft_id + ':' + d.status).join('|');

        React.useEffect(() => {
            if (loading || state.sleeperDraftId || !liveDrafts.length) return;
            update(liveDraftSetupPatch(liveDrafts[0], currentLeague));
        }, [loading, state.sleeperDraftId, liveDraftSignature]);

        if (launchOnly) {
            const selectedDraft = liveDrafts.find(d => state.sleeperDraftId === d.draft_id) || liveDrafts[0] || null;
            const statusLabel = loading
                ? 'finding source'
                : selectedDraft?.status === 'drafting'
                    ? 'live now'
                    : selectedDraft
                        ? 'upcoming'
                        : 'no source';
            const statusColor = selectedDraft?.status === 'drafting' ? '#2ECC71' : selectedDraft ? '#F0A500' : '#E74C3C';
            const startStr = selectedDraft?.start_time
                ? new Date(selectedDraft.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                : selectedDraft?.status === 'drafting'
                    ? 'in progress'
                    : 'not scheduled';
            return (
                <div>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: '12px',
                        alignItems: 'center',
                        padding: '13px 14px',
                        borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.08)',
                        background: 'linear-gradient(90deg, rgba(255,255,255,0.035), rgba(155,138,251,0.045))',
                    }}>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: statusColor, fontSize: '0.58rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 5 }}>
                                {statusLabel}
                            </div>
                            <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1rem', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {loading ? 'Checking Sleeper draft sources...' : selectedDraft ? `${selectedDraft.season || state.season} · ${selectedDraft.type || state.draftType} · ${selectedDraft.settings?.rounds || state.rounds}R × ${selectedDraft.settings?.teams || state.leagueSize}T` : 'No upcoming or in-progress draft found'}
                            </div>
                            <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.68rem', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {selectedDraft ? `${selectedDraft.leagueName || 'Sleeper draft'} · ${startStr}` : 'Live Draft will open as soon as Sleeper has a scheduled source.'}
                            </div>
                        </div>
                        <div style={{
                            padding: '7px 10px',
                            borderRadius: 6,
                            border: '1px solid rgba(212,175,55,0.24)',
                            background: 'rgba(212,175,55,0.08)',
                            color: 'var(--gold)',
                            fontFamily: FONT_DISPL,
                            fontSize: '0.66rem',
                            fontWeight: 900,
                            letterSpacing: '0.08em',
                            textTransform: 'uppercase',
                        }}>
                            {selectedDraft ? 'launching' : 'waiting'}
                        </div>
                    </div>
                    {!loading && liveDrafts.length === 0 && (
                        <div style={{
                            marginTop: 10,
                            padding: '10px 12px',
                            borderRadius: 7,
                            border: '1px solid rgba(231,76,60,0.24)',
                            background: 'rgba(231,76,60,0.07)',
                            color: '#E74C3C',
                            fontSize: '0.72rem',
                            lineHeight: 1.45,
                        }}>
                            No live source is available yet. Sleeper has not exposed an upcoming or in-progress draft for this league.
                        </div>
                    )}
                </div>
            );
        }

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    marginBottom: '6px',
                }}>
                    <div style={{
                        fontSize: '0.64rem',
                        fontWeight: 700,
                        color: 'var(--gold)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        flex: 1,
                    }}>Live Sync Source</div>
                    {!loading && liveDrafts && (
                        <span style={{ fontSize: '0.56rem', color: 'var(--silver)', opacity: 0.6 }}>
                            {liveDrafts.length} upcoming
                        </span>
                    )}
                </div>
                {loading && (
                    <div style={{
                        fontSize: '0.72rem',
                        color: 'var(--silver)',
                        padding: '10px 14px',
                        background: 'rgba(255,255,255,0.02)',
                        border: '1px solid rgba(255,255,255,0.05)',
                        borderRadius: '5px',
                    }}>
                        Loading upcoming drafts…
                    </div>
                )}
                {!loading && liveDrafts.length === 0 && (
                    <div style={{
                        padding: '10px 14px',
                        background: 'rgba(240,165,0,0.08)',
                        border: '1px solid rgba(240,165,0,0.3)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: '#F0A500',
                        lineHeight: 1.5,
                    }}>
                        ⚠ No upcoming or in-progress drafts in this league. Live Sync mirrors a real draft as it happens — come back when one is scheduled.
                    </div>
                )}
                {!loading && liveDrafts.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: 220, overflowY: 'auto' }}>
                        {liveDrafts.map(d => {
                            const isActive = state.sleeperDraftId === d.draft_id;
                            const isDrafting = d.status === 'drafting';
                            const statusLabel = isDrafting ? 'LIVE' : 'UPCOMING';
                            const statusCol = isDrafting ? '#2ECC71' : '#F0A500';
                            const startStr = d.start_time
                                ? new Date(d.start_time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
                                : (isDrafting ? 'in progress' : 'not scheduled');
                            return (
                                <button key={d.draft_id}
                                    onClick={() => update(liveDraftSetupPatch(d, currentLeague))}
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '10px',
                                        padding: '10px 12px',
                                        background: isActive ? 'rgba(212,175,55,0.14)' : 'rgba(255,255,255,0.03)',
                                        border: '1px solid ' + (isActive ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                                        borderRadius: '5px',
                                        color: 'var(--white)',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        fontFamily: FONT_UI,
                                        fontSize: '0.72rem',
                                    }}>
                                    {isDrafting && (
                                        <span style={{
                                            width: 8, height: 8, borderRadius: '50%',
                                            background: '#2ECC71',
                                            animation: 'pulse 1.4s infinite',
                                            flexShrink: 0,
                                        }} />
                                    )}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {d.season} · {d.type || 'snake'} · {d.settings?.rounds || '?'}R × {d.settings?.teams || '?'}T
                                        </div>
                                        <div style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.6, marginTop: '2px' }}>
                                            {d.leagueName} · {startStr}
                                        </div>
                                    </div>
                                    <span style={{
                                        fontSize: '0.54rem',
                                        padding: '2px 6px',
                                        borderRadius: '3px',
                                        background: statusCol + '15',
                                        color: statusCol,
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.06em',
                                        fontWeight: 700,
                                        flexShrink: 0,
                                    }}>{statusLabel}</span>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    // ── Phase 5: TemplateLoader ──────────────────────────────────────
    function TemplateLoader({ state, dispatch }) {
        const leagueId = state.leagueId;
        const [templates, setTemplates] = React.useState([]);
        const [refreshKey, setRefreshKey] = React.useState(0);

        React.useEffect(() => {
            const list = window.DraftCC.persistence?.listTemplates(leagueId) || [];
            setTemplates(list);
        }, [leagueId, refreshKey]);

        if (!templates.length) return null;

        const onLoad = (tpl) => {
            const loaded = window.DraftCC.persistence.loadTemplate(leagueId, tpl.id);
            if (!loaded) return;
            dispatch({ type: 'HYDRATE', state: loaded });
        };

        const onDelete = (tpl) => {
            if (!confirm('Delete template "' + tpl.name + '"?')) return;
            window.DraftCC.persistence.deleteTemplate(leagueId, tpl.id);
            setRefreshKey(x => x + 1);
        };

        return (
            <div style={{ marginBottom: '16px' }}>
                <div style={{
                    fontSize: '0.64rem',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '6px',
                }}>Saved Templates ({templates.length})</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: 150, overflowY: 'auto' }}>
                    {templates.map(tpl => (
                        <div key={tpl.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '6px 10px',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '4px',
                            fontFamily: FONT_UI,
                            fontSize: '0.72rem',
                        }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontWeight: 700,
                                    color: 'var(--white)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}>{tpl.name}</div>
                                <div style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.6 }}>
                                    {new Date(tpl.ts).toLocaleString()} · {tpl.state.picks?.length || 0} picks
                                </div>
                            </div>
                            <button onClick={() => onLoad(tpl)} style={{
                                padding: '4px 10px',
                                background: 'var(--gold)',
                                color: 'var(--black)',
                                border: 'none',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '0.6rem',
                                fontWeight: 700,
                                fontFamily: FONT_UI,
                            }}>LOAD</button>
                            <button onClick={() => onDelete(tpl)} style={{
                                padding: '4px 8px',
                                background: 'transparent',
                                color: '#E74C3C',
                                border: '1px solid rgba(231,76,60,0.3)',
                                borderRadius: '3px',
                                cursor: 'pointer',
                                fontSize: '0.6rem',
                                fontFamily: FONT_UI,
                            }}>×</button>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    function MyDraftRosterPanel({ state }) {
        const players = window.S?.players || {};
        const scores = window.App?.LI?.playerScores || {};
        const rosters = window.S?.rosters || [];
        const normPos = window.App?.normPos || (p => p);
        const posColors = window.App?.POS_COLORS || {
            QB: '#FF6B6B', RB: '#4ECDC4', WR: '#45B7D1', TE: '#F7DC6F',
            DL: '#E67E22', LB: '#F0A500', DB: '#5DADE2', K: '#BB8FCE',
        };
        const fmt = (n) => {
            const v = Number(n) || 0;
            return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        };
        const playerName = (pid, fallback) => {
            const p = players[pid] || {};
            return fallback || p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid;
        };
        const playerAge = (pid, fallback) => {
            const p = players[pid] || {};
            if (fallback != null) return Number(fallback);
            if (p.age) return Number(p.age);
            if (p.birth_date) {
                const d = new Date(p.birth_date).getTime();
                if (Number.isFinite(d)) return Math.floor((Date.now() - d) / 31557600000);
            }
            return null;
        };
        const projectDhq = (dhq, pos, age, years) => {
            const base = Number(dhq) || 0;
            if (!base) return 0;
            const core = window.App?.DhqCore || window.DhqCore;
            if (!core?.ageCurveFactor || !age) return Math.round(base * Math.pow(0.94, years));
            const nowFactor = Math.max(0.01, core.ageCurveFactor(age, pos));
            const futureFactor = core.ageCurveFactor(age + years, pos) / nowFactor;
            return Math.max(0, Math.round(base * futureFactor * Math.pow(0.96, years)));
        };

        const myPicks = React.useMemo(() => {
            return (state.picks || []).filter(p => p.rosterId === state.userRosterId || p.isUser);
        }, [state.picks, state.userRosterId]);

        const baseRoster = React.useMemo(() => {
            return rosters.find(r => String(r.roster_id) === String(state.userRosterId));
        }, [state.userRosterId, rosters.length]);

        const rosterRows = React.useMemo(() => {
            const effective = window.DraftCC?.state?.getEffectivePlayers
                ? window.DraftCC.state.getEffectivePlayers(state, state.userRosterId, baseRoster?.players || [])
                : (baseRoster?.players || []);
            const baseRows = (effective || []).map(pid => {
                const p = players[pid] || {};
                const pos = normPos(p.position) || p.position || '?';
                const dhq = scores[pid] || (typeof window.dynastyValue === 'function' ? window.dynastyValue(pid) : 0) || 0;
                return {
                    pid,
                    name: playerName(pid),
                    pos,
                    team: p.team || 'FA',
                    age: playerAge(pid),
                    dhq,
                    projected5: projectDhq(dhq, pos, playerAge(pid), 5),
                    source: 'Roster',
                };
            });
            const pickRows = myPicks.map(p => ({
                pid: p.pid,
                name: p.name,
                pos: p.pos,
                team: p.team || p.college || 'Draft',
                age: playerAge(p.pid, p.age || p.csv?.age || null),
                dhq: p.dhq || 0,
                projected5: projectDhq(p.dhq || 0, p.pos, playerAge(p.pid, p.age || p.csv?.age || null), 5),
                source: 'Pick ' + p.round + '.' + String(p.slot).padStart(2, '0'),
                isPick: true,
            }));
            return [...baseRows, ...pickRows].filter(r => r.pos && r.dhq > 0).sort((a, b) => {
                if (a.pos !== b.pos) return a.pos.localeCompare(b.pos);
                return b.dhq - a.dhq;
            });
        }, [state, state.userRosterId, baseRoster, players, scores, myPicks]);

        const grouped = React.useMemo(() => {
            const m = {};
            rosterRows.forEach(r => {
                if (!m[r.pos]) m[r.pos] = [];
                m[r.pos].push(r);
            });
            return m;
        }, [rosterRows]);

        const compareRows = React.useMemo(() => {
            return (state.pool || []).slice(0, 80).map(p => {
                const pos = p.pos || '?';
                const age = playerAge(p.pid, p.age || p.csv?.age || null);
                const projected5 = projectDhq(p.dhq || 0, pos, age, 5);
                const room = (grouped[pos] || []).slice().sort((a, b) => b.dhq - a.dhq);
                const topMine = room[0] || null;
                return {
                    ...p,
                    age,
                    projected5,
                    topMine,
                    delta: (p.dhq || 0) - (topMine?.dhq || 0),
                };
            }).sort((a, b) => {
                const needA = a.delta > 0 ? 1 : 0;
                const needB = b.delta > 0 ? 1 : 0;
                return needB - needA || (b.dhq || 0) - (a.dhq || 0);
            }).slice(0, 10);
        }, [state.pool, grouped, players]);

        const totalDhq = rosterRows.reduce((sum, r) => sum + (r.dhq || 0), 0);
        const pickDhq = myPicks.reduce((sum, p) => sum + (p.dhq || 0), 0);
        const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(pos => grouped[pos]?.length)
            .concat(Object.keys(grouped).filter(pos => !['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(pos)));

        return (
            <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                padding: '8px 10px',
                background: 'var(--black)',
                border: '1px solid rgba(212,175,55,0.2)',
                borderRadius: '8px',
                overflow: 'hidden',
                fontFamily: FONT_UI,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>My Roster Build</div>
                    <span style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.65 }}>{myPicks.length} picks</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px', flexShrink: 0 }}>
                    <div style={{ padding: '6px 8px', background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.14)', borderRadius: '5px' }}>
                        <div style={{ fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase' }}>Roster DHQ</div>
                        <div style={{ fontFamily: FONT_MONO, color: 'var(--gold)', fontWeight: 700, fontSize: '0.84rem' }}>{fmt(totalDhq)}</div>
                    </div>
                    <div style={{ padding: '6px 8px', background: 'rgba(46,204,113,0.06)', border: '1px solid rgba(46,204,113,0.14)', borderRadius: '5px' }}>
                        <div style={{ fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase' }}>Draft Added</div>
                        <div style={{ fontFamily: FONT_MONO, color: '#2ECC71', fontWeight: 700, fontSize: '0.84rem' }}>{fmt(pickDhq)}</div>
                    </div>
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', paddingRight: '3px' }}>
                    <div style={{ fontSize: '0.56rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Build By Position</div>
                    {positions.length === 0 && (
                        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--silver)', opacity: 0.45, fontSize: '0.7rem' }}>Your mock picks will appear here.</div>
                    )}
                    {positions.slice(0, 7).map(pos => {
                        const rows = grouped[pos].slice(0, 3);
                        return (
                            <div key={pos} style={{ marginBottom: '6px', paddingBottom: '5px', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                                    <strong style={{ fontSize: '0.62rem', color: posColors[pos] || 'var(--gold)', width: 28 }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</strong>
                                    <span style={{ fontSize: '0.54rem', color: 'var(--silver)', opacity: 0.55 }}>{grouped[pos].length} players</span>
                                    <span style={{ marginLeft: 'auto', fontSize: '0.56rem', color: 'var(--gold)', fontFamily: FONT_MONO }}>{fmt(grouped[pos].reduce((s, r) => s + r.dhq, 0))}</span>
                                </div>
                                {rows.map(r => (
                                    <div key={r.source + '-' + r.pid} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.6rem', lineHeight: 1.45 }}>
                                        <span style={{ flex: 1, color: r.isPick ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                                        <span style={{ color: 'var(--silver)', opacity: 0.55, fontFamily: FONT_MONO }}>{fmt(r.dhq)}</span>
                                        <span style={{ color: r.projected5 >= r.dhq ? '#2ECC71' : 'var(--silver)', fontFamily: FONT_MONO, minWidth: 32, textAlign: 'right' }}>Y5 {fmt(r.projected5)}</span>
                                    </div>
                                ))}
                            </div>
                        );
                    })}

                    <div style={{ fontSize: '0.56rem', color: 'var(--gold)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '8px 0 4px' }}>Available Vs Team</div>
                    {compareRows.map(p => {
                        const col = p.delta > 0 ? '#2ECC71' : p.delta > -600 ? 'var(--gold)' : 'var(--silver)';
                        return (
                            <div key={p.pid} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0,1fr) 42px 44px 44px', gap: '5px', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.035)', fontSize: '0.6rem' }}>
                                <span style={{ color: posColors[p.pos] || 'var(--silver)', fontWeight: 700 }}>{p.pos}</span>
                                <span style={{ color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                                <span style={{ color: 'var(--gold)', textAlign: 'right', fontFamily: FONT_MONO }}>{fmt(p.dhq)}</span>
                                <span style={{ color: col, textAlign: 'right', fontFamily: FONT_MONO }}>{p.delta > 0 ? '+' : ''}{fmt(p.delta)}</span>
                                <span style={{ color: p.projected5 >= p.dhq ? '#2ECC71' : 'var(--silver)', textAlign: 'right', fontFamily: FONT_MONO }}>Y5 {fmt(p.projected5)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    function DraftPickListPanel({ state, currentSlot }) {
        const posColors = window.App?.POS_COLORS || {
            QB: '#FF6B6B', RB: '#4ECDC4', WR: '#45B7D1', TE: '#F7DC6F',
            DL: '#E67E22', LB: '#F0A500', DB: '#5DADE2', K: '#BB8FCE',
        };
        const fmt = (n) => {
            const v = Number(n) || 0;
            return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        };
        const order = state.pickOrder || [];
        const picks = state.picks || [];
        const personas = state.personas || {};
        const userRosterId = String(state.userRosterId || '');
        const ownerName = (slot, pick) => {
            const rosterId = String(pick?.rosterId || slot?.rosterId || '');
            if (rosterId && personas[rosterId]?.teamName) return personas[rosterId].teamName;
            if (slot?.ownerName) return slot.ownerName;
            if (pick?.isUser || rosterId === userRosterId) return 'Your Team';
            const slotNo = pick?.slot || slot?.slot;
            return slotNo ? 'Team ' + slotNo : 'Draft Room';
        };
        const completedRows = picks.slice(Math.max(0, picks.length - 16)).map((pick, idx, arr) => {
            const orderSlot = order[(Number(pick.overall) || 1) - 1] || {};
            return {
                kind: 'picked',
                key: pick.id || ('picked-' + pick.overall + '-' + idx),
                pick,
                slot: orderSlot,
                label: 'R' + (pick.round || orderSlot.round || '?') + '.' + String(pick.slot || orderSlot.slot || 0).padStart(2, '0'),
                stale: idx < arr.length - 1,
            };
        });
        const upcomingRows = order.slice(state.currentIdx || 0, (state.currentIdx || 0) + 20).map((slot, idx) => ({
            kind: idx === 0 ? 'current' : 'upcoming',
            key: 'upcoming-' + (slot.overall || idx),
            slot,
            pick: null,
            label: 'R' + (slot.round || '?') + '.' + String(slot.slot || 0).padStart(2, '0'),
        }));
        const rows = [...completedRows, ...upcomingRows];
        const currentOverall = currentSlot?.overall || order[state.currentIdx || 0]?.overall;

        return (
            <div style={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(212,175,55,0.14)',
                borderRadius: '8px',
                overflow: 'hidden',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 10px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    background: 'rgba(0,0,0,0.18)',
                }}>
	                    <span style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '0.82rem', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
	                        Ongoing Draft Log
	                    </span>
                    <em style={{ marginLeft: 'auto', color: 'var(--silver)', opacity: 0.62, fontSize: '0.56rem', fontStyle: 'normal', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                        {picks.length} made / {order.length || '--'}
                    </em>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: '6px' }}>
                    {!rows.length && (
                        <div style={{ color: 'var(--silver)', opacity: 0.6, fontSize: '0.68rem', padding: '10px' }}>
                            Start the draft to see the room as a running pick list.
                        </div>
                    )}
                    {rows.map(row => {
                        const pick = row.pick;
                        const slot = row.slot || {};
                        const rosterId = String(pick?.rosterId || slot.rosterId || '');
                        const isUser = pick?.isUser || (userRosterId && rosterId === userRosterId);
                        const isCurrent = row.kind === 'current' || Number(slot.overall) === Number(currentOverall);
                        const pos = pick?.pos || '';
                        const posCol = posColors[pos] || 'var(--gold)';
                        return (
                            <div key={row.key} style={{
                                display: 'grid',
                                gridTemplateColumns: '48px minmax(0, 0.85fr) minmax(0, 1.35fr) 36px 54px',
                                gap: '7px',
                                alignItems: 'center',
                                minHeight: 34,
                                padding: '5px 7px',
                                borderRadius: '6px',
                                border: '1px solid ' + (isCurrent ? 'rgba(212,175,55,0.34)' : isUser ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.04)'),
                                background: isCurrent ? 'rgba(212,175,55,0.09)' : isUser ? 'rgba(212,175,55,0.045)' : 'rgba(255,255,255,0.012)',
                                marginBottom: 4,
                            }}>
                                <span style={{ color: isCurrent || isUser ? 'var(--gold)' : 'var(--silver)', fontFamily: FONT_MONO, fontSize: '0.6rem', fontWeight: 800 }}>
                                    {row.label}
                                </span>
                                <span style={{ color: isUser ? 'var(--gold)' : 'var(--silver)', fontSize: '0.6rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {ownerName(slot, pick)}
                                </span>
                                <span style={{ color: pick ? 'var(--white)' : isCurrent ? 'var(--gold)' : 'var(--silver)', fontSize: '0.66rem', fontWeight: pick ? 800 : 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {pick ? pick.name : (isCurrent ? 'On clock' : 'Upcoming')}
                                </span>
                                <span style={{ color: pick ? posCol : 'var(--silver)', fontSize: '0.58rem', fontWeight: 900, textAlign: 'center' }}>
                                    {pos || '--'}
                                </span>
	                                <span style={{ color: pick ? 'var(--gold)' : 'var(--silver)', opacity: pick || slot.value ? 1 : 0.5, fontFamily: FONT_MONO, fontSize: '0.58rem', textAlign: 'right' }}>
	                                    {pick ? fmt(pick.dhq) : (slot.value ? fmt(slot.value) : '#' + (slot.overall || '--'))}
	                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    function mockFmt(value) {
        const n = Number(value || 0);
        if (!n) return '0';
        return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
    }

    function mockPickLabel(slot) {
        if (!slot) return '--';
        return 'R' + (slot.round || '?') + '.' + String(slot.slot || 0).padStart(2, '0');
    }

    function mockPlayerTeam(player) {
        return player?.nflTeam || player?.team || player?.csv?.nflTeam || player?.p?.team || 'FA';
    }

    function mockPlayerSchool(player) {
        return player?.school || player?.college || player?.csv?.college || player?.p?.college || player?.p?.metadata?.college || 'School TBD';
    }

    function mockPlayerPhoto(player) {
        if (!player) return '';
        return player.photoUrl || player.avatar || player.p?.avatar || (player.pid ? 'https://sleepercdn.com/content/nfl/players/thumb/' + player.pid + '.jpg' : '');
    }

    function mockInitials(name) {
        return String(name || '?')
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(part => part[0])
            .join('')
            .toUpperCase() || '?';
    }

    function mockTeamName(state, rosterId, slot) {
        const rid = String(rosterId || '');
        if (rid && state.personas?.[rid]?.teamName) return state.personas[rid].teamName;
        if (rid && String(rid) === String(state.userRosterId || '')) {
            return slot?.ownerName || state.userTeamName || 'Our Team';
        }
        return slot?.ownerName || (slot?.slot ? 'Team ' + slot.slot : 'Draft Room');
    }

    function mockOpenPlayer(player) {
        if (!player?.pid) return;
        if (typeof window.openPlayerModal === 'function' && !player.isCSV) {
            try { window.openPlayerModal(player.pid); return; } catch (_) {}
        }
        if (typeof window.WR?.openPlayerCard === 'function') {
            try { window.WR.openPlayerCard(player.pid); } catch (_) {}
        }
    }

    function mockRunText(state) {
        const counts = {};
        (state.picks || []).slice(-8).forEach(p => {
            const pos = p.pos || '?';
            counts[pos] = (counts[pos] || 0) + 1;
        });
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        if (!top) return 'No run yet';
        return top[0] + ' run started: ' + top[1] + ' ' + top[0] + ' in last 8 picks';
    }

    function mockRunReport(state) {
        const countByPos = rows => {
            const counts = {};
            rows.forEach(p => {
                const pos = p.pos || '?';
                counts[pos] = (counts[pos] || 0) + 1;
            });
            return Object.entries(counts).sort((a, b) => b[1] - a[1]);
        };
        const last8 = countByPos((state.picks || []).slice(-8));
        const last16 = countByPos((state.picks || []).slice(-16));
        const upcoming = countByPos((state.pool || []).slice(0, 18));
        const top = last8[0];
        const next = upcoming.slice(0, 3).map(([pos, count]) => pos + ' x' + count);
        const second = last16.slice(0, 3).map(([pos, count]) => pos + ' x' + count);
        return {
            value: top ? top[0] + ' run: ' + top[1] + ' in last 8' : 'No run yet',
            detail: next.length ? 'AI expects pressure next: ' + next.join(', ') : 'AI waiting on more board movement',
            bullets: [
                second.length ? 'Last 16: ' + second.join(', ') : 'Last 16: not enough picks',
                next.length ? 'Upcoming board: ' + next.join(', ') : 'Upcoming board: flat',
            ],
        };
    }

    function mockMakePick(dispatch, state, isUserTurn, player) {
        if (!player) return;
        const canPick = isUserTurn || state.overrideMode || state.mode === 'manual';
        if (!canPick) {
            mockOpenPlayer(player);
            return;
        }
        dispatch({
            type: 'MAKE_PICK',
            player,
            isUser: isUserTurn,
            reasoning: state.overrideMode
                ? { primary: 'User override', baseVal: player.dhq, nudges: [] }
                : state.mode === 'manual'
                    ? { primary: 'Manual room entry', baseVal: player.dhq, nudges: [] }
                    : { primary: 'User selection', baseVal: player.dhq, nudges: [] },
            confidence: 1.0,
            source: state.mode === 'manual' ? 'manual-draft' : null,
        });
    }

    function mockBuildCounterProposal(state, offer) {
        const targetRosterId = offer.fromRosterId;
        const proposal = {
            targetRosterId,
            myGive: [...(offer.myGive || [])],
            theirGive: [...(offer.theirGive || [])],
            myGivePlayers: [...(offer.myGivePlayers || [])],
            theirGivePlayers: [...(offer.theirGivePlayers || [])],
            myGiveFaab: offer.myGiveFaab || 0,
            theirGiveFaab: offer.theirGiveFaab || 0,
        };
        const sim = window.DraftCC?.tradeSimulator;
        const key = p => [p?.round, p?.teamIdx, p?.slot].join(':');
        const usedTheirPicks = new Set((proposal.theirGive || []).map(key));
        const targetPicks = (state.pickOrder || [])
            .slice(state.currentIdx || 0)
            .filter(p => String(p?.rosterId) === String(targetRosterId) && !usedTheirPicks.has(key(p)))
            .sort((a, b) => (sim?.pickValueFor?.(state, a) || 0) - (sim?.pickValueFor?.(state, b) || 0));
        if (targetPicks[0]) {
            proposal.theirGive = [...proposal.theirGive, targetPicks[0]];
            return proposal;
        }
        if ((proposal.myGive || []).length > 1) {
            const byValue = proposal.myGive.slice().sort((a, b) => (sim?.pickValueFor?.(state, a) || 0) - (sim?.pickValueFor?.(state, b) || 0));
            const removeKey = key(byValue[0]);
            proposal.myGive = proposal.myGive.filter(p => key(p) !== removeKey);
            return proposal;
        }
        proposal.theirGiveFaab = Math.max(Number(proposal.theirGiveFaab || 0) + 25, 25);
        return proposal;
    }

    function mockCounterCommentary(evaluation, round, maxRounds) {
        if (evaluation?.accepted) return 'That is closer. I can accept that counter.';
        const read = window.DraftCC?.tradeSimulator?.negotiationReadFor
            ? window.DraftCC.tradeSimulator.negotiationReadFor(evaluation, { finalRound: round >= maxRounds })
            : evaluation?.negotiationRead;
        if (read?.message) return read.message;
        if (round >= maxRounds) return "Come on, that's weak. I need more than that, so I'm moving on.";
        if ((evaluation?.likelihood || 0) >= (evaluation?.counterLine || 50)) return "You're in the neighborhood, but I still need a sweetener to move this pick.";
        return "I would counter. They are light. Ask for the next clean pick or keep the board.";
    }

    function mockAssetText(picks, playerIds, faab) {
        const items = [];
        (picks || []).slice(0, 3).forEach(p => items.push(mockPickLabel(p)));
        (playerIds || []).slice(0, 2).forEach(pid => items.push(formatTradeAssetPlayer(pid)));
        if (Number(faab || 0) > 0) items.push('$' + faab + ' FAAB');
        return items.length ? items.join(' + ') : 'No assets';
    }

    function MockTradeOfferPanel({ state, dispatch }) {
        const offer = state.activeOffer;
        if (!offer) return null;
        const round = Number(offer.negotiationRound || 0);
        const maxRounds = Number(offer.maxNegotiationRounds || 3);
        const counterClosed = !!offer.counterClosed || round >= maxRounds;
        const onCounter = () => {
            if (counterClosed) return;
            const sim = window.DraftCC?.tradeSimulator;
            if (!sim?.evaluateUserProposal || !sim?.offerShape) return;
            const nextRound = round + 1;
            const proposal = mockBuildCounterProposal(state, offer);
            const evaluation = sim.evaluateUserProposal(state, proposal);
            const commentary = mockCounterCommentary(evaluation, nextRound, maxRounds);
            if (evaluation.accepted) {
                const acceptedOffer = sim.offerShape(state, proposal, evaluation, commentary, {
                    countered: true,
                    negotiationRound: nextRound,
                    maxNegotiationRounds: maxRounds,
                    resumeSpeed: offer.resumeSpeed,
                    cpuMessage: 'Fine, that clears my line. I can live with it.',
                });
                dispatch({ type: 'ACCEPT_TRADE', offer: acceptedOffer });
                return;
            }
            if (nextRound >= maxRounds) {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: 'T',
                        color: '#E74C3C',
                        title: 'Trade talks broke off',
                        text: commentary,
                        relatedPickNo: state.pickOrder?.[state.currentIdx]?.overall || null,
                    },
                });
                dispatch({ type: 'DECLINE_TRADE' });
                return;
            }
            const nextOffer = evaluation.counterOffer || sim.offerShape(state, proposal, evaluation, commentary, { countered: true });
            dispatch({
                type: 'UPDATE_ACTIVE_TRADE',
                offer: {
                    ...nextOffer,
                    negotiationRound: nextRound,
                    maxNegotiationRounds: maxRounds,
                    resumeSpeed: offer.resumeSpeed,
                    cpuMessage: commentary,
                    counterClosed: false,
                },
            });
        };
        const give = mockAssetText(offer.myGive, offer.myGivePlayers, offer.myGiveFaab);
        const get = mockAssetText(offer.theirGive, offer.theirGivePlayers, offer.theirGiveFaab);
        return (
            <section className="mock-trade-card">
                <div className="mock-panel-head">
                    <span>Trade Offer Paused</span>
                    <em>Round {Math.min(round + 1, maxRounds)} of {maxRounds}</em>
                </div>
                <div className="mock-trade-body">
                    <div>
                        <strong>{offer.fromName || 'Opponent'} wants the pick</strong>
                        <span>You give {give}; you get {get}</span>
                    </div>
                    <b>{offer.likelihood || 0}%</b>
                </div>
                <div className="mock-alex-note">
                    <strong>Alex</strong>
                    <span>{offer.cpuMessage || offer.negotiationRead?.message || offer.reason || "I would counter. They are light. Ask for one more pick or keep the board."}</span>
                </div>
                <div className="mock-trade-actions">
                    <button className="is-accept" type="button" onClick={() => dispatch({ type: 'ACCEPT_TRADE', offer })}>Accept</button>
                    <button className="is-counter" type="button" onClick={onCounter} disabled={counterClosed}>Counter</button>
                    <button className="is-decline" type="button" onClick={() => dispatch({ type: 'DECLINE_TRADE' })}>Decline</button>
                </div>
            </section>
        );
    }

    function MockBigBoardTable({ state, dispatch, isUserTurn }) {
        const [search, setSearch] = React.useState('');
        const [posFilter, setPosFilter] = React.useState('');
        const [sortKey, setSortKey] = React.useState('board');
        const [sortDir, setSortDir] = React.useState(-1);
        const boardContext = state.draftContext?.boardContext || {};
        const isRedraftBoard = state.variant === 'redraft' || state.draftContext?.draftType === 'redraft' || state.draftContext?.leagueFormat?.draftType === 'redraft';
        const initialLane = ['dhq', 'ai', 'my'].includes(boardContext.activeLane) ? boardContext.activeLane : 'dhq';
        const [boardLane, setBoardLane] = React.useState(initialLane);
        const posColors = window.App?.POS_COLORS || {};
        const normPos = window.App?.normPos || (p => p);
        const canPick = isUserTurn || state.overrideMode || state.mode === 'manual';
        const boardLaneMeta = {
            dhq: { label: 'Default Board', detail: 'DHQ value' },
            ai: { label: 'AI Recommended', detail: 'GM strategy' },
            my: { label: 'User Board', detail: 'manual order' },
        };
        const positions = React.useMemo(() => {
            const set = new Set();
            const addPos = raw => {
                const upper = String(raw || '').toUpperCase();
                if (!upper || ['BN', 'BE', 'BENCH', 'IR', 'TAXI', 'FLEX', 'WRRB_FLEX', 'WRRBTE_FLEX', 'REC_FLEX', 'SUPER_FLEX', 'OP'].includes(upper)) return;
                const pos = upper === 'D/ST' || upper === 'DST' ? 'DEF' : (normPos(upper) || upper);
                if (['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].includes(pos)) set.add(pos);
            };
            (state.pool || []).forEach(p => addPos(p.pos || p.position));
            (state.draftContext?.leagueFormat?.activeRosterSlots || state.draftContext?.leagueFormat?.rosterSlots || []).forEach(addPos);
            if (isRedraftBoard && !set.has('DEF')) set.add('DEF');
            const order = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6, DL: 7, LB: 8, DB: 9 };
            return Array.from(set).sort((a, b) => (order[a] || 99) - (order[b] || 99));
        }, [state.pool, state.draftContext?.leagueFormat, isRedraftBoard]);
        const lanePool = React.useMemo(() => {
            const pool = state.pool || [];
            const laneOrder = boardContext?.lanes?.[boardLane]?.order || [];
            if (!laneOrder.length) return pool.map((p, idx) => ({ ...p, boardRank: idx + 1 }));
            const byId = new Map();
            pool.forEach(p => {
                if (p?.pid) byId.set(String(p.pid), p);
                if (p?.csvPid) byId.set(String(p.csvPid), p);
            });
            const seen = new Set();
            const ordered = [];
            laneOrder.forEach(pid => {
                const player = byId.get(String(pid));
                if (!player || seen.has(String(player.pid))) return;
                seen.add(String(player.pid));
                ordered.push(player);
            });
            pool.forEach(player => {
                if (!seen.has(String(player.pid))) ordered.push(player);
            });
            return ordered.map((p, idx) => ({ ...p, boardRank: idx + 1 }));
        }, [state.pool, boardContext, boardLane]);
        const rows = React.useMemo(() => {
            const q = search.trim().toLowerCase();
            return lanePool.filter(p => {
                const rowPos = normPos(p.pos || p.position) || p.pos || p.position || '';
                if (posFilter && rowPos !== posFilter) return false;
                if (!q) return true;
                const hay = [p.name, p.pos, mockPlayerTeam(p), mockPlayerSchool(p)].join(' ').toLowerCase();
                return hay.includes(q);
            }).sort((a, b) => {
                if (sortKey === 'dhq') return sortDir * ((a.dhq || 0) - (b.dhq || 0));
                if (sortKey === 'fit') return sortDir * ((a.fit?.score || 0) - (b.fit?.score || 0));
                if (sortKey === 'tier') return sortDir * ((a.tier || a.csv?.tier || 99) - (b.tier || b.csv?.tier || 99));
                if (sortKey === 'rank') return sortDir * ((a.boardRank || 9999) - (b.boardRank || 9999));
                if (sortKey === 'name') return sortDir * String(a.name || '').localeCompare(String(b.name || ''));
                if (sortKey === 'pos') return sortDir * String(a.pos || '').localeCompare(String(b.pos || ''));
                if (sortKey === 'team') return sortDir * String(mockPlayerTeam(a)).localeCompare(String(mockPlayerTeam(b)));
                if (sortKey === 'school') return sortDir * String(mockPlayerSchool(a)).localeCompare(String(mockPlayerSchool(b)));
                return a.boardRank - b.boardRank;
            }).slice(0, 72);
        }, [lanePool, search, posFilter, sortKey, sortDir]);
        const setHeaderSort = key => {
            setSortKey(prev => {
                if (prev === key) {
                    setSortDir(dir => dir * -1);
                    return prev;
                }
                setSortDir(['rank', 'name', 'pos', 'team', 'school', 'tier'].includes(key) ? 1 : -1);
                return key;
            });
        };
        const sortArrow = key => sortKey === key ? (sortDir === -1 ? ' ▼' : ' ▲') : '';
        const headerCell = (label, key) => (
            <button type="button" className="mock-board-sort" onClick={() => setHeaderSort(key)} title={'Sort by ' + label}>
                {label}{sortArrow(key)}
            </button>
        );
        const boardGridStyle = {
            gridTemplateColumns: isRedraftBoard
                ? '28px minmax(0,1.52fr) 28px 36px 42px 30px 30px 40px'
                : undefined,
        };
        return (
            <section className="mock-panel mock-big-board">
                <div className="mock-panel-head">
                    <span>Big Board</span>
                    <em>{(state.pool || []).length} available · {boardLaneMeta[boardLane]?.detail}</em>
                </div>
                <div className="mock-board-lanes">
                    {['dhq', 'ai', 'my'].map(lane => (
                        <button key={lane} type="button" className={boardLane === lane ? 'is-active' : ''} onClick={() => { setBoardLane(lane); setSortKey('board'); }}>
                            <strong>{boardLaneMeta[lane].label}</strong>
                            <span>{boardLaneMeta[lane].detail}</span>
                        </button>
                    ))}
                </div>
                <div className="mock-board-tools">
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder={isRedraftBoard ? 'Search players, teams...' : 'Search players, teams, colleges...'} />
                    <select value={sortKey} onChange={e => {
                        const key = e.target.value;
                        setSortKey(key);
                        setSortDir(['rank', 'name', 'pos', 'team', 'school', 'tier'].includes(key) ? 1 : -1);
                    }}>
                        <option value="board">Board</option>
                        <option value="rank">Rank</option>
                        <option value="name">Player</option>
                        <option value="dhq">DHQ</option>
                        <option value="fit">Fit</option>
                        <option value="tier">Tier</option>
                    </select>
                </div>
                <div className="mock-board-pos">
                    <button type="button" className={!posFilter ? 'is-active' : ''} onClick={() => setPosFilter('')}>All</button>
                    {positions.map(pos => (
                        <button key={pos} type="button" className={posFilter === pos ? 'is-active' : ''} style={{ '--pos-color': posColors[pos] || 'var(--gold)' }} onClick={() => setPosFilter(posFilter === pos ? '' : pos)}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</button>
                    ))}
                </div>
                <div className="mock-board-head" style={boardGridStyle}>
                    {headerCell('Rank', 'rank')}{headerCell('Player', 'name')}{headerCell('Pos', 'pos')}{headerCell('NFL', 'team')}{!isRedraftBoard && headerCell('School', 'school')}{headerCell('DHQ', 'dhq')}{headerCell('Fit', 'fit')}{headerCell('Tier', 'tier')}<span>Action</span>
                </div>
                <div className="mock-board-scroll">
                    {rows.map(player => {
                        const fitScore = player.fit?.score || player.fitScore || 0;
                        const tier = player.tier || player.csv?.tier || '—';
                        const displayPos = normPos(player.pos || player.position) || player.pos || player.position || '—';
                        const rowClass = 'mock-board-row' + (player.boardRank === 1 ? ' is-board-one' : '') + (player.boardRank <= 8 ? ' is-premium' : '');
                        return (
                            <div key={player.pid} className={rowClass} style={boardGridStyle} onClick={() => mockOpenPlayer(player)}>
                                <span className="mock-rank">{player.boardRank}</span>
                                <strong>{player.name}</strong>
                                <span style={{ color: posColors[displayPos] || 'var(--gold)' }}>{window.App?.posLabel?.(displayPos) || (displayPos === 'DEF' ? 'D/ST' : displayPos)}</span>
                                <span>{mockPlayerTeam(player)}</span>
                                {!isRedraftBoard && <span>{mockPlayerSchool(player)}</span>}
                                <span className="mock-dhq">{mockFmt(player.dhq)}</span>
                                <span className={fitScore >= 70 ? 'is-good' : fitScore >= 45 ? 'is-ok' : ''}>{fitScore ? fitScore : '—'}</span>
                                <span>{tier}</span>
                                <button type="button" onClick={e => { e.stopPropagation(); mockMakePick(dispatch, state, isUserTurn, player); }}>{canPick ? 'Draft' : 'Open'}</button>
                            </div>
                        );
                    })}
                    {!rows.length && <div className="mock-empty">No players match the current board filters.</div>}
                </div>
            </section>
        );
    }

    function MockDecisionDeck({ state, dispatch, isUserTurn, currentSlot, onOpenTradeDesk }) {
        const pool = state.pool || [];
        const isRedraftBoard = state.variant === 'redraft' || state.draftContext?.draftType === 'redraft' || state.draftContext?.leagueFormat?.draftType === 'redraft';
        const best = pool[0] || null;
        const safe = pool.find(p => Number(p.tier || p.csv?.tier || 99) <= 2 && p !== best) || pool[1] || best;
        const upside = pool.find(p => (p.fit?.score || 0) >= 55 && p !== best && p !== safe) || pool[2] || best;
        const slotLabel = mockPickLabel(currentSlot);
        const pickWhy = (player, lane) => {
            if (!player) return 'I am waiting on the board to load.';
            const pos = player.pos || 'this spot';
            const team = mockPlayerTeam(player);
            const school = mockPlayerSchool(player);
            const established = isRedraftBoard || Number(player.yearsExp ?? player.years_exp ?? 1) > 0;
            const valueBand = Number(player.dhq || 0) >= 7000 ? 'elite weekly anchor'
                : Number(player.dhq || 0) >= 4500 ? 'premium starter'
                    : Number(player.dhq || 0) >= 2200 ? 'lineup starter'
                        : 'depth value';
            if (established) {
                if (lane === 'safe') return player.name + ' is the stability lane: a proven ' + pos + ' profile on ' + team + ', ' + valueBand + ' pricing, and less projection risk than the nearby tier.';
                if (lane === 'upside') return player.name + ' is not a generic upside dart. The ceiling case is proven NFL production plus spike-week access on ' + team + '; draft him when you want bankable points with a real weekly hammer.';
                return player.name + ' is my preferred pick because the current-season value clears replacement at ' + pos + '. In redraft, I care about role security, weekly ceiling, and how quickly the next tier falls off.';
            }
            if (lane === 'safe') return 'This is the low-variance answer: ' + pos + ' value, clean capital, and no need to chase a thinner pocket later.';
            if (lane === 'upside') return 'This is the ceiling swing: ' + school + ' profile, ' + team + ' landing spot, and enough fit to justify variance.';
            return 'This is my preferred pick because the board value still lines up with our roster build. I am not taking him just because he is listed first.';
        };
        const cards = [
            { key: 'rec', label: 'Recommended Pick', player: best, tone: '#2ECC71', text: pickWhy(best, 'rec') },
            { key: 'safe', label: 'Safe Pick', player: safe, tone: '#3498DB', text: pickWhy(safe, 'safe') },
            { key: 'upside', label: 'Upside Swing', player: upside, tone: '#9b8afb', text: pickWhy(upside, 'upside') },
            { key: 'trade', label: 'Trade Window', player: null, tone: 'var(--gold)', text: currentSlot ? 'I would listen if someone overpays. Aim for a top-40 pick or better to move off ' + slotLabel + '.' : 'No active trade window yet.' },
        ];
        return (
            <section className="mock-panel mock-decision-deck">
                <div className="mock-panel-head">
                    <span>Alex Decision Deck</span>
                    <em>{currentSlot ? slotLabel : 'waiting'}</em>
                </div>
                <div className="mock-decision-grid">
                    {cards.map(card => {
                        const p = card.player;
                        const photo = mockPlayerPhoto(p);
                        return (
                            <button key={card.key} type="button" className="mock-decision-card" style={{ '--accent': card.tone }} onClick={() => card.key === 'trade' ? onOpenTradeDesk?.() : mockMakePick(dispatch, state, isUserTurn, p)} disabled={card.key === 'trade' && !onOpenTradeDesk}>
                                <span>{card.label}</span>
                                {p ? (
                                    <div className="mock-decision-player">
                                        {photo ? <img src={photo} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <i>{mockInitials(p.name)}</i>}
                                        <div>
                                            <strong>{p.name}</strong>
                                            <em>{p.pos || '—'} · {mockPlayerTeam(p)} · DHQ {mockFmt(p.dhq)}</em>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mock-decision-player is-trade">
                                        <i>⇄</i>
                                        <div>
                                            <strong>{currentSlot ? 'Value ' + slotLabel : 'No window'}</strong>
                                            <em>Market: {state.activeOffer ? 'Paused' : 'Open'}</em>
                                        </div>
                                    </div>
                                )}
                                <p>{card.text}</p>
                            </button>
                        );
                    })}
                </div>
            </section>
        );
    }

    function MockPickLog({ state, currentSlot }) {
        const posColors = window.App?.POS_COLORS || {};
        const order = state.pickOrder || [];
        const picks = state.picks || [];
        const visible = picks.slice(-10).reverse();
        return (
            <section className="mock-panel mock-pick-log">
                <div className="mock-panel-head">
                    <span>Pick Log</span>
                    <em>{picks.length} / {order.length || '--'}</em>
                </div>
                <div className="mock-log-scroll">
                    {currentSlot && (
                        <div className="mock-log-row is-current">
                            <span>{mockPickLabel(currentSlot)}</span>
                            <strong>{mockTeamName(state, currentSlot.rosterId, currentSlot)}</strong>
                            <em>On clock</em>
                            <b>#{currentSlot.overall || '--'}</b>
                        </div>
                    )}
                    {visible.map(pick => {
                        const slot = order[(Number(pick.overall) || 1) - 1] || pick;
                        const valueNote = pick.reachSteal?.label || pick.valueLabel || (pick.dhq ? 'Value' : 'Logged');
                        return (
                            <div key={pick.id || pick.overall + '-' + pick.pid} className="mock-log-row" onClick={() => mockOpenPlayer(pick)}>
                                <span>{mockPickLabel(pick)}</span>
                                <strong>{mockTeamName(state, pick.rosterId, slot)}</strong>
                                <em><i style={{ color: posColors[pick.pos] || 'var(--gold)' }}>{pick.pos || '--'}</i> {pick.name}</em>
                                <b>{mockFmt(pick.dhq)} <small>{valueNote}</small></b>
                            </div>
                        );
                    })}
                    {!visible.length && !currentSlot && <div className="mock-empty">Start the draft to see picks as a running list.</div>}
                </div>
            </section>
        );
    }

    function MockRosterBuildCard({ state, grade }) {
        const players = window.S?.players || {};
        const rosters = window.S?.rosters || [];
        const scores = window.App?.LI?.playerScores || {};
        const normPos = window.App?.normPos || (p => p);
        const posColors = window.App?.POS_COLORS || {};
        const myPicks = (state.picks || []).filter(p => p.rosterId === state.userRosterId || p.isUser);
        const baseRoster = rosters.find(r => String(r.roster_id) === String(state.userRosterId));
        const grouped = {};
        const ageFor = (player) => {
            const rawAge = Number(player?.age || player?.csv?.age || 0);
            if (rawAge) return rawAge;
            if (player?.birth_date) {
                const born = new Date(player.birth_date).getTime();
                if (Number.isFinite(born)) return Math.floor((Date.now() - born) / 31557600000);
            }
            return 0;
        };
        const ageLimit = pos => ({ RB: 26, WR: 29, TE: 30, QB: 33, K: 34, DL: 30, LB: 29, DB: 29 }[pos] || 29);
        const add = (pos, dhq, isPick, player) => {
            const p = normPos(pos) || pos || '?';
            if (!grouped[p]) grouped[p] = { count: 0, dhq: 0, picks: 0, ages: [], ageRisk: 0 };
            const age = ageFor(player);
            grouped[p].count += 1;
            grouped[p].dhq += Number(dhq || 0);
            if (age) {
                grouped[p].ages.push(age);
                if (age >= ageLimit(p)) grouped[p].ageRisk += 1;
            }
            if (isPick) grouped[p].picks += 1;
        };
        (baseRoster?.players || []).forEach(pid => {
            const p = players[pid] || {};
            add(p.position, scores[pid] || 0, false, p);
        });
        myPicks.forEach(p => add(p.pos, p.dhq || 0, true, p));
        const positionTargets = { QB: 2, RB: 5, WR: 7, TE: 3, K: 1, DEF: 1, DL: 4, LB: 4, DB: 4 };
        const ordered = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB'].filter(pos => grouped[pos] || positionTargets[pos]);
        const totalDhq = Object.values(grouped).reduce((sum, row) => sum + row.dhq, 0);
        const draftDhq = myPicks.reduce((sum, p) => sum + Number(p.dhq || 0), 0);
        const maxDhq = Math.max(1, ...ordered.map(pos => grouped[pos]?.dhq || 0));
        const balanceScore = ordered.length
            ? Math.round(ordered.reduce((sum, pos) => {
                const row = grouped[pos] || { count: 0 };
                const target = positionTargets[pos] || 3;
                return sum + Math.min(1, row.count / target);
            }, 0) / ordered.length * 100)
            : 0;
        const leverageScore = Math.min(100, Math.round((draftDhq / Math.max(1, totalDhq || 1)) * 1000));
        const windowScore = Math.min(100, Math.round((totalDhq / 65000) * 100));
        const shapeRows = [
            { label: 'Contending Window', value: windowScore + '/100', pct: windowScore },
            { label: 'Roster Balance', value: balanceScore + '/100', pct: balanceScore },
            { label: 'Draft Leverage', value: leverageScore + '/100', pct: leverageScore },
        ];
        return (
            <section className="mock-panel mock-roster-card">
                <div className="mock-panel-head">
                    <span>My Roster Build</span>
                    <em>{myPicks.length} picks</em>
                </div>
                <div className="mock-roster-kpis">
                    <div><span>Roster DHQ</span><strong>{mockFmt(totalDhq)}</strong></div>
                    <div><span>Draft Added</span><strong>{mockFmt(draftDhq)}</strong></div>
                    <div><span>Draft Grade</span><strong>{grade?.letter || '--'}</strong><em>{grade?.letter ? mockFmt(grade.totalDHQ) + ' DHQ captured' : 'pending'}</em></div>
                </div>
                <div className="mock-roster-section">Position Health</div>
                <div className="mock-roster-legend" title="Soft track shows player count against the target. Bright track shows DHQ value weight against your strongest position.">
                    <span><i /> roster count</span>
                    <span><b /> value weight</span>
                </div>
                <div className="mock-roster-matrix">
                    {ordered.map(pos => {
                        const row = grouped[pos] || { count: 0, dhq: 0, picks: 0, ages: [], ageRisk: 0 };
                        const target = positionTargets[pos] || 3;
                        const countPct = Math.min(100, Math.round((row.count / target) * 100));
                        const valuePct = Math.min(100, Math.round((row.dhq / maxDhq) * 100));
                        const avgAge = row.ages.length ? (row.ages.reduce((sum, age) => sum + age, 0) / row.ages.length).toFixed(1) : '--';
                        const status = row.count < target ? 'thin players' : row.dhq < maxDhq * 0.55 ? 'thin value' : row.ageRisk ? 'age watch' : 'stable';
                        return (
                            <div key={pos} className="mock-roster-cell" style={{ '--pos-color': posColors[pos] || 'var(--gold)' }}>
                                <header>
                                    <span>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>
                                    <strong>{row.count}/{target}</strong>
                                </header>
                                <div className="mock-roster-bars" title="Soft bar = roster count vs target. Bright bar = DHQ value weight against your strongest position.">
                                    <i style={{ width: countPct + '%' }} />
                                    <b style={{ width: valuePct + '%' }} />
                                </div>
                                <footer>
                                    <span>{mockFmt(row.dhq)} DHQ</span>
                                    <em>{status} · age {avgAge}</em>
                                </footer>
                            </div>
                        );
                    })}
                </div>
                <div className="mock-roster-section is-shape">Roster Shape</div>
                <div className="mock-shape-bars">
                    {shapeRows.map(row => (
                        <div key={row.label} className="mock-shape-row">
                            <span>{row.label}</span>
                            <div><i style={{ width: row.pct + '%' }} /></div>
                            <em>{row.value}</em>
                        </div>
                    ))}
                </div>
            </section>
        );
    }

    function MockDraftCockpit({ state, dispatch, isUserTurn, currentSlot, onExit, onPropose, tradeDeskTarget, openTradeDesk, grade, canUndoManualPick }) {
        const OpponentIntelPanel = window.DraftCC.OpponentIntelPanel;
        const totalPicks = state.pickOrder?.length || 0;
        const progress = totalPicks ? Math.round(((state.currentIdx || 0) / totalPicks) * 100) : 0;
        const lastPick = state.picks?.[state.picks.length - 1] || null;
        const runReport = mockRunReport(state);
        const nextUserSlot = (state.pickOrder || []).slice(state.currentIdx || 0).find(slot =>
            String(slot?.rosterId || '') === String(state.userRosterId || '')
            || Number(slot?.slot) === Number(state.userSlot)
        );
        const currentName = currentSlot ? mockTeamName(state, currentSlot.rosterId, currentSlot) : 'Draft Room';
        const currentDisplayName = currentName.length > 36 ? currentName.slice(0, 35) + '...' : currentName;
        const timerLabel = state.activeOffer ? 'Paused' : state.speed === 'paused' ? 'Paused' : state.speed === 'fast' ? '0:35' : state.speed === 'slow' ? '4:00' : '2:15';
        const statusTiles = [
            { label: 'On Clock', value: currentName, detail: currentSlot ? '#' + (currentSlot.overall || '--') + ' · ' + mockPickLabel(currentSlot) : 'No active pick' },
            { label: 'Our Next Pick', value: nextUserSlot ? mockPickLabel(nextUserSlot) : 'No pick left', detail: nextUserSlot ? Math.max(0, (nextUserSlot.overall || 0) - (state.currentIdx || 0)) + ' picks away' : 'Watch the room' },
            { label: 'Last Pick', value: lastPick ? lastPick.name : 'No picks yet', detail: lastPick ? (lastPick.pos || '--') + ' · DHQ ' + mockFmt(lastPick.dhq) : 'Start the draft' },
            { label: 'League Evolution', value: runReport.value, detail: state.activeOffer ? 'Draft paused for negotiation' : runReport.detail, extra: runReport.bullets },
        ];
        return (
            <div className="mock-draft-cockpit">
                <section className="mock-draftcast-rail">
                    <div className="mock-cast-brand">
                        <div>DHQ</div>
                        <span>
                            <strong>DRAFTCAST MOCK</strong>
                            <em>{state.variant === 'startup' ? 'Dynasty Start Up' : state.variant} · {state.draftType} · {state.rounds} rounds · {state.leagueSize} teams</em>
                            <button type="button" onClick={onExit}>Mock Upcoming Draft</button>
                        </span>
                    </div>
                    <div className="mock-cast-clock">
                        <span>{state.activeOffer ? 'TRADE OFFER PAUSED' : 'ON THE CLOCK'}</span>
                        <strong>{currentDisplayName} - Pick {currentSlot ? mockPickLabel(currentSlot).replace('R', '') : '--'}</strong>
                        <div><i style={{ width: progress + '%' }} /></div>
                        <em>{state.currentIdx || 0} / {totalPicks || '--'}</em>
                    </div>
                    <div className="mock-cast-controls">
                        <div><span>Pick Timer</span><strong>{timerLabel}</strong></div>
                        <button type="button" onClick={() => dispatch({ type: 'SET_SPEED', speed: state.speed === 'paused' ? 'medium' : 'paused' })}>{state.speed === 'paused' ? 'Resume' : 'Pause'}</button>
                        <label>Speed <select value={state.speed === 'paused' ? 'medium' : state.speed} onChange={e => dispatch({ type: 'SET_SPEED', speed: e.target.value })}><option value="slow">Slow</option><option value="medium">Medium</option><option value="fast">Fast</option></select></label>
                        <button type="button" onClick={openTradeDesk} disabled={!tradeDeskTarget}>Trade Desk</button>
                        {canUndoManualPick && <button type="button" onClick={() => dispatch({ type: 'UNDO_LAST_PICK', manualOnly: true })}>Undo</button>}
                        <button type="button" onClick={onExit}>Exit</button>
                    </div>
                    <div className="mock-status-row">
                        {statusTiles.map(tile => (
                            <div key={tile.label} className={tile.extra ? 'has-extra' : ''}>
                                <span>{tile.label}</span>
                                <strong>{tile.value}</strong>
                                <em>{tile.detail}</em>
                                {tile.extra && (
                                    <ul className="mock-status-list">
                                        {tile.extra.map(item => <li key={item}>{item}</li>)}
                                    </ul>
                                )}
                            </div>
                        ))}
                    </div>
                </section>
                {state.scenarioNarrative && (
                    <div className="mock-scenario-strip">{state.scenarioNarrative}</div>
                )}
                <div className="mock-cockpit-grid">
                    <MockBigBoardTable state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    <div className="mock-center-stack">
                        <MockDecisionDeck state={state} dispatch={dispatch} isUserTurn={isUserTurn} currentSlot={currentSlot} onOpenTradeDesk={openTradeDesk} />
                        <MockPickLog state={state} currentSlot={currentSlot} />
                    </div>
                    <div className={'mock-right-stack' + (state.activeOffer ? ' has-trade-offer' : '')}>
                        <MockRosterBuildCard state={state} grade={grade} />
                        <MockTradeOfferPanel state={state} dispatch={dispatch} />
                        {OpponentIntelPanel && (
                            <div className="mock-opponent-shell">
                                <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // ── Drafting / complete grid ─────────────────────────────────────
    function CommandCenterGrid({ state, dispatch, isUserTurn, currentSlot, onExit, viewport, onPropose }) {
        const L = DRAFT_CC_LAYOUT;
        // Filter by rosterId so post-trade ownership is respected
        const myPicks = state.picks.filter(p => p.rosterId === state.userRosterId || p.isUser);
        const grade = window.DraftCC.state.gradeDraft(myPicks, state.originalPool);

        const BigBoardPanel = window.DraftCC.BigBoardPanel;
        const OpponentIntelPanel = window.DraftCC.OpponentIntelPanel;
        const AlexStreamPanel = window.DraftCC.AlexStreamPanel;
        const TradeModal = window.DraftCC.TradeModal;
        const TradeProposer = window.DraftCC.TradeProposer;

        // Header styles
        const headerCss = {
            minHeight: '118px',
            display: 'flex',
            alignItems: 'stretch',
            gap: '12px',
            flexWrap: 'wrap',
            padding: '12px 14px',
            background: 'linear-gradient(90deg, rgba(7,9,14,0.98), rgba(17,23,33,0.96) 42%, rgba(30,24,10,0.92))',
            border: '1px solid rgba(212,175,55,0.34)',
            borderRadius: '8px',
            marginBottom: (L.GRID_GAP) + 'px',
            boxShadow: 'inset 0 -1px 0 rgba(255,255,255,0.05), 0 10px 26px rgba(0,0,0,0.24)',
        };

        const speedBtn = (v) => ({
            padding: '4px 10px',
            fontSize: '0.68rem',
            fontFamily: FONT_UI,
            fontWeight: 600,
            background: state.speed === v ? 'rgba(212,175,55,0.15)' : 'transparent',
            color: state.speed === v ? 'var(--gold)' : 'var(--silver)',
            border: '1px solid ' + (state.speed === v ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.08)'),
            borderRadius: '4px',
            cursor: 'pointer',
            textTransform: 'capitalize',
        });

        const liveTradeWindow = React.useMemo(() => {
            if (state.mode !== 'live-sync' || state.phase !== 'drafting') return null;
            try {
                const windows = window.DraftCC.tradeSimulator?.buildLiveTradeWindows?.(state, { lookahead: 1, currentOnly: true }) || [];
                return windows[0] || null;
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.liveTradeWindow', e);
                return null;
            }
        }, [state.mode, state.phase, state.currentIdx, state.pickOrder, state.personas, state.tradedAssets, state.draftTuning, state.picks.length, state.userRosterId]);

        const tradeDeskTarget = React.useMemo(() => {
            if (liveTradeWindow?.rosterId) return liveTradeWindow.rosterId;
            const userRosterId = String(state.userRosterId || '');
            if (currentSlot?.rosterId && String(currentSlot.rosterId) !== userRosterId) {
                return currentSlot.rosterId;
            }
            const upcoming = (state.pickOrder || [])
                .slice(state.currentIdx)
                .find(slot => slot?.rosterId && String(slot.rosterId) !== userRosterId);
            if (upcoming?.rosterId) return upcoming.rosterId;
            const personaId = Object.keys(state.personas || {}).find(rosterId => String(rosterId) !== userRosterId);
            return personaId || null;
        }, [currentSlot, liveTradeWindow, state.currentIdx, state.personas, state.pickOrder, state.userRosterId]);

        const liveDecisionDeck = React.useMemo(() => {
            if (state.mode !== 'live-sync' || state.phase !== 'drafting') return null;
            try {
                return window.DraftCC.liveDecisionEngine?.buildDecisionDeck?.(state, { tradeWindow: liveTradeWindow }) || null;
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.liveDecisionDeck', e);
                return null;
            }
        }, [state.mode, state.phase, state.currentIdx, state.pool, state.pickOrder, state.draftContext, state.personas, state.draftedPids, state.userRosterId, liveTradeWindow]);

        const openTradeDesk = React.useCallback(() => {
            if (tradeDeskTarget) onPropose(tradeDeskTarget);
        }, [onPropose, tradeDeskTarget]);
        const learningSaveKeyRef = React.useRef('');
        React.useEffect(() => {
            const helpers = window.DraftCC?.state || {};
            if (state.phase !== 'complete' || !helpers.buildDraftRecap || !helpers.saveDraftLearning) return;
            const saveKey = [state.id, state.picks?.length || 0, grade.totalDHQ || 0].join(':');
            if (learningSaveKeyRef.current === saveKey) return;
            try {
                helpers.saveDraftLearning(helpers.buildDraftRecap(state, {
                    grade,
                    id: 'learning_' + (state.id || Date.now()),
                }));
                learningSaveKeyRef.current = saveKey;
            } catch (e) {
                if (window.wrLog) window.wrLog('cc.draftLearning', e);
            }
        }, [state.phase, state.id, state.picks?.length, grade.totalDHQ, grade.letter]);
        const lastPick = state.picks?.[state.picks.length - 1] || null;
        const canUndoManualPick = state.phase === 'drafting' && lastPick && (
            state.mode === 'manual' || lastPick.source === 'manual-live' || lastPick.source === 'manual-draft'
        );
        const pickLabelFor = slot => slot ? ('R' + (slot.round || '?') + '.' + String(slot.slot || 0).padStart(2, '0')) : '--';
        const shortDhq = n => {
            const v = Number(n || 0);
            return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : String(Math.round(v));
        };
        const teamNameFor = (rosterId, slot) => {
            const rid = String(rosterId || '');
            if (rid && state.personas?.[rid]?.teamName) return state.personas[rid].teamName;
            if (rid && String(rid) === String(state.userRosterId || '')) return 'Your Team';
            return slot?.ownerName || (slot?.slot ? 'Team ' + slot.slot : 'Draft Room');
        };
        const nextUserSlot = (state.pickOrder || []).slice(state.currentIdx || 0).find(slot =>
            String(slot?.rosterId || '') === String(state.userRosterId || '')
            || (state.mode !== 'live-sync' && Number(slot?.slot) === Number(state.userSlot))
        );
        const trendText = (() => {
            const counts = {};
            (state.picks || []).slice(-12).forEach(p => {
                const pos = p.pos || '?';
                counts[pos] = (counts[pos] || 0) + 1;
            });
            const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
            return rows.length ? rows.map(([pos, count]) => pos + ' x' + count).join(' - ') : 'No run yet';
        })();
        const liveStatusText = state.activeOffer
            ? 'Paused for trade offer'
            : state.phase === 'drafting'
                ? (isUserTurn ? 'You are on the clock' : 'CPU room is moving')
                : state.phase === 'complete'
                    ? 'Draft complete'
                    : 'Draft setup';
        const currentTeamName = currentSlot ? teamNameFor(currentSlot.rosterId, currentSlot) : 'Draft Room';
        const currentPickLabel = currentSlot ? pickLabelFor(currentSlot) + ' - #' + (currentSlot.overall || '--') : 'No active pick';
        const liveConfidenceCard = (() => {
            if (state.mode !== 'live-sync') return null;
            const live = state.liveSync || {};
            const status = live.status || 'idle';
            const stale = !!(live.stale || live.remoteBehind || (live.missingPickNos || []).length);
            if (status === 'complete') {
                return { label: 'Sync confidence', value: 'Complete', detail: 'Sleeper draft is finished', tone: 'var(--gold)' };
            }
            if (stale || status === 'stale' || status === 'error') {
                return { label: 'Sync confidence', value: 'Review', detail: live.error || 'Sleeper feed needs reconciliation', tone: '#E74C3C' };
            }
            if (status === 'mirroring') {
                return { label: 'Sync confidence', value: 'Healthy', detail: 'Last check ' + formatLiveClockTime(live.lastPollAt), tone: '#2ECC71' };
            }
            if (status === 'waiting') {
                return { label: 'Sync confidence', value: 'Waiting', detail: 'Polling Sleeper for pick 1', tone: '#F0A500' };
            }
            return { label: 'Sync confidence', value: 'Connecting', detail: 'Preparing live mirror', tone: 'rgba(155,138,251,0.98)' };
        })();
        const baseStageSummaryCards = [
            {
                label: 'Your next pick',
                value: nextUserSlot ? pickLabelFor(nextUserSlot) : 'No pick left',
                detail: nextUserSlot ? Math.max(0, (nextUserSlot.overall || 0) - (state.currentIdx || 0)) + ' picks away' : 'Watch the room',
                tone: '#2ECC71',
            },
            {
                label: 'Last pick',
                value: lastPick ? lastPick.name : 'No picks yet',
                detail: lastPick ? pickLabelFor(lastPick) + ' - ' + (lastPick.pos || '--') + ' - ' + shortDhq(lastPick.dhq || 0) + ' DHQ' : 'Start the draft',
                tone: 'var(--silver)',
            },
            {
                label: 'Room run',
                value: trendText,
                detail: liveStatusText,
                tone: 'rgba(155,138,251,0.98)',
            },
        ];
        const stageSummaryCards = liveConfidenceCard ? [liveConfidenceCard, ...baseStageSummaryCards] : baseStageSummaryCards;

        // Desktop grid or tablet collapse
        const isTablet = viewport === 'tablet';

        if (state.mode !== 'live-sync' && state.phase === 'drafting') {
            return (
                <>
                    <MockDraftCockpit
                        state={state}
                        dispatch={dispatch}
                        isUserTurn={isUserTurn}
                        currentSlot={currentSlot}
                        onExit={onExit}
                        onPropose={onPropose}
                        tradeDeskTarget={tradeDeskTarget}
                        openTradeDesk={openTradeDesk}
                        grade={grade}
                        canUndoManualPick={canUndoManualPick}
                    />
                    {state.activeOffer && TradeModal && <TradeModal state={state} dispatch={dispatch} />}
                    {state.proposerDrawer && TradeProposer && <TradeProposer state={state} dispatch={dispatch} />}
                </>
            );
        }

        return (
            <div style={{ fontFamily: FONT_UI, paddingBottom: '12px' }}>
                {/* ── HEADER ───────────────────────────────────────── */}
                <div style={headerCss}>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(110px, 1fr)',
                        gap: '10px',
                        alignItems: 'center',
                        minWidth: 210,
                        flex: '0 0 230px',
                    }}>
                        <div style={{
                            width: 44,
                            height: 44,
                            borderRadius: '7px',
                            display: 'grid',
                            placeItems: 'center',
                            background: 'var(--gold)',
                            color: 'var(--black)',
                            fontFamily: FONT_DISPL,
                            fontSize: '0.72rem',
                            fontWeight: 900,
                            letterSpacing: '0.08em',
                        }}>DHQ</div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontSize: '0.84rem', fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>DraftCast</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.58rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.09em' }}>{state.mode} - {state.variant}</div>
                        </div>
                    </div>

                    <div style={{
                        minWidth: 340,
                        flex: '1 1 420px',
                        borderLeft: '4px solid var(--gold)',
                        padding: '7px 0 7px 14px',
                    }}>
                        <div style={{ color: state.activeOffer ? '#F0A500' : 'var(--gold)', fontSize: '0.56rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                            {state.activeOffer ? 'Trade offer on deck' : 'On the clock'}
                        </div>
                        <div style={{ color: 'var(--white)', fontFamily: FONT_DISPL, fontSize: '1.62rem', fontWeight: 900, lineHeight: 1.02, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentTeamName}
                        </div>
                        <div style={{ color: 'var(--silver)', opacity: 0.76, fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {currentPickLabel} - {liveStatusText}
                        </div>
                    </div>

                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(' + stageSummaryCards.length + ', minmax(110px, 1fr))',
                        gap: '7px',
                        minWidth: stageSummaryCards.length > 3 ? 480 : 360,
                        flex: stageSummaryCards.length > 3 ? '1 1 560px' : '1 1 440px',
                    }}>
                        {stageSummaryCards.map(card => (
                            <div key={card.label} style={{
                                minWidth: 0,
                                border: '1px solid rgba(212,175,55,0.14)',
                                background: 'rgba(255,255,255,0.024)',
                                borderRadius: '7px',
                                padding: '8px 9px',
                            }}>
                                <div style={{ color: card.tone, fontSize: '0.52rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 3 }}>{card.label}</div>
                                <div style={{ color: 'var(--white)', fontSize: '0.76rem', fontWeight: 850, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.value}</div>
                                <div style={{ color: 'var(--silver)', opacity: 0.66, fontSize: '0.58rem', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{card.detail}</div>
                            </div>
                        ))}
                    </div>

                    {/* Progress */}
                    <div style={{ flex: '1 1 220px', display: 'flex', alignItems: 'center', gap: '8px', minWidth: 180 }}>
                        <div style={{
                            flex: 1,
                            height: 4,
                            background: 'rgba(255,255,255,0.06)',
                            borderRadius: 2,
                            overflow: 'hidden',
                        }}>
                            <div style={{
                                width: Math.round((state.currentIdx / state.pickOrder.length) * 100) + '%',
                                height: '100%',
                                background: 'var(--gold)',
                                transition: 'width 0.4s ease',
                            }} />
                        </div>
                        <span style={{ fontSize: '0.64rem', color: 'var(--silver)', flexShrink: 0 }}>
                            {state.currentIdx} / {state.pickOrder.length}
                        </span>
                    </div>

                    {/* Grade live indicator */}
                    {myPicks.length > 0 && (
                        <div style={{
                            padding: '4px 10px',
                            background: 'rgba(212,175,55,0.08)',
                            border: '1px solid rgba(212,175,55,0.25)',
                            borderRadius: '4px',
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: 'var(--gold)',
                        }}>
                            {grade.letter} · {grade.totalDHQ >= 1000 ? (grade.totalDHQ / 1000).toFixed(1) + 'k' : grade.totalDHQ} DHQ
                        </div>
                    )}

                    {/* Speed buttons */}
                    {state.phase === 'drafting' && state.mode !== 'live-sync' && state.mode !== 'manual' && (
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            {['slow', 'medium', 'fast', 'paused'].map(v => (
                                <button key={v} onClick={() => dispatch({ type: 'SET_SPEED', speed: v })} style={speedBtn(v)}>
                                    {v === 'paused' ? '⏸' : v}
                                </button>
                            ))}
                        </div>
                    )}

                    {state.phase === 'drafting' && tradeDeskTarget && (
                        <button
                            onClick={openTradeDesk}
                            title="Open trade proposer"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(212,175,55,0.12)',
                                border: '1px solid rgba(212,175,55,0.35)',
                                borderRadius: '4px',
                                color: 'var(--gold)',
                                cursor: 'pointer',
                                fontSize: '0.66rem',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                            }}
                        >
                            ⇄ TRADE
                        </button>
                    )}

                    {canUndoManualPick && (
                        <button
                            onClick={() => dispatch({ type: 'UNDO_LAST_PICK', manualOnly: true })}
                            title="Undo the last manual pick entry"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(155,138,251,0.12)',
                                border: '1px solid rgba(155,138,251,0.35)',
                                borderRadius: '4px',
                                color: 'rgba(214,208,255,0.98)',
                                cursor: 'pointer',
                                fontSize: '0.66rem',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 700,
                                letterSpacing: '0.04em',
                            }}
                        >
                            UNDO PICK
                        </button>
                    )}

                    {/* Phase 5: Save template button */}
                    {myPicks.length > 0 && (
                        <button
                            onClick={() => {
                                const defaultName = 'Mock ' + new Date().toLocaleString();
                                const name = prompt('Template name:', defaultName);
                                if (!name) return;
                                const rec = window.DraftCC.persistence?.saveTemplate(state, name);
                                if (rec) {
                                    dispatch({
                                        type: 'ALEX_EVENT_ADD',
                                        event: {
                                            type: 'rule',
                                            badge: '💾',
                                            color: '#2ECC71',
                                            title: 'Template saved',
                                            text: '"' + rec.name + '" · load later from the setup screen',
                                        },
                                    });
                                }
                            }}
                            title="Save this draft as a template"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(46,204,113,0.12)',
                                border: '1px solid rgba(46,204,113,0.3)',
                                borderRadius: '4px',
                                color: '#2ECC71',
                                cursor: 'pointer',
                                fontSize: '0.66rem',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 600,
                            }}>💾 SAVE</button>
                    )}

                    {/* Phase 4: Export PNG button */}
                    {myPicks.length > 0 && (
                        <button
                            onClick={() => window.DraftCC.exports?.downloadDraftCard(state)}
                            title="Export pick card as PNG"
                            style={{
                                padding: '5px 10px',
                                background: 'rgba(124,107,248,0.12)',
                                border: '1px solid rgba(124,107,248,0.3)',
                                borderRadius: '4px',
                                color: 'rgba(155,138,251,0.9)',
                                cursor: 'pointer',
                                fontSize: '0.66rem',
                                fontFamily: FONT_UI,
                                flexShrink: 0,
                                fontWeight: 600,
                            }}>📥 EXPORT</button>
                    )}

                    <button onClick={onExit} style={{
                        padding: '5px 12px',
                        background: 'transparent',
                        border: '1px solid rgba(255,255,255,0.1)',
                        borderRadius: '4px',
                        color: 'var(--silver)',
                        cursor: 'pointer',
                        fontSize: '0.68rem',
                        fontFamily: FONT_UI,
                        flexShrink: 0,
	                    }}>Exit</button>
	                </div>

                {state.mode === 'live-sync' ? (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: liveTradeWindow ? 'repeat(auto-fit, minmax(320px, 1fr))' : '1fr',
                        gap: L.GRID_GAP + 'px',
                        alignItems: 'stretch',
                        marginBottom: L.GRID_GAP + 'px',
                    }}>
	                    <LiveSyncCommandReadPanel
                            state={state}
                            liveSync={state.liveSync}
                            currentSlot={currentSlot}
                            nextUserSlot={nextUserSlot}
                            trendText={trendText}
                            dispatch={dispatch}
                            inline
                        />
                        <LiveTradeWindowBanner
                            tradeWindow={liveTradeWindow}
                            onOpen={() => liveTradeWindow?.rosterId && onPropose(liveTradeWindow.rosterId)}
                            inline
                        />
                    </div>
                ) : (
                    <LiveTradeWindowBanner
                        tradeWindow={liveTradeWindow}
                        onOpen={() => liveTradeWindow?.rosterId && onPropose(liveTradeWindow.rosterId)}
                        layoutGap={L.GRID_GAP}
                    />
                )}

                {state.mode === 'live-sync' && (state.stagedLiveOffers || []).length > 0 && (
                    <StagedLiveOffersPanel
                        offers={state.stagedLiveOffers || []}
                        sleeperDraftId={state.sleeperDraftId}
                        dispatch={dispatch}
                        layoutGap={L.GRID_GAP}
                    />
                )}

                {state.mode === 'live-sync' && liveDecisionDeck && (
                    <LiveDecisionDeckPanel
                        deck={liveDecisionDeck}
                        onTrade={openTradeDesk}
                        layoutGap={L.GRID_GAP}
                    />
                )}

                {/* Phase 5: Scenario / Ghost replay narrative banner */}
                {state.scenarioNarrative && state.mode !== 'live-sync' && (
                    <div style={{
                        padding: '8px 14px',
                        marginBottom: L.GRID_GAP + 'px',
                        background: 'linear-gradient(90deg, rgba(212,175,55,0.15), rgba(212,175,55,0.02))',
                        border: '1px solid rgba(212,175,55,0.35)',
                        borderRadius: '6px',
                        fontSize: '0.72rem',
                        color: 'var(--gold)',
                        fontWeight: 600,
                        fontFamily: FONT_UI,
                    }}>
                        {state.scenarioNarrative}
                    </div>
                )}

                {/* Phase 5: Ghost replay scrubber */}
                {state.mode === 'ghost' && state.replay && (
                    <div style={{
                        padding: '10px 14px',
                        marginBottom: L.GRID_GAP + 'px',
                        background: 'rgba(124,107,248,0.05)',
                        border: '1px solid rgba(124,107,248,0.3)',
                        borderRadius: '6px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        fontFamily: FONT_UI,
                    }}>
                        <span style={{ fontSize: '1rem' }}>👻</span>
                        <span style={{ fontSize: '0.68rem', color: 'rgba(155,138,251,0.9)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Ghost Replay
                        </span>
                        <input
                            type="range"
                            min={0}
                            max={state.replay.totalPicks}
                            value={state.currentIdx}
                            onChange={e => dispatch({ type: 'REPLAY_SEEK', idx: parseInt(e.target.value) })}
                            style={{ flex: 1, cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.68rem', color: 'var(--silver)', fontFamily: "'JetBrains Mono', monospace", minWidth: 60, textAlign: 'right' }}>
                            {state.currentIdx} / {state.replay.totalPicks}
                        </span>
                    </div>
                )}

                {/* ── TOP ROW: Big Board / Roster Build / Opponent Intel ───── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isTablet ? '1fr 1fr' : 'minmax(0, 1.55fr) minmax(320px, 0.7fr) minmax(340px, 0.8fr)',
                    gap: L.GRID_GAP + 'px',
                    height: isTablet ? 'auto' : 'clamp(520px, 58vh, 680px)',
                    marginBottom: L.GRID_GAP + 'px',
                }}>
                    <div style={{ minHeight: isTablet ? 500 : '100%', minWidth: 0 }}>
                        <BigBoardPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    </div>
                    <div style={{ minHeight: isTablet ? 500 : '100%', minWidth: 0 }}>
                        <MyDraftRosterPanel state={state} />
                    </div>
                    {!isTablet && (
                        <div style={{ minHeight: '100%', minWidth: 0 }}>
                            <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                        </div>
                    )}
                </div>

                {/* ── BOTTOM ROW: Pick List / Alex Stream ───── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isTablet
                        ? '1fr 1fr'
                        : 'minmax(0, 1.15fr) minmax(360px, 0.85fr)',
                    gap: L.GRID_GAP + 'px',
                    height: isTablet ? 'auto' : 'clamp(260px, 28vh, 360px)',
                }}>
                    {isTablet && (
                        <div style={{ minHeight: 240, minWidth: 0 }}>
                            <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                        </div>
                    )}
	                    <div style={{ minHeight: isTablet ? 240 : '100%', minWidth: 0 }}>
	                        <DraftPickListPanel state={state} currentSlot={currentSlot} />
                    </div>
                    <div style={{ minHeight: isTablet ? 240 : '100%', minWidth: 0 }}>
                        <AlexStreamPanel state={state} dispatch={dispatch} />
                    </div>
                </div>

                {/* Phase 3: CPU trade offer modal (fixed-position) */}
                {state.activeOffer && TradeModal && <TradeModal state={state} dispatch={dispatch} />}

                {/* Phase 3: User trade proposer drawer (fixed-position) */}
                {state.proposerDrawer && TradeProposer && <TradeProposer state={state} dispatch={dispatch} />}

                {/* Phase 7: Post-draft recap — full-screen modal with grade + per-position + roster + export */}
                {state.phase === 'complete' && (() => {
                    const stateHelpers = window.DraftCC?.state || {};
                    const recap = stateHelpers.buildDraftRecap
                        ? stateHelpers.buildDraftRecap(state, { grade })
                        : null;
                    // Build per-position summary from myPicks
                    const posSummary = {};
                    (myPicks || []).forEach(pk => {
                        const normalized = stateHelpers.normalizePickRecord ? stateHelpers.normalizePickRecord(pk) : pk;
                        const pos = (normalized?.pos || pk.player?.position || pk.pos || '').toUpperCase();
                        if (!pos) return;
                        if (!posSummary[pos]) posSummary[pos] = { count: 0, dhq: 0, players: [] };
                        posSummary[pos].count += 1;
                        posSummary[pos].dhq += (normalized?.dhq || pk.player?.dhq || pk.dhq || 0);
                        posSummary[pos].players.push(normalized?.name || pk.player?.full_name || pk.player?.name || pk.name || pk.pid);
                    });
                    const POS_ORDER = ['QB','RB','WR','TE','K','DEF','DL','LB','DB'];
                    const orderedPositions = POS_ORDER.filter(p => posSummary[p]).concat(Object.keys(posSummary).filter(p => !POS_ORDER.includes(p)));

                    const gradeColor = grade.letter.startsWith('A') ? '#2ECC71' : grade.letter.startsWith('B') ? '#D4AF37' : grade.letter.startsWith('C') ? '#F0A500' : '#E74C3C';
                    const teamRecaps = recap?.teamRecaps || [];
                    const actionPlan = recap?.actionPlan || [];
                    const leagueStorylines = recap?.leagueStorylines || [];
                    const tradeImpact = recap?.tradeImpact || { count: 0, summary: 'No accepted draft trades on record.' };
                    const bestPick = recap?.bestPick || null;
                    const biggestReach = recap?.biggestReach || null;
                    const missedTarget = recap?.missedTarget || null;
                    const bestAlternative = recap?.bestAlternative || null;
                    const postDraftMoves = recap?.postDraftMoves || {};
                    const recapPositions = recap?.positionSummary?.length
                        ? recap.positionSummary
                        : orderedPositions.map(pos => ({ pos, ...posSummary[pos] }));
                    const fmtDhq = value => {
                        const n = Number(value || 0);
                        return n ? n.toLocaleString() : '—';
                    };
                    const openRecapPlayer = pid => {
                        if (!pid) return;
                        if (typeof window.openPlayerModal === 'function') {
                            try { window.openPlayerModal(pid); return; } catch (_) {}
                        }
                        if (window.WR?.openPlayerCard) {
                            try { window.WR.openPlayerCard(pid); } catch (_) {}
                        }
                    };
                    const insightCard = (label, value, detail, color, onClick) => (
                        <button
                            type="button"
                            onClick={onClick}
                            disabled={!onClick}
                            style={{
                                textAlign: 'left',
                                padding: '12px 14px',
                                background: 'rgba(255,255,255,0.03)',
                                border: '1px solid rgba(255,255,255,0.08)',
                                borderLeft: '3px solid ' + (color || 'rgba(212,175,55,0.55)'),
                                borderRadius: '8px',
                                cursor: onClick ? 'pointer' : 'default',
                                fontFamily: FONT_UI,
                                minHeight: '92px',
                            }}
                        >
                            <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.68, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{label}</div>
                            <div style={{ color: color || 'var(--white)', fontWeight: 800, fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || '—'}</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.74, fontSize: '0.68rem', lineHeight: 1.45, marginTop: '4px' }}>{detail || 'No signal yet.'}</div>
                        </button>
                    );

                    // League-wide percentile — how our total DHQ ranks
                    const allDraftTotals = recap?.leagueTotals || (stateHelpers.leagueTotalsFromPicks ? stateHelpers.leagueTotalsFromPicks(state.picks || []) : {});
                    const totals = Object.values(allDraftTotals).sort((a, b) => b - a);
                    const myRank = recap?.rank || (totals.indexOf(grade.totalDHQ) + 1);
                    const myPct = recap?.percentile ?? (totals.length ? Math.round(((totals.length - myRank) / Math.max(1, totals.length - 1)) * 100) : 0);

                    return (
                        <div style={{
                            position: 'fixed', inset: 0, background: 'rgba(5,6,9,0.82)',
                            zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '24px', animation: 'wrFadeIn 0.2s ease'
                        }} onClick={e => { if (e.target === e.currentTarget) onExit && onExit(); }}>
                            <div style={{
                                width: '100%', maxWidth: '1080px', maxHeight: '92vh', overflowY: 'auto',
                                background: '#0a0b0d', border: '2px solid ' + gradeColor + '55',
                                borderRadius: '16px', boxShadow: '0 32px 96px rgba(0,0,0,0.8)',
                            }}>
                                {/* Hero */}
                                <div style={{ padding: '28px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'linear-gradient(135deg, ' + gradeColor + '15, transparent 70%)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '6px' }}>Draft Complete — Recap</div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                        <div style={{ fontFamily: FONT_DISPL, fontSize: '5.5rem', fontWeight: 700, color: gradeColor, lineHeight: 1 }}>{grade.letter}</div>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Overall Draft Grade</div>
                                            <div style={{ fontSize: '0.96rem', color: 'var(--white)', marginTop: '6px', lineHeight: 1.5 }}>
                                                Total DHQ: <strong style={{ color: gradeColor }}>{grade.totalDHQ.toLocaleString()}</strong> across {myPicks.length} pick{myPicks.length === 1 ? '' : 's'} · {grade.pct}% value capture
                                            </div>
                                            {totals.length >= 3 && (
                                                <div style={{ fontSize: '0.82rem', color: 'var(--silver)', marginTop: '4px' }}>
                                                    You finished <strong style={{ color: myRank <= 3 ? '#2ECC71' : myRank <= totals.length / 2 ? 'var(--gold)' : '#E74C3C' }}>#{myRank}</strong> of {totals.length} teams by draft DHQ ({myPct}th percentile)
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* P4 strategic readout */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Strategic Readout</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
                                        {insightCard(
                                            'Best Pick',
                                            bestPick ? `${bestPick.name} #${bestPick.overall}` : 'No pick',
                                            bestPick ? `${bestPick.pos || '?'} · ${fmtDhq(bestPick.dhq)} DHQ${bestPick.valueDelta > 0 ? ' · +' + bestPick.valueDelta + ' value slots' : ''}` : 'Make a pick to generate a value read.',
                                            '#2ECC71',
                                            bestPick?.pid ? () => openRecapPlayer(bestPick.pid) : null
                                        )}
                                        {insightCard(
                                            'Biggest Reach',
                                            biggestReach ? `${biggestReach.name} #${biggestReach.overall}` : 'None flagged',
                                            biggestReach ? `${Math.abs(biggestReach.valueDelta || 0)} slots ahead of board. Check if your note justified the bet.` : 'No user pick was far enough off board to flag.',
                                            biggestReach ? '#F0A500' : 'var(--silver)',
                                            biggestReach?.pid ? () => openRecapPlayer(biggestReach.pid) : null
                                        )}
                                        {insightCard(
                                            'Missed Target',
                                            missedTarget ? `${missedTarget.name} #${missedTarget.overall}` : 'No tagged loss',
                                            missedTarget ? missedTarget.message : 'Targets and Must tags survived or were not set.',
                                            missedTarget ? '#E74C3C' : 'var(--silver)',
                                            missedTarget?.pid ? () => openRecapPlayer(missedTarget.pid) : null
                                        )}
                                        {insightCard(
                                            'Best Alternative',
                                            bestAlternative?.alternative ? bestAlternative.alternative.name : 'No better DHQ miss',
                                            bestAlternative?.message || 'Your selections did not leave a higher-DHQ player behind at the same slot.',
                                            bestAlternative?.alternative ? '#3498DB' : 'var(--silver)',
                                            bestAlternative?.alternative?.pid ? () => openRecapPlayer(bestAlternative.alternative.pid) : null
                                        )}
                                        {insightCard(
                                            'Trade Impact',
                                            tradeImpact.count ? `${tradeImpact.netDHQ >= 0 ? '+' : ''}${fmtDhq(tradeImpact.netDHQ)} DHQ` : 'No trades',
                                            tradeImpact.summary,
                                            tradeImpact.netDHQ >= 0 ? '#2ECC71' : '#E74C3C',
                                            null
                                        )}
                                    </div>
                                </div>

                                {/* Action plan */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Post-Draft Action Plan</div>
                                    <div style={{ display: 'grid', gap: '8px' }}>
                                        {(actionPlan.length ? actionPlan : [{ title: 'Save this recap', detail: 'Use it as the next mock draft input.', type: 'prep_loop' }]).map((item, i) => (
                                            <div key={item.type || i} style={{ display: 'grid', gridTemplateColumns: '28px minmax(0,1fr)', gap: '10px', alignItems: 'start', padding: '10px 12px', background: 'rgba(212,175,55,0.045)', border: '1px solid rgba(212,175,55,0.10)', borderRadius: '8px' }}>
                                                <div style={{ width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(212,175,55,0.16)', color: 'var(--gold)', fontWeight: 900, fontSize: '0.68rem' }}>{i + 1}</div>
                                                <div>
                                                    <div style={{ color: 'var(--white)', fontWeight: 800, fontSize: '0.82rem' }}>{item.title}</div>
                                                    <div style={{ color: 'var(--silver)', opacity: 0.78, fontSize: '0.74rem', lineHeight: 1.5, marginTop: '2px' }}>{item.detail}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* P4B next moves */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Next Moves</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '10px' }}>
                                        <div style={{ padding: '11px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}>
                                            <div style={{ color: '#2ECC71', fontWeight: 800, fontSize: '0.72rem', marginBottom: 6 }}>Waiver Watch</div>
                                            {(postDraftMoves.waiverTargets || []).slice(0, 3).map(p => (
                                                <button key={p.pid || p.name} type="button" onClick={() => p.pid && openRecapPlayer(p.pid)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 0', border: 'none', background: 'transparent', color: 'var(--white)', fontFamily: FONT_UI, cursor: p.pid ? 'pointer' : 'default' }}>
                                                    <span style={{ fontWeight: 800 }}>{p.name}</span>
                                                    <span style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.66rem' }}> - {p.pos} - {fmtDhq(p.dhq)} DHQ</span>
                                                </button>
                                            ))}
                                            {!(postDraftMoves.waiverTargets || []).length && <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.7rem' }}>No immediate waiver watchlist from this recap.</div>}
                                        </div>
                                        <div style={{ padding: '11px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}>
                                            <div style={{ color: '#3498DB', fontWeight: 800, fontSize: '0.72rem', marginBottom: 6 }}>Trade Map</div>
                                            {(postDraftMoves.tradeTargets || []).slice(0, 3).map((t, i) => (
                                                <div key={(t.rosterId || t.teamName || i) + '-' + t.pos} style={{ color: 'var(--silver)', fontSize: '0.68rem', lineHeight: 1.45, padding: '4px 0' }}>
                                                    <strong style={{ color: 'var(--white)' }}>{t.teamName}</strong> - {t.pos} surplus around {t.player?.name || 'new draft capital'}
                                                </div>
                                            ))}
                                            {!(postDraftMoves.tradeTargets || []).length && <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.7rem' }}>No clear surplus trade lane yet.</div>}
                                        </div>
                                        <div style={{ padding: '11px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.025)' }}>
                                            <div style={{ color: '#F0A500', fontWeight: 800, fontSize: '0.72rem', marginBottom: 6 }}>Cut Review</div>
                                            {(postDraftMoves.cutCandidates || []).slice(0, 3).map(p => (
                                                <button key={p.pid || p.name} type="button" onClick={() => p.pid && openRecapPlayer(p.pid)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 0', border: 'none', background: 'transparent', color: 'var(--white)', fontFamily: FONT_UI, cursor: p.pid ? 'pointer' : 'default' }}>
                                                    <span style={{ fontWeight: 800 }}>{p.name}</span>
                                                    <span style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.66rem' }}> - {p.pos || 'depth'} - {fmtDhq(p.dhq)} DHQ</span>
                                                </button>
                                            ))}
                                            {!(postDraftMoves.cutCandidates || []).length && <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.7rem' }}>No cut-pressure candidates available from loaded roster data.</div>}
                                        </div>
                                    </div>
                                </div>

                                {/* Per-position breakdown */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Positional Breakdown</div>
                                    {recapPositions.length ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                            {recapPositions.map(s => {
                                                const pos = s.pos;
                                                const posCol = (window.App?.POS_COLORS || {})[pos] || 'var(--silver)';
                                                return <div key={pos} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', borderLeft: '3px solid ' + posCol }}>
                                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: posCol, letterSpacing: '0.04em' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</div>
                                                    <div style={{ fontFamily: FONT_DISPL, fontSize: '1.2rem', fontWeight: 700, color: 'var(--white)', marginTop: '2px' }}>{s.count}</div>
                                                    <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.7 }}>{s.dhq.toLocaleString()} DHQ</div>
                                                </div>;
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No picks on record.</div>}
                                </div>

                                {/* Pick-by-pick roster list */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Your Draft Class</div>
                                    {(myPicks || []).length ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            {myPicks.map((pk, i) => {
                                                const normalized = stateHelpers.normalizePickRecord ? stateHelpers.normalizePickRecord(pk) : pk;
                                                const p = pk.player || {};
                                                const pos = (normalized?.pos || p.position || pk.pos || '').toUpperCase();
                                                const posCol = (window.App?.POS_COLORS || {})[pos] || 'var(--silver)';
                                                const dhq = normalized?.dhq || p.dhq || pk.dhq || 0;
                                                const dhqCol = dhq >= 7000 ? '#2ECC71' : dhq >= 4000 ? '#3498DB' : 'var(--silver)';
                                                return <div
                                                    key={i}
                                                    onClick={() => openRecapPlayer(normalized?.pid || pk.pid)}
                                                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)', cursor: (normalized?.pid || pk.pid) ? 'pointer' : 'default' }}
                                                >
                                                    <span style={{ fontFamily: FONT_DISPL, fontSize: '0.72rem', color: 'var(--gold)', width: '48px' }}>
                                                        {pk.round && pk.pickInRound ? (pk.round + '.' + String(pk.pickInRound).padStart(2, '0')) : ('#' + (i + 1))}
                                                    </span>
                                                    <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + pk.pid + '.jpg'} alt="" onError={e => e.target.style.display = 'none'} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                                                    <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--white)', fontWeight: 600 }}>{normalized?.name || p.full_name || p.name || pk.name || pk.pid}</span>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: posCol, padding: '1px 6px', background: 'rgba(0,0,0,0.4)', borderRadius: '3px' }}>{window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos)}</span>
                                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '0.82rem', color: dhqCol, minWidth: '56px', textAlign: 'right' }}>{dhq > 0 ? dhq.toLocaleString() : '—'}</span>
                                                </div>;
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No picks made.</div>}
                                </div>

                                {/* League-wide recap */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>League Recap</div>
                                    {leagueStorylines.length > 0 && (
                                        <div style={{ display: 'grid', gap: '6px', marginBottom: '12px' }}>
                                            {leagueStorylines.slice(0, 4).map((line, i) => (
                                                <div key={i} style={{ fontSize: '0.76rem', color: 'var(--silver)', lineHeight: 1.45, padding: '7px 10px', background: 'rgba(255,255,255,0.025)', borderRadius: '6px' }}>{line}</div>
                                            ))}
                                        </div>
                                    )}
                                    {teamRecaps.length ? (
                                        <div style={{ display: 'grid', gap: '6px' }}>
                                            {teamRecaps.slice(0, 12).map(team => {
                                                const isUser = String(team.rosterId) === String(state.userRosterId);
                                                const topPlayer = team.topPick || team.picks?.[0];
                                                const gradeCol = team.grade?.startsWith('A') ? '#2ECC71' : team.grade?.startsWith('B') ? 'var(--gold)' : team.grade?.startsWith('C') ? '#F0A500' : '#E74C3C';
                                                return (
                                                    <div key={team.rosterId || team.teamName} style={{
                                                        display: 'grid',
                                                        gridTemplateColumns: '36px minmax(0,1.35fr) 56px 86px minmax(0,1fr) 84px',
                                                        gap: '10px',
                                                        alignItems: 'center',
                                                        padding: '8px 10px',
                                                        borderRadius: '7px',
                                                        border: '1px solid ' + (isUser ? 'rgba(212,175,55,0.28)' : 'rgba(255,255,255,0.06)'),
                                                        background: isUser ? 'rgba(212,175,55,0.07)' : 'rgba(255,255,255,0.022)',
                                                    }}>
                                                        <div style={{ color: isUser ? 'var(--gold)' : 'var(--silver)', fontFamily: FONT_MONO, fontSize: '0.72rem', fontWeight: 800 }}>#{team.rank}</div>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                dispatch({ type: 'PIN_TEAM', rosterId: team.rosterId });
                                                            }}
                                                            style={{ minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: 'var(--white)', textAlign: 'left', cursor: 'pointer', fontFamily: FONT_UI }}
                                                            title="Pin this team in opponent intel"
                                                        >
                                                            <div style={{ fontWeight: 800, fontSize: '0.78rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.teamName}</div>
                                                            <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.62rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{team.buildLabel}</div>
                                                        </button>
                                                        <div style={{ color: gradeCol, fontFamily: FONT_DISPL, fontSize: '1rem', fontWeight: 900 }}>{team.grade}</div>
                                                        <div style={{ color: 'var(--silver)', fontSize: '0.7rem', fontFamily: FONT_MONO, textAlign: 'right' }}>{fmtDhq(team.totalDHQ)} DHQ</div>
                                                        <button
                                                            type="button"
                                                            onClick={() => topPlayer?.pid && openRecapPlayer(topPlayer.pid)}
                                                            disabled={!topPlayer?.pid}
                                                            style={{ minWidth: 0, padding: 0, border: 'none', background: 'transparent', color: topPlayer?.pid ? 'var(--gold)' : 'var(--silver)', textAlign: 'left', cursor: topPlayer?.pid ? 'pointer' : 'default', fontFamily: FONT_UI, fontSize: '0.68rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                        >
                                                            {topPlayer ? topPlayer.name : 'No top pick'}
                                                        </button>
                                                        <div style={{ color: 'var(--silver)', opacity: 0.72, fontSize: '0.66rem', textAlign: 'right' }}>
                                                            {team.steals?.length || 0} steal{team.steals?.length === 1 ? '' : 's'} · {team.reaches?.length || 0} reach{team.reaches?.length === 1 ? '' : 'es'}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No league picks available for recap.</div>}
                                </div>

                                {/* Alex commentary */}
                                <div style={{ padding: '22px 32px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                        <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'linear-gradient(135deg, #D4AF37, #B8941E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.56rem', fontWeight: 800, color: '#0A0A0A' }}>AI</div>
                                        <span style={{ fontFamily: FONT_DISPL, fontSize: '0.82rem', color: 'var(--gold)', letterSpacing: '0.06em' }}>Alex's Take</span>
                                    </div>
                                    <div style={{ padding: '10px 14px', background: 'rgba(212,175,55,0.05)', borderLeft: '3px solid rgba(212,175,55,0.4)', borderRadius: '0 6px 6px 0', fontSize: '0.84rem', color: 'var(--silver)', lineHeight: 1.55 }}>
                                        {(() => {
                                            const topPos = recapPositions[0]?.pos || 'skill positions';
                                            const topPosCount = recapPositions[0]?.count || 0;
                                            const letterPhrase = grade.letter.startsWith('A') ? "one of the best drafts in the league — you captured elite value" : grade.letter.startsWith('B') ? "a solid class with clear upside" : grade.letter.startsWith('C') ? "a middling haul, with room for growth" : "a tough draft — the value just wasn't there at your slots";
                                            return "This was " + letterPhrase + ". You leaned heaviest at " + topPos + " (" + topPosCount + " picks) and banked " + grade.totalDHQ.toLocaleString() + " DHQ across " + myPicks.length + " selections. " + (myRank <= 3 ? "You're top-3 by draft DHQ — this class sets you up for a run." : myRank <= totals.length / 2 ? "You're in the upper half — now the work is in the development window." : "You'll need to work the waiver wire and trade market to close the gap.");
                                        })()}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div style={{ padding: '18px 32px 24px', display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    <button onClick={() => {
                                        try {
                                            const key = 'wr_draft_recap_' + Date.now();
                                            const payload = stateHelpers.saveDraftRecap
                                                ? stateHelpers.saveDraftRecap(state, { grade, key })
                                                : recap;
                                            if (!payload) localStorage.setItem(key, JSON.stringify(recap || {}));
                                            alert('Draft recap saved to archive (' + key + ')');
                                        } catch (e) { alert('Save failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'rgba(212,175,55,0.12)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>SAVE RECAP</button>
                                    <button onClick={() => {
                                        try {
                                            const text = stateHelpers.formatDraftShareReport
                                                ? stateHelpers.formatDraftShareReport(recap || stateHelpers.buildDraftRecap(state, { grade }))
                                                : stateHelpers.formatDraftRecapText?.(recap || stateHelpers.buildDraftRecap(state, { grade }));
                                            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(() => alert('Share report copied.'));
                                            else alert('Clipboard unavailable in this browser.');
                                        } catch (e) { alert('Copy failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'rgba(255,255,255,0.035)', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.14)', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>COPY REPORT</button>
                                    <button onClick={() => {
                                        try {
                                            const text = stateHelpers.formatDraftShareReport
                                                ? stateHelpers.formatDraftShareReport(recap || stateHelpers.buildDraftRecap(state, { grade }))
                                                : stateHelpers.formatDraftRecapText
                                                    ? stateHelpers.formatDraftRecapText(recap || stateHelpers.buildDraftRecap(state, { grade }))
                                                    : 'Draft Recap - ' + grade.letter;
                                            const blob = new Blob([text], { type: 'text/markdown' });
                                            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'draft-recap-' + Date.now() + '.md'; a.click(); URL.revokeObjectURL(url);
                                        } catch (e) { alert('Export failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>EXPORT REPORT</button>
                                    <button onClick={onExit} style={{ padding: '10px 22px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>DRAFT AGAIN</button>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>
        );
    }

    function LiveSyncCommandReadPanel({ state, liveSync, currentSlot, nextUserSlot, trendText, dispatch, inline = false }) {
        const status = liveSync?.status || 'idle';
        const color = status === 'mirroring' ? '#2ECC71'
            : status === 'waiting' ? '#F0A500'
                : status === 'complete' ? 'var(--gold)'
                    : '#E74C3C';
        const label = status === 'mirroring' ? 'Live mirror healthy'
            : status === 'waiting' ? 'Waiting for pick 1'
                : status === 'complete' ? 'Draft Complete'
                    : status === 'stale' ? 'Sync Needs Attention'
                        : status === 'error' ? 'Poll Error'
                            : 'Connecting live sync';
        const pickLabel = pick => pick ? 'R' + (pick.round || '?') + '.' + String(pick.slot || 0).padStart(2, '0') : '';
        const liveRead = (() => {
            if (state.activeOffer) return 'I paused the room for the trade offer. Resolve or counter before the clock moves.';
            if (nextUserSlot && currentSlot) {
                const picksAway = Math.max(0, (nextUserSlot.overall || 0) - (state.currentIdx || 0));
                return 'Your next decision is ' + pickLabel(nextUserSlot) + ' in ' + picksAway + ' picks. I am watching ' + (trendText || 'the board') + ' and will flag the best value pocket before you are on deck.';
            }
            return 'No user pick is currently loaded. I will keep the board and opponent intel synced while the room moves.';
        })();
        return (
            <div style={{
                padding: '10px 12px',
                marginBottom: inline ? 0 : '8px',
                background: 'linear-gradient(90deg, rgba(155,138,251,0.07), rgba(255,255,255,0.024) 42%, rgba(212,175,55,0.045))',
                border: '1px solid rgba(155,138,251,0.24)',
                borderLeft: '3px solid ' + color,
                borderRadius: '8px',
                display: 'grid',
                gridTemplateColumns: dispatch && state.phase === 'drafting' ? 'minmax(0, 1fr) auto' : '1fr',
                alignItems: 'center',
                gap: '12px',
                fontFamily: FONT_UI,
                height: inline ? '100%' : 'auto',
            }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color, fontWeight: 900, fontFamily: FONT_DISPL, fontSize: '0.74rem', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                        Alex Live Read
                    </div>
                    <div style={{ color: 'var(--white)', fontSize: '0.78rem', fontWeight: 800, lineHeight: 1.25 }}>
                        {label}
                    </div>
                    <div style={{ color: 'var(--silver)', opacity: 0.78, fontSize: '0.64rem', lineHeight: 1.35, marginTop: 3 }}>
                        {liveRead}
                    </div>
                </div>
                {dispatch && state.phase === 'drafting' && (
                    <button
                        onClick={() => dispatch({ type: 'SET_OVERRIDE', enabled: !state.overrideMode })}
                        title={state.overrideMode ? 'Return to read-only Sleeper mirror' : 'Apply the next pick manually from the Big Board'}
                        style={liveMiniButtonStyle(
                            state.overrideMode ? 'rgba(155,138,251,0.22)' : 'rgba(255,255,255,0.035)',
                            state.overrideMode ? 'rgba(214,208,255,0.98)' : 'var(--silver)',
                            state.overrideMode ? 'rgba(155,138,251,0.45)' : 'rgba(255,255,255,0.12)'
                        )}
                    >
                        {state.overrideMode ? 'MANUAL ON' : 'MANUAL PICK'}
                    </button>
                )}
            </div>
        );
    }

    function StagedLiveOffersPanel({ offers, sleeperDraftId, dispatch, layoutGap }) {
        if (!offers || !offers.length) return null;
        const counts = offers.reduce((acc, offer) => {
            const status = offer.status || 'staged';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        return (
            <div style={{
                padding: '9px 14px',
                marginBottom: (layoutGap || 8) + 'px',
                background: 'rgba(124,107,248,0.045)',
                border: '1px solid rgba(155,138,251,0.24)',
                borderRadius: '6px',
                fontFamily: FONT_UI,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 7 }}>
                    <div style={{ color: 'rgba(155,138,251,1)', fontSize: '0.58rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                        Staged Live Offers
                        <span style={{ marginLeft: 8, color: 'var(--silver)', opacity: 0.7, fontWeight: 700 }}>
                            {(counts.pending || 0)} pending · {(counts.accepted || 0)} accepted · {(counts.rejected || 0)} rejected
                        </span>
                    </div>
                    {sleeperDraftId && (
                        <button
                            onClick={() => window.open(sleeperDraftUrl(sleeperDraftId), '_blank', 'noopener,noreferrer')}
                            style={liveMiniButtonStyle('rgba(155,138,251,0.16)', 'rgba(214,208,255,0.98)', 'rgba(155,138,251,0.34)')}
                        >
                            OPEN SLEEPER
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {offers.slice(0, 3).map(offer => (
                        <StagedOfferRow
                            key={offer.id}
                            offer={offer}
                            dispatch={dispatch}
                            onDismiss={() => dispatch({ type: 'DISMISS_STAGED_LIVE_OFFER', offerId: offer.id })}
                        />
                    ))}
                </div>
            </div>
        );
    }

    function StagedOfferRow({ offer, dispatch, onDismiss }) {
        const [copied, setCopied] = React.useState(false);
        const onCopy = () => copyLiveText(offer.copyText || '').then(ok => {
            setCopied(ok);
            setTimeout(() => setCopied(false), 1400);
        });
        const status = offer.status || 'staged';
        const statusColor = status === 'accepted' ? '#2ECC71'
            : status === 'rejected' ? '#E74C3C'
                : status === 'pending' ? 'var(--gold)'
                    : 'rgba(155,138,251,0.95)';
        const updateStatus = nextStatus => dispatch?.({ type: 'UPDATE_LIVE_OFFER_STATUS', offerId: offer.id, status: nextStatus });
        return (
            <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto auto auto auto',
                alignItems: 'center',
                gap: 8,
                padding: '7px 8px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
                borderRadius: '5px',
            }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ color: 'var(--white)', fontSize: '0.66rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {offer.partnerName || 'Trade partner'} · {offer.likelihood || 0}% / {offer.acceptanceLine || 70}% Buyer Line
                    </div>
                    <div style={{ color: 'var(--silver)', opacity: 0.74, fontSize: '0.56rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 2 }}>
                        <span style={{ color: statusColor, fontWeight: 800, textTransform: 'uppercase' }}>{status}</span> · Give {offer.giveText || 'package'} / Get {offer.getText || 'package'}
                    </div>
                </div>
                <button onClick={onCopy} style={liveMiniButtonStyle('rgba(46,204,113,0.11)', '#2ECC71', 'rgba(46,204,113,0.28)')}>
                    {copied ? 'COPIED' : 'COPY'}
                </button>
                <button onClick={() => updateStatus('pending')} style={liveMiniButtonStyle(status === 'pending' ? 'rgba(212,175,55,0.15)' : 'transparent', 'var(--gold)', 'rgba(212,175,55,0.28)')}>
                    SENT
                </button>
                <button onClick={() => updateStatus('accepted')} style={liveMiniButtonStyle(status === 'accepted' ? 'rgba(46,204,113,0.16)' : 'transparent', '#2ECC71', 'rgba(46,204,113,0.28)')}>
                    YES
                </button>
                <button onClick={() => updateStatus('rejected')} style={liveMiniButtonStyle(status === 'rejected' ? 'rgba(231,76,60,0.16)' : 'transparent', '#E74C3C', 'rgba(231,76,60,0.28)')}>
                    NO
                </button>
                <button onClick={onDismiss} style={liveMiniButtonStyle('transparent', 'var(--silver)', 'rgba(255,255,255,0.12)')}>
                    ×
                </button>
            </div>
        );
    }

    function liveMiniButtonStyle(background, color, borderColor) {
        return {
            padding: '4px 7px',
            background,
            border: '1px solid ' + borderColor,
            borderRadius: '4px',
            color,
            cursor: 'pointer',
            fontFamily: FONT_UI,
            fontSize: '0.55rem',
            fontWeight: 900,
            letterSpacing: '0.04em',
            whiteSpace: 'nowrap',
        };
    }

    function copyLiveText(text) {
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        window.prompt('Copy live offer summary:', text);
        return Promise.resolve(true);
    }

    function liveTone(tone) {
        if (tone === 'green') return { main: '#2ECC71', bg: 'rgba(46,204,113,0.08)', border: 'rgba(46,204,113,0.26)' };
        if (tone === 'purple') return { main: 'rgba(155,138,251,1)', bg: 'rgba(155,138,251,0.08)', border: 'rgba(155,138,251,0.28)' };
        if (tone === 'red') return { main: '#E74C3C', bg: 'rgba(231,76,60,0.08)', border: 'rgba(231,76,60,0.28)' };
        if (tone === 'amber') return { main: '#F0A500', bg: 'rgba(240,165,0,0.08)', border: 'rgba(240,165,0,0.28)' };
        return { main: 'var(--gold)', bg: 'rgba(212,175,55,0.08)', border: 'rgba(212,175,55,0.28)' };
    }

    function shortLiveValue(value) {
        const n = Number(value || 0);
        if (!n) return '0';
        return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
    }

    function openLiveDecisionPlayer(player) {
        if (!player?.pid) return;
        if (typeof window.openPlayerModal === 'function') {
            try { window.openPlayerModal(player.pid); return; } catch (_) {}
        }
        if (typeof window.WR?.openPlayerCard === 'function') {
            try { window.WR.openPlayerCard(player.pid); } catch (_) {}
        }
    }

    function LiveDecisionDeckPanel({ deck, onTrade, layoutGap }) {
        const cards = deck?.cards || [];
        if (!cards.length) return null;
        const next = deck?.nextUserPick;
        const nextLabel = next
            ? (next.picksAway === 0 ? 'You are on deck now' : next.picksAway + ' picks to your next turn')
            : 'No user pick remaining';
        return (
            <div style={{
                padding: '10px 14px',
                marginBottom: (layoutGap || 8) + 'px',
                background: 'rgba(255,255,255,0.022)',
                border: '1px solid rgba(212,175,55,0.22)',
                borderRadius: '6px',
                fontFamily: FONT_UI,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <div style={{ color: 'var(--gold)', fontSize: '0.6rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.1em', flex: 1 }}>
                        On-Clock Decision Deck
                    </div>
                    <div style={{ color: 'var(--silver)', opacity: 0.66, fontSize: '0.56rem', fontWeight: 700 }}>
                        {nextLabel} · {deck.assumptions?.boardLane || 'dhq'} board
                    </div>
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(148px, 1fr))',
                    gap: 7,
                    marginBottom: deck.alerts?.length ? 8 : 0,
                }}>
                    {cards.map(card => {
                        const tone = liveTone(card.tone);
                        const player = card.player;
                        const clickable = card.action === 'trade' || player?.pid;
                        return (
                            <button
                                key={card.kind + ':' + (player?.pid || card.detail || '')}
                                onClick={() => card.action === 'trade' ? onTrade?.() : openLiveDecisionPlayer(player)}
                                disabled={!clickable}
                                style={{
                                    minWidth: 0,
                                    padding: '8px 9px',
                                    background: tone.bg,
                                    border: '1px solid ' + tone.border,
                                    borderLeft: '3px solid ' + tone.main,
                                    borderRadius: '5px',
                                    textAlign: 'left',
                                    cursor: clickable ? 'pointer' : 'default',
                                    fontFamily: FONT_UI,
                                    color: 'var(--silver)',
                                }}
                            >
                                <div style={{ color: tone.main, fontSize: '0.52rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                                    {card.label}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5, minWidth: 0, marginBottom: 4 }}>
                                    {player?.pos && (
                                        <span style={{ flexShrink: 0, color: tone.main, border: '1px solid ' + tone.border, borderRadius: 3, padding: '0 4px', fontSize: '0.52rem', fontWeight: 900 }}>
                                            {player.pos}
                                        </span>
                                    )}
                                    <strong style={{ color: 'var(--white)', fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {player?.name || card.detail}
                                    </strong>
                                </div>
                                {player && (
                                    <div style={{ display: 'flex', gap: 7, color: 'var(--silver)', opacity: 0.78, fontSize: '0.54rem', fontFamily: FONT_MONO, marginBottom: 4 }}>
                                        <span>DHQ {shortLiveValue(player.dhq)}</span>
                                        <span>Y5 {shortLiveValue(player.y5)}</span>
                                        {player.tier && <span>T{player.tier}</span>}
                                    </div>
                                )}
                                <div style={{ color: 'var(--silver)', opacity: 0.76, fontSize: '0.56rem', lineHeight: 1.35 }}>
                                    {player ? card.detail : (card.drivers || []).slice(0, 2).join(' · ')}
                                </div>
                            </button>
                        );
                    })}
                </div>
                {!!deck.alerts?.length && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {deck.alerts.map(alert => {
                            const tone = liveTone(alert.tone);
                            return (
                                <div key={alert.type + ':' + alert.title} style={{
                                    flex: '1 1 190px',
                                    minWidth: 0,
                                    padding: '6px 8px',
                                    background: tone.bg,
                                    border: '1px solid ' + tone.border,
                                    borderRadius: '4px',
                                }}>
                                    <div style={{ color: tone.main, fontSize: '0.52rem', fontWeight: 900, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{alert.title}</div>
                                    <div style={{ color: 'var(--silver)', opacity: 0.8, fontSize: '0.56rem', lineHeight: 1.35, marginTop: 2 }}>{alert.text}</div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    }

    function LiveTradeWindowBanner({ tradeWindow, onOpen, layoutGap, inline = false }) {
        if (!tradeWindow) return null;
            const suggestion = tradeWindow.suggestion || {};
            const proposal = suggestion.proposal || {};
            const give = formatTradePackageSide(proposal, 'my');
            const get = formatTradePackageSide(proposal, 'their');
            const clears = tradeWindow.likelihood >= tradeWindow.acceptanceLine;
            const statusColor = clears ? '#2ECC71' : '#F0A500';
            return (
                <div style={{
                    padding: '9px 14px',
                    marginBottom: inline ? 0 : (layoutGap || 8) + 'px',
                    background: 'rgba(124,107,248,0.055)',
                    border: '1px solid rgba(155,138,251,0.28)',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    minHeight: 48,
                    fontFamily: FONT_UI,
                    height: inline ? '100%' : 'auto',
                }}>
                    <div style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        border: '1px solid rgba(155,138,251,0.45)',
                        color: 'rgba(155,138,251,1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontFamily: FONT_DISPL,
                        fontWeight: 800,
                        flexShrink: 0,
                    }}>T</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            minWidth: 0,
                            marginBottom: 2,
                        }}>
                            <span style={{ fontSize: '0.58rem', color: 'rgba(155,138,251,1)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, flexShrink: 0 }}>
                                Current Pick Trade Window
                            </span>
                            <span style={{ color: 'var(--white)', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {tradeWindow.teamName} · {tradeWindow.pickLabel}
                            </span>
                        </div>
                        <div style={{ color: 'var(--silver)', fontSize: '0.64rem', lineHeight: 1.35, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {liveTradeTimingLabel(tradeWindow)} · {suggestion.label || tradeWindow.motive || 'Package'} · Give {give} / Get {get}
                        </div>
                    </div>
                    <div style={{
                        color: statusColor,
                        fontFamily: FONT_MONO,
                        fontSize: '0.72rem',
                        fontWeight: 800,
                        textAlign: 'right',
                        flexShrink: 0,
                    }}>
                        {tradeWindow.likelihood}% / {tradeWindow.acceptanceLine}%
                        <div style={{ color: 'var(--silver)', opacity: 0.68, fontSize: '0.52rem', fontFamily: FONT_UI, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            Buyer Line
                        </div>
                    </div>
                    <button
                        onClick={onOpen}
                        style={{
                            padding: '6px 10px',
                            background: 'rgba(155,138,251,0.14)',
                            border: '1px solid rgba(155,138,251,0.34)',
                            borderRadius: '4px',
                            color: 'rgba(214,208,255,0.98)',
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                            fontSize: '0.62rem',
                            fontWeight: 800,
                            letterSpacing: '0.04em',
                            flexShrink: 0,
                        }}
                    >
                        OPEN TRADE DESK
                    </button>
                </div>
            );
        }

        // ── Mobile: read-only feed ───────────────────────────────────────
        function MobileFeed({ state, dispatch, onStart, isUserTurn, currentSlot }) {
        const BigBoardPanel = window.DraftCC.BigBoardPanel;
        const AlexStreamPanel = window.DraftCC.AlexStreamPanel;

        if (state.phase === 'setup') {
            return (
                <div style={{ padding: '16px', fontFamily: FONT_UI, textAlign: 'center' }}>
                    <div style={{
                        padding: '14px 18px',
                        background: 'rgba(240,165,0,0.08)',
                        border: '1px solid rgba(240,165,0,0.25)',
                        borderRadius: '8px',
                        marginBottom: '16px',
                        fontSize: '0.76rem',
                        color: '#F0A500',
                        lineHeight: 1.5,
                    }}>
                        📱 Run mock drafts on desktop for the full 6-panel experience.
                        Mobile supports a read-only feed view.
                    </div>
                    <button onClick={onStart} style={{
                        width: '100%',
                        padding: '14px',
                        background: 'var(--gold)',
                        color: 'var(--black)',
                        border: 'none',
                        borderRadius: '8px',
                        fontFamily: FONT_DISPL,
                        fontSize: '1rem',
                        fontWeight: 700,
                        cursor: 'pointer',
                        letterSpacing: '0.06em',
                    }}>
                        START MOCK DRAFT
                    </button>
                </div>
            );
        }

        return (
            <div style={{ fontFamily: FONT_UI, padding: '4px 0' }}>
                <div style={{ height: 400, marginBottom: 10 }}>
                    <BigBoardPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                </div>
                <div style={{ height: 260, marginBottom: 10 }}>
                    <AlexStreamPanel state={state} dispatch={dispatch} />
                </div>
                <div style={{ height: 300 }}>
                    <DraftPickListPanel state={state} currentSlot={currentSlot} />
                </div>
            </div>
        );
    }

    // ── Expose ───────────────────────────────────────────────────────
    window.DraftCommandCenter = DraftCommandCenter;
    window.DraftCC = window.DraftCC || {};
    window.DraftCC.featureFlag = {
        key: FEATURE_FLAG_KEY,
        isEnabled: isFeatureEnabled,
    };
})();

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
    const { DRAFT_CC_LAYOUT, FONT_UI, FONT_DISPL, panelCard, bpBucket } = window.DraftCC.styles;
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
    // Reorder a draft pool by the user's saved Big Board (draft-room.js persists
    // `myOrder` — an ordered pid[] — under WR_KEYS.BIGBOARD(leagueId)). Players
    // not in myOrder keep their original (DHQ-sorted) position at the tail.
    // Refreshes consensusRank so reach/steal detection reflects the user's order.
    function applyUserBigBoardOrder(pool, leagueId) {
        if (!Array.isArray(pool) || !pool.length || !leagueId) return pool;
        try {
            const keys = window.App?.WR_KEYS;
            const store = window.App?.WrStorage;
            if (!keys?.BIGBOARD || !store?.get) return pool;
            const saved = store.get(keys.BIGBOARD(leagueId));
            const myOrder = Array.isArray(saved?.myOrder) ? saved.myOrder : null;
            if (!myOrder || !myOrder.length) return pool;
            const rank = new Map();
            myOrder.forEach((pid, i) => rank.set(String(pid), i));
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

    function DraftCommandCenter({ playersData, myRoster, currentLeague, draftRounds: propRounds, forcedMode }) {
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
            const upcomingSettings = upcoming ? {
                draftId: upcoming.draft_id,
                rounds: upcoming.settings?.rounds || legacyLeagueSettings.draft_rounds || null,
                teams:  upcoming.settings?.teams  || legacyLeagueSettings.num_teams || null,
                type:   upcoming.type || null,
                startTime: upcoming.start_time || null,
                status:  upcoming.status || null,
                season:  upcoming.season || null,
            } : (legacyLeagueSettings.draft_rounds || legacyLeagueSettings.num_teams ? {
                draftId: null,
                rounds: legacyLeagueSettings.draft_rounds || null,
                teams:  legacyLeagueSettings.num_teams || null,
                type:   null,
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
                    // originalPool was stripped too — restore from pool as a best-effort baseline
                    if (!saved.originalPool || !saved.originalPool.length) {
                        saved.originalPool = saved.pool.slice();
                    }
                    // Re-apply the user's custom Big Board order on resume so changes
                    // to the board since the draft was saved are reflected immediately.
                    saved.pool = applyUserBigBoardOrder(saved.pool, leagueId);
                    return saved;
                }
                // Phase 5+: prefer the league's scheduled upcoming draft settings
                // so Solo defaults match whatever's actually scheduled in Sleeper.
                const upcoming = draftMeta.upcomingSettings;
                return stateFns.initialDraftState({
                    leagueId: currentLeague?.league_id || currentLeague?.id || '',
                    season: currentLeague?.season,
                    rounds: upcoming?.rounds || propRounds || 5,
                    leagueSize: upcoming?.teams || draftMeta.numTeams,
                    draftType: upcoming?.type || draftMeta.draftType || 'snake',
                    userRosterId: myRoster?.roster_id,
                    userSlot: draftMeta.mySlot,
                    // Honor forced mode (e.g., live-sync from the Follow Live Draft tab)
                    mode: forcedMode || 'solo',
                });
            }
        );

        // Resume banner is only shown when we're still in setup phase but have a saved draft
        const [showResume, setShowResume] = React.useState(false);

        // Phase 5+: sync setup defaults when draftMeta updates post-mount (e.g.
        // after the async Sleeper drafts fetch resolves). Only applies during
        // setup phase — we don't want to clobber an in-progress draft.
        const draftMetaSignature = draftMeta.mySlot + '|' + draftMeta.numTeams + '|' + (draftMeta.upcomingSettings?.rounds || '') + '|' + (draftMeta.upcomingSettings?.type || '');
        React.useEffect(() => {
            // Only sync when we're in setup — drafting/complete phases are locked in
            if (state.phase !== 'setup') return;
            const upcoming = draftMeta.upcomingSettings;
            const patch = {};
            if (draftMeta.mySlot && state.userSlot !== draftMeta.mySlot) patch.userSlot = draftMeta.mySlot;
            if (draftMeta.numTeams && state.leagueSize !== draftMeta.numTeams) patch.leagueSize = draftMeta.numTeams;
            if (upcoming?.rounds && state.rounds !== upcoming.rounds) patch.rounds = upcoming.rounds;
            if (upcoming?.type && state.draftType !== upcoming.type) patch.draftType = upcoming.type;
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
                        const result = window.DraftCC.cpuEngine.personaPick(
                            persona,
                            state.pool,
                            slot.round,
                            slot.overall,
                            Object.assign({ teamRoster }, gmCtx)
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
        }, [state.phase, state.currentIdx, state.speed, isUserTurn, isDone]);

        // ── Phase 3: CPU trade offer generation ──────────────────────
        // After each completed pick, roll for a trade offer. Cooldown prevents spam.
        const lastOfferIdxRef = React.useRef(-Infinity);
        const lastPickCountRef = React.useRef(0);
        React.useEffect(() => {
            if (state.phase !== 'drafting') return;
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
        }, [state.currentIdx, state.phase, state.activeOffer, state.proposerDrawer]);

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

            const playersData = window.S?.players || {};
            const normPos = window.App?.normPos || (p => p);
            const getDHQ = (pid) => window.App?.LI?.playerScores?.[pid] || 0;

            window.DraftCC.liveSync.start(state.sleeperDraftId, (sleeperPick) => {
                if (!sleeperPick) return;
                const p = playersData[sleeperPick.player_id] || {};
                const player = {
                    pid: sleeperPick.player_id,
                    name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || 'Unknown',
                    pos: normPos(p.position) || p.position || '?',
                    dhq: getDHQ(sleeperPick.player_id),
                    photoUrl: 'https://sleepercdn.com/content/nfl/players/thumb/' + sleeperPick.player_id + '.jpg',
                    college: p.college || '',
                };
                dispatch({
                    type: 'MAKE_PICK',
                    player,
                    isUser: sleeperPick.roster_id === state.userRosterId,
                    reasoning: { primary: 'Live Sleeper pick', baseVal: player.dhq, nudges: [] },
                    confidence: 1.0,
                });
            });

            return () => {
                if (window.DraftCC.liveSync?.isRunning?.()) {
                    window.DraftCC.liveSync.stop();
                }
            };
        }, [state.mode, state.phase, state.sleeperDraftId, state.userRosterId]);

        // ── Live-Sync variant auto-correction ──────────────────────────
        // When resuming a live-sync draft, the saved state's `variant` can be
        // stale if the user initially selected it before we started auto-detecting
        // rookie drafts. Fetch the Sleeper draft meta once and, if it indicates a
        // rookie draft but we're still on startup, rebuild the pool.
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
                    const playerType = meta?.settings?.player_type;
                    const rounds = meta?.settings?.rounds || 0;
                    const descr = (meta?.metadata?.description || meta?.metadata?.name || '').toLowerCase();
                    const looksRookie = playerType === 1
                        || /rookie/.test(descr)
                        || (rounds > 0 && rounds <= 6);
                    if (!looksRookie) return;
                    if (state.variant === 'rookie') return;
                    if (state.picks && state.picks.length > 0) {
                        if (window.wrLog) window.wrLog('cc.variantMismatch', { sleeperDraftId: state.sleeperDraftId, saved: state.variant, detected: 'rookie', picks: state.picks.length });
                        return;
                    }
                    const leagueId = currentLeague?.league_id || currentLeague?.id || '';
                    let newPool = stateFns.buildPool({ variant: 'rookie', playersData, maxSize: 200 });
                    newPool = applyUserBigBoardOrder(newPool, leagueId);
                    dispatch({ type: 'SETUP_CHANGE', payload: { variant: 'rookie', pool: newPool, originalPool: newPool.slice() } });
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
                    type: lastPick.isUser ? 'user' : 'rule',
                    badge: lastPick.isUser ? '★' : '•',
                    color: lastPick.isUser ? 'var(--gold)' : 'var(--silver)',
                    title: 'R' + lastPick.round + '.' + String(lastPick.slot).padStart(2, '0') + ' · ' + lastPick.name,
                    text: (lastPick.isUser ? 'You selected ' : '') + lastPick.pos + (lastPick.dhq > 0 ? ' · ' + lastPick.dhq.toLocaleString() + ' DHQ' : ''),
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
                const contextLines = [
                    `Draft pick: ${lastPick.name} (${lastPick.pos}) at R${lastPick.round}.${String(lastPick.slot).padStart(2, '0')}, overall #${lastPick.overall}.`,
                    `By: ${persona?.teamName || 'Team ' + lastPick.teamIdx}, DNA: ${persona?.draftDna?.label || '—'}, Trade DNA: ${persona?.tradeDna?.label || '—'}, Posture: ${persona?.posture?.label || '—'}.`,
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

        // ── Actions ──────────────────────────────────────────────────
        const onStartDraft = React.useCallback(async () => {
            const leagueId = currentLeague?.league_id || currentLeague?.id || '';

            let pool = stateFns.buildPool({
                variant: state.variant,
                playersData,
                maxSize: 200,
            });
            pool = applyUserBigBoardOrder(pool, leagueId);
            let pickOrder = stateFns.buildPickOrder(
                state.rounds,
                state.leagueSize,
                state.draftType,
                draftMeta.slotToRoster,
                draftMeta.pickOwnership
            );

            // Compose personas
            let draftDnaMap = {};
            try {
                if (window.DraftHistory?.loadDraftDNA) {
                    draftDnaMap = window.DraftHistory.loadDraftDNA(leagueId) || {};
                }
            } catch (e) {}
            const personas = window.DraftCC.persona.composeAllPersonas(leagueId, draftDnaMap);

            // Phase 5: scenario transform
            let prePicks = [];
            let narrative = null;
            if (state.mode === 'scenario' && state.scenarioId) {
                const result = window.DraftCC.scenarios?.applyScenario(state, pool, pickOrder, state.scenarioId);
                if (result) {
                    pool = result.pool;
                    pickOrder = result.pickOrder;
                    prePicks = result.prePicks || [];
                    narrative = result.narrative;
                }
            }

            // Phase 5: ghost replay — fetch picks and stage them
            let replay = null;
            if (state.mode === 'ghost') {
                if (!state.sleeperDraftId) {
                    alert('Ghost Replay mode requires selecting a draft from the Replay Source list.');
                    return;
                }
                try {
                    const sleeperPicks = await window.DraftCC.ghostReplay.loadReplayPicks(state.sleeperDraftId);
                    if (sleeperPicks.length) {
                        replay = window.DraftCC.ghostReplay.buildReplayState(state, sleeperPicks);
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
            if (state.mode === 'live-sync') {
                if (!state.sleeperDraftId) {
                    alert('Live Sync mode requires selecting an upcoming or in-progress draft from the Live Sync Source list.');
                    return;
                }
                narrative = '📡 LIVE SYNC · Mirroring draft from Sleeper every 5s. Read-only — no picks are sent back.';
            }

            dispatch({
                type: 'START_DRAFT',
                pool,
                pickOrder,
                personas,
                prePicks,
                narrative,
                replay,
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
        }, [state.variant, state.rounds, state.leagueSize, state.draftType, state.mode, state.scenarioId, state.sleeperDraftId, draftMeta, playersData, currentLeague]);

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
                    const preds = window.DraftCC.cpuEngine.computePredictions(
                        persona,
                        state.pool,
                        round,
                        currentSlot.overall
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
            dispatch({ type: 'HYDRATE', state: { personas, originalPool: state.pool.slice() } });
        }, [currentLeague, state.pool]);

        const onResumeNo = React.useCallback(() => {
            stateFns.clearLocal(currentLeague?.league_id || currentLeague?.id, forcedMode);
            dispatch({ type: 'RESET' });
            setShowResume(false);
        }, [currentLeague]);

        // Phase 3: open the trade proposer drawer for a given CPU roster
        const onPropose = React.useCallback((rosterId) => {
            if (!rosterId || rosterId === state.userRosterId) return;
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
    function SetupScreen({ state, dispatch, draftMeta, csvReady, showResume, onStartDraft, onResumeYes, onResumeNo, forcedMode }) {
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
            return { round, slot, overall: ((round - 1) * state.leagueSize) + slot, ownerName: slotOwner, traded: false };
        });
        const pickPreviewRows = userPickPreview.length ? userPickPreview : fallbackPickPreview;
        const setupSummary = [
            state.variant === 'rookie' ? 'Rookie pool' : 'Startup pool',
            state.draftType === 'snake' ? 'Snake draft' : 'Linear draft',
            state.rounds + ' rounds',
            state.leagueSize + ' teams',
        ].join(' - ');

        return (
            <div className="draft-setup-shell">
                {showResume && (
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

                <div className="draft-setup-head">
                    <h2 style={{ color: forcedMode === 'live-sync' ? 'rgba(155,138,251,1)' : 'var(--gold)' }}>
                        {forcedMode === 'live-sync' ? 'FOLLOW LIVE DRAFT' : 'MOCK DRAFT CENTER'}
                    </h2>
                    <p>{forcedMode === 'live-sync' ? 'Read-only Sleeper mirror with War Room draft intelligence.' : 'Configure the draft, preview your pick path, then launch the command center.'}</p>
                </div>

                {forcedMode === 'live-sync' && (
                    <div className="draft-setup-panel" style={{ marginBottom: 12, borderColor: 'rgba(124,107,248,0.26)' }}>
                        <LiveSyncDraftPicker state={state} update={update} leagueId={state.leagueId} />
                        {state.sleeperDraftId && (
                            <div className="draft-setup-note" style={{ marginTop: 8 }}>
                                Read-only mirror. Pool type and config below only shape the War Room dashboard.
                            </div>
                        )}
                    </div>
                )}

                {!forcedMode && state.mode === 'scenario' && <ScenarioPicker state={state} update={update} />}
                {!forcedMode && state.mode === 'ghost' && <GhostDraftPicker state={state} update={update} leagueId={state.leagueId} />}

                <div className="draft-setup-grid">
                    <section className="draft-setup-panel">
                        {state.mode === 'solo' && upcoming && (upcoming.rounds || upcoming.teams) && (
                            <div className="draft-setup-match">
                                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#2ECC71', flexShrink: 0 }} />
                                <div>
                                    <strong>Mocking your upcoming draft</strong>
                                    <span>{upcoming.type || 'snake'} - {upcoming.rounds || '?'}R x {upcoming.teams || '?'}T{upcoming.startTime ? ' - ' + new Date(upcoming.startTime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : ''}</span>
                                </div>
                            </div>
                        )}

                        <div className="draft-setup-label">Pool Type</div>
                        <div className="draft-setup-choice" style={{ marginTop: 6, marginBottom: 12 }}>
                            {['startup', 'rookie'].map(v => (
                                <button key={v} type="button" className={state.variant === v ? 'is-active' : ''} onClick={() => update({ variant: v })}>
                                    {v}
                                    <span>{v === 'rookie' ? (csvReady ? (window.getProspects?.()?.length || 0) + ' prospects loaded' : 'loading CSV...') : 'DHQ-ranked veterans + rookies'}</span>
                                </button>
                            ))}
                        </div>

                        <div className="draft-setup-form">
                            <div className="draft-setup-two">
                                <div>
                                    <div className="draft-setup-label">Draft Rounds</div>
                                    <select value={state.rounds} onChange={e => update({ rounds: +e.target.value })} style={selStyle}>
                                        {[3, 4, 5, 6, 7, 8, 10, 12, 16, 20, 23, 25].map(v => <option key={v} value={v} style={{ background: '#111' }}>{v} rounds</option>)}
                                    </select>
                                </div>
                                <div>
                                    <div className="draft-setup-label">League Size</div>
                                    <select value={state.leagueSize} onChange={e => {
                                        const n = +e.target.value;
                                        update({ leagueSize: n, userSlot: Math.min(state.userSlot, n) });
                                    }} style={selStyle}>
                                        {(() => {
                                            const standard = [8, 10, 12, 14, 16, 20, 24, 28, 32];
                                            const opts = new Set(standard);
                                            if (state.leagueSize) opts.add(state.leagueSize);
                                            return [...opts].sort((a, b) => a - b).map(v => <option key={v} value={v} style={{ background: '#111' }}>{v} teams</option>);
                                        })()}
                                    </select>
                                </div>
                            </div>
                            <div className="draft-setup-two">
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
                                    <div className="draft-setup-label">Draft Type</div>
                                    <select value={state.draftType} onChange={e => update({ draftType: e.target.value })} style={selStyle}>
                                        <option value="snake" style={{ background: '#111' }}>Snake</option>
                                        <option value="linear" style={{ background: '#111' }}>Linear</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="draft-setup-panel">
                        <div className="draft-hq-panel-head">
                            <span>Pick Path Preview</span>
                            <em>{setupSummary}</em>
                        </div>
                        <div className="draft-setup-kpis">
                            <div><span>Your slot</span><strong>{state.userSlot} of {state.leagueSize}</strong><em>{slotOwner}</em></div>
                            <div><span>Total picks</span><strong>{totalPicks}</strong><em>{state.rounds} rounds</em></div>
                            <div><span>Pool</span><strong>{poolCount || '--'}</strong><em>{state.variant === 'rookie' ? 'prospects' : 'players'}</em></div>
                            <div><span>Format</span><strong>{state.draftType}</strong><em>{state.speed} CPU</em></div>
                        </div>
                        <div className="draft-setup-label" style={{ marginBottom: 6 }}>Your first picks</div>
                        <div className="draft-setup-timeline">
                            {pickPreviewRows.map((p, i) => (
                                <div key={p.round + '-' + p.slot + '-' + i}>
                                    <strong>{p.round}.{String(p.slot).padStart(2, '0')}</strong>
                                    <span>Overall {p.overall} - {p.ownerName || slotOwner}</span>
                                    <em>{p.traded ? 'acquired' : 'native'}</em>
                                </div>
                            ))}
                        </div>
                    </section>

                    <section className="draft-setup-panel is-start">
                        <div className="draft-hq-panel-head">
                            <span>Simulation Controls</span>
                            <em>{state.mode}</em>
                        </div>
                        <div className="draft-setup-label">CPU Speed</div>
                        <div className="draft-setup-speed">
                            {['slow', 'medium', 'fast'].map(v => (
                                <button key={v} type="button" className={state.speed === v ? 'is-active' : ''} onClick={() => update({ speed: v })}>{v}</button>
                            ))}
                        </div>
                        <div className="draft-setup-note" style={{ marginTop: 10 }}>
                            {setupSummary}. The command center will use owner DNA, needs, draft history, and your saved Big Board order.
                        </div>
                        <button
                            type="button"
                            className="draft-setup-start"
                            onClick={onStartDraft}
                            disabled={state.variant === 'rookie' && !csvReady}
                            style={{
                                background: state.variant === 'rookie' && !csvReady ? 'rgba(212,175,55,0.3)' : (forcedMode === 'live-sync' ? '#9b8afb' : 'var(--gold)'),
                                color: forcedMode === 'live-sync' ? '#fff' : 'var(--black)',
                                borderColor: state.variant === 'rookie' && !csvReady ? 'rgba(212,175,55,0.3)' : (forcedMode === 'live-sync' ? '#9b8afb' : 'var(--gold)'),
                            }}
                        >
                            {state.variant === 'rookie' && !csvReady ? 'LOADING PROSPECTS...' : (forcedMode === 'live-sync' ? 'START MIRROR' : 'START DRAFT')}
                        </button>

                        {!forcedMode && (
                            <div className="draft-setup-secondary">
                                <button type="button" onClick={() => setShowOther(v => !v)}>
                                    <span>{showOther ? 'Hide other mock options' : 'Other mock options'}</span>
                                    <span>{state.mode === 'scenario' ? 'Scenario active' : state.mode === 'ghost' ? 'Ghost active' : 'Scenarios - Ghost replay - Templates'}</span>
                                </button>
                                {showOther && (
                                    <div className="draft-setup-other">
                                        <ModeSelector state={state} update={update} />
                                        <TemplateLoader state={state} dispatch={dispatch} />
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </div>
        );
    }

    // ── Phase 5: ModeSelector ────────────────────────────────────────
    // Live Sync moved to its own top-level tab ("Follow Live Draft").
    function ModeSelector({ state, update }) {
        const modes = [
            { id: 'solo',     label: 'Custom Solo',  desc: 'Manually configure rounds & teams',   icon: '⚡' },
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
                }}>Alternate Mock Mode</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
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
    function LiveSyncDraftPicker({ state, update, leagueId }) {
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
                                    onClick={() => {
                                        // Auto-detect rookie vs startup from the Sleeper draft settings.
                                        // Dynasty rookie drafts are typically ≤ 6 rounds; startups are 20+.
                                        // Sleeper exposes `settings.player_type` on some rookie drafts
                                        // (1 = rookies), and `metadata.description` occasionally includes "rookie".
                                        const rounds = d.settings?.rounds || 0;
                                        const playerType = d.settings?.player_type;
                                        const descr = (d.metadata?.description || d.metadata?.name || '').toLowerCase();
                                        const looksRookie = playerType === 1
                                            || /rookie/.test(descr)
                                            || (rounds > 0 && rounds <= 6);
                                        const patch = { sleeperDraftId: d.draft_id };
                                        if (looksRookie) patch.variant = 'rookie';
                                        if (rounds) patch.rounds = rounds;
                                        if (d.settings?.teams) patch.leagueSize = d.settings.teams;
                                        if (d.type) patch.draftType = d.type;
                                        update(patch);
                                    }}
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

    // ── Drafting / complete grid ─────────────────────────────────────
    function CommandCenterGrid({ state, dispatch, isUserTurn, currentSlot, onExit, viewport, onPropose }) {
        const L = DRAFT_CC_LAYOUT;
        // Filter by rosterId so post-trade ownership is respected
        const myPicks = state.picks.filter(p => p.rosterId === state.userRosterId || p.isUser);
        const grade = window.DraftCC.state.gradeDraft(myPicks, state.originalPool);

        const BigBoardPanel = window.DraftCC.BigBoardPanel;
        const DraftGridPanel = window.DraftCC.DraftGridPanel;
        const OpponentIntelPanel = window.DraftCC.OpponentIntelPanel;
        const AlexStreamPanel = window.DraftCC.AlexStreamPanel;
        const LiveAnalyticsPanel = window.DraftCC.LiveAnalyticsPanel;
        const TradeModal = window.DraftCC.TradeModal;
        const TradeProposer = window.DraftCC.TradeProposer;

        // Header styles
        const headerCss = {
            height: L.HEADER_H + 'px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '0 14px',
            background: 'var(--black)',
            border: '1px solid rgba(212,175,55,0.2)',
            borderRadius: '8px',
            marginBottom: (L.GRID_GAP) + 'px',
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

        // Desktop grid or tablet collapse
        const isTablet = viewport === 'tablet';

        return (
            <div style={{ fontFamily: FONT_UI, paddingBottom: '12px' }}>
                {/* ── HEADER ───────────────────────────────────────── */}
                <div style={headerCss}>
                    <div style={{
                        fontFamily: FONT_DISPL,
                        fontSize: '1rem',
                        fontWeight: 700,
                        color: 'var(--gold)',
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase',
                        flexShrink: 0,
                    }}>
                        Draft Command
                    </div>
                    <div style={{
                        fontSize: '0.6rem',
                        color: 'var(--silver)',
                        opacity: 0.6,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        flexShrink: 0,
                    }}>
                        {state.mode} · {state.variant}
                    </div>

                    {/* Progress */}
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
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
                    {state.phase === 'drafting' && (
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                            {['slow', 'medium', 'fast', 'paused'].map(v => (
                                <button key={v} onClick={() => dispatch({ type: 'SET_SPEED', speed: v })} style={speedBtn(v)}>
                                    {v === 'paused' ? '⏸' : v}
                                </button>
                            ))}
                        </div>
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

                {/* Phase 5: Scenario / Ghost replay narrative banner */}
                {state.scenarioNarrative && (
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

                {/* ── TOP ROW: Big Board / Draft Grid / Opponent Intel ───── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isTablet ? '1fr 1fr' : `${L.SPAN.BIG_BOARD}fr ${L.SPAN.DRAFT_GRID}fr ${L.SPAN.OPP_INTEL}fr`,
                    gap: L.GRID_GAP + 'px',
                    height: isTablet ? 'auto' : (L.ROW_TOP_H + 'px'),
                    marginBottom: L.GRID_GAP + 'px',
                }}>
                    <div style={{ minHeight: isTablet ? 500 : '100%', minWidth: 0 }}>
                        <BigBoardPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} />
                    </div>
                    <div style={{ minHeight: isTablet ? 500 : '100%', minWidth: 0 }}>
                        <DraftGridPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} currentSlot={currentSlot} />
                    </div>
                    {!isTablet && (
                        <div style={{ minHeight: '100%', minWidth: 0 }}>
                            <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                        </div>
                    )}
                </div>

                {/* ── BOTTOM ROW: Live Analytics / Alex Stream ───── */}
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isTablet
                        ? '1fr 1fr 1fr'
                        : `${L.SPAN.LIVE_ANALYT}fr ${L.SPAN.ALEX_STREAM}fr`,
                    gap: L.GRID_GAP + 'px',
                    height: L.ROW_BOTTOM_H + 'px',
                }}>
                    {isTablet && (
                        <div style={{ minHeight: '100%', minWidth: 0 }}>
                            <OpponentIntelPanel state={state} dispatch={dispatch} currentSlot={currentSlot} onPropose={onPropose} />
                        </div>
                    )}
                    <div style={{ minHeight: '100%', minWidth: 0 }}>
                        <LiveAnalyticsPanel state={state} />
                    </div>
                    <div style={{ minHeight: '100%', minWidth: 0 }}>
                        <AlexStreamPanel state={state} dispatch={dispatch} />
                    </div>
                </div>

                {/* Phase 3: CPU trade offer modal (fixed-position) */}
                {state.activeOffer && TradeModal && <TradeModal state={state} dispatch={dispatch} />}

                {/* Phase 3: User trade proposer drawer (fixed-position) */}
                {state.proposerDrawer && TradeProposer && <TradeProposer state={state} dispatch={dispatch} />}

                {/* Phase 7: Post-draft recap — full-screen modal with grade + per-position + roster + export */}
                {state.phase === 'complete' && (() => {
                    // Build per-position summary from myPicks
                    const posSummary = {};
                    (myPicks || []).forEach(pk => {
                        const pos = (pk.player?.position || pk.pos || '').toUpperCase();
                        if (!pos) return;
                        if (!posSummary[pos]) posSummary[pos] = { count: 0, dhq: 0, players: [] };
                        posSummary[pos].count += 1;
                        posSummary[pos].dhq += (pk.player?.dhq || pk.dhq || 0);
                        posSummary[pos].players.push(pk.player?.full_name || pk.player?.name || pk.name || pk.pid);
                    });
                    const POS_ORDER = ['QB','RB','WR','TE','K','DL','LB','DB'];
                    const orderedPositions = POS_ORDER.filter(p => posSummary[p]).concat(Object.keys(posSummary).filter(p => !POS_ORDER.includes(p)));

                    const gradeColor = grade.letter.startsWith('A') ? '#2ECC71' : grade.letter.startsWith('B') ? '#D4AF37' : grade.letter.startsWith('C') ? '#F0A500' : '#E74C3C';

                    // League-wide percentile — how our total DHQ ranks
                    const allDraftTotals = (state.pickOrder || []).reduce((acc, slot) => {
                        const pick = state.pickedByIdx?.[slot.overall];
                        if (!pick) return acc;
                        acc[slot.rosterId] = (acc[slot.rosterId] || 0) + (pick.player?.dhq || 0);
                        return acc;
                    }, {});
                    const totals = Object.values(allDraftTotals).sort((a, b) => b - a);
                    const myRank = totals.indexOf(grade.totalDHQ) + 1;
                    const myPct = totals.length ? Math.round(((totals.length - myRank) / Math.max(1, totals.length - 1)) * 100) : 0;

                    return (
                        <div style={{
                            position: 'fixed', inset: 0, background: 'rgba(5,6,9,0.82)',
                            zIndex: 900, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            padding: '24px', animation: 'wrFadeIn 0.2s ease'
                        }} onClick={e => { if (e.target === e.currentTarget) onExit && onExit(); }}>
                            <div style={{
                                width: '100%', maxWidth: '820px', maxHeight: '92vh', overflowY: 'auto',
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

                                {/* Per-position breakdown */}
                                <div style={{ padding: '22px 32px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: '10px' }}>Positional Breakdown</div>
                                    {orderedPositions.length ? (
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                                            {orderedPositions.map(pos => {
                                                const s = posSummary[pos];
                                                const posCol = (window.App?.POS_COLORS || {})[pos] || 'var(--silver)';
                                                return <div key={pos} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', borderLeft: '3px solid ' + posCol }}>
                                                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: posCol, letterSpacing: '0.04em' }}>{pos}</div>
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
                                                const p = pk.player || {};
                                                const pos = (p.position || '').toUpperCase();
                                                const posCol = (window.App?.POS_COLORS || {})[pos] || 'var(--silver)';
                                                const dhq = p.dhq || pk.dhq || 0;
                                                const dhqCol = dhq >= 7000 ? '#2ECC71' : dhq >= 4000 ? '#3498DB' : 'var(--silver)';
                                                return <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 10px', borderRadius: '6px', background: 'rgba(255,255,255,0.02)' }}>
                                                    <span style={{ fontFamily: FONT_DISPL, fontSize: '0.72rem', color: 'var(--gold)', width: '48px' }}>
                                                        {pk.round && pk.pickInRound ? (pk.round + '.' + String(pk.pickInRound).padStart(2, '0')) : ('#' + (i + 1))}
                                                    </span>
                                                    <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + pk.pid + '.jpg'} alt="" onError={e => e.target.style.display = 'none'} style={{ width: '28px', height: '28px', borderRadius: '50%', objectFit: 'cover' }} />
                                                    <span style={{ flex: 1, fontSize: '0.84rem', color: 'var(--white)', fontWeight: 600 }}>{p.full_name || p.name || pk.name || pk.pid}</span>
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: posCol, padding: '1px 6px', background: 'rgba(0,0,0,0.4)', borderRadius: '3px' }}>{pos}</span>
                                                    <span style={{ fontFamily: 'var(--font-body)', fontWeight: 700, fontSize: '0.82rem', color: dhqCol, minWidth: '56px', textAlign: 'right' }}>{dhq > 0 ? dhq.toLocaleString() : '—'}</span>
                                                </div>;
                                            })}
                                        </div>
                                    ) : <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>No picks made.</div>}
                                </div>

                                {/* Alex commentary */}
                                <div style={{ padding: '22px 32px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                        <div style={{ width: '22px', height: '22px', borderRadius: '6px', background: 'linear-gradient(135deg, #D4AF37, #B8941E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.56rem', fontWeight: 800, color: '#0A0A0A' }}>AI</div>
                                        <span style={{ fontFamily: FONT_DISPL, fontSize: '0.82rem', color: 'var(--gold)', letterSpacing: '0.06em' }}>Alex's Take</span>
                                    </div>
                                    <div style={{ padding: '10px 14px', background: 'rgba(212,175,55,0.05)', borderLeft: '3px solid rgba(212,175,55,0.4)', borderRadius: '0 6px 6px 0', fontSize: '0.84rem', color: 'var(--silver)', lineHeight: 1.55 }}>
                                        {(() => {
                                            const topPos = orderedPositions[0] || 'skill positions';
                                            const letterPhrase = grade.letter.startsWith('A') ? "one of the best drafts in the league — you captured elite value" : grade.letter.startsWith('B') ? "a solid class with clear upside" : grade.letter.startsWith('C') ? "a middling haul, with room for growth" : "a tough draft — the value just wasn't there at your slots";
                                            return "This was " + letterPhrase + ". You leaned heaviest at " + topPos + " (" + (posSummary[orderedPositions[0]]?.count || 0) + " picks) and banked " + grade.totalDHQ.toLocaleString() + " DHQ across " + myPicks.length + " selections. " + (myRank <= 3 ? "You're top-3 by draft DHQ — this class sets you up for a run." : myRank <= totals.length / 2 ? "You're in the upper half — now the work is in the development window." : "You'll need to work the waiver wire and trade market to close the gap.");
                                        })()}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div style={{ padding: '18px 32px 24px', display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                                    <button onClick={() => {
                                        try {
                                            const payload = { grade: grade.letter, totalDHQ: grade.totalDHQ, pct: grade.pct, picks: myPicks.map(pk => ({ round: pk.round, overall: pk.overall, pid: pk.pid, name: pk.player?.full_name, dhq: pk.player?.dhq || 0 })), savedAt: Date.now() };
                                            const key = 'wr_draft_recap_' + Date.now();
                                            localStorage.setItem(key, JSON.stringify(payload));
                                            alert('Draft recap saved locally (' + key + ')');
                                        } catch (e) { alert('Save failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'rgba(212,175,55,0.12)', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.35)', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>SAVE RECAP</button>
                                    <button onClick={() => {
                                        try {
                                            const lines = ['Draft Recap — ' + grade.letter + ' (' + grade.totalDHQ.toLocaleString() + ' DHQ, ' + grade.pct + '% value)', ''];
                                            (myPicks || []).forEach((pk, i) => { lines.push('  ' + (i + 1) + '. ' + (pk.player?.full_name || pk.pid) + ' — ' + (pk.player?.position || '?') + ' · ' + (pk.player?.dhq || 0).toLocaleString() + ' DHQ'); });
                                            const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
                                            const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'draft-recap-' + Date.now() + '.txt'; a.click(); URL.revokeObjectURL(url);
                                        } catch (e) { alert('Export failed: ' + e.message); }
                                    }} style={{ padding: '10px 22px', background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>EXPORT .TXT</button>
                                    <button onClick={onExit} style={{ padding: '10px 22px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '6px', fontFamily: FONT_DISPL, fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>DRAFT AGAIN</button>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </div>
        );
    }

    // ── Mobile: read-only feed ───────────────────────────────────────
    function MobileFeed({ state, dispatch, onStart, isUserTurn, currentSlot }) {
        const BigBoardPanel = window.DraftCC.BigBoardPanel;
        const DraftGridPanel = window.DraftCC.DraftGridPanel;
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
                    <DraftGridPanel state={state} dispatch={dispatch} isUserTurn={isUserTurn} currentSlot={currentSlot} />
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

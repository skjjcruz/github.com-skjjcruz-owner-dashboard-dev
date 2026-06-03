// ══════════════════════════════════════════════════════════════════
// js/draft/big-board.js — Premium Big Board panel for Draft Command Center
//
// Left panel of the desktop command center. Uses DraftContext board lanes:
// DHQ Board, AI Recommended Board, and My Board. My Board remains user-owned:
// users can seed it from AI, then edit tags/notes during prep, mock, or live.
//
// Depends on: styles.js, state.js, context.js
// Exposes:    window.DraftCC.BigBoardPanel
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, FONT_MONO, panelCard, dhqColor, tierColor, bpBucket } = window.DraftCC.styles;

    // Content signature of the user-owned parts of a Big Board snapshot. Mirrors
    // the helper in draft-room.js so the live room can tell a genuine edit from the
    // Draft tab apart from the echo of its own write to the shared store.
    function boardUserSig(b) {
        if (!b) return '';
        try {
            return JSON.stringify({
                my: b.myOrder || b.my || [],
                tags: b.tags || {},
                notes: b.notes || {},
                drafted: (b.drafted || []).slice().sort(),
                lane: b.activeLane || b.boardMode || 'dhq',
            });
        } catch (e) { return ''; }
    }

    const LANE_LABELS = {
        dhq: { label: 'DHQ Board', short: 'DHQ', sub: 'canonical value' },
        ai:  { label: 'AI Recommended', short: 'AI', sub: 'GM strategy' },
        my:  { label: 'My Board', short: 'MY', sub: 'front-office prep' },
    };

    const TAG_META = {
        target:  { label: 'Target', color: 'var(--k-2ecc71, #2ecc71)' },
        sleeper: { label: 'Watch', color: 'var(--k-3498db, #3498db)' },
        fade:    { label: 'Fade', color: 'var(--k-f0a500, #f0a500)' },
        avoid:   { label: 'DND', color: 'var(--k-e74c3c, #e74c3c)' },
        must:    { label: 'Must', color: 'var(--k-d4af37, #d4af37)' },
    };
    const TAG_CYCLE = ['target', 'sleeper', 'fade', 'avoid', 'must', null];

    function idOf(player) {
        return player?.pid == null ? '' : String(player.pid);
    }

    function fmt(value) {
        const n = Number(value || 0);
        if (!n) return '—';
        return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
    }

    function rankMap(order) {
        const out = {};
        (order || []).forEach((pid, idx) => { if (pid != null) out[String(pid)] = idx + 1; });
        return out;
    }

    function nflTeamOf(player) {
        return player?.nflTeam || player?.team || player?.csv?.nflTeam || player?.p?.team || '';
    }

    function collegeOf(player) {
        return player?.school || player?.college || player?.csv?.college || player?.p?.college || player?.p?.metadata?.college || '';
    }

    // Edge rushers (ED) group under DL on the board.
    function normEdPos(pos) {
        return pos === 'ED' ? 'DL' : pos;
    }

    function ageOf(player) {
        const direct = Number(player?.age || player?.csv?.age || 0);
        if (direct) return direct;
        const bd = player?.birth_date || player?.birthDate || player?.p?.birth_date;
        if (!bd) return 0;
        const ms = Date.now() - new Date(bd).getTime();
        return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 31557600000) : 0;
    }

    function valueWindow(player) {
        const pos = player?.pos || player?.position || '';
        const nPos = pos === 'DE' || pos === 'DT' ? 'DL'
            : pos === 'CB' || pos === 'S' ? 'DB'
            : pos === 'OLB' || pos === 'ILB' ? 'LB'
            : pos;
        const age = ageOf(player);
        const curves = window.App?.ageCurveWindows || {};
        const peak = window.App?.peakWindows || {};
        const curve = curves[nPos] || { build: [22, 24], peak: peak[nPos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak || [24, 29];
        const declineHi = curve.decline?.[1] || pHi + 3;
        if (!age) return { label: 'Window —', color: 'var(--silver)', years: null };
        if (age < pLo) return { label: 'Rising', color: 'var(--k-2ecc71, #2ecc71)', years: Math.max(0, pHi - age) };
        if (age <= pHi) return { label: 'Peak', color: 'var(--gold)', years: Math.max(0, pHi - age) };
        if (age <= declineHi) return { label: 'Value', color: 'var(--k-f0a500, #f0a500)', years: Math.max(0, declineHi - age) };
        return { label: 'Late', color: 'var(--k-e74c3c, #e74c3c)', years: 0 };
    }

    function projectionFor(player) {
        const dhq = Number(player?.dhq || player?.val || 0);
        const age = ageOf(player);
        const project = window.App?.PlayerValue?.projectPlayerValue;
        if (!project || !dhq || !age) {
            return { y1: dhq, y3: dhq, y5: dhq };
        }
        return {
            y1: project(player.pid, dhq, age, player.pos, 1),
            y3: project(player.pid, dhq, age, player.pos, 3),
            y5: project(player.pid, dhq, age, player.pos, 5),
        };
    }

    function BigBoardPanel({ state, dispatch, isUserTurn }) {
        const boardContext = state.draftContext?.boardContext || null;
        const lanes = boardContext?.lanes || {};
        const defaultLane = boardContext?.activeLane || 'dhq';

        const [posFilter, setPosFilter] = React.useState('');
        const [search, setSearch] = React.useState('');
        const [sortKey, setSortKey] = React.useState('board');
        const [sortDir, setSortDir] = React.useState(1);
        const [boardLane, setBoardLane] = React.useState(defaultLane);
        const [dragPid, setDragPid] = React.useState(null);
        const [bucket, setBucket] = React.useState(() => bpBucket());

        React.useEffect(() => {
            if (boardContext?.activeLane && boardContext.activeLane !== boardLane) {
                setBoardLane(boardContext.activeLane);
            }
        }, [boardContext?.activeLane]);

        // Track the signature of the board we're currently showing so the listener
        // below can tell a real edit from the Draft tab apart from the echo of our
        // own writes to the shared store.
        const liveBoardSigRef = React.useRef('');
        React.useEffect(() => {
            liveBoardSigRef.current = boardUserSig({
                myOrder: boardContext?.lanes?.my?.order || [],
                tags: boardContext?.tags || {},
                notes: boardContext?.notes || {},
                drafted: boardContext?.drafted || [],
                activeLane: boardContext?.activeLane,
            });
        }, [boardContext]);

        // Absorb Big Board edits made on the Draft tab (or another tab) into the live
        // draft room. Both views persist to the same key; this dispatch folds an
        // incoming snapshot into the live board context so a reorder/tag/note on one
        // side flows to the other. This path never writes storage, so it can't loop.
        React.useEffect(() => {
            const keys = window.App?.WR_KEYS;
            const typedKey = keys?.BIGBOARD_DRAFT ? keys.BIGBOARD_DRAFT(state.leagueId, state.variant || 'startup') : null;
            const legacyKey = keys?.BIGBOARD ? keys.BIGBOARD(state.leagueId) : null;
            const absorb = (value) => {
                if (!value || boardUserSig(value) === liveBoardSigRef.current) return; // our own echo / no change
                liveBoardSigRef.current = boardUserSig(value);
                dispatch({
                    type: 'UPDATE_BOARD_CONTEXT',
                    patch: {
                        myOrder: value.myOrder,
                        tags: value.tags,
                        notes: value.notes,
                        tiers: value.tiers,
                        drafted: value.drafted,
                        activeLane: value.activeLane,
                    },
                });
            };
            const onBoardWrite = (e) => {
                const d = e?.detail;
                if (!d || (d.key !== typedKey && d.key !== legacyKey)) return;
                absorb(d.value);
            };
            const onStorage = (e) => {
                if (!e || (e.key !== typedKey && e.key !== legacyKey) || e.newValue == null) return;
                try { absorb(JSON.parse(e.newValue)); } catch (err) { /* ignore malformed */ }
            };
            window.addEventListener('wr:bigboard-write', onBoardWrite);
            window.addEventListener('storage', onStorage);
            return () => {
                window.removeEventListener('wr:bigboard-write', onBoardWrite);
                window.removeEventListener('storage', onStorage);
            };
        }, [state.leagueId, state.variant, dispatch]);

        // Re-read viewport bucket on resize so the iPad/narrow row cap stays accurate.
        React.useEffect(() => {
            const onResize = () => setBucket(bpBucket());
            window.addEventListener('resize', onResize);
            return () => window.removeEventListener('resize', onResize);
        }, []);

        // Allow the "my" lane to activate even before a manual order exists — it
        // renders the DHQ order as a draggable starting point, and the first drag
        // persists the manual order. (Otherwise an empty My Board silently falls
        // back to DHQ and can never be reordered.)
        const activeLane = (boardLane === 'my' || lanes[boardLane]) ? boardLane : 'dhq';
        const activeLaneData = lanes[activeLane] || lanes.dhq || { order: [] };
        const activeRanks = React.useMemo(() => rankMap(activeLaneData.order || []), [activeLaneData]);
        const dhqRanks = React.useMemo(() => rankMap(lanes.dhq?.order || []), [lanes.dhq]);
        const aiRanks = React.useMemo(() => rankMap(lanes.ai?.order || []), [lanes.ai]);
        const myRanks = React.useMemo(() => rankMap(lanes.my?.order || []), [lanes.my]);

        const posColors = window.App?.POS_COLORS || {
            QB: 'var(--k-ff6b6b, #ff6b6b)', RB: 'var(--k-4ecdc4, #4ecdc4)', WR: 'var(--k-45b7d1, #45b7d1)', TE: 'var(--k-f7dc6f, #f7dc6f)',
            K: 'var(--k-bb8fce, #bb8fce)', DEF: 'var(--k-85929e, #85929e)', DL: 'var(--k-e67e22, #e67e22)', LB: 'var(--k-f0a500, #f0a500)', DB: 'var(--k-5dade2, #5dade2)',
        };
        const posLabel = window.App?.posLabel || (pos => pos === 'DEF' ? 'D/ST' : pos);

        const entryFor = React.useCallback((player) => {
            const pid = idOf(player);
            return boardContext?.entries?.[pid] || {};
        }, [boardContext]);

        const decoratedPool = React.useMemo(() => {
            // Keep undrafted players exactly as state.pool provides them, then re-add
            // any drafted players from the full original pool so they stay on the board
            // (struck through) instead of vanishing the moment they're picked.
            const drafted = state.draftedPids || {};
            const live = state.pool || [];
            const liveIds = new Set(live.map(p => String(idOf(p))));
            const draftedExtra = (state.originalPool || [])
                .filter(p => drafted[idOf(p)] && !liveIds.has(String(idOf(p))));
            return [...live, ...draftedExtra].map(player => {
                const pid = idOf(player);
                const entry = boardContext?.entries?.[pid] || {};
                const projections = projectionFor(player);
                const windowInfo = valueWindow(player);
                const dhqRank = entry.dhqRank || dhqRanks[pid] || null;
                const aiRank = entry.aiRank || aiRanks[pid] || null;
                const myRank = entry.myRank || myRanks[pid] || null;
                const activeRank = activeRanks[pid] || (activeLane === 'ai' ? aiRank : activeLane === 'my' ? myRank : dhqRank) || 99999;
                return {
                    ...player,
                    _board: {
                        entry,
                        projections,
                        windowInfo,
                        activeRank,
                        dhqRank,
                        aiRank,
                        myRank,
                        tag: entry.tag,
                        note: entry.note || '',
                        tier: entry.tier || player.tier || player.csv?.tier || null,
                        rankDelta: dhqRank && activeRank && activeRank < 99999 ? dhqRank - activeRank : 0,
                    },
                    _drafted: !!drafted[pid],
                };
            });
        }, [state.pool, state.originalPool, state.draftedPids, boardContext, activeLane, activeRanks, dhqRanks, aiRanks, myRanks]);

        const available = React.useMemo(() => {
            const filtered = decoratedPool.filter(p => {
                if (posFilter && normEdPos(p.pos) !== posFilter) return false;
                if (search) {
                    const q = search.toLowerCase();
                    const hay = [p.name, p.team, p.nflTeam, p.college, p.csv?.college].filter(Boolean).join(' ').toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
            const sorted = filtered.slice().sort((a, b) => {
                const dir = sortDir;
                if (sortKey === 'board') return dir * ((a._board.activeRank - b._board.activeRank) || ((b.dhq || 0) - (a.dhq || 0)));
                if (sortKey === 'name') return dir * String(a.name || '').localeCompare(String(b.name || ''));
                if (sortKey === 'pos') { const x = normEdPos(a.pos) || '', y = normEdPos(b.pos) || ''; return x === y ? ((b.dhq || 0) - (a.dhq || 0)) : dir * x.localeCompare(y); }
                if (sortKey === 'tier') return dir * ((a._board.tier || 99) - (b._board.tier || 99));
                if (sortKey === 'age') return dir * ((ageOf(a) || 99) - (ageOf(b) || 99));
                if (sortKey === 'team') { const x = nflTeamOf(a) || '', y = nflTeamOf(b) || ''; if (!x !== !y) return x ? -1 : 1; return dir * x.localeCompare(y); }
                if (sortKey === 'college') { const x = collegeOf(a) || '', y = collegeOf(b) || ''; if (!x !== !y) return x ? -1 : 1; return dir * x.localeCompare(y); }
                return dir * ((b.dhq || 0) - (a.dhq || 0));
            });
            return sorted.slice(0, 100);
        }, [decoratedPool, posFilter, search, sortKey, sortDir]);

        const availablePositions = React.useMemo(() => {
            const set = new Set();
            (state.pool || []).slice(0, 120).forEach(p => { if (p.pos) set.add(normEdPos(p.pos)); });
            const priority = { QB: 1, RB: 2, WR: 3, TE: 4, DL: 5, LB: 6, DB: 7, K: 8 };
            return Array.from(set).sort((a, b) => (priority[a] || 99) - (priority[b] || 99));
        }, [state.pool]);

        const persistBoardPatch = React.useCallback((patch) => {
            // Key the board by the league draft VARIANT, never the live-sync MODE, so
            // edits here land on the same store the Draft tab's Big Board reads/writes
            // (state.draftContext.draftType is 'live-sync' during a live draft).
            const draftType = state.variant || 'startup';
            const saved = window.DraftCC?.context?.saveBoardPatch?.(state.leagueId, draftType, patch);
            dispatch({ type: 'UPDATE_BOARD_CONTEXT', patch: { ...patch, ...(saved?.updatedAt ? { updatedAt: saved.updatedAt } : {}) } });
        }, [state.leagueId, state.variant]);

        const onLaneSelect = (lane) => {
            setBoardLane(lane);
            persistBoardPatch({ activeLane: lane });
        };

        const onSeedMyBoardFromAi = () => {
            const aiOrder = lanes.ai?.order || [];
            if (!aiOrder.length) return;
            setBoardLane('my');
            persistBoardPatch({ activeLane: 'my', myOrder: aiOrder.slice() });
        };

        const onCycleTag = (player) => {
            const pid = idOf(player);
            if (!pid) return;
            const current = entryFor(player).tag || null;
            const idx = TAG_CYCLE.indexOf(current);
            const next = TAG_CYCLE[(idx + 1) % TAG_CYCLE.length];
            persistBoardPatch({ tags: { [pid]: next }, activeLane: boardLane });
        };

        const onEditNote = (player) => {
            const pid = idOf(player);
            if (!pid) return;
            const current = entryFor(player).note || '';
            const next = prompt('Private board note for ' + (player.name || 'player') + ':', current);
            if (next === null) return;
            persistBoardPatch({ notes: { [pid]: next.trim() }, activeLane: boardLane });
        };

        const manualOrderIds = React.useCallback(() => {
            const order = (lanes.my?.order || []).map(String).filter(Boolean);
            const seen = new Set(order);
            (state.pool || []).forEach(player => {
                const pid = idOf(player);
                if (!pid || seen.has(pid)) return;
                seen.add(pid);
                order.push(pid);
            });
            return order;
        }, [lanes.my, state.pool]);

        const saveManualOrder = React.useCallback((order) => {
            setBoardLane('my');
            setSortKey('board');
            setSortDir(1);
            persistBoardPatch({ activeLane: 'my', myOrder: order });
        }, [persistBoardPatch]);

        const onMovePlayer = (player, delta) => {
            const pid = idOf(player);
            const order = manualOrderIds();
            const idx = order.indexOf(pid);
            if (!pid || idx < 0) return;
            const nextIdx = Math.max(0, Math.min(order.length - 1, idx + delta));
            if (nextIdx === idx) return;
            const next = order.slice();
            const [moved] = next.splice(idx, 1);
            next.splice(nextIdx, 0, moved);
            saveManualOrder(next);
        };

        const onDropPlayer = (target) => {
            const sourcePid = dragPid;
            const targetPid = idOf(target);
            setDragPid(null);
            if (!sourcePid || !targetPid || sourcePid === targetPid || activeLane !== 'my') return;
            const order = manualOrderIds().filter(pid => pid !== sourcePid);
            const targetIdx = order.indexOf(targetPid);
            if (targetIdx < 0) return;
            order.splice(targetIdx, 0, sourcePid);
            saveManualOrder(order);
        };

        const onEditTier = (player) => {
            const pid = idOf(player);
            if (!pid) return;
            const current = entryFor(player).tier || player.tier || player.csv?.tier || '';
            const raw = prompt('Tier for ' + (player.name || 'player') + ' (1-12, blank to clear):', current ? String(current) : '');
            if (raw === null) return;
            const trimmed = raw.trim();
            const value = trimmed === '' ? 0 : parseInt(trimmed, 10);
            if (trimmed && (!Number.isFinite(value) || value < 1 || value > 12)) return;
            persistBoardPatch({ tiers: { [pid]: value }, activeLane: boardLane });
        };

        const onDraft = (player) => {
            const canPick = isUserTurn || state.overrideMode || state.mode === 'manual';
            if (!canPick) return;
            dispatch({
                type: 'MAKE_PICK',
                player,
                isUser: isUserTurn,
                reasoning: state.overrideMode
                    ? { primary: state.mode === 'live-sync' ? 'Manual live correction' : 'User override', baseVal: player.dhq, nudges: [] }
                    : state.mode === 'manual'
                        ? { primary: 'Manual room entry', baseVal: player.dhq, nudges: [] }
                        : { primary: 'User selection', baseVal: player.dhq, nudges: [] },
                confidence: 1.0,
                source: state.mode === 'live-sync' && state.overrideMode ? 'manual-live' : state.mode === 'manual' ? 'manual-draft' : null,
            });
        };

        const onOpenModal = (player) => {
            if (typeof window.openPlayerModal === 'function' && !player.isCSV) {
                try { window.openPlayerModal(player.pid); return; } catch (e) {}
            }
            if (typeof window.WR?.openPlayerCard === 'function') {
                try { window.WR.openPlayerCard(player.pid); } catch (e) {}
            }
        };

        // Google-Sheets-style sortable column header: click to sort, click again to flip.
        const colHeader = (key, label, align) => (
            <button onClick={() => {
                if (sortKey === key) setSortDir(d => d * -1);
                else { setSortKey(key); setSortDir((key === 'dhq' || key === 'board') ? -1 : 1); }
            }} title={'Sort by ' + label} style={{
                display: 'flex', alignItems: 'center', minWidth: 0,
                justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
                gap: 2, background: 'transparent', border: 0, padding: 0, cursor: 'pointer',
                color: sortKey === key ? 'var(--gold)' : 'var(--silver)',
                opacity: sortKey === key ? 1 : 0.62,
                fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_UI, fontWeight: 800,
                textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', overflow: 'hidden',
            }}>{label}{sortKey === key ? (sortDir === -1 ? ' ▾' : ' ▴') : ''}</button>
        );

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 12px',
        });

        // iPad / narrow cap: show ~15 player rows then scroll. Desktop is unrestricted
        // (flex fills the panel). DHQ/AI rows are one line (~46px incl. padding+border);
        // My Board adds a second control row (~38px) per visible row.
        const ROWS_VISIBLE = 15;
        const rowHeight = activeLane === 'my' ? 84 : 46;
        const scrollMaxHeight = bucket === 'desktop' ? undefined : (ROWS_VISIBLE * rowHeight) + 'px';

        const laneSource = activeLaneData.source || '';
        const laneCopy = activeLane === 'my' && laneSource === 'seeded_from_ai'
            ? 'Seeded from AI. Edits create your manual fork.'
            : activeLane === 'ai'
                ? 'Generated from GM strategy, roster fit, and format.'
                : activeLane === 'dhq'
                    ? 'Canonical DHQ value order.'
                    : '';

        return (
            <div style={containerCss}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Big Board
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.65, fontFamily: FONT_UI }}>
                        {state.pool.length} avail
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px', marginBottom: '6px' }}>
                    {['dhq', 'ai', 'my'].map(lane => {
                        const active = activeLane === lane;
                        return (
                            <button key={lane} onClick={() => onLaneSelect(lane)} style={{
                                minWidth: 0,
                                padding: '5px 4px',
                                borderRadius: '5px',
                                border: '1px solid ' + (active ? 'var(--acc-line4, rgba(212,175,55,0.55))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                                background: active ? 'var(--acc-fill3, rgba(212,175,55,0.16))' : 'var(--ov-2, rgba(255,255,255,0.025))',
                                color: active ? 'var(--gold)' : 'var(--silver)',
                                cursor: 'pointer',
                                fontFamily: FONT_UI,
                                textAlign: 'left',
                            }}>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{LANE_LABELS[lane].short}</div>
                                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{LANE_LABELS[lane].sub}</div>
                            </button>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '7px', minHeight: 18 }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--silver)', opacity: 0.62, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_UI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{laneCopy}</span>
                    {activeLane === 'my' && boardContext?.canSeedMyBoardFromAi && (
                        <button onClick={onSeedMyBoardFromAi} style={{
                            padding: '2px 6px',
                            border: '1px solid var(--acc-line1, rgba(212,175,55,0.25))',
                            background: 'var(--acc-fill2, rgba(212,175,55,0.08))',
                            color: 'var(--gold)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            fontFamily: FONT_UI,
                            fontWeight: 700,
                            flexShrink: 0,
                        }}>SEED</button>
                    )}
                </div>

                <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Search players, teams, colleges..."
                    style={{
                        width: '100%',
                        boxSizing: 'border-box',
                        padding: '6px 8px',
                        background: 'var(--ov-2, rgba(255,255,255,0.03))',
                        border: '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                        borderRadius: '4px',
                        color: 'var(--white)',
                        fontSize: '0.72rem',
                        fontFamily: FONT_UI,
                        outline: 'none',
                        marginBottom: '6px',
                    }}
                />

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px' }}>
                    <button onClick={() => setPosFilter('')} style={{
                        padding: '2px 10px',
                        minHeight: '40px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 'var(--text-micro, 0.6875rem)',
                        borderRadius: '10px',
                        border: '1px solid ' + (posFilter === '' ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                        background: posFilter === '' ? 'var(--acc-fill3, rgba(212,175,55,0.15))' : 'transparent',
                        color: posFilter === '' ? 'var(--gold)' : 'var(--silver)',
                        cursor: 'pointer',
                        fontFamily: FONT_UI,
                    }}>ALL</button>
                    {availablePositions.map(pos => (
                        <button key={pos} onClick={() => setPosFilter(posFilter === pos ? '' : pos)} style={{
                            padding: '2px 10px',
                            minHeight: '40px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 'var(--text-micro, 0.6875rem)',
                            borderRadius: '10px',
                            border: '1px solid ' + (posFilter === pos ? (posColors[pos] || 'var(--k-666666, #666666)') + '66' : 'var(--ov-5, rgba(255,255,255,0.08))'),
                            background: posFilter === pos ? (posColors[pos] || 'var(--k-666666, #666666)') + '22' : 'transparent',
                            color: posFilter === pos ? (posColors[pos] || 'var(--silver)') : 'var(--silver)',
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                            fontWeight: 600,
                        }}>{posLabel(pos)}</button>
                    ))}
                </div>

                {activeLane === 'my' && (
                    <div style={{ padding: '4px 2px 7px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.72, fontFamily: FONT_UI, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontWeight: 900 }}>{'↕'}</span> Drag rows to reorder your board
                    </div>
                )}

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: (isUserTurn || state.overrideMode || state.mode === 'manual') ? '22px minmax(0,1.3fr) 40px minmax(0,0.95fr) 30px 48px 50px' : '22px minmax(0,1.3fr) 40px minmax(0,0.95fr) 30px 48px',
                    gap: '5px',
                    alignItems: 'center',
                    padding: '0 3px 4px 5px',
                    borderBottom: '1px solid var(--ov-6, rgba(255,255,255,0.12))',
                    marginBottom: '2px',
                }}>
                    {colHeader('board', '#', 'right')}
                    {colHeader('name', 'Player', 'left')}
                    {colHeader('team', 'Team', 'left')}
                    {colHeader('college', 'College', 'left')}
                    {colHeader('pos', 'Pos', 'center')}
                    {colHeader('dhq', 'DHQ', 'right')}
                    {(isUserTurn || state.overrideMode || state.mode === 'manual') && <span />}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', overscrollBehavior: 'contain', marginRight: '-4px', paddingRight: '4px', maxHeight: scrollMaxHeight }}>
                    {available.length === 0 && (
                        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--silver)', opacity: 0.4, fontSize: '0.72rem' }}>
                            No players match filter
                        </div>
                    )}
                    {available.map((p, idx) => {
                        const b = p._board || {};
                        const tag = TAG_META[b.tag];
                        const col = dhqColor(p.dhq);
                        const tCol = tierColor(b.tier);
                        const rowRank = b.activeRank < 99999 ? b.activeRank : idx + 1;
                        const posColor = posColors[normEdPos(p.pos)] || 'var(--silver)';
                        const nflTeam = nflTeamOf(p);
                        const college = collegeOf(p);
                        return (
                            <div
                                key={p.pid}
                                onClick={() => onOpenModal(p)}
                                draggable={activeLane === 'my' && !p._drafted}
                                onDragStart={e => {
                                    if (activeLane !== 'my' || p._drafted) return;
                                    setDragPid(idOf(p));
                                    e.dataTransfer.effectAllowed = 'move';
                                    try { e.dataTransfer.setData('text/plain', idOf(p)); } catch (_) {}
                                }}
                                onDragEnd={() => setDragPid(null)}
                                onDragOver={e => {
                                    if (activeLane === 'my') {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                    }
                                }}
                                onDrop={e => {
                                    if (activeLane !== 'my') return;
                                    e.preventDefault();
                                    onDropPlayer(p);
                                }}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: (isUserTurn || state.overrideMode || state.mode === 'manual') ? '22px minmax(0,1.3fr) 40px minmax(0,0.95fr) 30px 48px 50px' : '22px minmax(0,1.3fr) 40px minmax(0,0.95fr) 30px 48px',
                                    gap: '5px',
                                    alignItems: 'center',
                                    padding: '3px 3px 3px 0',
                                    borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.035))',
                                    borderLeft: b.tier ? '2px solid ' + tCol : '2px solid transparent',
                                    paddingLeft: '5px',
                                    cursor: activeLane === 'my' && !p._drafted ? 'grab' : 'pointer',
                                    opacity: p._drafted ? 0.4 : (dragPid === idOf(p) ? 0.52 : 1),
                                    background: dragPid === idOf(p) ? 'var(--acc-fill2, rgba(212,175,55,0.10))' : (idx === 0 ? 'var(--acc-fill1, rgba(212,175,55,0.045))' : 'transparent'),
                                    transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'}
                                onMouseLeave={e => e.currentTarget.style.background = dragPid === idOf(p) ? 'var(--acc-fill2, rgba(212,175,55,0.10))' : (idx === 0 ? 'var(--acc-fill1, rgba(212,175,55,0.045))' : 'transparent')}
                            >
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: rowRank <= 12 ? 'var(--gold)' : 'var(--ov-8, rgba(255,255,255,0.34))', textAlign: 'right', fontFamily: FONT_MONO }}>{rowRank}</span>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                    <span style={{ color: 'var(--white)', fontWeight: 700, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: p._drafted ? 'line-through' : 'none' }}>{p.name}</span>
                                    {tag && (
                                        <span style={{ flexShrink: 0, color: tag.color, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, border: '1px solid ' + wrAlpha(tag.color, '55'), background: wrAlpha(tag.color, '18'), borderRadius: '3px', padding: '0 4px' }}>{tag.label}</span>
                                    )}
                                </div>
                                <span title={nflTeam} style={{ color: 'var(--silver)', opacity: 0.78, fontSize: 'var(--text-micro, 0.6875rem)', fontFamily: FONT_MONO, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{nflTeam || '—'}</span>
                                <span title={college} style={{ color: 'var(--silver)', opacity: 0.7, fontSize: 'var(--text-micro, 0.6875rem)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{college || '—'}</span>
                                <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, padding: '1px 5px', borderRadius: '3px', background: wrAlpha(posColor, '22'), color: posColor, textAlign: 'center', fontFamily: FONT_UI }}>{normEdPos(p.pos)}</span>
                                <span style={{ color: col, fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 800, fontFamily: FONT_MONO, textAlign: 'right' }}>{fmt(p.dhq)}</span>
                                {(isUserTurn || state.overrideMode || state.mode === 'manual') && (
                                    <button
                                        onClick={e => { e.stopPropagation(); onDraft(p); }}
                                        title={state.overrideMode || state.mode === 'manual' ? 'Record the player for the team on the clock' : 'Make your pick'}
                                        style={{
                                            padding: '10px 8px',
                                            minHeight: '44px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: 'var(--text-micro, 0.6875rem)',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                            background: state.overrideMode ? 'var(--purple)' : 'var(--gold)',
                                            color: state.overrideMode ? 'var(--k-ffffff, #ffffff)' : 'var(--black)',
                                            border: 'none',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                        }}
                                    >{state.mode === 'live-sync' && state.overrideMode ? 'APPLY' : state.mode === 'manual' ? 'PICK' : (state.overrideMode ? 'FORCE' : 'DRAFT')}</button>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.BigBoardPanel = BigBoardPanel;
})();

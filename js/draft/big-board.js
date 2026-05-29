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
    const { FONT_UI, FONT_DISPL, FONT_MONO, panelCard, dhqColor, tierColor } = window.DraftCC.styles;

    const LANE_LABELS = {
        dhq: { label: 'DHQ Board', short: 'DHQ', sub: 'canonical value' },
        ai:  { label: 'AI Recommended', short: 'AI', sub: 'GM strategy' },
        my:  { label: 'My Board', short: 'MY', sub: 'front-office prep' },
    };

    const VIEW_LABELS = [
        { key: 'compact', label: 'Compact' },
        { key: 'scout', label: 'Scout' },
        { key: 'fit', label: 'Fit' },
        { key: 'value', label: 'Value' },
    ];

    const TAG_META = {
        target:  { label: 'Target', color: '#2ECC71' },
        sleeper: { label: 'Watch', color: '#3498DB' },
        fade:    { label: 'Fade', color: '#F0A500' },
        avoid:   { label: 'DND', color: '#E74C3C' },
        must:    { label: 'Must', color: '#D4AF37' },
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

    function signed(value) {
        const n = Number(value || 0);
        if (!n) return '0';
        return n > 0 ? '+' + n : String(n);
    }

    function rankMap(order) {
        const out = {};
        (order || []).forEach((pid, idx) => { if (pid != null) out[String(pid)] = idx + 1; });
        return out;
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
        if (age < pLo) return { label: 'Rising', color: '#2ECC71', years: Math.max(0, pHi - age) };
        if (age <= pHi) return { label: 'Peak', color: 'var(--gold)', years: Math.max(0, pHi - age) };
        if (age <= declineHi) return { label: 'Value', color: '#F0A500', years: Math.max(0, declineHi - age) };
        return { label: 'Late', color: '#E74C3C', years: 0 };
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
        const [boardView, setBoardView] = React.useState('compact');
        const [dragPid, setDragPid] = React.useState(null);

        React.useEffect(() => {
            if (boardContext?.activeLane && boardContext.activeLane !== boardLane) {
                setBoardLane(boardContext.activeLane);
            }
        }, [boardContext?.activeLane]);

        const activeLane = lanes[boardLane] ? boardLane : 'dhq';
        const activeLaneData = lanes[activeLane] || lanes.dhq || { order: [] };
        const activeRanks = React.useMemo(() => rankMap(activeLaneData.order || []), [activeLaneData]);
        const dhqRanks = React.useMemo(() => rankMap(lanes.dhq?.order || []), [lanes.dhq]);
        const aiRanks = React.useMemo(() => rankMap(lanes.ai?.order || []), [lanes.ai]);
        const myRanks = React.useMemo(() => rankMap(lanes.my?.order || []), [lanes.my]);

        const posColors = window.App?.POS_COLORS || {
            QB: '#FF6B6B', RB: '#4ECDC4', WR: '#45B7D1', TE: '#F7DC6F',
            K: '#BB8FCE', DEF: '#85929E', DL: '#E67E22', LB: '#F0A500', DB: '#5DADE2',
        };
        const posLabel = window.App?.posLabel || (pos => pos === 'DEF' ? 'D/ST' : pos);

        const entryFor = React.useCallback((player) => {
            const pid = idOf(player);
            return boardContext?.entries?.[pid] || {};
        }, [boardContext]);

        const decoratedPool = React.useMemo(() => {
            return (state.pool || []).map(player => {
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
                };
            });
        }, [state.pool, boardContext, activeLane, activeRanks, dhqRanks, aiRanks, myRanks]);

        const available = React.useMemo(() => {
            const filtered = decoratedPool.filter(p => {
                if (posFilter && p.pos !== posFilter) return false;
                if (search) {
                    const q = search.toLowerCase();
                    const hay = [p.name, p.team, p.nflTeam, p.college, p.csv?.college].filter(Boolean).join(' ').toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
            const sorted = filtered.slice().sort((a, b) => {
                const dir = sortDir;
                if (sortKey === 'board') return (a._board.activeRank - b._board.activeRank) || ((b.dhq || 0) - (a.dhq || 0));
                if (sortKey === 'rank') return dir * ((a.consensusRank || a.rank || 9999) - (b.consensusRank || b.rank || 9999));
                if (sortKey === 'tier') return dir * ((a._board.tier || 99) - (b._board.tier || 99));
                if (sortKey === 'age') return dir * ((ageOf(a) || 99) - (ageOf(b) || 99));
                if (sortKey === 'fit') return dir * ((b.fit?.score || 0) - (a.fit?.score || 0));
                if (sortKey === 'y5') return dir * ((b._board.projections.y5 || 0) - (a._board.projections.y5 || 0));
                return dir * ((b.dhq || 0) - (a.dhq || 0));
            });
            return sorted.slice(0, 100);
        }, [decoratedPool, posFilter, search, sortKey, sortDir]);

        const availablePositions = React.useMemo(() => {
            const set = new Set();
            (state.pool || []).slice(0, 120).forEach(p => { if (p.pos) set.add(p.pos); });
            const priority = { QB: 1, RB: 2, WR: 3, TE: 4, DL: 5, LB: 6, DB: 7, K: 8 };
            return Array.from(set).sort((a, b) => (priority[a] || 99) - (priority[b] || 99));
        }, [state.pool]);

        const persistBoardPatch = React.useCallback((patch) => {
            const draftType = state.draftContext?.draftType || state.variant || 'startup';
            const saved = window.DraftCC?.context?.saveBoardPatch?.(state.leagueId, draftType, patch);
            dispatch({ type: 'UPDATE_BOARD_CONTEXT', patch: { ...patch, ...(saved?.updatedAt ? { updatedAt: saved.updatedAt } : {}) } });
        }, [state.leagueId, state.variant, state.draftContext?.draftType]);

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

        const sortButton = (key, label, defaultDir) => (
            <button key={key} onClick={() => {
                if (sortKey === key) setSortDir(d => d * -1);
                else { setSortKey(key); setSortDir(defaultDir); }
            }} style={{
                padding: '2px 7px',
                fontSize: '0.6rem',
                borderRadius: '3px',
                border: '1px solid ' + (sortKey === key ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                background: sortKey === key ? 'rgba(212,175,55,0.15)' : 'transparent',
                color: sortKey === key ? 'var(--gold)' : 'var(--silver)',
                cursor: 'pointer',
                fontFamily: FONT_UI,
                fontWeight: sortKey === key ? 700 : 500,
            }}>{label}{sortKey === key ? (sortDir === -1 ? ' ▼' : ' ▲') : ''}</button>
        );

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 12px',
        });

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
                    <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.65, fontFamily: FONT_UI }}>
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
                                border: '1px solid ' + (active ? 'rgba(212,175,55,0.55)' : 'rgba(255,255,255,0.08)'),
                                background: active ? 'rgba(212,175,55,0.16)' : 'rgba(255,255,255,0.025)',
                                color: active ? 'var(--gold)' : 'var(--silver)',
                                cursor: 'pointer',
                                fontFamily: FONT_UI,
                                textAlign: 'left',
                            }}>
                                <div style={{ fontSize: '0.62rem', fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{LANE_LABELS[lane].short}</div>
                                <div style={{ fontSize: '0.48rem', opacity: 0.65, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{LANE_LABELS[lane].sub}</div>
                            </button>
                        );
                    })}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '7px', minHeight: 18 }}>
                    <span style={{ flex: 1, minWidth: 0, color: 'var(--silver)', opacity: 0.62, fontSize: '0.56rem', fontFamily: FONT_UI, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{laneCopy}</span>
                    {activeLane === 'my' && boardContext?.canSeedMyBoardFromAi && (
                        <button onClick={onSeedMyBoardFromAi} style={{
                            padding: '2px 6px',
                            border: '1px solid rgba(212,175,55,0.25)',
                            background: 'rgba(212,175,55,0.08)',
                            color: 'var(--gold)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            fontSize: '0.52rem',
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
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: '4px',
                        color: 'var(--white)',
                        fontSize: '0.72rem',
                        fontFamily: FONT_UI,
                        outline: 'none',
                        marginBottom: '6px',
                    }}
                />

                <div style={{ display: 'flex', gap: '3px', marginBottom: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.65, fontFamily: FONT_UI, marginRight: '2px' }}>SORT:</span>
                    {sortButton('board', 'Board', 1)}
                    {sortButton('dhq', 'DHQ', -1)}
                    {sortButton('tier', 'Tier', 1)}
                    {sortButton('age', 'Age', 1)}
                    {sortButton('fit', 'Fit', -1)}
                    {sortButton('y5', 'Y5', -1)}
                </div>

                <div style={{ display: 'flex', gap: '3px', marginBottom: '6px', flexWrap: 'wrap' }}>
                    {VIEW_LABELS.map(view => (
                        <button key={view.key} onClick={() => setBoardView(view.key)} style={{
                            padding: '2px 7px',
                            borderRadius: '10px',
                            border: '1px solid ' + (boardView === view.key ? 'rgba(212,175,55,0.35)' : 'rgba(255,255,255,0.08)'),
                            background: boardView === view.key ? 'rgba(212,175,55,0.12)' : 'transparent',
                            color: boardView === view.key ? 'var(--gold)' : 'var(--silver)',
                            cursor: 'pointer',
                            fontSize: '0.56rem',
                            fontFamily: FONT_UI,
                            fontWeight: 700,
                        }}>{view.label}</button>
                    ))}
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '8px' }}>
                    <button onClick={() => setPosFilter('')} style={{
                        padding: '2px 8px',
                        fontSize: '0.62rem',
                        borderRadius: '10px',
                        border: '1px solid ' + (posFilter === '' ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                        background: posFilter === '' ? 'rgba(212,175,55,0.15)' : 'transparent',
                        color: posFilter === '' ? 'var(--gold)' : 'var(--silver)',
                        cursor: 'pointer',
                        fontFamily: FONT_UI,
                    }}>ALL</button>
                    {availablePositions.map(pos => (
                        <button key={pos} onClick={() => setPosFilter(posFilter === pos ? '' : pos)} style={{
                            padding: '2px 8px',
                            fontSize: '0.62rem',
                            borderRadius: '10px',
                            border: '1px solid ' + (posFilter === pos ? (posColors[pos] || '#666') + '66' : 'rgba(255,255,255,0.08)'),
                            background: posFilter === pos ? (posColors[pos] || '#666') + '22' : 'transparent',
                            color: posFilter === pos ? (posColors[pos] || 'var(--silver)') : 'var(--silver)',
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                            fontWeight: 600,
                        }}>{posLabel(pos)}</button>
                    ))}
                </div>

                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', marginRight: '-4px', paddingRight: '4px' }}>
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
                        const win = b.windowInfo || valueWindow(p);
                        const rowRank = b.activeRank < 99999 ? b.activeRank : idx + 1;
                        const posColor = posColors[p.pos] || 'var(--silver)';
                        const note = b.note || '';
                        const showSecondLine = boardView !== 'compact' || note || tag;
                        return (
                            <div
                                key={p.pid}
                                onClick={() => onOpenModal(p)}
                                draggable={activeLane === 'my'}
                                onDragStart={e => {
                                    if (activeLane !== 'my') return;
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
                                    gridTemplateColumns: (isUserTurn || state.overrideMode || state.mode === 'manual') ? '24px minmax(0,1fr) 34px 44px 48px 44px 56px' : '24px minmax(0,1fr) 34px 44px 48px 44px',
                                    gap: '5px',
                                    alignItems: 'center',
                                    padding: '6px 3px 6px 0',
                                    borderBottom: '1px solid rgba(255,255,255,0.035)',
                                    borderLeft: b.tier ? '2px solid ' + tCol : '2px solid transparent',
                                    paddingLeft: '5px',
                                    cursor: activeLane === 'my' ? 'grab' : 'pointer',
                                    opacity: dragPid === idOf(p) ? 0.52 : 1,
                                    background: dragPid === idOf(p) ? 'rgba(212,175,55,0.10)' : (idx === 0 ? 'rgba(212,175,55,0.045)' : 'transparent'),
                                    transition: 'background 0.1s',
                                }}
                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.06)'}
                                onMouseLeave={e => e.currentTarget.style.background = dragPid === idOf(p) ? 'rgba(212,175,55,0.10)' : (idx === 0 ? 'rgba(212,175,55,0.045)' : 'transparent')}
                            >
                                <span style={{ fontSize: '0.62rem', color: rowRank <= 12 ? 'var(--gold)' : 'rgba(255,255,255,0.34)', textAlign: 'right', fontFamily: FONT_MONO }}>{rowRank}</span>
                                <div style={{ minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', minWidth: 0 }}>
                                        <span style={{ color: 'var(--white)', fontWeight: 700, fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                                        {b.rankDelta !== 0 && activeLane !== 'dhq' && (
                                            <span style={{
                                                flexShrink: 0,
                                                color: b.rankDelta > 0 ? '#2ECC71' : '#E74C3C',
                                                fontSize: '0.52rem',
                                                fontFamily: FONT_MONO,
                                                border: '1px solid rgba(255,255,255,0.08)',
                                                borderRadius: '3px',
                                                padding: '0 3px',
                                            }}>{signed(b.rankDelta)}</span>
                                        )}
                                        {tag && (
                                            <span style={{ flexShrink: 0, color: tag.color, fontSize: '0.5rem', fontWeight: 800, border: '1px solid ' + tag.color + '55', background: tag.color + '18', borderRadius: '3px', padding: '0 4px' }}>{tag.label}</span>
                                        )}
                                    </div>
                                    {showSecondLine && (
                                        <div style={{ color: 'var(--silver)', opacity: 0.62, fontSize: '0.56rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {boardView === 'fit' && p.fit?.score != null ? 'Fit ' + p.fit.score + ' · ' : ''}
                                            {boardView === 'scout' && (p.college || p.team || p.nflTeam) ? (p.college || p.team || p.nflTeam) + ' · ' : ''}
                                            {boardView === 'value' ? win.label + (win.years != null ? ' ' + win.years + 'yr · ' : ' · ') : ''}
                                            {note || (b.tier ? 'Tier ' + b.tier : 'Click for player context')}
                                        </div>
                                    )}
                                </div>
                                <span style={{ fontSize: '0.56rem', fontWeight: 800, padding: '1px 5px', borderRadius: '3px', background: posColor + '22', color: posColor, textAlign: 'center', fontFamily: FONT_UI }}>{p.pos}</span>
                                <span style={{ color: col, fontSize: '0.62rem', fontWeight: 800, fontFamily: FONT_MONO, textAlign: 'right' }}>{fmt(p.dhq)}</span>
                                <span style={{ color: b.projections?.y5 >= (p.dhq || 0) ? '#2ECC71' : 'var(--silver)', fontSize: '0.58rem', fontFamily: FONT_MONO, textAlign: 'right' }}>Y5 {fmt(b.projections?.y5)}</span>
                                <span style={{ color: win.color, fontSize: '0.52rem', fontWeight: 800, textAlign: 'center', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '3px', padding: '1px 2px' }}>{win.label}</span>
                                {(isUserTurn || state.overrideMode || state.mode === 'manual') && (
                                    <button
                                        onClick={e => { e.stopPropagation(); onDraft(p); }}
                                        title={state.overrideMode || state.mode === 'manual' ? 'Record the player for the team on the clock' : 'Make your pick'}
                                        style={{
                                            padding: '4px 6px',
                                            fontSize: '0.58rem',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                            background: state.overrideMode ? '#9b8afb' : 'var(--gold)',
                                            color: state.overrideMode ? '#fff' : 'var(--black)',
                                            border: 'none',
                                            borderRadius: '3px',
                                            cursor: 'pointer',
                                        }}
                                    >{state.mode === 'live-sync' && state.overrideMode ? 'APPLY' : state.mode === 'manual' ? 'PICK' : (state.overrideMode ? 'FORCE' : 'DRAFT')}</button>
                                )}
                                {activeLane === 'my' && (
                                    <div style={{ gridColumn: '2 / -1', display: 'flex', gap: '5px', alignItems: 'center', marginTop: '-2px' }}>
                                        <button onClick={e => { e.stopPropagation(); onMovePlayer(p, -1); }} style={{
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            background: 'rgba(255,255,255,0.03)',
                                            color: 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: '0.5rem',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                        }}>UP</button>
                                        <button onClick={e => { e.stopPropagation(); onMovePlayer(p, 1); }} style={{
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            background: 'rgba(255,255,255,0.03)',
                                            color: 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: '0.5rem',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                        }}>DOWN</button>
                                        <button onClick={e => { e.stopPropagation(); onEditTier(p); }} style={{
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            background: b.tier ? tCol + '18' : 'rgba(255,255,255,0.03)',
                                            color: b.tier ? tCol : 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: '0.5rem',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                        }}>TIER</button>
                                        <button onClick={e => { e.stopPropagation(); onCycleTag(p); }} style={{
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            background: tag ? tag.color + '18' : 'rgba(255,255,255,0.03)',
                                            color: tag ? tag.color : 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: '0.5rem',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                        }}>TAG</button>
                                        <button onClick={e => { e.stopPropagation(); onEditNote(p); }} style={{
                                            padding: '2px 6px',
                                            borderRadius: '3px',
                                            border: '1px solid rgba(255,255,255,0.08)',
                                            background: note ? 'rgba(212,175,55,0.10)' : 'rgba(255,255,255,0.03)',
                                            color: note ? 'var(--gold)' : 'var(--silver)',
                                            cursor: 'pointer',
                                            fontSize: '0.5rem',
                                            fontFamily: FONT_UI,
                                            fontWeight: 800,
                                        }}>NOTE</button>
                                        {note && <span style={{ minWidth: 0, flex: 1, color: 'var(--silver)', opacity: 0.58, fontSize: '0.52rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{note}</span>}
                                    </div>
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

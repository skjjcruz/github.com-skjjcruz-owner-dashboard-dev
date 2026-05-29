// ══════════════════════════════════════════════════════════════════
// js/draft/trade-proposer.js — User-→-CPU trade proposer drawer
//
// Side drawer (slides in from right). Opened from Opponent Intel's
// "Propose Trade" button. User selects picks from their side + the
// target CPU's side; the drawer shows live DHQ totals, live psych
// taxes, and live acceptance likelihood. "Send" runs a 1.5s thinking
// animation then dispatches COMPLETE_PROPOSAL with the CPU's verdict.
//
// Depends on: styles.js, state.js, trade-simulator.js (evaluateUserProposal)
// Exposes:    window.DraftCC.TradeProposer
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, FONT_MONO } = window.DraftCC.styles;

    function TradeProposer({ state, dispatch }) {
        const drawer = state.proposerDrawer;
        if (!drawer) return null;

        const targetId = drawer.targetRosterId;
        const targetPersona = state.personas?.[targetId];
        const myPersona = state.personas?.[state.userRosterId];
        if (!targetPersona) return null;
        const sameId = (a, b) => String(a) === String(b);
        const simulator = window.DraftCC.tradeSimulator;
        const isLiveSync = state.mode === 'live-sync';
        const currentSlot = state.pickOrder[state.currentIdx] || null;

        const partnerOptions = React.useMemo(() => {
            return Object.entries(state.personas || {})
                .filter(([rid]) => !sameId(rid, state.userRosterId))
                .map(([rid, persona]) => ({
                    rosterId: rid,
                    name: persona.teamName || ('Team ' + rid),
                    dna: persona.tradeDna?.label || persona.draftDna?.label || 'Balanced',
                    posture: persona.posture?.label || 'Neutral',
                }))
                .sort((a, b) => a.name.localeCompare(b.name));
        }, [state.personas, state.userRosterId]);

        // Remaining picks (not yet made)
        const remaining = state.pickOrder.slice(state.currentIdx);
        const myRemainingPicks = remaining.filter(p => sameId(p.rosterId, state.userRosterId));
        const theirRemainingPicks = remaining.filter(p => sameId(p.rosterId, targetId));

        // Currently selected on each side
        const myGiveIds = new Set((drawer.myGive || []).map(p => p.round + '-' + p.teamIdx));
        const theirGiveIds = new Set((drawer.theirGive || []).map(p => p.round + '-' + p.teamIdx));

        const togglePick = (pick, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = pick.round + '-' + pick.teamIdx;
            const arr = side === 'my' ? (drawer.myGive || []) : (drawer.theirGive || []);
            const exists = arr.some(p => (p.round + '-' + p.teamIdx) === key);
            const next = exists
                ? arr.filter(p => (p.round + '-' + p.teamIdx) !== key)
                : [...arr, pick];
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: side === 'my' ? { myGive: next, status: 'building' } : { theirGive: next, status: 'building' },
            });
        };

        const currentProposal = React.useMemo(() => ({
            targetRosterId: targetId,
            myGive: drawer.myGive || [],
            theirGive: drawer.theirGive || [],
            myGivePlayers: drawer.myGivePlayers || [],
            theirGivePlayers: drawer.theirGivePlayers || [],
            myGiveFaab: drawer.myGiveFaab || 0,
            theirGiveFaab: drawer.theirGiveFaab || 0,
        }), [targetId, drawer.myGive, drawer.theirGive, drawer.myGivePlayers, drawer.theirGivePlayers, drawer.myGiveFaab, drawer.theirGiveFaab]);

        const partnerProfile = React.useMemo(() => {
            return simulator?.describeTradePartner ? simulator.describeTradePartner(state, targetId) : null;
        }, [simulator, state.pickOrder, state.picks, state.tradedAssets, state.personas, state.currentIdx, targetId]);

        const evaluation = React.useMemo(() => {
            if (!simulator) return { likelihood: 0, grade: null, taxes: [], myGiveDHQ: 0, theirGiveDHQ: 0 };
            return simulator.evaluateUserProposal(state, currentProposal, { preview: true });
        }, [simulator, currentProposal, state.pickOrder, state.currentIdx, targetPersona, myPersona]);

        const packageSuggestions = React.useMemo(() => {
            if (!simulator?.buildTradeSuggestions) return [];
            return simulator.buildTradeSuggestions(state, targetId, { currentProposal });
        }, [simulator, state.pickOrder, state.currentIdx, state.personas, state.tradedAssets, currentProposal, targetId]);

        // Phase 7 deferred: players + FAAB togglers
        const togglePlayer = (pid, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = side === 'my' ? 'myGivePlayers' : 'theirGivePlayers';
            const arr = drawer[key] || [];
            const exists = arr.includes(pid);
            const next = exists ? arr.filter(p => p !== pid) : [...arr, pid];
            dispatch({ type: 'UPDATE_PROPOSER', payload: { [key]: next, status: 'building' } });
        };
        const setFaab = (val, side) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            const key = side === 'my' ? 'myGiveFaab' : 'theirGiveFaab';
            dispatch({ type: 'UPDATE_PROPOSER', payload: { [key]: Math.max(0, Math.min(1000, Number(val) || 0)), status: 'building' } });
        };

        const onTargetChange = (targetRosterId) => {
            if (drawer.status === 'sending' || drawer.status === 'accepted') return;
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: {
                    targetRosterId,
                    theirGive: [],
                    theirGivePlayers: [],
                    theirGiveFaab: 0,
                    status: 'building',
                    counterOffer: null,
                    lastEvaluation: null,
                },
            });
        };

        const loadProposal = (proposal) => {
            if (!proposal || drawer.status === 'sending' || drawer.status === 'accepted') return;
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: {
                    targetRosterId: proposal.targetRosterId || targetId,
                    myGive: proposal.myGive || [],
                    theirGive: proposal.theirGive || [],
                    myGivePlayers: proposal.myGivePlayers || [],
                    theirGivePlayers: proposal.theirGivePlayers || [],
                    myGiveFaab: proposal.myGiveFaab || 0,
                    theirGiveFaab: proposal.theirGiveFaab || 0,
                    status: 'building',
                    counterOffer: null,
                    lastEvaluation: null,
                },
            });
        };

        // Surface each side's existing rosters (exclude players already picked in the draft)
        const pickedPids = new Set((state.picks || []).map(p => p.pid).filter(Boolean));
        const rosterOf = (rid) => {
            const rosters = window.S?.rosters || [];
            const r = rosters.find(x => String(x.roster_id) === String(rid));
            return (r?.players || []).filter(pid => pid && !pickedPids.has(pid));
        };
        const myPlayerIds = rosterOf(state.userRosterId);
        const theirPlayerIds = rosterOf(targetId);

        const onClose = () => dispatch({ type: 'CLOSE_PROPOSER' });

        const mySideHasAssets = (drawer.myGive?.length || 0) + (drawer.myGivePlayers?.length || 0) + (drawer.myGiveFaab || 0) > 0;
        const theirSideHasAssets = (drawer.theirGive?.length || 0) + (drawer.theirGivePlayers?.length || 0) + (drawer.theirGiveFaab || 0) > 0;

        const onSend = () => {
            if (!mySideHasAssets || !theirSideHasAssets) return;
            if (isLiveSync) {
                const result = simulator.evaluateUserProposal(state, currentProposal);
                const stagedOffer = buildLiveOfferHandoff(state, targetPersona, currentProposal, result);
                dispatch({
                    type: 'UPDATE_PROPOSER',
                    payload: {
                        status: 'planned',
                        lastEvaluation: result,
                        counterOffer: result.counterOffer || null,
                    },
                });
                dispatch({ type: 'STAGE_LIVE_OFFER', offer: stagedOffer });
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'rule',
                        badge: 'T',
                        color: 'var(--gold)',
                        title: 'Live offer staged · ' + targetPersona.teamName,
                        text: 'Read-only plan: ' + result.likelihood + '% acceptance vs ' + result.acceptanceLine + '% Buyer Line. ' + (result.reason || 'Use this as the package to offer in your live draft room.'),
                        relatedPickNo: currentSlot?.overall || null,
                    },
                });
                return;
            }
            dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'sending' } });
            // CPU "thinks" for 1.5s, then evaluates against its buyer line.
            setTimeout(() => {
                const result = simulator.evaluateUserProposal(state, currentProposal);
                if (result.accepted) {
                    const offer = {
                        fromRosterId: targetId,
                        fromName: targetPersona.teamName,
                        toRosterId: state.userRosterId,
                        theirGive: currentProposal.theirGive,
                        myGive: currentProposal.myGive,
                        theirGivePlayers: currentProposal.theirGivePlayers || [],
                        myGivePlayers: currentProposal.myGivePlayers || [],
                        theirGiveFaab: currentProposal.theirGiveFaab || 0,
                        myGiveFaab: currentProposal.myGiveFaab || 0,
                        myGainDHQ: result.theirGiveDHQ,
                        myGiveDHQ: result.myGiveDHQ,
                        theirGainDHQ: result.myGiveDHQ,
                        theirGiveDHQ: result.theirGiveDHQ,
                        likelihood: result.likelihood,
                        acceptanceLine: result.acceptanceLine,
                        counterLine: result.counterLine,
                        grade: result.grade,
                        taxes: result.taxes,
                        modifiers: result.modifiers || [],
                        reason: result.reason || 'Accepted user proposal',
                        dnaLabel: targetPersona.tradeDna?.label || targetPersona.draftDna?.label || 'Balanced',
                    };
                    dispatch({ type: 'COMPLETE_PROPOSAL', accepted: true, offer });
                } else if (result.counterOffer) {
                    dispatch({
                        type: 'UPDATE_PROPOSER',
                        payload: {
                            status: 'countered',
                            counterOffer: result.counterOffer,
                            lastEvaluation: result,
                        },
                    });
                } else {
                    dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'declined', lastEvaluation: result } });
                }
            }, 1500);
        };

        const onAcceptCounter = () => {
            if (!drawer.counterOffer) return;
            dispatch({ type: 'COMPLETE_PROPOSAL', accepted: true, offer: drawer.counterOffer });
        };

        const onLoadCounter = () => {
            const c = drawer.counterOffer;
            if (!c) return;
            dispatch({
                type: 'UPDATE_PROPOSER',
                payload: {
                    myGive: c.myGive || [],
                    theirGive: c.theirGive || [],
                    myGivePlayers: c.myGivePlayers || [],
                    theirGivePlayers: c.theirGivePlayers || [],
                    myGiveFaab: c.myGiveFaab || 0,
                    theirGiveFaab: c.theirGiveFaab || 0,
                    status: 'building',
                    counterOffer: null,
                },
            });
        };

        const gradeCol = evaluation.grade?.col || 'var(--gold)';
        const likelihoodCol = evaluation.likelihood >= 60 ? '#2ECC71'
            : evaluation.likelihood >= 40 ? '#F0A500'
            : '#E74C3C';

        const isSending = drawer.status === 'sending';
        const isAccepted = drawer.status === 'accepted';
        const isDeclined = drawer.status === 'declined';
        const isCountered = drawer.status === 'countered';
        const isPlanned = drawer.status === 'planned';
        const counterOffer = drawer.counterOffer;
        const plannedEvaluation = drawer.lastEvaluation || evaluation;
        const stagedOffer = React.useMemo(() => {
            return (state.stagedLiveOffers || []).find(o => o.id === drawer.stagedOfferId)
                || (isPlanned ? buildLiveOfferHandoff(state, targetPersona, currentProposal, plannedEvaluation) : null);
        }, [state.stagedLiveOffers, drawer.stagedOfferId, isPlanned, targetPersona, currentProposal, plannedEvaluation]);
        const [copyStatus, setCopyStatus] = React.useState('');
        const onCopyPlanned = React.useCallback(() => {
            const text = stagedOffer?.copyText || '';
            copyText(text).then(ok => {
                setCopyStatus(ok ? 'Copied' : 'Copy failed');
                setTimeout(() => setCopyStatus(''), 1400);
            });
        }, [stagedOffer]);
        const onOpenSleeper = React.useCallback(() => {
            if (state.sleeperDraftId) {
                window.open('https://sleeper.com/draft/nfl/' + state.sleeperDraftId, '_blank', 'noopener,noreferrer');
            }
        }, [state.sleeperDraftId]);

        return (
            <div style={{
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                width: 'min(420px, 90vw)',
                background: 'var(--black)',
                borderLeft: '2px solid var(--gold)',
                boxShadow: '-12px 0 40px rgba(0,0,0,0.6)',
                zIndex: 600,
                display: 'flex',
                flexDirection: 'column',
                fontFamily: FONT_UI,
                animation: 'wrFadeIn 0.25s ease',
            }}>
                {/* Header */}
                <div style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid rgba(212,175,55,0.2)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    flexShrink: 0,
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Propose Trade</div>
                        <select
                            value={String(targetId)}
                            disabled={isSending || isAccepted}
                            onChange={e => onTargetChange(e.target.value)}
                            title="Trade partner"
                            style={{
                                width: '100%',
                                marginTop: 4,
                                padding: '5px 7px',
                                background: 'rgba(255,255,255,0.04)',
                                border: '1px solid rgba(212,175,55,0.24)',
                                borderRadius: '5px',
                                color: 'var(--white)',
                                fontSize: '0.78rem',
                                fontFamily: FONT_DISPL,
                                fontWeight: 700,
                                outline: 'none',
                            }}
                        >
                            {partnerOptions.map(opt => (
                                <option key={opt.rosterId} value={String(opt.rosterId)}>
                                    {opt.name}
                                </option>
                            ))}
                        </select>
                        <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.7 }}>
                            {targetPersona.tradeDna?.label || '—'} · {targetPersona.posture?.label || '—'}
                        </div>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: 'var(--silver)',
                        fontSize: '0.9rem',
                        width: 30,
                        height: 30,
                        borderRadius: '4px',
                        cursor: 'pointer',
                    }}>×</button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px' }}>
                    {/* Status banner */}
                    {isLiveSync && (
                        <div style={{
                            padding: '9px 10px',
                            background: 'rgba(124,107,248,0.08)',
                            border: '1px solid rgba(155,138,251,0.28)',
                            borderRadius: '5px',
                            fontSize: '0.64rem',
                            color: 'rgba(214,208,255,0.94)',
                            marginBottom: '12px',
                            lineHeight: 1.35,
                        }}>
                            <strong style={{ color: 'rgba(155,138,251,1)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Live Draft Mode</strong>
                            {' '}Stages a package only. War Room does not write trades to Sleeper.
                        </div>
                    )}
                    {isSending && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(212,175,55,0.08)',
                            border: '1px solid rgba(212,175,55,0.3)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'var(--gold)',
                            textAlign: 'center',
                            marginBottom: '12px',
                        }}>
                            ⏳ {targetPersona.teamName} is thinking…
                        </div>
                    )}
                    {isAccepted && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(46,204,113,0.08)',
                            border: '1px solid rgba(46,204,113,0.3)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: '#2ECC71',
                            textAlign: 'center',
                            marginBottom: '12px',
                            fontWeight: 700,
                        }}>
                            ✓ ACCEPTED — picks swapped
                        </div>
                    )}
                    {isCountered && counterOffer && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(240,165,0,0.08)',
                            border: '1px solid rgba(240,165,0,0.32)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: '#F0A500',
                            marginBottom: '12px',
                        }}>
                            <div style={{ fontWeight: 800, marginBottom: 5 }}>COUNTER OFFER</div>
                            <div style={{ color: 'var(--silver)', opacity: 0.86, lineHeight: 1.35 }}>{counterOffer.reason || 'They will deal if the package clears their buyer line.'}</div>
                        </div>
                    )}
                    {isDeclined && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(231,76,60,0.08)',
                            border: '1px solid rgba(231,76,60,0.3)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: '#E74C3C',
                            textAlign: 'center',
                            marginBottom: '12px',
                        }}>
                            ✗ DECLINED — adjust the offer
                            {drawer.lastEvaluation?.reason && (
                                <div style={{ marginTop: 4, color: 'var(--silver)', opacity: 0.78, lineHeight: 1.3 }}>{drawer.lastEvaluation.reason}</div>
                            )}
                        </div>
                    )}
                    {isPlanned && (
                        <div style={{
                            padding: '10px',
                            background: 'rgba(124,107,248,0.08)',
                            border: '1px solid rgba(155,138,251,0.34)',
                            borderRadius: '5px',
                            fontSize: '0.72rem',
                            color: 'rgba(214,208,255,0.96)',
                            marginBottom: '12px',
                            lineHeight: 1.35,
                        }}>
                            <div style={{ color: 'rgba(155,138,251,1)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                                Live Offer Staged
                            </div>
                            <div>
                                No Sleeper write. {plannedEvaluation.likelihood}% acceptance vs {plannedEvaluation.acceptanceLine || 70}% Buyer Line.
                            </div>
                            {plannedEvaluation.reason && (
                                <div style={{ marginTop: 4, color: 'var(--silver)', opacity: 0.82 }}>{plannedEvaluation.reason}</div>
                            )}
                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                                <button onClick={onCopyPlanned} style={miniBtn('#2ECC71')}>{copyStatus || 'COPY SUMMARY'}</button>
                                {state.sleeperDraftId && <button onClick={onOpenSleeper} style={miniBtn('rgba(155,138,251,1)')}>OPEN SLEEPER</button>}
                            </div>
                        </div>
                    )}

                    <OwnerIntelCard profile={partnerProfile} />

                    <SuggestionRail
                        suggestions={packageSuggestions}
                        onLoad={loadProposal}
                        disabled={isSending || isAccepted}
                        state={state}
                    />

                    {/* Live fairness / likelihood */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr 1fr',
                        gap: '8px',
                        marginBottom: '14px',
                    }}>
                        <div style={{
                            padding: '8px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '5px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: gradeCol, fontFamily: FONT_DISPL }}>
                                {evaluation.grade?.grade || '—'}
                            </div>
                            <div style={{ fontSize: '0.54rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>
                                {evaluation.grade?.label || 'Empty'}
                            </div>
                        </div>
                        <div style={{
                            padding: '8px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '5px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: likelihoodCol, fontFamily: FONT_DISPL }}>
                                {evaluation.likelihood}%
                            </div>
                            <div style={{ fontSize: '0.54rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>
                                Acceptance
                            </div>
                        </div>
                        <div style={{
                            padding: '8px',
                            background: 'rgba(255,255,255,0.02)',
                            border: '1px solid rgba(255,255,255,0.06)',
                            borderRadius: '5px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--gold)', fontFamily: FONT_DISPL }}>
                                {evaluation.acceptanceLine || 70}%
                            </div>
                            <div style={{ fontSize: '0.54rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '2px' }}>
                                Buyer Line
                            </div>
                        </div>
                    </div>

                    {evaluation.verdict && (
                        <div style={{
                            marginBottom: 12,
                            padding: '7px 8px',
                            border: '1px solid rgba(212,175,55,0.14)',
                            background: 'rgba(212,175,55,0.045)',
                            borderRadius: 5,
                            color: 'var(--silver)',
                            fontSize: '0.64rem',
                            lineHeight: 1.35,
                        }}>
                            <strong style={{ color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {evaluation.verdict === 'accepted' ? 'Likely accept' : evaluation.verdict === 'countered' ? 'Likely counter' : 'Likely decline'}
                            </strong>
                            {' · '}{evaluation.reason || 'Owner DNA, raw DHQ, and mock trade tuning drive this read.'}
                        </div>
                    )}

                    {isCountered && counterOffer && (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                            <PickSide
                                label="Counter: you give"
                                color="#E74C3C"
                                picks={counterOffer.myGive}
                                playerIds={counterOffer.myGivePlayers}
                                faab={counterOffer.myGiveFaab}
                                dhq={counterOffer.myGiveDHQ}
                                empty="Nothing selected"
                            />
                            <PickSide
                                label="Counter: you get"
                                color="#2ECC71"
                                picks={counterOffer.theirGive}
                                playerIds={counterOffer.theirGivePlayers}
                                faab={counterOffer.theirGiveFaab}
                                dhq={counterOffer.myGainDHQ}
                                empty="Nothing selected"
                            />
                        </div>
                    )}

                    {/* Pick swap summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                        <PickSide
                            label="You give"
                            color="#E74C3C"
                            picks={drawer.myGive}
                            playerIds={drawer.myGivePlayers}
                            faab={drawer.myGiveFaab}
                            dhq={evaluation.myGiveDHQ}
                            empty="Nothing selected"
                        />
                        <PickSide
                            label="You get"
                            color="#2ECC71"
                            picks={drawer.theirGive}
                            playerIds={drawer.theirGivePlayers}
                            faab={drawer.theirGiveFaab}
                            dhq={evaluation.theirGiveDHQ}
                            empty="Nothing selected"
                        />
                    </div>

                    {/* Pick selectors */}
                    <PickList
                        title="Your picks"
                        picks={myRemainingPicks}
                        selected={myGiveIds}
                        onToggle={pick => togglePick(pick, 'my')}
                        state={state}
                        disabled={isSending || isAccepted}
                    />
                    <PickList
                        title={targetPersona.teamName + "'s picks"}
                        picks={theirRemainingPicks}
                        selected={theirGiveIds}
                        onToggle={pick => togglePick(pick, 'their')}
                        state={state}
                        disabled={isSending || isAccepted}
                    />

                    {/* Phase 7 deferred: player + FAAB lanes */}
                    <PlayerList
                        title="Your players"
                        playerIds={myPlayerIds}
                        selected={new Set(drawer.myGivePlayers || [])}
                        onToggle={pid => togglePlayer(pid, 'my')}
                        disabled={isSending || isAccepted}
                    />
                    <PlayerList
                        title={targetPersona.teamName + "'s players"}
                        playerIds={theirPlayerIds}
                        selected={new Set(drawer.theirGivePlayers || [])}
                        onToggle={pid => togglePlayer(pid, 'their')}
                        disabled={isSending || isAccepted}
                    />
                    <FaabRow
                        myFaab={drawer.myGiveFaab || 0}
                        theirFaab={drawer.theirGiveFaab || 0}
                        onChange={(val, side) => setFaab(val, side)}
                        disabled={isSending || isAccepted}
                        myLabel="Your FAAB"
                        theirLabel={targetPersona.teamName + "'s FAAB"}
                    />

                    {/* Psych taxes */}
                    {evaluation.taxes && evaluation.taxes.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                            <div style={{
                                fontSize: '0.56rem',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                marginBottom: '5px',
                            }}>Psych Taxes</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {evaluation.taxes.map((t, i) => {
                                    const isTax = (t.impact || 0) < 0;
                                    const col = isTax ? '#E74C3C' : '#2ECC71';
                                    return (
                                        <div key={i} title={t.desc || ''} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: '0.62rem',
                                            padding: '3px 6px',
                                            borderLeft: '2px solid ' + col,
                                            paddingLeft: '8px',
                                        }}>
                                            <span style={{
                                                color: 'var(--silver)',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                flex: 1,
                                                opacity: 0.85,
                                            }}>{t.name}</span>
                                            <span style={{ color: col, fontWeight: 700, marginLeft: '6px' }}>
                                                {(t.impact || 0) > 0 ? '+' : ''}{t.impact}{typeof t.impact === 'number' ? '%' : ''}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {evaluation.modifiers && evaluation.modifiers.length > 0 && (
                        <div style={{ marginTop: '12px' }}>
                            <div style={{
                                fontSize: '0.56rem',
                                fontWeight: 700,
                                color: 'var(--gold)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                marginBottom: '5px',
                            }}>Owner DNA Drivers</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                {evaluation.modifiers.slice(0, 6).map((m, i) => {
                                    const col = (m.impact || 0) >= 0 ? '#2ECC71' : '#E74C3C';
                                    return (
                                        <div key={i} title={m.detail || ''} style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            fontSize: '0.62rem',
                                            padding: '3px 6px',
                                            borderLeft: '2px solid ' + col,
                                            paddingLeft: '8px',
                                        }}>
                                            <span style={{ color: 'var(--silver)', opacity: 0.85 }}>{m.label}</span>
                                            <span style={{ color: col, fontWeight: 700, marginLeft: '6px' }}>{(m.impact || 0) > 0 ? '+' : ''}{m.impact}%</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div style={{
                    padding: '12px 16px',
                    borderTop: '1px solid rgba(212,175,55,0.2)',
                    display: 'flex',
                    gap: '8px',
                    flexShrink: 0,
                }}>
                    {isAccepted ? (
                        <button onClick={onClose} style={primaryBtn}>DONE</button>
                    ) : isCountered ? (
                        <>
                            <button onClick={onAcceptCounter} style={primaryBtn}>ACCEPT COUNTER</button>
                            <button onClick={onLoadCounter} style={secondaryBtn}>LOAD</button>
                            <button onClick={onClose} style={secondaryBtn}>CLOSE</button>
                        </>
                    ) : isPlanned ? (
                        <>
                            <button
                                onClick={() => dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'building', counterOffer: null, lastEvaluation: null } })}
                                style={primaryBtn}
                            >REWORK</button>
                            <button onClick={onClose} style={secondaryBtn}>CLOSE</button>
                        </>
                    ) : (
                        <>
                            <button
                                onClick={onSend}
                                disabled={isSending || !(mySideHasAssets && theirSideHasAssets)}
                                style={{
                                    ...primaryBtn,
                                    opacity: (isSending || !(mySideHasAssets && theirSideHasAssets)) ? 0.5 : 1,
                                    cursor: (isSending || !(mySideHasAssets && theirSideHasAssets)) ? 'not-allowed' : 'pointer',
                                }}
                            >{isSending ? 'SENDING…' : (isLiveSync ? 'STAGE LIVE OFFER' : 'SEND OFFER')}</button>
                            <button onClick={onClose} style={secondaryBtn}>CANCEL</button>
                        </>
                    )}
                </div>
            </div>
        );
    }

    function formatPick(pick) {
        return 'R' + pick.round + '.' + String(pick.slot || 0).padStart(2, '0');
    }

    function playerName(pid) {
        const p = window.S?.players?.[pid] || {};
        const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        return full || pid;
    }

    function proposalAssets(proposal, side) {
        const picks = side === 'my' ? proposal.myGive : proposal.theirGive;
        const players = side === 'my' ? proposal.myGivePlayers : proposal.theirGivePlayers;
        const faab = side === 'my' ? proposal.myGiveFaab : proposal.theirGiveFaab;
        const items = [];
        (picks || []).slice(0, 3).forEach(p => items.push(formatPick(p)));
        (players || []).slice(0, 2).forEach(pid => items.push(playerName(pid)));
        if (faab > 0) items.push('$' + faab + ' FAAB');
        if ((picks || []).length + (players || []).length > items.length) items.push('+' + (((picks || []).length + (players || []).length) - items.length));
        return items.length ? items.join(', ') : 'No assets';
    }

    function buildLiveOfferHandoff(state, targetPersona, proposal, result) {
        const giveText = proposalAssets(proposal, 'my');
        const getText = proposalAssets(proposal, 'their');
        const partnerName = targetPersona?.teamName || ('Team ' + proposal?.targetRosterId);
        const line = result?.acceptanceLine || 70;
        const likelihood = result?.likelihood || 0;
        const grade = result?.grade?.grade || 'ungraded';
        const reason = result?.reason || 'Owner DNA, raw DHQ, and current board context drive this read.';
        const copyText = [
            'Live draft trade offer to ' + partnerName,
            'I give: ' + giveText,
            'I get: ' + getText,
            'War Room read: ' + likelihood + '% acceptance vs ' + line + '% Buyer Line, grade ' + grade + '.',
            reason,
        ].join('\n');
        return {
            targetRosterId: proposal?.targetRosterId,
            partnerName,
            proposal: {
                targetRosterId: proposal?.targetRosterId,
                myGive: proposal?.myGive || [],
                theirGive: proposal?.theirGive || [],
                myGivePlayers: proposal?.myGivePlayers || [],
                theirGivePlayers: proposal?.theirGivePlayers || [],
                myGiveFaab: proposal?.myGiveFaab || 0,
                theirGiveFaab: proposal?.theirGiveFaab || 0,
            },
            giveText,
            getText,
            likelihood,
            acceptanceLine: line,
            grade,
            reason,
            copyText,
            sleeperDraftId: state?.sleeperDraftId || null,
        };
    }

    function copyText(text) {
        if (!text) return Promise.resolve(false);
        if (navigator.clipboard?.writeText) {
            return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
        }
        window.prompt('Copy live offer summary:', text);
        return Promise.resolve(true);
    }

    function miniBtn(color) {
        return {
            padding: '5px 7px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid ' + color,
            borderRadius: '4px',
            color,
            cursor: 'pointer',
            fontFamily: FONT_UI,
            fontSize: '0.56rem',
            fontWeight: 900,
            letterSpacing: '0.04em',
        };
    }

    function OwnerIntelCard({ profile }) {
        if (!profile) return null;
        const chips = [
            profile.tradeDna?.label || 'Balanced',
            profile.posture?.label || 'Neutral',
            profile.window,
            profile.liquidity?.label,
        ].filter(Boolean).slice(0, 4);
        const needs = (profile.needs || []).slice(0, 5);
        const picks = (profile.movablePicks || []).slice(0, 3).map(p => 'R' + p.round + '.' + String(p.slot || 0).padStart(2, '0'));
        const players = (profile.tradablePlayers || []).slice(0, 3).map(p => p.name);
        return (
            <div style={{
                marginBottom: 12,
                padding: '10px',
                border: '1px solid rgba(212,175,55,0.16)',
                background: 'rgba(255,255,255,0.025)',
                borderRadius: '6px',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                    <div style={{ fontSize: '0.56rem', color: 'var(--gold)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Owner Trade Intel
                    </div>
                    <div style={{ color: 'var(--gold)', fontFamily: FONT_DISPL, fontWeight: 800, fontSize: '0.78rem' }}>
                        {profile.buyerLine}% line
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 7 }}>
                    {chips.map(chip => (
                        <span key={chip} style={{
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(212,175,55,0.08)',
                            border: '1px solid rgba(212,175,55,0.18)',
                            color: 'var(--silver)',
                            fontSize: '0.56rem',
                            fontWeight: 700,
                        }}>{chip}</span>
                    ))}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: '0.6rem', color: 'var(--silver)', lineHeight: 1.35 }}>
                    <div>
                        <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.58rem', marginBottom: 2 }}>Needs</strong>
                        {needs.length ? needs.join(', ') : 'No clear needs'}
                    </div>
                    <div>
                        <strong style={{ display: 'block', color: 'var(--white)', fontSize: '0.58rem', marginBottom: 2 }}>Tradable</strong>
                        {[...picks, ...players].slice(0, 4).join(', ') || 'No obvious assets'}
                    </div>
                </div>
                {profile.ownerIntelSummary && (
                    <div style={{ marginTop: 7, fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.78, lineHeight: 1.35 }}>
                        {profile.ownerIntelSummary}
                    </div>
                )}
            </div>
        );
    }

    function SuggestionRail({ suggestions, onLoad, disabled }) {
        if (!suggestions || suggestions.length === 0) return null;
        return (
            <div style={{ marginBottom: 14 }}>
                <div style={{
                    fontSize: '0.56rem',
                    fontWeight: 800,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: 6,
                }}>Quick Packages</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {suggestions.map(s => {
                        const clears = s.likelihood >= s.acceptanceLine;
                        const near = !clears && s.verdict === 'countered';
                        const color = clears ? '#2ECC71' : near ? '#F0A500' : '#E74C3C';
                        return (
                            <button
                                key={s.id}
                                disabled={disabled}
                                onClick={() => onLoad(s.proposal)}
                                title={s.rationale}
                                style={{
                                    textAlign: 'left',
                                    padding: '8px',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderLeft: '3px solid ' + color,
                                    borderRadius: '5px',
                                    color: 'var(--silver)',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    fontFamily: FONT_UI,
                                    opacity: disabled ? 0.5 : 1,
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                                    <strong style={{ color: 'var(--white)', fontSize: '0.68rem' }}>{s.label}</strong>
                                    <span style={{ color, fontFamily: FONT_MONO, fontSize: '0.62rem', fontWeight: 800 }}>
                                        {s.likelihood}% / {s.acceptanceLine}%
                                    </span>
                                </div>
                                <div style={{ fontSize: '0.58rem', color: 'var(--gold)', fontWeight: 700, marginBottom: 3 }}>
                                    {s.intent}
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: '0.56rem', lineHeight: 1.3 }}>
                                    <span><strong style={{ color: '#E74C3C' }}>Give:</strong> {proposalAssets(s.proposal, 'my')}</span>
                                    <span><strong style={{ color: '#2ECC71' }}>Get:</strong> {proposalAssets(s.proposal, 'their')}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    function PickSide({ label, color, picks, playerIds, faab, dhq, empty }) {
        const hasAny = (picks && picks.length > 0) || (playerIds && playerIds.length > 0) || (faab && faab > 0);
        const pdata = window.S?.players || {};
        const playerName = (pid) => {
            const p = pdata[pid];
            const n = p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim();
            return n || pid;
        };
        return (
            <div style={{
                padding: '10px',
                background: color + '08',
                border: '1px solid ' + color + '25',
                borderRadius: '6px',
                minHeight: 66,
            }}>
                <div style={{ fontSize: '0.52rem', color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>{label}</div>
                {hasAny ? (
                    <>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '4px' }}>
                            {(picks || []).map((p, i) => (
                                <span key={'p'+i} style={{
                                    fontSize: '0.58rem',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    background: 'rgba(255,255,255,0.06)',
                                    color: 'var(--white)',
                                }}>R{p.round}.{String(p.slot || 0).padStart(2, '0')}</span>
                            ))}
                            {(playerIds || []).map((pid) => (
                                <span key={'pl'+pid} title={playerName(pid)} style={{
                                    fontSize: '0.58rem',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    background: 'rgba(124,107,248,0.18)',
                                    color: '#9b8afb',
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>{playerName(pid)}</span>
                            ))}
                            {faab > 0 && (
                                <span style={{
                                    fontSize: '0.58rem',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '3px',
                                    background: 'rgba(46,204,113,0.18)',
                                    color: '#2ECC71',
                                }}>${faab} FAAB</span>
                            )}
                        </div>
                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', fontFamily: FONT_MONO, opacity: 0.7 }}>
                            ≈ {(dhq || 0).toLocaleString()} DHQ
                        </div>
                    </>
                ) : (
                    <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.5, fontStyle: 'italic' }}>{empty}</div>
                )}
            </div>
        );
    }

    function PlayerList({ title, playerIds, selected, onToggle, disabled }) {
        const simulator = window.DraftCC.tradeSimulator;
        const pdata = window.S?.players || {};
        if (!playerIds || playerIds.length === 0) return null;
        const playerName = (pid) => {
            const p = pdata[pid];
            const n = p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim();
            return n || pid;
        };
        // Sort by DHQ value desc, cap to 40 to keep the drawer light
        const sorted = [...playerIds]
            .map(pid => ({ pid, val: simulator ? simulator.playerValueFor(pid) : 0 }))
            .sort((a, b) => b.val - a.val)
            .slice(0, 40);
        return (
            <div style={{ marginBottom: '10px' }}>
                <div style={{
                    fontSize: '0.54rem',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '4px',
                }}>{title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                    {sorted.map(({ pid, val }) => {
                        const isSel = selected.has(pid);
                        const p = pdata[pid] || {};
                        const pos = p.position || p.fantasy_positions?.[0] || '';
                        return (
                            <button
                                key={pid}
                                disabled={disabled}
                                onClick={() => onToggle(pid)}
                                title={playerName(pid) + ' · ' + pos + ' · ~' + val.toLocaleString() + ' DHQ'}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: '0.6rem',
                                    fontWeight: 700,
                                    background: isSel ? 'rgba(124,107,248,0.25)' : 'rgba(255,255,255,0.03)',
                                    border: '1px solid ' + (isSel ? 'rgba(155,138,251,0.55)' : 'rgba(255,255,255,0.08)'),
                                    borderRadius: '4px',
                                    color: isSel ? '#9b8afb' : 'var(--silver)',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    fontFamily: FONT_UI,
                                    opacity: disabled ? 0.5 : 1,
                                    maxWidth: '100%',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                {playerName(pid)}{pos ? ' · ' + pos : ''}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    function FaabRow({ myFaab, theirFaab, onChange, disabled, myLabel, theirLabel }) {
        const inputStyle = {
            width: '60px',
            padding: '4px 6px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '4px',
            color: 'var(--white)',
            fontFamily: FONT_MONO,
            fontSize: '0.72rem',
            textAlign: 'right',
        };
        return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.56rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    <span style={{ flex: 1 }}>{myLabel}</span>
                    <span style={{ color: 'var(--silver)' }}>$</span>
                    <input type="number" min="0" max="1000" value={myFaab} onChange={e => onChange(e.target.value, 'my')} disabled={disabled} style={inputStyle} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.56rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                    <span style={{ flex: 1 }}>{theirLabel}</span>
                    <span style={{ color: 'var(--silver)' }}>$</span>
                    <input type="number" min="0" max="1000" value={theirFaab} onChange={e => onChange(e.target.value, 'their')} disabled={disabled} style={inputStyle} />
                </label>
            </div>
        );
    }

    function PickList({ title, picks, selected, onToggle, state, disabled }) {
        const simulator = window.DraftCC.tradeSimulator;
        return (
            <div style={{ marginBottom: '10px' }}>
                <div style={{
                    fontSize: '0.54rem',
                    fontWeight: 700,
                    color: 'var(--gold)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    marginBottom: '4px',
                }}>{title}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {picks.slice(0, 12).map((p, i) => {
                        const key = p.round + '-' + p.teamIdx;
                        const isSel = selected.has(key);
                        const val = simulator ? simulator.pickValueFor(state, p) : 0;
                        return (
                            <button
                                key={i}
                                disabled={disabled}
                                onClick={() => onToggle(p)}
                                title={'Round ' + p.round + ' pick · ~' + val.toLocaleString() + ' DHQ'}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: '0.62rem',
                                    fontWeight: 700,
                                    background: isSel ? 'rgba(212,175,55,0.2)' : 'rgba(255,255,255,0.03)',
                                    border: '1px solid ' + (isSel ? 'rgba(212,175,55,0.5)' : 'rgba(255,255,255,0.08)'),
                                    borderRadius: '4px',
                                    color: isSel ? 'var(--gold)' : 'var(--silver)',
                                    cursor: disabled ? 'not-allowed' : 'pointer',
                                    fontFamily: FONT_UI,
                                    opacity: disabled ? 0.5 : 1,
                                }}
                            >
                                R{p.round}.{String(p.slot || 0).padStart(2, '0')}
                            </button>
                        );
                    })}
                    {picks.length === 0 && (
                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.4, fontStyle: 'italic' }}>
                            no remaining picks
                        </div>
                    )}
                </div>
            </div>
        );
    }

    const primaryBtn = {
        flex: 1,
        padding: '10px',
        background: 'var(--gold)',
        color: 'var(--black)',
        border: 'none',
        borderRadius: '5px',
        fontSize: '0.78rem',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: FONT_UI,
        letterSpacing: '0.04em',
    };

    const secondaryBtn = {
        padding: '10px 16px',
        background: 'transparent',
        color: 'var(--silver)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '5px',
        fontSize: '0.78rem',
        fontWeight: 700,
        cursor: 'pointer',
        fontFamily: FONT_UI,
    };

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.TradeProposer = TradeProposer;
})();

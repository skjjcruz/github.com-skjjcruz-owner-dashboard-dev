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

        // Remaining picks (not yet made)
        const remaining = state.pickOrder.slice(state.currentIdx);
        const myRemainingPicks = remaining.filter(p => p.rosterId === state.userRosterId);
        const theirRemainingPicks = remaining.filter(p => p.rosterId === targetId);

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

        // Live evaluation (computed on every render)
        const simulator = window.DraftCC.tradeSimulator;
        const evaluation = React.useMemo(() => {
            if (!simulator) return { likelihood: 0, grade: null, taxes: [], myGiveDHQ: 0, theirGiveDHQ: 0 };
            // Peek-only evaluation — no randomness wobble, deterministic display
            const helpers = window.DraftCC.tradeHelpers;
            const myGiveDHQ = simulator.sumPickValue(state, drawer.myGive)
                + simulator.sumPlayerValue(drawer.myGivePlayers)
                + simulator.faabToDhq(drawer.myGiveFaab);
            const theirGiveDHQ = simulator.sumPickValue(state, drawer.theirGive)
                + simulator.sumPlayerValue(drawer.theirGivePlayers)
                + simulator.faabToDhq(drawer.theirGiveFaab);
            const taxes = helpers.calcPsychTaxes(
                myPersona?.assessment,
                targetPersona.assessment,
                targetPersona.tradeDna?.key,
                targetPersona.posture
            );
            const baseLikelihood = helpers.calcAcceptanceLikelihood(
                myGiveDHQ,
                theirGiveDHQ,
                targetPersona.tradeDna?.key,
                taxes,
                targetPersona.assessment,
                myPersona?.assessment
            );
            // Phase 1 deferred: nudge acceptance likelihood by GM mode tradeWeights.
            // WIN_NOW discounts future-year picks (vetPenalty > 1 means sending vets is easier);
            // REBUILD inflates future picks (futureYearBias > 1 means they're more reluctant to send picks).
            // We apply a small multiplicative delta so mode influences feel without overwhelming DNA signals.
            let likelihood = baseLikelihood;
            try {
                const leagueId = state?.leagueId || window.S?.leagues?.[0]?.league_id;
                const gm = window.WR?.GmMode?.describe?.(window.WR.GmMode.getMode(leagueId));
                if (gm?.tradeWeights) {
                    const fyb = gm.tradeWeights.futureYearBias ?? 1;
                    const vp = gm.tradeWeights.vetPenalty ?? 1;
                    // Bonus if our give aligns with a sell-forward mode (rebuild wanting picks, win-now wanting vets)
                    const diffPct = theirGiveDHQ > 0 ? (myGiveDHQ - theirGiveDHQ) / theirGiveDHQ : 0;
                    const modeDelta = Math.round(((fyb - 1) * 3) + ((vp - 1) * 3) + diffPct * 2);
                    likelihood = Math.max(3, Math.min(95, baseLikelihood + modeDelta));
                }
            } catch (_) { /* silent — fall back to base likelihood */ }
            const grade = helpers.fairnessGrade(myGiveDHQ, theirGiveDHQ);
            return { likelihood, grade, taxes, myGiveDHQ, theirGiveDHQ };
        }, [drawer.myGive, drawer.theirGive, drawer.myGivePlayers, drawer.theirGivePlayers, drawer.myGiveFaab, drawer.theirGiveFaab, state.pickOrder, state.currentIdx, targetPersona, myPersona]);

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
            dispatch({ type: 'UPDATE_PROPOSER', payload: { status: 'sending' } });
            // CPU "thinks" for 1.5s, then evaluates with randomness
            setTimeout(() => {
                const result = simulator.evaluateUserProposal(state, {
                    targetRosterId: targetId,
                    myGive: drawer.myGive,
                    theirGive: drawer.theirGive,
                    myGivePlayers: drawer.myGivePlayers || [],
                    theirGivePlayers: drawer.theirGivePlayers || [],
                    myGiveFaab: drawer.myGiveFaab || 0,
                    theirGiveFaab: drawer.theirGiveFaab || 0,
                });
                if (result.accepted) {
                    const offer = {
                        fromRosterId: targetId,
                        fromName: targetPersona.teamName,
                        toRosterId: state.userRosterId,
                        theirGive: drawer.theirGive,
                        myGive: drawer.myGive,
                        theirGivePlayers: drawer.theirGivePlayers || [],
                        myGivePlayers: drawer.myGivePlayers || [],
                        theirGiveFaab: drawer.theirGiveFaab || 0,
                        myGiveFaab: drawer.myGiveFaab || 0,
                        myGainDHQ: result.theirGiveDHQ,
                        myGiveDHQ: result.myGiveDHQ,
                        theirGainDHQ: result.myGiveDHQ,
                        theirGiveDHQ: result.theirGiveDHQ,
                        likelihood: result.likelihood,
                        grade: result.grade,
                        taxes: result.taxes,
                        reason: 'Accepted user proposal',
                        dnaLabel: targetPersona.draftDna?.label || 'Balanced',
                    };
                    dispatch({ type: 'COMPLETE_PROPOSAL', accepted: true, offer });
                } else {
                    dispatch({ type: 'COMPLETE_PROPOSAL', accepted: false });
                }
            }, 1500);
        };

        const gradeCol = evaluation.grade?.col || 'var(--gold)';
        const likelihoodCol = evaluation.likelihood >= 60 ? '#2ECC71'
            : evaluation.likelihood >= 40 ? '#F0A500'
            : '#E74C3C';

        const isSending = drawer.status === 'sending';
        const isAccepted = drawer.status === 'accepted';
        const isDeclined = drawer.status === 'declined';

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
                        <div style={{
                            fontSize: '1rem',
                            fontWeight: 700,
                            color: 'var(--white)',
                            fontFamily: FONT_DISPL,
                            letterSpacing: '0.02em',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                        }}>{targetPersona.teamName}</div>
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
                        </div>
                    )}

                    {/* Live fairness / likelihood */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
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
                    </div>

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
                            >{isSending ? 'SENDING…' : 'SEND OFFER'}</button>
                            <button onClick={onClose} style={secondaryBtn}>CANCEL</button>
                        </>
                    )}
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

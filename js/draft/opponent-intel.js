// ══════════════════════════════════════════════════════════════════
// js/draft/opponent-intel.js — Opponent Intel panel (right panel)
//
// Phase 2: full persona card. Shows identity + DNA labels + stat rows
// + "will reach for" / "will pass on" predictions + psych taxes (vs.
// the user) + grudge display + "Scout roster" button.
//
// Depends on: styles.js, persona.js, cpu-engine.js (computePredictions),
//             window.App.TradeEngine (calcPsychTaxes, calcGrudgeTax)
// Exposes:    window.DraftCC.OpponentIntelPanel
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, panelCard } = window.DraftCC.styles;

    function OpponentIntelPanel({ state, dispatch, currentSlot, onPropose }) {
        const pinnedId = state.pinnedRosterId;
        const targetId = pinnedId || currentSlot?.rosterId || null;
        const persona = targetId ? state.personas?.[targetId] : null;
        const isPinned = !!pinnedId;
        const userRosterId = state.userRosterId;
        const isMe = targetId === userRosterId;

        const onUnpin = () => dispatch({ type: 'PIN_TEAM', rosterId: null });

        // My persona (for psych-tax computation)
        const myPersona = state.personas?.[userRosterId];

        // Compute psych taxes (live) when viewing an opponent
        const psychTaxes = React.useMemo(() => {
            if (!persona || !myPersona || isMe) return null;
            try {
                const calcPsychTaxes = window.DraftCC?.tradeHelpers?.calcPsychTaxes
                    || window.App?.TradeEngine?.calcPsychTaxes;
                if (!calcPsychTaxes) return null;
                return calcPsychTaxes(
                    myPersona.assessment,
                    persona.assessment,
                    persona.tradeDna?.key,
                    persona.posture
                );
            } catch (e) {
                if (window.wrLog) window.wrLog('oppIntel.psychTax', e);
                return null;
            }
        }, [persona, myPersona, isMe]);

        // Compute grudge (live)
        const grudgeScore = React.useMemo(() => {
            if (!persona || !myPersona || isMe) return 0;
            try {
                const calcGrudgeTax = window.DraftCC?.tradeHelpers?.calcGrudgeTax
                    || window.App?.TradeEngine?.calcGrudgeTax;
                if (!calcGrudgeTax) return 0;
                const grudges = window._tcGrudges || [];
                return calcGrudgeTax(userRosterId, targetId, grudges) || 0;
            } catch (e) { return 0; }
        }, [persona, myPersona, isMe, targetId, userRosterId]);

        const onScoutRoster = () => {
            if (!persona || !persona.rosterId) return;
            // Best-effort: find a few of their rostered players and open the modal on the first one
            const rosters = window.S?.rosters || [];
            const r = rosters.find(x => x.roster_id === persona.rosterId);
            const pid = r?.players?.[0] || r?.starters?.[0];
            if (pid && typeof window.openPlayerModal === 'function') {
                try { window.openPlayerModal(pid); } catch (e) {}
            }
        };

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '10px 12px',
            overflow: 'hidden',
        });

        return (
            <div style={containerCss}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.86rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Opponent Intel
                    </div>
                    {isPinned && (
                        <button onClick={onUnpin} style={{
                            padding: '2px 6px',
                            fontSize: '0.56rem',
                            border: '1px solid rgba(255,255,255,0.1)',
                            background: 'transparent',
                            color: 'var(--silver)',
                            borderRadius: '3px',
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                        }}>Unpin</button>
                    )}
                </div>

                {/* Empty state */}
                {!persona && (
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'column',
                        gap: '6px',
                        color: 'var(--silver)',
                        opacity: 0.4,
                        fontSize: '0.72rem',
                        textAlign: 'center',
                        padding: '20px',
                        fontFamily: FONT_UI,
                    }}>
                        <div style={{ fontSize: '2rem', opacity: 0.3 }}>◯</div>
                        <div>Click any team in the grid<br />to see their persona</div>
                    </div>
                )}

                {/* Persona card */}
                {persona && (
                    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: '3px' }}>
                        {/* Identity header */}
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            paddingBottom: '8px',
                            marginBottom: '8px',
                            borderBottom: '1px solid rgba(212,175,55,0.15)',
                        }}>
                            {persona.avatar ? (
                                <img
                                    src={persona.avatar}
                                    style={{ width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(212,175,55,0.3)' }}
                                    onError={e => e.target.style.display = 'none'}
                                    alt=""
                                />
                            ) : (
                                <div style={{
                                    width: 40, height: 40, borderRadius: '50%',
                                    background: 'var(--charcoal)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.9rem', color: 'var(--gold)', fontWeight: 700,
                                    border: '2px solid rgba(212,175,55,0.3)',
                                    fontFamily: FONT_DISPL,
                                }}>{(persona.teamName || '?').charAt(0)}</div>
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{
                                    fontSize: '0.86rem',
                                    fontWeight: 700,
                                    color: 'var(--white)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    fontFamily: FONT_DISPL,
                                    letterSpacing: '0.02em',
                                }}>{isPinned && '📌 '}{persona.teamName}</div>
                                {persona.ownerName && (
                                    <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.6, fontFamily: FONT_UI }}>
                                        {persona.ownerName}{isMe ? ' · YOU' : ''}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Stat rows */}
                        <StatRow label="DRAFT DNA" value={persona.draftDna?.label || 'Balanced'} color="var(--gold)" />
                        <StatRow label="TRADE DNA" value={persona.tradeDna?.label || '—'} color={persona.tradeDna?.color || 'var(--silver)'} />
                        <StatRow label="POSTURE" value={persona.posture?.label || 'Neutral'} color={persona.posture?.color || 'var(--silver)'} />
                        <StatRow label="TIER" value={persona.assessment?.tier || '—'} color="var(--silver)" />
                        <StatRow label="HEALTH" value={(persona.assessment?.healthScore || 0) + ' / 100'} color={healthColor(persona.assessment?.healthScore || 0)} />

                        {/* Needs */}
                        {persona.assessment?.needs?.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <SectionLabel>Needs</SectionLabel>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
                                    {persona.assessment.needs.slice(0, 4).map((n, i) => {
                                        const pos = typeof n === 'string' ? n : n?.pos;
                                        const urgency = typeof n === 'object' ? n?.urgency : null;
                                        const col = urgency === 'deficit' ? '#E74C3C' : '#D4AF37';
                                        return (
                                            <span key={i} style={{
                                                fontSize: '0.56rem',
                                                fontWeight: 700,
                                                padding: '2px 6px',
                                                borderRadius: '10px',
                                                background: col + '18',
                                                border: '1px solid ' + col + '44',
                                                color: col,
                                                fontFamily: FONT_UI,
                                            }}>{pos}{urgency === 'deficit' ? '!' : ''}</span>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Predictions — Phase 2 */}
                        {(persona.predictions?.willReach?.length > 0 || persona.predictions?.willPassOn?.length > 0 || persona.predictions?.likelyPick) && (
                            <div style={{
                                marginTop: '10px',
                                padding: '8px 10px',
                                background: 'rgba(212,175,55,0.05)',
                                border: '1px solid rgba(212,175,55,0.2)',
                                borderRadius: '5px',
                            }}>
                                <SectionLabel>Prediction Engine</SectionLabel>
                                {persona.predictions.likelyPick && (
                                    <div style={{ fontSize: '0.62rem', marginBottom: '5px', color: 'var(--white)', fontFamily: FONT_UI }}>
                                        <span style={{ color: 'var(--silver)', opacity: 0.6 }}>Likely target: </span>
                                        <span style={{ fontWeight: 700 }}>{persona.predictions.likelyPick.name}</span>
                                        <span style={{ color: 'var(--gold)', marginLeft: '4px', fontSize: '0.54rem' }}>
                                            ({persona.predictions.likelyPick.pos})
                                        </span>
                                    </div>
                                )}
                                {persona.predictions.willReach?.length > 0 && (
                                    <div style={{ fontSize: '0.58rem', color: 'var(--silver)', marginBottom: '3px', fontFamily: FONT_UI }}>
                                        <span style={{ color: '#2ECC71', fontWeight: 700 }}>↑ Will reach: </span>
                                        {persona.predictions.willReach.map(r => r.pos + ' (+' + Math.round(r.delta * 100) + '%)').join(', ')}
                                    </div>
                                )}
                                {persona.predictions.willPassOn?.length > 0 && (
                                    <div style={{ fontSize: '0.58rem', color: 'var(--silver)', fontFamily: FONT_UI }}>
                                        <span style={{ color: '#E74C3C', fontWeight: 700 }}>↓ Will pass: </span>
                                        {persona.predictions.willPassOn.map(r => r.pos + ' (' + Math.round(r.delta * 100) + '%)').join(', ')}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Psych taxes (vs. user) */}
                        {psychTaxes && psychTaxes.length > 0 && !isMe && (
                            <div style={{ marginTop: '10px' }}>
                                <SectionLabel>Psych Taxes (vs. you)</SectionLabel>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                    {psychTaxes.slice(0, 5).map((t, i) => {
                                        const isTax = (t.impact || 0) < 0;
                                        const col = isTax ? '#E74C3C' : '#2ECC71';
                                        return (
                                            <div key={i} title={t.desc || ''} style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                fontSize: '0.58rem',
                                                padding: '2px 4px',
                                                borderLeft: '2px solid ' + col,
                                                paddingLeft: '6px',
                                                fontFamily: FONT_UI,
                                            }}>
                                                <span style={{
                                                    color: 'var(--silver)',
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    flex: 1,
                                                    opacity: 0.85,
                                                }}>{t.name}</span>
                                                <span style={{ color: col, fontWeight: 700, marginLeft: '4px' }}>
                                                    {(t.impact || 0) > 0 ? '+' : ''}{t.impact}{typeof t.impact === 'number' ? '%' : ''}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Grudge display */}
                        {!isMe && grudgeScore !== 0 && (
                            <div style={{
                                marginTop: '8px',
                                padding: '6px 8px',
                                background: grudgeScore > 0 ? 'rgba(46,204,113,0.08)' : 'rgba(231,76,60,0.08)',
                                border: '1px solid ' + (grudgeScore > 0 ? 'rgba(46,204,113,0.25)' : 'rgba(231,76,60,0.25)'),
                                borderRadius: '4px',
                                fontSize: '0.58rem',
                                color: grudgeScore > 0 ? '#2ECC71' : '#E74C3C',
                                fontFamily: FONT_UI,
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}>
                                <span style={{ fontWeight: 700 }}>{grudgeScore > 0 ? '🤝' : '⚔'}</span>
                                <span>Grudge: {grudgeScore > 0 ? '+' : ''}{grudgeScore} (trade history)</span>
                            </div>
                        )}

                        {/* Draft DNA details */}
                        {persona.draftDna?.picksAnalyzed > 0 && (
                            <div style={{ marginTop: '8px', padding: '6px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.04)' }}>
                                <SectionLabel>Draft History</SectionLabel>
                                <div style={{ fontSize: '0.58rem', color: 'var(--silver)', lineHeight: 1.5, fontFamily: FONT_UI }}>
                                    {persona.draftDna.tendency || persona.draftDna.roundProfile || ''}
                                </div>
                                <div style={{ fontSize: '0.52rem', color: 'var(--silver)', opacity: 0.5, marginTop: '2px' }}>
                                    {persona.draftDna.picksAnalyzed} picks · {persona.draftDna.seasons}
                                </div>
                            </div>
                        )}

                        {/* Inferred DNA warning */}
                        {persona.draftDna?.inferred && (
                            <div style={{
                                marginTop: '8px',
                                padding: '5px 7px',
                                background: 'rgba(240,165,0,0.08)',
                                border: '1px solid rgba(240,165,0,0.25)',
                                borderRadius: '4px',
                                fontSize: '0.54rem',
                                color: '#F0A500',
                                fontFamily: FONT_UI,
                                lineHeight: 1.4,
                            }}>
                                ⚠ Inferred DNA — limited draft history. Predictions are educated guesses.
                            </div>
                        )}

                        {/* Action buttons */}
                        {!isMe && (
                            <div style={{ display: 'flex', gap: '4px', marginTop: '10px' }}>
                                <button onClick={onScoutRoster} style={{
                                    flex: 1,
                                    padding: '6px',
                                    fontSize: '0.58rem',
                                    fontFamily: FONT_UI,
                                    fontWeight: 600,
                                    background: 'rgba(52,152,219,0.12)',
                                    color: '#3498DB',
                                    border: '1px solid rgba(52,152,219,0.3)',
                                    borderRadius: '4px',
                                    cursor: 'pointer',
                                }}>SCOUT ROSTER</button>
                                <button
                                    onClick={() => onPropose && onPropose(persona.rosterId)}
                                    disabled={!onPropose}
                                    style={{
                                        flex: 1,
                                        padding: '6px',
                                        fontSize: '0.58rem',
                                        fontFamily: FONT_UI,
                                        fontWeight: 600,
                                        background: 'rgba(212,175,55,0.12)',
                                        color: 'var(--gold)',
                                        border: '1px solid rgba(212,175,55,0.35)',
                                        borderRadius: '4px',
                                        cursor: onPropose ? 'pointer' : 'not-allowed',
                                    }}>PROPOSE TRADE</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }

    function SectionLabel({ children }) {
        return (
            <div style={{
                fontSize: '0.54rem',
                fontWeight: 700,
                color: 'var(--gold)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '3px',
                fontFamily: FONT_UI,
            }}>{children}</div>
        );
    }

    function StatRow({ label, value, color }) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '2px 0',
                fontSize: '0.66rem',
                fontFamily: FONT_UI,
            }}>
                <span style={{
                    fontSize: '0.54rem',
                    fontWeight: 700,
                    color: 'var(--silver)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    opacity: 0.7,
                }}>{label}</span>
                <span style={{ fontWeight: 700, color }}>{value}</span>
            </div>
        );
    }

    function healthColor(h) {
        if (h >= 70) return '#2ECC71';
        if (h >= 40) return '#F0A500';
        return '#E74C3C';
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.OpponentIntelPanel = OpponentIntelPanel;
})();

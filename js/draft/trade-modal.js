// ══════════════════════════════════════════════════════════════════
// js/draft/trade-modal.js — CPU-→-user trade offer modal
//
// Renders when state.activeOffer is non-null. Shows the reciprocal
// pick swap with DHQ values, fairness grade, and the "acceptance
// likelihood from the CPU's perspective". Accept / Decline buttons
// dispatch ACCEPT_TRADE or DECLINE_TRADE.
//
// Depends on: styles.js, state.js
// Exposes:    window.DraftCC.TradeModal
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, FONT_MONO } = window.DraftCC.styles;

    function TradeModal({ state, dispatch }) {
        const offer = state.activeOffer;
        if (!offer) return null;

        const onAccept = () => {
            dispatch({ type: 'ACCEPT_TRADE', offer });
        };
        const onDecline = () => {
            dispatch({ type: 'DECLINE_TRADE' });
        };

        const gradeCol = offer.grade?.col || 'var(--gold)';
        const myPick = offer.myGive?.[0];
        const theirPick = offer.theirGive?.[0];

        return (
            <div style={{
                position: 'fixed',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'calc(100% - 32px)',
                maxWidth: 440,
                zIndex: 500,
                fontFamily: FONT_UI,
                animation: 'wrFadeIn 0.25s ease',
            }}>
                <div style={{
                    background: 'var(--black)',
                    border: '2px solid var(--gold)',
                    borderRadius: '10px',
                    padding: '14px 16px',
                    boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                        <span style={{
                            fontSize: '0.68rem',
                            fontWeight: 800,
                            color: 'var(--gold)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.1em',
                        }}>⚡ Trade Offer</span>
                        <span style={{
                            fontSize: '0.58rem',
                            padding: '1px 6px',
                            borderRadius: '10px',
                            background: 'rgba(255,255,255,0.04)',
                            color: 'var(--silver)',
                        }}>{offer.dnaLabel}</span>
                        <button onClick={onDecline} style={{
                            marginLeft: 'auto',
                            background: 'none',
                            border: 'none',
                            color: 'var(--silver)',
                            fontSize: '1rem',
                            cursor: 'pointer',
                            padding: 0,
                        }}>×</button>
                    </div>

                    {/* Title + reason */}
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--white)', marginBottom: '2px', fontFamily: FONT_DISPL, letterSpacing: '0.02em' }}>
                        {offer.fromName} wants to deal
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.75, marginBottom: '8px' }}>
                        {offer.reason}
                    </div>

                    {/* Metadata strip */}
                    <div style={{ fontSize: '0.64rem', color: 'var(--silver)', marginBottom: '10px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ color: gradeCol, fontWeight: 700 }}>{offer.grade?.grade || '—'} · {offer.grade?.label || ''}</span>
                        <span>·</span>
                        <span>Likelihood: <strong style={{ color: 'var(--gold)' }}>{offer.likelihood}%</strong></span>
                    </div>

                    {/* Pick swap */}
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: '1fr auto 1fr',
                        gap: '8px',
                        alignItems: 'center',
                        marginBottom: '14px',
                    }}>
                        <div style={{
                            background: 'rgba(231,76,60,0.08)',
                            border: '1px solid rgba(231,76,60,0.25)',
                            borderRadius: '6px',
                            padding: '10px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '0.56rem', color: '#E74C3C', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>You give</div>
                            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--white)', fontFamily: FONT_DISPL, letterSpacing: '0.02em' }}>
                                R{myPick?.round}.{String(myPick?.slot || 0).padStart(2, '0')}
                            </div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--silver)', marginTop: '2px', fontFamily: FONT_MONO }}>
                                {offer.myGiveDHQ?.toLocaleString()} DHQ
                            </div>
                        </div>
                        <span style={{ fontSize: '1.2rem', color: 'var(--gold)' }}>⇄</span>
                        <div style={{
                            background: 'rgba(46,204,113,0.08)',
                            border: '1px solid rgba(46,204,113,0.25)',
                            borderRadius: '6px',
                            padding: '10px',
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: '0.56rem', color: '#2ECC71', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '2px' }}>You get</div>
                            <div style={{ fontSize: '0.86rem', fontWeight: 700, color: 'var(--white)', fontFamily: FONT_DISPL, letterSpacing: '0.02em' }}>
                                R{theirPick?.round}.{String(theirPick?.slot || 0).padStart(2, '0')}
                            </div>
                            <div style={{ fontSize: '0.6rem', color: 'var(--silver)', marginTop: '2px', fontFamily: FONT_MONO }}>
                                {offer.myGainDHQ?.toLocaleString()} DHQ
                            </div>
                        </div>
                    </div>

                    {/* Psych taxes (compact) */}
                    {offer.taxes && offer.taxes.length > 0 && (
                        <div style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '3px',
                            marginBottom: '12px',
                        }}>
                            {offer.taxes.slice(0, 4).map((t, i) => {
                                const isTax = (t.impact || 0) < 0;
                                const col = isTax ? '#E74C3C' : '#2ECC71';
                                return (
                                    <span key={i} title={t.desc || ''} style={{
                                        fontSize: '0.54rem',
                                        padding: '2px 6px',
                                        borderRadius: '10px',
                                        background: col + '15',
                                        border: '1px solid ' + col + '40',
                                        color: col,
                                        fontWeight: 600,
                                    }}>
                                        {t.name} {(t.impact || 0) > 0 ? '+' : ''}{t.impact}{typeof t.impact === 'number' ? '%' : ''}
                                    </span>
                                );
                            })}
                        </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                        <button onClick={onAccept} style={{
                            padding: '10px',
                            background: '#2ECC71',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '6px',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                        }}>Accept</button>
                        <button onClick={onDecline} style={{
                            padding: '10px',
                            background: 'transparent',
                            color: 'var(--silver)',
                            border: '1px solid rgba(255,255,255,0.15)',
                            borderRadius: '6px',
                            fontSize: '0.82rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            fontFamily: FONT_UI,
                        }}>Decline</button>
                    </div>
                </div>
            </div>
        );
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.TradeModal = TradeModal;
})();

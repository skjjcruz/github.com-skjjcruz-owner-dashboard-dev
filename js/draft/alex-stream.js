// ══════════════════════════════════════════════════════════════════
// js/draft/alex-stream.js — Alex Commentary panel (Phase 4 cinematic)
//
// Commentary feed + "Ask Alex" input + Sonnet budget tracker + per-pick
// "Explain" modal. AI events are pushed by command-center via ALEX_EVENT_ADD
// and ALEX_SPEND_SONNET reducer actions. This component is mostly a view
// over state.alex.stream.
//
// Depends on: styles.js, state.js, window.dhqAI (for Ask Alex input)
// Exposes:    window.DraftCC.AlexStreamPanel
// ══════════════════════════════════════════════════════════════════

(function() {
    const { FONT_UI, FONT_DISPL, panelCard } = window.DraftCC.styles;

    const CHIP_PROMPTS = [
        { label: 'Who should I target?',  text: 'Who should I target with my next pick given the current board?' },
        { label: 'Is this a reach?',       text: 'Was my last pick a reach? Explain.' },
        { label: 'What do they want?',     text: 'Based on the pinned team\'s DNA and needs, what position are they targeting?' },
        { label: 'Build strategy',         text: 'Given my picks so far, what positions should I prioritize for the remainder?' },
    ];

    function AlexStreamPanel({ state, dispatch }) {
        const [inputValue, setInputValue] = React.useState('');
        const [pendingAsk, setPendingAsk] = React.useState(false);
        const [expandedIds, setExpandedIds] = React.useState(() => new Set());
        const streamEndRef = React.useRef(null);

        // Phase 7 deferred: listen for `wr:scouting-generate` events dispatched by the
        // big-board / draft-room scouting buttons. Inject the scouting report directly
        // into the AlexStream feed instead of opening the separate Alex chat panel.
        React.useEffect(() => {
            const handler = (e) => {
                const { playerName, pos, summary, text, fullText } = e.detail || {};
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'scouting',
                        badge: '🔎',
                        color: '#9b8afb',
                        title: playerName ? ('Scouting Report — ' + playerName + (pos ? ' (' + pos + ')' : '')) : 'Scouting Report',
                        text: summary || text || 'Scouting report ready. Tap to expand.',
                        fullText: fullText || text || summary || '',
                        expandable: true,
                    },
                });
            };
            window.addEventListener('wr:scouting-generate', handler);
            return () => window.removeEventListener('wr:scouting-generate', handler);
        }, [dispatch]);

        const budget = state.alex.alexSpend.budget || 12;
        const sonnetUsed = state.alex.alexSpend.sonnet || 0;
        const flashUsed = state.alex.alexSpend.flash || 0;
        const budgetPct = (sonnetUsed / budget) * 100;
        const budgetCol =
            sonnetUsed >= budget ? '#E74C3C' :
            sonnetUsed >= budget * 0.7 ? '#F0A500' : '#2ECC71';

        // Send an "Ask Alex" request via Gemini Flash (draft-chat route)
        const sendAsk = async (text) => {
            if (!text || pendingAsk) return;
            if (typeof window.dhqAI !== 'function') {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'user',
                        badge: '?',
                        color: '#E74C3C',
                        title: 'AI unavailable',
                        text: 'dhqAI is not loaded. Try reloading the page.',
                    },
                });
                return;
            }

            // Add the user's question to the stream immediately
            dispatch({
                type: 'ALEX_EVENT_ADD',
                event: {
                    type: 'user',
                    badge: '?',
                    color: '#9b8afb',
                    title: 'You asked',
                    text,
                },
            });

            setInputValue('');
            setPendingAsk(true);
            dispatch({ type: 'ALEX_SET_THINKING', thinking: true });

            try {
                // Build short context from current state
                const myPicks = state.picks.filter(p => p.rosterId === state.userRosterId || p.isUser);
                const currentSlot = state.pickOrder[state.currentIdx];
                const contextLines = [
                    `Round ${currentSlot?.round || '?'}, pick ${currentSlot?.overall || '?'} / ${state.pickOrder.length}.`,
                    `User has made ${myPicks.length} picks: ${myPicks.map(p => p.pos + ' ' + p.name).join(', ') || 'none'}.`,
                    state.pinnedRosterId ? `Pinned team: ${state.personas[state.pinnedRosterId]?.teamName} — DNA ${state.personas[state.pinnedRosterId]?.draftDna?.label}, posture ${state.personas[state.pinnedRosterId]?.posture?.label}.` : '',
                ].filter(Boolean).join(' ');

                const messages = [
                    { role: 'user', content: contextLines + '\n\n' + text },
                ];
                const response = await window.dhqAI('draft-chat', text, contextLines, { messages });
                dispatch({ type: 'ALEX_SPEND_FLASH' });
                window.OD?.track?.('alex_response_actioned', {
                    platform: 'warroom',
                    module: 'draft',
                    leagueId: window.S?.currentLeagueId || null,
                    entityType: 'ai_call',
                    entityId: 'draft-chat',
                    metadata: { action: 'draft_alex_asked', quickPrompt: CHIP_PROMPTS.some(p => p.text === text) },
                });

                const replyText = typeof response === 'string' ? response : (response?.content || response?.text || JSON.stringify(response).slice(0, 400));
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'ai',
                        badge: '✦',
                        color: 'var(--gold)',
                        title: 'Alex',
                        text: replyText.slice(0, 400),
                    },
                });
            } catch (e) {
                dispatch({
                    type: 'ALEX_EVENT_ADD',
                    event: {
                        type: 'user',
                        badge: '!',
                        color: '#E74C3C',
                        title: 'Alex error',
                        text: String(e?.message || e).slice(0, 200),
                    },
                });
                if (window.wrLog) window.wrLog('alex.ask', e);
            } finally {
                setPendingAsk(false);
                dispatch({ type: 'ALEX_SET_THINKING', thinking: false });
            }
        };

        const onSubmitAsk = (e) => {
            e.preventDefault();
            if (inputValue.trim()) sendAsk(inputValue.trim());
        };

        const containerCss = panelCard({
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            padding: '8px 10px',
            overflow: 'hidden',
        });

        const stream = state.alex.stream || [];

        return (
            <div style={containerCss}>
                {/* Header with budget */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px', flexShrink: 0 }}>
                    <div style={{ fontFamily: FONT_DISPL, fontSize: '0.8rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
                        Alex Stream
                    </div>
                    <span title={`Sonnet: ${sonnetUsed}/${budget} · Flash: ${flashUsed} (unlimited)`} style={{
                        fontSize: '0.5rem',
                        padding: '1px 6px',
                        background: 'rgba(0,0,0,0.3)',
                        border: '1px solid ' + budgetCol + '44',
                        borderRadius: '3px',
                        color: budgetCol,
                        fontFamily: FONT_MONO_SAFE(),
                        fontWeight: 600,
                    }}>
                        ✦ {sonnetUsed}/{budget}
                    </span>
                </div>

                {/* Stream feed */}
                <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingRight: '3px', marginBottom: '6px' }}>
                    {state.alex.thinking && (
                        <div style={{
                            padding: '5px 8px',
                            fontSize: '0.6rem',
                            color: 'var(--gold)',
                            fontStyle: 'italic',
                            opacity: 0.7,
                            fontFamily: FONT_UI,
                        }}>
                            Alex is thinking<AnimatedDots />
                        </div>
                    )}
                    {stream.length === 0 && !state.alex.thinking && (
                        <div style={{
                            padding: '20px 10px',
                            textAlign: 'center',
                            color: 'var(--silver)',
                            opacity: 0.4,
                            fontSize: '0.68rem',
                            fontFamily: FONT_UI,
                        }}>
                            Alex's commentary will<br />appear here during the draft
                        </div>
                    )}
                    {stream.map(item => {
                        const isExpandable = !!item.expandable;
                        const isExpanded = isExpandable && expandedIds.has(item.id);
                        const toggle = () => {
                            if (!isExpandable) return;
                            setExpandedIds(prev => {
                                const next = new Set(prev);
                                if (next.has(item.id)) next.delete(item.id);
                                else {
                                    next.add(item.id);
                                    window.OD?.track?.('alex_response_actioned', {
                                        platform: 'warroom',
                                        module: 'draft',
                                        leagueId: window.S?.currentLeagueId || null,
                                        entityType: 'ai_response',
                                        entityId: item.id,
                                        metadata: { action: 'expand_stream_item', itemType: item.type || null },
                                    });
                                }
                                return next;
                            });
                        };
                        const textClamp = isExpandable && !isExpanded ? {
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                        } : {};
                        return (
                            <div key={item.id} onClick={toggle} style={{
                                display: 'flex',
                                gap: '6px',
                                padding: '5px 2px',
                                borderBottom: '1px solid rgba(255,255,255,0.025)',
                                fontFamily: FONT_UI,
                                cursor: isExpandable ? 'pointer' : 'default',
                                background: isExpanded ? 'rgba(124,107,248,0.06)' : 'transparent',
                            }}>
                                <span style={{
                                    color: item.color,
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    width: 10,
                                    textAlign: 'center',
                                    flexShrink: 0,
                                    marginTop: '1px',
                                }}>{item.badge}</span>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '0.62rem',
                                        fontWeight: 700,
                                        color: 'var(--white)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                    }}>
                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</span>
                                        {isExpandable && (
                                            <span style={{ fontSize: '0.5rem', opacity: 0.6, color: item.color }}>{isExpanded ? '▾' : '▸'}</span>
                                        )}
                                    </div>
                                    {item.text && (
                                        <div style={{
                                            fontSize: '0.56rem',
                                            color: 'var(--silver)',
                                            opacity: 0.8,
                                            marginTop: '1px',
                                            lineHeight: 1.4,
                                            wordBreak: 'break-word',
                                            whiteSpace: 'pre-wrap',
                                            ...textClamp,
                                        }}>{item.text}</div>
                                    )}
                                    {isExpanded && item.fullText && item.fullText !== item.text && (
                                        <div style={{
                                            fontSize: '0.56rem',
                                            color: 'var(--silver)',
                                            opacity: 0.85,
                                            marginTop: '4px',
                                            lineHeight: 1.5,
                                            wordBreak: 'break-word',
                                            whiteSpace: 'pre-wrap',
                                        }}>{item.fullText}</div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <div ref={streamEndRef} />
                </div>

                {/* Ask Alex chips */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px', marginBottom: '5px', flexShrink: 0 }}>
                    {CHIP_PROMPTS.map(chip => (
                        <button
                            key={chip.label}
                            disabled={pendingAsk}
                            onClick={() => sendAsk(chip.text)}
                            style={{
                                fontSize: '0.52rem',
                                padding: '3px 6px',
                                background: 'rgba(124,107,248,0.08)',
                                border: '1px solid rgba(124,107,248,0.2)',
                                color: 'rgba(155,138,251,0.9)',
                                borderRadius: '10px',
                                cursor: pendingAsk ? 'not-allowed' : 'pointer',
                                fontFamily: FONT_UI,
                                opacity: pendingAsk ? 0.5 : 1,
                            }}
                        >{chip.label}</button>
                    ))}
                </div>

                {/* Ask Alex input */}
                <form onSubmit={onSubmitAsk} style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                    <input
                        type="text"
                        placeholder="Ask Alex…"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        disabled={pendingAsk}
                        style={{
                            flex: 1,
                            padding: '5px 8px',
                            background: 'rgba(255,255,255,0.03)',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: '4px',
                            color: 'var(--white)',
                            fontSize: '0.64rem',
                            fontFamily: FONT_UI,
                            outline: 'none',
                            minWidth: 0,
                        }}
                    />
                    <button
                        type="submit"
                        disabled={pendingAsk || !inputValue.trim()}
                        style={{
                            padding: '5px 10px',
                            background: (pendingAsk || !inputValue.trim()) ? 'rgba(212,175,55,0.3)' : 'var(--gold)',
                            color: 'var(--black)',
                            border: 'none',
                            borderRadius: '4px',
                            fontSize: '0.6rem',
                            fontWeight: 700,
                            cursor: (pendingAsk || !inputValue.trim()) ? 'not-allowed' : 'pointer',
                            fontFamily: FONT_UI,
                        }}
                    >{pendingAsk ? '…' : 'ASK'}</button>
                </form>
            </div>
        );
    }

    // Animated "…" for thinking state
    function AnimatedDots() {
        const [n, setN] = React.useState(0);
        React.useEffect(() => {
            const id = setInterval(() => setN(x => (x + 1) % 4), 400);
            return () => clearInterval(id);
        }, []);
        return <span>{'.'.repeat(n)}</span>;
    }

    function FONT_MONO_SAFE() {
        return window.DraftCC?.styles?.FONT_MONO || "'JetBrains Mono', monospace";
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.AlexStreamPanel = AlexStreamPanel;
})();

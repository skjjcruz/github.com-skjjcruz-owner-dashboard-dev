// ── GM Strategy Editor ────────────────────────────────────────────────────────
// Full strategy configuration panel — sets GM strategy that syncs to Scout.
// Depends on: window.GMStrategy (from ReconAI/shared/strategy.js)
//             window.WrStorage / window.WR_KEYS (from core.js)
// ─────────────────────────────────────────────────────────────────────────────

function StrategyEditorTab({ currentLeague, myRoster, playersData, gmStrategy, setGmStrategy }) {
    const leagueId = currentLeague?.league_id || currentLeague?.id;

    // ── Local draft of strategy (save only on explicit Save) ──────────────────
    // Phase 1: Three canonical presets (Rebuild / Compete / Win Now) + Custom.
    // Selecting a preset auto-bundles downstream variables; Custom unlocks them.
    const [draft, setDraft] = React.useState(() => {
        const saved = window.GMStrategy?.getStrategy?.(leagueId)
            || window.WrStorage?.get?.(window.WR_KEYS?.GM_STRATEGY?.(leagueId))
            || {};
        const normalize = window.WR?.GmMode?.normalize || ((m) => m || 'compete');
        return {
            mode: normalize(saved.mode) || 'compete',
            aggression: saved.aggression || 'medium',
            draftStyle: saved.draftStyle || 'bpa',
            marketPosture: saved.marketPosture || 'hold',
            timeline: saved.timeline || '2_3_years',
            alexPersonality: saved.alexPersonality || 'balanced',
            targetPositions: saved.targetPositions || [],
            sellPositions: saved.sellPositions || [],
            sellRules: saved.sellRules || [],
            untouchable: saved.untouchable || [],
        };
    });

    // Selecting a preset auto-applies its bundled config.
    const applyPreset = (modeId) => {
        const preset = window.WR?.GmMode?.getPreset?.(modeId);
        const cfg = preset?.config || {};
        setDraft(d => ({
            ...d,
            ...cfg,
            mode: modeId,
        }));
    };
    const isCustom = draft.mode === 'custom';

    const [syncStatus, setSyncStatus] = React.useState('idle'); // idle | saving | saved | error
    const [newSellRule, setNewSellRule] = React.useState('');
    const [untouchableSearch, setUntouchableSearch] = React.useState('');
    const [showUntouchablePicker, setShowUntouchablePicker] = React.useState(false);

    // ── Helpers ───────────────────────────────────────────────────────────────
    const set = (key, val) => setDraft(d => ({ ...d, [key]: val }));

    const toggleArr = (key, val) => setDraft(d => {
        const arr = d[key] || [];
        return { ...d, [key]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] };
    });

    // ── Save ──────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        setSyncStatus('saving');
        const payload = { ...draft, lastSyncedFrom: 'warroom', leagueId };
        try {
            if (window.GMStrategy?.saveStrategy) {
                await window.GMStrategy.saveStrategy(payload);
            }
            if (window.WrStorage && window.WR_KEYS?.GM_STRATEGY) {
                window.WrStorage.set(window.WR_KEYS.GM_STRATEGY(leagueId), payload);
            }
            window._wrGmStrategy = payload;
            if (setGmStrategy) setGmStrategy(payload);
            // Phase 1: broadcast mode change so the header card + engines pick it up
            window.dispatchEvent(new CustomEvent('wr:gm-mode-changed', { detail: { mode: draft.mode, strategy: payload } }));
            setSyncStatus('saved');
            setTimeout(() => setSyncStatus('idle'), 3000);
        } catch (e) {
            console.error('GMStrategy save error', e);
            setSyncStatus('error');
            setTimeout(() => setSyncStatus('idle'), 3000);
        }
    };

    // ── Roster players for untouchables picker ────────────────────────────────
    const rosterPlayers = React.useMemo(() => {
        const pids = myRoster?.players || [];
        if (!pids.length || !playersData) return [];
        return pids
            .filter(pid => pid && pid !== '0')
            .map(pid => {
                const pd = playersData[pid] || {};
                return {
                    id: pid,
                    name: pd.full_name || pd.name || pid,
                    pos: pd.position || '?',
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [myRoster, playersData]);

    const filteredRoster = React.useMemo(() => {
        if (!untouchableSearch.trim()) return rosterPlayers;
        const q = untouchableSearch.toLowerCase();
        return rosterPlayers.filter(p => p.name.toLowerCase().includes(q) || p.pos.toLowerCase().includes(q));
    }, [rosterPlayers, untouchableSearch]);

    const untouchableNames = React.useMemo(() => {
        return (draft.untouchable || []).map(id => {
            const p = rosterPlayers.find(r => r.id === id);
            return p ? p.name : id;
        });
    }, [draft.untouchable, rosterPlayers]);

    // ── Sync badge ─────────────────────────────────────────────────────────────
    const SyncBadge = () => {
        if (syncStatus === 'saving') return (
            <span style={styles.badge('rgba(212,175,55,0.2)', '#D4AF37')}>Saving…</span>
        );
        if (syncStatus === 'saved') return (
            <span style={styles.badge('rgba(46,204,113,0.15)', '#2ECC71')}>✓ Synced to Scout</span>
        );
        if (syncStatus === 'error') return (
            <span style={styles.badge('rgba(231,76,60,0.15)', '#E74C3C')}>Save failed</span>
        );
        return null;
    };

    // ── Section header ────────────────────────────────────────────────────────
    const SectionHeader = ({ title, sub }) => (
        <div style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.75rem', color: 'rgba(212,175,55,0.6)', letterSpacing: '0.16em', textTransform: 'uppercase' }}>{title}</div>
            {sub && <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{sub}</div>}
        </div>
    );

    // ── Pill selector ─────────────────────────────────────────────────────────
    const PillGroup = ({ options, value, onChange, fullWidth }) => (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {options.map(opt => {
                const active = value === opt.value;
                return (
                    <button key={opt.value} onClick={() => onChange(opt.value)} style={{
                        padding: '7px 14px',
                        border: active ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 6,
                        background: active ? 'rgba(212,175,55,0.15)' : 'rgba(255,255,255,0.04)',
                        color: active ? 'var(--gold)' : 'rgba(255,255,255,0.65)',
                        fontSize: '0.82rem',
                        fontFamily: 'DM Sans, sans-serif',
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                        flex: fullWidth ? 1 : undefined,
                        textAlign: 'center',
                    }}>
                        {opt.label}
                    </button>
                );
            })}
        </div>
    );

    // ── Multi-select pills ────────────────────────────────────────────────────
    const MultiSelect = ({ options, value, onChange }) => (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {options.map(opt => {
                const active = (value || []).includes(opt);
                return (
                    <button key={opt} onClick={() => onChange(opt)} style={{
                        padding: '5px 10px',
                        border: active ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.1)',
                        borderRadius: 5,
                        background: active ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.03)',
                        color: active ? 'var(--gold)' : 'rgba(255,255,255,0.55)',
                        fontSize: '0.75rem',
                        fontFamily: 'DM Sans, sans-serif',
                        fontWeight: active ? 600 : 400,
                        cursor: 'pointer',
                        transition: 'all 0.13s',
                    }}>
                        {opt}
                    </button>
                );
            })}
        </div>
    );

    const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'PICKS'];

    // ── Mode configs (Phase 1: 3 canonical presets + Custom) ──────────────────
    const MODES = [
        { value: 'rebuild',  label: 'Rebuild',  desc: 'Youth, picks, and patience.', color: '#3498DB' },
        { value: 'compete',  label: 'Compete',  desc: 'Build long-term while staying competitive.', color: '#D4AF37' },
        { value: 'win_now',  label: 'Win Now',  desc: 'Spend it all to win this year.', color: '#E74C3C' },
        { value: 'custom',   label: 'Custom',   desc: 'Hand-tune every variable below.', color: '#7C6BF8' },
    ];

    const AGGRESSION = [
        { value: 'conservative', label: 'Conservative', desc: 'Wait for value, never overpay.' },
        { value: 'medium',       label: 'Medium',        desc: 'Calculated moves, balanced risk.' },
        { value: 'aggressive',   label: 'Aggressive',    desc: 'Make the big swing, force the deal.' },
    ];

    const DRAFT_STYLES = [
        { value: 'accumulate',       label: 'Accumulate',       desc: 'Stack picks, build depth.' },
        { value: 'consolidate',      label: 'Consolidate',      desc: 'Package depth into elite talent.' },
        { value: 'positional_need',  label: 'Positional Need',  desc: 'Fill the weakest spots first.' },
        { value: 'bpa',              label: 'BPA',              desc: 'Best player available, always.' },
    ];

    const MARKET_POSTURES = [
        { value: 'buy_low',   label: 'Buy Low',   desc: 'Target undervalued assets and injured players.' },
        { value: 'sell_high', label: 'Sell High', desc: 'Move players at peak value before decline.' },
        { value: 'hold',      label: 'Hold',      desc: 'Patient, only trade from a position of strength.' },
        { value: 'exploit',   label: 'Exploit',   desc: 'Identify and attack league-wide market inefficiencies.' },
    ];

    const TIMELINES = [
        { value: '1_year',       label: '1 Year',       desc: 'All chips on this season.' },
        { value: '2_3_years',    label: '2–3 Years',    desc: 'Medium-term contention window.' },
        { value: 'dynasty_long', label: 'Dynasty Long', desc: 'Build a program, not just a season.' },
    ];

    const PERSONALITIES = [
        { value: 'aggressive',    label: 'Aggressive',     desc: 'Alex hunts for wins, pushes hard on every move.' },
        { value: 'value_hunter',  label: 'Value Hunter',   desc: 'Alex obsesses over undervalued assets and market gaps.' },
        { value: 'balanced',      label: 'Balanced',       desc: 'Alex weighs all options before recommending a move.' },
    ];

    const currentMode = MODES.find(m => m.value === draft.mode);
    const currentAggression = AGGRESSION.find(a => a.value === draft.aggression);

    return (
        <div style={{ padding: '20px 0 60px', width: '100%', maxWidth: 'none', margin: 0 }}>

            {/* ── Header ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 10 }}>
                <div>
                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.5rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em' }}>GM STRATEGY</div>
                    <div style={{ fontSize: '0.82rem', color: 'rgba(255,255,255,0.45)', fontFamily: 'DM Sans, sans-serif', marginTop: 2 }}>
                        Set your franchise direction — syncs to Scout so Alex knows how to advise you.
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <SyncBadge />
                    <button onClick={handleSave} style={styles.saveBtn(syncStatus === 'saving')}>
                        {syncStatus === 'saving' ? 'Saving…' : 'Save Strategy'}
                    </button>
                </div>
            </div>

            {/* ── Mode (Phase 1: preset-first) ── */}
            <div style={styles.card}>
                <SectionHeader title="Mode" sub={currentMode?.desc + (isCustom ? '' : ' Preset bundles every downstream setting — switch to Custom to tune individually.')} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {MODES.map(m => {
                        const active = draft.mode === m.value;
                        return (
                            <button key={m.value} onClick={() => {
                                if (m.value === 'custom') set('mode', 'custom');
                                else applyPreset(m.value);
                            }} style={{
                                padding: '12px 14px',
                                border: active ? `1px solid ${m.color}` : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                background: active ? (m.color + '18') : 'rgba(255,255,255,0.03)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                                position: 'relative',
                            }}>
                                <div style={{ position: 'absolute', top: 10, right: 12, width: 8, height: 8, borderRadius: '50%', background: active ? m.color : 'transparent' }} />
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.95rem', fontWeight: 700, color: active ? m.color : 'rgba(255,255,255,0.8)', letterSpacing: '0.03em' }}>{m.label}</div>
                                <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,0.4)', marginTop: 3, fontFamily: 'DM Sans, sans-serif', lineHeight: 1.3 }}>{m.desc}</div>
                            </button>
                        );
                    })}
                </div>
                {!isCustom && (
                    <div style={{ marginTop: 14, padding: '10px 12px', background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: 6, fontSize: '0.78rem', color: 'rgba(255,255,255,0.7)', fontFamily: 'DM Sans, sans-serif', lineHeight: 1.5 }}>
                        <strong style={{ color: 'var(--gold)' }}>Preset applied:</strong> aggression <em>{draft.aggression}</em> · draft <em>{draft.draftStyle}</em> · market <em>{draft.marketPosture}</em> · timeline <em>{draft.timeline}</em> · personality <em>{draft.alexPersonality}</em>
                    </div>
                )}
            </div>

            {/* ── Aggression (Custom only) ── */}
            {isCustom && <div style={styles.card}>
                <SectionHeader title="Aggression" sub={currentAggression?.desc} />
                <PillGroup
                    options={AGGRESSION.map(a => ({ value: a.value, label: a.label }))}
                    value={draft.aggression}
                    onChange={v => set('aggression', v)}
                    fullWidth
                />
            </div>}

            {/* ── Priorities ── */}
            <div style={styles.card}>
                <SectionHeader title="Priorities" />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    {/* Target Positions */}
                    <div>
                        <div style={styles.subLabel}>Target Positions</div>
                        <MultiSelect
                            options={POSITIONS}
                            value={draft.targetPositions}
                            onChange={v => toggleArr('targetPositions', v)}
                        />
                    </div>
                    {/* Sell Positions */}
                    <div>
                        <div style={styles.subLabel}>Sell Positions</div>
                        <MultiSelect
                            options={POSITIONS}
                            value={draft.sellPositions}
                            onChange={v => toggleArr('sellPositions', v)}
                        />
                    </div>
                </div>

                {/* Sell Rules */}
                <div style={{ marginTop: 16 }}>
                    <div style={styles.subLabel}>Sell Rules</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {(draft.sellRules || []).map((rule, i) => (
                            <span key={i} style={styles.tag}>
                                {rule}
                                <button onClick={() => set('sellRules', draft.sellRules.filter((_, j) => j !== i))} style={styles.tagX}>×</button>
                            </span>
                        ))}
                        {draft.sellRules.length === 0 && <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'DM Sans, sans-serif' }}>No rules set</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <input
                            value={newSellRule}
                            onChange={e => setNewSellRule(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && newSellRule.trim()) { set('sellRules', [...draft.sellRules, newSellRule.trim()]); setNewSellRule(''); }}}
                            placeholder='e.g. "Sell RB age 27+"'
                            style={styles.input}
                        />
                        <button onClick={() => { if (newSellRule.trim()) { set('sellRules', [...draft.sellRules, newSellRule.trim()]); setNewSellRule(''); }}} style={styles.addBtn}>Add</button>
                    </div>
                </div>

                {/* Untouchables */}
                <div style={{ marginTop: 16 }}>
                    <div style={styles.subLabel}>Untouchables</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                        {untouchableNames.map((name, i) => (
                            <span key={i} style={{ ...styles.tag, borderColor: 'rgba(212,175,55,0.4)', color: 'var(--gold)' }}>
                                🛡 {name}
                                <button onClick={() => set('untouchable', draft.untouchable.filter((_, j) => j !== i))} style={styles.tagX}>×</button>
                            </span>
                        ))}
                        {draft.untouchable.length === 0 && <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.3)', fontFamily: 'DM Sans, sans-serif' }}>No untouchables set</span>}
                    </div>
                    <div style={{ position: 'relative' }}>
                        <input
                            value={untouchableSearch}
                            onChange={e => { setUntouchableSearch(e.target.value); setShowUntouchablePicker(true); }}
                            onFocus={() => setShowUntouchablePicker(true)}
                            placeholder='Search roster…'
                            style={styles.input}
                        />
                        {showUntouchablePicker && filteredRoster.length > 0 && (
                            <div style={styles.dropdown}>
                                {filteredRoster.slice(0, 12).map(p => (
                                    <button key={p.id} onClick={() => {
                                        if (!draft.untouchable.includes(p.id)) {
                                            set('untouchable', [...draft.untouchable, p.id]);
                                        }
                                        setUntouchableSearch('');
                                        setShowUntouchablePicker(false);
                                    }} style={styles.dropdownItem}>
                                        <span style={{ fontSize: '0.7rem', color: 'rgba(212,175,55,0.7)', fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, marginRight: 6 }}>{p.pos}</span>
                                        {p.name}
                                    </button>
                                ))}
                                <button onClick={() => setShowUntouchablePicker(false)} style={{ ...styles.dropdownItem, color: 'rgba(255,255,255,0.3)', fontSize: '0.72rem' }}>Close</button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* ── Draft Style (Custom only) ── */}
            {isCustom && <div style={styles.card}>
                <SectionHeader title="Draft Style" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {DRAFT_STYLES.map(ds => {
                        const active = draft.draftStyle === ds.value;
                        return (
                            <button key={ds.value} onClick={() => set('draftStyle', ds.value)} style={{
                                padding: '11px 13px',
                                border: active ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                background: active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.9rem', fontWeight: 700, color: active ? 'var(--gold)' : 'rgba(255,255,255,0.8)' }}>{ds.label}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginTop: 2, fontFamily: 'DM Sans, sans-serif', lineHeight: 1.3 }}>{ds.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div>}

            {/* ── Market Posture (Custom only) ── */}
            {isCustom && <div style={styles.card}>
                <SectionHeader title="Market Posture" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
                    {MARKET_POSTURES.map(mp => {
                        const active = draft.marketPosture === mp.value;
                        return (
                            <button key={mp.value} onClick={() => set('marketPosture', mp.value)} style={{
                                padding: '11px 13px',
                                border: active ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                background: active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.9rem', fontWeight: 700, color: active ? 'var(--gold)' : 'rgba(255,255,255,0.8)' }}>{mp.label}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginTop: 2, fontFamily: 'DM Sans, sans-serif', lineHeight: 1.3 }}>{mp.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div>}

            {/* ── Timeline (Custom only) ── */}
            {isCustom && <div style={styles.card}>
                <SectionHeader title="Timeline" />
                <PillGroup
                    options={TIMELINES.map(t => ({ value: t.value, label: t.label }))}
                    value={draft.timeline}
                    onChange={v => set('timeline', v)}
                    fullWidth
                />
                {TIMELINES.find(t => t.value === draft.timeline) && (
                    <div style={{ marginTop: 8, fontSize: '0.78rem', color: 'rgba(255,255,255,0.45)', fontFamily: 'DM Sans, sans-serif' }}>
                        {TIMELINES.find(t => t.value === draft.timeline).desc}
                    </div>
                )}
            </div>}

            {/* ── Alex Personality (Custom only) ── */}
            {isCustom && <div style={styles.card}>
                <SectionHeader title="Alex Personality" sub="How Alex frames advice and makes recommendations." />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
                    {PERSONALITIES.map(p => {
                        const active = draft.alexPersonality === p.value;
                        return (
                            <button key={p.value} onClick={() => set('alexPersonality', p.value)} style={{
                                padding: '12px 14px',
                                border: active ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.1)',
                                borderRadius: 8,
                                background: active ? 'rgba(212,175,55,0.12)' : 'rgba(255,255,255,0.03)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                transition: 'all 0.15s',
                            }}>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.92rem', fontWeight: 700, color: active ? 'var(--gold)' : 'rgba(255,255,255,0.8)' }}>{p.label}</div>
                                <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', marginTop: 3, fontFamily: 'DM Sans, sans-serif', lineHeight: 1.3 }}>{p.desc}</div>
                            </button>
                        );
                    })}
                </div>
            </div>}

            {/* ── Bottom save bar ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, paddingBottom: 40 }}>
                <SyncBadge />
                <button onClick={handleSave} style={styles.saveBtn(syncStatus === 'saving')}>
                    {syncStatus === 'saving' ? 'Saving…' : 'Save Strategy'}
                </button>
            </div>

        </div>
    );
}

// ── Shared style helpers ──────────────────────────────────────────────────────
const styles = {
    card: {
        background: 'var(--off-black, #0f0f14)',
        border: '1px solid rgba(212,175,55,0.15)',
        borderRadius: 10,
        padding: '16px 18px',
        marginBottom: 14,
    },
    subLabel: {
        fontSize: '0.72rem',
        color: 'rgba(255,255,255,0.45)',
        fontFamily: 'DM Sans, sans-serif',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        marginBottom: 7,
    },
    input: {
        flex: 1,
        background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 6,
        padding: '7px 10px',
        color: '#fff',
        fontSize: '0.82rem',
        fontFamily: 'DM Sans, sans-serif',
        outline: 'none',
        width: '100%',
        boxSizing: 'border-box',
    },
    addBtn: {
        background: 'rgba(212,175,55,0.15)',
        border: '1px solid rgba(212,175,55,0.35)',
        borderRadius: 6,
        color: 'var(--gold)',
        fontSize: '0.8rem',
        fontFamily: 'DM Sans, sans-serif',
        padding: '7px 14px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
    },
    tag: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 9px',
        borderRadius: 5,
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(255,255,255,0.06)',
        color: 'rgba(255,255,255,0.75)',
        fontSize: '0.76rem',
        fontFamily: 'DM Sans, sans-serif',
    },
    tagX: {
        background: 'none',
        border: 'none',
        color: 'rgba(255,255,255,0.45)',
        cursor: 'pointer',
        fontSize: '0.85rem',
        padding: '0 2px',
        lineHeight: 1,
    },
    dropdown: {
        position: 'absolute',
        top: '100%',
        left: 0,
        right: 0,
        zIndex: 99,
        background: '#1A1A1A',
        border: '1px solid rgba(212,175,55,0.25)',
        borderRadius: 8,
        marginTop: 4,
        maxHeight: 220,
        overflowY: 'auto',
        boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    },
    dropdownItem: {
        width: '100%',
        padding: '9px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
        color: 'rgba(255,255,255,0.75)',
        fontSize: '0.82rem',
        fontFamily: 'DM Sans, sans-serif',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'flex',
        alignItems: 'center',
    },
    saveBtn: (disabled) => ({
        padding: '9px 22px',
        background: disabled ? 'rgba(212,175,55,0.1)' : 'rgba(212,175,55,0.2)',
        border: '1px solid rgba(212,175,55,0.5)',
        borderRadius: 7,
        color: disabled ? 'rgba(212,175,55,0.5)' : 'var(--gold)',
        fontSize: '0.85rem',
        fontFamily: 'DM Sans, sans-serif',
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        letterSpacing: '0.04em',
        transition: 'all 0.15s',
    }),
    badge: (bg, color) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '5px 10px',
        background: bg,
        borderRadius: 20,
        color,
        fontSize: '0.75rem',
        fontFamily: 'DM Sans, sans-serif',
        fontWeight: 600,
    }),
};

window.StrategyEditorTab = StrategyEditorTab;

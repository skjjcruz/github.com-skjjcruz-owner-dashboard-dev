// ══════════════════════════════════════════════════════════════════
// js/tabs/dashboard.js — DashboardPanel: iPhone-style widget system
// Modules (apps) × Sizes (S/M/L). Full-screen picker overlay.
// Star-to-dashboard from any card across the app.
// ══════════════════════════════════════════════════════════════════

// ─── Module definitions (v2 — 6 world-class modules) ─────────────
// Each module must pass the test: actionable? leads somewhere? wow?
// Old 9-module registry preserved in comments for reference during migration.
const T = () => window.WrTheme || {};
const WIDGET_DESTINATIONS = {
    league: 'analytics',
    leagueAnalytics: 'analytics',
    analytics: 'analytics',
    roster: 'myteam',
    myteam: 'myteam',
    market: 'trades',
    trades: 'trades',
    waiver: 'fa',
    waivers: 'fa',
    fa: 'fa',
    draft: 'draft',
    trophies: 'trophies',
    fieldNotes: 'alex',
    scout: 'alex',
    intel: 'alex',
    alex: 'alex',
};
function resolveWidgetDestination(target) {
    if (!target) return null;
    return WIDGET_DESTINATIONS[target] || target;
}

const WIDGET_MODULES = {
    'intel-brief': {
        label: 'Intel Brief',
        icon: '🧠',
        description: "Alex's briefing — greeting, tier read, and action CTAs",
        accent: () => T().color?.('accent') || '#D4AF37',
        metrics: [],
        sizes: ['md', 'lg', 'tall', 'xl', 'xxl'],
        clickTarget: {},
    },
    'roster-pulse': {
        label: 'Roster Pulse',
        icon: '💊',
        description: 'Your roster vital signs — health, elites, aging, window',
        accent: () => T().color?.('positive') || '#2ECC71',
        metrics: [
            { key: 'health-score', label: 'Health Score' },
            { key: 'elite-count', label: 'Elite Players' },
            { key: 'contender-rank', label: 'Contender Rank' },
        ],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
    },
    'league-landscape': {
        label: 'League Landscape',
        icon: '🌐',
        description: 'Standings, transactions, who is moving',
        accent: () => T().color?.('accent') || '#D4AF37',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xl', 'xxl'],
        clickTarget: { sm: 'analytics', md: 'analytics' },
    },
    'market-radar': {
        label: 'Market Radar',
        icon: '📡',
        description: 'Trade opportunities, waiver targets, FAAB',
        accent: () => T().color?.('purple') || '#7C6BF8',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'xl', 'xxl'],
        clickTarget: { sm: 'trades', md: 'trades' },
    },
    'draft-capital': {
        label: 'Draft Capital',
        icon: '🎯',
        description: 'Pick inventory, values, draft countdown',
        accent: () => T().color?.('warn') || '#F0A500',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'xxl'],
        clickTarget: { sm: 'draft', md: 'draft' },
    },
    'field-notes': {
        label: 'Field Notes',
        icon: '📋',
        description: 'Intel logged from War Room Scout sessions',
        accent: () => T().color?.('info') || '#00c8b4',
        metrics: [],
        sizes: ['slim', 'narrow', 'lg', 'tall'],
        clickTarget: {},
    },
    // Phase 3: League intelligence surfaced to Home (ex-League Map widgets)
    'competitive-tiers': {
        label: 'Competitive Tiers',
        icon: '🏆',
        description: 'Every team grouped into Elite · Contender · Crossroads · Rebuilding',
        accent: () => T().color?.('accent') || '#D4AF37',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'analytics', md: 'analytics' },
    },
    'power-rankings': {
        label: 'Power Rankings',
        icon: '📈',
        description: 'Blended health, contender PPG, and dynasty DHQ rankings',
        accent: () => T().color?.('positive') || '#2ECC71',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'analytics', md: 'analytics' },
    },
    // SI-3: Tag-driven widgets — surface My Roster tags into Home
    'trade-block': {
        label: 'Trade Block',
        icon: '🏷️',
        description: 'Players you\'ve tagged to shop in trades',
        accent: () => T().color?.('warn') || '#F0A500',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
    },
    'cut-candidates': {
        label: 'Cut Candidates',
        icon: '✂️',
        description: 'Players flagged as drop candidates',
        accent: () => T().color?.('negative') || '#E74C3C',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'myteam', md: 'myteam' },
    },
    'waiver-targets': {
        label: 'Waiver Targets',
        icon: '🎯',
        description: 'Players you\'re watching for pickup',
        accent: () => T().color?.('info') || '#3498DB',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall'],
        clickTarget: { sm: 'fa', md: 'fa' },
    },
    // Phase 9: My Trophies widget — surfaces user's championship count + HOF inductees
    'my-trophies': {
        label: 'My Trophies',
        icon: '🏆',
        description: 'Titles, runner-ups, hall of fame — your team\'s legacy',
        accent: () => T().color?.('accent') || '#D4AF37',
        metrics: [],
        sizes: ['sm', 'md', 'lg', 'tall', 'xxl'],
        clickTarget: { sm: 'trophies', md: 'trophies' },
    },
};

// Legacy module keys → new keys (for migration of saved widget configs)
const LEGACY_MODULE_MAP = {
    'roster': 'roster-pulse',
    'competitive': 'roster-pulse',
    'trading': 'market-radar',
    'waivers': 'market-radar',
    'draft': 'draft-capital',
    'league-standings': 'league-landscape',
    'transaction-ticker': 'league-landscape',
    'intelligence-brief': 'intel-brief',
    // field-notes stays as-is
};

// ─── Star widget utilities (exposed globally) ─────────────────────
(function() {
    const STAR_KEY = 'wr_starred_widgets';
    const WrSt = () => window.App?.WrStorage || { get: (k,f) => { try { const v = localStorage.getItem(k); return v === null ? f : JSON.parse(v); } catch { return f; } }, set: (k,v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
    window.WrStarWidget = {
        getAll() { return WrSt().get(STAR_KEY, []); },
        isStarred(id) { return WrSt().get(STAR_KEY, []).some(s => s.id === id); },
        toggle(item) {
            const all = WrSt().get(STAR_KEY, []);
            const idx = all.findIndex(s => s.id === item.id);
            const next = idx >= 0 ? all.filter((_, i) => i !== idx) : [...all, { ...item, ts: Date.now() }];
            WrSt().set(STAR_KEY, next);
            window.dispatchEvent(new CustomEvent('wr_starred_changed', { detail: next }));
            return idx < 0; // returns true if now starred
        },
        remove(id) {
            const all = WrSt().get(STAR_KEY, []).filter(s => s.id !== id);
            WrSt().set(STAR_KEY, all);
            window.dispatchEvent(new CustomEvent('wr_starred_changed', { detail: all }));
        },
    };
})();

// ══════════════════════════════════════════════════════════════════
// DashboardWidgetPicker — full-screen iPhone-style overlay
// ══════════════════════════════════════════════════════════════════
function DashboardWidgetPicker({ onAdd, onClose, editWidget }) {
    const [step, setStep] = React.useState(editWidget ? 'size' : 'module');
    const [selectedModule, setSelectedModule] = React.useState(editWidget?.key || null);
    const [selectedSize, setSelectedSize] = React.useState(editWidget?.size || null);
    const [selectedMetric, setSelectedMetric] = React.useState(editWidget?.primaryMetric || null);
    const [hoverModule, setHoverModule] = React.useState(null);

    const mod = selectedModule ? WIDGET_MODULES[selectedModule] : null;

    const SIZE_META = {
        sm: { label: 'Small', dims: '1×1', desc: 'Single KPI stat', w: 80, h: 80 },
        slim: { label: 'Slim', dims: '1×2', desc: 'Narrow card', w: 80, h: 160 },
        narrow: { label: 'Narrow', dims: '1×4', desc: 'Tall narrow column', w: 80, h: 320 },
        md: { label: 'Medium', dims: '2×1', desc: 'Stat + sparkline', w: 160, h: 80 },
        lg: { label: 'Large', dims: '2×2', desc: 'Mini-panel: 3-4 stats + chart + drill-down list', w: 160, h: 160 },
        tall: { label: 'Tall', dims: '2×4', desc: 'Half-width tall panel — great for text-heavy cards', w: 160, h: 320 },
        xl: { label: 'Extra Large', dims: '4×2', desc: 'Full-width premium panel', w: 320, h: 160 },
        xxl: { label: 'Full Page', dims: '4×4', desc: 'Full-width expanded view — no clipping', w: 320, h: 320 },
    };

    function handleConfirm() {
        if (!selectedModule || !selectedSize) return;
        const metric = selectedMetric || (mod?.metrics?.[0]?.key || null);
        onAdd({ id: selectedModule + '_' + Date.now(), key: selectedModule, size: selectedSize, primaryMetric: metric });
        onClose();
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'wrFadeIn 0.18s ease',
        }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <style>{`@keyframes wrFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>

            <div style={{
                background: '#0d0d0d', border: '1px solid rgba(212,175,55,0.25)',
                borderRadius: '20px', width: 'min(600px, 92vw)', maxHeight: '90vh',
                overflow: 'hidden', display: 'flex', flexDirection: 'column',
                boxShadow: '0 24px 80px rgba(0,0,0,0.7)',
            }}>
                {/* Header */}
                <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid rgba(212,175,55,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.08em' }}>
                            {editWidget ? 'EDIT WIDGET' : 'ADD WIDGET'}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--silver)', marginTop: '2px', opacity: 0.7 }}>
                            {step === 'module' ? 'Choose a module' : step === 'size' ? (mod?.label || '') + ' — pick a size' : 'Configure & confirm'}
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {step !== 'module' && (
                            <button onClick={() => setStep(step === 'size' ? 'module' : 'size')}
                                style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', padding: '6px 12px', color: 'var(--silver)', cursor: 'pointer', fontSize: '0.78rem', fontFamily: 'DM Sans, sans-serif' }}>
                                ← Back
                            </button>
                        )}
                        <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: '8px', padding: '6px 10px', color: 'var(--silver)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}>✕</button>
                    </div>
                </div>

                {/* Step 1: Module grid — 3×2 compact, no scroll */}
                {step === 'module' && (
                    <div style={{ padding: '16px 20px' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px' }}>
                            {Object.entries(WIDGET_MODULES).map(([key, m]) => (
                                <div key={key}
                                    onMouseEnter={() => setHoverModule(key)}
                                    onMouseLeave={() => setHoverModule(null)}
                                    onClick={() => { setSelectedModule(key); setSelectedMetric(m.metrics?.[0]?.key || null); setStep('size'); }}
                                    style={{
                                        background: hoverModule === key ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.03)',
                                        border: '1px solid ' + (hoverModule === key ? 'rgba(212,175,55,0.4)' : 'rgba(255,255,255,0.08)'),
                                        borderRadius: '10px', padding: '14px 12px', cursor: 'pointer',
                                        transition: 'all 0.15s', textAlign: 'center',
                                    }}>
                                    <div style={{ fontSize: '1.5rem', marginBottom: '4px', lineHeight: 1 }}>{m.icon}</div>
                                    <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.88rem', fontWeight: 700, color: 'var(--white)', letterSpacing: '0.04em', marginBottom: '2px' }}>{m.label}</div>
                                    <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.6, lineHeight: 1.3 }}>{m.description}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Step 2: Size picker — compact, no scroll */}
                {step === 'size' && mod && (
                    <div style={{ padding: '16px 20px' }}>
                        {/* Module info — compact */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px', padding: '10px 14px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px' }}>
                            <span style={{ fontSize: '1.4rem' }}>{mod.icon}</span>
                            <div>
                                <div style={{ fontFamily: 'Rajdhani, sans-serif', fontWeight: 700, color: 'var(--white)', fontSize: '0.92rem' }}>{mod.label}</div>
                                <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.7 }}>{mod.description}</div>
                            </div>
                        </div>

                        {/* Size options — horizontal wrap grid */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                            {mod.sizes.map(sz => {
                                const sm = SIZE_META[sz];
                                if (!sm) return null;
                                const isActive = selectedSize === sz;
                                const accentCol = typeof mod.accent === 'function' ? mod.accent() : mod.accent;
                                return (
                                    <div key={sz} onClick={() => setSelectedSize(sz)} style={{
                                        display: 'flex', flexDirection: 'column', alignItems: 'center',
                                        padding: '10px 14px', borderRadius: '8px', cursor: 'pointer',
                                        border: '1.5px solid ' + (isActive ? (accentCol || 'var(--gold)') : 'rgba(255,255,255,0.08)'),
                                        background: isActive ? 'rgba(212,175,55,0.1)' : 'rgba(255,255,255,0.02)',
                                        transition: 'all 0.12s', minWidth: 70,
                                    }}>
                                        {/* Mini visual preview */}
                                        <div style={{
                                            width: Math.min(sm.w / 2.5, 50), height: Math.min(sm.h / 2.5, 50),
                                            background: isActive ? 'rgba(212,175,55,0.2)' : 'rgba(255,255,255,0.06)',
                                            border: '1px solid ' + (isActive ? 'var(--gold)' : 'rgba(255,255,255,0.1)'),
                                            borderRadius: '3px', marginBottom: '6px',
                                        }} />
                                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.82rem', fontWeight: 700, color: isActive ? 'var(--gold)' : 'var(--white)' }}>{sm.label}</div>
                                        <div style={{ fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.5 }}>{sm.dims}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Metric picker (for modules with choices) */}
                        {mod.metrics.length > 1 && (
                            <div style={{ marginBottom: '14px' }}>
                                <div style={{ fontSize: '0.68rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 600, marginBottom: '6px' }}>Primary Stat</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {mod.metrics.map(m => {
                                        const accentCol = typeof mod.accent === 'function' ? mod.accent() : mod.accent;
                                        return (
                                            <button key={m.key} onClick={() => setSelectedMetric(m.key)} style={{
                                                padding: '4px 10px', borderRadius: '14px', cursor: 'pointer',
                                                border: '1px solid ' + (selectedMetric === m.key ? (accentCol || 'var(--gold)') : 'rgba(255,255,255,0.1)'),
                                                background: selectedMetric === m.key ? 'rgba(212,175,55,0.15)' : 'transparent',
                                                color: selectedMetric === m.key ? 'var(--gold)' : 'var(--silver)',
                                                fontSize: '0.72rem', fontWeight: selectedMetric === m.key ? 600 : 400,
                                                transition: 'all 0.12s', fontFamily: 'DM Sans, sans-serif',
                                            }}>{m.label}</button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Add button */}
                        <button onClick={handleConfirm} disabled={!selectedSize} style={{
                            width: '100%', padding: '12px', borderRadius: '8px', cursor: selectedSize ? 'pointer' : 'not-allowed',
                            background: selectedSize ? 'var(--gold)' : 'rgba(255,255,255,0.06)',
                            border: 'none', color: selectedSize ? '#000' : 'var(--silver)',
                            fontFamily: 'Rajdhani, sans-serif', fontSize: '0.92rem', fontWeight: 700,
                            letterSpacing: '0.06em', transition: 'all 0.15s',
                        }}>{editWidget ? 'UPDATE WIDGET' : 'ADD TO DASHBOARD'}</button>
                    </div>
                )}
            </div>
        </div>
    );
}

// ══════════════════════════════════════════════════════════════════
// DashboardPanel — main component
// ══════════════════════════════════════════════════════════════════
function DashboardPanel({
    selectedWidgets,
    setSelectedWidgets,
    editingKpi,
    setEditingKpi,
    computeKpiValue,
    KPI_OPTIONS,
    rankedTeams,
    sleeperUserId,
    setActiveTab,
    transactions,
    standings,
    currentLeague,
    playersData,
    myRoster,
    getOwnerName,
    getPlayerName,
    timeAgo,
    briefDraftInfo,
}) {
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [editingWidget, setEditingWidget] = React.useState(null); // { widgetId, widget }
    const [dragIdx, setDragIdx] = React.useState(null);
    const [starredWidgets, setStarredWidgets] = React.useState(() => window.WrStarWidget?.getAll() || []);
    const navigateWidget = React.useCallback((target) => {
        const tab = resolveWidgetDestination(target);
        if (tab && setActiveTab) setActiveTab(tab);
    }, [setActiveTab]);

    React.useEffect(() => {
        const handler = () => setStarredWidgets(window.WrStarWidget?.getAll() || []);
        window.addEventListener('wr_starred_changed', handler);
        return () => window.removeEventListener('wr_starred_changed', handler);
    }, []);

    // ── v2 migration: map old 9-module keys → new 6-module keys ──
    React.useEffect(() => {
        const WrSt = window.App?.WrStorage;
        if (!WrSt) return;
        const MIGRATED_KEY = 'wr_dashboard_migrated_v2';
        if (WrSt.get(MIGRATED_KEY, false)) return;
        const old = selectedWidgets || [];
        if (!old.length) { WrSt.set(MIGRATED_KEY, true); return; }
        // Check if ANY old key needs mapping
        const needsMigration = old.some(w => LEGACY_MODULE_MAP[w.key]);
        if (!needsMigration) { WrSt.set(MIGRATED_KEY, true); return; }
        const seen = new Set();
        const migrated = old.map(w => {
            const newKey = LEGACY_MODULE_MAP[w.key] || w.key;
            if (!WIDGET_MODULES[newKey]) return null; // orphaned module
            if (seen.has(newKey)) return null;         // dedup (e.g., roster + competitive both → roster-pulse)
            seen.add(newKey);
            return { ...w, key: newKey, id: newKey + '_' + Date.now() + '_' + Math.random().toString(36).slice(2,5), primaryMetric: WIDGET_MODULES[newKey].metrics?.[0]?.key || null };
        }).filter(Boolean);
        if (migrated.length) setSelectedWidgets(migrated);
        WrSt.set(MIGRATED_KEY, true);
    }, []);

    // ── Listen for theme changes to re-render ──
    const [themeKey, setThemeKey] = React.useState(() => window.WrTheme?.current || 'default');
    React.useEffect(() => {
        const handler = () => setThemeKey(window.WrTheme?.current || 'default');
        window.addEventListener('wr_theme_changed', handler);
        return () => window.removeEventListener('wr_theme_changed', handler);
    }, []);

    const widgets = selectedWidgets || [];

    // ── Shared style tokens (theme-aware) ──
    const theme = window.WrTheme?.get?.() || {};
    const G = theme.colors?.accent || 'var(--gold)';
    const W = theme.colors?.text || 'var(--white)';
    const S = theme.colors?.textMuted || 'var(--silver)';
    const BK = theme.colors?.card || 'var(--black)';
    const cardBase = window.WrTheme?.cardStyle?.() || { background: BK, border: '1px solid rgba(212,175,55,0.2)', borderRadius: '10px', overflow: 'hidden', height: '100%' };
    const monoFont = theme.fonts?.mono || 'JetBrains Mono, monospace';
    const rajFont = theme.fonts?.display || 'Rajdhani, sans-serif';
    const dmFont = theme.fonts?.ui || 'DM Sans, sans-serif';

    // ── KPI value helper ──
    function kv(key) {
        try { return computeKpiValue(key); } catch { return { value: '—', sub: '', color: S }; }
    }

    // ── Trend arrow from spark data ──
    function trendArrow(sparkData, color) {
        if (!sparkData || sparkData.length < 2) return null;
        const first = sparkData[0], last = sparkData[sparkData.length - 1];
        if (!first) return null;
        const pct = Math.round((last - first) / Math.abs(first) * 100);
        if (Math.abs(pct) < 2) return <span style={{ color: S, fontSize: '0.7rem' }}> →</span>;
        return <span style={{ color: pct > 0 ? '#2ECC71' : '#E74C3C', fontSize: '0.7rem', fontWeight: 700 }}> {pct > 0 ? '↑' : '↓'}</span>;
    }

    // ── Percentile badge from rank string like "#3/12" ──
    function percentileBadge(valueStr, accent) {
        if (!valueStr) return null;
        const m = String(valueStr).match(/#?(\d+)\s*[/\-of]+\s*(\d+)/i);
        if (!m) return null;
        const rank = parseInt(m[1]), total = parseInt(m[2]);
        if (!total) return null;
        const pct = Math.round((rank / total) * 100);
        const label = pct <= 25 ? 'Top 25%' : pct <= 50 ? 'Top 50%' : pct <= 75 ? 'Top 75%' : 'Bottom 25%';
        const col = pct <= 25 ? '#2ECC71' : pct <= 50 ? G : pct <= 75 ? '#F0A500' : '#E74C3C';
        return <span style={{ fontSize: '0.6rem', padding: '1px 5px', borderRadius: '3px', background: `${col}18`, color: col, fontWeight: 700, marginLeft: '4px', fontFamily: dmFont }}>{label}</span>;
    }

    // ══════════════════════════════════════════════════════════════
    // SMALL CARD — generic 1×1 KPI
    // ══════════════════════════════════════════════════════════════
    function SmallKpiCard({ kpiKey, primaryMetric }) {
        const key = primaryMetric || kpiKey;
        const val = kv(key);
        const ann = typeof getKpiAnnotation === 'function' ? getKpiAnnotation(key, val.value) : '';
        const mod = WIDGET_MODULES[kpiKey];
        const accentColor = mod?.accent || G;
        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' }}>
                {/* Module badge */}
                <div style={{ fontSize: '0.62rem', color: accentColor, fontFamily: dmFont, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.9 }}>
                    {mod?.icon} {mod?.label || key}
                </div>
                {/* Big value */}
                <div style={{ fontFamily: monoFont, fontSize: '1.4rem', fontWeight: 700, color: val.color || W, lineHeight: 1.1, marginTop: '2px' }}>
                    {val.value}
                    {trendArrow(val.sparkData, val.color)}
                </div>
                {/* Percentile */}
                {percentileBadge(val.value, accentColor)}
                {/* Sub label */}
                <div style={{ fontSize: '0.62rem', color: S, fontFamily: dmFont, opacity: 0.75, marginTop: '1px' }}>{val.sub}</div>
                {/* Annotation */}
                {ann && <div style={{ fontSize: '0.62rem', color: G, fontWeight: 600, fontFamily: dmFont, lineHeight: 1.3, borderTop: '1px solid rgba(212,175,55,0.12)', paddingTop: '4px', marginTop: 'auto' }}>{ann}</div>}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // MEDIUM CARD — 2×1 — stat + sparkline + insight
    // ══════════════════════════════════════════════════════════════
    function MediumModuleCard({ moduleKey, primaryMetric }) {
        const mod = WIDGET_MODULES[moduleKey];
        if (!mod) return null;

        // Custom renderers for non-KPI modules
        if (moduleKey === 'league-standings') return renderStandings('md');
        if (moduleKey === 'transaction-ticker') return renderTransactionTicker('md');
        if (moduleKey === 'intel-brief') return renderIntelligenceBrief('md');
        if (moduleKey === 'field-notes') return renderFieldNotes('md');

        const key = primaryMetric || mod.metrics?.[0]?.key;
        if (!key) return null;
        const val = kv(key);
        const ann = typeof getKpiAnnotation === 'function' ? getKpiAnnotation(key, val.value) : '';
        const metaLabel = mod.metrics.find(m => m.key === key)?.label || key;

        // Secondary metrics for context
        const secondary = mod.metrics.filter(m => m.key !== key).slice(0, 2).map(m => ({ ...m, val: kv(m.key) }));

        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ fontFamily: rajFont, fontSize: '0.85rem', fontWeight: 700, color: mod.accent, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                        {mod.icon} {mod.label}
                    </div>
                    <div style={{ fontSize: '0.65rem', color: S, opacity: 0.5, fontFamily: dmFont }}>{metaLabel}</div>
                </div>

                {/* Primary stat row */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
                    <span style={{ fontFamily: monoFont, fontSize: '1.8rem', fontWeight: 700, color: val.color || W, lineHeight: 1 }}>{val.value}</span>
                    {trendArrow(val.sparkData, val.color)}
                    {percentileBadge(val.value, mod.accent)}
                </div>

                {/* Sparkline */}
                {typeof Sparkline !== 'undefined' && val.sparkData && val.sparkData.length > 2 && (
                    <div style={{ marginBottom: '6px' }}>
                        {React.createElement(Sparkline, { data: val.sparkData, width: 200, height: 28, color: val.color || mod.accent })}
                    </div>
                )}

                {/* Insight / annotation */}
                {ann && (
                    <div style={{ fontSize: '0.72rem', color: G, fontFamily: dmFont, fontWeight: 600, lineHeight: 1.4, marginBottom: '8px' }}>{ann}</div>
                )}
                {!ann && val.sub && (
                    <div style={{ fontSize: '0.72rem', color: S, fontFamily: dmFont, opacity: 0.75, lineHeight: 1.4, marginBottom: '8px' }}>{val.sub}</div>
                )}

                {/* Secondary metrics */}
                {secondary.length > 0 && (
                    <div style={{ display: 'flex', gap: '12px', marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                        {secondary.map(s => (
                            <div key={s.key}>
                                <div style={{ fontSize: '0.6rem', color: S, opacity: 0.6, fontFamily: dmFont, marginBottom: '1px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
                                <div style={{ fontFamily: monoFont, fontSize: '0.85rem', fontWeight: 600, color: s.val.color || W }}>{s.val.value}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // LARGE CARD — 2×2 — mini-panel with multiple stats + list
    // ══════════════════════════════════════════════════════════════
    function LargeModuleCard({ moduleKey, primaryMetric }) {
        const mod = WIDGET_MODULES[moduleKey];
        if (!mod) return null;

        if (moduleKey === 'league-standings') return renderStandings('lg');
        if (moduleKey === 'transaction-ticker') return renderTransactionTicker('lg');
        if (moduleKey === 'intel-brief') return renderIntelligenceBrief('lg');
        if (moduleKey === 'field-notes') return renderFieldNotes('lg');

        const allMetrics = mod.metrics.map(m => ({ ...m, val: kv(m.key) }));
        const primaryKey = primaryMetric || mod.metrics?.[0]?.key;
        const primaryVal = kv(primaryKey);
        const ann = typeof getKpiAnnotation === 'function' ? getKpiAnnotation(primaryKey, primaryVal.value) : '';

        // League context for bar chart — find roster DHQ for comparison
        const allDHQs = (() => {
            const LI = window.App?.LI || {};
            const scores = LI.playerScores || {};
            return (currentLeague?.rosters || []).map(r => ({
                rid: r.roster_id,
                dhq: (r.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0),
                isMe: r.owner_id === sleeperUserId,
            })).sort((a, b) => b.dhq - a.dhq);
        })();
        const maxDHQ = allDHQs[0]?.dhq || 1;

        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '1.1rem' }}>{mod.icon}</span>
                    <span style={{ fontFamily: rajFont, fontSize: '1rem', fontWeight: 700, color: mod.accent, letterSpacing: '0.07em', textTransform: 'uppercase' }}>{mod.label}</span>
                </div>

                {/* Primary stat hero */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontFamily: monoFont, fontSize: '2rem', fontWeight: 700, color: primaryVal.color || W, lineHeight: 1 }}>{primaryVal.value}</span>
                    {trendArrow(primaryVal.sparkData, primaryVal.color)}
                    {percentileBadge(primaryVal.value, mod.accent)}
                </div>
                {ann && <div style={{ fontSize: '0.72rem', color: G, fontFamily: dmFont, fontWeight: 600, lineHeight: 1.4, marginBottom: '10px' }}>{ann}</div>}

                {/* Stats grid */}
                {allMetrics.length > 1 && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px', marginBottom: '12px' }}>
                        {allMetrics.map(m => (
                            <div key={m.key} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '8px 10px' }}>
                                <div style={{ fontSize: '0.6rem', color: S, opacity: 0.6, fontFamily: dmFont, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>{m.label}</div>
                                <div style={{ fontFamily: monoFont, fontSize: '0.95rem', fontWeight: 600, color: m.val.color || W }}>{m.val.value}</div>
                                <div style={{ fontSize: '0.6rem', color: S, opacity: 0.5, fontFamily: dmFont, marginTop: '1px' }}>{m.val.sub}</div>
                            </div>
                        ))}
                    </div>
                )}

                {/* Mini bar chart: league DHQ comparison */}
                <div style={{ marginTop: 'auto' }}>
                    <div style={{ fontSize: '0.6rem', color: S, opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: dmFont, marginBottom: '6px' }}>League DHQ</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                        {allDHQs.slice(0, 6).map(t => (
                            <div key={t.rid} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <div style={{ flex: 1, height: '6px', background: 'rgba(255,255,255,0.06)', borderRadius: '3px', overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${(t.dhq / maxDHQ) * 100}%`, background: t.isMe ? mod.accent : 'rgba(255,255,255,0.2)', borderRadius: '3px', transition: 'width 0.3s' }} />
                                </div>
                                <div style={{ fontSize: '0.6rem', fontFamily: monoFont, color: t.isMe ? mod.accent : S, opacity: t.isMe ? 1 : 0.6, minWidth: '32px', textAlign: 'right' }}>{(t.dhq / 1000).toFixed(0)}k</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // INTELLIGENCE BRIEF — delegates to window.IntelligenceBriefWidget
    // defined in js/tabs/flash-brief.js
    // ══════════════════════════════════════════════════════════════
    function renderIntelligenceBrief(size) {
        if (typeof window.IntelligenceBriefWidget !== 'function') {
            return <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)' }}>Intelligence brief unavailable</div>;
        }
        return React.createElement(window.IntelligenceBriefWidget, {
            size,
            myRoster,
            rankedTeams,
            sleeperUserId,
            currentLeague,
            briefDraftInfo,
            playersData,
            setActiveTab,
            navigateWidget,
        });
    }

    // ══════════════════════════════════════════════════════════════
    // FIELD NOTES — delegates to window.FieldNotesWidget
    // defined in js/tabs/flash-brief.js
    // ══════════════════════════════════════════════════════════════
    function renderFieldNotes(size) {
        if (typeof window.FieldNotesWidget !== 'function') {
            return <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)' }}>Field notes unavailable</div>;
        }
        return React.createElement(window.FieldNotesWidget, { size, navigateWidget });
    }

    // ══════════════════════════════════════════════════════════════
    // TRANSACTION TICKER
    // ══════════════════════════════════════════════════════════════
    function renderTransactionTicker(size) {
        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', maxHeight: size === 'lg' ? '100%' : '300px', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontFamily: rajFont, fontSize: '0.9rem', fontWeight: 700, color: '#34D399', letterSpacing: '0.07em', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    📰 TRANSACTION TICKER
                </div>
                {(!transactions || transactions.length === 0) ? (
                    <SkeletonRows count={6} />
                ) : transactions.map((txn, ti) => (
                    <div key={ti} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '0.65rem', color: S, opacity: 0.55, minWidth: '36px' }}>{timeAgo(txn.created)}</span>
                            <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '1px 5px', borderRadius: '3px',
                                background: txn.type === 'trade' ? 'rgba(212,175,55,0.15)' : txn.type === 'waiver' ? 'rgba(52,211,153,0.15)' : 'rgba(96,165,250,0.15)',
                                color: txn.type === 'trade' ? G : txn.type === 'waiver' ? '#34d399' : '#60a5fa',
                            }}>{(txn.type === 'free_agent' ? 'FA' : txn.type || '').toUpperCase()}</span>
                            <span style={{ fontSize: '0.65rem', color: S }}>{getOwnerName(txn.roster_ids?.[0])}</span>
                            {txn.type === 'trade' && txn.roster_ids?.[1] && (
                                <span style={{ fontSize: '0.65rem', color: S, opacity: 0.6 }}>↔ {getOwnerName(txn.roster_ids[1])}</span>
                            )}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: W, paddingLeft: '42px' }}>
                            {Object.keys(txn.adds || {}).map(pid => (
                                <span key={'a'+pid} style={{ color: '#2ECC71', cursor: 'pointer', marginRight: '5px' }}
                                    onClick={() => window._wrSelectPlayer?.(pid)}>
                                    +{getPlayerName(pid)}
                                </span>
                            ))}
                            {Object.keys(txn.drops || {}).map(pid => (
                                <span key={'d'+pid} style={{ color: '#E74C3C', marginRight: '5px' }}>-{getPlayerName(pid)}</span>
                            ))}
                            {txn.settings?.waiver_bid > 0 && <span style={{ color: '#F0A500', marginLeft: '2px' }}>${txn.settings.waiver_bid}</span>}
                            {txn.type === 'trade' && txn.draft_picks?.length > 0 && (
                                <span style={{ color: G, fontSize: '0.72rem', marginLeft: '4px' }}>+{txn.draft_picks.length} pick{txn.draft_picks.length !== 1 ? 's' : ''}</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // LEAGUE STANDINGS
    // ══════════════════════════════════════════════════════════════
    function renderStandings(size) {
        const isOffseason = currentLeague?.status === 'complete' || currentLeague?.status === 'pre_draft';
        const divisions = {};
        (standings || []).forEach(t => { const div = t.division || 0; if (!divisions[div]) divisions[div] = []; divisions[div].push(t); });
        const divKeys = Object.keys(divisions).sort((a, b) => a - b);
        const hasDivisions = divKeys.length > 1;
        const divNameMap = {};
        if (hasDivisions && currentLeague?.metadata) {
            divKeys.forEach(dk => { divNameMap[dk] = currentLeague.metadata['division_' + dk + '_name'] || currentLeague.metadata['division_' + dk] || ('Division ' + dk); });
        }
        const isCompact = size === 'md';

        return (
            <div style={{ ...cardBase, padding: 'var(--card-pad, 14px 16px)', overflowY: 'auto' }}>
                <div style={{ fontFamily: rajFont, fontSize: '0.9rem', fontWeight: 700, color: G, letterSpacing: '0.07em', marginBottom: '10px' }}>📊 LEAGUE STANDINGS</div>
                {divKeys.map(divKey => (
                    <div key={divKey} style={{ marginBottom: hasDivisions ? '14px' : 0 }}>
                        {hasDivisions && <div style={{ fontFamily: dmFont, fontSize: '0.68rem', color: G, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '6px', paddingBottom: '3px', borderBottom: '1px solid rgba(212,175,55,0.15)' }}>{divNameMap[divKey]}</div>}
                        <div style={{ display: 'grid', gridTemplateColumns: isCompact ? '16px 1fr 44px 50px' : '16px 24px 1fr 44px 44px 50px', gap: '4px', padding: '3px 6px', fontSize: '0.65rem', fontWeight: 700, color: G, fontFamily: dmFont, textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid rgba(212,175,55,0.12)' }}>
                            <span>#</span>
                            {!isCompact && <span/>}
                            <span>Team</span>
                            <span style={{ textAlign: 'right' }}>{isOffseason ? 'HP' : 'W-L'}</span>
                            {!isCompact && <span style={{ textAlign: 'right' }}>PF</span>}
                            <span style={{ textAlign: 'right' }}>DHQ</span>
                        </div>
                        {divisions[divKey].sort((a, b) => {
                            if (isOffseason) {
                                const ra = currentLeague?.rosters?.find(r => r.owner_id === a.userId);
                                const rb = currentLeague?.rosters?.find(r => r.owner_id === b.userId);
                                const ha = window.assessTeamFromGlobal?.(ra?.roster_id)?.healthScore || 0;
                                const hb = window.assessTeamFromGlobal?.(rb?.roster_id)?.healthScore || 0;
                                return hb !== ha ? hb - ha : b.pointsFor - a.pointsFor;
                            }
                            if (b.wins !== a.wins) return b.wins - a.wins;
                            if (a.losses !== b.losses) return a.losses - b.losses;
                            return b.pointsFor - a.pointsFor;
                        }).map((team, idx) => {
                            const isMe = team.userId === sleeperUserId;
                            const roster = currentLeague?.rosters?.find(r => r.owner_id === team.userId);
                            const totalDHQ = roster?.players?.reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0) || 0;
                            const user = (currentLeague?.users || []).find(u => u.user_id === team.userId);
                            const avatarId = user?.avatar;
                            const avatarUrl = avatarId ? `https://sleepercdn.com/avatars/thumbs/${avatarId}` : null;
                            const hs = isOffseason ? (window.assessTeamFromGlobal?.(roster?.roster_id)?.healthScore || 0) : 0;
                            return (
                                <div key={team.rosterId} style={{
                                    display: 'grid', gridTemplateColumns: isCompact ? '16px 1fr 44px 50px' : '16px 24px 1fr 44px 44px 50px', gap: '4px',
                                    padding: '5px 6px', borderBottom: '1px solid rgba(255,255,255,0.04)',
                                    background: isMe ? 'rgba(212,175,55,0.07)' : 'transparent',
                                    fontSize: '0.7rem', alignItems: 'center',
                                }}>
                                    <span style={{ fontFamily: rajFont, fontSize: '0.85rem', color: idx === 0 ? '#D4AF37' : idx === 1 ? '#C0C0C0' : idx === 2 ? '#CD7F32' : S }}>{idx + 1}</span>
                                    {!isCompact && (
                                        <div style={{ width: 22, height: 22 }}>
                                            {avatarUrl
                                                ? <img src={avatarUrl} alt="" style={{ width: 22, height: 22, borderRadius: '50%', objectFit: 'cover', border: isMe ? '1.5px solid var(--gold)' : '1px solid rgba(255,255,255,0.1)' }} />
                                                : <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.62rem', color: S }}>{(team.displayName || '?').charAt(0).toUpperCase()}</div>
                                            }
                                        </div>
                                    )}
                                    <div style={{ overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', fontWeight: isMe ? 700 : 400, color: isMe ? G : W }}>
                                        {isCompact ? team.displayName : (team.teamName ? `${team.teamName} (${team.displayName})` : team.displayName)}
                                        {isMe && <span style={{ fontSize: '0.6rem', color: G, marginLeft: '3px' }}>YOU</span>}
                                    </div>
                                    <span style={{ textAlign: 'right', fontFamily: dmFont, fontWeight: 600, color: W, fontSize: '0.7rem' }}>{isOffseason ? (hs > 0 ? hs.toFixed(0) : '—') : `${team.wins}-${team.losses}`}</span>
                                    {!isCompact && <span style={{ textAlign: 'right', fontSize: '0.68rem', color: S }}>{team.pointsFor > 0 ? team.pointsFor.toFixed(0) : '—'}</span>}
                                    <span style={{ textAlign: 'right', fontSize: '0.68rem', fontFamily: dmFont, color: totalDHQ >= 80000 ? '#2ECC71' : totalDHQ >= 50000 ? G : S }}>{totalDHQ > 0 ? (totalDHQ / 1000).toFixed(0) + 'k' : '—'}</span>
                                </div>
                            );
                        })}
                    </div>
                ))}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // WIDGET SHELL — wrapper with gear button + drag handle
    // ══════════════════════════════════════════════════════════════
    function WidgetShell({ widget, idx, children }) {
        const [showGear, setShowGear] = React.useState(false);
        const sizeSpan = { sm: 'span 1', slim: 'span 1', narrow: 'span 1', md: 'span 2', lg: 'span 2', tall: 'span 2', xl: 'span 4', xxl: 'span 4' };
        const rowSpan = { sm: 'span 1', slim: 'span 2', narrow: 'span 4', md: 'span 1', lg: 'span 2', tall: 'span 4', xl: 'span 2', xxl: 'span 4' };

        return (
            <div
                className="wr-widget"
                draggable
                onDragStart={e => { setDragIdx(idx); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(idx)); }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                    e.preventDefault();
                    if (dragIdx === null || dragIdx === idx) return;
                    const updated = [...selectedWidgets];
                    const [moved] = updated.splice(dragIdx, 1);
                    updated.splice(idx, 0, moved);
                    setSelectedWidgets(updated);
                    setDragIdx(null);
                }}
                onMouseEnter={() => setShowGear(true)}
                onMouseLeave={() => setShowGear(false)}
                style={{
                    gridColumn: sizeSpan[widget.size] || 'span 1',
                    gridRow: rowSpan[widget.size] || 'span 1',
                    position: 'relative',
                    opacity: dragIdx === idx ? 0.4 : 1,
                    transition: theme.effects?.transition || 'opacity 0.15s',
                    minHeight: widget.size === 'sm' ? '160px' : undefined,
                }}
            >
                {children}

                {/* Gear button */}
                {showGear && (
                    <button
                        onClick={e => { e.stopPropagation(); setEditingWidget({ widget, idx }); setPickerOpen(true); }}
                        title="Widget settings"
                        style={{
                            position: 'absolute', top: '6px', right: '6px',
                            width: '22px', height: '22px', borderRadius: '50%',
                            border: '1px solid rgba(255,255,255,0.15)',
                            background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(4px)',
                            color: S, cursor: 'pointer', fontSize: '0.7rem',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            zIndex: 5, transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(212,175,55,0.2)'; e.currentTarget.style.color = G; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(10,10,10,0.85)'; e.currentTarget.style.color = S; }}
                    >⚙</button>
                )}

                {/* Remove button */}
                {showGear && (
                    <button
                        onClick={e => { e.stopPropagation(); setSelectedWidgets(selectedWidgets.filter((_, i) => i !== idx)); }}
                        title="Remove widget"
                        style={{
                            position: 'absolute', top: '6px', right: '32px',
                            width: '22px', height: '22px', borderRadius: '50%',
                            border: '1px solid rgba(255,255,255,0.15)',
                            background: 'rgba(10,10,10,0.85)', backdropFilter: 'blur(4px)',
                            color: S, cursor: 'pointer', fontSize: '0.7rem',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            zIndex: 5, transition: 'all 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(231,76,60,0.2)'; e.currentTarget.style.color = '#E74C3C'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(10,10,10,0.85)'; e.currentTarget.style.color = S; }}
                    >✕</button>
                )}
            </div>
        );
    }

    // ── Render a single widget based on module + size ──
    function renderWidget(widget, idx) {
        if (!widget?.key) return null;
        const { key, size, primaryMetric } = widget;

        // Navigate on click for SM widgets
        // v2 click targets use the module's clickTarget map; fall back to legacy
        const mod = WIDGET_MODULES[key];
        const clickTab = resolveWidgetDestination(mod?.clickTarget?.[size] || mod?.clickTarget?.sm || null);

        // ── Delegate to module-specific external widgets if available ──
        const externalWidget = resolveExternalWidget(key, size, primaryMetric);
        if (externalWidget !== null) {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    {externalWidget}
                </WidgetShell>
            );
        }

        // ── Fallback: generic KPI renderers for modules with metrics ──
        if (size === 'sm') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <div onClick={() => clickTab && navigateWidget(clickTab)} style={{ cursor: clickTab ? 'pointer' : 'default', height: '100%' }}>
                        <SmallKpiCard kpiKey={key} primaryMetric={primaryMetric} />
                    </div>
                </WidgetShell>
            );
        }
        if (size === 'md') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <MediumModuleCard moduleKey={key} primaryMetric={primaryMetric} />
                </WidgetShell>
            );
        }
        if (size === 'lg' || size === 'tall') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <LargeModuleCard moduleKey={key} primaryMetric={primaryMetric} />
                </WidgetShell>
            );
        }
        if (size === 'xl' || size === 'xxl') {
            return (
                <WidgetShell key={widget.id || key + idx} widget={widget} idx={idx}>
                    <LargeModuleCard moduleKey={key} primaryMetric={primaryMetric} />
                </WidgetShell>
            );
        }
        return null;
    }

    // ── External widget resolver ─────────────────────────────────
    // Each module can have an external widget component (loaded via
    // <script> tags). If one exists, it takes priority over the
    // generic KPI renderers.
    function resolveExternalWidget(moduleKey, size, primaryMetric) {
        // Intel Brief → IntelligenceBriefWidget (flash-brief.js)
        if (moduleKey === 'intel-brief') {
            return renderIntelligenceBrief(size);
        }
        // Field Notes → FieldNotesWidget (flash-brief.js)
        if (moduleKey === 'field-notes') {
            return renderFieldNotes(size);
        }
        // Roster Pulse → RosterPulseWidget (js/widgets/roster-pulse.js)
        if (moduleKey === 'roster-pulse' && typeof window.RosterPulseWidget === 'function') {
            const RPW = window.RosterPulseWidget;
            return React.createElement(RPW, {
                size, primaryMetric, myRoster, rankedTeams, sleeperUserId, currentLeague,
                playersData, computeKpiValue, setActiveTab, navigateWidget,
            });
        }
        // League Landscape → LeagueLandscapeWidget (js/widgets/league-landscape.js)
        if (moduleKey === 'league-landscape' && typeof window.LeagueLandscapeWidget === 'function') {
            const LLW = window.LeagueLandscapeWidget;
            return React.createElement(LLW, {
                size, standings, transactions, rankedTeams, sleeperUserId,
                currentLeague, playersData, setActiveTab, getOwnerName, getPlayerName, timeAgo,
                navigateWidget,
            });
        }
        // Market Radar → MarketRadarWidget (js/widgets/market-radar.js)
        if (moduleKey === 'market-radar' && typeof window.MarketRadarWidget === 'function') {
            const MRW = window.MarketRadarWidget;
            return React.createElement(MRW, {
                size, myRoster, rankedTeams, sleeperUserId, currentLeague,
                playersData, setActiveTab, navigateWidget,
            });
        }
        // Draft Capital → DraftCapitalWidget (js/widgets/draft-capital.js)
        if (moduleKey === 'draft-capital' && typeof window.DraftCapitalWidget === 'function') {
            const DCW = window.DraftCapitalWidget;
            return React.createElement(DCW, {
                size, myRoster, currentLeague, playersData, briefDraftInfo,
                setActiveTab, navigateWidget,
            });
        }
        // Phase 3: Competitive Tiers widget (js/widgets/competitive-tiers.js)
        if (moduleKey === 'competitive-tiers' && typeof window.CompetitiveTiersWidget === 'function') {
            return React.createElement(window.CompetitiveTiersWidget, { size, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget });
        }
        // Phase 3: Power Rankings widget (js/widgets/power-rankings.js)
        if (moduleKey === 'power-rankings' && typeof window.PowerRankingsWidget === 'function') {
            return React.createElement(window.PowerRankingsWidget, { size, sleeperUserId, currentLeague, playersData, setActiveTab, navigateWidget });
        }
        // SI-3: Tag-driven widgets (js/widgets/player-tags.js)
        if (moduleKey === 'trade-block' && typeof window.TradeBlockWidget === 'function') {
            return React.createElement(window.TradeBlockWidget, { size, playersData, setActiveTab, navigateWidget });
        }
        if (moduleKey === 'cut-candidates' && typeof window.CutCandidatesWidget === 'function') {
            return React.createElement(window.CutCandidatesWidget, { size, playersData, setActiveTab, navigateWidget });
        }
        if (moduleKey === 'waiver-targets' && typeof window.WaiverTargetsWidget === 'function') {
            return React.createElement(window.WaiverTargetsWidget, { size, playersData, setActiveTab, navigateWidget });
        }
        // Phase 9: My Trophies widget
        if (moduleKey === 'my-trophies' && typeof window.MyTrophiesWidget === 'function') {
            return React.createElement(window.MyTrophiesWidget, { size, myRoster, currentLeague, setActiveTab, navigateWidget });
        }
        // No external widget — fall through to generic renderers
        return null;
    }

    // ══════════════════════════════════════════════════════════════
    // PINNED SECTION — starred items
    // ══════════════════════════════════════════════════════════════
    function PinnedSection() {
        if (starredWidgets.length === 0) return null;
        return (
            <div style={{ padding: '0 20px 20px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', paddingTop: '16px', borderTop: '1px solid rgba(212,175,55,0.12)' }}>
                    <span style={{ color: G, fontSize: '0.85rem' }}>★</span>
                    <span style={{ fontFamily: rajFont, fontSize: '0.85rem', fontWeight: 700, color: G, letterSpacing: '0.08em' }}>PINNED</span>
                    <span style={{ fontSize: '0.65rem', color: S, opacity: 0.5, fontFamily: dmFont }}>Starred from across the app</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                    {starredWidgets.map(item => (
                        <div key={item.id} style={{ background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '10px', padding: '12px 14px', position: 'relative' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px', marginBottom: '6px' }}>
                                <div style={{ fontFamily: dmFont, fontSize: '0.75rem', fontWeight: 600, color: W, lineHeight: 1.3 }}>{item.title}</div>
                                <button onClick={() => window.WrStarWidget?.remove(item.id)} title="Unpin" style={{ background: 'none', border: 'none', cursor: 'pointer', color: G, fontSize: '0.8rem', flexShrink: 0, padding: 0, lineHeight: 1 }}>★</button>
                            </div>
                            {item.content && <div style={{ fontSize: '0.68rem', color: S, fontFamily: dmFont, opacity: 0.75, lineHeight: 1.4 }}>{item.content}</div>}
                            {item.sourceModule && <div style={{ fontSize: '0.6rem', color: S, opacity: 0.4, fontFamily: dmFont, marginTop: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.sourceModule}</div>}
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    // ── First-visit customization hint ──
    const HINT_KEY = 'wr_dashboard_hint_dismissed';
    const [showHint, setShowHint] = React.useState(() => {
        try { return !localStorage.getItem(HINT_KEY); } catch { return true; }
    });
    const dismissHint = () => {
        setShowHint(false);
        try { localStorage.setItem(HINT_KEY, '1'); } catch {}
    };

    // ══════════════════════════════════════════════════════════════
    // MAIN RENDER
    // ══════════════════════════════════════════════════════════════
    return (
        <React.Fragment>
            {/* First-visit hint */}
            {showHint && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '12px',
                    padding: '12px 20px',
                    background: 'linear-gradient(90deg, rgba(212,175,55,0.1), rgba(212,175,55,0.02))',
                    borderBottom: '1px solid rgba(212,175,55,0.2)',
                    fontFamily: dmFont, fontSize: '0.78rem', color: S,
                }}>
                    <span style={{ fontSize: '1.1rem' }}>✨</span>
                    <div style={{ flex: 1, lineHeight: 1.5 }}>
                        <strong style={{ color: G }}>This dashboard is yours to customize.</strong>
                        {' '}Hover any widget to resize or remove it. Drag to reorder. Click <strong>+ Add Widget</strong> to build your layout.
                    </div>
                    <button onClick={dismissHint} style={{
                        padding: '5px 14px', fontSize: '0.72rem', fontFamily: dmFont, fontWeight: 600,
                        background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.3)',
                        borderRadius: '5px', color: G, cursor: 'pointer', flexShrink: 0,
                    }}>Got it</button>
                </div>
            )}

            <style>{`
                @media(max-width:767px){
                    .wr-dashboard-grid{
                        grid-template-columns:minmax(0,1fr) !important;
                        grid-auto-rows:minmax(160px,auto) !important;
                        padding:12px !important;
                        gap:10px !important;
                        overflow-x:hidden;
                    }
                    .wr-dashboard-grid>.wr-widget{
                        grid-column:1 / -1 !important;
                        grid-row:auto !important;
                        min-width:0;
                    }
                    .wr-dashboard-grid>.wr-add-widget{
                        grid-column:1 / -1 !important;
                    }
                }
                @media(min-width:768px) and (max-width:1023px){
                    .wr-dashboard-grid{
                        grid-template-columns:repeat(2,minmax(140px,1fr)) !important;
                    }
                    .wr-dashboard-grid>.wr-widget{
                        min-width:0;
                    }
                    .wr-dashboard-grid>.wr-widget[style*="span 4"]{
                        grid-column:span 2 !important;
                    }
                }
            `}</style>

            {/* Widget grid */}
            <div className="wr-dashboard-grid" style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(140px, 1fr))',
                gridAutoRows: '160px',
                gap: '12px',
                padding: '16px 20px',
                background: BK,
                borderBottom: '1px solid ' + (theme.colors?.border || 'rgba(212,175,55,0.12)'),
            }}>
                {widgets.map((widget, idx) => renderWidget(widget, idx))}

                {/* Add widget button */}
                <div
                    className="wr-add-widget"
                    onClick={() => { setEditingWidget(null); setPickerOpen(true); }}
                    style={{
                        gridColumn: 'span 1', gridRow: 'span 1',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '6px',
                        border: '1px dashed rgba(212,175,55,0.25)', borderRadius: '10px',
                        cursor: 'pointer', minHeight: '160px',
                        transition: 'all 0.15s', color: 'rgba(212,175,55,0.35)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.5)'; e.currentTarget.style.color = 'rgba(212,175,55,0.6)'; e.currentTarget.style.background = 'rgba(212,175,55,0.04)'; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(212,175,55,0.25)'; e.currentTarget.style.color = 'rgba(212,175,55,0.35)'; e.currentTarget.style.background = 'transparent'; }}
                >
                    <span style={{ fontSize: '1.4rem', lineHeight: 1 }}>+</span>
                    <span style={{ fontSize: '0.65rem', fontFamily: dmFont, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Add Widget</span>
                </div>
            </div>

            {/* Pinned / starred section */}
            <PinnedSection />

            {/* Full-screen widget picker overlay */}
            {pickerOpen && (
                <DashboardWidgetPicker
                    editWidget={editingWidget?.widget || null}
                    onClose={() => { setPickerOpen(false); setEditingWidget(null); }}
                    onAdd={newWidget => {
                        if (editingWidget !== null) {
                            const updated = [...selectedWidgets];
                            updated[editingWidget.idx] = { ...newWidget, id: editingWidget.widget?.id || newWidget.id };
                            setSelectedWidgets(updated);
                        } else {
                            setSelectedWidgets([...selectedWidgets, newWidget]);
                        }
                    }}
                />
            )}

        </React.Fragment>
    );
}

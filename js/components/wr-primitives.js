// ══════════════════════════════════════════════════════════════════
// js/components/wr-primitives.js — Shared visual primitives
//
// Ports the design language from the Sharp-Terminal mocks into a
// reusable set of components. Every surface that currently rolls its
// own card / badge / chip / delta syntax should migrate to these.
//
// Exposes on window.WR:
//   WR.Card        — standard card wrapper (solid bg, border, radius, padding)
//   WR.Kpi         — KPI tile (label, value, tone, delta/sub sub-line)
//   WR.Badge       — position/type/severity badge with kind→color table
//   WR.Chip        — priority chip (high|medium|low) with label override
//   WR.ConfChip    — AI-confidence chip (auto-classifies pct → HIGH/MED/LOW)
//   WR.DeltaLine   — "↑ +4.1%" / "↓ 2000 → 1850" delta renderer
//   WR.InsightCard — severity-tagged behavioral card with CTA
//
// Depends on: React (loaded globally).
// ══════════════════════════════════════════════════════════════════

(function () {
    const h = React.createElement;

    // ── Token tables ──────────────────────────────────────────────
    const KIND_COLORS = {
        // positions
        qb: 'var(--k-60a5fa, #60a5fa)', rb: 'var(--k-2ecc71, #2ecc71)', wr: 'var(--k-d4af37, #d4af37)', te: 'var(--k-fbbf24, #fbbf24)',
        k: 'var(--k-a8acb8, #a8acb8)', dl: 'var(--k-fb923c, #fb923c)', lb: 'var(--k-a78bfa, #a78bfa)', db: 'var(--k-f472b6, #f472b6)',
        def: 'var(--k-f87171, #f87171)',
        // transaction / event types
        trade: 'var(--k-9b8afb, #9b8afb)', waiver: 'var(--k-2ecc71, #2ecc71)', fa: 'var(--k-3498db, #3498db)',
        injury: 'var(--k-e74c3c, #e74c3c)', news: 'var(--k-d0d0d0, #d0d0d0)', draft: 'var(--k-f0a500, #f0a500)',
        // fallback / neutral
        neutral: 'var(--k-d0d0d0, #d0d0d0)',
    };

    const SEVERITY = {
        warning:     { color: 'var(--k-e74c3c, #e74c3c)', icon: '\u26A0',  label: 'WARNING' },
        edge:        { color: 'var(--k-2ecc71, #2ecc71)', icon: '\u25CE',  label: 'EDGE' },
        pattern:     { color: 'var(--k-f0a500, #f0a500)', icon: '\u3030',  label: 'PATTERN' },
        opportunity: { color: 'var(--k-3498db, #3498db)', icon: '\uD83D\uDCA1', label: 'OPPORTUNITY' },
    };

    // ── Card ──────────────────────────────────────────────────────
    // Standard solid-bg card — replaces the murky rgba(255,255,255,0.0X)
    // card backgrounds scattered across surfaces.
    function Card({ children, padding, style, accent, onClick, ...rest }) {
        const css = {
            background: 'var(--off-black, var(--k-1a1a1a, #1a1a1a))',
            border: accent ? ('1px solid ' + accent + '33') : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
            borderRadius: '10px',
            padding: padding || '14px 16px',
            transition: 'background 0.15s',
            cursor: onClick ? 'pointer' : 'default',
            ...style,
        };
        return h('div', { style: css, onClick, ...rest }, children);
    }

    // ── Badge ─────────────────────────────────────────────────────
    // Compact label tag. `kind` maps to a semantic color via KIND_COLORS.
    function Badge({ label, kind, size }) {
        const color = KIND_COLORS[(kind || '').toLowerCase()] || KIND_COLORS.neutral;
        const s = size === 'sm' ? { fs: '0.56rem', pad: '1px 6px' } : { fs: '0.62rem', pad: '2px 7px' };
        return h('span', {
            style: {
                display: 'inline-flex', alignItems: 'center',
                fontSize: s.fs, fontWeight: 700,
                padding: s.pad, borderRadius: '3px',
                background: wrAlpha(color, '22'), color: color,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                fontFamily: 'JetBrains Mono, monospace',
                whiteSpace: 'nowrap',
            }
        }, label);
    }

    // ── Chip (priority / generic pill) ────────────────────────────
    function Chip({ level, label }) {
        const tbl = {
            high:   { c: 'var(--k-e74c3c, #e74c3c)', l: label || 'HIGH' },
            medium: { c: 'var(--k-f0a500, #f0a500)', l: label || 'MEDIUM' },
            low:    { c: 'var(--k-d0d0d0, #d0d0d0)', l: label || 'LOW' },
        };
        const t = tbl[(level || 'medium').toLowerCase()] || tbl.medium;
        return h('span', {
            style: {
                display: 'inline-flex', alignItems: 'center',
                fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700,
                padding: '1px 7px', borderRadius: '10px',
                background: wrAlpha(t.c, '22'), color: t.c,
                border: '1px solid ' + wrAlpha(t.c, '4d'),
                letterSpacing: '0.08em',
                fontFamily: 'JetBrains Mono, monospace',
            }
        }, t.l);
    }

    // ── ConfChip (AI confidence %) ────────────────────────────────
    // Auto-classifies: ≥80 → HIGH/green, ≥55 → MED/amber, else LOW/silver.
    function ConfChip({ pct, compact }) {
        const n = Math.max(0, Math.min(100, Math.round(pct || 0)));
        const level = n >= 80 ? 'hi' : n >= 55 ? 'med' : 'lo';
        const tbl = {
            hi:  { c: 'var(--k-2ecc71, #2ecc71)', label: 'HIGH' },
            med: { c: 'var(--k-f0a500, #f0a500)', label: 'MEDIUM' },
            lo:  { c: 'var(--k-d0d0d0, #d0d0d0)', label: 'LOW' },
        };
        const t = tbl[level];
        const text = compact ? (n + '%') : (n + '% \u00B7 ' + t.label);
        return h('span', {
            style: {
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 'var(--text-label, 0.75rem)', letterSpacing: '0.08em',
                padding: '1px 7px', borderRadius: '10px',
                background: wrAlpha(t.c, '26'), color: t.c,
                border: '1px solid ' + wrAlpha(t.c, '4d'),
                fontWeight: 600,
            }
        }, text);
    }

    // ── DeltaLine ─────────────────────────────────────────────────
    // Renders a change: "↑ +4.1%", "↓ 2000 → 1850", "↗ Bills +4.5 → +3".
    // Self-hides (returns null) when there's no actual change to show.
    //   direction: 'up'|'down'|'flat' — optional; inferred from from/to.
    //   from, to: numeric endpoints. If both set, renders "from → to".
    //   magnitude: pre-formatted string (used when endpoints don't apply).
    //   subject: optional prefix label.
    //   unit: optional suffix (e.g. "%", "DHQ", "pts").
    function DeltaLine({ direction, subject, from, to, magnitude, unit, style }) {
        let dir = direction;
        if (!dir && from != null && to != null) {
            dir = from < to ? 'up' : from > to ? 'down' : 'flat';
        }
        // Nothing to render — silent self-hide prevents empty chrome.
        if (from == null && to == null && magnitude == null) return null;
        const color = dir === 'up' ? 'var(--good)' : dir === 'down' ? 'var(--bad)' : 'var(--silver)';
        const arrow = dir === 'up' ? '\u2191' : dir === 'down' ? '\u2193' : '\u2192';
        const body = magnitude != null
            ? String(magnitude)
            : ((subject ? subject + ' ' : '') + from + ' \u2192 ' + to + (unit ? ' ' + unit : ''));
        return h('span', {
            style: {
                display: 'inline-flex', alignItems: 'center', gap: '4px',
                fontSize: 'var(--text-label, 0.75rem)', color: color,
                fontFamily: 'JetBrains Mono, monospace',
                ...style,
            }
        }, h('span', null, arrow), h('span', null, body));
    }

    // ── KPI tile ──────────────────────────────────────────────────
    // Large-number tile with label, value, and either a DeltaLine
    // (preferred) or a static sub string underneath.
    //   tone: 'win'|'loss'|'gold'|'mute'|'plain'
    function Kpi({ label, value, sub, tone, delta, onClick }) {
        const valColor = tone === 'win' ? 'var(--k-2ecc71, #2ecc71)'
                       : tone === 'loss' ? 'var(--k-e74c3c, #e74c3c)'
                       : tone === 'gold' ? 'var(--k-d4af37, #d4af37)'
                       : tone === 'mute' ? 'var(--k-d0d0d0, #d0d0d0)'
                       : 'var(--white)';
        const deltaEl = delta ? h(DeltaLine, delta) : null;
        const subEl = !deltaEl && sub
            ? h('div', { style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '6px', fontFamily: 'JetBrains Mono, monospace' } }, sub)
            : null;
        return h(Card, { padding: '14px 16px', onClick },
            h('div', {
                style: { fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, marginBottom: '8px' }
            }, label),
            h('div', {
                style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.85rem', fontWeight: 700, lineHeight: 1, color: valColor, letterSpacing: 0 }
            }, value != null && value !== '' ? value : '\u2014'),
            deltaEl
                ? h('div', { style: { marginTop: '6px' } }, deltaEl)
                : subEl
        );
    }

    // ── InsightCard ───────────────────────────────────────────────
    // Severity-tagged behavioral insight. The flagship pattern from the
    // Sharp-Terminal mock — mirrored here so any surface (Home widget,
    // Alex Insights tab, drawer) can render one identically.
    // Optional `feedback` prop wires the AI learning loop:
    //   { onUp, onDown, given } — given ('up'|'down') collapses the buttons.
    function InsightCard({ severity, confidence, title, body, ctaLabel, ctaOnClick, icon, compact, feedback }) {
        const s = SEVERITY[(severity || 'pattern').toLowerCase()] || SEVERITY.pattern;
        const color = s.color;
        const bg = wrAlpha(color, '1a');
        const border = wrAlpha(color, '59');
        const iconSize = compact ? 34 : 44;
        const titleSize = compact ? '0.88rem' : '1rem';
        const bodySize = compact ? '0.74rem' : '0.82rem';
        const pad = compact ? '14px 16px' : '18px 20px';
        return h('div', {
            style: {
                position: 'relative', overflow: 'hidden',
                display: 'grid', gridTemplateColumns: iconSize + 'px 1fr',
                gap: compact ? '12px' : '14px', alignItems: 'flex-start',
                background: 'var(--off-black, var(--k-1a1a1a, #1a1a1a))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))',
                borderRadius: '12px', padding: pad,
            }
        },
            h('div', { style: { position: 'absolute', inset: 0, pointerEvents: 'none', background: 'linear-gradient(135deg, ' + bg + ' 0%, transparent 55%)', opacity: 0.5, borderRadius: '12px' } }),
            h('div', {
                style: {
                    width: iconSize + 'px', height: iconSize + 'px', borderRadius: '10px', flexShrink: 0,
                    background: bg, border: '1px solid ' + border,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: compact ? '1rem' : '1.25rem', color: color,
                    position: 'relative', zIndex: 1,
                }
            }, icon || s.icon),
            h('div', { style: { position: 'relative', zIndex: 1, minWidth: 0 } },
                h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px', flexWrap: 'wrap' } },
                    h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', fontWeight: 700, color: color, letterSpacing: '0.12em', textTransform: 'uppercase' } }, s.label),
                    confidence != null && h('span', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, letterSpacing: '0.06em' } },
                        'CONF ',
                        h('strong', { style: { color: 'var(--silver)', opacity: 0.9, fontWeight: 700 } }, confidence + '%')
                    )
                ),
                h('h3', { style: { fontSize: titleSize, fontWeight: 700, color: 'var(--white)', lineHeight: 1.35, margin: '0 0 5px' } }, title),
                body && h('p', { style: { fontSize: bodySize, color: 'var(--silver)', opacity: 0.85, lineHeight: 1.55, margin: '0 0 ' + (ctaLabel ? '12px' : '0') } }, body),
                ctaLabel && h('button', {
                    onClick: ctaOnClick,
                    style: {
                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                        padding: '6px 12px', borderRadius: '5px', minHeight: '44px',
                        background: bg, border: '1px solid ' + border, color: color,
                        fontSize: 'var(--text-label, 0.75rem)', fontWeight: 600, cursor: 'pointer',
                        fontFamily: 'DM Sans, sans-serif',
                    }
                }, ctaLabel, h('span', { style: { fontSize: '1rem', lineHeight: 0.8 } }, '\u203A')),
                feedback && h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px' } },
                    feedback.given
                        ? h('span', { style: { fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.5 } }, 'Thanks \u2014 Alex learns from this.')
                        : [
                            h('span', { key: 'q', style: { fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.45 } }, 'Useful?'),
                            h('button', { key: 'up', onClick: feedback.onUp, style: { background: 'none', border: 'none', color: 'var(--silver)', opacity: 0.5, cursor: 'pointer', fontSize: '0.78rem', padding: '0 4px' } }, '\uD83D\uDC4D'),
                            h('button', { key: 'down', onClick: feedback.onDown, style: { background: 'none', border: 'none', color: 'var(--silver)', opacity: 0.5, cursor: 'pointer', fontSize: '0.78rem', padding: '0 4px' } }, '\uD83D\uDC4E'),
                        ]
                )
            )
        );
    }

    window.WR = window.WR || {};
    window.WR.Card = Card;
    window.WR.Badge = Badge;
    window.WR.Chip = Chip;
    window.WR.ConfChip = ConfChip;
    window.WR.DeltaLine = DeltaLine;
    window.WR.Kpi = Kpi;
    window.WR.InsightCard = InsightCard;
})();

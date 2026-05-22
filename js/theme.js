// ══════════════════════════════════════════════════════════════════
// js/theme.js — War Room Theme Engine
//
// Centralized theme system that replaces inline color/font literals
// throughout the dashboard. All widget components read from WrTheme
// instead of hardcoded values.
//
// Loads BEFORE any widget or dashboard script. Persists to localStorage.
// Coexists with themes.js (NFL team accent colors) — that system
// continues to set --gold/--silver CSS vars independently.
//
// Depends on: nothing (self-contained, runs first)
// Exposes:    window.WrTheme
// ══════════════════════════════════════════════════════════════════

(function() {
    'use strict';

    const LS_KEY = 'wr_dashboard_theme';
    const DYNAMIC_STYLE_ID = 'wr-theme-dynamic';

    // ── Theme definitions ─────────────────────────────────────────
    const THEMES = {
        default: {
            id: 'default',
            name: 'War Room',
            preview: '🏴',
            fonts: {
                display: 'Rajdhani, sans-serif',
                ui: "'DM Sans', sans-serif",
                mono: "'JetBrains Mono', monospace",
                sizeScale: 1.0,
            },
            colors: {
                bg:         '#08080B',
                card:       '#121217',
                cardHover:  'rgba(212,175,55,0.06)',
                accent:     '#D4AF37',
                accentDark: '#B8941E',
                text:       '#F5F2EA',
                textMuted:  '#BDB8AD',
                textFaint:  'rgba(189,184,173,0.62)',
                positive:   '#2ECC71',
                negative:   '#E74C3C',
                info:       '#5DADE2',
                warn:       '#F0A500',
                purple:     '#9B8AFB',
                border:     'rgba(212,175,55,0.2)',
                borderHover:'rgba(212,175,55,0.4)',
            },
            card: {
                background: '#121217',
                border:     '1px solid rgba(212,175,55,0.2)',
                borderHover:'1px solid rgba(212,175,55,0.4)',
                radius:     '10px',
                shadow:     'none',
                shadowHover:'0 4px 16px rgba(0,0,0,0.3)',
            },
            badge: {
                radius:     '10px',
                fontWeight:  700,
            },
            effects: {
                scanlines:   false,
                glow:        false,
                pixelate:    false,
                hoverScale:  1.0,
                transition:  '0.15s ease',
            },
        },

        // Tecmo Bowl + Madden 2005 themes parked for future rollout.
        // Infrastructure preserved — just add the objects back to re-enable.

        light: {
            id: 'light',
            name: 'Light Mode',
            preview: '☀️',
            fonts: {
                display: 'Rajdhani, sans-serif',
                ui: "'DM Sans', sans-serif",
                mono: "'JetBrains Mono', monospace",
                sizeScale: 1.0,
            },
            colors: {
                bg:         '#F6F4EF',
                card:       '#FFFFFF',
                cardHover:  '#ECE7DC',
                accent:     '#8C6410',
                accentDark: '#64480C',
                text:       '#15130F',
                textMuted:  '#4E4638',
                textFaint:  'rgba(21,19,15,0.58)',
                positive:   '#0E7A3A',
                negative:   '#B42318',
                info:       '#075E9E',
                warn:       '#A15C00',
                purple:     '#5B3EA6',
                border:     'rgba(90,74,42,0.22)',
                borderHover:'rgba(90,74,42,0.38)',
            },
            card: {
                background: '#FFFFFF',
                border:     '1px solid rgba(90,74,42,0.18)',
                borderHover:'1px solid rgba(90,74,42,0.34)',
                radius:     '10px',
                shadow:     '0 1px 4px rgba(35,28,18,0.08)',
                shadowHover:'0 6px 16px rgba(35,28,18,0.14)',
            },
            badge: {
                radius:     '10px',
                fontWeight:  700,
            },
            effects: {
                scanlines:   false,
                glow:        false,
                pixelate:    false,
                hoverScale:  1.0,
                transition:  '0.15s ease',
            },
        },
    };

    // ── Dynamic CSS injection ────────────────────────────────────
    function injectDynamicCSS(themeId) {
        let styleEl = document.getElementById(DYNAMIC_STYLE_ID);
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = DYNAMIC_STYLE_ID;
            document.head.appendChild(styleEl);
        }

        const t = THEMES[themeId] || THEMES.default;
        const c = t.colors || {};

        // Override core CSS custom properties so the ENTIRE app (sidebar,
        // tabs, modals) picks up the theme's palette — not just dashboard
        // widgets that read from WrTheme directly.
        let css = `
:root[data-wr-theme="${themeId}"] {
    --gold: ${c.accent || '#D4AF37'};
    --dark-gold: ${c.accentDark || '#B8941E'};
    /* --page-bg is the backdrop; --black is now the card elevation tone above it. */
    --page-bg: ${c.bg || '#08080B'};
    --black: ${c.card || c.bg || '#14141A'};
    --off-black: ${c.cardHover && c.cardHover.startsWith('#') ? c.cardHover : '#1F1F26'};
    --charcoal: ${c.cardHover || '#2A2A2A'};
    --silver: ${c.textMuted || '#D0D0D0'};
    --white: ${c.text || '#FFFFFF'};
    --text-primary: ${c.text || '#FFFFFF'};
    --text-secondary: ${c.textMuted || '#D0D0D0'};
    --text-muted: ${c.textMuted || '#D0D0D0'};
    --text-faint: ${c.textFaint || 'rgba(255,255,255,0.4)'};
    --surface-0: ${c.bg || '#08080B'};
    --surface-1: ${c.card || c.bg || '#14141A'};
    --surface-2: ${c.cardHover && c.cardHover.startsWith('#') ? c.cardHover : '#1F1F26'};
    --surface-3: ${c.cardHover || '#2A2A2A'};
    --good: ${c.positive || '#2ECC71'};
    --warn: ${c.warn || '#F0A500'};
    --bad: ${c.negative || '#E74C3C'};
    --info: ${c.info || '#3498DB'};
    --purple: ${c.purple || '#7C6BF8'};
    --win-green: ${c.positive || '#2ECC71'};
    --loss-red: ${c.negative || '#E74C3C'};
    --font-title: ${t.fonts?.display || 'Rajdhani, sans-serif'};
    --font-display: var(--font-title);
    --font-body: ${t.fonts?.ui || "'DM Sans', sans-serif"};
    --font-ui: var(--font-body);
    --font-mono: ${t.fonts?.mono || "'JetBrains Mono', monospace"};
}
[data-wr-theme="${themeId}"] body { background: var(--page-bg) !important; }
`;

        // Body background for light mode
        if (c.bg && c.bg !== '#0A0A0A') {
            css += `
[data-wr-theme="${themeId}"] body { background: ${c.bg} !important; }
[data-wr-theme="${themeId}"] .wr-sidebar { background: ${c.card || c.bg} !important; border-color: ${c.border} !important; }
[data-wr-theme="${themeId}"] .wr-main-content { background: ${c.bg} !important; }
[data-wr-theme="${themeId}"] .header {
    background: ${c.card} !important;
    border-bottom-color: ${c.borderHover} !important;
    box-shadow: ${t.card.shadow} !important;
}
[data-wr-theme="${themeId}"] .wr-module-strip,
[data-wr-theme="${themeId}"] .wr-module-nav,
[data-wr-theme="${themeId}"] .wr-module-toolbar,
[data-wr-theme="${themeId}"] .wr-glass {
    background: ${c.card} !important;
    border-color: ${c.border} !important;
}

/* Phase 10: Light-mode font cascade fix.
   Many components use hardcoded hex backgrounds/colors inline that don't pick
   up the theme's remapped CSS vars. Target the most common patterns via
   attribute selectors so we swap them for theme-appropriate values without
   touching each call site. */

/* Dark-surface backgrounds → card white */
[data-wr-theme="${themeId}"] [style*="background: #0a0b0d"],
[data-wr-theme="${themeId}"] [style*="background:#0a0b0d"],
[data-wr-theme="${themeId}"] [style*="background: #0A0A0A"],
[data-wr-theme="${themeId}"] [style*="background:#0A0A0A"],
[data-wr-theme="${themeId}"] [style*="background: #0a0a0a"],
[data-wr-theme="${themeId}"] [style*="background:#0a0a0a"],
[data-wr-theme="${themeId}"] [style*="background: #0D0D0D"],
[data-wr-theme="${themeId}"] [style*="background: #0d0d0d"] {
    background: ${c.card} !important;
}

/* Hardcoded near-white text → theme body text */
[data-wr-theme="${themeId}"] [style*="color: #f0f0f3"],
[data-wr-theme="${themeId}"] [style*="color:#f0f0f3"],
[data-wr-theme="${themeId}"] [style*="color: #FFFFFF"],
[data-wr-theme="${themeId}"] [style*="color:#FFFFFF"],
[data-wr-theme="${themeId}"] [style*="color: white"],
[data-wr-theme="${themeId}"] [style*="color:white"],
[data-wr-theme="${themeId}"] [style*="color: #d7d7dc"],
[data-wr-theme="${themeId}"] [style*="color:#d7d7dc"],
[data-wr-theme="${themeId}"] [style*="color: #d8d8de"],
[data-wr-theme="${themeId}"] [style*="color:#d8d8de"] {
    color: ${c.text} !important;
}

/* Hardcoded silver/muted text → theme muted */
[data-wr-theme="${themeId}"] [style*="color: #D0D0D0"],
[data-wr-theme="${themeId}"] [style*="color:#D0D0D0"],
[data-wr-theme="${themeId}"] [style*="color: #d0d0d0"],
[data-wr-theme="${themeId}"] [style*="color:#d0d0d0"],
[data-wr-theme="${themeId}"] [style*="color: #7d8291"],
[data-wr-theme="${themeId}"] [style*="color:#7d8291"],
[data-wr-theme="${themeId}"] [style*="color: rgba(255,255,255"],
[data-wr-theme="${themeId}"] [style*="color:rgba(255,255,255"] {
    color: ${c.textMuted} !important;
}
`;
        }


        if (t.effects.scanlines) {
            css += `
[data-wr-theme="${themeId}"] .wr-widget {
    position: relative;
}
[data-wr-theme="${themeId}"] .wr-widget::after {
    content: '';
    position: absolute;
    inset: 0;
    background: repeating-linear-gradient(
        0deg,
        transparent 0px, transparent 2px,
        rgba(0,0,0,0.12) 2px, rgba(0,0,0,0.12) 4px
    );
    pointer-events: none;
    z-index: 10;
    border-radius: ${t.card.radius};
}
`;
        }

        if (t.effects.glow) {
            css += `
[data-wr-theme="${themeId}"] .wr-data-value {
    text-shadow: 0 0 6px currentColor;
}
[data-wr-theme="${themeId}"] .wr-widget {
    box-shadow: ${t.card.shadow};
}
`;
        }

        // Override dashboard background
        css += `
[data-wr-theme="${themeId}"] .wr-dashboard-grid {
    background: ${t.colors.bg} !important;
}
`;

        styleEl.textContent = css;
    }

    // ── Public API ───────────────────────────────────────────────
    const WrTheme = {
        /** All registered themes */
        themes: THEMES,

        /** Current theme ID */
        current: 'default',

        /** Get the active theme object */
        get: function() {
            return THEMES[this.current] || THEMES.default;
        },

        /** Switch theme by ID, persist, apply CSS */
        set: function(id) {
            if (!THEMES[id]) return;
            this.current = id;
            try { localStorage.setItem(LS_KEY, id); } catch (e) {}
            document.documentElement.setAttribute('data-wr-theme', id);
            injectDynamicCSS(id);
            // Dispatch event so React components can re-render
            window.dispatchEvent(new CustomEvent('wr_theme_changed', { detail: { theme: id } }));
        },

        /** List available theme IDs */
        list: function() {
            return Object.keys(THEMES);
        },

        // ── Convenience accessors ────────────────────────────────
        color: function(key) { return this.get().colors[key]; },
        font:  function(key) { return this.get().fonts[key]; },

        /** Returns a full card style object for React inline styles */
        cardStyle: function(extra) {
            const t = this.get();
            return Object.assign({
                background: t.card.background,
                border: t.card.border,
                borderRadius: t.card.radius,
                boxShadow: t.card.shadow,
                overflow: 'hidden',
                height: '100%',
                transition: t.effects.transition,
            }, extra || {});
        },

        /** Returns a hover card style delta */
        cardHoverStyle: function() {
            const t = this.get();
            return {
                border: t.card.borderHover,
                boxShadow: t.card.shadowHover,
                background: t.colors.cardHover,
            };
        },

        /** Scale a font size by the theme's size multiplier */
        fontSize: function(baseRem) {
            return (baseRem * this.get().fonts.sizeScale) + 'rem';
        },

        /** Badge style (pills, chips) */
        badgeStyle: function(color, bg) {
            const t = this.get();
            return {
                fontSize: this.fontSize(0.6),
                fontWeight: t.badge.fontWeight,
                padding: '1px 6px',
                borderRadius: t.badge.radius,
                background: bg || (color + '18'),
                color: color || t.colors.accent,
                border: '1px solid ' + (color || t.colors.accent) + '44',
            };
        },
    };

    // ── Initialize from localStorage ─────────────────────────────
    try {
        const saved = localStorage.getItem(LS_KEY);
        if (saved && THEMES[saved]) {
            WrTheme.current = saved;
        }
    } catch (e) {}

    // Apply initial theme
    document.documentElement.setAttribute('data-wr-theme', WrTheme.current);
    injectDynamicCSS(WrTheme.current);

    window.WrTheme = WrTheme;
})();

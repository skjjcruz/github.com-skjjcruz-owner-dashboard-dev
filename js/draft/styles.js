// ══════════════════════════════════════════════════════════════════
// js/draft/styles.js — Draft Command Center shared layout constants
//
// Depends on: (none — pure constants, safe to load first)
// Exposes:    window.DraftCC.styles (DRAFT_CC_LAYOUT, CARD, FONTS, col helpers)
// ══════════════════════════════════════════════════════════════════

(function() {
    const DRAFT_CC_LAYOUT = {
        HEADER_H:      60,
        CARD_R:        8,
        CARD_BORDER:   '1px solid rgba(212,175,55,0.2)',
        CARD_BG:       'var(--black)',
        GRID_COLS:     12,
        GRID_GAP:      12,
        ROW_TOP_H:     600,
        ROW_BOTTOM_H:  240,
        SPAN: {
            BIG_BOARD:   3,
            DRAFT_GRID:  6,
            OPP_INTEL:   3,
            LIVE_ANALYT: 8,
            ALEX_STREAM: 4,
        },
        BP_DESKTOP: 1440,
        BP_TABLET:  1024,
        BP_MOBILE:  768,
    };

    const FONT_UI    = "'DM Sans', sans-serif";
    const FONT_DISPL = "Rajdhani, sans-serif";
    const FONT_MONO  = "'JetBrains Mono', monospace";

    // Panel card style — reusable across all draft-cc panels
    const panelCard = (extra = {}) => ({
        background: DRAFT_CC_LAYOUT.CARD_BG,
        border: DRAFT_CC_LAYOUT.CARD_BORDER,
        borderRadius: DRAFT_CC_LAYOUT.CARD_R + 'px',
        padding: '12px',
        overflow: 'hidden',
        ...extra,
    });

    const panelHeader = (title, right = null) => ({
        title, right,
    });

    // DHQ color heuristic (same thresholds as draft-room.js)
    const dhqColor = (dhq) => {
        if (dhq >= 7000) return '#2ECC71';
        if (dhq >= 4000) return '#3498DB';
        if (dhq >= 2000) return 'var(--silver)';
        return 'rgba(255,255,255,0.3)';
    };

    // Tier color per csv-loader.js tier (1=elite, 7=UDFA)
    const tierColor = (tier) => {
        if (tier === 1) return '#E74C3C';      // Elite
        if (tier === 2) return '#E67E22';      // First round
        if (tier === 3) return '#F0A500';      // Second round
        if (tier === 4) return '#D4AF37';      // Day 2
        if (tier === 5) return '#5DADE2';      // Day 3
        if (tier === 6) return 'var(--silver)';// Late Day 3
        return 'rgba(255,255,255,0.3)';        // UDFA
    };

    // Detect viewport size bucket (desktop / tablet / mobile)
    const bpBucket = () => {
        if (typeof window === 'undefined') return 'desktop';
        const w = window.innerWidth || 1440;
        if (w >= DRAFT_CC_LAYOUT.BP_DESKTOP) return 'desktop';
        if (w >= DRAFT_CC_LAYOUT.BP_TABLET)  return 'tablet';
        return 'mobile';
    };

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.styles = {
        DRAFT_CC_LAYOUT,
        FONT_UI,
        FONT_DISPL,
        FONT_MONO,
        panelCard,
        panelHeader,
        dhqColor,
        tierColor,
        bpBucket,
    };
})();

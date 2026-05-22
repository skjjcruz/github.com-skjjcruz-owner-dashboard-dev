// ══════════════════════════════════════════════════════════════════
// js/draft/trade-helpers.js — Portable trade psychology helpers
//
// trade-calc.js defines calcOwnerPosture / calcPsychTaxes / calcGrudgeTax
// as closure-scoped constants inside the TradeCalcTab component. They are
// not exposed globally, so the Draft Command Center can't reach them from
// persona.js or opponent-intel.js.
//
// This module lifts the same fallback implementations that trade-calc.js
// uses at lines 288–289 when the ReconAI shared trade-engine.js doesn't
// supply its own. Keep these in sync with trade-calc.js if that file's
// fallbacks are ever updated — marked with `SYNCED-WITH: trade-calc.js:288-290`.
//
// Also wires DNA_TYPES / POSTURES onto window.DraftCC.tradeHelpers so
// persona.js doesn't need to reach back into the React closure.
//
// Depends on: (none — pure JS, no React)
// Exposes:    window.DraftCC.tradeHelpers.{ DNA_TYPES, POSTURES, calcOwnerPosture, calcPsychTaxes, calcGrudgeTax }
// ══════════════════════════════════════════════════════════════════

(function() {
    // ── DNA_TYPES (copied from trade-calc.js:26 — kept verbatim) ─────
    const DNA_TYPES = {
        NONE: { label: '— Not Set —', color: 'var(--silver)', desc: '', taxes: [], multiplier: 1.0 },
        FLEECER: {
            label: 'The Fleecer',
            color: '#E74C3C',
            desc: 'High activity, always hunting asymmetric value.',
            taxes: ['Endowment Effect +15%', 'Expects to "win" the trade'],
            multiplier: 0.85,
        },
        DOMINATOR: {
            label: 'The Dominator',
            color: '#E67E22',
            desc: 'High ego, requires a perceived +30% margin to pull the trigger.',
            taxes: ['Ego Premium +30%', 'Needs to feel superior', 'Grudge Tax if rejected'],
            multiplier: 0.75,
        },
        STALWART: {
            label: 'The Stalwart',
            color: '#5DADE2',
            desc: 'High stability, prefers 1-for-1 lateral moves.',
            taxes: ['Desire Tax on fan favorites', 'Prefers even-up deals'],
            multiplier: 1.0,
        },
        ACCEPTOR: {
            label: 'The Acceptor',
            color: '#2ECC71',
            desc: 'Low attachment, willing to sell for futures.',
            taxes: ['Future Asset Bonus +20%', 'Discounts veterans -15%'],
            multiplier: 1.15,
        },
        DESPERATE: {
            label: 'The Desperate',
            color: '#BB8FCE',
            desc: 'High urgency triggered by injuries, bye-weeks, or playoff push.',
            taxes: ['Panic Multiplier up to +40%', 'Time-sensitive window'],
            multiplier: 1.3,
        },
    };

    const POSTURES = {
        DESPERATE: { key: 'DESPERATE', label: 'Desperate',    color: '#BB8FCE', desc: 'Panic-mode — will overpay for immediate help.' },
        BUYER:     { key: 'BUYER',     label: 'Active Buyer', color: '#F0A500', desc: 'Contender upgrading — open to deals.' },
        NEUTRAL:   { key: 'NEUTRAL',   label: 'Neutral',      color: '#95A5A6', desc: 'No strong push. Fair offers only.' },
        SELLER:    { key: 'SELLER',    label: 'Active Seller',color: '#5DADE2', desc: 'Moving assets for futures.' },
        LOCKED:    { key: 'LOCKED',    label: 'Locked In',    color: '#7F8C8D', desc: 'Satisfied roster, high attachment.' },
    };

    // ── calcOwnerPosture (SYNCED-WITH: trade-calc.js:288) ────────────
    function calcOwnerPosture(assessment, dnaKey) {
        // Defer to ReconAI shared engine if available
        const shared = window.App?.TradeEngine?.calcOwnerPosture;
        if (typeof shared === 'function') return shared(assessment, dnaKey);

        if (!assessment) return POSTURES.NEUTRAL;
        const { tier, panic } = assessment;
        if (panic >= 4) return POSTURES.DESPERATE;
        if (tier === 'REBUILDING' || dnaKey === 'ACCEPTOR') return POSTURES.SELLER;
        if (tier === 'ELITE' && (panic || 0) <= 1) return POSTURES.LOCKED;
        if ((tier === 'CONTENDER' || tier === 'CROSSROADS') && (panic || 0) >= 2) return POSTURES.BUYER;
        return POSTURES.NEUTRAL;
    }

    // ── calcPsychTaxes (SYNCED-WITH: trade-calc.js:289) ──────────────
    function calcPsychTaxes(myAssess, theirAssess, theirDnaKey, theirPosture) {
        const shared = window.App?.TradeEngine?.calcPsychTaxes;
        if (typeof shared === 'function') return shared(myAssess, theirAssess, theirDnaKey, theirPosture);

        const taxes = [];
        const ePct = ({ FLEECER: 10, DOMINATOR: 28, STALWART: 20, ACCEPTOR: 5, DESPERATE: 15, NONE: 12 })[theirDnaKey] || 12;
        taxes.push({
            name: 'Endowment Effect',
            impact: -Math.round(ePct / 2),
            type: 'TAX',
            desc: '~' + ePct + '% mental inflation on their own players.',
        });
        if (theirAssess && theirAssess.panic >= 3) {
            taxes.push({
                name: 'Panic Premium',
                impact: 8 + (theirAssess.panic - 2) * 6,
                type: 'BONUS',
                desc: 'Panic ' + theirAssess.panic + '/5 — urgency overrides caution.',
            });
        }
        if (theirDnaKey === 'DOMINATOR') {
            taxes.push({
                name: 'Status Tax',
                impact: -18,
                type: 'TAX',
                desc: 'Must visibly win the trade for ego/status.',
            });
        }
        if (theirDnaKey === 'STALWART' || theirDnaKey === 'DOMINATOR') {
            taxes.push({
                name: 'Loss Aversion',
                impact: -8,
                type: 'TAX',
                desc: 'Losing a familiar player hurts more than gaining a new one.',
            });
        }
        if (theirDnaKey === 'ACCEPTOR') {
            taxes.push({
                name: 'Rebuilding Discount',
                impact: +10,
                type: 'BONUS',
                desc: 'They mentally discount current starters.',
            });
        }
        const myStrengths = (myAssess && myAssess.strengths) || [];
        const theirNeedPos = ((theirAssess && theirAssess.needs) || []).slice(0, 3)
            .map(n => (typeof n === 'string' ? n : n && n.pos))
            .filter(Boolean);
        if (theirNeedPos.some(p => myStrengths.includes(p))) {
            taxes.push({
                name: 'Need Fulfillment',
                impact: +12,
                type: 'BONUS',
                desc: 'Your surplus fills their critical gap.',
            });
        }
        if (myAssess && theirAssess) {
            if (myAssess.window !== theirAssess.window) {
                taxes.push({
                    name: 'Window Alignment',
                    impact: +8,
                    type: 'BONUS',
                    desc: 'Opposite windows = natural asset exchange.',
                });
            } else {
                taxes.push({
                    name: 'Window Friction',
                    impact: -5,
                    type: 'TAX',
                    desc: 'Same window reduces natural motivation.',
                });
            }
        }
        if (theirPosture && theirPosture.key === 'LOCKED') {
            taxes.push({
                name: 'Locked Roster Tax',
                impact: -12,
                type: 'TAX',
                desc: 'High satisfaction + attachment.',
            });
        } else if (theirPosture && theirPosture.key === 'SELLER') {
            taxes.push({
                name: 'Seller Momentum',
                impact: +10,
                type: 'BONUS',
                desc: 'Actively shopping.',
            });
        }
        return taxes;
    }

    // ── calcGrudgeTax — reads from window._tcGrudges (live array) ────
    function calcGrudgeTax(myRosterId, theirRosterId, grudges) {
        const arr = grudges || window._tcGrudges || [];
        if (!Array.isArray(arr) || !arr.length) return 0;
        const relevant = arr.filter(g =>
            (g.fromRosterId === myRosterId && g.toRosterId === theirRosterId) ||
            (g.fromRosterId === theirRosterId && g.toRosterId === myRosterId)
        );
        if (!relevant.length) return 0;
        return relevant.reduce((sum, g) => sum + (g.impact || 0), 0);
    }

    // ── calcAcceptanceLikelihood — CPU evaluates whether to accept ───
    // Returns 0..100 likelihood percentage.
    //
    // Scout's version in reconai/shared/trade-engine.js uses a similar formula.
    // Inputs:
    //   theirGain = DHQ value CPU would receive
    //   theirGive = DHQ value CPU would send
    //   theirDnaKey = DNA archetype (adjusts required margin)
    //   taxes = result from calcPsychTaxes (array of { impact } entries)
    //   theirAssess, myAssess = team assessments (used for minor adjustments)
    function calcAcceptanceLikelihood(theirGain, theirGive, theirDnaKey, taxes, theirAssess, myAssess) {
        const shared = window.App?.TradeEngine?.calcAcceptanceLikelihood || window.App?.calcAcceptanceLikelihood;
        if (typeof shared === 'function') return shared(theirGain, theirGive, theirDnaKey, taxes, theirAssess, myAssess);

        // Defensive defaults
        theirGain = theirGain || 0;
        theirGive = theirGive || 1;

        // Base delta: how much the CPU gains relative to what they give
        const delta = (theirGain - theirGive) / theirGive;

        // DNA-required margin: how much +value the CPU expects to accept
        const requiredMargin = {
            DOMINATOR: 0.25, // Ego premium: needs +25%
            FLEECER:   0.10, // Always hunting, accepts smaller edge
            STALWART:  0.05, // Close to fair is fine
            ACCEPTOR:  -0.05,// Will accept slightly under
            DESPERATE: -0.15,// Will pay over
            NONE:      0.05,
        }[theirDnaKey] || 0.05;

        // Start around 50% for fair trade, scale by how far delta exceeds required margin
        let likelihood = 50 + Math.round((delta - requiredMargin) * 150);

        // Apply psych taxes: sum their impacts (each as a percentage point delta)
        if (Array.isArray(taxes)) {
            const taxSum = taxes.reduce((s, t) => s + (t.impact || 0), 0);
            likelihood += taxSum;
        }

        // Panic amplifier — panicking teams accept more readily
        if (theirAssess && theirAssess.panic >= 3) {
            likelihood += (theirAssess.panic - 2) * 5;
        }

        return Math.max(0, Math.min(100, Math.round(likelihood)));
    }

    // ── fairnessGrade — A-F style grade on a trade's DHQ symmetry ────
    // Perspective: "userSide" is what the user gives, "otherSide" is what they get.
    function fairnessGrade(userSide, otherSide) {
        const shared = window.App?.TradeEngine?.fairnessGrade || window.App?.fairnessGrade;
        if (typeof shared === 'function') return shared(userSide, otherSide);

        userSide = userSide || 1;
        otherSide = otherSide || 0;
        const ratio = otherSide / userSide; // >1 = user gains, <1 = user loses
        if (ratio >= 1.30) return { grade: 'A+', label: 'Steal', col: '#2ECC71' };
        if (ratio >= 1.15) return { grade: 'A',  label: 'Win',   col: '#2ECC71' };
        if (ratio >= 1.05) return { grade: 'B+', label: 'Favor', col: '#2ECC71' };
        if (ratio >= 0.95) return { grade: 'B',  label: 'Fair',  col: '#D4AF37' };
        if (ratio >= 0.85) return { grade: 'C',  label: 'Slight loss', col: '#F0A500' };
        if (ratio >= 0.75) return { grade: 'D',  label: 'Reach', col: '#E67E22' };
        return { grade: 'F', label: 'Bad', col: '#E74C3C' };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.tradeHelpers = {
        DNA_TYPES,
        POSTURES,
        calcOwnerPosture,
        calcPsychTaxes,
        calcGrudgeTax,
        calcAcceptanceLikelihood,
        fairnessGrade,
    };
})();

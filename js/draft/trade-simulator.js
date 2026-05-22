// ══════════════════════════════════════════════════════════════════
// js/draft/trade-simulator.js — CPU trade offer generator + evaluator
//
// Ports Scout's _mockMaybeGenerateTradeOffer (reconai/js/draft-ui.js:208)
// and adapts it for the War Room command center's reducer-driven state.
//
// Phase 3 scope:
//   - maybeGenerateTradeOffer(state, justPickedRosterId) — probabilistic
//     trigger after a CPU pick. Returns an offer object or null.
//   - evaluateUserProposal(state, proposal) — CPU evaluates whether to
//     accept/decline a user-initiated proposal. Returns { accepted, likelihood, grade }.
//   - pickValueFor(state, pick) — DHQ-equivalent value for a pick slot
//     via window.App.PlayerValue.getPickValue.
//
// Depends on: trade-helpers.js, window.App.PlayerValue.getPickValue
// Exposes:    window.DraftCC.tradeSimulator
// ══════════════════════════════════════════════════════════════════

(function() {
    // Cooldown: don't fire another offer within N picks of the last one
    const TRADE_COOLDOWN_PICKS = 3;
    // Base probability per CPU pick (scaled by league trade tendency if available)
    const BASE_TRADE_RATE = 0.10;
    const MAX_TRADE_RATE = 0.15;

    function pickValueFor(state, pick) {
        const teams = state.leagueSize || 12;
        const getPickValue = window.App?.PlayerValue?.getPickValue;
        if (typeof getPickValue === 'function') {
            try {
                return getPickValue(state.season, pick.round, teams, pick.slot || Math.ceil(teams / 2));
            } catch (e) {}
        }
        // Fallback: logarithmic decay from 10000 at pick 1 → 500 at last pick
        const totalPicks = state.rounds * teams;
        const idx = (pick.round - 1) * teams + ((pick.slot || 1) - 1);
        return Math.max(500, Math.round(10000 * Math.pow(0.97, idx)));
    }

    function sumPickValue(state, picks) {
        return (picks || []).reduce((sum, p) => sum + pickValueFor(state, p), 0);
    }

    // Phase 7 deferred: in-draft trades should support players + FAAB alongside picks.
    // Player DHQ is read from the LI store; FAAB converts at a conservative 0.7x
    // ratio so $100 FAAB ≈ 70 DHQ — prevents FAAB dumps from inflating offers.
    function playerValueFor(pid) {
        const scores = window.App?.LI?.playerScores || {};
        return Math.round(scores[pid] || 0);
    }
    function sumPlayerValue(pids) {
        return (pids || []).reduce((sum, pid) => sum + playerValueFor(pid), 0);
    }
    function faabToDhq(faab) {
        return Math.max(0, Math.round((faab || 0) * 0.7));
    }

    /**
     * maybeGenerateTradeOffer — probabilistic CPU-→-user trade offer.
     * Called by command-center after each CPU pick is made.
     *
     * @param {DraftState} state — current state (post-pick)
     * @param {number} justPickedRosterId — the CPU team that just made a pick
     * @param {Object} opts — { lastOfferPickIdx } — cooldown tracking
     * @returns {Object|null} offer shape:
     *   { fromRosterId, toRosterId, theirGive: [picks], myGive: [picks],
     *     theirGainDHQ, myGainDHQ, likelihood, grade, taxes, reason }
     */
    function maybeGenerateTradeOffer(state, justPickedRosterId, opts = {}) {
        if (!state || state.phase !== 'drafting') return null;
        if (!justPickedRosterId || justPickedRosterId === state.userRosterId) return null;

        // Cooldown
        const lastOfferIdx = opts.lastOfferPickIdx ?? -Infinity;
        if (state.currentIdx - lastOfferIdx < TRADE_COOLDOWN_PICKS) return null;

        // Probability roll
        if (Math.random() > BASE_TRADE_RATE) return null;

        // Pull persona & assessments
        const theirPersona = state.personas?.[justPickedRosterId];
        const myPersona = state.personas?.[state.userRosterId];
        if (!theirPersona || !myPersona) return null;

        // Skip LOCKED opponents
        if (theirPersona.posture?.key === 'LOCKED') return null;

        // Remaining picks
        const remaining = state.pickOrder.slice(state.currentIdx);
        const myPicks = remaining.filter(p => p.rosterId === state.userRosterId).sort((a, b) => a.round - b.round);
        const theirPicks = remaining.filter(p => p.rosterId === justPickedRosterId).sort((a, b) => a.round - b.round);
        if (!myPicks.length || !theirPicks.length) return null;

        // CPU wants to move UP: offers an earlier-or-equal round pick for user's latest-round pick.
        const myWorstPick = myPicks[myPicks.length - 1];
        const theirOfferPick = theirPicks.find(p => p.round <= myWorstPick.round);
        if (!theirOfferPick) return null;
        if (theirOfferPick.round === myWorstPick.round && theirOfferPick.overall === myWorstPick.overall) return null;

        // Value both sides
        const myPickDHQ = pickValueFor(state, myWorstPick);
        const theirPickDHQ = pickValueFor(state, theirOfferPick);

        // Only show offers where user gets equal or better value (+EV filter)
        if (theirPickDHQ < myPickDHQ) return null;

        // Compute psych taxes + acceptance likelihood
        const helpers = window.DraftCC?.tradeHelpers;
        if (!helpers) return null;
        const taxes = helpers.calcPsychTaxes(
            myPersona.assessment,
            theirPersona.assessment,
            theirPersona.tradeDna?.key,
            theirPersona.posture
        );
        const likelihood = helpers.calcAcceptanceLikelihood(
            theirPickDHQ,   // theirGain (they receive the user's worst pick — which has lower DHQ)
            myPickDHQ,      // wait, this is backwards — from the CPU's POV, they GIVE theirOfferPick (theirPickDHQ) and RECEIVE myWorstPick (myPickDHQ).
            theirPersona.tradeDna?.key,
            taxes,
            theirPersona.assessment,
            myPersona.assessment
        );
        // Correct perspective: CPU gains = myPickDHQ (they receive user's worst pick);
        // CPU gives = theirPickDHQ. From CPU's POV, this trade is BAD (myPickDHQ < theirPickDHQ).
        // But Scout's version filters these out above by requiring theirPickDHQ >= myPickDHQ (user gets +EV).
        // So realistically the CPU should only accept if they have a real motivation (need fill, posture, panic).
        // Recompute with proper CPU-perspective values:
        const cpuGain = myPickDHQ;
        const cpuGive = theirPickDHQ;
        const cpuLikelihood = helpers.calcAcceptanceLikelihood(
            cpuGain,
            cpuGive,
            theirPersona.tradeDna?.key,
            taxes,
            theirPersona.assessment,
            myPersona.assessment
        );
        // For an offer to fire, we need the CPU motivated enough that they'd accept their own offer
        // (they're the ones proposing it after all). Floor at 30%.
        if (cpuLikelihood < 30) return null;

        // Grade from user's perspective
        const grade = helpers.fairnessGrade(myPickDHQ, theirPickDHQ);

        // Reason narrative
        const theirNeeds = (theirPersona.assessment?.needs || [])
            .map(n => (typeof n === 'string' ? n : n?.pos))
            .filter(Boolean);
        const dnaLabel = theirPersona.draftDna?.label || theirPersona.tradeDna?.label || 'Balanced';
        const reason = theirNeeds.length > 0
            ? `They need ${theirNeeds[0]} and want to move up for earlier capital.`
            : `${dnaLabel} — looking to acquire earlier capital.`;

        return {
            fromRosterId: justPickedRosterId,
            fromName: theirPersona.teamName,
            toRosterId: state.userRosterId,
            theirGive: [theirOfferPick],
            myGive: [myWorstPick],
            theirGainDHQ: myPickDHQ,   // from CPU POV
            theirGiveDHQ: theirPickDHQ,
            myGainDHQ: theirPickDHQ,   // from user POV
            myGiveDHQ: myPickDHQ,
            likelihood: cpuLikelihood,
            grade,
            taxes,
            reason,
            dnaLabel,
        };
    }

    /**
     * evaluateUserProposal — CPU evaluates a user-initiated proposal.
     *
     * @param {DraftState} state
     * @param {Object} proposal — { targetRosterId, myGive: [picks], theirGive: [picks] }
     * @returns {Object} { accepted, likelihood, grade, taxes }
     */
    function evaluateUserProposal(state, proposal) {
        const helpers = window.DraftCC?.tradeHelpers;
        if (!helpers || !proposal) return { accepted: false, likelihood: 0, grade: null, taxes: [] };

        const theirPersona = state.personas?.[proposal.targetRosterId];
        const myPersona = state.personas?.[state.userRosterId];
        if (!theirPersona || !myPersona) return { accepted: false, likelihood: 0, grade: null, taxes: [] };

        const myGiveDHQ = sumPickValue(state, proposal.myGive)
            + sumPlayerValue(proposal.myGivePlayers)
            + faabToDhq(proposal.myGiveFaab);
        const theirGiveDHQ = sumPickValue(state, proposal.theirGive)
            + sumPlayerValue(proposal.theirGivePlayers)
            + faabToDhq(proposal.theirGiveFaab);
        // From CPU's perspective: they GAIN myGiveDHQ, they GIVE theirGiveDHQ
        const cpuGain = myGiveDHQ;
        const cpuGive = theirGiveDHQ;

        const taxes = helpers.calcPsychTaxes(
            myPersona.assessment,
            theirPersona.assessment,
            theirPersona.tradeDna?.key,
            theirPersona.posture
        );

        const likelihood = helpers.calcAcceptanceLikelihood(
            cpuGain,
            cpuGive,
            theirPersona.tradeDna?.key,
            taxes,
            theirPersona.assessment,
            myPersona.assessment
        );

        const grade = helpers.fairnessGrade(myGiveDHQ, theirGiveDHQ);

        // LOCKED teams never accept
        if (theirPersona.posture?.key === 'LOCKED') {
            return { accepted: false, likelihood: Math.min(20, likelihood), grade, taxes };
        }

        // 50% threshold for acceptance, with a small randomness wobble
        const roll = Math.random() * 100;
        const accepted = likelihood >= 50 || (likelihood >= 35 && roll < likelihood);

        return {
            accepted,
            likelihood,
            grade,
            taxes,
            myGiveDHQ,
            theirGiveDHQ,
        };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.tradeSimulator = {
        maybeGenerateTradeOffer,
        evaluateUserProposal,
        pickValueFor,
        sumPickValue,
        playerValueFor,
        sumPlayerValue,
        faabToDhq,
        TRADE_COOLDOWN_PICKS,
        BASE_TRADE_RATE,
    };
})();

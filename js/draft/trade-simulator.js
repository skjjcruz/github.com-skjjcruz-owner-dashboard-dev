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

    function historicalDraftPickTradeSignal(state) {
        const leagueId = String(state?.leagueId || state?.draftContext?.leagueId || '');
        const rows = [];
        let hasHistoricalSource = false;
        const collect = sourceRows => {
            if (!Array.isArray(sourceRows)) return;
            hasHistoricalSource = true;
            sourceRows.forEach(row => {
                const rowLeagueId = String(row?.league_id || row?.leagueId || '');
                if (leagueId && rowLeagueId && rowLeagueId !== leagueId) return;
                rows.push(row);
            });
        };
        collect(state?.draftContext?.tradedPicks);
        collect(state?.tradedPicks);
        collect(window.S?.tradedPicks);
        if (!hasHistoricalSource) return null;

        const seen = new Set();
        const movedCount = rows.filter(row => {
            const original = String(row?.roster_id ?? '');
            const owner = String(row?.owner_id ?? '');
            if (!original || !owner || original === owner) return false;
            const key = [row?.season, row?.round, original, owner].map(v => String(v ?? '')).join(':');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).length;
        const seasons = Math.max(1, Number(state?.recapLearning?.sampleSize || state?.draftContext?.seasonsSampled || 1) || 1);
        const activity = movedCount <= 0 ? 0 : Math.max(8, Math.min(100, Math.round((movedCount / seasons) * 18)));
        return {
            source: 'historical_draft_pick_trades',
            count: movedCount,
            activity,
            seasons,
        };
    }

    function tradeActivityFor(state) {
        const n = Number(state?.draftTuning?.tradeActivity);
        if (!Number.isFinite(n)) return 50;
        return Math.max(0, Math.min(100, n));
    }

    // GM's Office "Roster Fit" slider (BPA ⇄ Need-driven). Used as a small nudge on
    // how hard a package is to close — need-driven rooms hold assets a touch tighter.
    function needFitFor(state) {
        const n = Number(state?.draftTuning?.needFit);
        if (!Number.isFinite(n)) return 60;
        return Math.max(0, Math.min(100, n));
    }

    function cpuOfferTradeActivityFor(state) {
        const historical = historicalDraftPickTradeSignal(state);
        return historical ? historical.activity : tradeActivityFor(state);
    }

    function cpuOfferRate(state) {
        const activity = cpuOfferTradeActivityFor(state);
        if (activity <= 5) return 0;
        return Math.min(MAX_TRADE_RATE, BASE_TRADE_RATE * (0.2 + activity * 0.016));
    }

    function ownerIntelSummary(persona) {
        if (!persona?.ownerIntel) return '';
        if (window.DraftCC?.context?.summarizeOwnerIntel) {
            return window.DraftCC.context.summarizeOwnerIntel(persona.ownerIntel);
        }
        const top = persona.ownerIntel.reasonCodes?.[0];
        return top?.detail || '';
    }

    function pickValueFor(state, pick) {
        if (!pick) return 0;
        if (Number(pick.value) > 0) return Math.round(Number(pick.value));
        const teams = state.leagueSize || 12;
        const slot = pick.slot || pick.pickInRound || Math.ceil(teams / 2);
        const overall = pick.overall || ((Number(pick.round || 1) - 1) * teams + slot);
        const resolver = window.DraftCC?.state?.resolveDraftPickValue;
        if (typeof resolver === 'function') {
            const resolved = resolver({
                season: state.season,
                round: pick.round,
                slot,
                overall,
                leagueSize: teams,
                rounds: state.rounds,
            });
            if (resolved?.value > 0) return resolved.value;
        }
        const playerValue = window.App?.PlayerValue || {};
        if (typeof playerValue.getPickValue === 'function') {
            try {
                const value = playerValue.getPickValue(state.season, pick.round, teams, slot, state.rounds);
                if (value > 0) return Math.round(value);
            } catch (e) {}
        }
        if (typeof playerValue.pickValueBySlot === 'function') {
            try {
                const value = playerValue.pickValueBySlot(pick.round, slot, teams, state.rounds);
                if (value > 0) return Math.round(value);
            } catch (e) {}
        }
        if (typeof window.getPickValueBySlot === 'function') {
            const value = window.getPickValueBySlot(pick.round, slot, teams, state.rounds || 7);
            if (value > 0) return Math.round(value);
        }
        if (typeof window.getIndustryPickValue === 'function') {
            const value = window.getIndustryPickValue(overall, teams, state.rounds || 7);
            if (value > 0) return Math.round(value);
        }
        if (playerValue.PICK_VALUES_BY_SLOT?.[overall]) return Math.round(Number(playerValue.PICK_VALUES_BY_SLOT[overall]) || 0);
        if (playerValue.PICK_VALUES?.[pick.round]) return Math.round(Number(playerValue.PICK_VALUES[pick.round]) || 0);
        return 0;
    }

    function sumPickValue(state, picks) {
        return (picks || []).reduce((sum, p) => sum + pickValueFor(state, p), 0);
    }

    // Phase 7 deferred: in-draft trades should support players + FAAB alongside picks.
    // Player DHQ is read from the LI store; FAAB converts at a conservative 0.7x
    // ratio so $100 FAAB ≈ 70 DHQ — prevents FAAB dumps from inflating offers.
    function playerValueFor(pid) {
        const resolved = window.DraftCC?.state?.resolvePlayerDhq?.({ pid });
        if (resolved?.value > 0) return resolved.value;
        const scores = window.App?.LI?.playerScores || {};
        return Math.round(scores[pid] || 0);
    }
    function sumPlayerValue(pids) {
        return (pids || []).reduce((sum, pid) => sum + playerValueFor(pid), 0);
    }
    function faabToDhq(faab) {
        return Math.max(0, Math.round((faab || 0) * 0.7));
    }

    function idKey(value) {
        return value == null ? '' : String(value);
    }

    function pickKey(pick) {
        return [pick?.round, pick?.teamIdx, pick?.overall].join(':');
    }

    function normalizedPos(pos) {
        const raw = String(pos || '').toUpperCase();
        if (['CB', 'S', 'SS', 'FS'].includes(raw)) return 'DB';
        if (['DE', 'DT', 'NT', 'IDL', 'EDGE'].includes(raw)) return 'DL';
        if (['OLB', 'ILB', 'MLB'].includes(raw)) return 'LB';
        return raw || '?';
    }

    function playerPosFor(pid) {
        const player = window.S?.players?.[pid] || {};
        return normalizedPos(player.position || player.fantasy_positions?.[0] || player.pos);
    }

    function playerNameFor(pid) {
        const p = window.S?.players?.[pid] || {};
        const full = p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
        return full || pid;
    }

    function personaNeeds(persona) {
        return (persona?.assessment?.needs || [])
            .map(n => normalizedPos(typeof n === 'string' ? n : n?.pos))
            .filter(pos => pos && pos !== '?');
    }

    function needFitScore(persona, playerIds) {
        const needs = new Set(personaNeeds(persona));
        if (!needs.size) return 0;
        const hits = (playerIds || []).filter(pid => needs.has(playerPosFor(pid))).length;
        return Math.min(16, hits * 8);
    }

    function earliestOverall(picks) {
        const vals = (picks || []).map(p => Number(p.overall || ((p.round - 1) * 99 + p.slot) || 9999));
        return vals.length ? Math.min(...vals) : null;
    }

    function ownerLiquidityModifier(persona) {
        const behavior = persona?.ownerIntel?.behavior || {};
        const score = Number(behavior?.scores?.liquidity);
        if (Number.isFinite(score)) {
            if (score >= 75) return { label: 'Active trader', impact: 8, detail: 'League history shows high trade liquidity.' };
            if (score <= 30) return { label: 'Selective trader', impact: -8, detail: 'League history shows low trade liquidity.' };
        }
        const text = (persona?.ownerIntel?.reasonCodes || [])
            .map(r => [r.code, r.label, r.detail].filter(Boolean).join(' '))
            .join(' ')
            .toLowerCase();
        if (text.includes('active-trader') || text.includes('high trade')) return { label: 'Active trader', impact: 6, detail: 'Owner history points to higher deal activity.' };
        if (text.includes('low trade') || text.includes('selective')) return { label: 'Selective trader', impact: -6, detail: 'Owner history points to lower deal activity.' };
        return null;
    }

    function dnaLikelihoodModifier(persona) {
        const key = persona?.tradeDna?.key || 'NONE';
        const map = {
            FLEECER: { impact: -4, label: 'Fleecer tax' },
            DOMINATOR: { impact: -10, label: 'Dominator tax' },
            STALWART: { impact: -8, label: 'Stalwart tax' },
            ACCEPTOR: { impact: 8, label: 'Acceptor discount' },
            DESPERATE: { impact: 10, label: 'Urgency bonus' },
            NONE: { impact: 0, label: 'Balanced DNA' },
        };
        return map[key] || map.NONE;
    }

    function acceptanceLineFor(state, persona) {
        const activity = tradeActivityFor(state);
        const key = persona?.tradeDna?.key || 'NONE';
        let line = {
            FLEECER: 76,
            DOMINATOR: 82,
            STALWART: 78,
            ACCEPTOR: 62,
            DESPERATE: 60,
            NONE: 70,
        }[key] || 70;
        if (persona?.posture?.key === 'LOCKED') line = 96;
        if (persona?.posture?.key === 'SELLER') line -= 6;
        if (persona?.posture?.key === 'DESPERATE') line -= 8;
        line -= Math.round((activity - 50) * 0.18);
        return Math.max(52, Math.min(96, line));
    }

    // ── GM's Office–driven package targeting ───────────────────────────────
    // Auto-generated packages used to size the user's give to a flat ~0.9× of the
    // value acquired — a structural underpay that never cleared a 62-96 buyer line,
    // which is why the rail felt "low acceptance". Instead, derive the give/receive
    // value RATIO that actually clears the partner's line, scaled by the user's GM's
    // Office sliders (Trade Activity is the dominant lever; Roster Fit a small nudge).
    //
    // Returns r >= 1: for a package where the user ACQUIRES an asset, give r× the
    // value acquired. For a package where the user RECEIVES picks for a fixed asset,
    // take back at most 1/r of what they give (the most the partner says yes to).
    function giveTargetMultiplier(state, persona, opts = {}) {
        const line = (opts.acceptanceLine != null) ? opts.acceptanceLine : acceptanceLineFor(state, persona);
        const activity = tradeActivityFor(state);
        // Cushion above the bare line. Trade Activity dominates; Roster Fit nudges.
        let cushion = 4 + Math.round((activity - 50) * 0.10);
        cushion += Math.round((needFitFor(state) - 60) * 0.04);
        const target = Math.max(52, Math.min(94, line + cushion));
        const margin = Math.max(2, Math.min(44, target - 50));
        // Invert the acceptance curve likelihood ≈ 50 + 200·(1 − 1/r) for r at `target`.
        const r = 1 / (1 - margin / 200);
        return Math.max(1.0, Math.min(1.6, r));
    }

    // User ACQUIRES an asset: build the give side up to the value that actually CLEARS
    // the partner's buyer line, with the LEAST overpay. A flat value target overshoots
    // badly with chunky picks (a single big pick blows past it), so instead add picks
    // incrementally and stop the moment the package clears — trying both biggest-first
    // (best when one pick clears) and smallest-first (finer increments when it doesn't),
    // then keep whichever clears with the smaller give. If neither clears (a genuinely
    // hard partner — e.g. a DOMINATOR at zero Trade Activity), fall back to the sane
    // closed-form attempt; the moonshot fallback covers the no-path case.
    function buildGiveToClear(state, persona, baseProposal, acquiredValue) {
        const line = acceptanceLineFor(state, persona);
        const tryOrder = (order) => {
            const picks = remainingPicksByValue(state, state.userRosterId, baseProposal.myGive || [], order);
            let proposal = baseProposal;
            for (const pick of picks) {
                if ((proposal.myGive || []).length >= 4) break;
                proposal = { ...proposal, myGive: [...(proposal.myGive || []), pick] };
                const ev = evaluateUserProposal(state, proposal, { preview: true, noCounter: true });
                if ((ev.likelihood || 0) >= line) return { proposal, cleared: true };
            }
            return { proposal, cleared: false };
        };
        const give = (p) => proposalValue(state, p, 'my');
        const clearing = [tryOrder('desc'), tryOrder('asc')].filter(r => r.cleared).map(r => r.proposal);
        if (clearing.length) return clearing.sort((a, b) => give(a) - give(b))[0];
        // Nothing clears (a genuinely hard partner — e.g. a DOMINATOR at zero Trade
        // Activity): offer a clean single-pick opener rather than piling capital; the
        // moonshot fallback provides the explicit overpay path when it stays declined.
        return addUserPicksUntil(state, baseProposal, Math.round(Math.max(1, acquiredValue)), 1);
    }

    // User RECEIVES the partner's picks for a fixed asset (move-down / sell-player).
    // Add their picks (best first) only while the package still CLEARS the buyer line,
    // so the user gets the most value back without tipping the partner into a decline.
    // This responds to the GM's Office sliders implicitly (a higher line ⇒ less comes
    // back) and avoids the chunky-pick overshoot a fixed value target produces.
    function buildReceiveToClear(state, persona, baseProposal, targetRosterId) {
        const line = acceptanceLineFor(state, persona);
        const picks = remainingPicksByValue(state, targetRosterId, baseProposal.theirGive || [], 'desc');
        let proposal = baseProposal;
        for (const pick of picks) {
            if ((proposal.theirGive || []).length >= 3) break;
            const candidate = { ...proposal, theirGive: [...(proposal.theirGive || []), pick] };
            const ev = evaluateUserProposal(state, candidate, { preview: true, noCounter: true });
            if ((ev.likelihood || 0) >= line) proposal = candidate; else break;
        }
        // Guarantee the package is two-sided even against a partner who clears nothing.
        if (!(proposal.theirGive || []).length && picks[0]) {
            proposal = { ...proposal, theirGive: [picks[0]] };
        }
        return proposal;
    }

    function packageComplexityPenalty(proposal) {
        const assets =
            (proposal.myGive || []).length +
            (proposal.theirGive || []).length +
            (proposal.myGivePlayers || []).length +
            (proposal.theirGivePlayers || []).length +
            (proposal.myGiveFaab ? 1 : 0) +
            (proposal.theirGiveFaab ? 1 : 0);
        return Math.max(0, assets - 4) * -2;
    }

    function timingModifier(proposal) {
        const cpuReceives = earliestOverall(proposal.myGive);
        const cpuGives = earliestOverall(proposal.theirGive);
        if (!cpuReceives || !cpuGives) return { impact: 0, label: 'Timing neutral', detail: 'No meaningful pick timing edge.' };
        const delta = cpuGives - cpuReceives;
        if (delta >= 10) return { impact: 10, label: 'Move-up motive', detail: 'They receive an earlier pick window.' };
        if (delta >= 4) return { impact: 5, label: 'Move-up motive', detail: 'They improve their next pick window.' };
        if (delta <= -10) return { impact: -10, label: 'Pick-window tax', detail: 'They surrender the earlier pick window.' };
        if (delta <= -4) return { impact: -5, label: 'Pick-window tax', detail: 'They move down in the active tier.' };
        return { impact: 0, label: 'Timing neutral', detail: 'Pick timing is close enough to neutral.' };
    }

    function computeProposalEvaluation(state, proposal) {
        const helpers = window.DraftCC?.tradeHelpers;
        if (!helpers || !proposal) return { likelihood: 0, grade: null, taxes: [], modifiers: [], myGiveDHQ: 0, theirGiveDHQ: 0, acceptanceLine: 70, counterLine: 52 };

        const theirPersona = state.personas?.[proposal.targetRosterId];
        const myPersona = state.personas?.[state.userRosterId];
        if (!theirPersona || !myPersona) return { likelihood: 0, grade: null, taxes: [], modifiers: [], myGiveDHQ: 0, theirGiveDHQ: 0, acceptanceLine: 70, counterLine: 52 };

        const myGiveDHQ = sumPickValue(state, proposal.myGive)
            + sumPlayerValue(proposal.myGivePlayers)
            + faabToDhq(proposal.myGiveFaab);
        const theirGiveDHQ = sumPickValue(state, proposal.theirGive)
            + sumPlayerValue(proposal.theirGivePlayers)
            + faabToDhq(proposal.theirGiveFaab);
        const realism = validateProposalRealism(state, proposal);

        const basePsychTaxes = helpers.calcPsychTaxes(
            myPersona.assessment,
            theirPersona.assessment,
            theirPersona.tradeDna?.key,
            theirPersona.posture
        );

        // Grudge tax: logged trade-history sentiment between these two owners. Mirrors
        // the main Trade Center analyzer, which folds it into the acceptance math and
        // surfaces it as a tax row. 0 (and omitted) when no grudges are on record.
        const grudgeTotal = helpers.calcGrudgeTax
            ? (helpers.calcGrudgeTax(state.userRosterId, proposal.targetRosterId, window._tcGrudges) || 0)
            : 0;
        const taxes = grudgeTotal !== 0
            ? [...basePsychTaxes, {
                name: 'Grudge Tax',
                impact: grudgeTotal,
                type: grudgeTotal > 0 ? 'BONUS' : 'TAX',
                desc: 'Logged trade-history sentiment between you two.',
            }]
            : basePsychTaxes;

        let likelihood = helpers.calcAcceptanceLikelihood(
            myGiveDHQ,
            theirGiveDHQ,
            theirPersona.tradeDna?.key,
            taxes,
            theirPersona.assessment,
            myPersona.assessment
        );

        const activity = tradeActivityFor(state);
        const modifiers = [];
        const activityMod = Math.round((activity - 50) * 0.22);
        if (activityMod) modifiers.push({ label: 'Trade activity tuning', impact: activityMod, detail: activity + '% mock trade activity.' });

        const dnaMod = dnaLikelihoodModifier(theirPersona);
        if (dnaMod.impact) modifiers.push({ ...dnaMod, detail: theirPersona.tradeDna?.label || 'Owner DNA profile.' });

        const fit = needFitScore(theirPersona, proposal.myGivePlayers);
        if (fit) modifiers.push({ label: 'Need fulfillment', impact: fit, detail: 'Your package fills one of their roster needs.' });

        const timing = timingModifier(proposal);
        if (timing.impact) modifiers.push(timing);

        const liquidity = ownerLiquidityModifier(theirPersona);
        if (liquidity) modifiers.push(liquidity);

        const complexity = packageComplexityPenalty(proposal);
        if (complexity) modifiers.push({ label: 'Package complexity', impact: complexity, detail: 'Multi-asset offers need extra clarity.' });

        likelihood += modifiers.reduce((sum, m) => sum + (Number(m.impact) || 0), 0);
        likelihood = Math.max(5, Math.min(95, Math.round(likelihood)));

        const acceptanceLine = acceptanceLineFor(state, theirPersona);
        const counterLine = Math.max(34, acceptanceLine - 20);
        const grade = helpers.fairnessGrade(myGiveDHQ, theirGiveDHQ);
        if (realism.blocked) likelihood = Math.min(2, likelihood);

        const netModifier = taxes.reduce((s, t) => s + (Number(t.impact) || 0), 0)
            + modifiers.reduce((s, m) => s + (Number(m.impact) || 0), 0);

        const evaluation = {
            likelihood,
            grade,
            taxes,
            modifiers,
            grudgeTax: grudgeTotal,
            netModifier,
            realism,
            realismFlags: realism.flags,
            myGiveDHQ,
            theirGiveDHQ,
            acceptanceLine,
            counterLine,
            theirPersona,
            myPersona,
            buyerLine: acceptanceLine,
            rawDhqDelta: myGiveDHQ - theirGiveDHQ,
        };
        evaluation.negotiationRead = negotiationReadFor(evaluation);
        return evaluation;
    }

    function remainingPicksFor(state, rosterId, selected) {
        const used = new Set((selected || []).map(pickKey));
        return (state.pickOrder || [])
            .slice(state.currentIdx || 0)
            .filter(p => idKey(p.rosterId) === idKey(rosterId) && !used.has(pickKey(p)))
            .sort((a, b) => pickValueFor(state, a) - pickValueFor(state, b));
    }

    function remainingPicksByValue(state, rosterId, selected, dir = 'desc') {
        const picks = remainingPicksFor(state, rosterId, selected);
        return picks.sort((a, b) => {
            const delta = pickValueFor(state, a) - pickValueFor(state, b);
            return dir === 'asc' ? delta : -delta;
        });
    }

    function effectiveRosterPlayers(state, rosterId) {
        const rosters = window.S?.rosters || [];
        const base = rosters.find(r => idKey(r.roster_id) === idKey(rosterId));
        const picked = new Set((state.picks || []).map(p => p.pid).filter(Boolean));
        const delta = state.tradedAssets?.[rosterId] || {};
        const outgoing = new Set(delta.outgoingPlayers || []);
        const players = new Set((base?.players || []).filter(pid => pid && !picked.has(pid) && !outgoing.has(pid)));
        (delta.incomingPlayers || []).forEach(pid => {
            if (pid && !picked.has(pid)) players.add(pid);
        });
        return Array.from(players);
    }

    function duplicateKeys(list) {
        const seen = new Set();
        const dupes = new Set();
        (list || []).forEach(item => {
            const key = String(item || '');
            if (!key) return;
            if (seen.has(key)) dupes.add(key);
            seen.add(key);
        });
        return Array.from(dupes);
    }

    function validateProposalRealism(state, proposal) {
        const flags = [];
        const add = (severity, code, label, detail) => flags.push({ severity, code, label, detail });
        if (!proposal) {
            add('blocker', 'missing_proposal', 'Missing package', 'No trade package was supplied.');
            return { blocked: true, flags };
        }

        const targetRosterId = idKey(proposal.targetRosterId);
        const userRosterId = idKey(state?.userRosterId);
        if (!targetRosterId) add('blocker', 'missing_partner', 'Missing partner', 'Choose a trade partner before evaluating the offer.');
        if (targetRosterId && userRosterId && targetRosterId === userRosterId) {
            add('blocker', 'self_trade', 'Invalid partner', 'The user cannot negotiate against their own roster.');
        }

        const myPickKeys = (proposal.myGive || []).map(pickKey);
        const theirPickKeys = (proposal.theirGive || []).map(pickKey);
        duplicateKeys(myPickKeys).forEach(key => add('blocker', 'duplicate_user_pick', 'Duplicate outgoing pick', key + ' appears more than once on your side.'));
        duplicateKeys(theirPickKeys).forEach(key => add('blocker', 'duplicate_partner_pick', 'Duplicate incoming pick', key + ' appears more than once on their side.'));
        myPickKeys.filter(key => theirPickKeys.includes(key)).forEach(key => {
            add('blocker', 'same_pick_both_sides', 'Same pick on both sides', key + ' cannot be given and received in the same package.');
        });

        const userPickSet = new Set(remainingPicksFor(state, state?.userRosterId, []).map(pickKey));
        const targetPickSet = new Set(remainingPicksFor(state, proposal.targetRosterId, []).map(pickKey));
        (proposal.myGive || []).forEach(pick => {
            if (!userPickSet.has(pickKey(pick))) add('blocker', 'user_pick_unavailable', 'Outgoing pick unavailable', 'That pick is no longer controlled by your roster in this draft state.');
        });
        (proposal.theirGive || []).forEach(pick => {
            if (!targetPickSet.has(pickKey(pick))) add('blocker', 'partner_pick_unavailable', 'Incoming pick unavailable', 'That pick is no longer controlled by the selected partner.');
        });

        const myPlayers = (proposal.myGivePlayers || []).map(idKey).filter(Boolean);
        const theirPlayers = (proposal.theirGivePlayers || []).map(idKey).filter(Boolean);
        duplicateKeys(myPlayers).forEach(pid => add('blocker', 'duplicate_user_player', 'Duplicate outgoing player', playerNameFor(pid) + ' appears more than once on your side.'));
        duplicateKeys(theirPlayers).forEach(pid => add('blocker', 'duplicate_partner_player', 'Duplicate incoming player', playerNameFor(pid) + ' appears more than once on their side.'));
        myPlayers.filter(pid => theirPlayers.includes(pid)).forEach(pid => {
            add('blocker', 'same_player_both_sides', 'Same player on both sides', playerNameFor(pid) + ' cannot be both sent and received.');
        });

        const userRosterPlayers = new Set(effectiveRosterPlayers(state, state?.userRosterId).map(idKey));
        const targetRosterPlayers = new Set(effectiveRosterPlayers(state, proposal.targetRosterId).map(idKey));
        myPlayers.forEach(pid => {
            if (!userRosterPlayers.has(pid)) add('blocker', 'user_player_unavailable', 'Outgoing player unavailable', playerNameFor(pid) + ' is not currently controlled by your roster.');
        });
        theirPlayers.forEach(pid => {
            if (!targetRosterPlayers.has(pid)) add('blocker', 'partner_player_unavailable', 'Incoming player unavailable', playerNameFor(pid) + ' is not currently controlled by the selected partner.');
        });

        ['myGiveFaab', 'theirGiveFaab'].forEach(key => {
            const value = Number(proposal[key] || 0);
            if (value < 0) add('blocker', 'negative_faab', 'Invalid FAAB', 'FAAB cannot be negative.');
            if (value > 1000) add('warning', 'large_faab', 'Large FAAB ask', 'FAAB over $1,000 is treated as unusual and should be confirmed manually.');
        });

        return {
            blocked: flags.some(f => f.severity === 'blocker'),
            flags,
        };
    }

    function topPlayersFor(state, rosterId, limit = 6, opts = {}) {
        const needs = opts.matchNeeds ? new Set(opts.matchNeeds.map(normalizedPos)) : null;
        return effectiveRosterPlayers(state, rosterId)
            .map(pid => ({
                pid,
                name: playerNameFor(pid),
                pos: playerPosFor(pid),
                value: playerValueFor(pid),
            }))
            .filter(p => p.value > 0)
            .filter(p => !needs || needs.has(p.pos))
            .sort((a, b) => b.value - a.value)
            .slice(0, limit);
    }

    function proposalHasAssets(proposal) {
        return !!(
            (proposal?.myGive || []).length ||
            (proposal?.theirGive || []).length ||
            (proposal?.myGivePlayers || []).length ||
            (proposal?.theirGivePlayers || []).length ||
            proposal?.myGiveFaab ||
            proposal?.theirGiveFaab
        );
    }

    function normalizeProposal(targetRosterId, patch = {}) {
        return {
            targetRosterId,
            myGive: patch.myGive || [],
            theirGive: patch.theirGive || [],
            myGivePlayers: patch.myGivePlayers || [],
            theirGivePlayers: patch.theirGivePlayers || [],
            myGiveFaab: patch.myGiveFaab || 0,
            theirGiveFaab: patch.theirGiveFaab || 0,
        };
    }

    function proposalFromOffer(offer) {
        if (!offer) return null;
        return normalizeProposal(offer.fromRosterId || offer.targetRosterId, offer);
    }

    function negotiationReadFor(evaluation, opts = {}) {
        const likelihood = Number(evaluation?.likelihood || 0);
        const line = Number(evaluation?.acceptanceLine || 70);
        const counterLine = Number(evaluation?.counterLine || 50);
        const gap = Math.max(0, line - likelihood);
        const dna = evaluation?.theirPersona?.tradeDna?.key || evaluation?.theirPersona?.draftDna?.key || 'NONE';
        const name = evaluation?.theirPersona?.teamName || 'They';
        const finalRound = !!opts.finalRound;
        if (evaluation?.realism?.blocked) {
            return {
                phase: 'invalid',
                tone: 'closed',
                message: 'That package is not legal in this draft state. Fix the asset ownership before reopening talks.',
            };
        }
        if (likelihood >= line) {
            return {
                phase: 'accepted',
                tone: 'green',
                message: 'That clears my line. The value, timing, and owner profile all say this can get done.',
            };
        }
        if (finalRound || likelihood < counterLine) {
            return {
                phase: 'walk-away',
                tone: 'red',
                message: gap >= 18
                    ? "Come on, that's weak. I need real value here, so I'm moving on."
                    : name + ' is not close enough to keep negotiating. Protect the board and let the room move.',
            };
        }
        if (gap <= 6) {
            return {
                phase: 'small-sweetener',
                tone: 'gold',
                message: 'We are close. Add the cleanest small sweetener and this should stay inside their buyer line.',
            };
        }
        if (dna === 'FLEECER' || dna === 'DOMINATOR') {
            return {
                phase: 'hard-counter',
                tone: 'gold',
                message: 'They are treating this like a value trap. I would counter with one more clean pick or walk away.',
            };
        }
        return {
            phase: 'counter',
            tone: 'gold',
            message: 'I am listening, but the package is still light. Add value that matches their roster need or keep the pick.',
        };
    }

    function proposalKey(proposal) {
        const side = list => (list || []).map(pickKey).sort().join(',');
        return [
            proposal?.targetRosterId,
            side(proposal?.myGive),
            side(proposal?.theirGive),
            (proposal?.myGivePlayers || []).slice().sort().join(','),
            (proposal?.theirGivePlayers || []).slice().sort().join(','),
            proposal?.myGiveFaab || 0,
            proposal?.theirGiveFaab || 0,
        ].join('|');
    }

    function proposalValue(state, proposal, side) {
        if (side === 'my') {
            return sumPickValue(state, proposal.myGive) + sumPlayerValue(proposal.myGivePlayers) + faabToDhq(proposal.myGiveFaab);
        }
        return sumPickValue(state, proposal.theirGive) + sumPlayerValue(proposal.theirGivePlayers) + faabToDhq(proposal.theirGiveFaab);
    }

    function addUserPicksUntil(state, proposal, targetValue, maxAdds = 3) {
        const next = { ...proposal, myGive: [...(proposal.myGive || [])] };
        const picks = remainingPicksByValue(state, state.userRosterId, next.myGive, 'desc');
        for (const pick of picks) {
            if (proposalValue(state, next, 'my') >= targetValue) break;
            if (next.myGive.length >= maxAdds) break;
            next.myGive.push(pick);
        }
        return next;
    }

    function addTargetPicksUntil(state, proposal, targetRosterId, targetValue, maxAdds = 3) {
        const next = { ...proposal, theirGive: [...(proposal.theirGive || [])] };
        const picks = remainingPicksByValue(state, targetRosterId, next.theirGive, 'desc');
        for (const pick of picks) {
            if (proposalValue(state, next, 'their') >= targetValue) break;
            if (next.theirGive.length >= maxAdds) break;
            next.theirGive.push(pick);
        }
        return next;
    }

    function describeTradePartner(state, targetRosterId) {
        const persona = state.personas?.[targetRosterId];
        if (!persona) return null;
        const needs = personaNeeds(persona);
        const strengths = (persona.assessment?.strengths || []).map(normalizedPos).filter(Boolean);
        const buyerLine = acceptanceLineFor(state, persona);
        const picks = remainingPicksByValue(state, targetRosterId, [], 'desc').slice(0, 4);
        const players = topPlayersFor(state, targetRosterId, 4);
        const liquidity = ownerLiquidityModifier(persona);
        return {
            rosterId: targetRosterId,
            teamName: persona.teamName || ('Team ' + targetRosterId),
            tradeDna: persona.tradeDna || persona.draftDna || null,
            posture: persona.posture || null,
            buyerLine,
            needs,
            strengths,
            window: persona.assessment?.window || '',
            ownerIntel: persona.ownerIntel || null,
            ownerIntelSummary: ownerIntelSummary(persona),
            liquidity,
            movablePicks: picks.map(p => ({
                round: p.round,
                slot: p.slot,
                overall: p.overall,
                value: pickValueFor(state, p),
            })),
            tradablePlayers: players,
        };
    }

    // ── buildSuggestionReasoning — interface contract consumed by ──────
    // command-center.js (trade-up reasoning) AND the proposer's SuggestionRail.
    // Shape: { headline: string, drivers: [{ label, detail, tone }] }
    // where tone ∈ 'good' | 'bad' | 'neutral'. Derived purely from the
    // evaluation object already computed — never recomputes value tables.
    function buildSuggestionReasoning(state, persona, evaluation, opts = {}) {
        const drivers = [];
        const myGiveDHQ = Math.round(Number(evaluation?.myGiveDHQ || 0));
        const theirGiveDHQ = Math.round(Number(evaluation?.theirGiveDHQ || 0));
        const acquired = opts.acquiredPick || null;
        const acquiredVal = acquired ? pickValueFor(state, acquired) : theirGiveDHQ;
        const slotLabel = acquired
            ? 'R' + acquired.round + '.' + String(acquired.slot || 0).padStart(2, '0')
            : 'their slot';

        // Net DHQ — what you pay vs the value you acquire.
        if (myGiveDHQ > 0 || theirGiveDHQ > 0) {
            const net = theirGiveDHQ - myGiveDHQ;
            drivers.push({
                label: 'Net value',
                detail: 'You pay ~' + myGiveDHQ.toLocaleString() + ', get ~' + theirGiveDHQ.toLocaleString()
                    + (acquired ? ' (' + slotLabel + ' slot)' : ''),
                tone: net >= 0 ? 'good' : (net >= -Math.max(150, myGiveDHQ * 0.08) ? 'neutral' : 'bad'),
            });
        }

        // Timing — the +10% / +5% move-up motive from timingModifier.
        const timingMod = (evaluation?.modifiers || []).find(m => /move-up|pick-window|timing/i.test(m.label || ''));
        if (timingMod && Number(timingMod.impact)) {
            const up = Number(timingMod.impact) > 0;
            drivers.push({
                label: 'Timing',
                detail: (up ? '+' : '') + timingMod.impact + '% — ' + (up ? 'they value moving up' : 'they surrender the earlier window'),
                tone: up ? 'good' : 'bad',
            });
        }

        // Their buyer line / DNA — where the deal has to clear.
        const dnaLabel = persona?.tradeDna?.label || persona?.draftDna?.label || 'Balanced';
        const line = Math.round(Number(evaluation?.acceptanceLine || acceptanceLineFor(state, persona) || 70));
        drivers.push({
            label: 'Buyer line',
            detail: dnaLabel + ' profile clears at ' + line + '%',
            tone: 'neutral',
        });

        // Value cliff / window — why act now on the earlier pick.
        if (acquired) {
            const cliff = opts.cliffNote ? ' ' + opts.cliffNote : '';
            drivers.push({
                label: 'Why now',
                detail: 'Buy the earlier ' + slotLabel + ' window before the tier breaks.' + cliff,
                tone: 'good',
            });
        }

        const likelihood = Math.round(Number(evaluation?.likelihood || 0));
        const cleared = likelihood >= line;
        let headline = opts.headline;
        if (!headline) {
            if (opts.isMoonshot) {
                headline = 'Long shot — you overpay to force the window open.';
            } else if (acquired) {
                headline = cleared
                    ? 'Pay a small premium to jump to ' + slotLabel + ' — it clears their line.'
                    : 'Package your capital against their buyer line for the earlier ' + slotLabel + ' slot.';
            } else {
                headline = cleared
                    ? 'Value and owner profile both say this can get done.'
                    : 'Close, but the package is still light against their buyer line.';
            }
        }
        return { headline, drivers };
    }

    function buildTradeSuggestions(state, targetRosterId, opts = {}) {
        const persona = state.personas?.[targetRosterId];
        const myPersona = state.personas?.[state.userRosterId];
        if (!persona || !myPersona) return [];

        const suggestions = [];
        const seen = new Set();
        const myPicksHigh = remainingPicksByValue(state, state.userRosterId, [], 'desc');
        const myPicksLow = remainingPicksByValue(state, state.userRosterId, [], 'asc');
        const theirPicksLow = remainingPicksByValue(state, targetRosterId, [], 'asc');
        const theirNeeds = personaNeeds(persona);
        const myNeedFits = topPlayersFor(state, state.userRosterId, 4, { matchNeeds: theirNeeds });
        const myTopPlayers = topPlayersFor(state, state.userRosterId, 4);
        const theirTopPlayers = topPlayersFor(state, targetRosterId, 4);

        function push(id, label, intent, rationale, proposal, reasonOpts = {}) {
            if (!proposalHasAssets(proposal)) return null;
            if (!(proposal.myGive || []).length && !(proposal.myGivePlayers || []).length && !proposal.myGiveFaab) return null;
            if (!(proposal.theirGive || []).length && !(proposal.theirGivePlayers || []).length && !proposal.theirGiveFaab) return null;
            const key = proposalKey(proposal);
            if (seen.has(key)) return null;
            seen.add(key);
            const evaluation = evaluateUserProposal(state, proposal, { preview: true, noCounter: true });
            const reasoning = buildSuggestionReasoning(state, persona, evaluation, reasonOpts);
            const suggestion = {
                id,
                label,
                intent,
                rationale,
                reasoning,
                proposal,
                evaluation,
                likelihood: evaluation.likelihood || 0,
                acceptanceLine: evaluation.acceptanceLine || acceptanceLineFor(state, persona),
                verdict: (evaluation.likelihood || 0) >= (evaluation.acceptanceLine || 70) ? 'accepted'
                    : (evaluation.likelihood || 0) >= (evaluation.counterLine || 50) ? 'countered'
                    : 'declined',
                myGiveDHQ: evaluation.myGiveDHQ || 0,
                theirGiveDHQ: evaluation.theirGiveDHQ || 0,
            };
            suggestions.push(suggestion);
            return suggestion;
        }

        // Target the partner's EARLIEST remaining pick (the one literally on the
        // clock when this partner is on the clock), not just their highest-value
        // pick. pickValueFor can return 0 for a slot the value tables miss, which
        // would otherwise sort the on-clock pick last and make Move Up target a
        // later pick — leaving the on-clock window with nothing that acquires it.
        const theirEarliest = remainingPicksFor(state, targetRosterId, [])
            .slice()
            .sort((a, b) => Number(a.overall || 9999) - Number(b.overall || 9999))[0];
        if (theirEarliest) {
            const targetPickValue = pickValueFor(state, theirEarliest);
            let proposal = normalizeProposal(targetRosterId, { theirGive: [theirEarliest] });
            // Build the user's give up to the value that clears the partner's buyer
            // line (scaled by GM's Office sliders), not a flat underpay. Math.max(1, …)
            // keeps the package two-sided even when the pick value resolves to 0.
            proposal = buildGiveToClear(state, persona, proposal, Math.max(1, targetPickValue));
            const earliestLabel = 'R' + theirEarliest.round + '.' + String(theirEarliest.slot || 0).padStart(2, '0');
            push(
                'move-up',
                'Move Up',
                'Buy the earlier ' + earliestLabel + ' window',
                // Fallback rationale only — reasoning.headline (set below) is the
                // dynamic, evaluation-aware version the UI surfaces.
                'Packages your draft capital against their buyer line for an earlier slot.',
                proposal,
                { acquiredPick: theirEarliest }
            );
        }

        if (myPicksHigh[0] && theirPicksLow.length >= 2) {
            let proposal = normalizeProposal(targetRosterId, { myGive: [myPicksHigh[0]] });
            // User receives the partner's picks: take back the most value that still
            // clears their buyer line (tighter line ⇒ less volume comes back).
            proposal = buildReceiveToClear(state, persona, proposal, targetRosterId);
            push(
                'move-down',
                'Move Down',
                'Trade back for volume',
                'Turns your current pick into multiple later bites if their profile wants to climb.',
                proposal
            );
        }

        if (theirTopPlayers[0]) {
            const targetPlayer = theirTopPlayers[0];
            let proposal = normalizeProposal(targetRosterId, { theirGivePlayers: [targetPlayer.pid] });
            // Acquiring their player: build the give up to clear the buyer line.
            proposal = buildGiveToClear(state, persona, proposal, targetPlayer.value);
            push(
                'buy-player',
                'Buy Player',
                'Target a roster asset',
                targetPlayer.name + ' is their highest-value movable asset in the current roster lens.',
                proposal
            );
        }

        const sellPlayer = myNeedFits[0] || myTopPlayers[0];
        if (sellPlayer) {
            let proposal = normalizeProposal(targetRosterId, { myGivePlayers: [sellPlayer.pid] });
            // Selling a player for their picks: take back the most value that clears.
            proposal = buildReceiveToClear(state, persona, proposal, targetRosterId);
            push(
                'sell-player',
                'Sell Player',
                'Offer a player who fits their board',
                theirNeeds.length
                    ? sellPlayer.name + ' addresses their ' + theirNeeds[0] + ' need.'
                    : sellPlayer.name + ' gives them usable roster value.',
                proposal
            );
        }

        const currentProposal = opts.currentProposal;
        if (proposalHasAssets(currentProposal)) {
            const currentEvaluation = evaluateUserProposal(state, currentProposal);
            const counter = currentEvaluation?.counterOffer || buildCounterOffer(state, currentProposal, currentEvaluation);
            const counterProposal = proposalFromOffer(counter);
            if (counterProposal) {
                push(
                    'sweetener',
                    'Add Sweetener',
                    'Load the likely counter',
                    counter.reason || 'Adds the smallest practical sweetener to move the offer toward their buyer line.',
                    counterProposal
                );
            } else if ((currentEvaluation?.likelihood || 0) < (currentEvaluation?.acceptanceLine || 70) && myPicksLow[0]) {
                const sweetened = {
                    ...currentProposal,
                    myGive: [...(currentProposal.myGive || []), myPicksLow[0]],
                };
                push(
                    'sweetener',
                    'Add Sweetener',
                    'Improve a live offer',
                    'Adds a lower-cost pick to raise the acceptance odds.',
                    sweetened
                );
            }
        }

        const ranked = suggestions
            .sort((a, b) => {
                const aClear = a.likelihood >= a.acceptanceLine ? 1 : 0;
                const bClear = b.likelihood >= b.acceptanceLine ? 1 : 0;
                if (aClear !== bClear) return bClear - aClear;
                return b.likelihood - a.likelihood;
            })
            .slice(0, 4);

        // Moonshot fallback: when NO normal package even clears the counter
        // line (all declined, or nothing generated), the user has no path to
        // "get in." Build exactly ONE aggressively-overpaying deal to acquire
        // the partner's earliest pick so the rail always offers a move.
        const hasViable = ranked.some(s => s.verdict !== 'declined');
        if (!hasViable && theirEarliest) {
            const targetPickValue = Math.max(1, pickValueFor(state, theirEarliest));
            const overpayTarget = Math.round(targetPickValue * 1.3);
            let moonshot = normalizeProposal(targetRosterId, { theirGive: [theirEarliest] });
            moonshot = addUserPicksUntil(state, moonshot, overpayTarget, 4);
            // If picks alone can't reach the overpay target, sweeten with FAAB
            // (converted via the same conservative ratio the evaluator uses).
            const shortfall = overpayTarget - proposalValue(state, moonshot, 'my');
            if (shortfall > 0) {
                moonshot = { ...moonshot, myGiveFaab: Math.min(1000, Math.round(shortfall / 0.7)) };
            }
            const moonEval = evaluateUserProposal(state, moonshot, { preview: true, noCounter: true });
            const earliestLabel = 'R' + theirEarliest.round + '.' + String(theirEarliest.slot || 0).padStart(2, '0');
            ranked.push({
                id: 'moonshot',
                label: 'MOONSHOT',
                intent: 'Overpay to force the ' + earliestLabel + ' window open',
                rationale: 'Aggressive overpay — low odds, but the only path in when nothing else clears their line.',
                reasoning: buildSuggestionReasoning(state, persona, moonEval, {
                    acquiredPick: theirEarliest,
                    isMoonshot: true,
                    headline: 'Long shot — you overpay to force the window open.',
                }),
                proposal: moonshot,
                evaluation: moonEval,
                likelihood: moonEval.likelihood || 0,
                acceptanceLine: moonEval.acceptanceLine || acceptanceLineFor(state, persona),
                verdict: (moonEval.likelihood || 0) >= (moonEval.acceptanceLine || 70) ? 'accepted'
                    : (moonEval.likelihood || 0) >= (moonEval.counterLine || 50) ? 'countered'
                    : 'declined',
                myGiveDHQ: moonEval.myGiveDHQ || 0,
                theirGiveDHQ: moonEval.theirGiveDHQ || 0,
                isMoonshot: true,
            });
        }

        return ranked;
    }

    function buildLiveTradeWindows(state, opts = {}) {
        if (!state || state.phase !== 'drafting') return [];
        const lookahead = Math.max(1, Math.min(12, opts.lookahead || 6));
        const currentOnly = !!opts.currentOnly;
        const userRosterId = idKey(state.userRosterId);
        const seen = new Set();
        const windows = [];
        const slots = (state.pickOrder || []).slice(state.currentIdx || 0, (state.currentIdx || 0) + (currentOnly ? 1 : lookahead));

        slots.forEach((slot, idx) => {
            const rosterId = idKey(slot?.rosterId);
            if (!rosterId || rosterId === userRosterId || seen.has(rosterId)) return;
            seen.add(rosterId);
            const profile = describeTradePartner(state, slot.rosterId);
            if (!profile) return;
            const suggestions = buildTradeSuggestions(state, slot.rosterId);
            if (!suggestions.length) return;
            // For the team on the clock (idx === 0), the window MUST headline a
            // trade that actually acquires the pick on the clock. Otherwise the
            // banner names the on-clock pick but recommends an unrelated package
            // (Sell Player / Move Down / Buy Player), because "Move Up" is the
            // costliest, lowest-acceptance option and loses the single headline slot
            // under a pure likelihood sort. Prefer the acquires-on-clock suggestion;
            // fall back to the old heuristic only if none exists.
            const onClockKey = pickKey(slot);
            const acquiresOnClock = s => (s.proposal?.theirGive || []).some(p => pickKey(p) === onClockKey);
            const clears = s => s.likelihood >= s.acceptanceLine;
            const countered = s => s.verdict === 'countered';
            // 'declined' = below the partner's counter line — a non-starter not worth
            // surfacing as a recommendation.
            const isViable = s => !!s && s.verdict !== 'declined';
            let best, viable;
            if (idx === 0) {
                best = suggestions.find(s => acquiresOnClock(s) && clears(s))
                    || suggestions.find(s => acquiresOnClock(s) && countered(s))
                    || suggestions.find(acquiresOnClock)
                    || suggestions[0];
                // Viable only when the headline both acquires the on-clock pick AND
                // clears the partner's counter line. A 14%-acceptance Move Up (or no
                // acquiring package at all) is flagged non-viable so the banner can
                // read "No viable trade" instead of a misleading low-odds rec.
                viable = isViable(best) && acquiresOnClock(best);
            } else {
                best = suggestions.find(clears) || suggestions.find(countered) || suggestions[0];
                viable = isViable(best);
            }
            if (!best) return;
            windows.push({
                rosterId: slot.rosterId,
                teamName: profile.teamName,
                profile,
                suggestion: best,
                suggestions,
                likelihood: best.likelihood,
                acceptanceLine: best.acceptanceLine,
                verdict: best.verdict,
                viable,
                onClock: idx === 0,
                picksAway: idx,
                pickLabel: 'R' + slot.round + '.' + String(slot.slot || 0).padStart(2, '0'),
                overall: slot.overall,
                motive: best.intent || best.label,
                reason: best.rationale,
                // Trade-up reasoning contract (consumed by command-center.js):
                // { headline, drivers:[{ label, detail, tone }] }.
                reasoning: best.reasoning || null,
            });
        });

        return windows.sort((a, b) => {
            if (a.onClock !== b.onClock) return a.onClock ? -1 : 1;
            const aClear = a.likelihood >= a.acceptanceLine ? 1 : 0;
            const bClear = b.likelihood >= b.acceptanceLine ? 1 : 0;
            if (aClear !== bClear) return bClear - aClear;
            if (a.picksAway !== b.picksAway) return a.picksAway - b.picksAway;
            return b.likelihood - a.likelihood;
        });
    }

    function offerShape(state, proposal, result, reason, extra = {}) {
        const targetPersona = result.theirPersona || state.personas?.[proposal.targetRosterId] || {};
        const targetOverall = earliestOverall(proposal.myGive);
        return {
            fromRosterId: proposal.targetRosterId,
            fromName: targetPersona.teamName || ('Team ' + proposal.targetRosterId),
            toRosterId: state.userRosterId,
            theirGive: proposal.theirGive || [],
            myGive: proposal.myGive || [],
            theirGivePlayers: proposal.theirGivePlayers || [],
            myGivePlayers: proposal.myGivePlayers || [],
            theirGiveFaab: proposal.theirGiveFaab || 0,
            myGiveFaab: proposal.myGiveFaab || 0,
            theirGainDHQ: result.myGiveDHQ,
            theirGiveDHQ: result.theirGiveDHQ,
            myGainDHQ: result.theirGiveDHQ,
            myGiveDHQ: result.myGiveDHQ,
            likelihood: result.likelihood,
            acceptanceLine: result.acceptanceLine,
            counterLine: result.counterLine,
            grade: result.grade,
            taxes: result.taxes,
            modifiers: result.modifiers,
            reason,
            dnaLabel: targetPersona.tradeDna?.label || targetPersona.draftDna?.label || 'Balanced',
            ownerIntel: targetPersona.ownerIntel || null,
            rawDhqDelta: result.rawDhqDelta,
            negotiationRead: result.negotiationRead || negotiationReadFor(result),
            targetPickOverall: targetOverall,
            createdAtPickIdx: state.currentIdx || 0,
            ...extra,
        };
    }

    function buildCounterOffer(state, proposal, evaluation) {
        if (!proposal || !evaluation?.theirPersona) return null;
        const current = { ...proposal };
        const userPicks = remainingPicksFor(state, state.userRosterId, current.myGive);
        const candidates = [];

        userPicks.slice(0, 5).forEach(pick => {
            candidates.push({
                ...current,
                myGive: [...(current.myGive || []), pick],
                counterReason: 'They want a pick sweetener to clear their buyer line.',
            });
        });

        [25, 50, 100].forEach(faab => {
            if ((current.myGiveFaab || 0) < faab) {
                candidates.push({
                    ...current,
                    myGiveFaab: faab,
                    counterReason: 'They want FAAB added as a low-friction sweetener.',
                });
            }
        });

        if ((current.theirGive || []).length > 1) {
            const byValue = (current.theirGive || []).slice().sort((a, b) => pickValueFor(state, a) - pickValueFor(state, b));
            candidates.push({
                ...current,
                theirGive: (current.theirGive || []).filter(p => pickKey(p) !== pickKey(byValue[0])),
                counterReason: 'They will deal if they keep the smaller outgoing pick.',
            });
        }

        let best = null;
        candidates.forEach(candidate => {
            const result = computeProposalEvaluation(state, candidate);
            const improvement = result.likelihood - evaluation.likelihood;
            if (result.likelihood < evaluation.counterLine && improvement < 8) return;
            if (!best || result.likelihood > best.result.likelihood || (result.likelihood === best.result.likelihood && result.myGiveDHQ < best.result.myGiveDHQ)) {
                best = { candidate, result };
            }
        });

        if (!best) return null;
        const reason = best.candidate.counterReason || 'They countered with a package closer to their buyer line.';
        return offerShape(state, best.candidate, best.result, reason, {
            countered: true,
            originalLikelihood: evaluation.likelihood,
        });
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

        // Probability roll — controlled by the mock draft tuning panel.
        const offerRate = cpuOfferRate(state);
        if (offerRate <= 0 || (!opts.force && Math.random() > offerRate)) return null;

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

        // CPU wants to move up: ask for the user's next pick and pay with
        // enough later capital that the user can still plausibly accept.
        const myTargetPick = myPicks[0];
        const theirFirst = theirPicks[0];
        if (!myTargetPick || !theirFirst) return null;
        const proposal = {
            targetRosterId: justPickedRosterId,
            myGive: [myTargetPick],
            theirGive: [theirFirst],
            myGivePlayers: [],
            theirGivePlayers: [],
            myGiveFaab: 0,
            theirGiveFaab: 0,
        };
        const userPickValue = pickValueFor(state, myTargetPick);
        let outgoingValue = pickValueFor(state, theirFirst);
        theirPicks.slice(1).forEach(pick => {
            if (outgoingValue >= userPickValue * 0.88) return;
            proposal.theirGive.push(pick);
            outgoingValue += pickValueFor(state, pick);
        });

        const evaluation = computeProposalEvaluation(state, proposal);
        if (evaluation.likelihood < Math.max(evaluation.counterLine, evaluation.acceptanceLine - 18)) return null;

        const theirNeeds = (theirPersona.assessment?.needs || [])
            .map(n => (typeof n === 'string' ? n : n?.pos))
            .filter(Boolean);
        const dnaLabel = theirPersona.draftDna?.label || theirPersona.tradeDna?.label || 'Balanced';
        const reason = theirNeeds.length > 0
            ? `They need ${theirNeeds[0]} and want to move up for earlier capital.`
            : `${dnaLabel} — looking to acquire earlier capital.`;
        const intelReason = ownerIntelSummary(theirPersona);

        return offerShape(state, proposal, evaluation, intelReason ? `${reason} Historical intel: ${intelReason}.` : reason, {
            cpuInitiated: true,
            cpuMessage: evaluation.negotiationRead?.message || null,
        });
    }

    /**
     * evaluateUserProposal — CPU evaluates a user-initiated proposal.
     *
     * @param {DraftState} state
     * @param {Object} proposal — { targetRosterId, myGive: [picks], theirGive: [picks] }
     * @returns {Object} { accepted, likelihood, grade, taxes }
     */
    function evaluateUserProposal(state, proposal, opts = {}) {
        const result = computeProposalEvaluation(state, proposal);
        const theirPersona = result.theirPersona || state.personas?.[proposal?.targetRosterId];
        if (!theirPersona) return { accepted: false, verdict: 'declined', likelihood: 0, grade: null, taxes: [], modifiers: [] };

        if (result.realism?.blocked) {
            const blockers = (result.realism.flags || [])
                .filter(flag => flag.severity === 'blocker')
                .map(flag => flag.label)
                .filter(Boolean);
            return {
                ...result,
                accepted: false,
                verdict: 'declined',
                counterOffer: null,
                reason: 'Trade package is not valid in the current draft state' + (blockers.length ? ': ' + blockers.join(', ') + '.' : '.'),
                ownerIntel: theirPersona.ownerIntel || null,
            };
        }

        if (theirPersona.posture?.key === 'LOCKED') {
            const locked = {
                ...result,
                likelihood: Math.min(20, result.likelihood),
                accepted: false,
                verdict: 'declined',
                reason: 'Locked roster profile: this team is not motivated enough to move the requested assets.',
                ownerIntel: theirPersona.ownerIntel || null,
            };
            return locked;
        }

        const accepted = result.likelihood >= result.acceptanceLine;
        const counterOffer = accepted || opts.noCounter ? null : buildCounterOffer(state, proposal, result);
        const verdict = accepted ? 'accepted' : counterOffer ? 'countered' : 'declined';
        const intelReason = ownerIntelSummary(theirPersona);
        const reason = accepted
            ? 'Offer clears the buyer line for this Owner DNA profile.'
            : counterOffer
                ? 'Offer misses the buyer line, but it is close enough for a counter.'
                : 'Offer does not clear value, Owner DNA, or roster-context thresholds.';

        return {
            ...result,
            accepted,
            verdict,
            counterOffer,
            reason: intelReason ? reason + ' Historical intel: ' + intelReason + '.' : reason,
            ownerIntel: theirPersona.ownerIntel || null,
        };
    }

    function validateActiveOffer(state, offer) {
        if (!offer) return { valid: false, reason: 'No active offer is loaded.' };
        const currentOverall = Number(state?.pickOrder?.[state.currentIdx]?.overall || (state?.currentIdx || 0) + 1);
        const targetOverall = Number(offer.targetPickOverall || earliestOverall(offer.myGive) || 0);
        if (targetOverall && currentOverall > targetOverall) {
            return {
                valid: false,
                reason: 'This offer was for pick #' + targetOverall + ', but the room has moved to pick #' + currentOverall + '.',
                flags: [{ severity: 'blocker', code: 'expired_pick_window', label: 'Expired pick window' }],
            };
        }
        const proposal = proposalFromOffer(offer);
        const realism = validateProposalRealism(state, proposal);
        if (realism.blocked) {
            const labels = realism.flags
                .filter(flag => flag.severity === 'blocker')
                .map(flag => flag.label)
                .filter(Boolean);
            return {
                valid: false,
                reason: 'This deal is stale: ' + (labels.length ? labels.join(', ') : 'one or more assets are no longer available') + '.',
                flags: realism.flags,
            };
        }
        return { valid: true, reason: 'Offer is live.' };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.tradeSimulator = {
        maybeGenerateTradeOffer,
        evaluateUserProposal,
        computeProposalEvaluation,
        buildCounterOffer,
        buildTradeSuggestions,
        buildSuggestionReasoning,
        buildLiveTradeWindows,
        describeTradePartner,
        validateProposalRealism,
        validateActiveOffer,
        offerShape,
        negotiationReadFor,
        acceptanceLineFor,
        giveTargetMultiplier,
        needFitFor,
        pickValueFor,
        sumPickValue,
        playerValueFor,
        sumPlayerValue,
        faabToDhq,
        effectiveRosterPlayers,
        topPlayersFor,
        TRADE_COOLDOWN_PICKS,
        BASE_TRADE_RATE,
        tradeActivityFor,
        historicalDraftPickTradeSignal,
        cpuOfferTradeActivityFor,
        cpuOfferRate,
    };
})();

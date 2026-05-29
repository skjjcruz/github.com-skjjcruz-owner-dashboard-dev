// ================================================================
// js/draft/live-decision-engine.js - P3 live draft decision deck
//
// Builds the "what do I do right now?" layer for live/manual draft
// command mode. Pure functions only; UI lives in command-center.js.
// ================================================================

(function() {
    'use strict';

    const SCHEMA = 'draft-live-decision-v1';
    const TARGET_TAGS = new Set(['target', 'must', 'sleeper']);
    const FADE_TAGS = new Set(['fade', 'avoid']);

    function idKey(value) {
        return value == null ? '' : String(value);
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function num(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function posOf(player) {
        return player?.pos || player?.position || player?.csv?.pos || '';
    }

    function rankMap(order) {
        const out = {};
        asArray(order).forEach((pid, idx) => {
            const key = idKey(pid);
            if (key && out[key] == null) out[key] = idx + 1;
        });
        return out;
    }

    function activeLane(boardContext) {
        const lane = boardContext?.activeLane || 'dhq';
        return boardContext?.lanes?.[lane] ? lane : 'dhq';
    }

    function boardEntry(boardContext, player) {
        return boardContext?.entries?.[idKey(player?.pid)] || {};
    }

    function boardRank(boardContext, player, lane) {
        const entry = boardEntry(boardContext, player);
        if (lane === 'my') return entry.myRank || null;
        if (lane === 'ai') return entry.aiRank || null;
        return entry.dhqRank || player?.consensusRank || null;
    }

    function isTarget(entry) {
        return !!entry?.target || TARGET_TAGS.has(entry?.tag);
    }

    function isFade(entry) {
        return !!entry?.fade || FADE_TAGS.has(entry?.tag);
    }

    function ageOf(player) {
        const direct = num(player?.age || player?.csv?.age, 0);
        if (direct) return direct;
        const bd = player?.birth_date || player?.birthDate;
        if (!bd) return 0;
        const ms = Date.now() - new Date(bd).getTime();
        return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 31557600000) : 0;
    }

    function projectedValue(player, years) {
        const dhq = num(player?.dhq || player?.val, 0);
        if (!dhq) return 0;
        const project = window.App?.PlayerValue?.projectPlayerValue;
        const age = ageOf(player);
        if (typeof project !== 'function' || !age) return dhq;
        try {
            return num(project(player.pid, dhq, age, posOf(player), years), dhq);
        } catch (_) {
            return dhq;
        }
    }

    function nextUserPick(state) {
        const userRosterId = idKey(state?.userRosterId);
        const userSlot = num(state?.userSlot, 0);
        const currentIdx = num(state?.currentIdx, 0);
        const order = asArray(state?.pickOrder);
        for (let idx = currentIdx; idx < order.length; idx++) {
            const slot = order[idx];
            const byRoster = userRosterId && idKey(slot?.rosterId) === userRosterId;
            const bySlot = state?.mode !== 'live-sync' && userSlot && num(slot?.slot, 0) === userSlot;
            if (byRoster || bySlot) {
                return { slot, index: idx, picksAway: Math.max(0, idx - currentIdx) };
            }
        }
        return null;
    }

    function currentPersona(state) {
        const slot = asArray(state?.pickOrder)[num(state?.currentIdx, 0)] || null;
        if (!slot) return null;
        return state?.personas?.[slot.rosterId] || state?.personas?.[String(slot.rosterId)] || null;
    }

    function userNeedMap(state) {
        const userPersona = state?.personas?.[state?.userRosterId] || state?.personas?.[String(state?.userRosterId)] || null;
        const intel = userPersona?.ownerIntel || state?.draftContext?.ownerContext?.[String(state?.userRosterId)] || {};
        const needs = asArray(userPersona?.assessment?.needs || intel?.roster?.needs || state?.draftContext?.teamContext?.needs);
        const out = {};
        needs.forEach((need, idx) => {
            const pos = typeof need === 'string' ? need : need?.pos;
            if (!pos) return;
            const urgent = /critical|deficit|thin|priority/i.test(String(need?.urgency || need?.label || ''));
            out[pos] = Math.max(out[pos] || 0, urgent ? 22 : 14 - Math.min(idx, 4));
        });
        return out;
    }

    function decorateCandidate(state, player, idx, lane, rankLookup) {
        const boardContext = state?.draftContext?.boardContext || {};
        const entry = boardEntry(boardContext, player);
        const rank = boardRank(boardContext, player, lane) || rankLookup[idKey(player?.pid)] || idx + 1;
        const dhq = num(player?.dhq || player?.val, 0);
        const y5 = projectedValue(player, 5);
        const growth = y5 - dhq;
        const tagTarget = isTarget(entry);
        const tagFade = isFade(entry);
        const tier = entry.tier || player?.tier || player?.csv?.tier || null;
        const needs = userNeedMap(state);
        const needBoost = needs[posOf(player)] || 0;
        const score = dhq / 100
            + needBoost
            + (tagTarget ? 24 : 0)
            - (tagFade ? 42 : 0)
            + Math.max(-12, Math.min(18, growth / 180))
            - Math.max(0, rank - 1) * 0.45
            - (tier ? Math.max(0, tier - 1) * 2 : 0);
        return {
            player,
            entry,
            rank,
            dhq,
            y5,
            growth,
            tier,
            target: tagTarget,
            fade: tagFade,
            needBoost,
            score,
        };
    }

    function candidates(state, limit = 36) {
        const boardContext = state?.draftContext?.boardContext || {};
        const lane = activeLane(boardContext);
        const rankLookup = rankMap(boardContext?.lanes?.[lane]?.order || []);
        return asArray(state?.pool)
            .filter(p => p?.pid && !state?.draftedPids?.[p.pid])
            .map((p, idx) => decorateCandidate(state, p, idx, lane, rankLookup))
            .sort((a, b) => (a.rank - b.rank) || (b.dhq - a.dhq))
            .slice(0, limit);
    }

    function card(kind, label, candidate, detail, tone = 'gold', extra = {}) {
        if (!candidate?.player) return null;
        return {
            kind,
            label,
            tone,
            player: {
                pid: candidate.player.pid,
                name: candidate.player.name || candidate.player.full_name || candidate.player.pid,
                pos: posOf(candidate.player),
                dhq: candidate.dhq,
                y5: candidate.y5,
                tier: candidate.tier,
                rank: candidate.rank,
                tag: candidate.entry?.tag || null,
            },
            detail,
            drivers: extra.drivers || [],
            action: extra.action || 'player',
            meta: extra.meta || {},
        };
    }

    function pickCards(state, tradeWindow) {
        const rows = candidates(state, 40);
        const clean = rows.filter(c => !c.fade);
        const recommended = clean.slice().sort((a, b) => b.score - a.score)[0] || rows[0];
        const safe = clean.slice().sort((a, b) => {
            const stabilityA = a.dhq + (a.tier ? (8 - Math.min(8, a.tier)) * 90 : 0) + Math.min(0, a.growth);
            const stabilityB = b.dhq + (b.tier ? (8 - Math.min(8, b.tier)) * 90 : 0) + Math.min(0, b.growth);
            return stabilityB - stabilityA;
        })[0] || recommended;
        const upside = clean.slice().sort((a, b) => {
            const upA = a.growth + (a.target ? 450 : 0) + (ageOf(a.player) && ageOf(a.player) <= 24 ? 200 : 0);
            const upB = b.growth + (b.target ? 450 : 0) + (ageOf(b.player) && ageOf(b.player) <= 24 ? 200 : 0);
            return upB - upA;
        })[0] || recommended;
        const avoid = rows.find(c => c.fade)
            || rows.find(c => c.dhq > 0 && c.y5 > 0 && c.y5 < c.dhq * 0.65)
            || null;

        const cards = [
            card('recommended', 'Recommended', recommended, 'Best blend of board value, roster fit, and five-year value.', 'gold', {
                drivers: ['board_rank', recommended?.needBoost ? 'roster_need' : 'value', recommended?.target ? 'user_target' : 'projection'],
            }),
            card('safe', 'Safe Pick', safe, 'High-floor value that keeps the room honest.', 'green', {
                drivers: ['dhq_value', safe?.tier ? 'tier' : 'board_rank'],
            }),
            card('upside', 'Upside Swing', upside, upside?.growth > 0 ? 'Best five-year value gain in the current pocket.' : 'Best ceiling profile in this pocket.', 'purple', {
                drivers: ['y5_projection', upside?.target ? 'user_target' : 'age_curve'],
            }),
        ].filter(Boolean);

        if (tradeWindow) {
            cards.push({
                kind: 'trade_down',
                label: 'Trade Window',
                tone: tradeWindow.likelihood >= tradeWindow.acceptanceLine ? 'green' : 'amber',
                player: null,
                detail: `${tradeWindow.teamName || 'Owner'} · ${tradeWindow.likelihood || 0}% vs ${tradeWindow.acceptanceLine || 70}% Buyer Line`,
                drivers: ['owner_trade_intel', 'board_tier', 'buyer_line'],
                action: 'trade',
                meta: { rosterId: tradeWindow.rosterId, tradeWindow },
            });
        }

        if (avoid) {
            const reason = avoid.fade
                ? 'User-board fade or do-not-draft flag is active.'
                : 'Current value is materially ahead of five-year projection.';
            cards.push(card('avoid', 'Avoid Warning', avoid, reason, 'red', {
                drivers: [avoid.fade ? 'user_board' : 'projection_risk'],
            }));
        }

        return cards.slice(0, 5);
    }

    function tierAlert(rows) {
        const first = rows.find(c => c.tier);
        if (!first) return null;
        const sameTier = rows.filter(c => String(c.tier) === String(first.tier));
        if (sameTier.length > 3) return null;
        return {
            type: 'tier_cliff',
            tone: sameTier.length <= 1 ? 'red' : 'amber',
            title: `Tier ${first.tier} cliff`,
            text: `${sameTier.length} player${sameTier.length === 1 ? '' : 's'} left in the top tier of this pocket.`,
        };
    }

    function targetSurvivalAlert(state, rows) {
        const next = nextUserPick(state);
        if (!next || next.picksAway <= 0) return null;
        const target = rows.find(c => c.target);
        if (!target) return null;
        if (target.rank > next.picksAway + 2) return null;
        return {
            type: 'target_survival',
            tone: 'red',
            title: 'Target at risk',
            text: `${target.player.name || 'Your target'} is unlikely to survive ${next.picksAway} pick${next.picksAway === 1 ? '' : 's'} to your next turn.`,
            player: target.player,
        };
    }

    function ownerAlert(state) {
        const persona = currentPersona(state);
        const intel = persona?.ownerIntel || state?.draftContext?.ownerContext?.[String(persona?.rosterId || '')] || null;
        const reason = asArray(intel?.reasonCodes)[0];
        if (!persona || !reason) return null;
        return {
            type: 'owner_tendency',
            tone: intel?.confidence?.overall === 'high' ? 'green' : 'amber',
            title: `${persona.teamName || 'On-clock owner'} tell`,
            text: reason.detail || reason.label || 'Historical owner intel is influencing this read.',
        };
    }

    function buildDecisionDeck(state, opts = {}) {
        const rows = candidates(state, 40);
        const next = nextUserPick(state);
        const currentSlot = asArray(state?.pickOrder)[num(state?.currentIdx, 0)] || null;
        const cards = pickCards(state, opts.tradeWindow || null);
        const alerts = [tierAlert(rows), targetSurvivalAlert(state, rows), ownerAlert(state)].filter(Boolean).slice(0, 3);
        return {
            schemaVersion: SCHEMA,
            mode: state?.mode || '',
            currentPick: currentSlot,
            nextUserPick: next,
            cards,
            alerts,
            assumptions: {
                boardLane: activeLane(state?.draftContext?.boardContext || {}),
                poolSize: asArray(state?.pool).length,
                generatedAt: new Date().toISOString(),
            },
        };
    }

    window.DraftCC = window.DraftCC || {};
    window.DraftCC.liveDecisionEngine = {
        buildDecisionDeck,
        _private: {
            candidates,
            nextUserPick,
            projectedValue,
            isFade,
            isTarget,
        },
    };
})();

// js/tabs/global-view.js - Empire portfolio command center
// Cross-league asset allocation, exposure, age-window, pick capital, and drilldown workspaces.

function buildEmpirePortfolioModel(input) {
    input = input || {};
    const allLeagues = input.allLeagues || [];
    const playersData = input.playersData || {};
    const sleeperUserId = input.sleeperUserId;
    const scores = input.scores || {};
    const normPos = input.normPos || function(pos) { return pos || '?'; };
    const posLabel = input.posLabel || function(pos) { return pos === 'DEF' ? 'D/ST' : (pos || '?'); };
    const getAgeCurve = input.getAgeCurve || function(pos) {
        const peak = (input.peakWindows || {})[pos] || [24, 29];
        return { build: [22, Math.max(22, peak[0] - 1)], peak, decline: [peak[1] + 1, peak[1] + 3] };
    };
    const tradeValueTier = input.tradeValueTier || function(val) {
        if (val >= 7000) return { tier: 'Elite', col: 'var(--k-2ecc71, #2ecc71)' };
        if (val >= 4000) return { tier: 'Starter', col: 'var(--k-3498db, #3498db)' };
        if (val >= 2000) return { tier: 'Depth', col: 'var(--k-d4af37, #d4af37)' };
        if (val > 0) return { tier: 'Stash', col: 'var(--ov-9, rgba(255,255,255,0.58))' };
        return { tier: 'Unscored', col: 'var(--ov-8, rgba(255,255,255,0.38))' };
    };
    const assessTeam = input.assessTeam;
    const nowYear = parseInt(input.nowYear || new Date().getFullYear(), 10);

    const provinces = [];
    const assets = [];
    const picks = [];
    const positionTotals = {};
    const ageTotals = {};
    const tierTotals = {};
    const strategyTotals = { contender: 0, fringe: 0, rebuild: 0, unknown: 0 };
    let missingPlayerMeta = 0;
    let rosterLeagueCount = 0;
    let pickFeedLeagueCount = 0;
    let assessedLeagueCount = 0;

    function sameId(a, b) {
        return a != null && b != null && String(a) === String(b);
    }
    function leagueId(league) {
        return league?.id || league?.league_id || league?.leagueId || '';
    }
    function tierColor(tier) {
        if (tier === 'ELITE') return 'var(--k-2ecc71, #2ecc71)';
        if (tier === 'CONTENDER') return 'var(--k-3498db, #3498db)';
        if (tier === 'CROSSROADS') return 'var(--k-f0a500, #f0a500)';
        if (tier === 'REBUILDING') return 'var(--k-e74c3c, #e74c3c)';
        return 'var(--ov-9, rgba(255,255,255,0.46))';
    }
    function statusFromTier(tier) {
        if (tier === 'ELITE' || tier === 'CONTENDER') return 'contender';
        if (tier === 'CROSSROADS') return 'fringe';
        if (tier === 'REBUILDING') return 'rebuild';
        return 'unknown';
    }
    function agePhaseFor(pos, age) {
        if (!age || !Number.isFinite(Number(age))) return { key: 'unknown', label: 'Unknown', color: 'var(--ov-8, rgba(255,255,255,0.38))' };
        const curve = getAgeCurve(pos) || {};
        const peak = curve.peak || [24, 29];
        const decline = curve.decline || [peak[1] + 1, peak[1] + 3];
        if (age < peak[0]) return { key: 'build', label: 'Build', color: 'var(--k-4ecdc4, #4ecdc4)' };
        if (age <= peak[1]) return { key: 'peak', label: 'Peak', color: 'var(--k-2ecc71, #2ecc71)' };
        if (age <= decline[1]) return { key: 'value', label: 'Value', color: 'var(--k-f0a500, #f0a500)' };
        return { key: 'post', label: 'Post-window', color: 'var(--k-e74c3c, #e74c3c)' };
    }
    function addTotal(map, key, patch) {
        const safeKey = key || 'unknown';
        if (!map[safeKey]) map[safeKey] = { key: safeKey, label: patch.label || safeKey, count: 0, dhq: 0, color: patch.color };
        map[safeKey].count += patch.count || 0;
        map[safeKey].dhq += patch.dhq || 0;
        if (patch.color) map[safeKey].color = patch.color;
        if (patch.label) map[safeKey].label = patch.label;
    }
    // League-independent industry pick value (DHQ scale, ~7500 at 1.01), using a mid-round
    // pick — the same getIndustryPickValue model the rest of the app uses for picks (e.g.
    // league-detail/compare). Replaces an arbitrary off-scale ladder so Empire pick capital
    // is DHQ-valued and comparable to player DHQ. Falls back to an industry-anchored ladder.
    function pickValue(round, teams, rounds) {
        const t = teams || 12;
        const r = rounds || 4;
        if (typeof window !== 'undefined' && typeof window.getIndustryPickValue === 'function') {
            return window.getIndustryPickValue((round - 1) * t + Math.ceil(t / 2), t, r);
        }
        return ({ 1: 6200, 2: 3000, 3: 1500, 4: 750, 5: 380 }[round]) || 150;
    }

    allLeagues.forEach(league => {
        const rosters = league?.rosters || [];
        if (rosters.length) rosterLeagueCount++;
        const myRoster = rosters.find(r => sameId(r.owner_id, sleeperUserId) || sameId(r.owner_id, league?.myUserId) || sameId(r.roster_id, league?.myRosterId));
        if (!myRoster) return;

        const rosterPlayers = myRoster.players || [];
        // Health/tier must come from the per-league assessment. app.js runs
        // assessAllTeams(league.rosters, …, league, …) with the explicit league object and
        // stashes the result on league.empireAssessments. Prefer that over the single-league
        // window.S global accessor (assessTeam=assessTeamFromGlobal), which in Empire mode
        // reads an unset S.currentLeagueId (so leagueInfo is undefined) and resolves rosters
        // from a cross-league S.rosters array deduped by roster_id — but Sleeper roster_ids
        // are 1..N PER league, so leagues collide and the health score is computed against
        // the wrong roster. Fall back to the global accessor only until assessments load.
        const leagueAssessments = league?.empireAssessments || [];
        let assessment = leagueAssessments.find(a => sameId(a.rosterId, myRoster.roster_id) || sameId(a.ownerId, myRoster.owner_id)) || null;
        if (!assessment && typeof assessTeam === 'function') assessment = assessTeam(myRoster.roster_id, league);
        if (assessment) assessedLeagueCount++;
        const healthScore = assessment?.healthScore ?? null;
        const tier = assessment?.tier || 'UNKNOWN';
        const status = statusFromTier(tier);
        strategyTotals[status] = (strategyTotals[status] || 0) + 1;
        const wins = myRoster.settings?.wins || league?.wins || 0;
        const losses = myRoster.settings?.losses || league?.losses || 0;
        const totalDHQ = rosterPlayers.reduce((sum, pid) => sum + (scores[pid] || 0), 0);
        const ranked = rosters.slice().sort((a, b) => {
            const av = (a.players || []).reduce((sum, pid) => sum + (scores[pid] || 0), 0);
            const bv = (b.players || []).reduce((sum, pid) => sum + (scores[pid] || 0), 0);
            return bv - av;
        });
        const powerRank = ranked.findIndex(r => sameId(r.roster_id, myRoster.roster_id)) + 1;
        const province = {
            id: leagueId(league),
            name: league?.name || 'League',
            league,
            roster: myRoster,
            players: rosterPlayers,
            teams: rosters.length || league?.total_rosters || 0,
            wins,
            losses,
            totalDHQ,
            avgDHQ: rosterPlayers.length ? Math.round(totalDHQ / rosterPlayers.length) : 0,
            healthScore,
            tier,
            tierColor: tierColor(tier),
            status,
            needs: (assessment?.needs || []).slice(0, 3).map(n => typeof n === 'string' ? n : n.pos || n.label).filter(Boolean),
            strengths: (assessment?.strengths || []).slice(0, 3).map(s => typeof s === 'string' ? s : s.pos || s.label).filter(Boolean),
            powerRank: powerRank || null,
            pickCount: 0,
            premiumPickCount: 0,
            acquiredPickCount: 0,
            ownPickCount: 0,
            pickScore: 0,
            pickFeedPresent: Array.isArray(league?.tradedPicks),
        };
        provinces.push(province);
        if (province.pickFeedPresent) pickFeedLeagueCount++;

        rosterPlayers.forEach(pid => {
            const player = playersData?.[pid];
            if (!player || !(player.full_name || player.first_name || player.last_name)) {
                missingPlayerMeta++;
                return;
            }
            const pos = normPos(player.position) || player.position || '?';
            const age = player.age || null;
            const dhq = scores[pid] || 0;
            const phase = agePhaseFor(pos, age);
            const valueTier = tradeValueTier(dhq) || { tier: 'Unscored', col: 'var(--ov-8, rgba(255,255,255,0.38))' };
            const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ');
            const asset = {
                pid,
                name,
                pos,
                team: player.team || 'FA',
                age,
                dhq,
                tier: valueTier.tier || 'Unscored',
                tierColor: valueTier.col || 'var(--ov-8, rgba(255,255,255,0.38))',
                agePhase: phase.key,
                agePhaseLabel: phase.label,
                agePhaseColor: phase.color,
                leagueId: province.id,
                leagueName: province.name,
                leagueStatus: status,
                leagueTier: tier,
                healthScore,
                powerRank: province.powerRank,
                exposureCount: 1,
                exposurePct: 0,
            };
            assets.push(asset);
            addTotal(positionTotals, pos, { label: posLabel(pos), count: 1, dhq, color: input.posColors?.[pos] });
            addTotal(ageTotals, phase.key, { label: phase.label, count: 1, dhq, color: phase.color });
            addTotal(tierTotals, asset.tier, { label: asset.tier, count: 1, dhq, color: asset.tierColor });
        });

        const tradedPicks = Array.isArray(league?.tradedPicks) ? league.tradedPicks : [];
        const draftRounds = league?.settings?.draft_rounds || 4;
        const startYear = parseInt(league?.season || nowYear, 10);
        for (let year = startYear; year <= startYear + 2; year++) {
            for (let round = 1; round <= draftRounds; round++) {
                const tradedAway = tradedPicks.find(tp =>
                    parseInt(tp.season, 10) === year &&
                    Number(tp.round) === Number(round) &&
                    sameId(tp.roster_id, myRoster.roster_id) &&
                    !sameId(tp.owner_id, myRoster.roster_id)
                );
                if (!tradedAway) {
                    const own = { leagueId: province.id, leagueName: province.name, year, round, own: true, acquired: false, score: pickValue(round, province.teams, draftRounds) };
                    picks.push(own);
                    province.pickCount++;
                    province.ownPickCount++;
                    province.pickScore += own.score;
                    if (round <= 2) province.premiumPickCount++;
                }
                tradedPicks.filter(tp =>
                    parseInt(tp.season, 10) === year &&
                    Number(tp.round) === Number(round) &&
                    sameId(tp.owner_id, myRoster.roster_id) &&
                    !sameId(tp.roster_id, myRoster.roster_id)
                ).forEach(() => {
                    const acquired = { leagueId: province.id, leagueName: province.name, year, round, own: false, acquired: true, score: pickValue(round, province.teams, draftRounds) };
                    picks.push(acquired);
                    province.pickCount++;
                    province.acquiredPickCount++;
                    province.pickScore += acquired.score;
                    if (round <= 2) province.premiumPickCount++;
                });
            }
        }
    });

    const ownershipMap = {};
    assets.forEach(asset => {
        if (!ownershipMap[asset.pid]) {
            ownershipMap[asset.pid] = {
                pid: asset.pid,
                name: asset.name,
                pos: asset.pos,
                team: asset.team,
                age: asset.age,
                dhq: asset.dhq,
                tier: asset.tier,
                tierColor: asset.tierColor,
                agePhase: asset.agePhase,
                agePhaseLabel: asset.agePhaseLabel,
                agePhaseColor: asset.agePhaseColor,
                count: 0,
                totalDHQ: 0,
                leagues: [],
            };
        }
        ownershipMap[asset.pid].count++;
        ownershipMap[asset.pid].totalDHQ += asset.dhq;
        ownershipMap[asset.pid].leagues.push({ id: asset.leagueId, name: asset.leagueName, status: asset.leagueStatus, tier: asset.leagueTier, healthScore: asset.healthScore });
    });
    const exposure = Object.values(ownershipMap)
        .map(item => ({
            ...item,
            exposurePct: provinces.length ? Math.round((item.count / provinces.length) * 100) : 0,
            exposureScore: item.count * 1000 + item.totalDHQ,
        }))
        .sort((a, b) => b.count - a.count || b.totalDHQ - a.totalDHQ || a.name.localeCompare(b.name));
    const exposureByPid = {};
    exposure.forEach(item => { exposureByPid[item.pid] = item; });
    assets.forEach(asset => {
        const exp = exposureByPid[asset.pid];
        asset.exposureCount = exp?.count || 1;
        asset.exposurePct = exp?.exposurePct || 0;
    });

    const totalDHQ = assets.reduce((sum, asset) => sum + asset.dhq, 0);
    const scoredAssets = assets.filter(asset => asset.dhq > 0).length;
    const scoreCount = Object.keys(scores || {}).length;
    const useValueShare = totalDHQ > 0;
    function finalizeTotals(map) {
        return Object.values(map)
            .map(item => ({
                ...item,
                share: useValueShare ? Math.round((item.dhq / Math.max(1, totalDHQ)) * 100) : Math.round((item.count / Math.max(1, assets.length)) * 100),
            }))
            .sort((a, b) => (useValueShare ? b.dhq - a.dhq : b.count - a.count) || a.label.localeCompare(b.label));
    }

    const positionAllocation = finalizeTotals(positionTotals);
    const ageAllocation = finalizeTotals(ageTotals);
    const tierAllocation = finalizeTotals(tierTotals);
    const totalRecord = provinces.reduce((sum, p) => ({ wins: sum.wins + p.wins, losses: sum.losses + p.losses }), { wins: 0, losses: 0 });
    const assessedHealth = provinces.map(p => p.healthScore).filter(v => v != null);
    const avgHealth = assessedHealth.length ? Math.round(assessedHealth.reduce((sum, v) => sum + v, 0) / assessedHealth.length) : null;
    const pickYears = {};
    picks.forEach(pick => {
        if (!pickYears[pick.year]) pickYears[pick.year] = { year: pick.year, count: 0, premium: 0, acquired: 0, own: 0, score: 0 };
        pickYears[pick.year].count++;
        pickYears[pick.year].score += pick.score;
        if (pick.round <= 2) pickYears[pick.year].premium++;
        if (pick.acquired) pickYears[pick.year].acquired++;
        if (pick.own) pickYears[pick.year].own++;
    });
    const pickCapital = {
        total: picks.length,
        premium: picks.filter(p => p.round <= 2).length,
        acquired: picks.filter(p => p.acquired).length,
        own: picks.filter(p => p.own).length,
        score: picks.reduce((sum, pick) => sum + pick.score, 0),
        byYear: Object.values(pickYears).sort((a, b) => a.year - b.year),
    };

    const qualityItems = [
        {
            key: 'rosters',
            label: 'Rosters',
            status: provinces.length ? 'ready' : 'missing',
            detail: provinces.length ? provinces.length + ' leagues mapped' : 'No owned rosters found',
        },
        {
            key: 'players',
            label: 'Player meta',
            status: assets.length && missingPlayerMeta === 0 ? 'ready' : assets.length ? 'partial' : 'missing',
            detail: missingPlayerMeta ? missingPlayerMeta + ' roster IDs missing names' : assets.length + ' assets named',
        },
        {
            key: 'dhq',
            label: 'DHQ values',
            status: scoredAssets > 0 && scoredAssets === assets.length ? 'ready' : scoredAssets > 0 ? 'partial' : input.liLoaded ? 'degraded' : 'loading',
            detail: scoredAssets > 0 ? scoredAssets + '/' + assets.length + ' assets valued' : scoreCount ? 'No owned assets matched DHQ' : 'Waiting on value engine',
        },
        {
            key: 'picks',
            label: 'Pick feed',
            status: pickFeedLeagueCount === provinces.length && provinces.length ? 'ready' : pickFeedLeagueCount > 0 ? 'partial' : 'degraded',
            detail: pickFeedLeagueCount ? pickFeedLeagueCount + '/' + provinces.length + ' leagues with traded-pick feed' : 'Own picks estimated, traded picks unknown',
        },
        {
            key: 'assessments',
            label: 'Team reads',
            status: assessedLeagueCount === provinces.length && provinces.length ? 'ready' : assessedLeagueCount > 0 ? 'partial' : 'degraded',
            detail: assessedLeagueCount ? assessedLeagueCount + '/' + provinces.length + ' leagues assessed' : 'Health and tier are unavailable',
        },
    ];
    const qualityRank = { ready: 0, partial: 1, loading: 1, degraded: 2, missing: 3 };
    const worstQuality = qualityItems.reduce((worst, item) => qualityRank[item.status] > qualityRank[worst] ? item.status : worst, 'ready');

    const signals = [];
    function pushSignal(signal) {
        signals.push({
            severity: signal.severity || 'medium',
            type: signal.type || 'opportunity',
            title: signal.title,
            body: signal.body,
            metric: signal.metric || '',
            filter: signal.filter || null,
            pid: signal.pid || null,
            leagueId: signal.leagueId || null,
            detail: signal.detail || null,
            cta: signal.cta || 'Open',
        });
    }
    if (worstQuality !== 'ready') {
        const weak = qualityItems.filter(item => item.status !== 'ready').map(item => item.label).join(', ');
        pushSignal({
            severity: worstQuality === 'missing' || worstQuality === 'degraded' ? 'high' : 'medium',
            type: 'data',
            title: 'Data confidence is not clean',
            body: weak + ' need attention before every portfolio number should be trusted.',
            metric: worstQuality.toUpperCase(),
            detail: { type: 'quality' },
            cta: 'Review data',
        });
    }
    const duplicateExposure = exposure.filter(item => item.count > 1);
    if (duplicateExposure[0]) {
        const top = duplicateExposure[0];
        pushSignal({
            severity: top.exposurePct >= 50 ? 'high' : 'medium',
            type: 'exposure',
            title: top.name + ' concentration',
            body: 'Owned in ' + top.count + ' of ' + Math.max(1, provinces.length) + ' leagues. One player outcome can move the whole portfolio.',
            metric: top.exposurePct + '%',
            pid: top.pid,
            cta: 'Open player',
        });
    }
    positionAllocation.forEach(pos => {
        if (pos.share >= 35 && ['QB', 'RB', 'WR', 'TE'].includes(pos.key)) {
            pushSignal({
                severity: pos.share >= 45 ? 'high' : 'medium',
                type: 'allocation',
                title: pos.label + ' allocation is overweight',
                body: pos.share + '% of portfolio ' + (useValueShare ? 'DHQ' : 'asset count') + ' sits at ' + pos.label + '.',
                metric: pos.share + '%',
                filter: { position: pos.key },
                detail: { type: 'slice', title: pos.label + ' Allocation', filter: { position: pos.key } },
                cta: 'Open slice',
            });
        }
    });
    const postWindow = ageAllocation.find(a => a.key === 'post');
    if (postWindow && postWindow.share >= 20) {
        pushSignal({
            severity: postWindow.share >= 35 ? 'high' : 'medium',
            type: 'age',
            title: 'Post-window value needs pruning',
            body: postWindow.share + '% of portfolio ' + (useValueShare ? 'DHQ' : 'assets') + ' is beyond the value window.',
            metric: postWindow.share + '%',
            filter: { agePhase: 'post' },
            detail: { type: 'slice', title: 'Post-window Assets', filter: { agePhase: 'post' } },
            cta: 'Open slice',
        });
    }
    const buildWindow = ageAllocation.find(a => a.key === 'build');
    if (buildWindow && buildWindow.share >= 45) {
        pushSignal({
            severity: 'medium',
            type: 'age',
            title: 'Pre-peak portfolio has volatility',
            body: buildWindow.share + '% of allocation is still before peak years. Great ceiling, wider outcome range.',
            metric: buildWindow.share + '%',
            filter: { agePhase: 'build' },
            detail: { type: 'slice', title: 'Build-window Assets', filter: { agePhase: 'build' } },
            cta: 'Open slice',
        });
    }
    if (strategyTotals.contender > 0 && strategyTotals.rebuild > 0) {
        pushSignal({
            severity: 'medium',
            type: 'strategy',
            title: 'Mixed league timeline',
            body: strategyTotals.contender + ' contending and ' + strategyTotals.rebuild + ' rebuilding leagues need different capital rules.',
            metric: strategyTotals.contender + '/' + strategyTotals.rebuild,
            detail: { type: 'slice', title: 'League Timeline Mix', filter: {} },
            cta: 'Review leagues',
        });
    }
    if (pickCapital.premium >= Math.max(3, provinces.length * 2)) {
        pushSignal({
            severity: 'low',
            type: 'capital',
            title: 'Premium pick bank is strong',
            body: pickCapital.premium + ' round 1-2 picks give the portfolio optionality across windows.',
            metric: pickCapital.premium + ' premium',
            filter: { assetType: 'picks' },
            detail: { type: 'slice', title: 'Draft Capital', filter: { assetType: 'picks' } },
            cta: 'Open picks',
        });
    }
    if (!signals.length) {
        pushSignal({
            severity: 'low',
            type: 'balance',
            title: 'Portfolio allocation is balanced',
            body: 'No major concentration, age-window, or league-timeline risk is dominating the current view.',
            metric: 'Stable',
        });
    }
    const severityOrder = { high: 0, medium: 1, low: 2 };
    signals.sort((a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1));

    return {
        provinces,
        assets,
        picks,
        exposure,
        positionAllocation,
        ageAllocation,
        tierAllocation,
        strategyTotals,
        pickCapital,
        dataQuality: { status: worstQuality, items: qualityItems, missingPlayerMeta, scoredAssets, scoreCount },
        signals,
        totals: {
            leagues: provinces.length,
            assets: assets.length,
            totalDHQ,
            scoredAssets,
            totalRecord,
            avgHealth,
            contenders: strategyTotals.contender || 0,
            rebuilds: strategyTotals.rebuild || 0,
            exposureCount: duplicateExposure.length,
            topExposurePct: duplicateExposure[0]?.exposurePct || 0,
            useValueShare,
        },
    };
}

// deriveOwnerEdge — translate a trade posture into an actionable cross-league edge.
function deriveOwnerEdge(posture) {
    const key = posture?.key || 'NEUTRAL';
    if (key === 'DESPERATE') return { edge: 'Panicking — overpays for win-now help', exploit: 9, tone: 'var(--k-bb8fce, #bb8fce)' };
    if (key === 'SELLER')    return { edge: 'Buy his assets at a discount', exploit: 7.5, tone: 'var(--k-5dade2, #5dade2)' };
    if (key === 'BUYER')     return { edge: 'Sell him studs at a premium', exploit: 6, tone: 'var(--k-f0a500, #f0a500)' };
    if (key === 'LOCKED')    return { edge: 'Hard to move — high attachment', exploit: 2.5, tone: 'var(--k-7f8c8d, #7f8c8d)' };
    return { edge: 'Fair value only — no clear edge', exploit: 4, tone: 'var(--k-95a5a6, #95a5a6)' };
}

// inferDnaFromTransactions — transaction-behavioral Owner DNA (a DNA_TYPES key) per owner,
// from a league's completed trades. Mirrors computeWeightedDNA's frequency + pick/player-flow
// signals; the DHQ-value-graded signals (win rate, avg value diff) need per-league player
// scores and are deferred — so this is a CONSERVATIVE read: it only emits a key on a clear
// behavioral signal, otherwise leaves the owner unset (for curated DNA / NONE to fill).
function inferDnaFromTransactions(transactions, rosters, myUserId) {
    const out = {};
    const trades = (transactions || []).filter(t => t && t.type === 'trade' && t.status !== 'failed');
    if (trades.length < 2 || !rosters || !rosters.length) return out;
    const ridToOwner = {};
    rosters.forEach(r => { if (r && r.roster_id != null) ridToOwner[r.roster_id] = r.owner_id; });
    const per = {};
    const bump = rid => (per[rid] = per[rid] || { trades: 0, picksRecv: 0, picksSent: 0, playersRecv: 0, playersSent: 0 });
    trades.forEach(t => {
        (t.roster_ids || []).forEach(rid => { bump(rid).trades++; });
        Object.values(t.adds || {}).forEach(rid => { bump(rid).playersRecv++; });
        Object.values(t.drops || {}).forEach(rid => { bump(rid).playersSent++; });
        (t.draft_picks || []).forEach(p => {
            if (p.owner_id != null) bump(p.owner_id).picksRecv++;
            if (p.previous_owner_id != null) bump(p.previous_owner_id).picksSent++;
        });
    });
    const rids = Object.keys(per);
    const avgTrades = rids.reduce((s, rid) => s + per[rid].trades, 0) / Math.max(1, rids.length);
    rids.forEach(rid => {
        const p = per[rid];
        if (p.trades < 2) return;
        const ownerId = ridToOwner[rid];
        if (ownerId == null || (myUserId != null && String(ownerId) === String(myUserId))) return;
        const scores = { FLEECER: 0, STALWART: 0, ACCEPTOR: 0 };
        if (avgTrades > 0) {
            const ratio = p.trades / avgTrades;
            if (ratio < 0.5) scores.STALWART += 4;
            else if (ratio > 1.75) scores.FLEECER += 3;
        }
        const netPicks = p.picksRecv - p.picksSent;
        if (netPicks >= 2) scores.ACCEPTOR += 3;                                       // hoards picks → rebuilder/seller
        if (netPicks > 0 && (p.playersSent - p.playersRecv) > 0) scores.ACCEPTOR += 2; // sells players for picks
        let best = null, bestV = 0;
        Object.keys(scores).forEach(k => { if (scores[k] > bestV) { bestV = scores[k]; best = k; } });
        if (best) out[ownerId] = best;
    });
    return out;
}

// buildEmpireDna — real per-league Owner DNA for the moat. The user's curated reads
// (od_owner_dna_v1_<lid>, keyed by ownerId) take precedence; transaction-behavioral inference
// fills the gaps. Returns { [ownerId]: DNA_TYPES key }, which buildEmpireRolodex/buildEmpireMoves
// read off league.empireDna (previously never populated, so they ran on NEUTRAL fallbacks).
function buildEmpireDna(savedDna, transactions, rosters, myUserId) {
    const out = { ...inferDnaFromTransactions(transactions, rosters, myUserId) };
    Object.keys(savedDna || {}).forEach(ownerId => { if (savedDna[ownerId]) out[ownerId] = savedDna[ownerId]; });
    return out;
}

// buildEmpireGrudges — aggregate per-league logged trade grudges (od_grudges_v1_<lid>) into one
// cross-league list. Grudges are keyed by Sleeper user_id, so a grudge with an owner applies
// wherever you face them. Feeds calcGrudgeTax inside buildEmpireMoves.
function buildEmpireGrudges(allLeagues) {
    const out = [];
    (allLeagues || []).forEach(l => {
        const lid = l && (l.id || l.league_id);
        if (!lid || typeof localStorage === 'undefined') return;
        try {
            const arr = JSON.parse(localStorage.getItem('od_grudges_v1_' + lid) || '[]');
            if (Array.isArray(arr)) out.push(...arr);
        } catch (e) { /* ignore malformed */ }
    });
    return out;
}

// buildEmpireRolodex — every owner you face, across every league, ranked by edge.
// Pure: reads league.empireAssessments (from assessAllTeams) + optional league.empireDna.
// calcPosture is injectable for testing; defaults to the shared trade engine.
function buildEmpireRolodex(leagues, myUserId, calcPosture) {
    const posFn = calcPosture || (typeof window !== 'undefined' && window.App?.TradeEngine?.calcOwnerPosture) || (() => ({ key: 'NEUTRAL', label: 'Neutral' }));
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const owners = [];
    (leagues || []).forEach(league => {
        const assessments = league.empireAssessments || [];
        const dnaMap = league.empireDna || {};
        const leagueName = league.name || 'League';
        const leagueId = league.id || league.league_id || '';
        assessments.forEach(a => {
            if (sameId(a.ownerId, myUserId)) return;
            const dnaKey = dnaMap[a.ownerId] || null;
            const posture = posFn(a, dnaKey) || { key: 'NEUTRAL', label: 'Neutral', color: 'var(--k-95a5a6, #95a5a6)' };
            const e = deriveOwnerEdge(posture);
            owners.push({
                ownerId: a.ownerId,
                ownerName: a.ownerName || a.teamName || 'Owner',
                leagueId, leagueName,
                tier: a.tier || 'UNKNOWN',
                posture: posture.label || posture.key,
                postureKey: posture.key,
                postureColor: posture.color || e.tone,
                edge: e.edge,
                exploit: Math.round((e.exploit + ((a.panic || 0) >= 3 ? 0.5 : 0)) * 10) / 10,
                needs: (a.needs || []).slice(0, 2).map(n => (typeof n === 'string' ? n : n.pos)).filter(Boolean),
                dnaKey,
            });
        });
    });
    owners.sort((x, y) => y.exploit - x.exploit || x.ownerName.localeCompare(y.ownerName));
    return owners;
}

// buildEmpireMoves — the moat. Cross-league trade lanes ranked by value × acceptance.
// For each league: sell my post-window/over-exposed assets to a buyer who needs that
// position; buy my top need from a seller — scored with the real trade-psychology engine.
// Pure: injectable tradeEngine (defaults to window.App.TradeEngine) for testability.
function buildEmpireMoves(input) {
    input = input || {};
    const leagues = input.leagues || [];
    const model = input.model || { assets: [], provinces: [] };
    const scores = input.scores || {};
    const playersData = input.playersData || {};
    const myUserId = input.myUserId;
    const normPos = input.normPos || (p => p);
    const TE = input.tradeEngine || (typeof window !== 'undefined' ? window.App?.TradeEngine : null) || {};
    const calcPosture = TE.calcOwnerPosture || (() => ({ key: 'NEUTRAL', label: 'Neutral' }));
    const calcTaxes = TE.calcPsychTaxes || (() => []);
    const calcAccept = TE.calcAcceptanceLikelihood || (() => 50);
    const calcGrudge = TE.calcGrudgeTax || (() => ({ total: 0 }));
    const grudges = input.grudges || [];
    const sameId = (a, b) => a != null && b != null && String(a) === String(b);
    const needList = a => (a.needs || []).map(n => (typeof n === 'string' ? n : n.pos)).filter(Boolean);

    const moves = [];
    const totalLeagues = model.provinces.length || leagues.length || 1;
    const exposureCut = Math.max(2, Math.ceil(totalLeagues * 0.6));

    leagues.forEach(league => {
        const assessments = league.empireAssessments || [];
        if (!assessments.length) return;
        const leagueId = league.id || league.league_id || '';
        const leagueName = league.name || 'League';
        const dnaMap = league.empireDna || {};
        const myA = assessments.find(a => sameId(a.ownerId, myUserId));
        if (!myA) return;
        const opponents = assessments.filter(a => !sameId(a.ownerId, myUserId));
        const postureOf = a => calcPosture(a, dnaMap[a.ownerId] || null) || { key: 'NEUTRAL', label: 'Neutral' };

        // SELL lanes — my post-window or over-exposed assets → a buyer who needs that position.
        (model.assets || [])
            .filter(as => as.leagueId === leagueId && as.dhq > 0 && (as.agePhase === 'post' || as.exposureCount >= exposureCut))
            .sort((a, b) => b.dhq - a.dhq)
            .slice(0, 2)
            .forEach(asset => {
                const buyers = opponents
                    .map(a => ({ a, posture: postureOf(a) }))
                    .filter(x => (x.posture.key === 'BUYER' || x.posture.key === 'DESPERATE') && needList(x.a).includes(asset.pos))
                    .sort((x, y) => (y.posture.key === 'DESPERATE' ? 1 : 0) - (x.posture.key === 'DESPERATE' ? 1 : 0) || (y.a.panic || 0) - (x.a.panic || 0));
                if (!buyers.length) return;
                const { a: buyer, posture } = buyers[0];
                const dnaKey = dnaMap[buyer.ownerId] || null;
                // Model the real deal, not a 1-for-1 swap: the buyer's eagerness sets how much they
                // overpay for the asset they need. Acceptance falls as the premium rises, but their
                // posture / psych tax (panic premium for DESPERATE) offsets it.
                const eagerness = posture.key === 'DESPERATE' ? 1.12 : 1.04;
                const give = asset.dhq;                              // the asset I send out
                const receive = Math.round(asset.dhq * eagerness);   // their (over)payment back
                const sellTaxes = calcTaxes(myA, buyer, dnaKey, posture);
                const sellGrudge = calcGrudge(myA.ownerId, buyer.ownerId, grudges, dnaKey);
                const accept = calcAccept(give, receive, dnaKey, sellGrudge.total ? sellTaxes.concat([{ label: 'Grudge', impact: sellGrudge.total }]) : sellTaxes, myA, buyer);
                // Portfolio Δ = premium extracted + value preserved by shedding a decaying/redundant asset.
                const delta = Math.round((receive - give) + asset.dhq * (asset.agePhase === 'post' ? 0.18 : 0.10));
                moves.push({
                    type: 'sell',
                    title: 'Sell ' + asset.name + ' to ' + (buyer.ownerName || 'a rival'),
                    leagueId, leagueName, ownerName: buyer.ownerName || 'rival',
                    posture: posture.label || posture.key,
                    why: (asset.agePhase === 'post' ? 'Post-window asset' : 'Trim ' + asset.exposureCount + '× exposure')
                        + ' — ' + (buyer.ownerName || 'they') + (posture.key === 'DESPERATE' ? ' is panicking and overpays' : ' is buying') + ' and needs ' + asset.pos + '.',
                    value: delta, accept, pid: asset.pid,
                    score: Math.round(delta * (accept / 100)),
                });
            });

        // BUY lane — fill my top need in a league I should push, from a seller's roster.
        const myNeed = needList(myA)[0];
        const pushing = ['CONTENDER', 'ELITE', 'CROSSROADS'].includes(myA.tier);
        if (myNeed && pushing) {
            let best = null;
            opponents
                .map(a => ({ a, posture: postureOf(a) }))
                .filter(x => x.posture.key === 'SELLER' || x.posture.key === 'DESPERATE')
                .forEach(({ a, posture }) => {
                    const roster = (league.rosters || []).find(r => sameId(r.owner_id, a.ownerId));
                    (roster?.players || []).forEach(pid => {
                        const p = playersData[pid];
                        if (!p) return;
                        const pos = normPos(p.position) || p.position;
                        if (pos !== myNeed) return;
                        const dhq = scores[pid] || 0;
                        if (dhq <= 0) return;
                        if (!best || dhq > best.dhq) {
                            best = { pid, name: p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' '), dhq, owner: a, posture };
                        }
                    });
                });
            if (best) {
                const dnaKey = dnaMap[best.owner.ownerId] || null;
                // Buy below market: a seller/rebuilder takes a discount on a current player.
                // Acceptance reflects the discount, offset by their seller/rebuild posture tax.
                const discount = best.posture.key === 'DESPERATE' ? 0.85 : 0.92;
                const give = Math.round(best.dhq * discount);   // what I pay (picks / surplus)
                const receive = best.dhq;                       // the player I acquire
                const buyTaxes = calcTaxes(myA, best.owner, dnaKey, best.posture);
                const buyGrudge = calcGrudge(myA.ownerId, best.owner.ownerId, grudges, dnaKey);
                const accept = calcAccept(give, receive, dnaKey, buyGrudge.total ? buyTaxes.concat([{ label: 'Grudge', impact: buyGrudge.total }]) : buyTaxes, myA, best.owner);
                const delta = Math.round(best.dhq - give);      // discount captured filling a need
                moves.push({
                    type: 'buy',
                    title: 'Acquire ' + best.name + ' from ' + (best.owner.ownerName || 'a seller'),
                    leagueId, leagueName, ownerName: best.owner.ownerName || 'seller',
                    posture: best.posture.label || best.posture.key,
                    why: 'Fills your ' + myNeed + ' need in a league you should push. '
                        + (best.owner.ownerName || 'They') + (best.posture.key === 'DESPERATE' ? ' is panicking' : ' is selling') + ' — buy at a discount.',
                    value: delta, accept, pid: best.pid,
                    score: Math.round(delta * (accept / 100)),
                });
            }
        }
    });

    moves.sort((a, b) => b.score - a.score);
    return moves.slice(0, 8);
}

// buildEmpireConsolidation — sequence ranked moves into one cross-league campaign:
// liquidate aging/over-exposed assets, recycle the value into need-filling buys, net effect.
function buildEmpireConsolidation(moves, model) {
    const sells = (moves || []).filter(m => m.type === 'sell');
    const buys = (moves || []).filter(m => m.type === 'buy');
    if (!sells.length && !buys.length) return null;
    const assetByPid = {};
    (model?.assets || []).forEach(a => { assetByPid[a.pid] = a; });
    const sellValue = sells.reduce((s, m) => s + (m.value || 0), 0);
    const buyValue = buys.reduce((s, m) => s + (m.value || 0), 0);
    const postWindowMoved = sells.filter(m => assetByPid[m.pid]?.agePhase === 'post').length;
    const exposureTrimmed = sells.filter(m => (assetByPid[m.pid]?.exposureCount || 1) > 1).length;
    const pushLeagues = Array.from(new Set(buys.map(m => m.leagueName)));

    const steps = [];
    const tidy = s => s.replace(/\.{2,}/g, '.');
    if (sells.length) {
        steps.push({
            phase: 'SELL', tone: 'var(--k-5dade2, #5dade2)',
            title: 'Liquidate ' + sells.length + ' aging / over-exposed asset' + (sells.length === 1 ? '' : 's'),
            detail: tidy(sells.map(m => m.title.replace(/^Sell /, '')).join('; ') + '.'),
        });
    }
    if (buys.length) {
        steps.push({
            phase: 'BUY', tone: 'var(--k-2ecc71, #2ecc71)',
            title: 'Recycle into ' + buys.length + ' need-filling buy' + (buys.length === 1 ? '' : 's'),
            detail: tidy(buys.map(m => m.title.replace(/^Acquire /, '')).join('; ')
                + (pushLeagues.length ? ' — pushing ' + pushLeagues.join(', ') + '.' : '.')),
        });
    }
    const net = [];
    if (exposureTrimmed) net.push('cuts ' + exposureTrimmed + ' over-exposure');
    if (postWindowMoved) net.push('clears ' + postWindowMoved + ' post-window asset' + (postWindowMoved === 1 ? '' : 's'));
    if (pushLeagues.length) net.push('upgrades ' + pushLeagues.length + ' contending ' + (pushLeagues.length === 1 ? 'league' : 'leagues'));
    steps.push({
        phase: 'NET', tone: 'var(--k-d4af37, #d4af37)',
        title: 'Net effect across the empire',
        detail: (net.length ? net.join(', ') : 'rebalances the portfolio')
            + '. Reallocates ' + empireCompact(sellValue) + ' from sells into ' + empireCompact(buyValue) + ' of targeted value.',
    });
    return { steps, sells: sells.length, buys: buys.length };
}

// buildEmpireActionQueue — cross-league priority queue.
// Pure function over the portfolio model + owner rolodex. Merges actionable signals,
// per-league needs, post-window sells, and cross-league owner edges into one ranked list.
function buildEmpireActionQueue(model, rolodex) {
    if (!model) return [];
    const provinces = model.provinces || [];
    const assets = model.assets || [];
    const sevRank = { high: 0, medium: 1, low: 2 };
    const actions = [];

    // 1. Actionable portfolio signals (skip data-quality + the "all balanced" no-op).
    (model.signals || []).forEach(sig => {
        if (sig.type === 'data' || sig.type === 'balance') return;
        actions.push({
            severity: sig.severity || 'medium',
            kind: sig.type || 'signal',
            title: sig.title,
            detail: sig.body,
            metric: sig.metric || '',
            leagueId: sig.leagueId || null,
            pid: sig.pid || null,
            filter: sig.filter || null,
            sliceDetail: sig.detail || null,
            cta: sig.cta || 'Open',
            weight: (sig.severity === 'high' ? 300 : sig.severity === 'medium' ? 150 : 50),
        });
    });

    // 2. Per-league upgrade needs for leagues you should be pushing (contender/fringe).
    provinces.forEach(p => {
        if ((p.status === 'contender' || p.status === 'fringe') && (p.needs || []).length) {
            const hp = p.healthScore;
            actions.push({
                severity: hp != null && hp < 65 ? 'high' : 'medium',
                kind: 'need',
                title: 'Upgrade ' + p.needs[0] + ' in ' + p.name,
                detail: (p.tier || 'Active') + ' roster'
                    + (p.needs.length > 1 ? ' — also light at ' + p.needs.slice(1).join(', ') : '')
                    + '. Closing this protects a live window.',
                metric: hp != null ? 'HP ' + hp : '',
                leagueId: p.id,
                cta: 'Open league',
                weight: 120 + Math.max(0, 65 - (hp || 65)),
            });
        }
    });

    // 3. Post-window vets sitting on rebuild rosters → sell before value bleeds.
    provinces.filter(p => p.status === 'rebuild').forEach(p => {
        const vet = assets
            .filter(a => a.leagueId === p.id && a.agePhase === 'post' && a.dhq > 0)
            .sort((a, b) => b.dhq - a.dhq)[0];
        if (vet) {
            actions.push({
                severity: 'medium',
                kind: 'sell',
                title: 'Sell ' + vet.name + ' in ' + p.name,
                detail: 'Post-window vet on a rebuild roster — convert to picks before the cliff prices in.',
                metric: empireCompact(vet.dhq),
                leagueId: p.id,
                pid: vet.pid,
                cta: 'Open player',
                weight: 90 + Math.round(vet.dhq / 100),
            });
        }
    });

    // 4. Cross-league owner edges — the moat. Surface the most exploitable
    // buyers/sellers across every league as concrete buy/sell-window moves.
    (rolodex || [])
        .filter(o => o.postureKey === 'SELLER' || o.postureKey === 'DESPERATE')
        .slice(0, 2)
        .forEach(o => {
            const desperate = o.postureKey === 'DESPERATE';
            actions.push({
                severity: desperate ? 'high' : 'medium',
                kind: 'edge',
                title: (desperate ? 'Sell into ' + o.ownerName + "'s panic in " : 'Buy-low window: ' + o.ownerName + ' in ') + o.leagueName,
                detail: o.edge + (o.needs.length ? ' · needs ' + o.needs.join(', ') : '') + '.',
                metric: o.posture,
                leagueId: o.leagueId,
                cta: 'Open league',
                weight: 110 + Math.round(o.exploit * 6),
            });
        });

    actions.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || (b.weight - a.weight));
    return actions.slice(0, 8);
}

// buildEmpireBrief — short deterministic empire summary in Alex's register.
// (Synchronous template for now; AlexVoice/AI upgrade tracked separately.)
function buildEmpireBrief(model, userName) {
    if (!model || !model.totals) return '';
    const t = model.totals;
    const topSignal = (model.signals || []).find(s => s.type !== 'data' && s.type !== 'balance');
    const valueStr = t.totalDHQ > 0 ? empireCompact(t.totalDHQ) + ' DHQ' : 'value still loading';
    const recStr = t.totalRecord ? t.totalRecord.wins + '–' + t.totalRecord.losses : '';
    const mix = t.contenders + ' contending / ' + t.rebuilds + ' rebuilding';
    const lead = 'Across your ' + t.leagues + ' league' + (t.leagues === 1 ? '' : 's')
        + ' you’re holding ' + valueStr + (recStr ? ' on a ' + recStr + ' record' : '') + ' — ' + mix + '.';
    const focus = topSignal
        ? ' Top of my list: ' + topSignal.title.toLowerCase() + (topSignal.metric ? ' (' + topSignal.metric + ')' : '') + '.'
        : ' No single risk is dominating the portfolio right now.';
    const close = ' I’ve queued the highest-leverage moves on the right.';
    return lead + focus + close;
}

function empireCompact(value) {
    const n = Number(value || 0);
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
}

function empirePercent(part, total) {
    return total > 0 ? Math.round((part / total) * 100) : 0;
}

function EmpireStyles() {
    return (
        <style>{`
            .empire-root { min-height: 100vh; background: var(--page-bg); color: var(--text-primary, var(--k-f4f1e8, #f4f1e8)); font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            .empire-root.is-local-preview .empire-topbar { padding-top: 28px; min-height: 72px; }
            .empire-header { position: sticky; top: 0; z-index: 60; background: var(--surf-solid, rgba(7,7,7,0.98)); border-bottom: 1px solid var(--acc-line1, rgba(212,175,55,0.22)); box-shadow: 0 12px 32px rgba(0,0,0,0.35); }
            .empire-topbar { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 10px 24px; border-bottom: 1px solid var(--ov-4, rgba(255,255,255,0.055)); box-sizing: border-box; }
            .empire-back, .empire-ghost, .empire-filter, .empire-row-btn, .empire-action { border: 1px solid var(--ov-6, rgba(255,255,255,0.1)); background: var(--ov-3, rgba(255,255,255,0.035)); color: var(--ov-9, rgba(255,255,255,0.72)); border-radius: var(--card-radius-sm); cursor: pointer; font-family: inherit; transition: border-color 120ms, background 120ms, transform 120ms, color 120ms; }
            .empire-back { width: 34px; height: 28px; font-size: var(--text-body, 1rem); }
            .empire-back:hover, .empire-ghost:hover, .empire-filter:hover, .empire-row-btn:hover, .empire-action:hover { border-color: var(--acc-line3, rgba(212,175,55,0.5)); background: var(--acc-fill1, rgba(212,175,55,0.07)); color: var(--k-f7e9b0, #f7e9b0); }
            .empire-title { display: flex; flex-direction: column; min-width: 0; }
            .empire-title strong { color: var(--gold); font-family: var(--font-title); font-size: 1rem; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1; }
            .empire-title span { color: var(--ov-9, rgba(255,255,255,0.48)); font-size: var(--text-label, 0.75rem); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-user { margin-left: auto; color: var(--ov-9, rgba(255,255,255,0.55)); font-size: var(--text-label, 0.75rem); white-space: nowrap; }
            .empire-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 0; padding: 0 24px; background: linear-gradient(90deg, var(--acc-fill1, rgba(212,175,55,0.055)), rgba(78,205,196,0.025), rgba(124,107,248,0.035)); }
            .empire-kpi { min-width: 0; padding: 10px 12px; border-right: 1px solid var(--ov-4, rgba(255,255,255,0.055)); }
            .empire-kpi strong { display: block; font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; color: var(--white, var(--k-ffffff, #ffffff)); font-size: 1.05rem; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-kpi span { display: block; margin-top: 5px; color: var(--gold); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.11em; text-transform: uppercase; }
            .empire-kpi em { display: block; margin-top: 2px; color: var(--ov-8, rgba(255,255,255,0.42)); font-style: normal; font-size: var(--text-micro); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-filters { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; padding: 9px 24px 10px; background: rgba(0,0,0,0.32); }
            .empire-filter-label { color: var(--gold); font-size: var(--text-micro); font-weight: 900; letter-spacing: 0.13em; text-transform: uppercase; margin-right: 2px; }
            .empire-filter { min-height: 28px; padding: 5px 10px; font-size: var(--text-label, 0.75rem); font-weight: 800; color: var(--ov-9, rgba(255,255,255,0.52)); }
            .empire-filter.is-active { border-color: var(--tone, var(--k-d4af37, #d4af37)); background: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 16%, transparent); color: var(--tone, var(--k-d4af37, #d4af37)); }
            .empire-clear { margin-left: auto; border-color: rgba(231,76,60,0.38); color: var(--k-e74c3c, #e74c3c); }
            .empire-shell { max-width: 1760px; margin: 0 auto; padding: 18px 24px 40px; }
            .empire-main-grid { display: grid; grid-template-columns: minmax(270px, 0.84fr) minmax(420px, 1.34fr) minmax(290px, 0.92fr); gap: 12px; align-items: start; }
            .empire-bridge { display: grid; grid-template-columns: minmax(320px, 1.05fr) minmax(280px, 0.95fr); gap: 12px; margin-bottom: 12px; align-items: start; }
            .empire-brief { display: flex; gap: 11px; }
            .empire-brief-av { width: 38px; height: 38px; flex: 0 0 auto; border-radius: 10px; background: linear-gradient(135deg, var(--k-7c6bf8, #7c6bf8), var(--k-4ecdc4, #4ecdc4)); display: grid; place-items: center; font-family: var(--font-title); font-weight: 700; font-size: 1.05rem; color: var(--k-0a0a0c, #0a0a0c); }
            .empire-brief-meta { color: var(--purple); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
            .empire-brief-body { color: var(--ov-9, rgba(255,255,255,0.68)); font-size: var(--text-body, 1rem); line-height: 1.5; margin-top: 5px; }
            .empire-rolodex { margin-bottom: 12px; }
            .empire-rolodex-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px; }
            .empire-panel { min-width: 0; border: 1px solid var(--acc-fill3, rgba(212,175,55,0.14)); background: linear-gradient(180deg, var(--ov-2, rgba(255,255,255,0.028)), var(--ov-1, rgba(255,255,255,0.014))); border-radius: var(--card-radius); padding: 12px; }
            .empire-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid var(--acc-fill2, rgba(212,175,55,0.12)); }
            .empire-panel-head strong { color: var(--gold); font-family: var(--font-title); font-size: var(--text-title, 1.125rem); letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-panel-head em { color: var(--ov-9, rgba(255,255,255,0.46)); font-style: normal; font-size: var(--text-label, 0.75rem); text-align: right; }
            .empire-stack { display: flex; flex-direction: column; gap: 8px; }
            .empire-bar-row { display: grid; grid-template-columns: 52px minmax(0,1fr) 46px; gap: 8px; align-items: center; color: var(--ov-9, rgba(255,255,255,0.62)); font-size: var(--text-label, 0.75rem); min-width: 0; }
            .empire-bar-row strong { color: var(--bar, var(--k-d4af37, #d4af37)); font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-track { height: 8px; border-radius: 99px; background: var(--ov-4, rgba(255,255,255,0.055)); overflow: hidden; }
            .empire-fill { height: 100%; border-radius: 99px; background: var(--bar, var(--k-d4af37, #d4af37)); min-width: 2px; }
            .empire-signal { text-align: left; border: 1px solid var(--ov-4, rgba(255,255,255,0.07)); border-left: 3px solid var(--tone, var(--k-d4af37, #d4af37)); background: var(--ov-2, rgba(255,255,255,0.026)); color: inherit; border-radius: var(--card-radius-sm); padding: 10px; cursor: pointer; font-family: inherit; }
            .empire-signal:hover { border-color: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 56%, var(--ov-5, rgba(255,255,255,0.08))); background: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 7%, transparent); }
            .empire-signal-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
            .empire-signal strong { color: var(--white, var(--k-ffffff, #ffffff)); font-size: var(--text-body, 1rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-signal b { color: var(--tone, var(--k-d4af37, #d4af37)); font-family: var(--font-mono); font-size: var(--text-body, 1rem); white-space: nowrap; }
            .empire-signal span { display: block; color: var(--ov-9, rgba(255,255,255,0.58)); font-size: var(--text-label, 0.75rem); line-height: 1.35; margin-top: 4px; }
            .empire-signal em { display: block; color: var(--tone, var(--k-d4af37, #d4af37)); font-style: normal; font-size: var(--text-micro); margin-top: 6px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
            .empire-league-card { width: 100%; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; text-align: left; border: 1px solid var(--ov-4, rgba(255,255,255,0.07)); border-left: 3px solid var(--tone, var(--k-d4af37, #d4af37)); background: var(--ov-1, rgba(255,255,255,0.024)); border-radius: var(--card-radius-sm); padding: 9px; color: inherit; cursor: pointer; font-family: inherit; }
            .empire-league-card:hover { border-color: var(--acc-line3, rgba(212,175,55,0.48)); background: var(--acc-fill1, rgba(212,175,55,0.045)); }
            .empire-league-card strong { display: block; color: var(--white, var(--k-ffffff, #ffffff)); font-size: var(--text-body, 1rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-league-card span, .empire-league-card em { display: block; color: var(--ov-9, rgba(255,255,255,0.52)); font-size: var(--text-label, 0.75rem); font-style: normal; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-league-card b { color: var(--tone, var(--k-d4af37, #d4af37)); font-family: var(--font-mono); font-size: var(--text-label, 0.75rem); white-space: nowrap; }
            .empire-quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 12px; }
            .empire-quality { border: 1px solid var(--ov-4, rgba(255,255,255,0.065)); background: rgba(0,0,0,0.18); border-radius: var(--card-radius-sm); padding: 9px; border-left: 3px solid var(--tone, var(--k-d4af37, #d4af37)); min-width: 0; }
            .empire-quality span { display: block; color: var(--ov-9, rgba(255,255,255,0.5)); font-size: var(--text-micro); font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
            .empire-quality strong { display: block; color: var(--white, var(--k-ffffff, #ffffff)); font-size: var(--text-label, 0.75rem); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-quality em { display: block; color: var(--ov-9, rgba(255,255,255,0.52)); font-style: normal; font-size: var(--text-label, 0.75rem); margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-workspace { margin-top: 12px; border: 1px solid var(--acc-fill3, rgba(212,175,55,0.14)); border-radius: var(--card-radius); background: var(--ov-1, rgba(255,255,255,0.018)); overflow: hidden; }
            .empire-workspace-head, .empire-table-head, .empire-asset-row { display: grid; grid-template-columns: minmax(180px,1.3fr) 46px 54px 76px 78px 72px minmax(140px,1fr); gap: 8px; align-items: center; }
            .empire-workspace-head { display: flex; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid var(--acc-fill2, rgba(212,175,55,0.12)); }
            .empire-workspace-head strong { color: var(--gold); font-family: var(--font-title); font-size: var(--text-title, 1.125rem); letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-sort-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
            .empire-ghost { padding: 5px 9px; font-size: var(--text-label, 0.75rem); font-weight: 800; }
            .empire-ghost.is-active { color: var(--gold); border-color: var(--acc-line3, rgba(212,175,55,0.45)); background: var(--acc-fill2, rgba(212,175,55,0.08)); }
            .empire-table-head { padding: 7px 12px; color: var(--gold); background: var(--acc-fill1, rgba(212,175,55,0.045)); font-size: var(--text-micro); font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-asset-row { width: 100%; min-height: 34px; border: 0; border-bottom: 1px solid var(--ov-3, rgba(255,255,255,0.035)); background: transparent; color: var(--ov-9, rgba(255,255,255,0.66)); padding: 6px 12px; text-align: left; font-family: inherit; font-size: var(--text-label, 0.75rem); cursor: pointer; }
            .empire-asset-row:nth-child(even) { background: var(--ov-1, rgba(255,255,255,0.012)); }
            .empire-asset-row:hover { background: var(--acc-fill1, rgba(212,175,55,0.055)); }
            .empire-player-cell { display: flex; align-items: center; gap: 7px; min-width: 0; }
            .empire-player-cell img { width: 22px; height: 22px; object-fit: cover; border-radius: 50%; flex: 0 0 auto; }
            .empire-player-cell strong, .empire-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .empire-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; border-radius: var(--card-radius-sm); padding: 2px 5px; color: var(--tone, var(--k-d4af37, #d4af37)); background: color-mix(in srgb, var(--tone, var(--k-d4af37, #d4af37)) 16%, transparent); font-size: var(--text-micro); font-weight: 900; }
            .empire-empty { border: 1px dashed var(--acc-line1, rgba(212,175,55,0.22)); border-radius: var(--card-radius); padding: 20px; text-align: center; color: var(--ov-9, rgba(255,255,255,0.56)); font-size: var(--text-body, 1rem); }
            .empire-empty strong { display: block; color: var(--gold); font-family: var(--font-title); font-size: 1rem; margin-bottom: 5px; }
            .empire-detail { max-width: 1380px; margin: 0 auto; padding: 18px 24px 42px; }
            .empire-detail-hero { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 18px; align-items: center; border: 1px solid var(--acc-fill3, rgba(212,175,55,0.18)); background: linear-gradient(135deg, var(--acc-fill1, rgba(212,175,55,0.07)), rgba(78,205,196,0.028), rgba(124,107,248,0.035)); border-radius: var(--card-radius); padding: 14px; margin-bottom: 12px; }
            .empire-detail-hero h1 { margin: 0; color: var(--white, var(--k-ffffff, #ffffff)); font-family: var(--font-title); font-size: 1.45rem; letter-spacing: 0.04em; }
            .empire-detail-hero p { margin: 4px 0 0; color: var(--ov-9, rgba(255,255,255,0.58)); font-size: var(--text-body, 1rem); }
            .empire-detail-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 8px; margin-bottom: 12px; }
            .empire-metric { border: 1px solid var(--ov-4, rgba(255,255,255,0.065)); background: var(--ov-1, rgba(255,255,255,0.024)); border-radius: var(--card-radius-sm); padding: 9px; min-width: 0; }
            .empire-metric span { display: block; color: var(--ov-9, rgba(255,255,255,0.5)); font-size: var(--text-micro); text-transform: uppercase; letter-spacing: 0.09em; font-weight: 800; }
            .empire-metric strong { display: block; color: var(--white, var(--k-ffffff, #ffffff)); font-family: var(--font-mono); font-size: var(--text-body, 1rem); margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-action { padding: 7px 11px; font-size: var(--text-label, 0.75rem); font-weight: 900; color: var(--gold); border-color: var(--acc-line2, rgba(212,175,55,0.32)); background: var(--acc-fill1, rgba(212,175,55,0.065)); }
            .empire-slice-grid { display: grid; grid-template-columns: minmax(260px,0.7fr) minmax(0,1.3fr); gap: 12px; }
            @media(max-width:1439px) {
                .empire-main-grid { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
                .empire-center { grid-column: 1 / -1; grid-row: 1; }
                .empire-workspace-head, .empire-table-head, .empire-asset-row { grid-template-columns: minmax(150px,1fr) 42px 46px 66px 66px 56px minmax(110px,0.8fr); }
            }
            @media(max-width:1023px) {
                .empire-main-grid, .empire-slice-grid, .empire-bridge { grid-template-columns: 1fr; }
                .empire-workspace-head { align-items: flex-start; flex-direction: column; }
                .empire-table-head, .empire-asset-row { grid-template-columns: minmax(140px,1fr) 40px 46px 58px 58px; }
                .empire-table-head div:nth-child(n+6), .empire-asset-row div:nth-child(n+6) { display: none; }
                .empire-detail-hero { grid-template-columns: 1fr; }
            }
            @media(max-width:767px) {
                .empire-topbar { padding: 9px 14px; }
                .empire-kpis, .empire-filters { padding-left: 14px; padding-right: 14px; }
                .empire-shell, .empire-detail { padding-left: 14px; padding-right: 14px; }
                .empire-user { display: none; }
            }
            @media(pointer: coarse) {
                .empire-back { width: 44px; min-height: 44px; }
                .empire-filter { min-height: 44px; padding: 12px 10px; }
                .empire-ghost { min-height: 44px; padding: 12px 9px; }
                .empire-action { min-height: 44px; padding: 12px 11px; }
                .empire-asset-row { min-height: 44px; }
            }
        `}</style>
    );
}

function EmpireDashboard({ allLeagues, playersData, sleeperUserId, onEnterLeague, onBack }) {
    const { useState, useMemo, useCallback } = React;
    const emptyFilters = { league: '', status: '', position: '', agePhase: '', tier: '', exposure: '', assetType: '' };
    const [filters, setFilters] = useState(emptyFilters);
    const [sort, setSort] = useState('dhq');
    const [detail, setDetail] = useState(null);
    const normPos = window.App?.normPos || (p => p);
    // KNOWN APPROXIMATION (H5): playerScores come from the one LeagueIntel currently loaded,
    // so all leagues' Empire DHQ (Empire Value, asset values, move math) are scored in that
    // league's settings. DHQ is ~mostly intrinsic (production/age/situation), so this is a
    // decent proxy, not exact — leagues with divergent settings (SF/TE-premium/PPR) drift.
    // A league-neutral DHQ-scale score is a deferred engine refinement (fcValue is FC-scale +
    // sparse, so it can't simply be swapped in without breaking the DHQ scale).
    const scores = window.App?.LI?.playerScores || {};
    const posColors = window.App?.POS_COLORS || {};
    const scoreKey = Object.keys(scores).length + ':' + (window.App?.LI_LOADED ? 'ready' : 'loading');
    const userName = window.S?.user?.display_name || window.S?.user?.username || 'Commander';

    const model = useMemo(() => buildEmpirePortfolioModel({
        allLeagues,
        playersData,
        sleeperUserId,
        scores,
        normPos,
        posLabel: window.App?.posLabel,
        posColors,
        getAgeCurve: window.App?.getAgeCurve,
        peakWindows: window.App?.peakWindows,
        tradeValueTier: window.App?.tradeValueTier,
        assessTeam: typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal : null,
        nowYear: new Date().getFullYear(),
        liLoaded: !!window.App?.LI_LOADED,
    }), [allLeagues, playersData, sleeperUserId, scoreKey]);

    const rolodex = useMemo(() => buildEmpireRolodex(allLeagues, sleeperUserId), [allLeagues, scoreKey]);
    const actionQueue = useMemo(() => buildEmpireActionQueue(model, rolodex), [model, rolodex]);
    const briefText = useMemo(() => buildEmpireBrief(model, userName), [model, userName]);
    const empireGrudges = useMemo(() => buildEmpireGrudges(allLeagues), [allLeagues]);
    const moves = useMemo(() => buildEmpireMoves({ leagues: allLeagues, model, scores, playersData, myUserId: sleeperUserId, normPos, tradeEngine: window.App?.TradeEngine, grudges: empireGrudges }), [allLeagues, model, scoreKey, empireGrudges]);
    const consolidation = useMemo(() => buildEmpireConsolidation(moves, model), [moves, model]);
    const empireLeagueIds = useMemo(() => (allLeagues || []).map(l => l.id || l.league_id).filter(Boolean), [allLeagues]);
    const empireDelta = useMemo(() => (window.WrSnapshots && typeof window.WrSnapshots.empireDelta === 'function') ? window.WrSnapshots.empireDelta(empireLeagueIds) : null, [empireLeagueIds, scoreKey]);
    const bridge = useMemo(() => buildCommandBridge({ model, actionQueue, brief: briefText, empireDelta }), [model, actionQueue, briefText, empireDelta]);

    const setFilter = useCallback((key, value) => {
        setFilters(prev => ({ ...prev, [key]: prev[key] === value ? '' : value }));
        setDetail(null);
    }, []);
    const applyLens = useCallback((nextFilters) => {
        setFilters({ ...emptyFilters, ...nextFilters });
        setDetail(null);
    }, []);
    const clearFilters = useCallback(() => {
        setFilters(emptyFilters);
        setDetail(null);
    }, []);

    const filtered = useMemo(() => {
        let provinces = model.provinces.slice();
        let assets = model.assets.slice();
        let picks = model.picks.slice();
        if (filters.league) {
            provinces = provinces.filter(p => p.id === filters.league);
            assets = assets.filter(a => a.leagueId === filters.league);
            picks = picks.filter(p => p.leagueId === filters.league);
        }
        if (filters.status) {
            provinces = provinces.filter(p => p.status === filters.status);
            const leagueIds = new Set(provinces.map(p => p.id));
            assets = assets.filter(a => leagueIds.has(a.leagueId));
            picks = picks.filter(p => leagueIds.has(p.leagueId));
        }
        if (filters.position) assets = assets.filter(a => a.pos === filters.position);
        if (filters.agePhase) assets = assets.filter(a => a.agePhase === filters.agePhase);
        if (filters.tier) assets = assets.filter(a => a.tier === filters.tier);
        if (filters.exposure) assets = assets.filter(a => a.exposureCount > 1);
        if (filters.assetType === 'picks') assets = [];
        if (filters.assetType === 'players') picks = [];
        const sorters = {
            dhq: (a, b) => b.dhq - a.dhq || b.exposureCount - a.exposureCount || a.name.localeCompare(b.name),
            exposure: (a, b) => b.exposureCount - a.exposureCount || b.dhq - a.dhq || a.name.localeCompare(b.name),
            age: (a, b) => (b.age || 0) - (a.age || 0) || b.dhq - a.dhq,
            league: (a, b) => a.leagueName.localeCompare(b.leagueName) || b.dhq - a.dhq,
            position: (a, b) => a.pos.localeCompare(b.pos) || b.dhq - a.dhq,
        };
        assets.sort(sorters[sort] || sorters.dhq);
        const totalDHQ = assets.reduce((sum, a) => sum + a.dhq, 0);
        const totalRecord = provinces.reduce((sum, p) => ({ wins: sum.wins + p.wins, losses: sum.losses + p.losses }), { wins: 0, losses: 0 });
        const healths = provinces.map(p => p.healthScore).filter(v => v != null);
        const avgHealth = healths.length ? Math.round(healths.reduce((sum, v) => sum + v, 0) / healths.length) : null;
        return { provinces, assets, picks, totalDHQ, totalRecord, avgHealth };
    }, [model, filters, sort]);

    const activeFilters = Object.values(filters).filter(Boolean).length;
    const hasNoResults = !filtered.provinces.length && !filtered.assets.length && !filtered.picks.length;
    const shareBasis = model.totals.useValueShare ? 'DHQ share' : 'asset count';
    const signalTone = sev => sev === 'high' ? 'var(--k-e74c3c, #e74c3c)' : sev === 'medium' ? 'var(--k-f0a500, #f0a500)' : 'var(--k-2ecc71, #2ecc71)';
    const filterActive = (key, value) => filters[key] === value;
    const rootClassName = 'empire-root' + ((new URLSearchParams(window.location.search || '').has('dev') || ['localhost', '127.0.0.1'].includes(window.location.hostname || '')) ? ' is-local-preview' : '');

    const actionForSignal = useCallback((signal) => {
        if (signal.pid) {
            setDetail({ type: 'player', pid: signal.pid });
            return;
        }
        if (signal.detail?.type) {
            setDetail(signal.detail);
            return;
        }
        if (signal.filter) setFilters(prev => ({ ...prev, ...signal.filter }));
    }, []);

    const actionForQueue = useCallback((action) => {
        if (action.pid) { setDetail({ type: 'player', pid: action.pid }); return; }
        if (action.leagueId) { setDetail({ type: 'league', leagueId: action.leagueId }); return; }
        if (action.sliceDetail?.type) { setDetail(action.sliceDetail); return; }
        if (action.filter) setFilters(prev => ({ ...prev, ...action.filter }));
    }, []);

    // Command Bridge KPI tile — renders a buildCommandBridge KPI (value + label + sub + WoW delta).
    const kpiToneColor = (t) => t === 'good' ? 'var(--good)' : t === 'warn' ? 'var(--warn)' : t === 'bad' ? 'var(--bad)' : t === 'gold' ? 'var(--gold)' : undefined;
    const kpiTile = (k) => {
        const d = k.delta;
        const deltaStr = (d && d.pct != null) ? ' ' + (d.dir === 'up' ? '▲' : d.dir === 'down' ? '▼' : '→') + Math.abs(d.pct) + '%' : '';
        const sub = (k.sub || '') + deltaStr;
        return (
            <div className="empire-kpi" key={k.key}>
                <strong style={{ color: kpiToneColor(k.tone) || undefined }}>{k.value}</strong>
                <span>{k.label}</span>
                {sub && <em>{sub}</em>}
            </div>
        );
    };
    const filterButton = (key, value, label, color) => (
        <button
            key={key + ':' + value}
            className={'empire-filter' + (filterActive(key, value) ? ' is-active' : '')}
            style={{ '--tone': color || 'var(--k-d4af37, #d4af37)' }}
            onClick={() => setFilter(key, value)}
            type="button"
        >
            {label}
        </button>
    );
    const lensButton = (label, nextFilters, color) => {
        const active = Object.keys(emptyFilters).every(key => (filters[key] || '') === (nextFilters[key] || ''));
        return (
            <button
                key={label}
                className={'empire-filter' + (active ? ' is-active' : '')}
                style={{ '--tone': color || 'var(--k-d4af37, #d4af37)' }}
                onClick={() => applyLens(nextFilters)}
                type="button"
            >
                {label}
            </button>
        );
    };
    const barRows = (items, filterKey, emptyText) => (
        <div className="empire-stack">
            {items.length ? items.map(item => (
                <button key={item.key} className="empire-row-btn empire-bar-row" type="button" onClick={() => setDetail({ type: 'slice', title: item.label + ' Allocation', filter: { [filterKey]: item.key } })} style={{ '--bar': item.color || 'var(--k-d4af37, #d4af37)', padding: '6px 7px' }}>
                    <strong>{item.label}</strong>
                    <div className="empire-track"><div className="empire-fill" style={{ width: Math.max(2, item.share) + '%' }} /></div>
                    <span>{item.share}%</span>
                </button>
            )) : <div className="empire-empty"><strong>No allocation</strong>{emptyText || 'Nothing matches the current filters.'}</div>}
        </div>
    );
    const qualityItem = (item) => {
        const tone = item.status === 'ready' ? 'var(--k-2ecc71, #2ecc71)' : item.status === 'partial' || item.status === 'loading' ? 'var(--k-f0a500, #f0a500)' : 'var(--k-e74c3c, #e74c3c)';
        return (
            <div key={item.key} className="empire-quality" style={{ '--tone': tone }}>
                <span>{item.label}</span>
                <strong>{item.status}</strong>
                <em>{item.detail}</em>
            </div>
        );
    };
    const assetRows = (assets, limit) => {
        const rows = assets.slice(0, limit || 120);
        return rows.map(asset => (
            <button
                key={asset.pid + ':' + asset.leagueId}
                type="button"
                className="empire-asset-row"
                data-testid="empire-asset-row"
                onClick={() => setDetail({ type: 'player', pid: asset.pid })}
            >
                <div className="empire-player-cell">
                    <img src={'https://sleepercdn.com/content/nfl/players/thumb/' + asset.pid + '.jpg'} onError={e => { e.currentTarget.style.display = 'none'; }} />
                    <strong>{asset.name}</strong>
                </div>
                <div><span className="empire-pill" style={{ '--tone': posColors[asset.pos] || 'var(--k-d4af37, #d4af37)' }}>{asset.pos}</span></div>
                <div>{asset.age || '-'}</div>
                <div>{asset.dhq > 0 ? empireCompact(asset.dhq) : 'No DHQ'}</div>
                <div><span className="empire-pill" style={{ '--tone': asset.agePhaseColor }}>{asset.agePhaseLabel}</span></div>
                <div>{asset.exposureCount > 1 ? asset.exposureCount + 'x' : '-'}</div>
                <div className="empire-truncate">{asset.leagueName}</div>
            </button>
        ));
    };

    const renderPlayerDetail = (pid) => {
        const exposure = model.exposure.find(item => item.pid === pid);
        const firstAsset = model.assets.find(asset => asset.pid === pid);
        if (!exposure && !firstAsset) return null;
        const item = exposure || firstAsset;
        const owned = model.assets.filter(asset => asset.pid === pid);
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Player Portfolio</strong><span>Ownership, exposure, and league context</span></div>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{item.name}</h1>
                            <p>{item.pos} - {item.team || 'FA'} - Age {item.age || '?'} - {item.agePhaseLabel || firstAsset?.agePhaseLabel || 'Unknown window'}</p>
                        </div>
                        <button className="empire-action" type="button" onClick={() => { if (typeof window.openPlayerModal === 'function') window.openPlayerModal(pid); }}>Full Player Card</button>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>DHQ</span><strong>{item.dhq > 0 ? item.dhq.toLocaleString() : 'No DHQ'}</strong></div>
                        <div className="empire-metric"><span>Exposure</span><strong>{owned.length}/{Math.max(1, model.provinces.length)} leagues</strong></div>
                        <div className="empire-metric"><span>Portfolio Share</span><strong>{model.totals.totalDHQ > 0 ? empirePercent(owned.reduce((s, a) => s + a.dhq, 0), model.totals.totalDHQ) + '%' : empirePercent(owned.length, Math.max(1, model.assets.length)) + '%'}</strong></div>
                        <div className="empire-metric"><span>Value Tier</span><strong>{item.tier || firstAsset?.tier || 'Unscored'}</strong></div>
                    </div>
                    <section className="empire-panel">
                        <div className="empire-panel-head"><strong>League Ownership</strong><em>{owned.length} roster slots</em></div>
                        <div className="empire-stack">
                            {owned.map(asset => {
                                const province = model.provinces.find(p => p.id === asset.leagueId);
                                return (
                                    <button key={asset.leagueId} className="empire-league-card" style={{ '--tone': province?.tierColor || 'var(--k-d4af37, #d4af37)' }} type="button" onClick={() => setDetail({ type: 'league', leagueId: asset.leagueId })}>
                                        <div>
                                            <strong>{asset.leagueName}</strong>
                                            <span>{province?.tier || 'UNKNOWN'} - {province?.wins || 0}-{province?.losses || 0} - HP {province?.healthScore ?? 'No read'}</span>
                                            <em>{province?.needs?.length ? 'Needs: ' + province.needs.join(', ') : 'No critical need flagged'}</em>
                                        </div>
                                        <b>{asset.dhq > 0 ? empireCompact(asset.dhq) : 'No DHQ'}</b>
                                    </button>
                                );
                            })}
                        </div>
                    </section>
                </main>
            </div>
        );
    };

    const renderLeagueDetail = (leagueId) => {
        const province = model.provinces.find(p => p.id === leagueId);
        if (!province) return null;
        const leagueAssets = model.assets.filter(asset => asset.leagueId === leagueId).sort((a, b) => b.dhq - a.dhq);
        const leaguePicks = model.picks.filter(pick => pick.leagueId === leagueId);
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>League Portfolio</strong><span>{province.name}</span></div>
                        <button className="empire-action" type="button" onClick={() => onEnterLeague(province.league)}>Open League</button>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{province.name}</h1>
                            <p>{province.tier} - {province.wins}-{province.losses} - rank {province.powerRank || '-'} of {province.teams || '-'}</p>
                        </div>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>Total DHQ</span><strong>{province.totalDHQ > 0 ? empireCompact(province.totalDHQ) : 'No DHQ'}</strong></div>
                        <div className="empire-metric"><span>Health</span><strong>{province.healthScore ?? 'No read'}</strong></div>
                        <div className="empire-metric"><span>Pick Capital</span><strong>{province.pickCount} picks</strong></div>
                        <div className="empire-metric"><span>Premium Picks</span><strong>{province.premiumPickCount}</strong></div>
                    </div>
                    <div className="empire-slice-grid">
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>Roster Direction</strong><em>{province.status}</em></div>
                            <div className="empire-stack">
                                <div className="empire-quality" style={{ '--tone': province.tierColor }}><span>Strengths</span><strong>{province.strengths.length ? province.strengths.join(', ') : 'None flagged'}</strong><em>Current roster edge</em></div>
                                <div className="empire-quality" style={{ '--tone': 'var(--k-e74c3c, #e74c3c)' }}><span>Needs</span><strong>{province.needs.length ? province.needs.join(', ') : 'None flagged'}</strong><em>Upgrade lanes</em></div>
                                <div className="empire-quality" style={{ '--tone': 'var(--purple)' }}><span>Draft Capital</span><strong>{leaguePicks.length} picks</strong><em>{leaguePicks.filter(p => p.acquired).length} acquired</em></div>
                            </div>
                        </section>
                        <section className="empire-workspace" style={{ marginTop: 0 }}>
                            <div className="empire-workspace-head"><strong>Top Assets</strong><span>{leagueAssets.length} players</span></div>
                            <div className="empire-table-head"><div>Player</div><div>Pos</div><div>Age</div><div>DHQ</div><div>Window</div><div>Exp</div><div>League</div></div>
                            {assetRows(leagueAssets, 80)}
                        </section>
                    </div>
                </main>
            </div>
        );
    };

    const renderSliceDetail = (slice) => {
        const sliceFilters = { ...emptyFilters, ...(slice.filter || {}) };
        let sliceAssets = model.assets.slice();
        let slicePicks = model.picks.slice();
        if (sliceFilters.position) sliceAssets = sliceAssets.filter(a => a.pos === sliceFilters.position);
        if (sliceFilters.agePhase) sliceAssets = sliceAssets.filter(a => a.agePhase === sliceFilters.agePhase);
        if (sliceFilters.tier) sliceAssets = sliceAssets.filter(a => a.tier === sliceFilters.tier);
        if (sliceFilters.status) {
            sliceAssets = sliceAssets.filter(a => a.leagueStatus === sliceFilters.status);
            const ids = new Set(model.provinces.filter(p => p.status === sliceFilters.status).map(p => p.id));
            slicePicks = slicePicks.filter(p => ids.has(p.leagueId));
        }
        if (sliceFilters.assetType === 'picks') sliceAssets = [];
        if (sliceFilters.assetType === 'players') slicePicks = [];
        const sliceDHQ = sliceAssets.reduce((sum, a) => sum + a.dhq, 0);
        const sliceExposure = sliceAssets.filter(a => a.exposureCount > 1).length;
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Portfolio Slice</strong><span>{slice.title || 'Filtered workspace'}</span></div>
                        <button className="empire-action" type="button" onClick={() => { setFilters(sliceFilters); setDetail(null); }}>Apply As Filter</button>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>{slice.title || 'Portfolio Slice'}</h1>
                            <p>{sliceAssets.length} players - {slicePicks.length} picks - {sliceExposure} multi-league exposures</p>
                        </div>
                    </section>
                    <div className="empire-detail-metrics">
                        <div className="empire-metric"><span>Slice DHQ</span><strong>{sliceDHQ > 0 ? empireCompact(sliceDHQ) : 'No DHQ'}</strong></div>
                        <div className="empire-metric"><span>Portfolio Share</span><strong>{model.totals.totalDHQ > 0 ? empirePercent(sliceDHQ, model.totals.totalDHQ) + '%' : empirePercent(sliceAssets.length, Math.max(1, model.assets.length)) + '%'}</strong></div>
                        <div className="empire-metric"><span>Players</span><strong>{sliceAssets.length}</strong></div>
                        <div className="empire-metric"><span>Picks</span><strong>{slicePicks.length}</strong></div>
                    </div>
                    <div className="empire-slice-grid">
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>Slice Mix</strong><em>{shareBasis}</em></div>
                            {barRows(model.positionAllocation.filter(p => sliceAssets.some(a => a.pos === p.key)), 'position', 'No positions in this slice.')}
                        </section>
                        <section className="empire-workspace" style={{ marginTop: 0 }}>
                            <div className="empire-workspace-head"><strong>Assets</strong><span>{sliceAssets.length} rows</span></div>
                            <div className="empire-table-head"><div>Player</div><div>Pos</div><div>Age</div><div>DHQ</div><div>Window</div><div>Exp</div><div>League</div></div>
                            {sliceAssets.length ? assetRows(sliceAssets.sort((a, b) => b.dhq - a.dhq || b.exposureCount - a.exposureCount), 160) : (
                                <div className="empire-empty"><strong>No players in this slice</strong>{slicePicks.length ? 'This view is focused on draft capital.' : 'Try a different filter.'}</div>
                            )}
                        </section>
                    </div>
                </main>
            </div>
        );
    };

    const renderMovesDetail = () => {
        const sells = moves.filter(m => m.type === 'sell');
        const buys = moves.filter(m => m.type === 'buy');
        return (
            <div className={rootClassName} data-testid="empire-root">
                <EmpireStyles />
                <div className="empire-header">
                    <div className="empire-topbar">
                        <button className="empire-back" type="button" onClick={() => setDetail(null)}>{"<"}</button>
                        <div className="empire-title"><strong>Empire Moves</strong><span>DHQ × Owner DNA × all leagues — moves you can't see from inside one league</span></div>
                    </div>
                </div>
                <main className="empire-detail">
                    <section className="empire-detail-hero">
                        <div>
                            <h1>Empire Moves</h1>
                            <p>{moves.length} portfolio-optimal {moves.length === 1 ? 'move' : 'moves'} · ranked by value × acceptance</p>
                        </div>
                    </section>
                    {consolidation ? (
                        <section className="empire-panel" style={{ marginBottom: 12 }}>
                            <div className="empire-panel-head"><strong>Consolidation Plan</strong><em>{consolidation.sells} sell → {consolidation.buys} buy · one campaign</em></div>
                            <div className="empire-stack">
                                {consolidation.steps.map((s, i) => (
                                    <div key={i} style={{ border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderLeft: '3px solid ' + s.tone, borderRadius: 7, padding: 10, background: 'var(--ov-1, rgba(255,255,255,0.024))' }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
                                            <strong style={{ color: 'var(--white, var(--k-ffffff, #ffffff))', fontSize: 'var(--text-body, 1rem)' }}>{s.title}</strong>
                                            <b style={{ color: s.tone, fontFamily: "var(--font-mono)", fontSize: 'var(--text-micro)', fontWeight: 800, letterSpacing: '0.1em' }}>{s.phase}</b>
                                        </div>
                                        <span style={{ display: 'block', color: 'var(--ov-9, rgba(255,255,255,0.58))', fontSize: 'var(--text-label, 0.75rem)', lineHeight: 1.45, marginTop: 5 }}>{s.detail}</span>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ) : null}
                    <div className="empire-slice-grid">
                        <section className="empire-workspace" style={{ marginTop: 0 }}>
                            <div className="empire-workspace-head"><strong>Ranked Moves</strong><span>{sells.length} sell · {buys.length} buy</span></div>
                            <div className="empire-stack" style={{ padding: 12 }}>
                                {moves.length ? moves.map((m, i) => (
                                    <button key={i} type="button" className="empire-signal" style={{ '--tone': m.type === 'sell' ? 'var(--k-5dade2, #5dade2)' : 'var(--k-2ecc71, #2ecc71)' }} onClick={() => m.pid && setDetail({ type: 'player', pid: m.pid })}>
                                        <div className="empire-signal-top"><strong>{m.title}</strong><b>{m.accept}% accept</b></div>
                                        <span>{m.why}</span>
                                        <em>{m.leagueName} · {m.posture} · {empireCompact(m.value)} DHQ</em>
                                    </button>
                                )) : (
                                    <div className="empire-empty"><strong>No clear moves yet</strong>Cross-league moves appear once opponent assessments finish loading. Open the dashboard for a moment, then return.</div>
                                )}
                            </div>
                        </section>
                        <section className="empire-panel">
                            <div className="empire-panel-head"><strong>Owner Rolodex</strong><em>by edge</em></div>
                            <div className="empire-stack">
                                {rolodex.filter(o => o.exploit >= 6).slice(0, 8).map((o, i) => (
                                    <button key={o.leagueId + ':' + o.ownerId + ':' + i} className="empire-league-card" style={{ '--tone': o.postureColor }} type="button" onClick={() => setDetail({ type: 'league', leagueId: o.leagueId })}>
                                        <div>
                                            <strong>{o.ownerName}</strong>
                                            <span>{o.leagueName} · {o.posture}</span>
                                            <em>{o.edge}</em>
                                        </div>
                                        <b>{o.exploit}</b>
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>
                </main>
            </div>
        );
    };

    if (detail?.type === 'player') return renderPlayerDetail(detail.pid);
    if (detail?.type === 'league') return renderLeagueDetail(detail.leagueId);
    if (detail?.type === 'slice' || detail?.type === 'quality') return renderSliceDetail(detail);
    if (detail?.type === 'moves') return renderMovesDetail();

    return (
        <div className={rootClassName} data-testid="empire-root">
            <EmpireStyles />
            <header className="empire-header">
                <div className="empire-topbar">
                    <button className="empire-back" type="button" onClick={onBack}>{"<"}</button>
                    {typeof window.ProTierIcon === 'function' ? <div style={{ width: 24, height: 24 }}>{React.createElement(window.ProTierIcon, { size: 24 })}</div> : null}
                    <div className="empire-title">
                        <strong>Empire Command Center</strong>
                        <span>Asset allocation - exposure - age windows - pick capital</span>
                    </div>
                    <button className="empire-action" type="button" style={{ marginLeft: 'auto', borderColor: 'rgba(155,138,251,0.4)', color: 'var(--purple)', background: 'rgba(155,138,251,0.08)' }} onClick={() => setDetail({ type: 'moves' })}>⚡ Empire Moves{moves.length ? ' · ' + moves.length : ''}</button>
                    <div className="empire-user">{userName}</div>
                </div>
                <div className="empire-kpis" data-testid="empire-command-strip">
                    {/* Command Bridge KPI strip — empire-wide overview (mockup contract), with
                        week-over-week deltas from the snapshot store. Lens filters drive the asset
                        table below, not these portfolio-level KPIs. */}
                    {bridge.kpis.map(kpiTile)}
                </div>
                <div className="empire-filters">
                    <span className="empire-filter-label">Lenses</span>
                    {lensButton('All', {}, 'var(--gold)')}
                    {lensButton('High Exposure', { exposure: 'multi', assetType: 'players' }, 'var(--purple)')}
                    {lensButton('Post-window', { agePhase: 'post' }, 'var(--bad)')}
                    {lensButton('Peak Assets', { agePhase: 'peak' }, 'var(--good)')}
                    {lensButton('Picks', { assetType: 'picks' }, 'var(--purple)')}
                    {lensButton('Contenders', { status: 'contender' }, 'var(--good)')}
                    {lensButton('Rebuilds', { status: 'rebuild' }, 'var(--bad)')}
                    <span className="empire-filter-label">Pos</span>
                    {['QB','RB','WR','TE','K','DEF','DL','LB','DB'].map(pos => filterButton('position', pos, window.App?.posLabel?.(pos) || (pos === 'DEF' ? 'D/ST' : pos), posColors[pos]))}
                    <span className="empire-filter-label">Age</span>
                    {filterButton('agePhase', 'build', 'Build', 'var(--k-4ecdc4, #4ecdc4)')}
                    {filterButton('agePhase', 'peak', 'Peak', 'var(--k-2ecc71, #2ecc71)')}
                    {filterButton('agePhase', 'value', 'Value', 'var(--k-f0a500, #f0a500)')}
                    {filterButton('agePhase', 'post', 'Post-window', 'var(--k-e74c3c, #e74c3c)')}
                    {activeFilters > 0 && <button className="empire-filter empire-clear" type="button" onClick={clearFilters}>Clear {activeFilters}</button>}
                </div>
            </header>

            <main className="empire-shell">
                {hasNoResults ? (
                    <div className="empire-empty" data-testid="empire-empty-state">
                        <strong>No portfolio results match this view</strong>
                        The current lens removes every league, player, and pick. Reset filters to return to the full portfolio.
                        <div style={{ marginTop: 12 }}><button className="empire-action" type="button" onClick={clearFilters}>Reset Filters</button></div>
                    </div>
                ) : (
                    <>
                        <section className="empire-bridge" data-testid="empire-bridge">
                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>Alex — Empire Brief</strong><em>{userName}</em></div>
                                <div className="empire-brief">
                                    <div className="empire-brief-av">A</div>
                                    <div>
                                        <div className="empire-brief-meta">Command read · all leagues</div>
                                        <div className="empire-brief-body">{briefText}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>Priority Queue</strong><em>{actionQueue.length} ranked moves</em></div>
                                <div className="empire-stack">
                                    {actionQueue.length ? actionQueue.map((action, i) => (
                                        <button key={i} type="button" className="empire-signal" style={{ '--tone': signalTone(action.severity) }} onClick={() => actionForQueue(action)}>
                                            <div className="empire-signal-top"><strong>{action.title}</strong>{action.metric ? <b>{action.metric}</b> : null}</div>
                                            <span>{action.detail}</span>
                                            <em>{action.cta}</em>
                                        </button>
                                    )) : <div className="empire-empty"><strong>Portfolio is clean</strong>No high-leverage moves flagged right now.</div>}
                                </div>
                            </div>
                        </section>
                        {rolodex.length ? (
                            <section className="empire-panel empire-rolodex" data-testid="empire-rolodex">
                                <div className="empire-panel-head"><strong>Owner Rolodex</strong><em>{rolodex.length} owners across {model.totals.leagues} leagues · ranked by edge</em></div>
                                <div className="empire-rolodex-grid">
                                    {rolodex.filter(o => o.exploit >= 6).slice(0, 8).map((o, i) => (
                                        <button key={o.leagueId + ':' + o.ownerId + ':' + i} className="empire-league-card" style={{ '--tone': o.postureColor }} type="button" onClick={() => setDetail({ type: 'league', leagueId: o.leagueId })}>
                                            <div>
                                                <strong>{o.ownerName}</strong>
                                                <span>{o.leagueName} · {o.posture}</span>
                                                <em>{o.edge}{o.needs.length ? ' · needs ' + o.needs.join(', ') : ''}</em>
                                            </div>
                                            <b>{o.exploit}</b>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        ) : null}
                        <section className="empire-main-grid">
                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>Asset Allocation</strong><em>{shareBasis}</em></div>
                                <div className="empire-panel-head" style={{ marginTop: 0 }}><strong style={{ fontSize: 'var(--text-body, 1rem)' }}>Position</strong><em>{model.positionAllocation.length} groups</em></div>
                                {barRows(model.positionAllocation, 'position', 'No player assets loaded.')}
                                <div className="empire-panel-head" style={{ marginTop: 12 }}><strong style={{ fontSize: 'var(--text-body, 1rem)' }}>Age Window</strong><em>build / peak / value / post</em></div>
                                {barRows(model.ageAllocation, 'agePhase', 'Age data is unavailable.')}
                                <div className="empire-panel-head" style={{ marginTop: 12 }}><strong style={{ fontSize: 'var(--text-body, 1rem)' }}>Value Tier</strong><em>{model.tierAllocation.length} tiers</em></div>
                                {barRows(model.tierAllocation, 'tier', 'DHQ tiers are unavailable.')}
                            </div>

                            <div className="empire-panel empire-center">
                                <div className="empire-panel-head"><strong>Risks And Opportunities</strong><em>ranked portfolio signals</em></div>
                                <div className="empire-stack">
                                    {model.signals.slice(0, 7).map((signal, i) => (
                                        <button key={i} type="button" className="empire-signal" style={{ '--tone': signalTone(signal.severity) }} onClick={() => actionForSignal(signal)}>
                                            <div className="empire-signal-top"><strong>{signal.title}</strong><b>{signal.metric}</b></div>
                                            <span>{signal.body}</span>
                                            <em>{signal.cta}</em>
                                        </button>
                                    ))}
                                </div>
                                <div className="empire-quality-grid">
                                    {model.dataQuality.items.map(qualityItem)}
                                </div>
                            </div>

                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>League Stack</strong><em>{filtered.provinces.length} active</em></div>
                                <div className="empire-stack">
                                    {filtered.provinces.length ? filtered.provinces
                                        .slice()
                                        .sort((a, b) => b.totalDHQ - a.totalDHQ || (b.healthScore || 0) - (a.healthScore || 0))
                                        .map(province => (
                                            <button key={province.id} className="empire-league-card" style={{ '--tone': province.tierColor }} type="button" onClick={() => setDetail({ type: 'league', leagueId: province.id })}>
                                                <div>
                                                    <strong>{province.name}</strong>
                                                    <span>{province.tier} - {province.wins}-{province.losses} - HP {province.healthScore ?? 'No read'}</span>
                                                    <em>{province.pickCount} picks - {province.premiumPickCount} premium - #{province.powerRank || '-'}/{province.teams || '-'}</em>
                                                </div>
                                                <b>{province.totalDHQ > 0 ? empireCompact(province.totalDHQ) : 'No DHQ'}</b>
                                            </button>
                                        )) : <div className="empire-empty"><strong>No leagues</strong>Reset filters or check roster sync.</div>}
                                </div>
                            </div>
                        </section>

                        <section className="empire-workspace">
                            <div className="empire-workspace-head">
                                <div>
                                    <strong>Asset Workspace</strong>
                                    <div style={{ color: 'var(--ov-9, rgba(255,255,255,0.5))', fontSize: 'var(--text-label, 0.75rem)', marginTop: 2 }}>{filtered.assets.length} players - {filtered.picks.length} picks - {activeFilters ? activeFilters + ' filters' : 'full portfolio'}</div>
                                </div>
                                <div className="empire-sort-row">
                                    {['dhq', 'exposure', 'age', 'position', 'league'].map(key => (
                                        <button key={key} className={'empire-ghost' + (sort === key ? ' is-active' : '')} type="button" onClick={() => setSort(key)}>{key}</button>
                                    ))}
                                </div>
                            </div>
                            {filters.assetType === 'picks' ? (
                                <div className="empire-quality-grid" style={{ padding: 12, marginTop: 0 }}>
                                    {model.pickCapital.byYear.map(year => (
                                        <button key={year.year} className="empire-league-card" style={{ '--tone': 'var(--purple)' }} type="button" onClick={() => setDetail({ type: 'slice', title: year.year + ' Draft Capital', filter: { assetType: 'picks' } })}>
                                            <div><strong>{year.year}</strong><span>{year.count} picks - {year.premium} premium</span><em>{year.acquired} acquired - {year.own} own</em></div>
                                            <b>{year.score > 0 ? empireCompact(year.score) : '—'}</b>
                                        </button>
                                    ))}
                                </div>
                            ) : filtered.assets.length ? (
                                <>
                                    <div className="empire-table-head"><div>Player</div><div>Pos</div><div>Age</div><div>DHQ</div><div>Window</div><div>Exp</div><div>League</div></div>
                                    {assetRows(filtered.assets, 150)}
                                </>
                            ) : (
                                <div className="empire-empty">
                                    <strong>No players match the current filters</strong>
                                    Pick-only or empty slices are shown above. Reset filters to return to all assets.
                                </div>
                            )}
                        </section>
                    </>
                )}
            </main>
        </div>
    );
}

// buildCommandBridge — the terminal HOME data contract. Pure composition of the portfolio
// model (KPI strip, radar = model.signals, league stack = model.provinces), the cross-league
// action queue, the brief, and week-over-week deltas from the snapshot store. The Command
// Bridge screen renders this object; no data work happens in the view.
//   input: { model, actionQueue, brief, empireDelta }  (empireDelta = WrSnapshots.empireDelta(leagueIds))
function buildCommandBridge(input) {
    input = input || {};
    const model = input.model || {};
    const totals = model.totals || {};
    const queue = input.actionQueue || [];
    const delta = input.empireDelta || null;
    const pickCapital = model.pickCapital || {};
    const provinces = model.provinces || [];
    const topExp = (model.exposure || [])[0] || null;

    const fmtK = v => {
        const n = Math.round(Number(v) || 0);
        if (n < 1000) return String(n);
        const k = n / 1000;
        return (k >= 100 ? Math.round(k) : Math.round(k * 10) / 10) + 'k';
    };
    const dir = d => (d == null ? null : d > 0 ? 'up' : d < 0 ? 'down' : 'flat');
    const healthTone = h => (h == null ? null : h >= 80 ? 'good' : h >= 65 ? 'warn' : 'bad');

    // Honest "in a playoff spot" — actual standings rank (wins, points-for tiebreak) vs the
    // league's playoff_teams. Uses each province's own league rosters, not a DHQ proxy.
    const inPlayoffSpot = p => {
        const lg = p.league || {};
        const rosters = lg.rosters || [];
        if (!rosters.length || !p.roster) return false;
        const cutoff = (lg.settings && lg.settings.playoff_teams) || 6;
        const pf = r => ((r.settings && r.settings.fpts) || 0) + (((r.settings && r.settings.fpts_decimal) || 0) / 100);
        const ranked = rosters.slice().sort((a, b) => {
            const aw = (a.settings && a.settings.wins) || 0, bw = (b.settings && b.settings.wins) || 0;
            return bw !== aw ? bw - aw : pf(b) - pf(a);
        });
        const rank = ranked.findIndex(r => String(r.roster_id) === String(p.roster.roster_id)) + 1;
        return rank > 0 && rank <= cutoff;
    };

    const rec = totals.totalRecord || { wins: 0, losses: 0 };
    const games = (rec.wins || 0) + (rec.losses || 0);
    const winPctStr = games ? ('.' + String(Math.round((rec.wins / games) * 1000)).padStart(3, '0')).replace('.1000', '1.000') : '—';
    const playoffSpots = provinces.filter(inPlayoffSpot).length;

    const dhqDelta = delta ? delta.totalDHQDelta : null;
    const prevDHQ = dhqDelta != null ? (totals.totalDHQ || 0) - dhqDelta : null;
    const dhqPct = (dhqDelta != null && prevDHQ) ? Math.round((dhqDelta / prevDHQ) * 1000) / 10 : null;
    const healthDelta = delta ? delta.avgHealthDelta : null;
    const highActions = queue.filter(a => a && a.severity === 'high').length;

    const kpis = [
        { key: 'value', label: 'Empire Value', value: fmtK(totals.totalDHQ),
          sub: 'DHQ across ' + (totals.leagues || 0) + ' leagues',
          delta: dhqDelta != null ? { dir: dir(dhqDelta), pct: dhqPct } : null },
        { key: 'record', label: 'Record', value: (rec.wins || 0) + '–' + (rec.losses || 0),
          sub: winPctStr + ' · ' + playoffSpots + ' in playoff spots' },
        { key: 'health', label: 'Avg Health', value: totals.avgHealth != null ? String(totals.avgHealth) : '—',
          tone: healthTone(totals.avgHealth),
          sub: healthDelta == null ? 'no prior week yet'
               : healthDelta === 0 ? 'flat week over week'
               : (healthDelta > 0 ? 'up ' : 'down ') + Math.abs(healthDelta) + ' from last week',
          delta: healthDelta != null ? { dir: dir(healthDelta), n: healthDelta } : null },
        { key: 'picks', label: 'Pick Capital', value: String(pickCapital.total || 0),
          sub: (pickCapital.premium || 0) + ' premium (R1–2)' },
        { key: 'exposure', label: 'Top Exposure', value: topExp ? topExp.exposurePct + '%' : '—',
          tone: topExp && topExp.exposurePct >= 50 ? 'warn' : null,
          sub: topExp ? topExp.name + ' · ' + topExp.count + ' of ' + (totals.leagues || 0) + ' leagues' : 'no duplicate exposure' },
        { key: 'actions', label: 'Open Actions', value: String(queue.length),
          tone: highActions ? 'gold' : null, sub: highActions + ' high priority' },
    ];

    return { kpis, queue, radar: model.signals || [], leagueStack: provinces, brief: input.brief || '' };
}

if (typeof window !== 'undefined') {
    window.App = window.App || {};
    window.App.buildEmpirePortfolioModel = buildEmpirePortfolioModel;
    window.buildEmpirePortfolioModel = buildEmpirePortfolioModel;
    window.App.buildEmpireActionQueue = buildEmpireActionQueue;
    window.App.buildEmpireBrief = buildEmpireBrief;
    window.App.buildEmpireRolodex = buildEmpireRolodex;
    window.App.buildEmpireGrudges = buildEmpireGrudges;
    window.App.inferDnaFromTransactions = inferDnaFromTransactions;
    window.App.buildEmpireDna = buildEmpireDna;
    window.App.buildEmpireMoves = buildEmpireMoves;
    window.App.buildEmpireConsolidation = buildEmpireConsolidation;
    window.App.buildCommandBridge = buildCommandBridge;
    window.EmpireDashboard = EmpireDashboard;
}

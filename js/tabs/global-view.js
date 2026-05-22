// js/tabs/global-view.js - Empire portfolio command center
// Cross-league asset allocation, exposure, age-window, pick capital, and drilldown workspaces.

function buildEmpirePortfolioModel(input) {
    input = input || {};
    const allLeagues = input.allLeagues || [];
    const playersData = input.playersData || {};
    const sleeperUserId = input.sleeperUserId;
    const scores = input.scores || {};
    const normPos = input.normPos || function(pos) { return pos || '?'; };
    const getAgeCurve = input.getAgeCurve || function(pos) {
        const peak = (input.peakWindows || {})[pos] || [24, 29];
        return { build: [22, Math.max(22, peak[0] - 1)], peak, decline: [peak[1] + 1, peak[1] + 3] };
    };
    const tradeValueTier = input.tradeValueTier || function(val) {
        if (val >= 7000) return { tier: 'Elite', col: '#2ECC71' };
        if (val >= 4000) return { tier: 'Starter', col: '#3498DB' };
        if (val >= 2000) return { tier: 'Depth', col: '#D4AF37' };
        if (val > 0) return { tier: 'Stash', col: 'rgba(255,255,255,0.58)' };
        return { tier: 'Unscored', col: 'rgba(255,255,255,0.38)' };
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
        if (tier === 'ELITE') return '#2ECC71';
        if (tier === 'CONTENDER') return '#3498DB';
        if (tier === 'CROSSROADS') return '#F0A500';
        if (tier === 'REBUILDING') return '#E74C3C';
        return 'rgba(255,255,255,0.46)';
    }
    function statusFromTier(tier) {
        if (tier === 'ELITE' || tier === 'CONTENDER') return 'contender';
        if (tier === 'CROSSROADS') return 'fringe';
        if (tier === 'REBUILDING') return 'rebuild';
        return 'unknown';
    }
    function agePhaseFor(pos, age) {
        if (!age || !Number.isFinite(Number(age))) return { key: 'unknown', label: 'Unknown', color: 'rgba(255,255,255,0.38)' };
        const curve = getAgeCurve(pos) || {};
        const peak = curve.peak || [24, 29];
        const decline = curve.decline || [peak[1] + 1, peak[1] + 3];
        if (age < peak[0]) return { key: 'build', label: 'Build', color: '#4ECDC4' };
        if (age <= peak[1]) return { key: 'peak', label: 'Peak', color: '#2ECC71' };
        if (age <= decline[1]) return { key: 'value', label: 'Value', color: '#F0A500' };
        return { key: 'post', label: 'Post-window', color: '#E74C3C' };
    }
    function addTotal(map, key, patch) {
        const safeKey = key || 'unknown';
        if (!map[safeKey]) map[safeKey] = { key: safeKey, label: patch.label || safeKey, count: 0, dhq: 0, color: patch.color };
        map[safeKey].count += patch.count || 0;
        map[safeKey].dhq += patch.dhq || 0;
        if (patch.color) map[safeKey].color = patch.color;
        if (patch.label) map[safeKey].label = patch.label;
    }
    function pickValue(round) {
        if (round === 1) return 100;
        if (round === 2) return 55;
        if (round === 3) return 28;
        if (round === 4) return 14;
        return 6;
    }

    allLeagues.forEach(league => {
        const rosters = league?.rosters || [];
        if (rosters.length) rosterLeagueCount++;
        const myRoster = rosters.find(r => sameId(r.owner_id, sleeperUserId) || sameId(r.owner_id, league?.myUserId) || sameId(r.roster_id, league?.myRosterId));
        if (!myRoster) return;

        const rosterPlayers = myRoster.players || [];
        const assessment = typeof assessTeam === 'function' ? assessTeam(myRoster.roster_id, league) : null;
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
            const valueTier = tradeValueTier(dhq) || { tier: 'Unscored', col: 'rgba(255,255,255,0.38)' };
            const name = player.full_name || [player.first_name, player.last_name].filter(Boolean).join(' ');
            const asset = {
                pid,
                name,
                pos,
                team: player.team || 'FA',
                age,
                dhq,
                tier: valueTier.tier || 'Unscored',
                tierColor: valueTier.col || 'rgba(255,255,255,0.38)',
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
            addTotal(positionTotals, pos, { label: pos, count: 1, dhq, color: input.posColors?.[pos] });
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
                    const own = { leagueId: province.id, leagueName: province.name, year, round, own: true, acquired: false, score: pickValue(round) };
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
                    const acquired = { leagueId: province.id, leagueName: province.name, year, round, own: false, acquired: true, score: pickValue(round) };
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
                title: pos.key + ' allocation is overweight',
                body: pos.share + '% of portfolio ' + (useValueShare ? 'DHQ' : 'asset count') + ' sits at ' + pos.key + '.',
                metric: pos.share + '%',
                filter: { position: pos.key },
                detail: { type: 'slice', title: pos.key + ' Allocation', filter: { position: pos.key } },
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
            .empire-root { min-height: 100vh; background: #070707; color: var(--text-primary, #f4f1e8); font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
            .empire-root.is-local-preview .empire-topbar { padding-top: 28px; min-height: 72px; }
            .empire-header { position: sticky; top: 0; z-index: 60; background: rgba(7,7,7,0.98); border-bottom: 1px solid rgba(212,175,55,0.22); box-shadow: 0 12px 32px rgba(0,0,0,0.35); }
            .empire-topbar { display: flex; align-items: center; gap: 12px; min-height: 48px; padding: 10px 24px; border-bottom: 1px solid rgba(255,255,255,0.055); box-sizing: border-box; }
            .empire-back, .empire-ghost, .empire-filter, .empire-row-btn, .empire-action { border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.035); color: rgba(255,255,255,0.72); border-radius: 6px; cursor: pointer; font-family: inherit; transition: border-color 120ms, background 120ms, transform 120ms, color 120ms; }
            .empire-back { width: 34px; height: 28px; font-size: 0.9rem; }
            .empire-back:hover, .empire-ghost:hover, .empire-filter:hover, .empire-row-btn:hover, .empire-action:hover { border-color: rgba(212,175,55,0.5); background: rgba(212,175,55,0.07); color: #f7e9b0; }
            .empire-title { display: flex; flex-direction: column; min-width: 0; }
            .empire-title strong { color: #D4AF37; font-family: 'Rajdhani', sans-serif; font-size: 1rem; letter-spacing: 0.1em; text-transform: uppercase; line-height: 1; }
            .empire-title span { color: rgba(255,255,255,0.48); font-size: 0.68rem; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-user { margin-left: auto; color: rgba(255,255,255,0.55); font-size: 0.72rem; white-space: nowrap; }
            .empire-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 0; padding: 0 24px; background: linear-gradient(90deg, rgba(212,175,55,0.055), rgba(78,205,196,0.025), rgba(124,107,248,0.035)); }
            .empire-kpi { min-width: 0; padding: 10px 12px; border-right: 1px solid rgba(255,255,255,0.055); }
            .empire-kpi strong { display: block; font-family: 'JetBrains Mono', 'SF Mono', Consolas, monospace; color: var(--white, #fff); font-size: 1.05rem; line-height: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-kpi span { display: block; margin-top: 5px; color: #D4AF37; font-size: 0.55rem; font-weight: 800; letter-spacing: 0.11em; text-transform: uppercase; }
            .empire-kpi em { display: block; margin-top: 2px; color: rgba(255,255,255,0.42); font-style: normal; font-size: 0.58rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-filters { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; padding: 9px 24px 10px; background: rgba(0,0,0,0.32); }
            .empire-filter-label { color: #D4AF37; font-size: 0.56rem; font-weight: 900; letter-spacing: 0.13em; text-transform: uppercase; margin-right: 2px; }
            .empire-filter { min-height: 28px; padding: 5px 10px; font-size: 0.68rem; font-weight: 800; color: rgba(255,255,255,0.52); }
            .empire-filter.is-active { border-color: var(--tone, #D4AF37); background: color-mix(in srgb, var(--tone, #D4AF37) 16%, transparent); color: var(--tone, #D4AF37); }
            .empire-clear { margin-left: auto; border-color: rgba(231,76,60,0.38); color: #E74C3C; }
            .empire-shell { max-width: 1760px; margin: 0 auto; padding: 18px 24px 40px; }
            .empire-main-grid { display: grid; grid-template-columns: minmax(270px, 0.84fr) minmax(420px, 1.34fr) minmax(290px, 0.92fr); gap: 12px; align-items: start; }
            .empire-panel { min-width: 0; border: 1px solid rgba(212,175,55,0.14); background: linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.014)); border-radius: 8px; padding: 12px; }
            .empire-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding-bottom: 8px; margin-bottom: 10px; border-bottom: 1px solid rgba(212,175,55,0.12); }
            .empire-panel-head strong { color: #D4AF37; font-family: 'Rajdhani', sans-serif; font-size: 0.98rem; letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-panel-head em { color: rgba(255,255,255,0.46); font-style: normal; font-size: 0.66rem; text-align: right; }
            .empire-stack { display: flex; flex-direction: column; gap: 8px; }
            .empire-bar-row { display: grid; grid-template-columns: 52px minmax(0,1fr) 46px; gap: 8px; align-items: center; color: rgba(255,255,255,0.62); font-size: 0.7rem; min-width: 0; }
            .empire-bar-row strong { color: var(--bar, #D4AF37); font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-track { height: 8px; border-radius: 99px; background: rgba(255,255,255,0.055); overflow: hidden; }
            .empire-fill { height: 100%; border-radius: 99px; background: var(--bar, #D4AF37); min-width: 2px; }
            .empire-signal { text-align: left; border: 1px solid rgba(255,255,255,0.07); border-left: 3px solid var(--tone, #D4AF37); background: rgba(255,255,255,0.026); color: inherit; border-radius: 7px; padding: 10px; cursor: pointer; font-family: inherit; }
            .empire-signal:hover { border-color: color-mix(in srgb, var(--tone, #D4AF37) 56%, rgba(255,255,255,0.08)); background: color-mix(in srgb, var(--tone, #D4AF37) 7%, transparent); }
            .empire-signal-top { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
            .empire-signal strong { color: var(--white, #fff); font-size: 0.78rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-signal b { color: var(--tone, #D4AF37); font-family: 'JetBrains Mono', monospace; font-size: 0.75rem; white-space: nowrap; }
            .empire-signal span { display: block; color: rgba(255,255,255,0.58); font-size: 0.68rem; line-height: 1.35; margin-top: 4px; }
            .empire-signal em { display: block; color: var(--tone, #D4AF37); font-style: normal; font-size: 0.62rem; margin-top: 6px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
            .empire-league-card { width: 100%; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 10px; text-align: left; border: 1px solid rgba(255,255,255,0.07); border-left: 3px solid var(--tone, #D4AF37); background: rgba(255,255,255,0.024); border-radius: 7px; padding: 9px; color: inherit; cursor: pointer; font-family: inherit; }
            .empire-league-card:hover { border-color: rgba(212,175,55,0.48); background: rgba(212,175,55,0.045); }
            .empire-league-card strong { display: block; color: var(--white, #fff); font-size: 0.76rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-league-card span, .empire-league-card em { display: block; color: rgba(255,255,255,0.52); font-size: 0.64rem; font-style: normal; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-league-card b { color: var(--tone, #D4AF37); font-family: 'JetBrains Mono', monospace; font-size: 0.72rem; white-space: nowrap; }
            .empire-quality-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px; margin-top: 12px; }
            .empire-quality { border: 1px solid rgba(255,255,255,0.065); background: rgba(0,0,0,0.18); border-radius: 7px; padding: 9px; border-left: 3px solid var(--tone, #D4AF37); min-width: 0; }
            .empire-quality span { display: block; color: rgba(255,255,255,0.5); font-size: 0.58rem; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; }
            .empire-quality strong { display: block; color: var(--white, #fff); font-size: 0.74rem; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-quality em { display: block; color: rgba(255,255,255,0.52); font-style: normal; font-size: 0.64rem; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-workspace { margin-top: 12px; border: 1px solid rgba(212,175,55,0.14); border-radius: 8px; background: rgba(255,255,255,0.018); overflow: hidden; }
            .empire-workspace-head, .empire-table-head, .empire-asset-row { display: grid; grid-template-columns: minmax(180px,1.3fr) 46px 54px 76px 78px 72px minmax(140px,1fr); gap: 8px; align-items: center; }
            .empire-workspace-head { display: flex; justify-content: space-between; gap: 12px; padding: 11px 12px; border-bottom: 1px solid rgba(212,175,55,0.12); }
            .empire-workspace-head strong { color: #D4AF37; font-family: 'Rajdhani', sans-serif; letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-sort-row { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
            .empire-ghost { padding: 5px 9px; font-size: 0.66rem; font-weight: 800; }
            .empire-ghost.is-active { color: #D4AF37; border-color: rgba(212,175,55,0.45); background: rgba(212,175,55,0.08); }
            .empire-table-head { padding: 7px 12px; color: #D4AF37; background: rgba(212,175,55,0.045); font-size: 0.58rem; font-weight: 900; letter-spacing: 0.08em; text-transform: uppercase; }
            .empire-asset-row { width: 100%; min-height: 34px; border: 0; border-bottom: 1px solid rgba(255,255,255,0.035); background: transparent; color: rgba(255,255,255,0.66); padding: 6px 12px; text-align: left; font-family: inherit; font-size: 0.72rem; cursor: pointer; }
            .empire-asset-row:nth-child(even) { background: rgba(255,255,255,0.012); }
            .empire-asset-row:hover { background: rgba(212,175,55,0.055); }
            .empire-player-cell { display: flex; align-items: center; gap: 7px; min-width: 0; }
            .empire-player-cell img { width: 22px; height: 22px; object-fit: cover; border-radius: 50%; flex: 0 0 auto; }
            .empire-player-cell strong, .empire-truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
            .empire-pill { display: inline-flex; align-items: center; justify-content: center; min-width: 28px; border-radius: 4px; padding: 2px 5px; color: var(--tone, #D4AF37); background: color-mix(in srgb, var(--tone, #D4AF37) 16%, transparent); font-size: 0.58rem; font-weight: 900; }
            .empire-empty { border: 1px dashed rgba(212,175,55,0.22); border-radius: 8px; padding: 20px; text-align: center; color: rgba(255,255,255,0.56); font-size: 0.78rem; }
            .empire-empty strong { display: block; color: #D4AF37; font-family: 'Rajdhani', sans-serif; font-size: 1rem; margin-bottom: 5px; }
            .empire-detail { max-width: 1380px; margin: 0 auto; padding: 18px 24px 42px; }
            .empire-detail-hero { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 18px; align-items: center; border: 1px solid rgba(212,175,55,0.18); background: linear-gradient(135deg, rgba(212,175,55,0.07), rgba(78,205,196,0.028), rgba(124,107,248,0.035)); border-radius: 9px; padding: 14px; margin-bottom: 12px; }
            .empire-detail-hero h1 { margin: 0; color: var(--white, #fff); font-family: 'Rajdhani', sans-serif; font-size: 1.45rem; letter-spacing: 0.04em; }
            .empire-detail-hero p { margin: 4px 0 0; color: rgba(255,255,255,0.58); font-size: 0.78rem; }
            .empire-detail-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px,1fr)); gap: 8px; margin-bottom: 12px; }
            .empire-metric { border: 1px solid rgba(255,255,255,0.065); background: rgba(255,255,255,0.024); border-radius: 7px; padding: 9px; min-width: 0; }
            .empire-metric span { display: block; color: rgba(255,255,255,0.5); font-size: 0.58rem; text-transform: uppercase; letter-spacing: 0.09em; font-weight: 800; }
            .empire-metric strong { display: block; color: var(--white, #fff); font-family: 'JetBrains Mono', monospace; font-size: 0.94rem; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .empire-action { padding: 7px 11px; font-size: 0.72rem; font-weight: 900; color: #D4AF37; border-color: rgba(212,175,55,0.32); background: rgba(212,175,55,0.065); }
            .empire-slice-grid { display: grid; grid-template-columns: minmax(260px,0.7fr) minmax(0,1.3fr); gap: 12px; }
            @media(max-width:1180px) {
                .empire-main-grid { grid-template-columns: minmax(0,1fr) minmax(0,1fr); }
                .empire-center { grid-column: 1 / -1; grid-row: 1; }
                .empire-workspace-head, .empire-table-head, .empire-asset-row { grid-template-columns: minmax(150px,1fr) 42px 46px 66px 66px 56px minmax(110px,0.8fr); }
            }
            @media(max-width:760px) {
                .empire-topbar { padding: 9px 14px; }
                .empire-kpis, .empire-filters { padding-left: 14px; padding-right: 14px; }
                .empire-shell, .empire-detail { padding-left: 14px; padding-right: 14px; }
                .empire-main-grid, .empire-slice-grid { grid-template-columns: 1fr; }
                .empire-user { display: none; }
                .empire-workspace-head { align-items: flex-start; flex-direction: column; }
                .empire-table-head, .empire-asset-row { grid-template-columns: minmax(140px,1fr) 40px 46px 58px 58px; }
                .empire-table-head div:nth-child(n+6), .empire-asset-row div:nth-child(n+6) { display: none; }
                .empire-detail-hero { grid-template-columns: 1fr; }
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
        posColors,
        getAgeCurve: window.App?.getAgeCurve,
        peakWindows: window.App?.peakWindows,
        tradeValueTier: window.App?.tradeValueTier,
        assessTeam: typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal : null,
        nowYear: new Date().getFullYear(),
        liLoaded: !!window.App?.LI_LOADED,
    }), [allLeagues, playersData, sleeperUserId, scoreKey]);

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
    const qualityTone = model.dataQuality.status === 'ready' ? '#2ECC71' : model.dataQuality.status === 'partial' || model.dataQuality.status === 'loading' ? '#F0A500' : '#E74C3C';
    const signalTone = sev => sev === 'high' ? '#E74C3C' : sev === 'medium' ? '#F0A500' : '#2ECC71';
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

    const metric = (label, value, sub, color) => (
        <div className="empire-kpi">
            <strong style={{ color: color || undefined }}>{value}</strong>
            <span>{label}</span>
            {sub && <em>{sub}</em>}
        </div>
    );
    const filterButton = (key, value, label, color) => (
        <button
            key={key + ':' + value}
            className={'empire-filter' + (filterActive(key, value) ? ' is-active' : '')}
            style={{ '--tone': color || '#D4AF37' }}
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
                style={{ '--tone': color || '#D4AF37' }}
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
                <button key={item.key} className="empire-row-btn empire-bar-row" type="button" onClick={() => setDetail({ type: 'slice', title: item.label + ' Allocation', filter: { [filterKey]: item.key } })} style={{ '--bar': item.color || '#D4AF37', padding: '6px 7px' }}>
                    <strong>{item.label}</strong>
                    <div className="empire-track"><div className="empire-fill" style={{ width: Math.max(2, item.share) + '%' }} /></div>
                    <span>{item.share}%</span>
                </button>
            )) : <div className="empire-empty"><strong>No allocation</strong>{emptyText || 'Nothing matches the current filters.'}</div>}
        </div>
    );
    const qualityItem = (item) => {
        const tone = item.status === 'ready' ? '#2ECC71' : item.status === 'partial' || item.status === 'loading' ? '#F0A500' : '#E74C3C';
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
                <div><span className="empire-pill" style={{ '--tone': posColors[asset.pos] || '#D4AF37' }}>{asset.pos}</span></div>
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
                                    <button key={asset.leagueId} className="empire-league-card" style={{ '--tone': province?.tierColor || '#D4AF37' }} type="button" onClick={() => setDetail({ type: 'league', leagueId: asset.leagueId })}>
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
                                <div className="empire-quality" style={{ '--tone': '#E74C3C' }}><span>Needs</span><strong>{province.needs.length ? province.needs.join(', ') : 'None flagged'}</strong><em>Upgrade lanes</em></div>
                                <div className="empire-quality" style={{ '--tone': '#9b8afb' }}><span>Draft Capital</span><strong>{leaguePicks.length} picks</strong><em>{leaguePicks.filter(p => p.acquired).length} acquired</em></div>
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

    if (detail?.type === 'player') return renderPlayerDetail(detail.pid);
    if (detail?.type === 'league') return renderLeagueDetail(detail.leagueId);
    if (detail?.type === 'slice' || detail?.type === 'quality') return renderSliceDetail(detail);

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
                    <div className="empire-user">{userName}</div>
                </div>
                <div className="empire-kpis" data-testid="empire-command-strip">
                    {metric('Portfolio', filtered.totalDHQ > 0 ? empireCompact(filtered.totalDHQ) : 'No DHQ', model.totals.useValueShare ? 'DHQ valued' : 'value engine pending', filtered.totalDHQ > 0 ? '#2ECC71' : '#F0A500')}
                    {metric('Data Sync', model.dataQuality.status, model.dataQuality.scoredAssets + '/' + model.assets.length + ' valued', qualityTone)}
                    {metric('Leagues', filtered.provinces.length, activeFilters ? 'of ' + model.provinces.length : 'portfolio')}
                    {metric('Assets', filtered.assets.length, model.exposure.filter(e => e.count > 1).length + ' duplicated')}
                    {metric('Picks', filtered.picks.length, model.pickCapital.premium + ' premium')}
                    {metric('Concentration', model.totals.topExposurePct + '%', 'top exposure', model.totals.topExposurePct >= 50 ? '#E74C3C' : '#D4AF37')}
                    {metric('Age Balance', (model.ageAllocation.find(a => a.key === 'peak')?.share || 0) + '/' + (model.ageAllocation.find(a => a.key === 'value')?.share || 0), 'peak/value %')}
                    {metric('Timeline', model.totals.contenders + 'C ' + model.totals.rebuilds + 'R', 'league mix')}
                </div>
                <div className="empire-filters">
                    <span className="empire-filter-label">Lenses</span>
                    {lensButton('All', {}, '#D4AF37')}
                    {lensButton('High Exposure', { exposure: 'multi', assetType: 'players' }, '#9b8afb')}
                    {lensButton('Post-window', { agePhase: 'post' }, '#E74C3C')}
                    {lensButton('Peak Assets', { agePhase: 'peak' }, '#2ECC71')}
                    {lensButton('Picks', { assetType: 'picks' }, '#9b8afb')}
                    {lensButton('Contenders', { status: 'contender' }, '#2ECC71')}
                    {lensButton('Rebuilds', { status: 'rebuild' }, '#E74C3C')}
                    <span className="empire-filter-label">Pos</span>
                    {['QB','RB','WR','TE','DL','LB','DB'].map(pos => filterButton('position', pos, pos, posColors[pos]))}
                    <span className="empire-filter-label">Age</span>
                    {filterButton('agePhase', 'build', 'Build', '#4ECDC4')}
                    {filterButton('agePhase', 'peak', 'Peak', '#2ECC71')}
                    {filterButton('agePhase', 'value', 'Value', '#F0A500')}
                    {filterButton('agePhase', 'post', 'Post-window', '#E74C3C')}
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
                        <section className="empire-main-grid">
                            <div className="empire-panel">
                                <div className="empire-panel-head"><strong>Asset Allocation</strong><em>{shareBasis}</em></div>
                                <div className="empire-panel-head" style={{ marginTop: 0 }}><strong style={{ fontSize: '0.78rem' }}>Position</strong><em>{model.positionAllocation.length} groups</em></div>
                                {barRows(model.positionAllocation, 'position', 'No player assets loaded.')}
                                <div className="empire-panel-head" style={{ marginTop: 12 }}><strong style={{ fontSize: '0.78rem' }}>Age Window</strong><em>build / peak / value / post</em></div>
                                {barRows(model.ageAllocation, 'agePhase', 'Age data is unavailable.')}
                                <div className="empire-panel-head" style={{ marginTop: 12 }}><strong style={{ fontSize: '0.78rem' }}>Value Tier</strong><em>{model.tierAllocation.length} tiers</em></div>
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
                                    <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.68rem', marginTop: 2 }}>{filtered.assets.length} players - {filtered.picks.length} picks - {activeFilters ? activeFilters + ' filters' : 'full portfolio'}</div>
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
                                        <button key={year.year} className="empire-league-card" style={{ '--tone': '#9b8afb' }} type="button" onClick={() => setDetail({ type: 'slice', title: year.year + ' Draft Capital', filter: { assetType: 'picks' } })}>
                                            <div><strong>{year.year}</strong><span>{year.count} picks - {year.premium} premium</span><em>{year.acquired} acquired - {year.own} own</em></div>
                                            <b>{year.score}</b>
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

if (typeof window !== 'undefined') {
    window.App = window.App || {};
    window.App.buildEmpirePortfolioModel = buildEmpirePortfolioModel;
    window.buildEmpirePortfolioModel = buildEmpirePortfolioModel;
    window.EmpireDashboard = EmpireDashboard;
}

// ══════════════════════════════════════════════════════════════════
// trade-calc.js — TradeCalcTab: Roster Audit, Owner DNA, Deal Analyzer, Trade History
// ══════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // TRADE CALCULATOR TAB — migrated from trade-calculator.html
    // ══════════════════════════════════════════════════════════════════════════
    function TradeCalcTab({ playersData, statsData, myRoster, standings, currentLeague, sleeperUserId, timeRecomputeTs, viewMode, initialSubTab, onSubTabConsumed }) {
        // ── Constants ──
        const STATS_YEAR_TC = (() => { const d = new Date(); return String(d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1); })();
        let WEEKLY_TARGET = 243;
        // Shared roster-construction constants from window.App.PlayerValue
        const { IDEAL_ROSTER, DRAFT_ROUNDS, PICK_HORIZON, PICK_IDEAL,
                LINEUP_STARTERS, MIN_STARTER_QUALITY, NFL_STARTER_POOL,
                POS_PT_TARGETS, POS_WEIGHTS, TOTAL_WEIGHT,
                PICK_VALUES, PICK_VALUES_BY_SLOT, PICK_COLORS, resolvePickValue: _resolvePickValue } = window.App.PlayerValue;
        const TC_POS_ORDER = { QB:0, RB:1, WR:2, TE:3, K:4, DL:5, LB:6, DB:7 };
        const MAX_VALUE = 10000;
        const FAAB_RATE = 2.0;

        const FLEX_ALLOWED = {
            REC_FLEX:['WR','TE'], FLEX:['RB','WR','TE'], WRTQ:['QB','RB','WR','TE'],
            SUPER_FLEX:['QB','RB','WR','TE'], IDP_FLEX:['DL','LB','DB'],
            WILDCARD:['QB','RB','WR','TE','K','DL','LB','DB'],
        };

        const DNA_TYPES = {
            NONE: { label: '— Not Set —', color: 'var(--silver)', desc: '', taxes: [] },
            FLEECER: { label: 'The Fleecer', color: '#E74C3C', desc: 'High activity, always hunting asymmetric value. Sends lowball offers constantly. Sharp but impatient — will counter-offer if you decline.', strategy: 'Counter with slightly above-fair value. They respect boldness. Never show urgency.', taxes: ['Endowment Effect +15%', 'Expects to "win" the trade'], multiplier: 0.85 },
            DOMINATOR: { label: 'The Dominator', color: '#E67E22', desc: 'High ego, requires a perceived +30% margin to pull the trigger. Motivated by status and bragging rights above all else.', strategy: 'Frame your offer as giving them the "better" side. Let them feel like they won.', taxes: ['Ego Premium +30%', 'Needs to feel superior', 'Grudge Tax if rejected'], multiplier: 0.75 },
            STALWART: { label: 'The Stalwart', color: '#5DADE2', desc: 'High stability, prefers 1-for-1 lateral moves. Emotionally attached to their roster. Slow to move but reliable when they engage.', strategy: 'Lead with fair value. Never low-ball. Highlight how the trade improves both sides equally.', taxes: ['Desire Tax on fan favorites', 'Prefers even-up deals'], multiplier: 1.0 },
            ACCEPTOR: { label: 'The Acceptor', color: '#2ECC71', desc: 'Low attachment, willing to sell current assets for future picks and young players. Rebuilding or just indifferent.', strategy: 'Offer future assets (picks, young upside). They discount current stars — exploit it.', taxes: ['Future Asset Bonus +20%', 'Discounts veterans -15%'], multiplier: 1.15 },
            DESPERATE: { label: 'The Desperate', color: '#BB8FCE', desc: 'High urgency triggered by injuries, bye-weeks, or playoff push. Will massively overpay for an immediate starter.', strategy: 'Identify their empty slot or injury. Strike fast — desperation fades after their bye.', taxes: ['Panic Multiplier up to +40%', 'Time-sensitive window'], multiplier: 1.3 },
        };

        const GRUDGE_TYPES = {
            ACCEPTED_FAIR: { label:'Accepted — Fair Trade', impact:+5, color:'#2ECC71', icon:'OK', cat:'accepted', dnaSignal:{ STALWART:3 } },
            ACCEPTED_WON:  { label:'Accepted — Fleeced Them', impact:-8, color:'#E67E22', icon:'UP', cat:'accepted', dnaSignal:{ FLEECER:3, DOMINATOR:1 } },
            ACCEPTED_LOST: { label:'Accepted — Got Fleeced', impact:+10, color:'#BB8FCE', icon:'DN', cat:'accepted', dnaSignal:{ ACCEPTOR:3, DESPERATE:2 } },
            REJECTED:      { label:'Rejected', impact:-15, color:'#E74C3C', icon:'X', cat:'rejected', dnaSignal:{ DOMINATOR:3, FLEECER:1 } },
            COUNTER_FAIR:  { label:'Counter — Fair', impact:+3, color:'#5DADE2', icon:'<>', cat:'counter', dnaSignal:{ STALWART:2, FLEECER:1 } },
            COUNTER_LOWBALL:{ label:'Counter — Lowball', impact:-10, color:'#E67E22', icon:'v', cat:'counter', dnaSignal:{ FLEECER:3, DOMINATOR:2 } },
        };

        const POSTURES = window.App?.TradeEngine?.POSTURES || {
            DESPERATE: { key:'DESPERATE', label:'Desperate', color:'#BB8FCE', desc:'Panic-mode — will overpay for immediate help.' },
            BUYER:     { key:'BUYER',     label:'Active Buyer', color:'#F0A500', desc:'Contender upgrading — open to deals.' },
            NEUTRAL:   { key:'NEUTRAL',   label:'Neutral', color:'#95A5A6', desc:'No strong push. Fair offers only.' },
            SELLER:    { key:'SELLER',    label:'Active Seller', color:'#5DADE2', desc:'Moving assets for futures.' },
            LOCKED:    { key:'LOCKED',    label:'Locked In', color:'#7F8C8D', desc:'Satisfied roster, high attachment.' },
        };

        // ── Helper functions ──
        const normPos = window.App.normPos;
        function posColor(pos) {
            const c = { QB:'#FF6B6B', RB:'#4ECDC4', WR:'#45B7D1', TE:'#F7DC6F', K:'#BB8FCE', DL:'#E67E22', LB:'#F0A500', DB:'#5DADE2' };
            return c[pos] || 'var(--silver)';
        }
        function avatarUrl(id) { return id ? `https://sleepercdn.com/avatars/thumbs/${id}` : null; }

        const calcPPG = (pid, scoring) => window.App.calcPPG(statsData[pid], scoring);
        function calcSeasonPts(pid, scoring) {
            const s = statsData[pid]; if (!s) return 0;
            const total = window.App.calcRawPts(s, scoring);
            return total !== null ? Math.max(0, total) : 0;
        }
        function parseStarterSlots(rosterPositions) {
            const slots = {};
            for (const s of (rosterPositions || [])) { if (s === 'BN' || s === 'TAXI') continue; slots[s] = (slots[s] || 0) + 1; }
            return slots;
        }
        function calcOptimalLineup(playerIds, reserve, taxi, scoring, rosterPositions) {
            const resSet = new Set(reserve || []); const taxiSet = new Set(taxi || []);
            const active = playerIds.filter(id => !resSet.has(id) && !taxiSet.has(id)).map(id => {
                const p = playersData[id]; if (!p) return null;
                return { id, np: normPos(p.position), ppg: calcPPG(id, scoring) };
            }).filter(Boolean).sort((a,b) => b.ppg - a.ppg);
            const slots = parseStarterSlots(rosterPositions);
            let total = 0; const used = new Set();
            for (const slot of ['QB','RB','WR','TE','K','DL','LB','DB','DEF']) {
                const count = slots[slot] || 0; let filled = 0;
                for (const p of active) { if (filled >= count) break; if (!used.has(p.id) && p.np === slot) { total += p.ppg; used.add(p.id); filled++; } }
            }
            for (const [slot, allowed] of Object.entries(FLEX_ALLOWED)) {
                const count = slots[slot] || 0;
                for (let i = 0; i < count; i++) { for (const p of active) { if (!used.has(p.id) && allowed.includes(p.np)) { total += p.ppg; used.add(p.id); break; } } }
            }
            return Math.round(total * 10) / 10;
        }

        function computeWeeklyTarget(rosters) {
            const scoring = currentLeague.scoring_settings;
            const rosterPositions = currentLeague.roster_positions;
            const ppgs = rosters.map(r => calcOptimalLineup(r.players || [], r.reserve || [], r.taxi || [], scoring, rosterPositions)).filter(v => v > 0).sort((a,b) => a - b);
            if (!ppgs.length) return 150;
            return Math.round(ppgs[Math.floor(ppgs.length / 2)] * 1.05);
        }

        function calcNflStarterSet() {
            const scoring = currentLeague.scoring_settings;
            const byPos = {};
            for (const [id, p] of Object.entries(playersData)) {
                const pos = normPos(p.position);
                if (!pos || !(pos in NFL_STARTER_POOL)) continue;
                if (!p.team) continue;
                if (!byPos[pos]) byPos[pos] = [];
                const score = calcSeasonPts(id, scoring);
                if (score > 0) byPos[pos].push({ id, score });
            }
            const result = {};
            for (const [pos, players] of Object.entries(byPos)) {
                const poolSize = NFL_STARTER_POOL[pos];
                result[pos] = new Set(players.sort((a,b) => b.score - a.score).slice(0, poolSize).map(p => p.id));
            }
            return result;
        }

        function getPlayerValue(pid) {
            const dhqScore = window.App?.LI?.playerScores?.[pid];
            if (dhqScore != null && dhqScore > 0) return { value: dhqScore, source: 'dhq' };
            return { value: 0, source: 'none' };
        }
        const getPickValue = window.App.PlayerValue.getPickValue;

        function detectPickIdMode(rosters, tradedPicks) {
            const rosterIds = new Set(rosters.map(r => String(r.roster_id)));
            const userIds = new Set(rosters.map(r => String(r.owner_id)));
            let rosterHits = 0, userHits = 0;
            for (const tp of tradedPicks || []) {
                const oid = String(tp.owner_id ?? '');
                if (rosterIds.has(oid)) rosterHits++;
                if (userIds.has(oid)) userHits++;
            }
            return rosterHits >= userHits ? 'roster' : 'user';
        }

        function buildPicksByOwner(rosters, tradedPicks, leagueSeason) {
            const PICK_YEARS_INT = Array.from({ length: PICK_HORIZON }, (_, i) => leagueSeason + i);
            const mode = detectPickIdMode(rosters, tradedPicks);
            const rosterById = {};
            for (const r of rosters) rosterById[String(r.roster_id)] = r;
            const ownerByKey = {};
            for (const r of rosters) {
                const originRosterId = String(r.roster_id);
                const ownerUserId = String(r.owner_id);
                for (const y of PICK_YEARS_INT) { for (let rd = 1; rd <= DRAFT_ROUNDS; rd++) { ownerByKey[`${y}-${rd}-${originRosterId}`] = ownerUserId; } }
            }
            for (const tp of tradedPicks || []) {
                const y = Number(tp.season); if (!PICK_YEARS_INT.includes(y)) continue;
                const rd = Number(tp.round); if (!Number.isFinite(rd) || rd < 1 || rd > DRAFT_ROUNDS) continue;
                const originRosterId = String(tp.roster_id);
                let newOwnerUserId;
                if (mode === 'user') { newOwnerUserId = String(tp.owner_id ?? ''); }
                else { const r = rosterById[String(tp.owner_id ?? '')]; newOwnerUserId = r?.owner_id ? String(r.owner_id) : null; }
                if (!newOwnerUserId) continue;
                const key = `${y}-${rd}-${originRosterId}`;
                if (key in ownerByKey) ownerByKey[key] = newOwnerUserId;
            }
            const picksByOwner = {};
            for (const [key, ownerUserId] of Object.entries(ownerByKey)) {
                const parts = key.split('-');
                const y = Number(parts[0]), rd = Number(parts[1]), fromRosterId = parts[2];
                if (!picksByOwner[ownerUserId]) picksByOwner[ownerUserId] = [];
                picksByOwner[ownerUserId].push({ year: y, round: rd, fromRosterId });
            }
            for (const oid of Object.keys(picksByOwner)) { picksByOwner[oid].sort((a, b) => a.year - b.year || a.round - b.round); }
            return picksByOwner;
        }

        function assessTeamLocal(roster, nflStarterSet, ownerPicks) {
            // Try shared assessor first
            if (window.assessTeamFromGlobal) {
                const result = window.assessTeamFromGlobal(roster.roster_id);
                if (result) return result;
            }
            const scoring = currentLeague.scoring_settings;
            const rosterPos = currentLeague.roster_positions || [];
            const users = currentLeague.users || [];
            const user = users.find(u => u.user_id === roster.owner_id);
            const teamName = user?.metadata?.team_name || `Team ${roster.roster_id}`;
            const ownerName = user?.display_name || `Owner ${roster.roster_id}`;
            const avatar = user?.avatar || null;
            const wins = roster.settings?.wins || 0;
            const losses = roster.settings?.losses || 0;
            const ties = roster.settings?.ties || 0;
            const pf = Number(roster.settings?.fpts || 0) + Number(roster.settings?.fpts_decimal || 0) / 100;
            const waiverBudget = Number(currentLeague.settings?.waiver_budget || 1000);
            const waiverUsed = Number(roster.settings?.waiver_budget_used || 0);
            const faabRemaining = Math.max(0, waiverBudget - waiverUsed);

            const posGroups = {};
            for (const id of (roster.players || [])) {
                const np = normPos(playersData[id]?.position); if (!np) continue;
                if (!posGroups[np]) posGroups[np] = [];
                posGroups[np].push(id);
            }

            const posAssessment = {};
            for (const [pos, ideal] of Object.entries(IDEAL_ROSTER)) {
                const playerIds = posGroups[pos] || [];
                const startingReq = MIN_STARTER_QUALITY[pos] ?? LINEUP_STARTERS[pos] ?? 1;
                const ptTarget = POS_PT_TARGETS[pos] || 8;
                const withPPG = playerIds.map(id => ({ id, ppg: calcPPG(id, scoring) })).sort((a,b) => b.ppg - a.ppg);
                const projectedPts = withPPG.slice(0, startingReq).reduce((s, p) => s + p.ppg, 0);
                const posStarters = nflStarterSet[pos] || new Set();
                const nflStarterIds = playerIds.filter(id => posStarters.has(id));
                const nflStarters = nflStarterIds.length;
                const actual = playerIds.length;
                const diff = actual - ideal;
                const minQuality = MIN_STARTER_QUALITY[pos] || startingReq;

                let status;
                if (nflStarters === 0) status = 'deficit';
                else if (nflStarters < minQuality) status = 'thin';
                else if (actual >= ideal) status = 'surplus';
                else status = 'ok';
                if ((status === 'ok' || status === 'surplus') && actual < ideal) status = 'thin';

                const sortedIds = [...playerIds].map(id => ({ id, score: calcSeasonPts(id, scoring) })).sort((a,b) => b.score - a.score).map(p => p.id);
                posAssessment[pos] = { actual, ideal, diff, nflStarters, nflStarterIds, sortedIds, startingReq, minQuality, ptTarget, projectedPts, status };
            }

            const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
            const pickYears = Array.from({ length: PICK_HORIZON }, (_, i) => String(leagueSeason + i));
            const pickCountByRound = {}; const pickCountByYear = {}; const pickCountByYearRound = {};
            for (let r = 1; r <= DRAFT_ROUNDS; r++) pickCountByRound[r] = 0;
            for (const year of pickYears) { pickCountByYear[year] = 0; pickCountByYearRound[year] = {}; for (let r = 1; r <= DRAFT_ROUNDS; r++) pickCountByYearRound[year][r] = 0; }
            for (const { year, round } of (ownerPicks || [])) {
                const y = String(year); if (!pickYears.includes(y)) continue;
                if (round < 1 || round > DRAFT_ROUNDS) continue;
                pickCountByRound[round]++; pickCountByYear[y]++; pickCountByYearRound[y][round]++;
            }
            const totalPicks = Object.values(pickCountByRound).reduce((a, b) => a + b, 0);
            let picksStatus;
            if (totalPicks === 0) picksStatus = 'deficit';
            else if (totalPicks < PICK_IDEAL) picksStatus = 'thin';
            else if (totalPicks === PICK_IDEAL) picksStatus = 'ok';
            else picksStatus = 'surplus';
            const picksAssessment = { pickCountByRound, pickCountByYear, pickCountByYearRound, totalPicks, draftRounds: DRAFT_ROUNDS, idealTotal: PICK_IDEAL, pickYears, status: picksStatus };

            const weeklyPts = calcOptimalLineup(roster.players || [], roster.reserve || [], roster.taxi || [], scoring, rosterPos);
            const scoringScore = Math.min(60, (weeklyPts / WEEKLY_TARGET) * 60);
            let coverageScore = 0;
            const hasValueData = Object.keys(nflStarterSet).length > 0;
            for (const [pos, data] of Object.entries(posAssessment)) {
                const ratio = hasValueData ? Math.min(1, data.nflStarters / (data.minQuality || data.startingReq || 1)) : Math.min(1, data.actual / data.ideal);
                coverageScore += ratio * ((POS_WEIGHTS[pos]||0) / TOTAL_WEIGHT) * 40;
            }
            const projBonus = weeklyPts > WEEKLY_TARGET + 10 ? 3 : weeklyPts >= WEEKLY_TARGET ? 1 : 0;
            const healthScore = Math.min(100, Math.round(scoringScore + coverageScore + projBonus));

            let tier, tierColor, tierBg;
            if (weeklyPts > 0) {
                if (weeklyPts > WEEKLY_TARGET + 10) { tier='ELITE'; tierColor='#D4AF37'; tierBg='rgba(212,175,55,0.15)'; }
                else if (weeklyPts >= WEEKLY_TARGET - 15) { tier='CONTENDER'; tierColor='#2ECC71'; tierBg='rgba(46,204,113,0.12)'; }
                else if (weeklyPts >= WEEKLY_TARGET * 0.85) { tier='CROSSROADS'; tierColor='#F0A500'; tierBg='rgba(240,165,0,0.12)'; }
                else { tier='REBUILDING'; tierColor='#E74C3C'; tierBg='rgba(231,76,60,0.12)'; }
            } else {
                if (coverageScore >= 36) { tier='CONTENDER'; tierColor='#2ECC71'; tierBg='rgba(46,204,113,0.12)'; }
                else if (coverageScore >= 26) { tier='CROSSROADS'; tierColor='#F0A500'; tierBg='rgba(240,165,0,0.12)'; }
                else { tier='REBUILDING'; tierColor='#E74C3C'; tierBg='rgba(231,76,60,0.12)'; }
            }

            let panic = 0;
            if (weeklyPts > 0 && weeklyPts < WEEKLY_TARGET * 0.85) panic += 2;
            else if (weeklyPts > 0 && weeklyPts < WEEKLY_TARGET) panic += 1;
            const criticals = Object.values(posAssessment).filter(p => p.status === 'deficit').length;
            if (criticals >= 3) panic += 2; else if (criticals >= 1) panic += 1;
            const played = wins + losses + ties;
            if (played > 0 && losses / played > 0.6) panic += 1;
            panic = Math.min(5, panic);

            let tradeWindow;
            if (tier === 'ELITE' || (tier === 'CONTENDER' && panic <= 1)) tradeWindow = 'CONTENDING';
            else if (tier === 'REBUILDING') tradeWindow = 'REBUILDING';
            else tradeWindow = 'TRANSITIONING';

            const needs = Object.entries(posAssessment).filter(([,v]) => v.status === 'deficit' || v.status === 'thin')
                .sort((a,b) => { const aGap = a[1].nflStarters - a[1].startingReq; const bGap = b[1].nflStarters - b[1].startingReq; return aGap !== bGap ? aGap - bGap : a[1].diff - b[1].diff; })
                .map(([pos,v]) => ({ pos, urgency: v.status }));
            const strengths = Object.entries(posAssessment).filter(([,v]) => v.status === 'surplus').map(([pos]) => pos);

            return { rosterId:roster.roster_id, ownerId:roster.owner_id, teamName, ownerName, avatar, wins, losses, ties, pf,
                     posGroups, posAssessment, picksAssessment, weeklyPts, healthScore, tier, tierColor, tierBg, panic, window: tradeWindow, needs, strengths,
                     faabRemaining, waiverBudget };
        }

        const calcComplementarity = window.App?.TradeEngine?.calcComplementarity || function(mine, theirs) { if (!mine || !theirs) return 0; let score = 0; for (const n of mine.needs) { const t = theirs.posAssessment[n.pos]; if (t?.status === 'surplus') score += n.urgency === 'deficit' ? 25 : 12; else if (t?.status === 'ok' && n.urgency === 'deficit') score += 6; } for (const n of theirs.needs) { const m = mine.posAssessment[n.pos]; if (m?.status === 'surplus') score += n.urgency === 'deficit' ? 25 : 12; else if (m?.status === 'ok' && n.urgency === 'deficit') score += 6; } if (mine.window !== theirs.window) score += 15; return Math.min(100, score); };
        const calcOwnerPosture = window.App?.TradeEngine?.calcOwnerPosture || function(assessment, dnaKey) { if (!assessment) return POSTURES.NEUTRAL; const { tier, panic } = assessment; if (panic >= 4) return POSTURES.DESPERATE; if (tier === 'REBUILDING' || dnaKey === 'ACCEPTOR') return POSTURES.SELLER; if (tier === 'ELITE' && panic <= 1) return POSTURES.LOCKED; if ((tier === 'CONTENDER' || tier === 'CROSSROADS') && panic >= 2) return POSTURES.BUYER; return POSTURES.NEUTRAL; };
        const calcPsychTaxes = window.App?.TradeEngine?.calcPsychTaxes || function(myAssess, theirAssess, theirDnaKey, theirPosture) { const taxes = []; const ePct = { FLEECER:10, DOMINATOR:28, STALWART:20, ACCEPTOR:5, DESPERATE:15, NONE:12 }[theirDnaKey] || 12; taxes.push({ name:'Endowment Effect', impact:-Math.round(ePct/2), type:'TAX', desc:`~${ePct}% mental inflation on their own players.` }); if (theirAssess?.panic >= 3) taxes.push({ name:'Panic Premium', impact:8+(theirAssess.panic-2)*6, type:'BONUS', desc:`Panic ${theirAssess.panic}/5 — urgency overrides caution.` }); if (theirDnaKey === 'DOMINATOR') taxes.push({ name:'Status Tax', impact:-18, type:'TAX', desc:'Must visibly win the trade for ego/status.' }); if (['STALWART','DOMINATOR'].includes(theirDnaKey)) taxes.push({ name:'Loss Aversion', impact:-8, type:'TAX', desc:'Losing a familiar player hurts more than gaining a new one.' }); if (theirDnaKey === 'ACCEPTOR') taxes.push({ name:'Rebuilding Discount', impact:+10, type:'BONUS', desc:'They mentally discount current starters.' }); const myStrengths = myAssess?.strengths || []; const theirNeedPos = theirAssess?.needs?.slice(0,3).map(n=>n.pos) || []; if (theirNeedPos.some(p => myStrengths.includes(p))) taxes.push({ name:'Need Fulfillment', impact:+12, type:'BONUS', desc:'Your surplus fills their critical gap.' }); if (myAssess && theirAssess) { if (myAssess.window !== theirAssess.window) taxes.push({ name:'Window Alignment', impact:+8, type:'BONUS', desc:'Opposite windows = natural asset exchange.' }); else taxes.push({ name:'Window Friction', impact:-5, type:'TAX', desc:'Same window reduces natural motivation.' }); } if (theirPosture?.key === 'LOCKED') taxes.push({ name:'Locked Roster Tax', impact:-12, type:'TAX', desc:'High satisfaction + attachment.' }); else if (theirPosture?.key === 'SELLER') taxes.push({ name:'Seller Momentum', impact:+10, type:'BONUS', desc:'Actively shopping. Trade conversations welcomed.' }); return taxes; };
        const calcAcceptanceLikelihood = window.App?.TradeEngine?.calcAcceptanceLikelihood || window.App?.calcAcceptanceLikelihood || function(myValue, theirValue, _dnaKey, psychTaxes, _myAssess, _theirAssess, opts) { const maxSide = Math.max(myValue, theirValue, 1); const valueLean = (myValue - theirValue) / maxSide; const tax = (psychTaxes || []).reduce((sum, t) => sum + (t.impact || 0), 0); const complexity = Math.max(0, ((opts?.totalPieces) || 0) - 4) * 5; return Math.round(Math.max(3, Math.min(95, 50 + valueLean * 70 + Math.max(-15, Math.min(15, tax)) - complexity))); };

        const grudgeDecay = d => d < 30 ? 1.0 : d < 60 ? 0.6 : d < 90 ? 0.3 : 0.1;
        const GRUDGE_KEY = lid => `od_grudges_v1_${lid}`;
        function loadGrudges(lid) { try { return JSON.parse(localStorage.getItem(GRUDGE_KEY(lid)) || '[]'); } catch(e) { return []; } }
        function saveGrudges(lid, data) { localStorage.setItem(GRUDGE_KEY(lid), JSON.stringify(data)); }

        function calcGrudgeTax(myOwnerId, theirOwnerId, grudgesList, theirDnaKey) {
            if (!myOwnerId || !theirOwnerId) return { total:0, entries:[] };
            const relevant = grudgesList.filter(g => g.myOwnerId === myOwnerId && g.theirOwnerId === theirOwnerId);
            const dnaMult = { FLEECER:0.7, DOMINATOR:1.6, STALWART:1.2, ACCEPTOR:0.8, DESPERATE:0.5, NONE:1.0 }[theirDnaKey] || 1.0;
            const now = Date.now();
            let total = 0;
            for (const g of relevant) {
                const ageDays = (now - new Date(g.date).getTime()) / 86400000;
                total += (GRUDGE_TYPES[g.type]?.impact || 0) * grudgeDecay(ageDays) * dnaMult;
            }
            return { total:Math.round(total), entries:relevant.sort((a,b) => new Date(b.date)-new Date(a.date)) };
        }

        function deriveDNAFromHistory(theirOwnerId, allGrudges) {
            const entries = allGrudges.filter(g => g.theirOwnerId === theirOwnerId);
            if (entries.length < 3) return null;
            const scores = { FLEECER:0, DOMINATOR:0, STALWART:0, ACCEPTOR:0, DESPERATE:0 };
            for (const g of entries) { const sig = GRUDGE_TYPES[g.type]?.dnaSignal || {}; for (const [dna, w] of Object.entries(sig)) scores[dna] = (scores[dna]||0) + w; }
            const ranked = Object.entries(scores).sort((a,b)=>b[1]-a[1]);
            const [top, second] = ranked;
            if (top[1] < 3) return null;
            if (second && top[1] < second[1] * 1.5) return null;
            return top[0];
        }

        function computeWeightedDNA(rosterId) {
            const allTrades = window.App?.LI?.tradeHistory || [];
            const profile = window.App?.LI?.ownerProfiles?.[rosterId] || {};
            const trades = allTrades.filter(t => t.roster_ids?.includes(rosterId));
            if (trades.length < 2) return null;

            const scores = { FLEECER:0, DOMINATOR:0, STALWART:0, ACCEPTOR:0, DESPERATE:0 };
            const signals = [];

            // Trade frequency vs league average
            const leagueSize = Math.max(1, window.App?.LI?.rosters?.length || allRosters.length || 10);
            const avgTrades = allTrades.length / leagueSize;
            if (avgTrades > 0) {
                const ratio = trades.length / avgTrades;
                if (ratio < 0.5) { scores.STALWART += 4; signals.push('Low trade activity'); }
                else if (ratio > 1.75) { scores.FLEECER += 3; signals.push('High trade volume'); }
            }

            // Win rate from owner profile
            const totalGraded = (profile.tradesWon||0) + (profile.tradesLost||0) + (profile.tradesFair||0);
            if (totalGraded >= 2) {
                const winRate = (profile.tradesWon||0) / totalGraded;
                const lossRate = (profile.tradesLost||0) / totalGraded;
                const fairRate = (profile.tradesFair||0) / totalGraded;
                if (winRate > 0.55) { scores.FLEECER += Math.round(winRate*6); signals.push(`Wins ${Math.round(winRate*100)}% of trades`); }
                if (lossRate > 0.45) { scores.ACCEPTOR += 2; scores.DESPERATE += 2; signals.push(`Loses ${Math.round(lossRate*100)}% of trades`); }
                if (fairRate > 0.55) { scores.STALWART += 2; signals.push('Prefers balanced deals'); }
            }

            // Average DHQ per trade
            const avgDiff = profile.avgValueDiff || 0;
            if (avgDiff > 400) { scores.FLEECER += 4; signals.push(`Avg +${Math.round(avgDiff)} DHQ/trade`); }
            else if (avgDiff > 100) { scores.DOMINATOR += 2; signals.push(`Avg +${Math.round(avgDiff)} DHQ/trade`); }
            else if (avgDiff < -300) { scores.DESPERATE += 3; scores.ACCEPTOR += 1; signals.push(`Avg ${Math.round(avgDiff)} DHQ/trade`); }
            else if (Math.abs(avgDiff) <= 150) { scores.STALWART += 2; signals.push('Balanced trade value'); }

            // Trade composition: picks vs players, elite asset flow
            let picksReceived = 0, picksSent = 0, elitePlayersSent = 0, elitePlayersReceived = 0, lateSeasonLosses = 0;
            const eliteThreshold = 5000;
            for (const t of trades) {
                const mySide = t.sides?.[rosterId] || { players:[], picks:[] };
                const otherRid = t.roster_ids.find(r => r !== rosterId);
                const theirSide = t.sides?.[otherRid] || { players:[], picks:[] };
                const myValue = mySide.totalValue || 0;
                const theirValue = theirSide.totalValue || 0;
                picksReceived += (mySide.picks||[]).length;
                picksSent += (theirSide.picks||[]).length;
                for (const pid of (theirSide.players||[])) { if ((window.App?.LI?.playerScores?.[pid]||0) > eliteThreshold) elitePlayersSent++; }
                for (const pid of (mySide.players||[])) { if ((window.App?.LI?.playerScores?.[pid]||0) > eliteThreshold) elitePlayersReceived++; }
                if ((t.week||0) >= 10 && theirValue > myValue * 1.15) lateSeasonLosses++;
            }

            // DOMINATOR: gives picks to acquire proven players (win-now aggression)
            if (picksSent > 1 && picksReceived < picksSent * 0.7) { scores.DOMINATOR += 3; signals.push('Trades picks for players (win-now)'); }
            // ACCEPTOR: gives players for picks (rebuilding mode)
            if (picksReceived > 1 && picksSent < picksReceived * 0.7) { scores.ACCEPTOR += 3; signals.push('Trades players for picks'); }
            // DESPERATE: sells elite talent away
            if (elitePlayersSent >= 2 && elitePlayersSent > elitePlayersReceived) { scores.DESPERATE += 4; signals.push(`Sold ${elitePlayersSent} elite players`); }
            // FLEECER: acquires elite assets in favorable deals
            if (elitePlayersReceived >= 2 && elitePlayersReceived > elitePlayersSent) { scores.FLEECER += 3; signals.push(`Acquired ${elitePlayersReceived} elite players`); }
            // Late-season panic: lost trades in weeks 10+
            if (lateSeasonLosses >= 2) { scores.DESPERATE += 3; signals.push(`${lateSeasonLosses} late-season panic trades`); }

            const ranked = Object.entries(scores).filter(([,v])=>v>0).sort((a,b)=>b[1]-a[1]);
            if (!ranked.length || ranked[0][1] < 3) return null;
            const [topEntry, secondEntry] = ranked;
            const totalScore = ranked.reduce((s,[,v])=>s+v, 0);
            const dominance = secondEntry ? (topEntry[1]-secondEntry[1])/topEntry[1] : 1;
            const proportion = topEntry[1] / totalScore;
            const confidence = Math.min(92, Math.round((proportion*0.6 + dominance*0.4) * 100));
            if (confidence < 22) return null;
            return { key:topEntry[0], confidence, reasoning:signals.slice(0,4).join(' · ') || 'Based on trade patterns' };
        }

        function calcElitePlayers(assessmentsList) {
            const scoring = currentLeague.scoring_settings;
            const byPos = {};
            for (const a of assessmentsList) {
                for (const [pos, ids] of Object.entries(a.posGroups || {})) {
                    if (pos === 'FB') continue; if (!byPos[pos]) byPos[pos] = [];
                    for (const id of ids) { const pts = calcSeasonPts(id, scoring); byPos[pos].push({ id, pts }); }
                }
            }
            const eliteSet = new Set();
            for (const players of Object.values(byPos)) { players.sort((a,b) => b.pts - a.pts).slice(0,5).forEach(p => eliteSet.add(p.id)); }
            return eliteSet;
        }

        // ── State ──
        const [tcTab, setTcTab] = useState(initialSubTab || 'dealhq');
        const [dealMode, setDealMode] = useState('fillNeed');
        const [dealFocusPid, setDealFocusPid] = useState(null);
        const [selectedDealPartnerId, setSelectedDealPartnerId] = useState(null);
        const [dealHqNotice, setDealHqNotice] = useState(null);
        const [showAllDeals, setShowAllDeals] = useState(false);
        useEffect(() => {
            if (!initialSubTab) return;
            if (initialSubTab === 'finder') {
                window._wrAnalyzerMode = 'find';
                setDealMode('acquire');
                setTcTab('dealhq');
            } else if (initialSubTab === 'dna') {
                setTcTab('profiles');
            } else {
                setTcTab(initialSubTab);
            }
            if (onSubTabConsumed) onSubTabConsumed();
        }, [initialSubTab]);
        const [finderAutoTarget, setFinderAutoTarget] = useState(null);
        useEffect(() => {
            const openFinder = (target) => {
                const next = target?.detail || target || window._wrTradeFinderTarget;
                if (!next?.pid) return;
                window._wrAnalyzerMode = 'find';
                setDealMode(next.mode === 'my' ? 'shop' : 'acquire');
                setDealFocusPid(next.pid);
                setTcTab('dealhq');
                setFinderAutoTarget({ pid: next.pid, mode: next.mode || 'acquire' });
                window._wrTradeFinderTarget = null;
            };
            window.addEventListener('wr:open-trade-finder', openFinder);
            openFinder(window._wrTradeFinderTarget);
            return () => window.removeEventListener('wr:open-trade-finder', openFinder);
        }, []);
        const [ownerDna, setOwnerDna] = useState({});
        const [grudges, setGrudges] = useState([]);
        const [sortMode, setSortMode] = useState('health');
        const [tierFilter, setTierFilter] = useState('ALL');
        const [selectedAuditTeam, setSelectedAuditTeam] = useState(null);

        // Trade Analyzer state
        const [tradeIds, setTradeIds] = useState({ A:[], B:[] });
        const [tradePickIds, setTradePickIds] = useState({ A:[], B:[] });
        const [tradeFaab, setTradeFaab] = useState({ A:0, B:0 });
        const [tradeOwner, setTradeOwner] = useState({ A:null, B:null });
        const [searchText, setSearchText] = useState({ A:'', B:'' });
        const lastTradeLogRef = useRef('');
        const tradeStartedRef = useRef(false);
        useEffect(() => {
            const hasA = tradeIds.A.length > 0 || tradePickIds.A.length > 0 || tradeFaab.A > 0;
            const hasB = tradeIds.B.length > 0 || tradePickIds.B.length > 0 || tradeFaab.B > 0;
            const sig = JSON.stringify([tradeIds, tradePickIds, tradeFaab]);
            if ((hasA || hasB) && !tradeStartedRef.current) {
                tradeStartedRef.current = true;
                window.OD?.trackTradeStarted?.({
                    platform: 'warroom',
                    module: 'trades',
                    leagueId: currentLeague?.league_id || currentLeague?.id || null,
                    metadata: { hasA, hasB },
                });
            }
            if (hasA && hasB) {
                if (sig !== lastTradeLogRef.current) {
                    lastTradeLogRef.current = sig;
                    window.wrLogAction?.('\uD83D\uDD04', 'Evaluated trade proposal', 'trade', { actionType: 'trade-builder' });
                    window.OD?.trackTradeEvaluated?.({
                        platform: 'warroom',
                        module: 'trades',
                        leagueId: currentLeague?.league_id || currentLeague?.id || null,
                        metadata: {
                            myPlayers: tradeIds.A.length,
                            theirPlayers: tradeIds.B.length,
                            myPicks: tradePickIds.A.length,
                            theirPicks: tradePickIds.B.length,
                            myFaab: tradeFaab.A || 0,
                            theirFaab: tradeFaab.B || 0,
                        },
                    });
                }
            }
        }, [tradeIds, tradePickIds, tradeFaab]);

        // DNA tab state
        const [ownerDraftDna, setOwnerDraftDna] = useState({});
        const [draftDnaSyncing, setDraftDnaSyncing] = useState(false);
        const [draftDnaSyncMsg, setDraftDnaSyncMsg] = useState(null);
        const [expandedDnaOwner, setExpandedDnaOwner] = useState(null);
        const [inboxMode, setInboxMode] = useState('recent');
        const [inboxTeamFilter, setInboxTeamFilter] = useState('all');

        const allRosters = currentLeague.rosters || [];
        const leagueUsers = currentLeague.users || [];
        const leagueId = currentLeague.id || currentLeague.league_id;
        const WR_KEYS = window.App?.WR_KEYS || window.WR_KEYS || {};
        const WrStorage = window.App?.WrStorage || window.WrStorage || null;
        const savedDealsKey = (WR_KEYS.SAVED_TRADES && leagueId)
            ? WR_KEYS.SAVED_TRADES(leagueId)
            : `wr_saved_trades_${leagueId || 'default'}`;
        const [savedDeals, setSavedDeals] = useState([]);
        useEffect(() => {
            if (!leagueId) return;
            const loaded = WrStorage?.get
                ? WrStorage.get(savedDealsKey, [])
                : (() => { try { return JSON.parse(localStorage.getItem(savedDealsKey) || '[]'); } catch(e) { return []; } })();
            setSavedDeals(Array.isArray(loaded) ? loaded : []);
        }, [leagueId, savedDealsKey, WrStorage]);

        // Fetch draft slot maps for accurate pick ownership (slot_to_roster_id from Sleeper)
        const [draftSlotMaps, setDraftSlotMaps] = useState({});
        useEffect(() => {
            if (!leagueId || !allRosters.length) return;
            (async () => {
                try {
                    const drafts = await fetch('https://api.sleeper.app/v1/league/' + leagueId + '/drafts').then(r => r.ok ? r.json() : []);
                    if (!drafts?.length) return;
                    const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
                    const pickYears = Array.from({ length: PICK_HORIZON }, (_, i) => leagueSeason + i);
                    const relevantDrafts = drafts.filter(d => pickYears.includes(Number(d.season)));
                    if (!relevantDrafts.length) return;
                    const details = await Promise.all(relevantDrafts.map(d =>
                        fetch('https://api.sleeper.app/v1/draft/' + d.draft_id).then(r => r.ok ? r.json() : null).catch(() => null)
                    ));
                    const maps = {};
                    const rosterIdByOwnerId = {};
                    allRosters.forEach(r => { if (r.owner_id != null) rosterIdByOwnerId[String(r.owner_id)] = String(r.roster_id); });
                    details.forEach((d, i) => {
                        if (!d?.slot_to_roster_id && !d?.draft_order && !relevantDrafts[i]?.draft_order) return;
                        const year = Number(relevantDrafts[i].season);
                        const rosterToSlot = {};
                        if (d.slot_to_roster_id) {
                            Object.entries(d.slot_to_roster_id).forEach(([slot, rosterId]) => {
                                rosterToSlot[String(rosterId)] = parseInt(slot);
                            });
                        } else {
                            Object.entries(d.draft_order || relevantDrafts[i].draft_order || {}).forEach(([ownerOrRosterId, slot]) => {
                                const rosterId = rosterIdByOwnerId[String(ownerOrRosterId)] || (allRosters.some(r => String(r.roster_id) === String(ownerOrRosterId)) ? String(ownerOrRosterId) : null);
                                if (rosterId) rosterToSlot[rosterId] = parseInt(slot);
                            });
                        }
                        maps[year] = rosterToSlot;
                    });
                    setDraftSlotMaps(maps);
                    console.log('[TradeCalc] Draft slot maps loaded:', Object.keys(maps).length, 'years');
                } catch (e) { console.warn('[TradeCalc] Draft slot maps failed:', e); }
            })();
        }, [leagueId, allRosters.length]);

        function ownerNameForRosterId(rid) { const r = allRosters.find(x => String(x.roster_id) === String(rid)); if (!r) return null; const u = leagueUsers.find(x => x.user_id === r.owner_id); return u?.display_name || null; }

        // Compute WEEKLY_TARGET
        const wt = useMemo(() => {
            if (!allRosters.length || !Object.keys(playersData).length) return 243;
            return computeWeeklyTarget(allRosters);
        }, [allRosters, playersData, statsData]);
        WEEKLY_TARGET = wt;

        // Load DNA + grudges on mount
        useEffect(() => {
            if (!leagueId) return;
            if (window.OD?.loadDNA) {
                window.OD.loadDNA(leagueId).then(d => {
                    const dnaMap = d || {};
                    // Auto-apply AI DNA recommendations for owners without saved DNA
                    if (allRosters.length && typeof computeWeightedDNA === 'function') {
                        allRosters.forEach(r => {
                            const rid = r.roster_id;
                            if (!dnaMap[r.owner_id]) {
                                const aiDna = computeWeightedDNA(rid);
                                if (aiDna) dnaMap[r.owner_id] = aiDna.key;
                            }
                        });
                    }
                    setOwnerDna(dnaMap);
                }).catch(() => setOwnerDna({}));
            }
            setGrudges(loadGrudges(leagueId));
            if (window.DraftHistory?.loadDraftDNA) setOwnerDraftDna(window.DraftHistory.loadDraftDNA(leagueId) || {});
            if (window.DraftHistory?.syncDraftDNA) window.DraftHistory.syncDraftDNA(leagueId).then(map => setOwnerDraftDna(map || {})).catch(err => window.wrLog('tradecalc.syncDraftDNA', err));
        }, [leagueId]);

        // Compute assessments
        const nflStarterSet = useMemo(() => {
            if (!Object.keys(playersData).length || !Object.keys(statsData).length) return {};
            return calcNflStarterSet();
        }, [playersData, statsData]);

        const tradedPicks = useMemo(() => window.S?.tradedPicks || [], [currentLeague]);

        const picksByOwner = useMemo(() => {
            if (!allRosters.length) return {};
            const leagueSeason = parseInt(currentLeague.season || new Date().getFullYear());
            return buildPicksByOwner(allRosters, tradedPicks, leagueSeason);
        }, [allRosters, tradedPicks]);

        const assessments = useMemo(() => {
            if (!allRosters.length || !Object.keys(playersData).length) return [];
            return allRosters.map(r => {
                const ownerPicks = picksByOwner[String(r.owner_id)] || [];
                return assessTeamLocal(r, nflStarterSet, ownerPicks);
            });
        }, [allRosters, playersData, statsData, nflStarterSet, picksByOwner, timeRecomputeTs]);

        const myRosterId = myRoster?.roster_id;
        const myAssessment = useMemo(() => assessments.find(a => a.rosterId === myRosterId) || null, [assessments, myRosterId]);
        const elitePlayerSet = useMemo(() => assessments.length ? calcElitePlayers(assessments) : new Set(), [assessments, statsData]);

        // Auto-set Side A to my team
        useEffect(() => {
            if (myAssessment?.ownerId) setTradeOwner(prev => ({ ...prev, A: myAssessment.ownerId }));
        }, [myAssessment?.ownerId]);

        const sortedAssessments = useMemo(() => {
            let list = [...assessments];
            if (tierFilter !== 'ALL') list = list.filter(a => a.tier === tierFilter);
            if (sortMode === 'health') list.sort((a,b) => b.healthScore - a.healthScore);
            else if (sortMode === 'panic') list.sort((a,b) => b.panic - a.panic);
            else if (sortMode === 'record') list.sort((a,b) => b.wins - a.wins || b.pf - a.pf);
            return list;
        }, [assessments, sortMode, tierFilter]);

        const avgHealth = assessments.length ? Math.round(assessments.reduce((s,a) => s + a.healthScore, 0) / assessments.length) : 0;
        const eliteTeamCount = assessments.filter(a => a.tier === 'ELITE').length;
        const highPanic = assessments.filter(a => a.panic >= 3).length;
        function updateDna(ownerId, dnaKey) {
            const updated = { ...ownerDna, [ownerId]: dnaKey };
            setOwnerDna(updated);
            if (window.OD?.saveDNA) window.OD.saveDNA(leagueId, updated);
        }

        function formatPickLabel(year, round, fromRosterId) {
            const slot = draftSlotMaps?.[Number(year)]?.[String(fromRosterId)] || null;
            if (slot) return `${year} ${round}.${String(slot).padStart(2, '0')}`;
            return `${year} R${round}`;
        }

        function makePickId(year, round, fromRosterId) {
            return `PICK-${year}-${round}-${fromRosterId}`;
        }

        function pickValueForParts(year, round, fromRosterId) {
            const hasKnownSlot = draftSlotMaps?.[Number(year)]?.[String(fromRosterId)];
            if (hasKnownSlot && typeof _resolvePickValue === 'function') {
                const resolved = _resolvePickValue(year, Number(round), fromRosterId, allRosters, draftSlotMaps);
                if (resolved?.value != null) return resolved.value;
            }
            return getPickValue(year, Number(round), allRosters.length);
        }

        function playerAsset(pid) {
            const p = playersData[pid];
            if (!p) return null;
            const pos = normPos(p.position) || p.position || '?';
            const value = getPlayerValue(pid).value || 0;
            return {
                type: 'player',
                id: String(pid),
                pid,
                name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid),
                pos,
                team: p.team || 'FA',
                age: p.age || null,
                value,
            };
        }

        function pickAsset(pick) {
            if (!pick) return null;
            const year = pick.year || pick.season;
            const round = Number(pick.round);
            const fromRosterId = pick.fromRosterId || pick.roster_id || pick.originalRosterId;
            const value = pick.val || pick.value || pickValueForParts(year, round, fromRosterId);
            return {
                type: 'pick',
                id: makePickId(year, round, fromRosterId),
                year,
                round,
                fromRosterId,
                label: formatPickLabel(year, round, fromRosterId),
                via: ownerNameForRosterId(fromRosterId),
                value,
            };
        }

        function assetsForRoster(roster, opts = {}) {
            if (!roster) return [];
            const playerIds = [...new Set([...(roster.players || []), ...(roster.reserve || []), ...(roster.taxi || [])])];
            const exclude = new Set(opts.exclude || []);
            return playerIds
                .filter(pid => !exclude.has(pid))
                .map(playerAsset)
                .filter(a => a && a.value > 0 && (!opts.positions || opts.positions.includes(a.pos)))
                .sort((a, b) => b.value - a.value);
        }

        function pickAssetsForOwner(ownerId) {
            return (picksByOwner[String(ownerId)] || [])
                .map(pickAsset)
                .filter(Boolean)
                .sort((a, b) => b.value - a.value || a.year - b.year || a.round - b.round);
        }

        function sideBreakdown(players = [], picks = [], faab = 0) {
            const playerValue = players.reduce((s, a) => s + (a.value || 0), 0);
            const pickValue = picks.reduce((s, a) => s + (a.value || 0), 0);
            const faabValue = Math.round((faab || 0) * FAAB_RATE);
            return {
                playerValue,
                pickValue,
                pickCount: picks.length,
                faab: faab || 0,
                faabValue,
                total: playerValue + pickValue + faabValue,
            };
        }

        function dealWindowImpact(givePlayers, receivePlayers) {
            const yearsFor = asset => {
                const end = typeof window.App?.getValueWindowEnd === 'function'
                    ? window.App.getValueWindowEnd(asset.pos)
                    : ((window.App?.peakWindows || {})[asset.pos] || [24, 29])[1];
                return Math.max(0, end - (asset.age || 25));
            };
            const give = (givePlayers || []).reduce((s, p) => s + yearsFor(p), 0);
            const receive = (receivePlayers || []).reduce((s, p) => s + yearsFor(p), 0);
            const delta = receive - give;
            if (delta >= 3) return { label: 'Extends window', color: '#2ECC71' };
            if (delta <= -3) return { label: 'Shortens window', color: '#E74C3C' };
            return { label: 'Window neutral', color: 'var(--silver)' };
        }

        function explainRosterSwing(partner, givePlayers, receivePlayers) {
            const receivePos = [...new Set((receivePlayers || []).map(p => p.pos))];
            const givePos = [...new Set((givePlayers || []).map(p => p.pos))];
            const myNeeds = (myAssessment?.needs || []).map(n => n.pos);
            const theirNeeds = (partner?.needs || []).map(n => n.pos);
            const fixesMine = receivePos.find(pos => myNeeds.includes(pos));
            const fixesTheirs = givePos.find(pos => theirNeeds.includes(pos));
            if (fixesMine && fixesTheirs) return `Mutual need fit: you add ${fixesMine}, they add ${fixesTheirs}.`;
            if (fixesMine) return `Addresses your ${fixesMine} gap.`;
            if (fixesTheirs) return `Fills their ${fixesTheirs} need.`;
            if (receivePos.length || givePos.length) return `Asset swap centered on ${[...receivePos, ...givePos].slice(0, 2).join('/')}.`;
            return 'Draft capital and FAAB shape the deal more than roster fit.';
        }

        function buildDeal(partner, input) {
            if (!partner || !myAssessment) return null;
            const dnaKey = ownerDna[partner.ownerId] || 'NONE';
            const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
            const posture = calcOwnerPosture(partner, dnaKey);
            const taxes = calcPsychTaxes(myAssessment, partner, dnaKey, posture);
            const grudge = calcGrudgeTax(myAssessment.ownerId, partner.ownerId, grudges, dnaKey);
            const givePlayers = input.givePlayers || [];
            const receivePlayers = input.receivePlayers || [];
            const givePicks = input.givePicks || [];
            const receivePicks = input.receivePicks || [];
            const giveFaab = input.giveFaab || 0;
            const receiveFaab = input.receiveFaab || 0;
            const give = sideBreakdown(givePlayers, givePicks, giveFaab);
            const receive = sideBreakdown(receivePlayers, receivePicks, receiveFaab);
            if (give.total <= 0 || receive.total <= 0) return null;
            const pieceCount = givePlayers.length + receivePlayers.length + givePicks.length + receivePicks.length;
            let likelihood = calcAcceptanceLikelihood(give.total, receive.total, dnaKey, taxes, myAssessment, partner, { totalPieces: pieceCount });
            likelihood = Math.round(Math.max(3, Math.min(95, likelihood + (grudge.total || 0))));
            const gradeRaw = window.App?.TradeEngine?.fairnessGrade
                ? window.App.TradeEngine.fairnessGrade(give.total, receive.total)
                : { grade: receive.total >= give.total ? 'B+' : 'C', label: receive.total >= give.total ? 'Win' : 'Overpay', color: receive.total >= give.total ? '#2ECC71' : '#E74C3C' };
            const userGain = receive.total - give.total;
            const fit = myAssessment ? calcComplementarity(myAssessment, partner) : 0;
            const valueScore = Math.max(0, Math.min(100, 50 + (userGain / Math.max(give.total, receive.total, 1)) * 120));
            const confidenceScore = Math.round(likelihood * 0.45 + fit * 0.25 + valueScore * 0.30);
            const confidence = confidenceScore >= 72 ? 'High' : confidenceScore >= 50 ? 'Medium' : 'Low';
            const windowImpact = dealWindowImpact(givePlayers, receivePlayers);
            const swing = explainRosterSwing(partner, givePlayers, receivePlayers);
            const caution = [];
            if (likelihood < 40) caution.push('Low acceptance odds');
            if (posture.key === 'LOCKED') caution.push('Locked roster');
            if (userGain < -Math.max(500, receive.total * 0.12)) caution.push('Meaningful overpay');
            if (!swing.includes('need') && !swing.includes('gap')) caution.push('Weak roster-fit signal');
            if (givePicks.length && receivePicks.length) caution.push('Pick timing matters');
            const whyAccept = input.whyAccept || (partner.needs?.length
                ? `They need ${partner.needs.slice(0, 2).map(n => n.pos).join('/')} and this gives them usable assets.`
                : `Their ${posture.label.toLowerCase()} posture keeps them open to a clean value offer.`);
            const whyYou = input.whyYou || (userGain >= 0
                ? `You gain ${Math.abs(Math.round(userGain)).toLocaleString()} DHQ while improving deal fit.`
                : `You pay ${Math.abs(Math.round(userGain)).toLocaleString()} DHQ for a roster or window upgrade.`);
            return {
                id: input.id || `deal_${Date.now()}_${Math.random().toString(16).slice(2)}`,
                mode: input.mode || dealMode,
                type: input.type || 'Deal',
                partnerOwnerId: partner.ownerId,
                partnerRosterId: partner.rosterId,
                partnerName: partner.ownerName,
                partnerTeam: partner.teamName,
                dnaKey,
                posture,
                givePlayers,
                receivePlayers,
                givePicks,
                receivePicks,
                giveFaab,
                receiveFaab,
                totals: { give, receive },
                userGain,
                likelihood,
                grade: gradeRaw.grade,
                gradeLabel: gradeRaw.label,
                gradeColor: gradeRaw.color || gradeRaw.col || 'var(--gold)',
                fit,
                confidence,
                confidenceScore,
                taxes,
                grudge,
                whyAccept,
                whyYou,
                swing,
                windowImpact,
                caution,
                rank: Math.round(likelihood * 1.2 + fit * 0.8 + valueScore + (confidenceScore / 2)),
                createdAt: input.createdAt || new Date().toISOString(),
                status: input.status || 'idea',
            };
        }

        function maybeBalanceFaab(partner, givePlayers, receivePlayers, givePicks = [], receivePicks = []) {
            const give = sideBreakdown(givePlayers, givePicks, 0).total;
            const receive = sideBreakdown(receivePlayers, receivePicks, 0).total;
            const gap = receive - give;
            const maxMyFaab = Math.max(0, Math.min(myAssessment?.faabRemaining || 0, 300));
            const maxTheirFaab = Math.max(0, Math.min(partner?.faabRemaining || 0, 300));
            if (gap > 100 && gap <= 600 && maxMyFaab > 0) return { giveFaab: Math.min(maxMyFaab, Math.ceil(gap / FAAB_RATE)), receiveFaab: 0 };
            if (gap < -100 && Math.abs(gap) <= 600 && maxTheirFaab > 0) return { giveFaab: 0, receiveFaab: Math.min(maxTheirFaab, Math.ceil(Math.abs(gap) / FAAB_RATE)) };
            return { giveFaab: 0, receiveFaab: 0 };
        }

        function addCandidate(candidates, partner, input) {
            const deal = buildDeal(partner, input);
            if (!deal) return;
            const sig = JSON.stringify([
                deal.partnerOwnerId,
                deal.givePlayers.map(p => p.pid).sort(),
                deal.receivePlayers.map(p => p.pid).sort(),
                deal.givePicks.map(p => p.id).sort(),
                deal.receivePicks.map(p => p.id).sort(),
                deal.giveFaab,
                deal.receiveFaab,
            ]);
            if (candidates.some(d => d._sig === sig)) return;
            candidates.push({ ...deal, _sig: sig });
        }

        function generateDealsForPartner(partner, mode, focusPid) {
            const myRosterObj = allRosters.find(r => r.roster_id === myRosterId);
            const theirRosterObj = allRosters.find(r => r.roster_id === partner?.rosterId);
            if (!partner || !myRosterObj || !theirRosterObj) return [];

            const alexSettings = window.WR?.AlexSettings?.get?.() || {};
            const aggression = (alexSettings.tradeAggression ?? 50) / 100;
            const lo = (base) => base - aggression * (base - 0.25);
            const hi = (base) => base + aggression * (1.8 - base);

            const tp = alexSettings.tradePriority || {};
            const priPos = Object.entries(tp.positions || {}).filter(([, v]) => v).map(([k]) => k);
            const priPickYears = Object.entries(tp.picks || {}).filter(([, v]) => v).map(([k]) => k);
            const priFaab = tp.faab !== false;

            const myNeedPos = (myAssessment?.needs || []).map(n => n.pos);
            const effectiveNeedPos = priPos.length ? [...new Set([...myNeedPos, ...priPos])] : myNeedPos;
            const mySurplusPos = myAssessment?.strengths || [];
            const theirNeedPos = (partner.needs || []).map(n => n.pos);
            const myPlayers = assetsForRoster(myRosterObj);
            const theirPlayers = assetsForRoster(theirRosterObj);
            const myChips = myPlayers.filter(p => !myNeedPos.includes(p.pos) || mySurplusPos.includes(p.pos));
            const allTheirPicks = pickAssetsForOwner(partner.ownerId);
            const allMyPicks = pickAssetsForOwner(myAssessment?.ownerId);
            const theirPicks = priPickYears.length ? allTheirPicks.filter(pk => priPickYears.some(yr => pk.label?.includes(yr))) : allTheirPicks;
            const myPicks = priPickYears.length ? allMyPicks.filter(pk => priPickYears.some(yr => pk.label?.includes(yr))) : allMyPicks;
            const candidates = [];

            const focusAsset = focusPid ? playerAsset(focusPid) : null;
            const targetPool = focusAsset && (theirRosterObj.players || []).includes(focusPid)
                ? [focusAsset]
                : theirPlayers.filter(p => mode === 'fillNeed' ? effectiveNeedPos.includes(p.pos) : priPos.length ? priPos.includes(p.pos) : true).slice(0, 8);
            const shopPool = focusAsset && (myRosterObj.players || []).includes(focusPid)
                ? [focusAsset]
                : myPlayers.filter(p => mode === 'sellSurplus' || mode === 'shop' ? (mySurplusPos.includes(p.pos) || theirNeedPos.includes(p.pos)) : true).slice(0, 10);

            if (mode === 'acquire' || mode === 'fillNeed') {
                targetPool.slice(0, 6).forEach(target => {
                    const one = myChips.find(p => p.value >= target.value * lo(0.75) && p.value <= target.value * hi(1.25));
                    if (one) {
                        const faab = maybeBalanceFaab(partner, [one], [target]);
                        addCandidate(candidates, partner, {
                            mode,
                            type: one.pos === target.pos ? 'Lateral upgrade' : 'Need fill',
                            givePlayers: [one],
                            receivePlayers: [target],
                            ...faab,
                            whyAccept: theirNeedPos.includes(one.pos) ? `They need ${one.pos}, and ${one.name} gives them immediate cover.` : `The value is close enough for a clean one-for-one conversation.`,
                            whyYou: myNeedPos.includes(target.pos) ? `You address ${target.pos} without opening a worse hole.` : `You consolidate into the preferred asset.`,
                        });
                    }
                    const lower = myChips.find(p => p.value < target.value && p.value >= target.value * lo(0.45));
                    const bridgePick = lower ? myPicks.find(pk => lower.value + pk.value >= target.value * lo(0.88) && lower.value + pk.value <= target.value * hi(1.35)) : null;
                    if (lower && bridgePick) {
                        const faab = maybeBalanceFaab(partner, [lower], [target], [bridgePick], []);
                        addCandidate(candidates, partner, {
                            mode,
                            type: 'Player + pick',
                            givePlayers: [lower],
                            givePicks: [bridgePick],
                            receivePlayers: [target],
                            ...faab,
                            whyAccept: `They get a roster piece plus draft capital instead of one asset.`,
                            whyYou: `You convert depth and a pick into a higher-fit ${target.pos}.`,
                        });
                    }
                    for (let i = 0; i < Math.min(myChips.length, 9); i++) {
                        for (let j = i + 1; j < Math.min(myChips.length, 9); j++) {
                            const pair = [myChips[i], myChips[j]];
                            const total = pair[0].value + pair[1].value;
                            if (total >= target.value * lo(0.88) && total <= target.value * hi(1.35)) {
                                const faab = maybeBalanceFaab(partner, pair, [target]);
                                addCandidate(candidates, partner, {
                                    mode,
                                    type: 'Consolidation',
                                    givePlayers: pair,
                                    receivePlayers: [target],
                                    ...faab,
                                    whyAccept: `They add two playable assets and patch more roster surface area.`,
                                    whyYou: `You consolidate roster slots into a stronger ${target.pos}.`,
                                });
                                j = 99;
                                i = 99;
                            }
                        }
                    }
                });
            }

            if (mode === 'shop' || mode === 'sellSurplus' || mode === 'picks') {
                shopPool.slice(0, 7).forEach(asset => {
                    const partnerFit = theirNeedPos.includes(asset.pos);
                    const playerBack = theirPlayers.find(p => p.value >= asset.value * lo(0.60) && p.value <= asset.value * hi(1.10) && (!myNeedPos.length || myNeedPos.includes(p.pos)));
                    const pickBack = theirPicks.find(pk => pk.value >= asset.value * lo(0.45) && pk.value <= asset.value * hi(1.2));
                    if (mode !== 'picks' && playerBack) {
                        const bridgePick = partnerFit ? theirPicks.find(pk => playerBack.value + pk.value >= asset.value * lo(0.82) && playerBack.value + pk.value <= asset.value * hi(1.25)) : null;
                        const receivePicks = bridgePick ? [bridgePick] : [];
                        const faab = maybeBalanceFaab(partner, [asset], [playerBack], [], receivePicks);
                        addCandidate(candidates, partner, {
                            mode,
                            type: bridgePick ? 'Rebalance package' : 'Value swap',
                            givePlayers: [asset],
                            receivePlayers: [playerBack],
                            receivePicks,
                            ...faab,
                            whyAccept: partnerFit ? `They need ${asset.pos}, and this uses your surplus against their gap.` : `They get the better single player while giving back a useful fit.`,
                            whyYou: myNeedPos.includes(playerBack.pos) ? `You use surplus to improve ${playerBack.pos}.` : `You reset value without losing deal optionality.`,
                        });
                    }
                    if (pickBack) {
                        const extraPick = theirPicks.find(pk => pk.id !== pickBack.id && pickBack.value + pk.value <= asset.value * hi(1.25) && pickBack.value + pk.value >= asset.value * lo(0.75));
                        const receivePicks = extraPick ? [pickBack, extraPick] : [pickBack];
                        const faab = maybeBalanceFaab(partner, [asset], [], [], receivePicks);
                        addCandidate(candidates, partner, {
                            mode,
                            type: 'Pick capital',
                            givePlayers: [asset],
                            receivePicks,
                            ...faab,
                            whyAccept: partnerFit ? `They turn pick capital into a player at a position of need.` : `They buy production without giving up a core player.`,
                            whyYou: `You separate pick capital from roster value and improve future flexibility.`,
                        });
                    }
                });
            }

            if (!candidates.length && theirPlayers.length && myPlayers.length) {
                const target = theirPlayers[0];
                const chip = myPlayers.find(p => p.value >= target.value * lo(0.7)) || myPlayers[0];
                const faab = maybeBalanceFaab(partner, [chip], [target]);
                addCandidate(candidates, partner, {
                    mode,
                    type: 'Baseline offer',
                    givePlayers: [chip],
                    receivePlayers: [target],
                    ...faab,
                    whyAccept: 'Baseline value match generated from available rosters.',
                    whyYou: 'Use this as a starting point for manual refinement.',
                });
            }

            if (!priFaab) candidates.forEach(c => { c.giveFaab = 0; c.receiveFaab = 0; });

            return candidates
                .sort((a, b) => b.rank - a.rank || b.likelihood - a.likelihood)
                .slice(0, 8)
                .map(({ _sig, ...deal }) => deal);
        }

        function persistSavedDeals(next) {
            setSavedDeals(next);
            if (WrStorage?.set) WrStorage.set(savedDealsKey, next);
            else localStorage.setItem(savedDealsKey, JSON.stringify(next));
        }

        function saveDeal(deal) {
            if (!deal) return;
            const clean = { ...deal, status: 'saved', createdAt: new Date().toISOString() };
            const next = [clean, ...savedDeals.filter(d => d.id !== clean.id)].slice(0, 24);
            persistSavedDeals(next);
            setDealHqNotice('Deal saved');
        }

        function removeSavedDeal(id) {
            persistSavedDeals(savedDeals.filter(d => d.id !== id));
        }

        function loadDealIntoAnalyzer(deal) {
            if (!deal) return;
            setTradeOwner({ A: myAssessment?.ownerId || null, B: deal.partnerOwnerId || null });
            setTradeIds({
                A: (deal.givePlayers || []).map(p => p.pid || p.id),
                B: (deal.receivePlayers || []).map(p => p.pid || p.id),
            });
            setTradePickIds({
                A: (deal.givePicks || []).map(p => p.id),
                B: (deal.receivePicks || []).map(p => p.id),
            });
            setTradeFaab({ A: deal.giveFaab || 0, B: deal.receiveFaab || 0 });
            setSearchText({ A: '', B: '' });
            setTcTab('analyzer');
            window._wrAnalyzerMode = 'build';
        }

        function clearAnalyzer() {
            setTradeIds({ A: [], B: [] });
            setTradePickIds({ A: [], B: [] });
            setTradeFaab({ A: 0, B: 0 });
            setSearchText({ A: '', B: '' });
        }

        // ── Sub-components ──
        function TcPosRow({ pos, assessment }) {
            const { actual, ideal, status, nflStarters = actual, startingReq = 1 } = assessment;
            const statusIcon = { surplus:'>', ok:'OK', thin:'~', deficit:'X' }[status];
            const statusColor = { surplus:'var(--gold)', ok:'var(--win-green)', thin:'var(--amber)', deficit:'var(--loss-red)' }[status];
            const dots = [];
            for (let i = 0; i < startingReq; i++) dots.push(<span key={`s${i}`} className={`tc-dot ${i < nflStarters ? 'tc-dot-filled' : 'tc-dot-empty'}`} />);
            for (let i = startingReq; i < ideal; i++) dots.push(<span key={`d${i}`} className={`tc-dot ${i < actual ? 'tc-dot-depth' : 'tc-dot-empty'}`} />);
            for (let i = ideal; i < actual; i++) dots.push(<span key={`x${i}`} className="tc-dot tc-dot-surplus" />);
            return (
                <div className="tc-pos-row">
                    <span className="tc-pos-label" style={{ color: posColor(pos) }}>{pos}</span>
                    <span className="tc-pos-dots">{dots}</span>
                    <span className="tc-pos-count" style={{ color: statusColor }}>{nflStarters}/{startingReq}</span>
                    <span className="tc-pos-status-icon" style={{ color: statusColor }}>{statusIcon}</span>
                </div>
            );
        }

        function TcPanicMeter({ level }) {
            return (
                <div className="tc-panic-row">
                    <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.6, width:'40px' }}>PANIC</span>
                    <span style={{ display:'flex', gap:'3px' }}>
                        {[1,2,3,4,5].map(i => <span key={i} className={`tc-panic-dot${i<=level?' tc-lit':''}`} />)}
                    </span>
                    <span style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.7 }}>{level}/5</span>
                </div>
            );
        }

        function TcTeamCard({ assessment, isMyTeam }) {
            const { teamName, ownerName, wins, losses, ties, pf, weeklyPts, healthScore, tier, tierColor, tierBg, posAssessment, panic, window: tradeWindow, needs, strengths, faabRemaining = 0, waiverBudget = 1000 } = assessment;
            const dnaKey = ownerDna[assessment.ownerId] || 'NONE';
            const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
            const pct = Math.round((weeklyPts / WEEKLY_TARGET) * 100);
            const scoreBarColor = healthScore >= 85 ? '#D4AF37' : healthScore >= 70 ? '#2ECC71' : healthScore >= 55 ? '#F0A500' : '#E74C3C';
            const projClass = weeklyPts >= WEEKLY_TARGET ? 'proj-above' : weeklyPts >= WEEKLY_TARGET * 0.9 ? 'proj-close' : 'proj-below';
            const projColor = weeklyPts >= WEEKLY_TARGET ? 'var(--win-green)' : weeklyPts >= WEEKLY_TARGET * 0.9 ? '#F0A500' : 'var(--loss-red)';

            return (
                <div className={`tc-team-card${isMyTeam?' tc-my-team':''}`}>
                    <div className="tc-card-header">
                        <div style={{ overflow:'hidden' }}>
                            <div style={{ fontSize:'0.92rem', fontWeight:700 }}>{ownerName}</div>
                            <div style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.7 }}>{teamName}</div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:'0.2rem', flexShrink:0 }}>
                            {isMyTeam && <span className="tc-my-team-badge">MY TEAM</span>}
                            <span className="tc-tier-badge" style={{ color:tierColor, borderColor:tierColor, background:tierBg }}>{tier}</span>
                        </div>
                    </div>
                    <div className="tc-card-body">
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'1.5rem', fontWeight:600, color:scoreBarColor, lineHeight:1 }}>{healthScore}</span>
                            <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end' }}>
                                <span style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.8 }}>{wins}-{losses}{ties>0?`-${ties}`:''}</span>
                                <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.65 }}>{pf > 0 ? `${pf.toFixed(0)} PF` : ''}</span>
                            </div>
                        </div>
                        <div className="tc-score-row">
                            <span className="tc-score-label">WEEKLY</span>
                            <div className="tc-score-bar-wrap"><div className="tc-score-bar-fill" style={{ width:`${Math.min(100,pct)}%`, background:scoreBarColor }} /></div>
                            <span className="tc-score-val" style={{ color:projColor }}>{weeklyPts > 0 ? weeklyPts : '--'}</span>
                        </div>
                        <div className="tc-divider" />
                        <div className="tc-pos-grid">
                            {Object.entries(posAssessment).sort((a,b)=>(TC_POS_ORDER[a[0]]??9)-(TC_POS_ORDER[b[0]]??9)).map(([pos, data]) => <TcPosRow key={pos} pos={pos} assessment={data} />)}
                        </div>
                        <div className="tc-divider" />
                        <TcPanicMeter level={panic} />
                        <div className="tc-chip-row">
                            <span className="tc-chip tc-chip-window">{tradeWindow}</span>
                            {dnaKey !== 'NONE' && <span className="tc-chip tc-chip-dna">{dna.label}</span>}
                        </div>
                        {strengths.length > 0 && <div className="tc-chip-row">{strengths.map(s => <span key={s} className="tc-chip tc-chip-strength">+{s}</span>)}</div>}
                        {needs.length > 0 && <div className="tc-chip-row">{needs.map(n => <span key={n.pos} className={`tc-chip ${n.urgency==='deficit'?'tc-chip-need':'tc-chip-thin'}`}>{n.pos}</span>)}</div>}
                        {waiverBudget > 0 && <div className="tc-chip-row"><span className="tc-chip tc-chip-strength">${faabRemaining.toLocaleString()} FAAB</span></div>}
                    </div>
                </div>
            );
        }

        // ── renderAudit ──
        function renderAudit() {
            if (!assessments.length) return <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem' }}>No rosters found. Select a league from the home screen.</div>;
            return (
                <div>
                    <div className="tc-summary-bar">
                        <div className="tc-summary-stat"><span className="tc-summary-val">{assessments.length}</span><span className="tc-summary-lbl">Teams</span></div>
                        <div className="tc-summary-stat"><span className="tc-summary-val">{avgHealth}</span><span className="tc-summary-lbl">Avg Health</span></div>
                        <div className="tc-summary-stat"><span className="tc-summary-val">{eliteTeamCount}</span><span className="tc-summary-lbl">Elite Teams</span></div>
                        <div className="tc-summary-stat"><span className="tc-summary-val" style={{ color:'var(--loss-red)' }}>{highPanic}</span><span className="tc-summary-lbl">High Panic</span></div>
                        <div className="tc-summary-stat"><span className="tc-summary-val">{WEEKLY_TARGET}</span><span className="tc-summary-lbl">Wk Target</span></div>
                    </div>

                    {/* MY TEAM Featured */}
                    {myAssessment && (
                        <div>
                            <div className="tc-section-hdr" style={{ marginBottom:'0.6rem' }}>MY TEAM <span className="tc-my-team-badge" style={{ marginLeft:'0.5rem', fontSize:'0.72rem', verticalAlign:'middle' }}>{myAssessment.ownerName}</span></div>
                            <div className="tc-featured-wrap">
                                <div>
                                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                                        <div>
                                            <div style={{ fontWeight:700, fontSize:'1rem' }}>{myAssessment.teamName}</div>
                                            <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6 }}>{myAssessment.wins}-{myAssessment.losses}{myAssessment.ties>0?`-${myAssessment.ties}`:''} {myAssessment.pf > 0 ? `${myAssessment.pf.toFixed(0)} PF` : ''}</div>
                                        </div>
                                        <div style={{ textAlign:'center' }}>
                                            {typeof MiniDonut !== 'undefined' ? React.createElement(MiniDonut, { value: myAssessment.healthScore, size: 56, label: 'HEALTH' }) : <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'2.2rem', fontWeight:600, lineHeight:1, color: myAssessment.healthScore>=85?'#D4AF37':myAssessment.healthScore>=70?'#2ECC71':myAssessment.healthScore>=55?'#F0A500':'#E74C3C' }}>{myAssessment.healthScore}</div>}
                                        </div>
                                    </div>
                                    <div className="tc-pos-grid">
                                        {Object.entries(myAssessment.posAssessment).sort((a,b)=>(TC_POS_ORDER[a[0]]??9)-(TC_POS_ORDER[b[0]]??9)).map(([pos, data]) => <TcPosRow key={pos} pos={pos} assessment={data} />)}
                                    </div>
                                    <div className="tc-divider" style={{ margin:'0.5rem 0' }} />
                                    <TcPanicMeter level={myAssessment.panic} />
                                </div>
                                <div style={{ display:'flex', flexDirection:'column', gap:'0.6rem' }}>
                                    {/* Radar Chart — Position Balance */}
                                    {typeof RadarChart !== 'undefined' && (() => {
                                        const pa = myAssessment.posAssessment || {};
                                        const radarVals = {};
                                        Object.entries(pa).forEach(([pos, data]) => {
                                            const ideal = data.ideal || 1;
                                            const actual = data.nflStarters || data.actual || 0;
                                            radarVals[pos] = Math.min(100, Math.round((actual / ideal) * 100));
                                        });
                                        return Object.keys(radarVals).length >= 3 ? React.createElement('div', { style:{display:'flex',justifyContent:'center',marginBottom:'8px'} },
                                            React.createElement(RadarChart, { values: radarVals, size: 280 })
                                        ) : null;
                                    })()}
                                    <GMMessage compact>
                                        {myAssessment.tier === 'ELITE' ? 'Championship-caliber operation. Protect core assets and make surgical upgrades.' : myAssessment.tier === 'CONTENDER' ? 'Legitimate playoff threat. Fill the gaps to push into the elite tier.' : myAssessment.tier === 'CROSSROADS' ? 'At a crossroads \u2014 address the gaps or commit to a rebuild.' : 'Building for the future. Accumulate young assets and draft picks.'}
                                        {myAssessment.strengths.length > 0 ? ` Depth surplus at ${myAssessment.strengths.join(', ')} gives you trading chips.` : ''}
                                        {myAssessment.needs.length > 0 ? ` ${myAssessment.needs.filter(n=>n.urgency==='deficit').length > 0 ? `Critical shortage at ${myAssessment.needs.filter(n=>n.urgency==='deficit').map(n=>n.pos).join(', ')}.` : ''} ${myAssessment.needs.filter(n=>n.urgency==='thin').length > 0 ? `Running thin at ${myAssessment.needs.filter(n=>n.urgency==='thin').map(n=>n.pos).join(', ')}.` : ''}` : ''}
                                    </GMMessage>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Expanded detail for selected team */}
                    {selectedAuditTeam && (() => {
                        const detail = assessments.find(a => a.rosterId === selectedAuditTeam);
                        if (!detail) return null;
                        return (
                            <div className="tc-team-detail-panel">
                                <div style={{ gridColumn:'1/-1', display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                                    <div style={{ fontWeight:700, fontSize:'0.9rem' }}>{detail.ownerName} <span style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6, marginLeft:'0.5rem' }}>{detail.teamName}</span></div>
                                    <button onClick={() => setSelectedAuditTeam(null)} style={{ background:'transparent', border:'1.5px solid var(--gold)', color:'var(--gold)', fontFamily: 'var(--font-body)', fontSize:'0.7rem', fontWeight:600, padding:'0.32rem 0.65rem', borderRadius:'4px', cursor:'pointer' }}>X Close</button>
                                </div>
                                <div>
                                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.5rem' }}>
                                        <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6 }}>{detail.wins}-{detail.losses} {detail.pf>0?`${detail.pf.toFixed(0)} PF`:''}</div>
                                        <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'1.8rem', fontWeight:600, lineHeight:1, color:detail.tierColor }}>{detail.healthScore}</div>
                                    </div>
                                    <div className="tc-pos-grid">
                                        {Object.entries(detail.posAssessment).sort((a,b)=>(TC_POS_ORDER[a[0]]??9)-(TC_POS_ORDER[b[0]]??9)).map(([pos,data]) => <TcPosRow key={pos} pos={pos} assessment={data} />)}
                                    </div>
                                    <div className="tc-divider" style={{ margin:'0.5rem 0' }} />
                                    <TcPanicMeter level={detail.panic} />
                                </div>
                                <div style={{ display:'flex', flexDirection:'column', gap:'0.5rem' }}>
                                    {detail.strengths.length > 0 && <div className="tc-commentary-card"><div className="tc-commentary-card-title">Strengths</div><div className="tc-commentary-card-text">Surplus at {detail.strengths.join(', ')}.</div></div>}
                                    {detail.needs.length > 0 && <div className="tc-commentary-card"><div className="tc-commentary-card-title">Needs</div><div className="tc-commentary-card-text">{detail.needs.map(n=>`${n.pos} (${n.urgency})`).join(', ')}.</div></div>}
                                </div>
                            </div>
                        );
                    })()}

                    {/* All Teams Grid */}
                    <div className="tc-section-hdr" style={{ marginBottom:'0.6rem' }}>ALL TEAMS</div>
                    <div style={{ display:'flex', gap:'1rem', fontSize:'0.74rem', marginBottom:'0.6rem', color:'var(--silver)', opacity:0.7, flexWrap:'wrap' }}>
                        <span><span style={{ color:'#2ECC71' }}>●</span> Surplus</span>
                        <span><span style={{ color:'var(--silver)' }}>○</span> OK</span>
                        <span><span style={{ color:'#F39C12' }}>↑</span> Thin</span>
                        <span><span style={{ color:'#E74C3C' }}>✗</span> Deficit</span>
                    </div>
                    <div className="tc-filter-bar">
                        <span style={{ fontSize:'0.78rem', color:'var(--silver)', opacity:0.6 }}>SORT</span>
                        <select className="tc-filter-select" value={sortMode} onChange={e => setSortMode(e.target.value)}>
                            <option value="health">Health Score</option>
                            <option value="panic">Panic Level</option>
                            <option value="record">W-L Record</option>
                        </select>
                        <span style={{ fontSize:'0.78rem', color:'var(--silver)', opacity:0.6, marginLeft:'0.5rem' }}>TIER</span>
                        <select className="tc-filter-select" value={tierFilter} onChange={e => setTierFilter(e.target.value)}>
                            <option value="ALL">All Tiers</option>
                            <option value="ELITE">Elite</option>
                            <option value="CONTENDER">Contender</option>
                            <option value="CROSSROADS">Crossroads</option>
                            <option value="REBUILDING">Rebuilding</option>
                        </select>
                    </div>
                    <div className="tc-team-grid">
                        {sortedAssessments.map(a => {
                            const isMe = a.rosterId === myRosterId;
                            const isSelected = selectedAuditTeam === a.rosterId;
                            return (
                                <div key={a.rosterId} style={{ cursor: isMe ? 'default' : 'pointer' }} onClick={() => { if (!isMe) setSelectedAuditTeam(isSelected ? null : a.rosterId); }}>
                                    <TcTeamCard assessment={a} isMyTeam={isMe} />
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }

        // ── renderOwnerDna ──
        function renderOwnerDna() {
            if (!assessments.length) return <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem' }}>No roster data.</div>;
            // Phase 5: Two-pane layout — left list sorted by Power Ranking, right panel
            // holds the full detail card for the selected owner. The original grid-of-cards
            // is kept (below) for a fallback/legacy experience, but the split takes priority.
            const selectedRid = expandedDnaOwner != null ? expandedDnaOwner : (myRosterId || sortedAssessments[0]?.rosterId);
            const selectedAssessment = sortedAssessments.find(a => a.rosterId === selectedRid) || sortedAssessments[0];
            return (
                <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    {/* Left pane: PR-sorted owner list */}
                    <div style={{ flex: '0 0 240px', minWidth: '200px', maxHeight: '78vh', overflowY: 'auto', background: 'var(--off-black)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '10px', padding: '6px' }}>
                        <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.6, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '6px 8px' }}>Owners · sorted by power</div>
                        {sortedAssessments.map((a, idx) => {
                            const rid = a.rosterId;
                            const dnaKey = ownerDna[a.ownerId] || 'NONE';
                            const isMe = a.rosterId === myRosterId;
                            const isSel = rid === selectedRid;
                            const avatarSrc = avatarUrl(a.avatar);
                            const aiDna = typeof computeWeightedDNA === 'function' ? computeWeightedDNA(rid) : null;
                            const shownDnaKey = (dnaKey && dnaKey !== 'NONE') ? dnaKey : (aiDna?.key || 'NONE');
                            const shownDna = DNA_TYPES[shownDnaKey] || DNA_TYPES.NONE;
                            return (
                                <div key={rid} onClick={() => setExpandedDnaOwner(rid)} style={{
                                    display: 'flex', alignItems: 'center', gap: '8px',
                                    padding: '7px 8px', borderRadius: '6px', cursor: 'pointer',
                                    background: isSel ? 'rgba(212,175,55,0.12)' : 'transparent',
                                    border: '1px solid ' + (isSel ? 'rgba(212,175,55,0.35)' : 'transparent'),
                                    marginBottom: '2px', transition: 'background 0.15s'
                                }}>
                                    <span style={{ fontSize: '0.64rem', color: idx < 3 ? 'var(--gold)' : 'var(--silver)', width: '18px', textAlign: 'center', fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>{idx + 1}</span>
                                    <div style={{ width: 24, height: 24, borderRadius: '50%', background: 'var(--charcoal)', overflow: 'hidden', flexShrink: 0, border: '1px solid rgba(212,175,55,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {avatarSrc ? <img src={avatarSrc} alt={a.ownerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} /> : <span style={{ fontSize: '0.68rem', color: 'var(--gold)', fontWeight: 700 }}>{a.ownerName.charAt(0).toUpperCase()}</span>}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: '0.78rem', fontWeight: isSel ? 700 : 500, color: isSel ? 'var(--gold)' : 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                            {a.ownerName}{isMe && <span style={{ fontSize: '0.58rem', color: 'var(--gold)', fontWeight: 700, marginLeft: '4px' }}>ME</span>}
                                        </div>
                                        <div style={{ fontSize: '0.62rem', color: shownDna.color || 'var(--silver)', opacity: 0.85 }}>{shownDna.label || '—'}</div>
                                    </div>
                                    <span style={{ fontSize: '0.74rem', fontWeight: 700, color: a.tierColor, fontFamily: 'JetBrains Mono, monospace' }}>{a.healthScore}</span>
                                </div>
                            );
                        })}
                    </div>

                    {/* Right pane: selected owner detail */}
                    <div style={{ flex: '1 1 480px', minWidth: '320px' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '10px', lineHeight: 1.5 }}>
                            Profile each owner's behavioral DNA. {React.createElement(Tip, null, 'Owner DNA classifies each league member\'s trading personality. Multiplier = expected value adjustment.')}
                            {' '}
                            {React.createElement(function DnaGuideInline() {
                                const [guideOpen, setGuideOpen] = React.useState(false);
                                return React.createElement(React.Fragment, null,
                                    React.createElement('button', { onClick:()=>setGuideOpen(!guideOpen), style:{fontSize:'0.7rem',color:'var(--gold)',background:'rgba(212,175,55,0.08)',border:'1px solid rgba(212,175,55,0.25)',borderRadius:'4px',padding:'2px 8px',cursor:'pointer',fontFamily: 'var(--font-body)',textTransform:'uppercase',letterSpacing:'0.05em',marginLeft:'6px'} }, guideOpen ? 'Hide DNA Guide' : 'Show DNA Guide'),
                                    guideOpen ? React.createElement('div', { style:{marginTop:'8px', display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(220px, 1fr))', gap:'8px'} },
                                        ...Object.entries(DNA_TYPES).filter(function(e){return e[0]!=='NONE'}).map(function(entry) {
                                            var key=entry[0], d=entry[1];
                                            return React.createElement('div', { key:key, style:{background:d.color+'08',border:'1px solid '+d.color+'44',borderLeft:'3px solid '+d.color,borderRadius:'6px',padding:'8px 10px'} },
                                                React.createElement('div', { style:{display:'flex', alignItems:'center', gap:'6px', marginBottom:'4px'} },
                                                    React.createElement('span', { style:{fontFamily:'Rajdhani, sans-serif',fontSize:'0.9rem',color:d.color,fontWeight:700,letterSpacing:'0.03em'} }, d.label),
                                                    React.createElement('span', { style:{fontSize:'0.62rem',fontFamily:'JetBrains Mono, monospace',color:d.color,background:d.color+'18',padding:'1px 5px',borderRadius:'3px'} }, '×'+d.multiplier)
                                                ),
                                                React.createElement('div', { style:{fontSize:'0.7rem',color:'var(--silver)',lineHeight:1.45,marginBottom:'4px'} }, d.desc),
                                                d.strategy ? React.createElement('div', { style:{fontSize:'0.66rem',color:d.color,opacity:0.85,fontStyle:'italic',paddingTop:'4px',borderTop:'1px dashed '+d.color+'33',marginTop:'4px'} }, '→ ' + d.strategy) : null,
                                                d.taxes && d.taxes.length ? React.createElement('div', { style:{display:'flex',flexWrap:'wrap',gap:'3px',marginTop:'5px'} },
                                                    ...d.taxes.slice(0, 3).map(function(t,i){ return React.createElement('span', { key:i, style:{fontSize:'0.58rem',padding:'1px 4px',borderRadius:'3px',border:'1px solid '+d.color+'40',color:d.color,background:d.color+'08'} }, t); })
                                                ) : null
                                            );
                                        })
                                    ) : null
                                );
                            })}
                        </div>
                        {selectedAssessment ? renderOwnerDetailCard(selectedAssessment) : <div style={{ padding: '40px', textAlign: 'center', color: 'var(--silver)', opacity: 0.6, fontSize: '0.82rem' }}>Select an owner on the left to view their full profile.</div>}
                    </div>
                </div>
            );
        }

        // ── Big detail card rendered in the right pane (Phase 5 redesign) ──
        function renderOwnerDetailCard(a) {
            const rid = a.rosterId;
            const dnaKey = ownerDna[a.ownerId] || 'NONE';
            const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
            const isMyTeam = a.rosterId === myRosterId;
            const avatarSrc = avatarUrl(a.avatar);
            const draftDna = ownerDraftDna[a.ownerId] || null;
            const posture = calcOwnerPosture(a, dnaKey);
            const ownerTrades = (window.App?.LI?.tradeHistory || []).filter(t => t.roster_ids?.includes(rid));
            const tradeCount = ownerTrades.length;
            const aiDna = typeof computeWeightedDNA === 'function' ? computeWeightedDNA(rid) : null;
            const currentDna = ownerDna[a.ownerId] || aiDna?.key || 'NONE';
            const isOverridden = ownerDna[a.ownerId] && aiDna && ownerDna[a.ownerId] !== aiDna.key;
            const derivedDnaKey = deriveDNAFromHistory(a.ownerId, grudges);
            const derivedDna = derivedDnaKey ? DNA_TYPES[derivedDnaKey] : null;
            const profile = window.App?.LI?.ownerProfiles?.[rid] || {};
            const ownerRoster = allRosters.find(r => String(r.roster_id) === String(rid));
            const ownerPickAssets = pickAssetsForOwner(a.ownerId);
            const pickCapital = ownerPickAssets.reduce((s, p) => s + (p.value || 0), 0);
            const earlyPickCount = ownerPickAssets.filter(p => p.round <= 2).length;
            const rosterAssets = assetsForRoster(ownerRoster).slice(0, 8);
            const posRows = Object.entries(a.posAssessment || {}).sort((pa, pb) => (TC_POS_ORDER[pa[0]] ?? 9) - (TC_POS_ORDER[pb[0]] ?? 9)).map(([pos, data]) => {
                const leaders = (data.sortedIds || []).slice(0, 3).map(pid => {
                    const p = playersData[pid] || {};
                    return {
                        pid,
                        name: p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || pid,
                        team: p.team || 'FA',
                        value: getPlayerValue(pid).value || 0,
                    };
                });
                const needGap = Math.max(0, (data.startingReq || 1) - (data.nflStarters || 0));
                const surplus = Math.max(0, (data.actual || 0) - (data.ideal || 0));
                const qualityPct = Math.round(Math.min(1, (data.nflStarters || 0) / Math.max(1, data.startingReq || 1)) * 100);
                const statusLabel = data.status === 'deficit' ? `Need ${needGap || 1} starter${needGap === 1 ? '' : 's'}`
                    : data.status === 'thin' ? 'Thin depth'
                    : data.status === 'surplus' ? `Surplus ${surplus || '+'}`
                    : 'Stable';
                return { pos, data, leaders, needGap, surplus, qualityPct, statusLabel };
            });
            const starterNeed = posRows.find(r => r.data.status === 'deficit') || posRows.find(r => r.data.status === 'thin') || null;
            const cleanSurplus = posRows.find(r => r.data.status === 'surplus') || null;
            const starterCoverage = (() => {
                const req = posRows.reduce((s, r) => s + Math.max(1, r.data.startingReq || 1), 0);
                const filled = posRows.reduce((s, r) => s + Math.min(r.data.nflStarters || 0, Math.max(1, r.data.startingReq || 1)), 0);
                return req ? Math.round((filled / req) * 100) : 0;
            })();
            const favoritePartner = Object.entries(profile.partners || {}).sort((a, b) => b[1] - a[1])[0] || null;
            const favoritePartnerName = favoritePartner ? ownerNameForRosterId(favoritePartner[0]) || `Team ${favoritePartner[0]}` : 'No pattern';
            const timing = profile.weekTiming || {};
            const timingRead = (timing.late || 0) >= Math.max(timing.early || 0, timing.mid || 0) ? 'Late-season mover'
                : (timing.early || 0) >= Math.max(timing.mid || 0, timing.late || 0) ? 'Early-season mover'
                : 'Mid-season mover';
            const tradeBias = (profile.picksAcquired || 0) > (profile.picksSold || 0) + 2 ? 'Collects picks'
                : (profile.picksSold || 0) > (profile.picksAcquired || 0) + 2 ? 'Spends picks'
                : 'Balanced assets';
            const marketRead = starterNeed
                ? `${a.ownerName} is most exposed at ${starterNeed.pos}; offers that solve that room should rate better.`
                : cleanSurplus
                    ? `${a.ownerName} has tradeable depth at ${cleanSurplus.pos}; use that room as the package entry point.`
                    : `${a.ownerName} is balanced enough that value and psychology matter more than a single roster hole.`;
            const sortedOwnerTrades = ownerTrades.slice().sort((ta, tb) => {
                const aSeason = parseInt(ta.season) || 0;
                const bSeason = parseInt(tb.season) || 0;
                if (bSeason !== aSeason) return bSeason - aSeason;
                return (tb.week || 0) - (ta.week || 0);
            });
            const shortPlayerName = pid => {
                const p = playersData[pid] || {};
                return p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || String(pid);
            };
            const summarizeTradeSide = side => {
                const players = (side?.players || []).slice(0, 2).map(shortPlayerName);
                const picks = (side?.picks || []).slice(0, 2).map(pk => `${pk.season || pk.year || ''} R${pk.round || '?'}`.trim());
                const totalAssets = (side?.players || []).length + (side?.picks || []).length;
                const parts = [...players, ...picks].filter(Boolean);
                if (!parts.length) return 'No assets listed';
                const extra = Math.max(0, totalAssets - parts.length);
                return parts.join(', ') + (extra ? ` +${extra}` : '');
            };
            const renderTradeSpot = (label, trade, tone) => {
                if (!trade) return null;
                const otherRid = (trade.roster_ids || []).find(r => String(r) !== String(rid));
                const mySide = trade.sides?.[rid] || trade.sides?.[String(rid)] || {};
                const theirSide = otherRid != null ? (trade.sides?.[otherRid] || trade.sides?.[String(otherRid)] || {}) : {};
                const net = (mySide.totalValue || 0) - (theirSide.totalValue || 0);
                const color = tone === 'win' ? '#2ECC71' : '#E74C3C';
                return <div className="tc-owner-trade-spot">
                    <span>{label}</span>
                    <strong style={{ color }}>{net >= 0 ? '+' : ''}{Math.round(net).toLocaleString()}</strong>
                    <em>{trade.season} W{trade.week || '-'} vs {ownerNameForRosterId(otherRid) || 'Unknown'}</em>
                </div>;
            };
            return (
                <div style={{ background: 'var(--off-black)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '12px', padding: '18px 20px' }}>
                    {/* Hero strip */}
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'var(--charcoal)', overflow: 'hidden', flexShrink: 0, border: '2px solid rgba(212,175,55,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {avatarSrc ? <img src={avatarSrc} alt={a.ownerName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={e => e.target.style.display='none'} /> : <span style={{ fontSize: '1.1rem', color: 'var(--gold)', fontWeight: 700 }}>{a.ownerName.charAt(0).toUpperCase()}</span>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: 'var(--white)', letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {a.ownerName}{isMyTeam && <span className="tc-my-team-badge">ME</span>}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--silver)', opacity: 0.75 }}>{a.teamName}</div>
                            <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                                <span className="tc-tier-badge" style={{ color: a.tierColor, borderColor: a.tierColor, background: a.tierBg }}>{a.tier}</span>
                                <span className="tc-posture-badge" style={{ color: posture.color, borderColor: posture.color, background: posture.color + '18' }}>{posture.label}</span>
                                {tradeCount > 0 && <span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.6 }}>{tradeCount} trades on file</span>}
                            </div>
                        </div>
                        {typeof MiniDonut !== 'undefined' && React.createElement(MiniDonut, { value: a.healthScore, size: 64, label: 'HEALTH' })}
                    </div>

                    {/* KPI row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
                        {[
                            { label: 'RECORD', value: a.wins + '-' + a.losses + (a.ties > 0 ? '-' + a.ties : ''), color: 'var(--white)' },
                            { label: 'PANIC', value: a.panic + '/5', color: a.panic >= 3 ? 'var(--loss-red)' : 'var(--silver)' },
                            { label: 'WINDOW', value: a.window || '—', color: a.tierColor },
                            { label: 'PF', value: a.pf > 0 ? Math.round(a.pf) : '—', color: 'var(--silver)' },
                        ].map((k, i) => <div key={i} style={{ padding: '8px', background: 'var(--black)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', textAlign: 'center' }}>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', fontWeight: 700, color: k.color }}>{k.value}</div>
                            <div style={{ fontSize: '0.58rem', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{k.label}</div>
                        </div>)}
                    </div>

                    {/* Owner DNA block */}
                    <div style={{ marginBottom: '14px' }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px' }}>
                            <span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Owner DNA</span>
                            {derivedDna && <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '1px 6px', borderRadius: '3px', border: `1px solid ${derivedDna.color}55`, color: derivedDna.color, background: `${derivedDna.color}10` }}>AUTO: {derivedDna.label}</span>}
                        </div>
                        {aiDna ? (
                            <div style={{ fontSize: '0.76rem', marginBottom: '6px' }}>
                                <span style={{ color: 'var(--gold)', fontWeight: 600 }}>Scout suggests: </span>
                                <span style={{ color: DNA_TYPES[aiDna.key]?.color || 'var(--silver)', fontWeight: 700 }}>{DNA_TYPES[aiDna.key]?.label || aiDna.key}</span>
                                <span style={{ color: 'var(--silver)', marginLeft: '4px', opacity: 0.65 }}>({aiDna.confidence}% confidence)</span>
                                <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.7, marginTop: '2px' }}>{aiDna.reasoning}</div>
                            </div>
                        ) : (
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.55, marginBottom: '6px', fontStyle: 'italic' }}>
                                {tradeCount > 0 ? 'Insufficient signal — tag manually' : 'Not enough data — tag manually'}
                            </div>
                        )}
                        <select className="tc-dna-select" value={currentDna} onChange={e => updateDna(a.ownerId, e.target.value)}>
                            {aiDna && <option value={aiDna.key}>AI: {DNA_TYPES[aiDna.key]?.label} (recommended)</option>}
                            {Object.entries(DNA_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                        </select>
                        {isOverridden && <div style={{ fontSize: '0.68rem', color: '#F0A500', marginTop: '4px' }}>Overridden from AI suggestion</div>}
                        {dnaKey && dnaKey !== 'NONE' && dna.desc && (
                            <div style={{ marginTop: '8px', padding: '8px 10px', background: dna.color + '08', borderLeft: '3px solid ' + dna.color, borderRadius: '0 6px 6px 0' }}>
                                <div style={{ fontSize: '0.74rem', color: 'var(--silver)', lineHeight: 1.5 }}>{dna.desc}</div>
                                {dna.strategy && <div style={{ marginTop: '4px', fontSize: '0.72rem', color: dna.color, opacity: 0.9, fontStyle: 'italic' }}>→ {dna.strategy}</div>}
                            </div>
                        )}
                    </div>

                    {/* Draft DNA (if present) */}
                    {draftDna && (
                        <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '6px', padding: '8px 10px', marginBottom: '14px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
                                <span style={{ fontSize: '0.66rem', color: 'var(--silver)', opacity: 0.65, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Draft DNA</span>
                                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#a5b4fc' }}>{draftDna.label}</span>
                                <span style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.55, marginLeft: 'auto' }}>{draftDna.seasons} · {draftDna.picksAnalyzed} picks</span>
                            </div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.75, fontStyle: 'italic' }}>{draftDna.tendency}</div>
                        </div>
                    )}

                    <div className="tc-owner-market-read">
                        <span>Market Read</span>
                        <strong>{marketRead}</strong>
                    </div>

                    <div className="tc-owner-signal-grid">
                        <div><span>Starter Coverage</span><strong>{starterCoverage}%</strong><em>{starterNeed ? `Watch ${starterNeed.pos}` : 'No urgent room'}</em></div>
                        <div><span>Pick Capital</span><strong>{Math.round(pickCapital).toLocaleString()}</strong><em>{ownerPickAssets.length} picks · {earlyPickCount} early</em></div>
                        <div><span>Trade Bias</span><strong>{tradeBias}</strong><em>{profile.picksAcquired || 0} picks in / {profile.picksSold || 0} out</em></div>
                        <div><span>Timing</span><strong>{timingRead}</strong><em>{favoritePartnerName}{favoritePartner ? ` (${favoritePartner[1]})` : ''}</em></div>
                    </div>

                    <div className="tc-owner-profile-grid">
                        <section className="tc-owner-panel">
                            <div className="tc-owner-panel-head">
                                <span>Roster Audit</span>
                                <em>{a.strengths?.length ? `Surplus ${a.strengths.join(', ')}` : 'No clean surplus'}{a.needs?.length ? ` · Needs ${a.needs.slice(0, 4).map(n => n.pos).join(', ')}` : ''}</em>
                            </div>
                            <div className="tc-owner-pos-table">
                                {posRows.map(row => {
                                    const statusColor = { surplus:'var(--gold)', ok:'var(--win-green)', thin:'#F0A500', deficit:'#E74C3C' }[row.data.status] || 'var(--silver)';
                                    return <div key={row.pos} className="tc-owner-pos-row">
                                        <div className="tc-owner-pos-main">
                                            <strong style={{ color: posColor(row.pos) }}>{row.pos}</strong>
                                            <span style={{ color: statusColor }}>{row.statusLabel}</span>
                                        </div>
                                        <div className="tc-owner-pos-meter">
                                            <i style={{ width: `${row.qualityPct}%`, background: statusColor }} />
                                        </div>
                                        <div className="tc-owner-pos-count">{row.data.nflStarters}/{row.data.startingReq} starters · {row.data.actual}/{row.data.ideal} total</div>
                                        <div className="tc-owner-pos-leaders">
                                            {row.leaders.length ? row.leaders.map(p => <span key={p.pid}>{p.name} <em>{p.value ? p.value.toLocaleString() : '--'}</em></span>) : <span>No assets</span>}
                                        </div>
                                    </div>;
                                })}
                            </div>
                        </section>

                        <section className="tc-owner-panel">
                            <div className="tc-owner-panel-head">
                                <span>Moveable Assets</span>
                                <em>{a.faabRemaining || 0} FAAB · {ownerPickAssets.length} picks</em>
                            </div>
                            <div className="tc-owner-asset-cloud">
                                {rosterAssets.map(asset => <span key={asset.pid} style={{ borderColor: posColor(asset.pos) + '66' }}>{asset.name}<em>{asset.pos} · {asset.value.toLocaleString()}</em></span>)}
                                {ownerPickAssets.slice(0, 5).map(pick => <span key={pick.id} style={{ borderColor: (PICK_COLORS[pick.round] || 'var(--gold)') + '66' }}>{pick.label}<em>{pick.value.toLocaleString()}</em></span>)}
                            </div>
                        </section>
                    </div>

                    <section className="tc-owner-panel tc-owner-history-panel">
                        <div className="tc-owner-panel-head">
                            <span>Trade History</span>
                            <em>{profile.tradesWon || 0} won · {profile.tradesLost || 0} lost · {profile.tradesFair || 0} fair · Avg {(profile.avgValueDiff || 0) >= 0 ? '+' : ''}{Math.round(profile.avgValueDiff || 0).toLocaleString()} DHQ</em>
                        </div>
                        <div className="tc-owner-trade-spots">
                            {renderTradeSpot('Best win', profile.biggestWin, 'win')}
                            {renderTradeSpot('Biggest loss', profile.biggestLoss, 'loss')}
                        </div>
                        {sortedOwnerTrades.length > 0 ? (
                            <div className="tc-owner-trade-list">
                                {sortedOwnerTrades.slice(0, 8).map((t, ti) => {
                                    const otherRid = (t.roster_ids || []).find(r => String(r) !== String(rid));
                                    const otherUser = ownerNameForRosterId(otherRid) || ('Owner ' + otherRid);
                                    const mySide = t.sides?.[rid] || t.sides?.[String(rid)] || { players: [], picks: [] };
                                    const theirSide = otherRid != null ? (t.sides?.[otherRid] || t.sides?.[String(otherRid)] || { players: [], picks: [] }) : { players: [], picks: [] };
                                    const myValue = mySide.totalValue || 0;
                                    const theirValue = theirSide.totalValue || 0;
                                    const won = myValue > theirValue * 1.15;
                                    const lost = theirValue > myValue * 1.15;
                                    const verdict = won ? 'Won' : lost ? 'Lost' : 'Fair';
                                    const verdictCol = won ? '#2ECC71' : lost ? '#E74C3C' : 'var(--silver)';
                                    return (
                                        <div key={ti} className="tc-owner-trade-row">
                                            <div>
                                                <span>{t.season} W{t.week || '-'}</span>
                                                <strong style={{ color: verdictCol }}>{verdict}</strong>
                                                <em>vs {otherUser}</em>
                                            </div>
                                            <p><b>Got</b> {summarizeTradeSide(mySide)}</p>
                                            <p><b>Sent</b> {summarizeTradeSide(theirSide)}</p>
                                            <strong style={{ color: verdictCol }}>{myValue >= theirValue ? '+' : ''}{Math.round(myValue - theirValue).toLocaleString()}</strong>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : <div className="tc-owner-empty">No trade history found for this owner.</div>}
                    </section>

                    {/* Legacy grid retained only for backwards compat — hidden */}
                    <div style={{ display: 'none' }}>
                    <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.655, marginBottom:'0.75rem', lineHeight:1.5 }}>
                        Profile each owner's behavioral DNA. This unlocks psychological tax calculations in the Trade Analyzer. {React.createElement(Tip, null, 'Owner DNA classifies each league member\'s trading personality based on historical behavior. The system auto-derives DNA from trade history and applies psychological taxes to acceptance likelihood calculations. Multiplier = how much value adjustment to expect.')}
                    </div>
                    {/* DNA Profile Guide */}
                    {React.createElement(function DnaGuideInline() {
                        const [guideOpen, setGuideOpen] = React.useState(false);
                        return React.createElement('div', { style:{marginBottom:'0.75rem'} },
                            React.createElement('button', { onClick:()=>setGuideOpen(!guideOpen), style:{fontSize:'0.76rem',color:'var(--gold)',background:'rgba(212,175,55,0.08)',border:'1px solid rgba(212,175,55,0.25)',borderRadius:'6px',padding:'0.4rem 0.8rem',cursor:'pointer',fontFamily: 'var(--font-body)',textTransform:'uppercase',letterSpacing:'0.04em'} }, guideOpen ? 'Hide DNA Guide' : 'Show DNA Guide'),
                            guideOpen ? React.createElement('div', { style:{marginTop:'0.5rem',display:'grid',gap:'0.5rem'} },
                                ...Object.entries(DNA_TYPES).filter(function(e){return e[0]!=='NONE'}).map(function(entry) {
                                    var key=entry[0], d=entry[1];
                                    return React.createElement('div', { key:key, style:{background:'rgba(255,255,255,0.02)',border:'1px solid '+d.color+'30',borderRadius:'8px',padding:'0.7rem 0.85rem'} },
                                        React.createElement('div', { style:{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.3rem'} },
                                            React.createElement('span', { style:{fontFamily:'Rajdhani, sans-serif',fontSize:'0.95rem',color:d.color} }, d.label),
                                            React.createElement('span', { style:{fontSize:'0.7rem',color:'var(--silver)',opacity:0.65,background:d.color+'15',padding:'0.1rem 0.4rem',borderRadius:'3px'} }, 'x'+d.multiplier)
                                        ),
                                        React.createElement('div', { style:{fontSize:'0.76rem',color:'var(--silver)',lineHeight:1.5,marginBottom:'0.3rem'} }, d.desc),
                                        d.strategy ? React.createElement('div', { style:{fontSize:'0.74rem',color:d.color,opacity:0.9,fontStyle:'italic',marginBottom:'0.3rem'} }, 'Strategy: '+d.strategy) : null,
                                        d.taxes && d.taxes.length ? React.createElement('div', { style:{display:'flex',flexWrap:'wrap',gap:'0.25rem'} },
                                            ...d.taxes.map(function(t,i){ return React.createElement('span', { key:i, style:{fontSize:'0.7rem',padding:'0.1rem 0.35rem',borderRadius:'3px',border:'1px solid '+d.color+'40',color:d.color,background:d.color+'10'} }, t); })
                                        ) : null
                                    );
                                })
                            ) : null
                        );
                    })}
                    <div className="tc-dna-grid">
                        {assessments.map(a => {
                            const rid = a.rosterId;
                            const dnaKey = ownerDna[a.ownerId] || 'NONE';
                            const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
                            const isMyTeam = a.rosterId === myRosterId;
                            const avatarSrc = avatarUrl(a.avatar);
                            const draftDna = ownerDraftDna[a.ownerId] || null;
                            const posture = calcOwnerPosture(a, dnaKey);
                            const ownerTrades = (window.App?.LI?.tradeHistory || []).filter(t => t.roster_ids?.includes(rid));
                            const tradeCount = ownerTrades.length;
                            const aiDna = typeof computeWeightedDNA === 'function' ? computeWeightedDNA(rid) : null;
                            const currentDna = ownerDna[a.ownerId] || aiDna?.key || 'NONE';
                            const isOverridden = ownerDna[a.ownerId] && aiDna && ownerDna[a.ownerId] !== aiDna.key;
                            const isExpanded = expandedDnaOwner === rid;
                            return (
                                <div key={a.rosterId} className={`tc-dna-card${dnaKey&&dnaKey!=='NONE'?' tc-dna-set':''}`} onClick={() => setExpandedDnaOwner(isExpanded ? null : rid)} style={{ cursor:'pointer' }}>
                                    {/* ── COMPACT VIEW (always visible) ── */}
                                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                        <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--charcoal)', overflow:'hidden', flexShrink:0, border:'1.5px solid rgba(212,175,55,0.3)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                                            {avatarSrc ? <img src={avatarSrc} alt={a.ownerName} style={{ width:'100%', height:'100%', objectFit:'cover' }} onError={e => e.target.style.display='none'} /> : <span style={{ fontSize:'0.75rem', color:'var(--gold)', fontWeight:700 }}>{a.ownerName.charAt(0).toUpperCase()}</span>}
                                        </div>
                                        <div style={{ overflow:'hidden', flex:1 }}>
                                            <div style={{ fontWeight:700, fontSize:'0.82rem', display:'flex', alignItems:'center', gap:'0.35rem' }}>{a.ownerName}{isMyTeam && <span className="tc-my-team-badge">ME</span>}{tradeCount > 0 && <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.6, fontWeight:400 }}>{tradeCount} trades</span>}</div>
                                            <div style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.6 }}>{a.teamName}</div>
                                        </div>
                                        <span className="tc-tier-badge" style={{ marginLeft:'auto', flexShrink:0, color:a.tierColor, borderColor:a.tierColor, background:a.tierBg }}>{a.tier}</span>
                                    </div>
                                    <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                                        <span className="tc-posture-badge" style={{ color:posture.color, borderColor:posture.color, background:`${posture.color}18` }}>{posture.label}</span>
                                        {aiDna && <span style={{ fontSize:'0.7rem', color: DNA_TYPES[aiDna.key]?.color || 'var(--silver)', fontWeight:600 }}>{DNA_TYPES[aiDna.key]?.label || '?'}</span>}
                                        <div style={{ display:'flex', gap:'0.5rem', marginLeft:'auto', fontSize:'0.72rem' }}>
                                            <span style={{ color:a.tierColor, fontWeight:600 }}>{a.healthScore}</span>
                                            <span style={{ color:'var(--silver)', opacity:0.5 }}>{a.wins}-{a.losses}</span>
                                        </div>
                                        <span style={{ fontSize:'0.65rem', color:'var(--silver)', opacity:0.4 }}>{isExpanded ? '▲' : '▼'}</span>
                                    </div>

                                    {/* ── EXPANDED VIEW (click to reveal) ── */}
                                    {isExpanded && (<>
                                    <div style={{ marginTop:'8px', paddingTop:'8px', borderTop:'1px solid rgba(255,255,255,0.06)' }} onClick={e => e.stopPropagation()}>
                                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.2rem' }}>
                                            <span style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.65, textTransform:'uppercase', letterSpacing:'0.06em' }}>Owner DNA</span>
                                            {(() => { const derived = deriveDNAFromHistory(a.ownerId, grudges); if (!derived) return null; const d = DNA_TYPES[derived]; return (<span style={{ fontSize:'0.78rem', fontWeight:700, padding:'0.1rem 0.35rem', borderRadius:3, border:`1px solid ${d?.color}55`, color:d?.color, background:`${d?.color}10` }}>AUTO: {d?.label}</span>); })()}
                                        </div>
                                        {aiDna ? (
                                            <div style={{ fontSize:'0.76rem', marginBottom:'6px' }}>
                                                <span style={{ color:'var(--gold)', fontWeight:600 }}>Scout suggests: </span>
                                                <span style={{ color: DNA_TYPES[aiDna.key]?.color || 'var(--silver)', fontWeight:700 }}>{DNA_TYPES[aiDna.key]?.label || aiDna.key}</span>
                                                <span style={{ color:'var(--silver)', marginLeft:'4px' }}>({aiDna.confidence}% confidence)</span>
                                                <div style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.7, marginTop:'2px' }}>{aiDna.reasoning}</div>
                                            </div>
                                        ) : (
                                            <div style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.55, marginBottom:'6px', fontStyle:'italic' }}>
                                                {tradeCount > 0 ? 'Insufficient signal — tag manually' : 'Not enough data — tag manually'}
                                            </div>
                                        )}
                                        <select className="tc-dna-select" value={currentDna} onChange={e => updateDna(a.ownerId, e.target.value)}>
                                            {aiDna && <option value={aiDna.key}>AI: {DNA_TYPES[aiDna.key]?.label} (recommended)</option>}
                                            {Object.entries(DNA_TYPES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                                        </select>
                                        {isOverridden && <span style={{ fontSize:'0.78rem', color:'#F0A500', marginLeft:'6px' }}>Overridden from AI suggestion</span>}
                                    </div>
                                    {dnaKey && dnaKey !== 'NONE' && dna.desc && (
                                        <div className="tc-dna-profile">
                                            <div style={{ fontSize:'0.72rem', fontWeight:700, color:dna.color, marginBottom:'0.25rem' }}>{dna.label}</div>
                                            <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.85, lineHeight:1.45 }}>{dna.desc}</div>
                                            {dna.strategy && <div style={{ marginTop:'0.35rem', fontSize:'0.74rem', color:dna.color, opacity:0.9, fontStyle:'italic' }}>Strategy: {dna.strategy}</div>}
                                            <div style={{ display:'flex', flexWrap:'wrap', gap:'0.25rem', marginTop:'0.4rem' }}>
                                                {dna.taxes?.map((t,i) => <span key={i} style={{ fontSize:'0.78rem', padding:'0.1rem 0.35rem', borderRadius:3, border:'1px solid rgba(212,175,55,0.3)', color:'#F0A500', background:'rgba(240,165,0,0.08)' }}>{t}</span>)}
                                            </div>
                                        </div>
                                    )}
                                    {draftDna && (
                                        <div style={{ background:'rgba(99,102,241,0.06)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:'6px', padding:'0.4rem 0.6rem' }}>
                                            <div style={{ display:'flex', alignItems:'center', gap:'0.4rem', marginBottom:'0.2rem' }}>
                                                <span style={{ fontSize:'0.78rem', color:'var(--silver)', opacity:0.65, textTransform:'uppercase' }}>Draft DNA</span>
                                                <span style={{ fontSize:'0.76rem', fontWeight:700, color:'#a5b4fc' }}>{draftDna.label}</span>
                                                <span style={{ fontSize:'0.78rem', color:'var(--silver)', opacity:0.6, marginLeft:'auto' }}>{draftDna.seasons} {draftDna.picksAnalyzed} picks</span>
                                            </div>
                                            <div style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.655, fontStyle:'italic' }}>{draftDna.tendency}</div>
                                        </div>
                                    )}
                                    <div style={{ display:'flex', gap:'0.75rem', paddingTop:'0.25rem' }}>
                                        <div style={{ textAlign:'center' }}><div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1rem', color:a.tierColor }}>{a.healthScore}</div><div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.65 }}>HEALTH</div></div>
                                        <div style={{ textAlign:'center' }}><div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1rem', color:a.panic>=3?'var(--loss-red)':'var(--silver)' }}>{a.panic}/5</div><div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.65 }}>PANIC</div></div>
                                        <div style={{ textAlign:'center' }}><div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1rem', color:'var(--silver)' }}>{a.wins}-{a.losses}</div><div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.65 }}>RECORD</div></div>
                                    </div>
                                    {/* Phase 5: Roster Audit embedded inline — per-position surplus/deficit breakdown */}
                                    {a.posAssessment && Object.keys(a.posAssessment).length > 0 && (
                                        <div style={{ marginTop:'10px', paddingTop:'10px', borderTop:'1px solid rgba(255,255,255,0.06)' }}>
                                            <div style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.65, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'6px', display:'flex', gap:'8px', alignItems:'baseline' }}>
                                                <span>Roster Audit</span>
                                                {a.strengths?.length > 0 && <span style={{ fontSize:'0.68rem', color:'#2ECC71', opacity:0.8 }}>surplus: {a.strengths.join(', ')}</span>}
                                                {a.needs?.filter(n => n.urgency === 'deficit').length > 0 && <span style={{ fontSize:'0.68rem', color:'#E74C3C', opacity:0.8 }}>deficit: {a.needs.filter(n => n.urgency === 'deficit').map(n => n.pos).join(', ')}</span>}
                                            </div>
                                            <div className="tc-pos-grid">
                                                {Object.entries(a.posAssessment).sort((pa, pb) => (TC_POS_ORDER[pa[0]] ?? 9) - (TC_POS_ORDER[pb[0]] ?? 9)).map(([pos, data]) => <TcPosRow key={pos} pos={pos} assessment={data} />)}
                                            </div>
                                        </div>
                                    )}
                                    </>)}
                                    {expandedDnaOwner === rid && (() => {
                                        const trades = (window.App?.LI?.tradeHistory || []).filter(t => t.roster_ids?.includes(rid));
                                        const profile = window.App?.LI?.ownerProfiles?.[rid] || {};

                                        if (!trades.length) return <div style={{ padding:'8px', fontSize:'0.7rem', color:'var(--silver)' }}>No trade history found</div>;

                                        return (
                                            <div style={{ marginTop:'10px', paddingTop:'10px', borderTop:'1px solid rgba(255,255,255,0.06)' }} onClick={e => e.stopPropagation()}>
                                                <div style={{ display:'flex', gap:'12px', marginBottom:'10px', flexWrap:'wrap', fontSize:'0.76rem' }}>
                                                    <span style={{ color:'#2ECC71' }}>Won: {profile.tradesWon || 0}</span>
                                                    <span style={{ color:'#E74C3C' }}>Lost: {profile.tradesLost || 0}</span>
                                                    <span style={{ color:'var(--silver)' }}>Fair: {profile.tradesFair || 0}</span>
                                                    <span style={{ color: (profile.avgValueDiff || 0) >= 0 ? '#2ECC71' : '#E74C3C' }}>Avg: {(profile.avgValueDiff || 0) >= 0 ? '+' : ''}{Math.round(profile.avgValueDiff || 0)} DHQ</span>
                                                </div>
                                                {trades.sort((ta, tb) => {
                                                    const aSeason = parseInt(ta.season) || 0;
                                                    const bSeason = parseInt(tb.season) || 0;
                                                    if (bSeason !== aSeason) return bSeason - aSeason;
                                                    return (tb.week || 0) - (ta.week || 0);
                                                }).map((t, ti) => {
                                                    const otherRid = t.roster_ids.find(r => r !== rid);
                                                    const otherUser = ownerNameForRosterId(otherRid) || ('Owner ' + otherRid);
                                                    const mySide = t.sides?.[rid] || { players:[], picks:[] };
                                                    const theirSide = t.sides?.[otherRid] || { players:[], picks:[] };
                                                    const myValue = mySide.totalValue || 0;
                                                    const theirValue = theirSide.totalValue || 0;
                                                    const won = myValue > theirValue * 1.15;
                                                    const lost = theirValue > myValue * 1.15;
                                                    const verdict = won ? 'Won' : lost ? 'Lost' : 'Fair';
                                                    const verdictCol = won ? '#2ECC71' : lost ? '#E74C3C' : 'var(--silver)';

                                                    return (
                                                        <div key={ti} style={{ padding:'8px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:'0.7rem' }}>
                                                            <div style={{ display:'flex', alignItems:'center', gap:'8px', marginBottom:'4px' }}>
                                                                <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.65 }}>{t.season} W{t.week}</span>
                                                                <span style={{ fontSize:'0.7rem', fontWeight:700, color:verdictCol, padding:'1px 6px', borderRadius:'3px', background:verdictCol + '15' }}>{verdict}</span>
                                                                <span style={{ fontSize:'0.72rem', color:'var(--silver)' }}>vs {otherUser}</span>
                                                                {t.fairness != null && <span style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.6 }}>Fairness: {t.fairness}</span>}
                                                            </div>
                                                            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px' }}>
                                                                <div>
                                                                    <div style={{ fontSize:'0.7rem', color:'#2ECC71', marginBottom:'2px' }}>Received:</div>
                                                                    {(mySide.players || []).map(pid => (
                                                                        <div key={pid} style={{ fontSize:'0.76rem', color:'var(--white)' }}>
                                                                            {playersData[pid]?.full_name || pid}
                                                                            <span style={{ color:'var(--silver)', fontSize:'0.78rem', marginLeft:'4px' }}>
                                                                                ({(window.App?.LI?.playerScores?.[pid] || 0).toLocaleString()} DHQ)
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                    {(mySide.picks || []).map((pk, pi) => (
                                                                        <div key={'pk'+pi} style={{ fontSize:'0.76rem', color:'var(--gold)' }}>{pk.season} Round {pk.round}</div>
                                                                    ))}
                                                                </div>
                                                                <div>
                                                                    <div style={{ fontSize:'0.7rem', color:'#E74C3C', marginBottom:'2px' }}>Sent:</div>
                                                                    {(theirSide.players || []).map(pid => (
                                                                        <div key={pid} style={{ fontSize:'0.76rem', color:'var(--white)' }}>
                                                                            {playersData[pid]?.full_name || pid}
                                                                            <span style={{ color:'var(--silver)', fontSize:'0.78rem', marginLeft:'4px' }}>
                                                                                ({(window.App?.LI?.playerScores?.[pid] || 0).toLocaleString()} DHQ)
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                    {(theirSide.picks || []).map((pk, pi) => (
                                                                        <div key={'tpk'+pi} style={{ fontSize:'0.76rem', color:'var(--gold)' }}>{pk.season} Round {pk.round}</div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                            <div style={{ display:'flex', gap:'12px', marginTop:'4px', fontSize:'0.72rem' }}>
                                                                <span style={{ color:'#2ECC71' }}>Got: {myValue.toLocaleString()}</span>
                                                                <span style={{ color:'#E74C3C' }}>Gave: {theirValue.toLocaleString()}</span>
                                                                <span style={{ color:verdictCol, fontWeight:700 }}>Net: {myValue >= theirValue ? '+' : ''}{(myValue - theirValue).toLocaleString()}</span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        );
                                    })()}
                                </div>
                            );
                        })}
                    </div>
                    </div>
                </div>
            );
        }

        function renderDealHQ() {
            if (!assessments.length || !myAssessment) {
                return <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem' }}>No trade data loaded yet.</div>;
            }

            const myStrengths = myAssessment.strengths || [];
            const myNeeds = myAssessment.needs || [];
            const partnerBoard = assessments
                .filter(a => a.rosterId !== myRosterId)
                .map(a => {
                    const dnaKey = ownerDna[a.ownerId] || 'NONE';
                    const dna = DNA_TYPES[dnaKey] || DNA_TYPES.NONE;
                    const posture = calcOwnerPosture(a, dnaKey);
                    const compat = calcComplementarity(myAssessment, a);
                    const theirNeeds = a.needs || [];
                    const mutualNeedFit = theirNeeds.filter(n => myStrengths.includes(n.pos)).length;
                    const theyHaveNeed = myNeeds.filter(n => (a.strengths || []).includes(n.pos)).length;
                    const pickAssets = pickAssetsForOwner(a.ownerId);
                    const pickCapital = pickAssets.reduce((s, p) => s + p.value, 0);
                    const profile = window.App?.LI?.ownerProfiles?.[a.rosterId] || {};
                    const tradeVol = profile.trades || 0;
                    const score = Math.round(compat * 1.2 + mutualNeedFit * 18 + theyHaveNeed * 14 + (a.panic || 0) * 7 + Math.min(20, tradeVol * 2) + (posture.key === 'LOCKED' ? -16 : 0));
                    const tag = score >= 90 ? 'Attack' : score >= 70 ? 'Prime' : score >= 50 ? 'Possible' : a.panic >= 3 ? 'Pressure' : 'Long shot';
                    const tagColor = tag === 'Attack' || tag === 'Prime' ? '#2ECC71' : tag === 'Possible' ? '#F0A500' : tag === 'Pressure' ? '#BB8FCE' : 'var(--silver)';
                    return { assessment:a, dnaKey, dna, posture, compat, mutualNeedFit, theyHaveNeed, pickAssets, pickCapital, profile, score, tag, tagColor };
                })
                .sort((a, b) => b.score - a.score || b.compat - a.compat);

            const selectedItem = partnerBoard.find(p => String(p.assessment.ownerId) === String(selectedDealPartnerId)) || partnerBoard[0] || null;
            const selectedPartner = selectedItem?.assessment || null;
            const GRADE_ORDER = { 'A+':0, 'A':1, 'B+':2, 'B':3, 'C':4, 'D':5, 'F':6 };
            const deals = (selectedPartner ? generateDealsForPartner(selectedPartner, dealMode, dealFocusPid) : [])
                .sort((a, b) => (GRADE_ORDER[a.grade] ?? 9) - (GRADE_ORDER[b.grade] ?? 9));
            const bestDeal = deals[0] || null;
            const bestPartner = partnerBoard[0];
            const leverageCounts = {};
            myStrengths.forEach(pos => {
                leverageCounts[pos] = assessments.filter(a => a.rosterId !== myRosterId && (a.needs || []).some(n => n.pos === pos)).length;
            });
            const topLeverage = Object.entries(leverageCounts).sort((a, b) => b[1] - a[1])[0] || null;
            const deadlineWeek = currentLeague?.settings?.trade_deadline;
            const seasonContext = deadlineWeek ? `Deadline W${deadlineWeek}` : `${currentLeague?.season || ''} market`;
            const dealModes = [
                { key:'fillNeed', label:'Fill Need' },
                { key:'sellSurplus', label:'Sell Surplus' },
                { key:'shop', label:'Shop Player' },
                { key:'acquire', label:'Acquire Player' },
                { key:'picks', label:'Pick Focus' },
            ];
            const focusRoster = dealMode === 'shop' || dealMode === 'sellSurplus'
                ? allRosters.find(r => r.roster_id === myRosterId)
                : allRosters.find(r => r.roster_id === selectedPartner?.rosterId);
            const focusPositions = dealMode === 'fillNeed'
                ? myNeeds.map(n => n.pos)
                : dealMode === 'sellSurplus'
                    ? myStrengths
                    : null;
            const focusOptions = assetsForRoster(focusRoster, focusPositions ? { positions: focusPositions } : {}).slice(0, 18);

            function assetLine(asset) {
                if (!asset) return null;
                if (asset.type === 'pick') {
                    return <div key={asset.id} className="tc-dhq-asset">
                        <span className="tc-dhq-asset-dot" style={{ background:PICK_COLORS[asset.round] || 'var(--gold)' }} />
                        <span>{asset.label}{asset.via ? <em> via {asset.via}</em> : null}</span>
                        <strong>{asset.value.toLocaleString()}</strong>
                    </div>;
                }
                return <div key={asset.pid || asset.id} className="tc-dhq-asset">
                    <span className="tc-dhq-asset-dot" style={{ background:posColor(asset.pos) }} />
                    <span>{asset.name} <em>{asset.pos} {asset.team}</em></span>
                    <strong>{asset.value.toLocaleString()}</strong>
                </div>;
            }

            function sideSummary(label, deal, side) {
                const players = side === 'give' ? deal.givePlayers : deal.receivePlayers;
                const picks = side === 'give' ? deal.givePicks : deal.receivePicks;
                const faab = side === 'give' ? deal.giveFaab : deal.receiveFaab;
                const totals = deal.totals[side];
                return <div className="tc-dhq-side">
                    <div className="tc-dhq-side-head">
                        <span>{label}</span>
                        <strong>{totals.total.toLocaleString()}</strong>
                    </div>
                    <div className="tc-dhq-breakdown">
                        <span>Players {totals.playerValue.toLocaleString()}</span>
                        <span>Picks {totals.pickValue.toLocaleString()} / {totals.pickCount}</span>
                        <span>FAAB ${faab || 0}</span>
                    </div>
                    <div className="tc-dhq-assets">
                        {players.map(assetLine)}
                        {picks.map(assetLine)}
                        {faab > 0 && <div className="tc-dhq-asset">
                            <span className="tc-dhq-asset-dot" style={{ background:'var(--win-green)' }} />
                            <span>FAAB</span>
                            <strong>${faab}</strong>
                        </div>}
                    </div>
                </div>;
            }

            function dealCard(deal, idx) {
                const deltaColor = deal.userGain >= 0 ? '#2ECC71' : '#E74C3C';
                const likelihoodColor2 = deal.likelihood >= 70 ? '#2ECC71' : deal.likelihood >= 45 ? '#F0A500' : '#E74C3C';
                return <div key={deal.id} className={`tc-dhq-deal-card${idx === 0 ? ' tc-dhq-top-deal' : ''}`}>
                    <div className="tc-dhq-deal-top">
                        <div>
                            <span className="tc-dhq-eyebrow">{deal.type}</span>
                            <h3>{deal.partnerName}</h3>
                        </div>
                        <div className="tc-dhq-actions">
                            <button onClick={() => loadDealIntoAnalyzer(deal)}>Analyzer</button>
                            <button onClick={() => saveDeal(deal)}>Save</button>
                        </div>
                    </div>
                    <div className="tc-dhq-stat-bar">
                        <div className="tc-dhq-stat">
                            <span>Confidence</span>
                            <strong style={{ color:likelihoodColor2 }}>{deal.likelihood}%</strong>
                        </div>
                        <div className="tc-dhq-stat">
                            <span>DHQ Delta</span>
                            <strong style={{ color:deltaColor }}>{deal.userGain >= 0 ? '+' : ''}{Math.round(deal.userGain).toLocaleString()}</strong>
                        </div>
                        <div className="tc-dhq-stat">
                            <span>Grade</span>
                            <strong style={{ color:deal.gradeColor }}>{deal.grade}</strong>
                        </div>
                        <div className="tc-dhq-stat">
                            <span>Fit</span>
                            <strong>{deal.fit}%</strong>
                        </div>
                        <div className="tc-dhq-stat">
                            <span>Window</span>
                            <strong style={{ color:deal.windowImpact.color }}>{deal.windowImpact.label.replace(/^Window\s*/i, '')}</strong>
                        </div>
                    </div>
                    <div className="tc-dhq-readout">
                        <div><b>Accept:</b><span>{deal.whyAccept}</span></div>
                        <div><b>You:</b><span>{deal.whyYou}</span></div>
                        <div><b>Swing:</b><span>{deal.swing}</span></div>
                    </div>
                    {deal.caution.length > 0 && <div className="tc-dhq-cautions">{deal.caution.slice(0, 3).map(c => <span key={c}>{c}</span>)}</div>}
                    <div className="tc-dhq-deal-grid">
                        {sideSummary('You Send', deal, 'give')}
                        {sideSummary('You Get', deal, 'receive')}
                    </div>
                </div>;
            }

            return <div className="tc-dhq-shell wr-fade-in">
                <div className="tc-dhq-hero">
                    <div>
                        <div className="tc-dhq-kicker">Deal HQ</div>
                        <h2>Trade command center</h2>
                        <p>Rank partners, generate advisory packages, and inspect the roster impact before opening a negotiation.</p>
                    </div>
                    <div className="tc-dhq-hero-actions">
                        <button onClick={() => setTcTab('analyzer')}>Manual Analyzer</button>
                        <button onClick={() => setTcTab('profiles')}>Owner Profiles</button>
                    </div>
                </div>

                <div className="tc-dhq-metrics">
                    <div><span>Best Partner</span><strong>{bestPartner?.assessment.ownerName || '--'}</strong><em>{bestPartner ? `${bestPartner.score} market score` : 'No target'}</em></div>
                    <div><span>Market Leverage</span><strong>{topLeverage ? topLeverage[0] : '--'}</strong><em>{topLeverage ? `${topLeverage[1]} teams need it` : 'No surplus edge'}</em></div>
                    <div><span>Season Context</span><strong>{seasonContext}</strong><em>{highPanic} high-panic teams</em></div>
                    <div><span>Saved Deals</span><strong>{savedDeals.length}</strong><em>{bestDeal ? `Top idea ${bestDeal.likelihood}%` : 'No package yet'}</em></div>
                </div>

                {dealHqNotice && <div className="tc-dhq-notice" onAnimationEnd={() => setDealHqNotice(null)}>{dealHqNotice}</div>}

                <div className="tc-dhq-grid">
                    <section className="tc-dhq-panel tc-dhq-partners">
                        <div className="tc-dhq-panel-head">
                            <span>Trade Partners</span>
                            <em>ranked by fit, need, posture, activity</em>
                        </div>
                        <div className="tc-dhq-panel-body tc-dhq-partner-list">
                            {partnerBoard.map(item => {
                                const a = item.assessment;
                                const selected = selectedPartner && String(selectedPartner.ownerId) === String(a.ownerId);
                                return <button key={a.rosterId} className={`tc-dhq-partner${selected ? ' is-selected' : ''}`} onClick={() => setSelectedDealPartnerId(a.ownerId)}>
                                    <div className="tc-dhq-partner-main">
                                        <strong>{a.ownerName}</strong>
                                        <span>{a.teamName}</span>
                                    </div>
                                    <div className="tc-dhq-partner-score" style={{ color:item.tagColor }}>
                                        <strong>{item.score}</strong>
                                        <span>{item.tag}</span>
                                    </div>
                                    <div className="tc-dhq-chipline">
                                        <span style={{ color:item.posture.color }}>{item.posture.label}</span>
                                        {item.dnaKey !== 'NONE' && <span style={{ color:item.dna.color }}>{item.dna.label}</span>}
                                        <span>{item.pickAssets.length} picks</span>
                                        <span>${a.faabRemaining || 0} FAAB</span>
                                    </div>
                                    <div className="tc-dhq-chipline">
                                        {(a.needs || []).slice(0, 4).map(n => <i key={n.pos} className={n.urgency === 'deficit' ? 'need' : ''}>{n.pos}</i>)}
                                        {(a.strengths || []).slice(0, 4).map(s => <i key={s}>+{s}</i>)}
                                    </div>
                                </button>;
                            })}
                        </div>
                    </section>

                    <section className="tc-dhq-panel tc-dhq-packages">
                        <div className="tc-dhq-panel-head">
                            <span>Deal Packages</span>
                            <em>{selectedPartner ? selectedPartner.ownerName : 'Select a partner'}</em>
                        </div>
                        <div className="tc-dhq-panel-body tc-dhq-package-list">
                            <div className="tc-dhq-modebar">
                                {dealModes.map(m => <button key={m.key} className={dealMode === m.key ? 'is-active' : ''} onClick={() => { setDealMode(m.key); setDealFocusPid(null); }}>{m.label}</button>)}
                            </div>
                            {(dealMode === 'shop' || dealMode === 'acquire' || dealMode === 'fillNeed' || dealMode === 'sellSurplus') && focusOptions.length > 0 && (
                                <div className="tc-dhq-focusbar">
                                    <span>{dealMode === 'shop' || dealMode === 'sellSurplus' ? 'Focus asset' : 'Target asset'}</span>
                                    <button className={!dealFocusPid ? 'is-active' : ''} onClick={() => setDealFocusPid(null)}>Auto</button>
                                    {focusOptions.map(p => <button key={p.pid} className={String(dealFocusPid) === String(p.pid) ? 'is-active' : ''} onClick={() => setDealFocusPid(p.pid)}>{p.name} <em>{p.value.toLocaleString()}</em></button>)}
                                </div>
                            )}
                            {deals.length
                                ? <div className="tc-dhq-package-note"><b>Ready</b>{deals.length} package{deals.length === 1 ? '' : 's'} generated</div>
                                : <div className="tc-dhq-empty">No package found for this mode. Try another partner, clear the focus asset, or use the manual analyzer.</div>}
                        </div>
                    </section>

                    <aside className="tc-dhq-panel tc-dhq-dossier">
                        <div className="tc-dhq-panel-head">
                            <span>Partner Dossier</span>
                            <em>{selectedPartner?.teamName || 'No partner selected'}</em>
                        </div>
                        <div className="tc-dhq-panel-body tc-dhq-dossier-body">
                        {selectedItem && selectedPartner ? <>
                            <div className="tc-dhq-dossier-card">
                                <h3>{selectedPartner.ownerName}</h3>
                                <div className="tc-dhq-chipline">
                                    <span style={{ color:selectedPartner.tierColor }}>{selectedPartner.tier}</span>
                                    <span style={{ color:selectedItem.posture.color }}>{selectedItem.posture.label}</span>
                                    <span>{selectedItem.compat}% fit</span>
                                </div>
                                <p>{selectedItem.dna?.strategy || selectedItem.posture.desc}</p>
                            </div>
                            <div className="tc-dhq-dossier-grid">
                                <div><span>Record</span><strong>{selectedPartner.wins}-{selectedPartner.losses}{selectedPartner.ties ? '-' + selectedPartner.ties : ''}</strong></div>
                                <div><span>Weekly</span><strong>{selectedPartner.weeklyPts || '--'}</strong></div>
                                <div><span>Trade W-L</span><strong>{selectedItem.profile.tradesWon || 0}-{selectedItem.profile.tradesLost || 0}</strong></div>
                                <div><span>Avg Trade</span><strong>{(selectedItem.profile.avgValueDiff || 0) >= 0 ? '+' : ''}{Math.round(selectedItem.profile.avgValueDiff || 0)}</strong></div>
                            </div>
                            <div className="tc-dhq-dossier-block">
                                <b>Needs</b>
                                <div className="tc-dhq-chipline">{(selectedPartner.needs || []).slice(0, 6).map(n => <i key={n.pos} className={n.urgency === 'deficit' ? 'need' : ''}>{n.pos}</i>)}</div>
                            </div>
                            <div className="tc-dhq-dossier-block">
                                <b>Assets they may move</b>
                                <div className="tc-dhq-chipline">{(selectedPartner.strengths || []).slice(0, 6).map(s => <i key={s}>+{s}</i>)}{selectedItem.pickAssets.slice(0, 3).map(p => <i key={p.id}>{p.label}</i>)}</div>
                            </div>
                            <div className="tc-dhq-dossier-block">
                                <b>Acceptance drivers</b>
                                <ul>
                                    <li>{selectedItem.posture.desc}</li>
                                    {selectedPartner.panic >= 3 && <li>Panic level {selectedPartner.panic}/5 creates urgency.</li>}
                                    {selectedItem.mutualNeedFit > 0 && <li>Your surplus matches {selectedItem.mutualNeedFit} of their needs.</li>}
                                    {selectedItem.dnaKey !== 'NONE' && <li>{selectedItem.dna.label}: {selectedItem.dna.desc}</li>}
                                </ul>
                            </div>
                            <div className="tc-dhq-dossier-block">
                                <b>Saved deals</b>
                                {savedDeals.length ? savedDeals.slice(0, 5).map(d => <div key={d.id} className="tc-dhq-saved">
                                    <button onClick={() => loadDealIntoAnalyzer(d)}>{d.partnerName || 'Saved deal'} <span>{d.likelihood}%</span></button>
                                    <button onClick={() => removeSavedDeal(d.id)}>X</button>
                                </div>) : <p>No saved deals yet.</p>}
                            </div>
                        </> : <div className="tc-dhq-empty">Select a partner to view their dossier.</div>}
                        </div>
                    </aside>
                </div>

                {deals.length > 0 && (
                    <section className="tc-dhq-panel tc-dhq-deal-stage">
                        <div className="tc-dhq-panel-head">
                            <span>Generated Packages</span>
                            <em>{deals.length} idea{deals.length === 1 ? '' : 's'} · {selectedPartner ? selectedPartner.ownerName : 'Select a partner'}</em>
                        </div>
                        <div className="tc-dhq-deal-stage-body">
                            {(showAllDeals ? deals : deals.slice(0, 3)).map(dealCard)}
                        </div>
                        {deals.length > 3 && <button className="tc-dhq-show-more" onClick={() => setShowAllDeals(!showAllDeals)}>{showAllDeals ? 'Show fewer' : `Show ${deals.length - 3} more`}</button>}
                    </section>
                )}
            </div>;
        }

        // ── renderTradeAnalyzer ──
        function renderTradeAnalyzer() {
            if (!Object.keys(playersData).length) return <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem' }}>No player data loaded.</div>;

            // Use the same ownership-aware value path as the pick list.
            const pickVal = (pkId) => { const p = pkId.split('-'); return pickValueForParts(p[1], Number(p[2]), p[3]); };
            const totalA = tradeIds.A.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0)
                + tradePickIds.A.reduce((s, pkId) => s + pickVal(pkId), 0)
                + Math.round((tradeFaab.A || 0) * FAAB_RATE);
            const totalB = tradeIds.B.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0)
                + tradePickIds.B.reduce((s, pkId) => s + pickVal(pkId), 0)
                + Math.round((tradeFaab.B || 0) * FAAB_RATE);
            const userGain = totalB - totalA;
            const absDiff = Math.abs(userGain);
            const hasTrade = tradeIds.A.length > 0 || tradeIds.B.length > 0 || tradePickIds.A.length > 0 || tradePickIds.B.length > 0 || tradeFaab.A > 0 || tradeFaab.B > 0;
            const diff = totalA - totalB;

            const otherOwnerId = tradeOwner.B;
            const otherDnaKey = otherOwnerId ? (ownerDna[otherOwnerId] || 'NONE') : 'NONE';
            const otherDna = DNA_TYPES[otherDnaKey] || DNA_TYPES.NONE;
            const myOwnerId = tradeOwner.A || (myAssessment?.ownerId || null);
            const theirAssessment = assessments.find(a => a.ownerId === otherOwnerId) || null;
            const theirPosture = calcOwnerPosture(theirAssessment, otherDnaKey);
            const psychTaxes = calcPsychTaxes(myAssessment, theirAssessment, otherDnaKey, theirPosture);
            const grudgeTax = calcGrudgeTax(myOwnerId, otherOwnerId, grudges, otherDnaKey);
            const netTaxTotal = psychTaxes.reduce((s,t) => s + t.impact, 0) + grudgeTax.total;
            const fairMargin = Math.round(Math.max(totalA, totalB) * 0.04);

            // Use shared canonical acceptance calculation (same as Scout)
            const _calcLikelihood = window.App?.TradeEngine?.calcAcceptanceLikelihood;
            let likelihood = 50;
            if (hasTrade && (totalA > 0 || totalB > 0)) {
                if (typeof _calcLikelihood === 'function') {
                    likelihood = _calcLikelihood(totalA, totalB, otherDnaKey, psychTaxes, myAssessment, theirAssessment);
                    // Add grudge tax on top (not in shared engine — app-specific persistence)
                    likelihood = Math.round(Math.max(3, Math.min(95, likelihood + grudgeTax.total)));
                } else {
                    // Emergency fallback — sigmoid only
                    const maxSide = Math.max(totalA, totalB, 1);
                    const nd = (totalA - totalB) / maxSide;
                    likelihood = Math.round(Math.max(5, Math.min(95, 5 + 90 / (1 + Math.exp(-7 * nd)))));
                }
            }
            const likelihoodColor = likelihood >= 70 ? 'var(--win-green)' : likelihood >= 45 ? '#F0A500' : 'var(--loss-red)';
            const verdictColor = userGain > fairMargin ? 'var(--win-green)' : userGain < -fairMargin ? '#E74C3C' : 'var(--gold)';
            const verdictText = userGain > fairMargin ? 'YOU WIN' : userGain < -fairMargin ? 'YOU LOSE' : 'EVEN TRADE';
            const diffDisplay = userGain > 0 ? `+${absDiff.toLocaleString()}` : userGain < 0 ? `-${absDiff.toLocaleString()}` : '+/-0';
            const sentPositions = [...new Set(tradeIds.A.map(pid => normPos(playersData[pid]?.position)).filter(Boolean))];
            const receivedPositions = [...new Set(tradeIds.B.map(pid => normPos(playersData[pid]?.position)).filter(Boolean))];
            const pickCapitalDelta = tradePickIds.B.reduce((s, pkId) => s + pickVal(pkId), 0) - tradePickIds.A.reduce((s, pkId) => s + pickVal(pkId), 0);
            const pickQuantityDelta = tradePickIds.B.length - tradePickIds.A.length;
            const faabDelta = (tradeFaab.B || 0) - (tradeFaab.A || 0);
            const rosterImpactLabel = receivedPositions.length || sentPositions.length
                ? `+${receivedPositions.join('/') || 'none'} / -${sentPositions.join('/') || 'none'}`
                : 'No players selected';
            const starterValueDelta = tradeIds.B.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0) - tradeIds.A.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0);

            function rosterPlayersFor(side) {
                const ownerId = tradeOwner[side]; if (!ownerId) return null;
                const roster = allRosters.find(r => r.owner_id === ownerId); if (!roster) return null;
                const playerIdSet = [...new Set([...(roster.players||[]), ...(roster.reserve||[]), ...(roster.taxi||[])])];
                const q = searchText[side].toLowerCase().trim();
                return playerIdSet.filter(id => {
                    const p = playersData[id]; if (!p || !normPos(p.position)) return false;
                    if (q.length >= 1) return `${p.first_name||''} ${p.last_name||''}`.toLowerCase().includes(q);
                    return true;
                }).map(id => { const p = playersData[id]; const v = getPlayerValue(id); return { id, name:`${p.first_name||''} ${p.last_name||''}`.trim(), pos:normPos(p.position), team:p.team||'FA', value:v.value, source:v.source }; })
                .sort((a,b) => { const pd = (TC_POS_ORDER[a.pos]??9) - (TC_POS_ORDER[b.pos]??9); return pd !== 0 ? pd : b.value - a.value; });
            }

            function addPlayer(side, pid) { if (tradeIds[side].includes(pid)) return; setTradeIds(prev => ({ ...prev, [side]: [...prev[side], pid] })); setSearchText(prev => ({ ...prev, [side]: '' })); }
            function removePlayer(side, pid) { setTradeIds(prev => ({ ...prev, [side]: prev[side].filter(id => id !== pid) })); }
            function addPick(side, pickId) { if (tradePickIds[side].includes(pickId)) return; setTradePickIds(prev => ({ ...prev, [side]: [...prev[side], pickId] })); }
            function removePick(side, pickId) { setTradePickIds(prev => ({ ...prev, [side]: prev[side].filter(id => id !== pickId) })); }
            function makePickId(year, round, fromRosterId) { return `PICK-${year}-${round}-${fromRosterId}`; }
            function pickLabel(year, round, fromRid) { return formatPickLabel(year, round, fromRid); }
            const ownerOptions = [{ id: null, label: '-- None --' }, ...assessments.map(a => ({ id: a.ownerId, label: `${a.ownerName} (${a.teamName})` }))];

            function TradeSide({ side, color, label }) {
                const ids = tradeIds[side];
                const pickIds = tradePickIds[side];
                const faab = tradeFaab[side] || 0;
                const tot = ids.reduce((s, id) => s + (getPlayerValue(id).value || 0), 0)
                    + pickIds.reduce((s, pkId) => { const p = pkId.split('-'); return s + pickValueForParts(p[1], Number(p[2]), p[3]); }, 0)
                    + Math.round(faab * FAAB_RATE);
                const rosterPlayers = rosterPlayersFor(side);
                const ownerId = tradeOwner[side] || null;
                const ownerPicksList = ownerId ? (picksByOwner[ownerId] || []) : [];

                return (
                    <div className={`tc-ta-side tc-side-${side.toLowerCase()}`}>
                        <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'0.95rem', color, letterSpacing:'0.08em' }}>{label}</span>
                        <select className="tc-ta-owner-select" value={tradeOwner[side] || ''} onChange={e => { setTradeOwner(prev => ({ ...prev, [side]: e.target.value || null })); setSearchText(prev => ({ ...prev, [side]: '' })); }}>
                            {ownerOptions.map(o => <option key={o.id||'none'} value={o.id||''}>{o.label}</option>)}
                        </select>

                        {/* Added players */}
                        {ids.map(pid => {
                            const p = playersData[pid]; const v = getPlayerValue(pid);
                            const pct = Math.round((v.value / MAX_VALUE) * 100);
                            if (!p) return null;
                            return (
                                <div key={pid} className="tc-ta-player-row">
                                    <button className="tc-ta-remove" onClick={() => removePlayer(side, pid)}>X</button>
                                    <span className="tc-ta-pos-dot" style={{ background: posColor(normPos(p.position)) }} />
                                    <span style={{ flex:1, fontSize:'0.82rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.first_name} {p.last_name}</span>
                                    <div className="tc-ta-val-col" style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                                        <div className="tc-ta-val-bar-wrap"><div className="tc-ta-val-bar-fill" style={{ width:`${pct}%`, background: color }} /></div>
                                        <span style={{ fontSize:'0.7rem', fontWeight:700, color }}>{v.value > 0 ? v.value.toLocaleString() : '--'}</span>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Added picks */}
                        {pickIds.map(pkId => {
                            const parts = pkId.split('-');
                            const yr = parts[1], rd = Number(parts[2]), fromRid = parts[3];
                            const val = pickValueForParts(yr, rd, fromRid);
                            const pct = Math.round((val / MAX_VALUE) * 100);
                            const pickColor = PICK_COLORS[rd] || 'var(--silver)';
                            const via = ownerNameForRosterId(fromRid);
                            const isOwn = !via || (ownerId && (() => { const r = allRosters.find(x => x.owner_id === ownerId); return r && String(r.roster_id) === String(fromRid); })());
                            return (
                                <div key={pkId} className="tc-ta-player-row">
                                    <button className="tc-ta-remove" onClick={() => removePick(side, pkId)}>X</button>
                                    <span className="tc-ta-pos-dot" style={{ background: pickColor }} />
                                    <span style={{ flex:1, fontSize:'0.82rem', fontWeight:600 }}>{pickLabel(yr, rd, fromRid)}{!isOwn && via && <span style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6, marginLeft:'0.3rem' }}>via {via}</span>}</span>
                                    <div className="tc-ta-val-col" style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:2 }}>
                                        <div className="tc-ta-val-bar-wrap"><div className="tc-ta-val-bar-fill" style={{ width:`${pct}%`, background: pickColor }} /></div>
                                        <span style={{ fontSize:'0.7rem', fontWeight:700, color: pickColor }}>{val.toLocaleString()}</span>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Roster picker */}
                        {tradeOwner[side] && rosterPlayers !== null ? (
                            <div>
                                <input className="tc-ta-roster-filter" placeholder={`Filter ${rosterPlayers.length} players...`} value={searchText[side]} onChange={e => setSearchText(prev => ({ ...prev, [side]: e.target.value }))} />
                                <div className="tc-ta-roster-list-tall">
                                    {rosterPlayers.length === 0 ? <div className="tc-ta-roster-empty">No players match</div> : (() => {
                                        const grouped = {};
                                        rosterPlayers.forEach(r => { if (!grouped[r.pos]) grouped[r.pos] = []; grouped[r.pos].push(r); });
                                        return Object.entries(grouped).sort((a,b) => (TC_POS_ORDER[a[0]]??9)-(TC_POS_ORDER[b[0]]??9)).map(([pos, posPlayers]) => (
                                            <div key={pos}>
                                                <div className="tc-ta-pos-group-hdr" style={{ color: posColor(pos) }}>{pos}</div>
                                                {posPlayers.map(r => {
                                                    const added = ids.includes(r.id);
                                                    return (
                                                        <div key={r.id} className={`tc-ta-roster-item${added?' tc-added':''}`} onClick={() => !added && addPlayer(side, r.id)}>
                                                            <span className="tc-ta-pos-dot" style={{ background: posColor(r.pos) }} />
                                                            <span style={{ flex:1, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{r.name}</span>
                                                            <span className="tc-ta-player-meta">{r.team}</span>
                                                            <span className="tc-ta-player-val">{r.value > 0 ? r.value.toLocaleString() : '--'}</span>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ));
                                    })()}
                                    {ownerPicksList.length > 0 && (
                                        <div style={{ marginTop:'0.5rem', borderTop:'1px solid rgba(212,175,55,0.2)', paddingTop:'0.4rem' }}>
                                            <div className="tc-ta-pos-group-hdr" style={{ color:'var(--gold)' }}>DRAFT PICKS</div>
                                            {ownerPicksList.map(({ year, round, fromRosterId }) => {
                                                const pkId = makePickId(year, round, fromRosterId);
                                                const added = pickIds.includes(pkId);
                                                const val = pickValueForParts(year, round, fromRosterId);
                                                const pickColor = PICK_COLORS[round] || 'var(--silver)';
                                                const via = ownerNameForRosterId(fromRosterId);
                                                const r2 = allRosters.find(x => x.owner_id === ownerId);
                                                const isOwn2 = r2 && String(r2.roster_id) === String(fromRosterId);
                                                return (
                                                    <div key={pkId} className={`tc-ta-roster-item${added?' tc-added':''}`} onClick={() => !added && addPick(side, pkId)}>
                                                        <span className="tc-ta-pos-dot" style={{ background: pickColor }} />
                                                        <span style={{ flex:1, fontWeight:600 }}>{pickLabel(year, round, fromRosterId)}{!isOwn2 && via && <span style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.6, marginLeft:'0.3rem' }}>via {via}</span>}</span>
                                                        <span className="tc-ta-player-val" style={{ color: pickColor }}>{val.toLocaleString()}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.6, textAlign:'center', padding:'0.5rem' }}>Select an owner above to view their roster</div>}

                        {/* FAAB */}
                        <div style={{ borderTop:'1px solid rgba(255,255,255,0.06)', paddingTop:'0.4rem', marginTop:'0.2rem' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
                                <span style={{ fontSize:'0.72rem', fontWeight:700, color:'var(--win-green)', letterSpacing:'0.05em' }}>FAAB $</span>
                                <input type="number" min={0} value={faab || ''} onChange={e => setTradeFaab(prev => ({ ...prev, [side]: Math.max(0, Number(e.target.value)) }))} placeholder="0"
                                    style={{ width:70, background:'rgba(0,0,0,0.3)', border:'1px solid rgba(46,204,113,0.35)', color:'var(--win-green)', padding:'0.2rem 0.4rem', borderRadius:4, fontSize:'0.75rem', fontWeight:700 }} />
                                {faab > 0 && <button className="tc-ta-remove" onClick={() => setTradeFaab(prev => ({ ...prev, [side]: 0 }))}>X</button>}
                            </div>
                            {faab > 0 && <div style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.6, marginTop:'0.2rem' }}>= {Math.round(faab * FAAB_RATE).toLocaleString()} dynasty pts</div>}
                        </div>

                        {/* Total */}
                        <div className="tc-ta-total-row" style={{ background:`${color}12`, border:`1px solid ${color}30` }}>
                            <span className="tc-ta-total-label">Total Value</span>
                            <span className="tc-ta-total-val" style={{ color }}>{tot > 0 ? tot.toLocaleString() : '--'}</span>
                        </div>
                    </div>
                );
            }

            // Phase 5: Build vs Find mode — lets the user pick between manually building a trade
            // or auto-generating proposals. "Find" mode renders the TradeFinderTab inline.
            const _analyzerMode = window._wrAnalyzerMode || 'build';
            return (
                <div>
                    <div className="wr-module-toolbar">
                        <span className="wr-module-toolbar-label">Mode</span>
                        <div className="wr-module-nav">
                        {['build','find'].map(m => (
                            <button key={m} className={_analyzerMode === m ? 'is-active' : ''} onClick={() => { window._wrAnalyzerMode = m; setExpandedDnaOwner(prev => prev); /* trigger re-render via setState noop */ if (typeof setGrudges === 'function') setGrudges(g => [...g]); }}>{m === 'build' ? 'Build a Trade' : 'Find a Trade'}</button>
                        ))}
                        </div>
                    </div>

                    {/* FIND mode — auto-generate proposals (ex-Trade Finder tab) */}
                    {_analyzerMode === 'find' && (
                        canAccess('trade-finder')
                            ? React.createElement(TradeFinderTab, { allRosters, myRosterId, assessments, ownerDna, playersData, picksByOwner, getPlayerValue, getPickValue, calcOwnerPosture, calcPsychTaxes, calcAcceptanceLikelihood: (window.App?.TradeEngine?.calcAcceptanceLikelihood) || (window.App?.calcAcceptanceLikelihood) || function(){return 50;}, DNA_TYPES, autoTarget: finderAutoTarget, onAutoTargetConsumed: () => setFinderAutoTarget(null) })
                            : React.createElement(UpgradeGate, { feature:'trade-finder', title:'UNLOCK TRADE FINDER', description:'Auto-generate trade proposals with every team. See acceptance likelihood based on owner psychology. Find deals they\'ll actually accept.', targetTier:'warroom' })
                    )}

                    {/* BUILD mode — manual trade builder (the original analyzer) */}
                    {_analyzerMode === 'build' && <>
                    <div style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.65, marginBottom:'0.75rem', lineHeight:1.5 }}>
                        Values sourced from <strong style={{ color:'var(--gold)' }}>DHQ Engine</strong> (dynasty valuations). Select owners, add players and picks, and see the full psychological trade analysis.
                    </div>

                    <div className="tc-ta-3col">
                        {TradeSide({ side:'A', color:'#5DADE2', label:'SIDE A -- YOUR GIVE' })}
                        {TradeSide({ side:'B', color:'#E74C3C', label:'SIDE B -- YOU RECEIVE' })}

                        {/* League Scouting Panel */}
                        <div className="tc-scout-panel">
                            <div style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'0.92rem', color:'var(--gold)', letterSpacing:'0.1em', marginBottom:'0.2rem' }}>LEAGUE TEAMS</div>
                            <div style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.65, marginBottom:'0.3rem' }}>Click a team to set as Side B.</div>
                            {assessments.filter(a => a.rosterId !== myRosterId).sort((a,b) => b.healthScore - a.healthScore).map(a => {
                                const isSelected = tradeOwner.B === a.ownerId;
                                const compat = myAssessment ? calcComplementarity(myAssessment, a) : 0;
                                const compatColor = compat >= 50 ? 'var(--win-green)' : compat >= 30 ? '#F0A500' : 'var(--silver)';
                                const dnaKey2 = ownerDna[a.ownerId] || 'NONE';
                                const dna2 = DNA_TYPES[dnaKey2];
                                return (
                                    <div key={a.rosterId} className={`tc-scout-team-card${isSelected ? ' tc-scout-selected' : ''}`}
                                        onClick={() => { setTradeOwner(prev => ({ ...prev, B: a.ownerId })); setSearchText(prev => ({ ...prev, B: '' })); }}>
                                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:'0.4rem' }}>
                                            <span style={{ fontSize:'0.82rem', fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{a.ownerName}</span>
                                            <span className="tc-tier-badge" style={{ color:a.tierColor, borderColor:a.tierColor, background:a.tierBg, flexShrink:0 }}>{a.tier}</span>
                                        </div>
                                        <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.655 }}>{a.teamName}</div>
                                        <div style={{ fontSize:'0.76rem', display:'flex', alignItems:'center', gap:'0.4rem' }}>
                                            <span style={{ color: a.weeklyPts >= WEEKLY_TARGET ? 'var(--win-green)' : 'var(--loss-red)', fontWeight:700 }}>{a.weeklyPts > 0 ? `${a.weeklyPts} pts` : '--'}</span>
                                            <span style={{ color:'var(--silver)', opacity:0.6 }}>/ {WEEKLY_TARGET}</span>
                                            {compat > 0 && <span style={{ marginLeft:'auto', fontSize:'0.72rem', color:compatColor, fontWeight:700 }}>{compat}% fit</span>}
                                        </div>
                                        {a.needs.length > 0 && <div style={{ display:'flex', flexWrap:'wrap', gap:'0.2rem' }}><span style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.6 }}>NEEDS:</span>{a.needs.slice(0,4).map(n => <span key={n.pos} className={`tc-chip ${n.urgency==='deficit'?'tc-chip-need':'tc-chip-thin'}`} style={{ fontSize:'0.78rem' }}>{n.pos}</span>)}</div>}
                                        {a.strengths.length > 0 && <div style={{ display:'flex', flexWrap:'wrap', gap:'0.2rem' }}><span style={{ fontSize:'0.7rem', color:'var(--silver)', opacity:0.6 }}>HAS:</span>{a.strengths.map(s => <span key={s} className="tc-chip tc-chip-strength" style={{ fontSize:'0.78rem' }}>+{s}</span>)}</div>}
                                        {dnaKey2 !== 'NONE' && dna2 && <div style={{ fontSize:'0.72rem', color:dna2.color, opacity:0.85, fontStyle:'italic' }}>{dna2.label}</div>}
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Verdict */}
                    {hasTrade && (
                        <div className="tc-ta-verdict tc-ta-sticky-summary" id="wr-export-trade">
                            <div className="tc-section-hdr" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>TRADE ANALYSIS<button onClick={() => window.wrExport?.capture(document.getElementById('wr-export-trade'), 'trade-analysis')} style={{ background:'none', border:'1px solid rgba(212,175,55,0.25)', borderRadius:'4px', padding:'2px 8px', color:'var(--gold)', fontSize:'0.68rem', cursor:'pointer', fontFamily: 'var(--font-body)' }}>Snapshot</button></div>
                            <div style={{ display:'flex', alignItems:'baseline', gap:'0.6rem', flexWrap:'wrap' }}>
                                <span className="tc-verdict-diff" style={{ color: verdictColor }}>{diffDisplay}</span>
                                <span style={{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.1rem', color: verdictColor }}>{verdictText}</span>
                                <span style={{ fontSize:'0.74rem', color:'var(--silver)', opacity:0.655 }}>(gave {totalA.toLocaleString()} / received {totalB.toLocaleString()})</span>
                            </div>
                            <div className="tc-ta-impact-grid">
                                <div>
                                    <span>Roster Impact</span>
                                    <strong>{rosterImpactLabel}</strong>
                                    <em>{starterValueDelta >= 0 ? '+' : ''}{Math.round(starterValueDelta).toLocaleString()} player DHQ</em>
                                </div>
                                <div>
                                    <span>Pick Capital</span>
                                    <strong>{pickCapitalDelta >= 0 ? '+' : ''}{Math.round(pickCapitalDelta).toLocaleString()}</strong>
                                    <em>{pickQuantityDelta >= 0 ? '+' : ''}{pickQuantityDelta} picks</em>
                                </div>
                                <div>
                                    <span>FAAB</span>
                                    <strong>{faabDelta >= 0 ? '+' : ''}${faabDelta}</strong>
                                    <em>{Math.round(faabDelta * FAAB_RATE).toLocaleString()} DHQ equiv.</em>
                                </div>
                                <div>
                                    <span>Acceptance</span>
                                    <strong style={{ color: likelihoodColor }}>{likelihood}%</strong>
                                    <em>{netTaxTotal >= 0 ? '+' : ''}{netTaxTotal} psych modifier</em>
                                </div>
                            </div>
                            {otherOwnerId && (
                                <div style={{ display:'flex', alignItems:'center', gap:'0.5rem', flexWrap:'wrap' }}>
                                    <span style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.65 }}>Their posture:</span>
                                    <span className="tc-posture-badge" style={{ color:theirPosture.color, borderColor:theirPosture.color, background:`${theirPosture.color}18` }}>{theirPosture.label}</span>
                                    {otherDnaKey !== 'NONE' && <span className="tc-chip tc-chip-dna">{otherDna.label}</span>}
                                </div>
                            )}
                            <div>
                                <div style={{ fontSize:'0.72rem', color:'var(--silver)', opacity:0.65, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'0.35rem' }}>Psychological Tax Breakdown {React.createElement(Tip, null, 'Each owner\'s DNA type creates psychological modifiers that affect trade acceptance beyond pure value. Taxes reduce likelihood, bonuses increase it. Factors: endowment effect, panic premium, status tax, loss aversion, rebuilding discount, need fulfillment, window alignment, and posture.')}</div>
                                <div className="tc-tax-table">
                                    {psychTaxes.map((t,i) => (
                                        <div key={i} className={`tc-tax-table-row ${t.type === 'BONUS' ? 'tc-bonus' : 'tc-tax'}`}>
                                            <span className="tc-tax-name">{t.name}</span>
                                            <span className="tc-tax-desc">{t.desc}</span>
                                            <span className="tc-tax-val" style={{ color: t.impact > 0 ? 'var(--win-green)' : 'var(--loss-red)' }}>{t.impact > 0 ? '+' : ''}{t.impact}</span>
                                        </div>
                                    ))}
                                    {grudgeTax.total !== 0 && (
                                        <div className={`tc-tax-table-row ${grudgeTax.total < 0 ? 'tc-tax' : 'tc-bonus'}`}>
                                            <span className="tc-tax-name">Grudge Tax</span>
                                            <span className="tc-tax-desc">{grudgeTax.entries.length} logged interaction{grudgeTax.entries.length!==1?'s':''}</span>
                                            <span className="tc-tax-val" style={{ color: grudgeTax.total < 0 ? 'var(--loss-red)' : 'var(--win-green)' }}>{grudgeTax.total > 0 ? '+' : ''}{grudgeTax.total}</span>
                                        </div>
                                    )}
                                    <div className="tc-tax-table-row tc-total">
                                        <span className="tc-tax-name">NET MODIFIER</span>
                                        <span className="tc-tax-desc">Applied to base likelihood</span>
                                        <span className="tc-tax-val" style={{ color: netTaxTotal > 0 ? 'var(--win-green)' : netTaxTotal < 0 ? 'var(--loss-red)' : 'var(--silver)' }}>{netTaxTotal > 0 ? '+' : ''}{netTaxTotal}</span>
                                    </div>
                                </div>
                            </div>
                            {otherDnaKey !== 'NONE' && otherDna.strategy && (
                                <div style={{ fontSize:'0.76rem', color:otherDna.color, fontStyle:'italic', background:`${otherDna.color}0d`, border:`1px solid ${otherDna.color}25`, borderRadius:5, padding:'0.4rem 0.6rem' }}>Approach: {otherDna.strategy}</div>
                            )}
                            <div>
                                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.3rem' }}>
                                    <span style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.7, textTransform:'uppercase', letterSpacing:'0.06em' }}>Likelihood of Acceptance {React.createElement(Tip, null, 'Estimated chance the other owner accepts. Starts at 50%, adjusted by: value difference, DNA type multiplier, psychological taxes, and posture. Each DNA type has different thresholds.')}</span>
                                    <span style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'1.4rem', fontWeight:600, color: likelihoodColor }}>{likelihood}%</span>
                                </div>
                                <div className="tc-likelihood-bar-wrap"><div className="tc-likelihood-bar-fill" style={{ width:`${likelihood}%`, background: likelihoodColor }} /></div>
                            </div>
                        </div>
                    )}
                    </>}
                </div>
            );
        }

        // ── renderTradeInbox (must be inside TradeCalcTab for scope access) ──
        function renderTradeInbox() {
            const recentTrades = (() => {
                // Use LI trade history which has pre-analyzed data, or fall back to window.S.transactions
                const txns = (window.App?.LI?.tradeHistory || []).slice(0, 20);
                if (txns.length) {
                    return txns.map((trade, idx) => {
                        const rids = trade.roster_ids || [];
                        const [rid1, rid2] = rids;
                        const s1 = trade.sides?.[rid1] || { players:[], picks:[], totalValue:0 };
                        const s2 = trade.sides?.[rid2] || { players:[], picks:[], totalValue:0 };
                        const val1 = s1.totalValue || s1.players?.reduce((s,pid) => s + (getPlayerValue(pid).value||0), 0) || 0;
                        const val2 = s2.totalValue || s2.players?.reduce((s,pid) => s + (getPlayerValue(pid).value||0), 0) || 0;
                        const diff = val1 - val2;
                        const maxVal = Math.max(val1, val2, 1);
                        const pctDiff = Math.round(Math.abs(diff) / maxVal * 100);
                        const grade = pctDiff <= 2 ? 'A+' : pctDiff <= 5 ? 'A' : pctDiff <= 12 ? 'B+' : pctDiff <= 20 ? 'B' : pctDiff <= 30 ? 'C' : pctDiff <= 40 ? 'D' : 'F';
                        const gradeCol = grade.startsWith('A') ? 'var(--win-green)' : grade.startsWith('B') ? '#F0A500' : 'var(--loss-red)';
                        return { idx, trade, rids, sides: {[rid1]:s1,[rid2]:s2}, rid1, rid2, val1, val2, diff, grade, gradeCol, pctDiff };
                    });
                }
                return [];
            })();

            const pn = pid => playersData[pid]?.full_name || pid;

            // Filter by team
            const filteredTrades = inboxTeamFilter === 'all' ? recentTrades : recentTrades.filter(t => t.rids.some(rid => String(rid) === String(inboxTeamFilter)));

            return (
                <div>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'0.75rem', gap:'8px', flexWrap:'wrap' }}>
                        <div style={{ fontSize:'0.76rem', color:'var(--silver)', opacity:0.655, lineHeight:1.5 }}>
                            Recent trades analyzed with DHQ values and fairness grades.
                        </div>
                        <select value={inboxTeamFilter} onChange={e => setInboxTeamFilter(e.target.value)} style={{ padding:'4px 8px', fontSize:'0.74rem', fontFamily: 'var(--font-body)', background:'var(--charcoal)', border:'1px solid rgba(212,175,55,0.2)', borderRadius:'4px', color:'var(--silver)', cursor:'pointer' }}>
                            <option value="all">All Teams</option>
                            {allRosters.map(r => <option key={r.roster_id} value={r.roster_id}>{ownerNameForRosterId(r.roster_id) || 'Team ' + r.roster_id}</option>)}
                        </select>
                    </div>
                    {filteredTrades.length === 0 ? (
                        <div style={{ color:'var(--silver)', textAlign:'center', padding:'2rem', opacity:0.65 }}>
                            {window.App?.LI_LOADED ? 'No trades found in league history.' : (
                                <React.Fragment>
                                    <div className="ld"><span>.</span><span>.</span><span>.</span></div>
                                    <div style={{ marginTop:'8px' }}>Loading trade history from DHQ engine...</div>
                                    <button onClick={() => { setTimeout(() => setTcTab('inbox'), 50); setTcTab('dna'); }} style={{ marginTop:'12px', padding:'6px 14px', background:'rgba(212,175,55,0.12)', color:'var(--gold)', border:'1px solid rgba(212,175,55,0.25)', borderRadius:'6px', fontFamily: 'var(--font-body)', fontSize:'0.78rem', cursor:'pointer' }}>Retry</button>
                                </React.Fragment>
                            )}
                        </div>
                    ) : <div style={{ display:'grid', gridTemplateColumns:'repeat(2, 1fr)', gap:'10px' }}>
                    {filteredTrades.map(t => {
                        const name1 = ownerNameForRosterId(t.rid1) || 'Team ' + t.rid1;
                        const name2 = ownerNameForRosterId(t.rid2) || 'Team ' + t.rid2;
                        const s1 = t.sides[t.rid1] || { players:[], picks:[] };
                        const s2 = t.sides[t.rid2] || { players:[], picks:[] };
                        const winner = t.diff > t.val1 * 0.05 ? name1 : t.diff < -t.val2 * 0.05 ? name2 : null;

                        return (
                            <div key={t.idx} style={{ background:'rgba(255,255,255,0.02)', border:'1px solid rgba(212,175,55,0.15)', borderRadius:'8px', padding:'10px' }}>
                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'6px' }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                                        <span title={'Grade measures trade fairness. A = balanced (\u22645% value diff). Variance = % difference between sides.'} style={{ fontFamily:'JetBrains Mono, monospace', fontSize:'1rem', fontWeight:600, color:t.gradeCol, cursor:'help' }}>{t.grade}</span>
                                        <span style={{ fontSize:'0.68rem', color:'var(--silver)', opacity:0.65 }}>{t.pctDiff}%</span>
                                        {winner && <span style={{ fontSize:'0.66rem', color:'var(--win-green)', fontWeight:700 }}>{winner}</span>}
                                    </div>
                                    <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                                        <span style={{ fontSize:'0.68rem', color:'var(--silver)', opacity:0.5 }}>
                                            {t.trade.season ? 'S'+t.trade.season+(t.trade.week?' W'+t.trade.week:'') : ''}
                                        </span>
                                    </div>
                                </div>
                                <div style={{ display:'grid', gridTemplateColumns:'1fr auto 1fr', gap:'4px', alignItems:'start' }}>
                                    <div>
                                        <div style={{ fontSize:'0.68rem', color:'var(--gold)', fontWeight:700, marginBottom:'2px' }}>{name1} ({t.val1.toLocaleString()})</div>
                                        {(s1.players||[]).map(pid => <div key={pid} style={{ fontSize:'0.72rem', color:'var(--white)', lineHeight:1.4 }}>{pn(pid)}</div>)}
                                        {(s1.picks||[]).map((pk,i) => <div key={'p'+i} style={{ fontSize:'0.72rem', color:'var(--gold)' }}>{pk.season||pk.year} R{pk.round}</div>)}
                                    </div>
                                    <div style={{ fontSize:'0.82rem', color:'var(--gold)', alignSelf:'center', fontWeight:700 }}>&#8644;</div>
                                    <div>
                                        <div style={{ fontSize:'0.68rem', color:'var(--gold)', fontWeight:700, marginBottom:'2px' }}>{name2} ({t.val2.toLocaleString()})</div>
                                        {(s2.players||[]).map(pid => <div key={pid} style={{ fontSize:'0.72rem', color:'var(--white)', lineHeight:1.4 }}>{pn(pid)}</div>)}
                                        {(s2.picks||[]).map((pk,i) => <div key={'s2p'+i} style={{ fontSize:'0.72rem', color:'var(--gold)' }}>{pk.season||pk.year} R{pk.round}</div>)}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    </div>}
                </div>
            );
        }

        // ── Main render ──
        // ── Command mode: concise intelligence briefing ──
        if (viewMode === 'command') {
            // Gate: Intelligence requires warroom tier
            if (!canAccess('intelligence-full')) {
                return React.createElement(UpgradeGate, {
                    feature: 'intelligence-full',
                    title: 'UNLOCK TRADE CENTER',
                    description: 'See trades your leaguemates are actually likely to accept. Owner DNA profiles every manager\'s trading psychology — Fleecer, Dominator, Stalwart, Acceptor, or Desperate — then calculates acceptance likelihood.',
                    targetTier: 'warroom'
                });
            }
            // Rank all teams by trade fit
            const allTargets = assessments.filter(a => a.rosterId !== myRosterId).map(a => {
                const dk = ownerDna[a.ownerId] || 'NONE';
                const dna = DNA_TYPES[dk] || DNA_TYPES.NONE;
                const posture = calcOwnerPosture(a, dk);
                const compat = myAssessment ? calcComplementarity(myAssessment, a) : 0;
                const theirNeeds = a.needs?.slice(0, 3) || [];
                const yourSurplus = myAssessment?.strengths?.filter(s => theirNeeds.some(n => n.pos === s)) || [];
                const desperation = a.panic || 0;
                const label = compat >= 50 ? 'TARGET' : compat >= 25 ? 'POSSIBLE' : desperation >= 3 ? 'DESPERATE' : 'LOW PROB';
                const labelCol = label === 'TARGET' ? '#2ECC71' : label === 'POSSIBLE' ? '#F0A500' : label === 'DESPERATE' ? '#BB8FCE' : 'var(--silver)';
                return { ...a, dk, dna, posture, compat, theirNeeds, yourSurplus, desperation, label, labelCol };
            }).sort((a, b) => b.compat - a.compat);

            const topTargets = allTargets.filter(t => t.label === 'TARGET' || t.label === 'POSSIBLE').slice(0, 5);
            const desperate = allTargets.filter(t => t.desperation >= 3 && t.label !== 'TARGET').slice(0, 2);
            const avoid = allTargets.filter(t => t.compat < 15).slice(0, 2);

            // Strategy summary
            const myNeeds = myAssessment?.needs?.slice(0, 3) || [];
            const myStrengths = myAssessment?.strengths || [];
            const stratText = myNeeds.length ? 'Target teams needing ' + myStrengths.slice(0, 2).join('/') + '. Offer surplus depth for ' + myNeeds.map(n => n.pos).join('/') + ' upgrades.' : 'Your roster is balanced. Look for value asymmetry trades.';

            const renderTarget = (t, i, showCTA) => (
                <div key={i} style={{ background: 'var(--black)', border: '2px solid rgba(212,175,55,0.2)', borderLeft: '4px solid ' + (t.dna.color || 'var(--gold)'), borderRadius: '10px', padding: '16px 20px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.2rem', color: 'var(--white)' }}>{t.ownerName}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: t.labelCol, background: t.labelCol + '15', padding: '2px 8px', borderRadius: '4px', textTransform: 'uppercase' }}>{t.label}</span>
                        {t.dk !== 'NONE' && <span style={{ fontSize: '0.72rem', fontWeight: 700, color: t.dna.color, background: t.dna.color + '15', padding: '2px 8px', borderRadius: '4px' }}>{t.dna.label}</span>}
                        <span style={{ fontSize: '0.72rem', color: t.posture.color }}>{t.posture.label}</span>
                        <span style={{ marginLeft: 'auto', fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', color: t.compat >= 50 ? '#2ECC71' : t.compat >= 30 ? '#F0A500' : 'var(--silver)' }}>{t.compat}%</span>
                    </div>
                    <div style={{ fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.6, marginBottom: '8px' }}>
                        Needs <strong style={{ color: '#E74C3C' }}>{t.theirNeeds.map(n => n.pos).join(', ') || 'unknown'}</strong>
                        {t.yourSurplus.length > 0 && <span>. You have <strong style={{ color: '#2ECC71' }}>{t.yourSurplus.join(', ')}</strong> to offer</span>}
                        . <em style={{ color: t.dna.color, opacity: 0.8 }}>{t.dna.strategy ? t.dna.strategy.split('.')[0] + '.' : ''}</em>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.5 }}>{t.healthScore} health {'\u00B7'} {t.wins}-{t.losses} {'\u00B7'} {t.tier}</span>
                        {showCTA && <React.Fragment>
                            <button onClick={() => { const targetRoster = allRosters.find(r => r.roster_id === t.rosterId); const topPid = (targetRoster?.players || []).map(pid => ({ pid, val: getPlayerValue(pid).value })).filter(p => p.val > 0).sort((a, b) => b.val - a.val)[0]; setSelectedDealPartnerId(t.ownerId); setDealMode('acquire'); if (topPid) { setDealFocusPid(topPid.pid); setFinderAutoTarget({ pid: topPid.pid, mode: 'acquire' }); } setTcTab('dealhq'); }} style={{ marginLeft: 'auto', padding: '5px 12px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '4px', fontFamily: 'var(--font-body)', fontSize: '0.74rem', cursor: 'pointer', fontWeight: 700 }}>GENERATE TRADES</button>
                        </React.Fragment>}
                    </div>
                </div>
            );

            return (
                <div style={{ padding: '20px 24px', maxWidth: '1000px', margin: '0 auto' }} className="wr-fade-in">
                    <div className="wr-module-strip">
                        <div className="wr-module-context">
                            <span>Trade</span>
                            <strong>Intelligence Briefing</strong>
                            <em>Best partners, leverage spots, and low-probability paths.</em>
                        </div>
                    </div>

                    {/* Strategy summary */}
                    <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '10px', padding: '14px 18px', marginBottom: '20px', fontSize: '0.85rem', color: 'var(--silver)', lineHeight: 1.7 }}>
                        {stratText}
                    </div>

                    {/* Best trade partners */}
                    {topTargets.length > 0 && <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', color: '#2ECC71', letterSpacing: '0.06em', marginBottom: '8px' }}>BEST TRADE PARTNERS</div>
                        {topTargets.map((t, i) => renderTarget(t, i, true))}
                    </div>}

                    {/* Desperate teams */}
                    {desperate.length > 0 && <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', color: '#BB8FCE', letterSpacing: '0.06em', marginBottom: '8px' }}>DESPERATE TEAMS (EXPLOIT)</div>
                        {desperate.map((t, i) => renderTarget(t, 'desp-' + i, true))}
                    </div>}

                    {/* Avoid / low probability */}
                    {avoid.length > 0 && <div style={{ marginBottom: '20px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.1rem', color: 'var(--silver)', letterSpacing: '0.06em', marginBottom: '8px', opacity: 0.6 }}>LOW PROBABILITY</div>
                        {avoid.map((t, i) => <div key={'avoid-'+i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: '6px', marginBottom: '4px', opacity: 0.5 }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--silver)' }}>{t.ownerName}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{t.compat}% fit {'\u00B7'} {t.dna.label}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.4 }}>Low roster overlap</span>
                        </div>)}
                    </div>}

                    {/* Target map summary */}
                    <div style={{ background: 'var(--black)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', marginBottom: '8px' }}>LEAGUE TARGET MAP</div>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {allTargets.map((t, i) => <span key={i} style={{ fontSize: '0.74rem', padding: '3px 10px', borderRadius: '4px', background: t.labelCol + '12', border: '1px solid ' + t.labelCol + '30', color: t.labelCol, fontWeight: 600 }}>{t.ownerName} {t.compat}%</span>)}
                        </div>
                    </div>

                    {/* Trade history insight */}
                    {(() => {
                        const tradeHist = window.App?.LI?.tradeHistory || [];
                        if (!tradeHist.length) return <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '4px' }}>LEAGUE TRADE PATTERNS</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--silver)', opacity: 0.4 }}>No trade history available yet. As trades occur, patterns will emerge here.</div>
                        </div>;
                        const activeCounts = {};
                        tradeHist.forEach(t => (t.roster_ids || []).forEach(rid => { activeCounts[rid] = (activeCounts[rid] || 0) + 1; }));
                        const mostActive = Object.entries(activeCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
                        return <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--gold)', marginBottom: '6px' }}>WHAT WORKS IN THIS LEAGUE</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.6 }}>
                                {tradeHist.length} trades completed. Most active: {mostActive.map(([rid, cnt]) => (ownerNameForRosterId(parseInt(rid)) || 'Team ' + rid) + ' (' + cnt + ')').join(', ')}.
                            </div>
                        </div>;
                    })()}

                    <div style={{ textAlign: 'center', padding: '12px', fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.4 }}>Switch to Analyst view for full owner profiles, trade calculator, and history</div>
                </div>
            );
        }

        // ── Deal HQ layout ──
        // Deal HQ is now the primary Trade Center surface. Owner Profiles and
        // the manual analyzer remain available as supporting views.
        const _activeTcTab = tcTab === 'analyzer' ? 'analyzer' : (tcTab === 'profiles' || tcTab === 'dna') ? 'profiles' : 'dealhq';
        const _tcTabLabels = { dealhq: 'Deal HQ', profiles: 'Owner Profiles', analyzer: 'Trade Analyzer' };
        const _tcTabContext = {
            dealhq: 'Ranked partners, generated packages, and saved deal flow.',
            profiles: 'Owner posture, roster gaps, pick context, and trade history.',
            analyzer: 'Manual player, pick, and FAAB inspection.'
        };
        return (
            <div style={{ padding: 'var(--card-pad, 14px 16px)' }}>
                <div className="wr-module-strip">
                    <div className="wr-module-context">
                        <span>Trade</span>
                        <strong>{_tcTabLabels[_activeTcTab]}</strong>
                        <em>{_tcTabContext[_activeTcTab]}</em>
                    </div>
                    <div className="wr-module-actions">
                    <div className="wr-module-nav">
                    {['dealhq','profiles','analyzer'].map(tab => (
                        <button key={tab} className={_activeTcTab === tab ? 'is-active' : ''} onClick={() => setTcTab(tab)}>{_tcTabLabels[tab]}</button>
                    ))}
                    </div>
                    </div>
                </div>
                {_activeTcTab === 'dealhq' && (canAccess('trade-finder') ? renderDealHQ() : React.createElement(UpgradeGate, { feature:'trade-finder', title:'UNLOCK DEAL HQ', description:'Generate advisory trade packages with partner fit, owner psychology, pick capital, FAAB, and roster impact.', targetTier:'warroom' }))}
                {_activeTcTab === 'profiles' && (canAccess('owner-dna') ? renderOwnerDna() : React.createElement(UpgradeGate, { feature:'owner-dna', title:'UNLOCK OWNER DNA', description:'Profile every manager\'s trading psychology. Know who\'s a Fleecer, who\'s Desperate, and exactly how to approach each trade conversation.', targetTier:'warroom' }))}
                {_activeTcTab === 'analyzer' && renderTradeAnalyzer()}
            </div>
        );
    }

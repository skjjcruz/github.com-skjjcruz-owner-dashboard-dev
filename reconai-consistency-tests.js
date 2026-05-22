#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// War Room AI — Path Consistency Tests
// Compares: War Room Edge Function (ai-analyze) vs ReconAI CDN (dhqAI)
//
// This test file ports all 12 scenarios from ai-training-tests.js and
// simulates BOTH paths:
//   1. War Room path: buildSystemPrompt(ctx) + prompt builders
//   2. ReconAI path: DHQ_IDENTITY (UNKNOWN - CDN blocked) + dhqContext output
//
// Each test grades both paths against the same rubric, identifying gaps
// in the ReconAI implementation.
// ═══════════════════════════════════════════════════════════════════════════

// ── War Room Prompt Builders (from ai-analyze/index.ts) ─────────────

function detectLeagueFormat(ctx) {
    const rp = ctx.rosterPositions || ctx.roster_positions || [];
    const scoring = ctx.scoringSettings || ctx.scoring_settings || {};
    const sfSlots = rp.filter(s => s === 'SUPER_FLEX').length;
    const qbSlots = rp.filter(s => s === 'QB').length + sfSlots;
    const rbSlots = rp.filter(s => s === 'RB').length;
    const wrSlots = rp.filter(s => s === 'WR').length;
    const teSlots = rp.filter(s => s === 'TE').length;
    const idpSlots = rp.filter(s => ['IDP_FLEX','DL','LB','DB','DE','CB','S'].includes(s)).length;
    const benchSpots = rp.filter(s => s === 'BN').length;
    const starterSlots = rp.filter(s => s !== 'BN' && s !== 'IR' && s !== 'TAXI').length;
    const recBonus = scoring.rec || 0;
    const teBonusRec = scoring.bonus_rec_te || scoring.rec_te || 0;
    const tePremiumBonus = teBonusRec > 0 ? teBonusRec : 0;
    const isTEP = tePremiumBonus > 0;
    let scoringType = 'std';
    if (recBonus >= 1) scoringType = 'ppr';
    else if (recBonus >= 0.5) scoringType = 'half_ppr';
    else if (recBonus > 0) scoringType = 'custom';
    return { isSuperFlex: sfSlots > 0, isTEP, isIDP: idpSlots > 0, idpSlots, numQBSlots: qbSlots, numTESlots: teSlots, numRBSlots: rbSlots, numWRSlots: wrSlots, rosterSize: rp.length, benchSpots, starterCount: starterSlots, hasK: rp.includes('K'), hasDST: rp.includes('DEF'), scoringType, tePremiumBonus };
}

function buildLeagueFormatBlock(fmt) {
    const lines = [];
    if (fmt.isSuperFlex) {
        lines.push(`⚡ SUPERFLEX LEAGUE — ${fmt.numQBSlots} QB-eligible slots. QBs are the most valuable position. A team without 2 starting-caliber QBs has a CRITICAL deficit that overrides all other needs.`);
        lines.push(`  → QB scarcity multiplier: 1.8x. Every QB valuation, trade offer, and FAAB bid must reflect this premium.`);
        lines.push(`  → A team with only 1 startable QB should treat acquiring a second QB as their #1 priority above ALL other positions.`);
    }
    if (fmt.isTEP) {
        lines.push(`⚡ TE PREMIUM LEAGUE — TEs receive +${fmt.tePremiumBonus} bonus PPR (total: ${(fmt.tePremiumBonus + (fmt.scoringType === 'ppr' ? 1 : fmt.scoringType === 'half_ppr' ? 0.5 : 0)).toFixed(1)} PPR for TE). Elite TEs (top 5) are premium assets worth significantly more than standard leagues.`);
        lines.push(`  → TE scarcity multiplier: 1.5x. Do NOT treat TEs as interchangeable depth pieces.`);
    }
    if (fmt.isIDP) {
        lines.push(`⚡ IDP LEAGUE — ${fmt.idpSlots} defensive starter slots. LB/DL/DB have real fantasy value. Defensive studs (top-5 at their IDP position) are tradeable assets.`);
    }
    if (fmt.scoringType === 'ppr') {
        lines.push(`📊 FULL PPR scoring — high-volume pass catchers (slot WRs, receiving RBs, pass-catching TEs) carry premium value over pure rushers.`);
    } else if (fmt.scoringType === 'half_ppr') {
        lines.push(`📊 HALF PPR scoring — balanced value between volume receivers and efficient rushers.`);
    }
    const rbDemand = fmt.numRBSlots + Math.floor(fmt.starterCount * 0.3);
    if (rbDemand >= 3) {
        lines.push(`🔴 RB SCARCITY — ${fmt.numRBSlots} dedicated RB slots plus FLEX competition means startable RBs are at a premium. Do NOT recommend trading away RB depth lightly.`);
    }
    return lines.length > 0
        ? `\n═══ LEAGUE FORMAT CONTEXT (critically important — adjust ALL valuations accordingly) ═══\n${lines.join('\n')}\n═══════════════════════════════════════════════════════════════════════════════════════\n`
        : '';
}

function buildTeamModeBlock(ctx) {
    const tier = ctx.teamTier || ctx.tier || '';
    const win = ctx.teamWindow || ctx.tradeWindow || '';
    const healthScore = ctx.healthScore || 0;
    if (!tier && !win) return '';
    const lines = [];
    lines.push(`\n═══ TEAM COMPETITIVE MODE (critically important — drives ALL recommendations) ═══`);
    const mode = tier.toUpperCase();
    if (mode === 'REBUILDING' || win === 'REBUILDING') {
        lines.push(`🔨 THIS TEAM IS IN REBUILD MODE (Health: ${healthScore}/100)`);
        lines.push(`REBUILD RULES — strictly enforce these:`);
        lines.push(`  1. PRIORITIZE YOUTH: Target players aged 24 and under. Players over 28 are sell candidates, not buy targets.`);
        lines.push(`  2. ACCUMULATE DRAFT PICKS: Every trade recommendation should seek to acquire future draft capital. Early-round picks (1st-2nd) are the #1 currency.`);
        lines.push(`  3. DO NOT RECOMMEND aging veterans — even if they fill a positional need. A rebuilding team does NOT need a 30-year-old WR2 for "depth."`);
        lines.push(`  4. SELL declining assets aggressively: Any player past peak with 2+ years of decline should be moved for picks or young talent.`);
        lines.push(`  5. FAAB RESTRAINT: Only spend FAAB on young upside plays (age ≤25) or injury replacements for trade-value players. Do NOT recommend bidding on replacement-level veterans.`);
        lines.push(`  6. PATIENCE > DEPTH: A rebuild team should NOT be told to "add depth." They should be told to stockpile assets and wait.`);
    } else if (mode === 'ELITE' || mode === 'CONTENDER' || win === 'CONTENDING') {
        lines.push(`🏆 THIS TEAM IS CONTENDING (${mode} tier, Health: ${healthScore}/100)`);
        lines.push(`CONTENDER RULES — strictly enforce these:`);
        lines.push(`  1. WIN-NOW ASSETS: Prioritize proven producers who can contribute THIS season. Age matters less than immediate output.`);
        lines.push(`  2. FILL GAPS: Identify the weakest starting position and fix it. A contender with a QB2 problem should solve it NOW.`);
        lines.push(`  3. TRADE FUTURE PICKS FOR PRESENT TALENT: Contenders should be willing to move 2nd/3rd round picks for upgrades.`);
        lines.push(`  4. DEPTH MATTERS for contenders — but only QUALITY depth (top-24 at position, minimum). Do NOT recommend adding low-end bench players.`);
        lines.push(`  5. FAAB AGGRESSION on difference-makers: If a player would start, bid aggressively. If they'd be WR5 on the bench, skip them.`);
    } else if (mode === 'CROSSROADS' || win === 'TRANSITIONING') {
        lines.push(`⚖️ THIS TEAM IS AT A CROSSROADS (Health: ${healthScore}/100)`);
        lines.push(`CROSSROADS RULES:`);
        lines.push(`  1. EVALUATE the core: Can this team compete in 1-2 years with targeted upgrades, or should they sell and rebuild?`);
        lines.push(`  2. DO NOT half-commit: Either push to contend (trade picks for upgrades) or commit to rebuild (trade vets for picks/youth).`);
        lines.push(`  3. Players aged 27-29 with declining production are the priority sell candidates.`);
        lines.push(`  4. FAAB: Moderate spending. Target young upside + immediate starters only. Skip replacement-level additions.`);
    }
    lines.push(`═══════════════════════════════════════════════════════════════════════════════════════\n`);
    return lines.join('\n');
}

function buildQualityThresholdBlock() {
    return `\n═══ MINIMUM QUALITY THRESHOLDS (apply to ALL FA/FAAB/waiver recommendations) ═══\n⛔ DO NOT recommend adding or bidding on players who meet ANY of these criteria:\n  • DHQ below 500 (replacement-level talent — not worth a roster spot in competitive leagues)\n  • PPG below 5.0 in their most recent season with 6+ games played\n  • Players with no NFL stats in the last 2 seasons (unless they are rookies)\n  • Veterans (age 27+) with declining trend who would not crack the starting lineup\n\n✅ ONLY recommend FAAB spending when the player would:\n  • Start or be the first backup at a position of need, OR\n  • Be a high-upside young player (age ≤25) worth a speculative hold, OR\n  • Replace an injured starter (emergency depth pickup)\n\n💰 FAAB DISCIPLINE:\n  • "Depth for depth's sake" is NEVER a valid reason to spend FAAB\n  • A $1 bid on a bad player is still a wasted roster spot\n  • If no quality targets exist at a position, say "HOLD YOUR FAAB" — do not invent targets\n  • Remaining FAAB is a weapon for mid-season breakouts and injuries — preserve it\n═══════════════════════════════════════════════════════════════════════════════════════\n`;
}

function buildSystemPrompt(ctx) {
    const leagueFmt = ctx ? detectLeagueFormat(ctx) : null;
    const fmtBlock = leagueFmt ? buildLeagueFormatBlock(leagueFmt) : '';
    const modeBlock = ctx ? buildTeamModeBlock(ctx) : '';
    const qualityBlock = buildQualityThresholdBlock();
    return `You are an elite dynasty fantasy football analyst…\n${fmtBlock}${modeBlock}${qualityBlock}`;
}

function buildFATargetsPrompt(ctx) {
    const rosterStr = (ctx.myRoster || []).map(p =>
        `  ${p.pos} ${p.name} (${p.team}) | ${p.pts ? `${p.pts}pts` : 'no stats'} | Age ${p.age ?? '?'} | Yr ${p.yrsExp ?? '?'}${p.isStarter ? ' [STARTER]' : p.isTaxi ? ' [TAXI]' : ''}${p.dhq ? ` | DHQ ${p.dhq}` : ''}`
    ).join('\n');
    const faStr = (ctx.topFreeAgents || []).slice(0, 50).map(fa =>
        `  ${fa.pos} ${fa.name} (${fa.team || 'FA'}) | ${fa.pts ? `${fa.pts}pts` : '—'} | ${fa.gp ? `${fa.gp}gp` : ''} | ${fa.avg ? `${fa.avg}avg` : ''} | Age ${fa.age ?? '?'} | Yr ${fa.yrsExp ?? '?'}${fa.isRookie ? ' [ROOKIE]' : ''}${fa.dhq ? ` | DHQ ${fa.dhq}` : ''}`
    ).join('\n');
    const rosterPositions = (ctx.rosterPositions || []).filter(p => p !== 'BN' && p !== 'IR').join(', ');
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const teamMode = ctx.teamTier || ctx.tier || 'UNKNOWN';
    const teamWindow = ctx.teamWindow || ctx.tradeWindow || '';
    const healthScore = ctx.healthScore || 0;
    const modeBlock = buildTeamModeBlock(ctx);
    let qbCount = 0, qbWarning = '';
    if (fmt.isSuperFlex) {
        qbCount = (ctx.myRoster || []).filter(p => p.pos === 'QB' && p.isStarter).length;
        if (qbCount < fmt.numQBSlots) {
            qbWarning = `\n⚠️ CRITICAL: This team has only ${qbCount} starting QB(s) in a ${fmt.numQBSlots}-QB-slot league. QB acquisition is the #1 PRIORITY. Any available QB with DHQ > 1000 should be the first recommendation.`;
        }
    }
    return `Build a free agency action plan for **${ctx.myOwner}** in **${ctx.leagueName}**.\n${fmtBlock}${modeBlock}\n**TEAM STATUS:** ${teamMode} tier | Health: ${healthScore}/100 | Window: ${teamWindow || 'Unknown'}\n**REMAINING FAAB:** $${ctx.faabBudget} of $${ctx.startingBudget}\n**STARTING LINEUP SPOTS:** ${rosterPositions}\n${qbWarning}\n\n**MY CURRENT ROSTER:**\n${rosterStr || 'No roster data'}\n\n**TOP AVAILABLE FREE AGENTS:**\n${faStr || 'No FA data'}\n\nFAAB RECOMMENDATION RULES (strictly enforce):\n1. QUALITY FLOOR: Do NOT recommend any player with DHQ < 500 or season PPG < 5.0 (with 6+ games).\n2. TEAM MODE MATTERS:\n   - REBUILDING teams: Only recommend young upside plays (age ≤25) or injury emergency pickups.\n   - CONTENDING teams: Recommend players who would immediately start or be first-in-line backup.\n   - CROSSROADS teams: Target young starters only. No speculative depth.\n3. FAAB PRESERVATION: If fewer than 3 quality targets exist, explicitly say "HOLD YOUR FAAB."\n4. If the available player pool is weak, SAY SO.`;
}

// ── Mock Factories ─────────────────────────────────────────────────

function mockPlayer(name, pos, age, dhq, pts, isStarter=false) {
    return { name, pos, team: 'NYJ', age, dhq, pts: pts ? String(pts) : null, gp: pts ? 16 : 0, avg: pts ? String((pts/16).toFixed(1)) : null, yrsExp: Math.max(0, age - 22), isStarter, isTaxi: false };
}

function mockFA(name, pos, age, dhq, pts) {
    return { name, pos, team: 'FA', age, dhq, pts: pts ? String(pts) : null, gp: pts ? 14 : 0, avg: pts ? String((pts/14).toFixed(1)) : null, yrsExp: Math.max(0, age - 22), isRookie: age <= 22 };
}

// ── ReconAI Simulation (what we know vs unknown) ─────────────────────

function simulateReconAIPath(ctx) {
    // What we know ReconAI receives:
    const mentality = ctx.teamTier === 'REBUILDING' ? 'rebuild' : ctx.teamTier === 'CONTENDER' || ctx.teamTier === 'ELITE' ? 'winnow' : 'balanced';

    // What we DO NOT know (blocked by CDN):
    const dhqIdentity = 'UNKNOWN - CDN BLOCKED (https://jcc100218.github.io/ReconAI/shared/dhq-ai.js)';
    const dhqContextOutput = 'UNKNOWN - CDN BLOCKED (contents of dhqContext() unknown)';

    // What we can infer from loadMentality():
    const mentalities = {
        rebuild: { mentality: 'rebuild', message: 'Rebuild mode active' },
        winnow: { mentality: 'winnow', message: 'Win-now / contending mode active' },
        balanced: { mentality: 'balanced', message: 'Balanced/crossroads mode active' }
    };

    return {
        dhqIdentity,
        dhqContextOutput,
        mentality,
        mentalities: mentalities[mentality],
        knownValues: {
            hasLeagueFormat: false,  // Does NOT receive detectLeagueFormat output
            hasSFDetection: false,
            hasQBCrisisDetection: false,
            hasTEPDetection: false,
            hasIDPDetection: false,
            hasQualityThresholds: false,
            hasFAABRules: false,
            mentalityMapping: true,
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── 12 Test Scenarios (same as ai-training-tests.js) ──────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const TESTS = [
{
    id: 'T01',
    name: 'Rebuilder in Standard 1QB — No veteran depth recs',
    type: 'fa_targets',
    ctx: {
        leagueName: 'The Gridiron',
        myOwner: 'Jacob',
        faabBudget: 180, startingBudget: 200,
        teamTier: 'REBUILDING', teamWindow: 'REBUILDING', healthScore: 32,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        myRoster: [
            mockPlayer('Bryce Young', 'QB', 24, 2800, 180, true),
            mockPlayer('Zamir White', 'RB', 25, 1200, 90, true),
            mockPlayer('Tank Bigsby', 'RB', 24, 900, 70, true),
            mockPlayer('Quentin Johnston', 'WR', 23, 1800, 110, true),
            mockPlayer('Jaxon Smith-Njigba', 'WR', 23, 3200, 160, true),
            mockPlayer('Sam LaPorta', 'TE', 24, 3500, 140, true),
        ],
        topFreeAgents: [
            mockFA('Randall Cobb', 'WR', 33, 350, 40),
            mockFA('Melvin Gordon', 'RB', 31, 280, 35),
            mockFA('Tyler Conklin', 'TE', 29, 420, 55),
            mockFA('Josh Palmer', 'WR', 25, 620, 80),
            mockFA('Jaylen Wright', 'RB', 22, 750, null),
            mockFA('Cedric Tillman', 'WR', 24, 580, 65),
            mockFA('Adam Thielen', 'WR', 34, 900, 110),
            mockFA('Zack Moss', 'RB', 28, 650, 95),
        ],
    },
    rubric: [
        { rule: 'System prompt mentions REBUILD mode', check: 'wr_system', contains: 'REBUILD MODE' },
        { rule: 'System prompt has quality threshold block', check: 'wr_system', contains: 'DHQ below 500' },
        { rule: 'FA prompt includes team tier = REBUILDING', check: 'wr_fa', contains: 'REBUILDING tier' },
        { rule: 'FA prompt has FAAB quality floor rule', check: 'wr_fa', contains: 'DHQ < 500' },
        { rule: 'REBUILD rules enforced', check: 'wr_fa', contains: 'REBUILDING teams: Only recommend young' },
    ]
},

{
    id: 'T02',
    name: 'Contender in Superflex with 1 QB — QB emergency',
    type: 'fa_targets',
    ctx: {
        leagueName: 'Dynasty Kings',
        myOwner: 'Jacob',
        faabBudget: 120, startingBudget: 200,
        teamTier: 'CONTENDER', teamWindow: 'CONTENDING', healthScore: 78,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0 },
        myRoster: [
            mockPlayer('Josh Allen', 'QB', 28, 9200, 380, true),
            mockPlayer('Saquon Barkley', 'RB', 27, 7500, 260, true),
            mockPlayer('Breece Hall', 'RB', 23, 7800, 240, true),
            mockPlayer('CeeDee Lamb', 'WR', 26, 8500, 290, true),
            mockPlayer('Garrett Wilson', 'WR', 24, 6200, 200, true),
            mockPlayer('Mark Andrews', 'TE', 29, 5100, 160, true),
        ],
        topFreeAgents: [
            mockFA('Gardner Minshew', 'QB', 28, 1200, 180),
            mockFA('Aidan OConnell', 'QB', 25, 1400, 150),
            mockFA('Tyler Allgeier', 'RB', 25, 900, 100),
        ],
    },
    rubric: [
        { rule: 'System detects SUPERFLEX', check: 'wr_system', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'QB 1.8x multiplier present', check: 'wr_system', contains: '1.8x' },
        { rule: 'FA has QB CRITICAL warning', check: 'wr_fa', contains: 'CRITICAL' },
        { rule: 'FA flags 1 starting QB in 2-slot league', check: 'wr_fa', contains: '1 starting QB' },
    ]
},

{
    id: 'T03',
    name: 'TE Premium League — TE scarcity detection',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0, bonus_rec_te: 0.5 },
        teamTier: 'CROSSROADS', teamWindow: 'TRANSITIONING', healthScore: 55,
    },
    rubric: [
        { rule: 'System detects TE PREMIUM', check: 'wr_system', contains: 'TE PREMIUM LEAGUE' },
        { rule: 'Shows +0.5 bonus', check: 'wr_system', contains: '+0.5 bonus PPR' },
        { rule: 'TE scarcity multiplier 1.5x', check: 'wr_system', contains: '1.5x' },
    ]
},

{
    id: 'T04',
    name: 'IDP League — defensive starter slots detected',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','DL','LB','LB','DB','DB','BN','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        teamTier: 'CONTENDER', teamWindow: 'CONTENDING', healthScore: 82,
    },
    rubric: [
        { rule: 'System detects IDP', check: 'wr_system', contains: 'IDP LEAGUE' },
        { rule: 'Shows defensive starter slots', check: 'wr_system', contains: 'defensive starter slots' },
    ]
},

{
    id: 'T05',
    name: 'Superflex + TEP combo — dual format detection',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0, bonus_rec_te: 1.0 },
        teamTier: 'ELITE', teamWindow: 'CONTENDING', healthScore: 94,
    },
    rubric: [
        { rule: 'SUPERFLEX detected', check: 'wr_system', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'TE PREMIUM detected', check: 'wr_system', contains: 'TE PREMIUM LEAGUE' },
    ]
},

{
    id: 'T06',
    name: 'Standard 1QB half-PPR — clean baseline',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        teamTier: 'CONTENDER', teamWindow: 'CONTENDING', healthScore: 75,
    },
    rubric: [
        { rule: 'No SUPERFLEX false positive', check: 'wr_system', notContains: 'SUPERFLEX' },
        { rule: 'No TE PREMIUM false positive', check: 'wr_system', notContains: 'TE PREMIUM' },
        { rule: 'HALF PPR detected', check: 'wr_system', contains: 'HALF PPR' },
    ]
},

{
    id: 'T07',
    name: 'Rebuilder with weak FA pool — AI should say HOLD FAAB',
    type: 'fa_targets',
    ctx: {
        leagueName: 'Bottom Feeders',
        myOwner: 'Jacob',
        faabBudget: 195, startingBudget: 200,
        teamTier: 'REBUILDING', teamWindow: 'REBUILDING', healthScore: 25,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        myRoster: [
            mockPlayer('Will Levis', 'QB', 25, 1500, 140, true),
            mockPlayer('Jaylen Warren', 'RB', 26, 1100, 80, true),
            mockPlayer('Roschon Johnson', 'RB', 24, 600, 45, true),
        ],
        topFreeAgents: [
            mockFA('Ty Johnson', 'RB', 31, 120, 15),
            mockFA('Kendrick Bourne', 'WR', 30, 250, 30),
            mockFA('Durham Smythe', 'TE', 30, 180, 20),
        ],
    },
    rubric: [
        { rule: 'All FAs have DHQ < 500', check: 'wr_fa', contains: 'DHQ 120' },
        { rule: 'FA has HOLD FAAB instruction', check: 'wr_fa', contains: 'HOLD YOUR FAAB' },
        { rule: 'REBUILD mode active', check: 'wr_fa', contains: 'REBUILDING' },
    ]
},

{
    id: 'T08',
    name: 'Contender with 2 QBs in Superflex — NO QB crisis',
    type: 'fa_targets',
    ctx: {
        leagueName: 'QB Factory',
        myOwner: 'Jacob',
        faabBudget: 100, startingBudget: 200,
        teamTier: 'ELITE', teamWindow: 'CONTENDING', healthScore: 91,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0 },
        myRoster: [
            mockPlayer('Patrick Mahomes', 'QB', 29, 9800, 400, true),
            mockPlayer('Jalen Hurts', 'QB', 27, 9200, 380, true),
            mockPlayer('Bijan Robinson', 'RB', 23, 9000, 280, true),
            mockPlayer('Ja\'Marr Chase', 'WR', 25, 9500, 310, true),
        ],
        topFreeAgents: [
            mockFA('Bailey Zappe', 'QB', 25, 400, 30),
        ],
    },
    rubric: [
        { rule: 'SUPERFLEX in system', check: 'wr_system', contains: 'SUPERFLEX' },
        { rule: 'No QB crisis (has 2 QBs)', check: 'wr_fa', notContains: '#1 PRIORITY' },
    ]
},

{
    id: 'T09',
    name: 'RB Scarcity detection — 2 RB slots fires warning',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','WR','TE','FLEX','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        teamTier: 'CONTENDER', teamWindow: 'CONTENDING', healthScore: 80,
    },
    rubric: [
        { rule: 'RB SCARCITY flag fires', check: 'wr_system', contains: 'RB SCARCITY' },
    ]
},

{
    id: 'T10',
    name: 'No league format in context — graceful fallback',
    type: 'system_only',
    ctx: {},
    rubric: [
        { rule: 'No SUPERFLEX false positive', check: 'wr_system', notContains: 'SUPERFLEX' },
        { rule: 'Quality thresholds present', check: 'wr_system', contains: 'DHQ below 500' },
    ]
},

{
    id: 'T11',
    name: 'Superflex REBUILDER with 1 QB — QB crisis PLUS rebuild rules',
    type: 'fa_targets',
    ctx: {
        leagueName: 'SF Dynasty',
        myOwner: 'Jacob',
        faabBudget: 200, startingBudget: 200,
        teamTier: 'REBUILDING', teamWindow: 'REBUILDING', healthScore: 28,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0 },
        myRoster: [
            mockPlayer('Drake Maye', 'QB', 22, 3200, 200, true),
            mockPlayer('Bucky Irving', 'RB', 22, 1800, 100, true),
            mockPlayer('Rome Odunze', 'WR', 23, 2400, 120, true),
        ],
        topFreeAgents: [
            mockFA('Jacoby Brissett', 'QB', 32, 600, 120),
            mockFA('Bo Nix', 'QB', 24, 1800, 170),
            mockFA('Tyrone Tracy', 'RB', 23, 800, 80),
        ],
    },
    rubric: [
        { rule: 'SUPERFLEX detected', check: 'wr_system', contains: 'SUPERFLEX' },
        { rule: 'REBUILD mode active', check: 'wr_system', contains: 'REBUILD MODE' },
        { rule: 'QB crisis flagged', check: 'wr_fa', contains: 'CRITICAL' },
        { rule: 'QB is #1 priority', check: 'wr_fa', contains: '#1 PRIORITY' },
    ]
},

{
    id: 'T12',
    name: 'IDP + TEP + Superflex — all three formats',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','WR','TE','FLEX','SUPER_FLEX','DL','LB','LB','DB','BN','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0, bonus_rec_te: 0.5 },
        teamTier: 'REBUILDING', teamWindow: 'REBUILDING', healthScore: 30,
    },
    rubric: [
        { rule: 'SUPERFLEX detected', check: 'wr_system', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'TE PREMIUM detected', check: 'wr_system', contains: 'TE PREMIUM LEAGUE' },
        { rule: 'IDP detected', check: 'wr_system', contains: 'IDP LEAGUE' },
        { rule: 'REBUILD mode active', check: 'wr_system', contains: 'REBUILD MODE' },
    ]
},
];

// ═══════════════════════════════════════════════════════════════════════════
// ── Test Runner ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function runTest(test) {
    const results = { id: test.id, name: test.name, warRoom: { checks: [], pass: 0, fail: 0 }, reconai: { checks: [], pass: 0, fail: 0, gaps: [] } };

    // War Room path
    const wrSystemPrompt = buildSystemPrompt(test.ctx);
    const wrFAPrompt = test.type === 'fa_targets' ? buildFATargetsPrompt(test.ctx) : null;

    // ReconAI path (simulated)
    const reconaiPath = simulateReconAIPath(test.ctx);

    // Grade War Room path
    for (const r of test.rubric) {
        if (r.check.startsWith('wr_')) {
            const target = r.check === 'wr_system' ? wrSystemPrompt : wrFAPrompt;
            if (!target && r.check === 'wr_fa') {
                results.warRoom.checks.push({ rule: r.rule, status: 'SKIP', reason: 'No FA prompt for this test type' });
                continue;
            }

            let passed = false;
            let detail = '';

            if (r.contains) {
                passed = target.includes(r.contains);
                detail = passed ? `Found` : `MISSING`;
            } else if (r.notContains) {
                passed = !target.includes(r.notContains);
                detail = passed ? `Correctly absent` : `UNWANTED`;
            }

            if (passed) results.warRoom.pass++;
            else results.warRoom.fail++;

            results.warRoom.checks.push({ rule: r.rule, status: passed ? 'PASS' : 'FAIL', detail });
        }
    }

    // Grade ReconAI path
    for (const r of test.rubric) {
        if (r.check.startsWith('wr_')) {
            // Map War Room checks to ReconAI capability gaps
            let status = 'UNKNOWN';
            let reason = '';

            if (r.contains === 'REBUILD MODE' || r.contains === 'REBUILD') {
                if (reconaiPath.knownValues.mentalityMapping) {
                    status = 'LIKELY PASS';
                    reason = 'Mentality="rebuild" sent, but no detailed REBUILD RULES visible';
                } else {
                    status = 'LIKELY FAIL';
                    reason = 'Mentality mapping unavailable';
                }
            } else if (r.contains === 'CONTENDING' || r.contains === 'ELITE') {
                if (reconaiPath.knownValues.mentalityMapping) {
                    status = 'LIKELY PASS';
                    reason = 'Mentality="winnow" sent to dhqAI';
                } else {
                    status = 'LIKELY FAIL';
                    reason = 'Mentality mapping unavailable';
                }
            } else if (r.contains === 'SUPERFLEX' || r.contains === 'SUPERFLEX LEAGUE') {
                status = 'LIKELY FAIL';
                reason = 'ReconAI does NOT receive league format detection output';
                results.reconai.gaps.push({ category: 'League Format', detail: 'SUPERFLEX detection missing' });
            } else if (r.contains === 'TE PREMIUM' || r.contains === 'TE PREMIUM LEAGUE') {
                status = 'LIKELY FAIL';
                reason = 'ReconAI does NOT receive TE Premium detection';
                results.reconai.gaps.push({ category: 'League Format', detail: 'TE Premium detection missing' });
            } else if (r.contains === 'IDP LEAGUE' || r.contains === 'defensive starter slots') {
                status = 'LIKELY FAIL';
                reason = 'ReconAI does NOT receive IDP detection';
                results.reconai.gaps.push({ category: 'League Format', detail: 'IDP detection missing' });
            } else if (r.contains === '1.8x' || r.contains === '1.5x') {
                status = 'LIKELY FAIL';
                reason = 'Scarcity multipliers not in ReconAI path';
                results.reconai.gaps.push({ category: 'Scarcity Context', detail: 'Position scarcity multipliers missing' });
            } else if (r.contains === '#1 PRIORITY' && r.contains.includes('QB')) {
                status = 'LIKELY FAIL';
                reason = 'ReconAI does NOT have QB crisis detection logic';
                results.reconai.gaps.push({ category: 'SF QB Protocol', detail: 'QB crisis detection missing' });
            } else if (r.contains === 'DHQ below 500' || r.contains === 'HOLD YOUR FAAB' || r.contains === 'DHQ < 500') {
                status = 'LIKELY FAIL';
                reason = 'ReconAI does NOT have quality thresholds or FAAB discipline rules';
                results.reconai.gaps.push({ category: 'Quality Thresholds', detail: 'DHQ/quality floor rules missing' });
            } else if (r.contains === 'RB SCARCITY') {
                status = 'LIKELY FAIL';
                reason = 'Positional scarcity logic not in ReconAI';
                results.reconai.gaps.push({ category: 'Scarcity Context', detail: 'RB scarcity detection missing' });
            } else if (r.notContains) {
                status = 'LIKELY PASS';
                reason = 'False positive avoidance likely works (mentality mapping)';
            } else {
                status = 'UNKNOWN';
                reason = 'Insufficient data to assess';
            }

            results.reconai.checks.push({ rule: r.rule, status, reason });
        }
    }

    return { results, wrSystemPrompt, wrFAPrompt, reconaiPath };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Execute & Report ──────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════');
console.log('  WAR ROOM vs RECONAI — CONSISTENCY TEST SUITE');
console.log('  ' + new Date().toISOString());
console.log('═══════════════════════════════════════════════════════════════\n');

let wrTotalPass = 0, wrTotalFail = 0, reconaiUnknown = 0, reconaiLikelyFail = 0, reconaiLikelyPass = 0;
const allGaps = {};
const allOutputs = [];

for (const test of TESTS) {
    const { results, wrSystemPrompt, wrFAPrompt, reconaiPath } = runTest(test);
    wrTotalPass += results.warRoom.pass;
    wrTotalFail += results.warRoom.fail;

    // Count ReconAI outcomes
    for (const check of results.reconai.checks) {
        if (check.status === 'LIKELY FAIL') reconaiLikelyFail++;
        else if (check.status === 'LIKELY PASS') reconaiLikelyPass++;
        else if (check.status === 'UNKNOWN') reconaiUnknown++;
    }

    // Collect gaps
    for (const gap of results.reconai.gaps) {
        if (!allGaps[gap.category]) allGaps[gap.category] = [];
        allGaps[gap.category].push({ test: test.id, detail: gap.detail });
    }

    // Print test result
    const wrIcon = results.warRoom.fail === 0 ? 'PASS' : 'FAIL';
    const reconaiIcon = reconaiLikelyFail > 0 ? 'GAPS' : 'OK';
    console.log(`[${wrIcon}] [${reconaiIcon}] ${results.id}: ${results.name}`);

    for (const c of results.warRoom.checks) {
        const ci = c.status === 'PASS' ? '✓' : c.status === 'FAIL' ? '✗' : '○';
        console.log(`  WR  ${ci} ${c.rule}`);
    }

    for (const c of results.reconai.checks.slice(0, 3)) {
        const ci = c.status === 'LIKELY PASS' ? '✓' : c.status === 'LIKELY FAIL' ? '✗' : '?';
        console.log(`  RAI ${ci} ${c.rule}`);
        if (c.reason && c.status !== 'LIKELY PASS') console.log(`      └─ ${c.reason}`);
    }
    console.log('');

    allOutputs.push({ id: results.id, name: results.name, results, wrSystemPrompt, wrFAPrompt });
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  WAR ROOM TOTAL: ' + wrTotalPass + ' PASS, ' + wrTotalFail + ' FAIL');
console.log('  RECONAI OUTCOMES:');
console.log('    • ' + reconaiLikelyPass + ' likely passing');
console.log('    • ' + reconaiLikelyFail + ' likely failing');
console.log('    • ' + reconaiUnknown + ' unknown');
console.log('═══════════════════════════════════════════════════════════════\n');

// Print gap summary
console.log('═══════════════════════════════════════════════════════════════');
console.log('  RECONAI vs WAR ROOM — FEATURE GAP ANALYSIS');
console.log('═══════════════════════════════════════════════════════════════\n');

const categories = [
    'League Format',
    'Quality Thresholds',
    'Scarcity Context',
    'SF QB Protocol',
    'FAAB Discipline',
    'Team Mode Rules'
];

for (const cat of categories) {
    if (allGaps[cat]) {
        console.log(`[${cat}]`);
        const unique = [...new Set(allGaps[cat].map(g => g.detail))];
        for (const detail of unique) {
            const tests = allGaps[cat].filter(g => g.detail === detail).map(g => g.test);
            console.log(`  • ${detail}`);
            console.log(`    Affects tests: ${tests.join(', ')}`);
        }
        console.log('');
    }
}

console.log('═══════════════════════════════════════════════════════════════');
console.log('  SUMMARY: ReconAI is missing critical context from War Room');
console.log('═══════════════════════════════════════════════════════════════\n');

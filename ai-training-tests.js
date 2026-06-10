#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// War Room AI Training Program — Prompt Simulation Test Harness
// Ports the TypeScript prompt builders to plain JS, runs 12 mock scenarios,
// and grades each output against a rubric of required/forbidden strings.
// ═══════════════════════════════════════════════════════════════════════════

// ── Ported prompt-building functions (from ai-analyze/index.ts) ─────────

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

function buildPartnerModeBlock(partner) {
    if (!partner) return '';
    const tier = String(partner.tier || partner.teamTier || '').toUpperCase();
    const win = String(partner.window || partner.teamWindow || partner.tradeWindow || '').toUpperCase();
    if (!tier && !win) return '';
    const lines = [];
    lines.push(`\n═══ TRADE PARTNER MODE (what the OTHER side actually values) ═══`);
    const label = partner.owner ? `${partner.owner} ` : '';
    if (tier === 'REBUILDING' || win === 'REBUILDING') {
        lines.push(`🔨 ${label}is REBUILDING. They value: draft picks (1sts/2nds above all), players aged ≤24 with upside, cap/FAAB flexibility.`);
        lines.push(`  → They will NOT pay fair value for veterans aged 27+. Do not frame aging assets as the centerpiece of an offer to them.`);
        lines.push(`  → Offers built around picks and youth get accepted; offers built around "proven producers" get rejected or lowballed.`);
    } else if (tier === 'ELITE' || tier === 'CONTENDER' || win === 'CONTENDING') {
        lines.push(`🏆 ${label}is CONTENDING. They value: proven starters who help THIS season, immediate positional upgrades.`);
        lines.push(`  → They will pay a premium (including future picks) for win-now talent at a position of need.`);
        lines.push(`  → They will NOT value speculative youth or distant picks at full price — those are your acquisition discounts, not selling points.`);
    } else {
        lines.push(`⚖️ ${label}is at a CROSSROADS. They are deciding between pushing and tearing down — offers that decisively help either path land better than balanced "depth" swaps.`);
    }
    lines.push(`═══════════════════════════════════════════════════════════════════════════════════════\n`);
    return lines.join('\n');
}

function formatDealSide(side) {
    if (!side) return '  (nothing)';
    const parts = [];
    for (const p of side.players || []) {
        parts.push(`  ${p.pos || '?'} ${p.name}${p.age ? ` | Age ${p.age}` : ''}${p.value != null ? ` | Value ${p.value}` : ''}`);
    }
    for (const pk of side.picks || []) {
        parts.push(`  PICK ${pk.year || '?'} Round ${pk.round || '?'}${pk.value != null ? ` | Value ${pk.value}` : ''}`);
    }
    if (side.faab) parts.push(`  FAAB $${side.faab}`);
    return parts.join('\n') || '  (nothing)';
}

function buildTradeVerdictPrompt(ctx) {
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const my = ctx.myTeam || {};
    const partner = ctx.partnerTeam || {};
    const myModeBlock = buildTeamModeBlock({ teamTier: my.tier, teamWindow: my.window || my.tradeWindow, healthScore: my.healthScore });
    const partnerBlock = buildPartnerModeBlock(partner);
    const v = ctx.verdict || {};
    return `Give a second opinion on this dynasty trade in **${ctx.leagueName || 'my league'}**. My deterministic trade calculator already graded it — your job is an independent verdict that weighs context the math can't see (mode fit, market psychology, league format leverage). If you disagree with the calculator, SAY SO explicitly and explain why.\n${fmtBlock}${myModeBlock}${partnerBlock}\n**I SEND (leaves my roster):**\n${formatDealSide(ctx.iSend)}\n\n**I RECEIVE (joins my roster):**\n${formatDealSide(ctx.iReceive)}\n\n**MY TEAM:** ${my.record || '?'} | ${my.tier || '?'} | Health: ${my.healthScore ?? '?'}/100\nMy Needs: ${(my.needs || []).join(', ') || 'none identified'} | My Strengths: ${(my.strengths || []).join(', ') || 'none identified'}\n**PARTNER (${partner.owner || 'other owner'}):** ${partner.record || '?'} | ${partner.tier || '?'} | DNA: ${partner.dna || 'Unknown'} | Posture: ${partner.posture || 'N/A'}\nTheir Needs: ${(partner.needs || []).join(', ') || 'none identified'}\n\n**CALCULATOR VERDICT:** ${v.verdictText || 'n/a'} | Value diff: ${v.diffDisplay ?? 'n/a'} | Acceptance likelihood: ${v.likelihood ?? 'n/a'}${v.psychNotes ? ` | Behavioral notes: ${v.psychNotes}` : ''}\n\nVERDICT RULES (strictly enforce):\n1. Judge the deal through MY team mode first — a "fair value" trade that fights my rebuild/contend direction is a BAD trade for me.\n2. Apply league format premiums (superflex QB 1.8x, TEP TE 1.5x) to both sides before comparing.\n3. Factor the partner's mode: if this deal gives them exactly what their mode craves, I should extract more.\n4. Be honest about the calculator: agree, or disagree with a concrete reason. Never hedge with "it depends" as the final answer.\n\nRespond in under 500 words with exactly these sections:\n**VERDICT** — ACCEPT, REJECT, or COUNTER (one of the three, first word)\n**WHY** — 2-4 sentences, the decisive factors\n**MODE FIT** — How this deal serves or fights my competitive mode and the league format\n**WHAT I'D COUNTER WITH** — Only if COUNTER/REJECT: the specific adjusted package and why the partner's mode/DNA says yes`;
}

function buildTeamDiagnosisPrompt(ctx) {
    const fmt = detectLeagueFormat(ctx);
    const fmtBlock = buildLeagueFormatBlock(fmt);
    const modeBlock = buildTeamModeBlock(ctx);
    const rosterStr = (ctx.myRoster || []).map(p =>
        `  ${p.pos} ${p.name}${p.age ? ` | Age ${p.age}` : ''}${p.value != null ? ` | Value ${p.value}` : p.dhq != null ? ` | DHQ ${p.dhq}` : ''}${p.isStarter ? ' [STARTER]' : ''}`
    ).join('\n');
    let sfQBNote = '';
    if (fmt.isSuperFlex) {
        const startableQBs = (ctx.myRoster || []).filter(p => p.pos === 'QB' && (Number(p.value ?? p.dhq) || 0) >= 2000).length;
        if (startableQBs < fmt.numQBSlots) {
            sfQBNote = `\n⚠️ SUPERFLEX QB CRISIS: only ${startableQBs} startable QB(s) for ${fmt.numQBSlots} QB-eligible slots. QB acquisition MUST be the #1 prescription regardless of other needs.\n`;
        }
    }
    return `Diagnose **${ctx.myOwner || 'my'}** team in **${ctx.leagueName || 'this league'}**. Be direct and specific — this is a strategic check-up, not a pep talk.\n${fmtBlock}${modeBlock}${sfQBNote}\n**TEAM STATUS:** ${ctx.record || '?'} | ${ctx.teamTier || ctx.tier || '?'} tier | Health: ${ctx.healthScore ?? '?'}/100 | Window: ${ctx.teamWindow || ctx.tradeWindow || '?'}\n**STATED NEEDS:** ${(ctx.needs || []).join(', ') || 'none identified'}\n**STATED STRENGTHS:** ${(ctx.strengths || []).join(', ') || 'none identified'}\n**GM STRATEGY NOTES:** ${ctx.gmStrategy || ctx.mentality || 'none provided'}\n\n**ROSTER:**\n${rosterStr || 'No roster data'}\n\nRespond in under 350 words with exactly these sections:\n**DIAGNOSIS** — 2-3 sentences: what this team actually is right now\n**ROOT CAUSES** — The structural reasons (age curve, positional gaps, pick capital), not symptoms\n**PRESCRIPTION** — Exactly 3 concrete moves, each aligned with the team mode above. No generic "add depth" advice.\n**MODE CHECK** — One sentence: is the owner's current strategy consistent with what the roster says, or should they change course?`;
}

function describeSubject(subject) {
    if (!subject || typeof subject !== 'object') return '';
    const parts = ['player', 'pos', 'age', 'moveType', 'title']
        .map(k => subject[k])
        .filter(v => v !== null && v !== undefined && v !== '');
    return parts.join(' ').slice(0, 90);
}

function buildUserPreferenceBlock(prefs) {
    if (!prefs || !prefs.total) return '';
    const lines = [];
    lines.push(`\n═══ USER PREFERENCE PROFILE (learned from this owner's reactions to past AI advice) ═══`);
    const accept = prefs.acceptRate != null ? Math.round(Number(prefs.acceptRate) * 100) : null;
    lines.push(`Feedback on ${prefs.total} recommendations in the last 90 days${accept != null ? ` — ${accept}% positively received` : ''}.`);
    const sc = prefs.surfaceCounts || {};
    const downSurfaces = Object.entries(sc)
        .filter(([, c]) => Number(c?.down || 0) > Number(c?.up || 0) + Number(c?.acted || 0))
        .map(([s]) => s);
    if (downSurfaces.length) {
        lines.push(`They frequently reject ${downSurfaces.join(', ')} advice — only repeat a previously rejected framing when the evidence is overwhelming, and acknowledge the change.`);
    }
    const actedSurfaces = Object.entries(sc)
        .filter(([, c]) => Number(c?.acted || 0) > 0)
        .map(([s]) => s);
    if (actedSurfaces.length) {
        lines.push(`They have acted on ${actedSurfaces.join(', ')} recommendations before — these carry weight, so be precise.`);
    }
    const downs = (prefs.recentDownSubjects || []).map(describeSubject).filter(Boolean).slice(0, 3);
    if (downs.length) lines.push(`Recently rejected: ${downs.join(' | ')}. Do not re-pitch these unless circumstances changed.`);
    const acted = (prefs.recentActedSubjects || []).map(describeSubject).filter(Boolean).slice(0, 3);
    if (acted.length) lines.push(`Recently acted on: ${acted.join(' | ')}. Similar profiles resonate with this owner.`);
    lines.push(`These are tendencies, not rules — quality thresholds and team-mode rules above ALWAYS take precedence.`);
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
    return `You are an elite dynasty fantasy football analyst…\n${fmtBlock}${modeBlock}${qualityBlock}\nCRITICAL RULES:\n1. Never recommend a rebuilding team acquire aging veterans for "depth"\n2. Never recommend spending FAAB on replacement-level players (DHQ < 500, PPG < 5.0)\n3. In superflex leagues, ALWAYS flag QB needs as the top priority if a team lacks 2 starters\n4. In TE premium leagues, value elite TEs 1.5x higher than standard leagues\n5. "Add depth" is only valid advice for CONTENDING teams`;
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

// ═══════════════════════════════════════════════════════════════════════════
// ── Mock Roster/FA Factories ─────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function mockPlayer(name, pos, age, dhq, pts, isStarter=false) {
    return { name, pos, team: 'NYJ', age, dhq, pts: pts ? String(pts) : null, gp: pts ? 16 : 0, avg: pts ? String((pts/16).toFixed(1)) : null, yrsExp: Math.max(0, age - 22), isStarter, isTaxi: false };
}

function mockFA(name, pos, age, dhq, pts) {
    return { name, pos, team: 'FA', age, dhq, pts: pts ? String(pts) : null, gp: pts ? 14 : 0, avg: pts ? String((pts/14).toFixed(1)) : null, yrsExp: Math.max(0, age - 22), isRookie: age <= 22 };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── 12 Test Scenarios ────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

const TESTS = [

// ─── TEST 1: Rebuilder in Standard 1QB — Should NOT get veteran depth recs ───
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
            mockFA('Randall Cobb', 'WR', 33, 350, 40),     // Crappy old WR
            mockFA('Melvin Gordon', 'RB', 31, 280, 35),     // Washed RB
            mockFA('Tyler Conklin', 'TE', 29, 420, 55),     // Mediocre old TE
            mockFA('Josh Palmer', 'WR', 25, 620, 80),       // Decent young WR
            mockFA('Jaylen Wright', 'RB', 22, 750, null),   // Young upside rookie
            mockFA('Cedric Tillman', 'WR', 24, 580, 65),    // Young upside
            mockFA('Adam Thielen', 'WR', 34, 900, 110),     // Good but OLD
            mockFA('Zack Moss', 'RB', 28, 650, 95),         // Decent but 28
        ],
    },
    systemChecks: {
        mustContain: ['REBUILD', 'YOUTH', 'FAAB RESTRAINT', 'DHQ below 500'],
        mustNotContain: [],
    },
    faPromptChecks: {
        mustContain: ['REBUILDING', 'FAAB RECOMMENDATION RULES', 'QUALITY FLOOR'],
        mustNotContain: [],
    },
    rubric: [
        { rule: 'System prompt mentions REBUILD mode', check: 'system', contains: 'REBUILD MODE' },
        { rule: 'System prompt has quality threshold block', check: 'system', contains: 'DHQ below 500' },
        { rule: 'FA prompt includes team tier = REBUILDING', check: 'fa', contains: 'REBUILDING tier' },
        { rule: 'FA prompt has FAAB quality floor rule', check: 'fa', contains: 'DHQ < 500' },
        { rule: 'FA prompt has team mode FAAB rules', check: 'fa', contains: 'REBUILDING teams: Only recommend young' },
        { rule: 'Cobb (DHQ 350) listed but AI told not to recommend DHQ<500', check: 'fa', contains: 'DHQ 350' },
        { rule: 'Gordon (DHQ 280) listed but below quality floor', check: 'fa', contains: 'DHQ 280' },
        { rule: 'Wright (age 22 rookie) is in the FA data', check: 'fa', contains: 'Jaylen Wright' },
    ],
},

// ─── TEST 2: Contender in Superflex with 1 QB — QB must be #1 priority ───
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
            // NO SECOND QB — this is the crisis
            mockPlayer('Saquon Barkley', 'RB', 27, 7500, 260, true),
            mockPlayer('Breece Hall', 'RB', 23, 7800, 240, true),
            mockPlayer('CeeDee Lamb', 'WR', 26, 8500, 290, true),
            mockPlayer('Garrett Wilson', 'WR', 24, 6200, 200, true),
            mockPlayer('Mark Andrews', 'TE', 29, 5100, 160, true),
        ],
        topFreeAgents: [
            mockFA('Gardner Minshew', 'QB', 28, 1200, 180),  // Startable QB
            mockFA('Aidan OConnell', 'QB', 25, 1400, 150),   // Young QB
            mockFA('Tyler Allgeier', 'RB', 25, 900, 100),    // Decent RB
            mockFA('Jahan Dotson', 'WR', 24, 700, 75),       // Depth WR
            mockFA('Mike Gesicki', 'TE', 29, 600, 70),       // Depth TE
        ],
    },
    systemChecks: {
        mustContain: ['SUPERFLEX', 'QB scarcity multiplier: 1.8x', 'CONTENDING'],
    },
    faPromptChecks: {
        mustContain: ['CRITICAL', 'starting QB', 'QB acquisition is the #1 PRIORITY'],
    },
    rubric: [
        { rule: 'System prompt detects SUPERFLEX', check: 'system', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'System prompt has QB 1.8x multiplier', check: 'system', contains: '1.8x' },
        { rule: 'System prompt shows CONTENDING mode', check: 'system', contains: 'CONTENDING' },
        { rule: 'FA prompt has QB CRITICAL warning', check: 'fa', contains: 'CRITICAL' },
        { rule: 'FA prompt flags only 1 starting QB', check: 'fa', contains: '1 starting QB' },
        { rule: 'FA prompt says QB is #1 PRIORITY', check: 'fa', contains: '#1 PRIORITY' },
        { rule: 'FA prompt lists Minshew as available QB', check: 'fa', contains: 'Gardner Minshew' },
        { rule: 'Full PPR scoring noted', check: 'system', contains: 'FULL PPR' },
    ],
},

// ─── TEST 3: TE Premium League, any mode — TE scarcity flagged ───
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
        { rule: 'System prompt detects TE PREMIUM', check: 'system', contains: 'TE PREMIUM LEAGUE' },
        { rule: 'Shows +0.5 bonus', check: 'system', contains: '+0.5 bonus PPR' },
        { rule: 'Shows total 1.5 PPR', check: 'system', contains: '1.5 PPR for TE' },
        { rule: 'TE scarcity multiplier 1.5x', check: 'system', contains: '1.5x' },
        { rule: 'CROSSROADS mode detected', check: 'system', contains: 'CROSSROADS' },
        { rule: 'Full PPR also noted', check: 'system', contains: 'FULL PPR' },
    ],
},

// ─── TEST 4: IDP League — defensive slots flagged ───
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
        { rule: 'System prompt detects IDP', check: 'system', contains: 'IDP LEAGUE' },
        { rule: 'Shows 5 defensive starter slots', check: 'system', contains: '5 defensive starter slots' },
        { rule: 'LB/DL/DB mentioned as valuable', check: 'system', contains: 'LB/DL/DB have real fantasy value' },
        { rule: 'Half PPR detected', check: 'system', contains: 'HALF PPR' },
        { rule: 'CONTENDING mode active', check: 'system', contains: 'CONTENDING' },
    ],
},

// ─── TEST 5: Superflex + TEP combo — both flags fire ───
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
        { rule: 'SUPERFLEX detected', check: 'system', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'TE PREMIUM detected', check: 'system', contains: 'TE PREMIUM LEAGUE' },
        { rule: '+1.0 bonus shown', check: 'system', contains: '+1 bonus PPR' },
        { rule: 'Total 2.0 PPR for TE', check: 'system', contains: '2.0 PPR for TE' },
        { rule: 'ELITE tier contending', check: 'system', contains: 'ELITE tier' },
        { rule: 'QB 1.8x multiplier present', check: 'system', contains: '1.8x' },
        { rule: 'TE 1.5x multiplier present', check: 'system', contains: '1.5x' },
    ],
},

// ─── TEST 6: Standard 1QB, no special format — clean baseline ───
{
    id: 'T06',
    name: 'Standard 1QB half-PPR — no format flags, clean baseline',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        teamTier: 'CONTENDER', teamWindow: 'CONTENDING', healthScore: 75,
    },
    rubric: [
        { rule: 'No SUPERFLEX flag', check: 'system', notContains: 'SUPERFLEX' },
        { rule: 'No TE PREMIUM flag', check: 'system', notContains: 'TE PREMIUM' },
        { rule: 'No IDP flag', check: 'system', notContains: 'IDP LEAGUE' },
        { rule: 'HALF PPR detected', check: 'system', contains: 'HALF PPR' },
        { rule: 'CONTENDING mode present', check: 'system', contains: 'CONTENDING' },
        { rule: 'Quality thresholds still present', check: 'system', contains: 'DHQ below 500' },
        { rule: 'RB SCARCITY fires (2 RB slots)', check: 'system', contains: 'RB SCARCITY' },
    ],
},

// ─── TEST 7: Rebuilder FAAB — weak FA pool, should say "hold" ───
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
            mockFA('Ty Johnson', 'RB', 31, 120, 15),        // Garbage
            mockFA('Kendrick Bourne', 'WR', 30, 250, 30),   // Garbage
            mockFA('Durham Smythe', 'TE', 30, 180, 20),     // Garbage
            mockFA('Brandon Powell', 'WR', 29, 200, 25),    // Garbage
            mockFA('Dare Ogunbowale', 'RB', 30, 150, 18),   // Garbage
        ],
    },
    rubric: [
        { rule: 'All FAs have DHQ < 500 (below quality floor)', check: 'fa', contains: 'DHQ 120' },
        { rule: 'FA prompt has HOLD FAAB instruction', check: 'fa', contains: 'HOLD YOUR FAAB' },
        { rule: 'FA prompt has "pool is weak, SAY SO" rule', check: 'fa', contains: 'available player pool is weak, SAY SO' },
        { rule: 'REBUILD mode active in FA prompt', check: 'fa', contains: 'REBUILDING' },
        { rule: 'No FA exceeds quality threshold — AI should see this', check: 'fa', contains: 'DHQ < 500' },
    ],
},

// ─── TEST 8: Contender with 2 QBs in SF — no QB crisis flag ───
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
            mockFA('KJ Osborn', 'WR', 26, 520, 65),
        ],
    },
    rubric: [
        { rule: 'SUPERFLEX detected in system', check: 'system', contains: 'SUPERFLEX' },
        { rule: 'NO QB crisis warning (team has 2 starting QBs)', check: 'fa', notContains: 'QB acquisition is the #1 PRIORITY' },
        { rule: 'ELITE contending mode', check: 'system', contains: 'ELITE tier' },
    ],
},

// ─── TEST 9: RB scarcity — 2 RB slots + FLEX should trigger ───
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
        { rule: 'RB SCARCITY flag fires', check: 'system', contains: 'RB SCARCITY' },
        { rule: 'Shows 2 dedicated RB slots', check: 'system', contains: '2 dedicated RB slots' },
    ],
},

// ─── TEST 10: No context passed — graceful fallback ───
{
    id: 'T10',
    name: 'No league format in context — graceful fallback',
    type: 'system_only',
    ctx: {
        // No rosterPositions, no scoringSettings, no teamTier
    },
    rubric: [
        { rule: 'No SUPERFLEX false positive', check: 'system', notContains: 'SUPERFLEX' },
        { rule: 'No TE PREMIUM false positive', check: 'system', notContains: 'TE PREMIUM' },
        { rule: 'No IDP false positive', check: 'system', notContains: 'IDP LEAGUE' },
        { rule: 'No team mode block (no tier)', check: 'system', notContains: 'REBUILD MODE' },
        { rule: 'Quality thresholds still present', check: 'system', contains: 'DHQ below 500' },
        { rule: 'Critical rules still present', check: 'system', contains: 'CRITICAL RULES' },
    ],
},

// ─── TEST 11: Superflex rebuilder with 1 QB — QB crisis + rebuild combo ───
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
            // Only 1 QB in superflex — crisis, but they're rebuilding
            mockPlayer('Bucky Irving', 'RB', 22, 1800, 100, true),
            mockPlayer('Rome Odunze', 'WR', 23, 2400, 120, true),
        ],
        topFreeAgents: [
            mockFA('Jacoby Brissett', 'QB', 32, 600, 120),    // Old QB — rebuilder should avoid
            mockFA('Bo Nix', 'QB', 24, 1800, 170),             // Young QB — good for rebuild
            mockFA('Tyrone Tracy', 'RB', 23, 800, 80),         // Young RB
            mockFA('Parker Washington', 'WR', 23, 450, 40),    // Below quality floor
        ],
    },
    rubric: [
        { rule: 'SUPERFLEX detected', check: 'system', contains: 'SUPERFLEX' },
        { rule: 'REBUILD mode active', check: 'system', contains: 'REBUILD MODE' },
        { rule: 'QB crisis flagged (1 QB in SF)', check: 'fa', contains: 'CRITICAL' },
        { rule: 'QB is #1 priority despite rebuild', check: 'fa', contains: '#1 PRIORITY' },
        { rule: 'Bo Nix (young QB) in FA data', check: 'fa', contains: 'Bo Nix' },
        { rule: 'Brissett (age 32) in data — rebuild rules should deprioritize', check: 'fa', contains: 'Age 32' },
        { rule: 'Washington (DHQ 450) below quality floor', check: 'fa', contains: 'DHQ 450' },
        { rule: 'FAAB RESTRAINT rule present for rebuilders', check: 'fa', contains: 'REBUILDING teams: Only recommend young' },
    ],
},

// ─── TEST 12: IDP + TEP + Superflex — the kitchen sink ───
{
    id: 'T12',
    name: 'IDP + TEP + Superflex — all three formats detected simultaneously',
    type: 'system_only',
    ctx: {
        rosterPositions: ['QB','RB','RB','WR','WR','WR','TE','FLEX','SUPER_FLEX','DL','LB','LB','DB','BN','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0, bonus_rec_te: 0.5 },
        teamTier: 'REBUILDING', teamWindow: 'REBUILDING', healthScore: 30,
    },
    rubric: [
        { rule: 'SUPERFLEX detected', check: 'system', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'TE PREMIUM detected', check: 'system', contains: 'TE PREMIUM LEAGUE' },
        { rule: 'IDP detected', check: 'system', contains: 'IDP LEAGUE' },
        { rule: '4 defensive slots counted', check: 'system', contains: '4 defensive starter slots' },
        { rule: 'QB 1.8x multiplier', check: 'system', contains: '1.8x' },
        { rule: 'TE 1.5x multiplier', check: 'system', contains: '1.5x' },
        { rule: 'REBUILD mode active', check: 'system', contains: 'REBUILD MODE' },
        { rule: 'Full PPR noted', check: 'system', contains: 'FULL PPR' },
    ],
},

// ─── TEST 13: Trade verdict — rebuilder receiving a 30-y/o WR ───
{
    id: 'T13',
    name: 'Trade verdict — rebuilder offered aging WR for picks',
    type: 'trade_verdict',
    ctx: {
        leagueName: 'The Gridiron',
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0 },
        myTeam: { record: '2-8', tier: 'REBUILDING', window: 'REBUILDING', healthScore: 30, needs: ['WR', 'picks'], strengths: ['young QB'] },
        partnerTeam: { owner: 'Mike', record: '8-2', tier: 'CONTENDER', window: 'CONTENDING', dna: 'Win Now', posture: 'BUYER', needs: ['RB depth'] },
        iSend: { picks: [{ year: 2027, round: 1, value: 4500 }] },
        iReceive: { players: [{ name: 'Keenan Allen', pos: 'WR', age: 30, value: 2800 }] },
        verdict: { verdictText: 'Slightly unfavorable', diffDisplay: '-1700', likelihood: 'High' },
    },
    rubric: [
        { rule: 'My REBUILD mode rules injected', check: 'trade', contains: 'REBUILD MODE' },
        { rule: 'Rebuild rule: players over 28 are sell candidates', check: 'trade', contains: 'sell candidates, not buy targets' },
        { rule: 'Partner CONTENDING mode block present', check: 'trade', contains: 'is CONTENDING' },
        { rule: 'Deal sides include the aging WR with age', check: 'trade', contains: 'Keenan Allen | Age 30' },
        { rule: 'Deterministic verdict passed through', check: 'trade', contains: 'Slightly unfavorable' },
        { rule: 'Verdict must judge through MY mode first', check: 'trade', contains: 'Judge the deal through MY team mode first' },
        { rule: 'Honesty rule about the calculator', check: 'trade', contains: 'disagree with the calculator, SAY SO' },
        { rule: 'Strict verdict contract (ACCEPT/REJECT/COUNTER)', check: 'trade', contains: 'ACCEPT, REJECT, or COUNTER' },
    ],
},

// ─── TEST 14: Trade verdict — superflex team sending away its QB2 ───
{
    id: 'T14',
    name: 'Trade verdict — superflex QB2 leaving triggers format premium',
    type: 'trade_verdict',
    ctx: {
        leagueName: 'SF Dynasty',
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0 },
        myTeam: { record: '6-4', tier: 'CONTENDER', window: 'CONTENDING', healthScore: 72, needs: ['RB'], strengths: ['QB room'] },
        partnerTeam: { owner: 'Dana', record: '3-7', tier: 'REBUILDING', window: 'REBUILDING', dna: 'Rebuilder', posture: 'SELLER', needs: ['QB', 'youth'] },
        iSend: { players: [{ name: 'Jared Goff', pos: 'QB', age: 31, value: 4200 }] },
        iReceive: { players: [{ name: 'Kenneth Walker', pos: 'RB', age: 24, value: 4400 }] },
        verdict: { verdictText: 'Fair value', diffDisplay: '+200', likelihood: 'Medium' },
    },
    rubric: [
        { rule: 'SUPERFLEX format detected', check: 'trade', contains: 'SUPERFLEX LEAGUE' },
        { rule: 'QB 1.8x scarcity premium in format block', check: 'trade', contains: '1.8x' },
        { rule: 'Format premium rule applied to both sides', check: 'trade', contains: 'superflex QB 1.8x' },
        { rule: 'Partner REBUILDING block present', check: 'trade', contains: 'is REBUILDING' },
        { rule: 'Partner rebuild framing: picks and youth', check: 'trade', contains: 'Offers built around picks and youth get accepted' },
        { rule: 'QB leaving my roster visible in deal', check: 'trade', contains: 'QB Jared Goff' },
    ],
},

// ─── TEST 15: Team diagnosis — crossroads team, no generic depth advice ───
{
    id: 'T15',
    name: 'Team diagnosis — crossroads team gets decisive prescription',
    type: 'team_diagnosis',
    ctx: {
        leagueName: 'Dynasty Kings',
        myOwner: 'Jacob',
        record: '5-5',
        teamTier: 'CROSSROADS', teamWindow: 'TRANSITIONING', healthScore: 55,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 0.5 },
        needs: ['RB'], strengths: ['WR core'],
        gmStrategy: 'undecided',
        myRoster: [
            { name: 'Kirk Cousins', pos: 'QB', age: 36, value: 1800, isStarter: true },
            { name: 'Aaron Jones', pos: 'RB', age: 30, value: 2200, isStarter: true },
            { name: 'Marvin Harrison', pos: 'WR', age: 23, value: 7800, isStarter: true },
        ],
    },
    rubric: [
        { rule: 'CROSSROADS mode block injected', check: 'diag', contains: 'CROSSROADS' },
        { rule: 'No half-commit rule present', check: 'diag', contains: 'DO NOT half-commit' },
        { rule: 'Prescription forbids generic depth advice', check: 'diag', contains: 'No generic "add depth" advice' },
        { rule: 'Exactly 3 concrete moves required', check: 'diag', contains: 'Exactly 3 concrete moves' },
        { rule: 'Mode check section required', check: 'diag', contains: 'MODE CHECK' },
        { rule: 'Aging sell candidates rule (27-29)', check: 'diag', contains: '27-29' },
    ],
},

// ─── TEST 16: Team diagnosis — superflex QB crisis overrides ───
{
    id: 'T16',
    name: 'Team diagnosis — superflex 1-QB roster triggers crisis prescription',
    type: 'team_diagnosis',
    ctx: {
        leagueName: 'SF Dynasty',
        myOwner: 'Jacob',
        record: '4-6',
        teamTier: 'REBUILDING', teamWindow: 'REBUILDING', healthScore: 35,
        rosterPositions: ['QB','RB','RB','WR','WR','TE','FLEX','SUPER_FLEX','BN','BN','BN','BN','IR'],
        scoringSettings: { rec: 1.0 },
        myRoster: [
            { name: 'Caleb Williams', pos: 'QB', age: 23, value: 6500, isStarter: true },
            { name: 'Jonathon Brooks', pos: 'RB', age: 22, value: 2400, isStarter: true },
            { name: 'Brian Thomas', pos: 'WR', age: 23, value: 6800, isStarter: true },
        ],
    },
    rubric: [
        { rule: 'SUPERFLEX QB CRISIS fires with 1 startable QB', check: 'diag', contains: 'SUPERFLEX QB CRISIS' },
        { rule: 'QB acquisition is #1 prescription', check: 'diag', contains: '#1 prescription' },
        { rule: 'REBUILD mode rules also present', check: 'diag', contains: 'REBUILD MODE' },
        { rule: 'Diagnosis output contract present', check: 'diag', contains: '**DIAGNOSIS**' },
    ],
},

// ─── TEST 17: Preference block — owner who rejects veteran-for-picks advice ───
{
    id: 'T17',
    name: 'Preference block — rejected framings are not re-pitched',
    type: 'preference_block',
    ctx: {},
    prefs: {
        total: 12,
        upCount: 2,
        downCount: 6,
        actedCount: 3,
        dismissedCount: 1,
        acceptRate: 0.45,
        surfaceCounts: {
            trade_verdict: { up: 1, down: 5, acted: 0 },
            fa_targets: { up: 1, down: 1, acted: 3 },
        },
        recentDownSubjects: [
            { player: 'Keenan Allen', pos: 'WR', age: 30, moveType: 'veteran_for_picks' },
            { title: 'Sell your RB1 for future capital' },
        ],
        recentActedSubjects: [
            { player: 'Jaylen Wright', pos: 'RB', age: 22, moveType: 'faab_target' },
        ],
    },
    rubric: [
        { rule: 'Block announces learned preferences', check: 'prefs', contains: 'USER PREFERENCE PROFILE' },
        { rule: 'Accept rate surfaced', check: 'prefs', contains: '45% positively received' },
        { rule: 'Rejected surface flagged (trade_verdict)', check: 'prefs', contains: 'frequently reject trade_verdict' },
        { rule: 'Acted surface flagged (fa_targets)', check: 'prefs', contains: 'acted on fa_targets' },
        { rule: 'Rejected subjects listed, not re-pitched', check: 'prefs', contains: 'Do not re-pitch' },
        { rule: 'Rejected veteran example carried through', check: 'prefs', contains: 'Keenan Allen WR 30' },
        { rule: 'Acted youth example carried through', check: 'prefs', contains: 'Jaylen Wright RB 22' },
        { rule: 'Quality/mode rules still take precedence', check: 'prefs', contains: 'ALWAYS take precedence' },
    ],
},

// ─── TEST 18: Preference block — no feedback history degrades to nothing ───
{
    id: 'T18',
    name: 'Preference block — empty history emits no block',
    type: 'preference_block',
    ctx: {},
    prefs: { total: 0 },
    rubric: [
        { rule: 'No block for empty history', check: 'prefs', notContains: 'USER PREFERENCE PROFILE' },
    ],
},

];

// ═══════════════════════════════════════════════════════════════════════════
// ── Test Runner ──────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

function runTest(test) {
    const results = { id: test.id, name: test.name, checks: [], pass: 0, fail: 0 };

    // Generate prompts
    const systemPrompt = buildSystemPrompt(test.ctx);
    const faPrompt = test.type === 'fa_targets' ? buildFATargetsPrompt(test.ctx) : null;
    const tradePrompt = test.type === 'trade_verdict' ? buildTradeVerdictPrompt(test.ctx) : null;
    const diagPrompt = test.type === 'team_diagnosis' ? buildTeamDiagnosisPrompt(test.ctx) : null;
    const prefsBlock = test.type === 'preference_block' ? buildUserPreferenceBlock(test.prefs) : null;

    for (const r of test.rubric) {
        const target = r.check === 'system' ? systemPrompt
            : r.check === 'trade' ? tradePrompt
            : r.check === 'diag' ? diagPrompt
            : r.check === 'prefs' ? prefsBlock
            : faPrompt;
        if (target == null && r.check !== 'system') {
            results.checks.push({ rule: r.rule, status: 'SKIP', reason: `No ${r.check} prompt for this test type` });
            continue;
        }

        let passed = false;
        let detail = '';

        if (r.contains) {
            passed = target.includes(r.contains);
            detail = passed ? `Found: "${r.contains}"` : `MISSING: "${r.contains}"`;
        } else if (r.notContains) {
            passed = !target.includes(r.notContains);
            detail = passed ? `Correctly absent: "${r.notContains}"` : `UNWANTED: "${r.notContains}" found in output`;
        }

        if (passed) results.pass++;
        else results.fail++;

        results.checks.push({ rule: r.rule, status: passed ? 'PASS' : 'FAIL', detail });
    }

    return { results, systemPrompt, faPrompt };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Execute & Report ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

console.log('═══════════════════════════════════════════════════════════════');
console.log('  WAR ROOM AI TRAINING — PROMPT SIMULATION TEST SUITE');
console.log('  ' + new Date().toISOString());
console.log('═══════════════════════════════════════════════════════════════\n');

let totalPass = 0, totalFail = 0;
const allOutputs = [];

for (const test of TESTS) {
    const { results, systemPrompt, faPrompt } = runTest(test);
    totalPass += results.pass;
    totalFail += results.fail;

    const icon = results.fail === 0 ? '✅' : '❌';
    console.log(`${icon} ${results.id}: ${results.name}  [${results.pass}/${results.pass + results.fail}]`);

    for (const c of results.checks) {
        const ci = c.status === 'PASS' ? '  ✓' : c.status === 'FAIL' ? '  ✗' : '  ○';
        console.log(`${ci} ${c.rule}`);
        if (c.status === 'FAIL') console.log(`      → ${c.detail}`);
    }
    console.log('');

    allOutputs.push({ id: results.id, name: results.name, systemPrompt, faPrompt, results });
}

console.log('═══════════════════════════════════════════════════════════════');
console.log(`  TOTAL: ${totalPass} passed, ${totalFail} failed out of ${totalPass + totalFail} checks`);
console.log(`  SCORE: ${((totalPass / (totalPass + totalFail)) * 100).toFixed(1)}%`);
console.log('═══════════════════════════════════════════════════════════════\n');

// ── Dump full prompt outputs for manual review ──────────────────────────
if (process.argv.includes('--verbose') || process.argv.includes('-v')) {
    console.log('\n\n═══ FULL PROMPT OUTPUTS (for manual review) ═══\n');
    for (const o of allOutputs) {
        console.log(`\n${'─'.repeat(70)}`);
        console.log(`${o.id}: ${o.name}`);
        console.log(`${'─'.repeat(70)}`);
        console.log('\n[SYSTEM PROMPT]\n');
        console.log(o.systemPrompt);
        if (o.faPrompt) {
            console.log('\n[FA TARGETS PROMPT]\n');
            console.log(o.faPrompt);
        }
    }
}

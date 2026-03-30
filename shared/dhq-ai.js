// ══════════════════════════════════════════════════════════════════
// shared/dhq-ai.js — The DHQ AI Brain
// One file, one brain, all apps. Every AI interaction flows through here.
//
// Usage:  const reply = await dhqAI('home-chat', userMessage, context);
//         const reply = await dhqAI('waiver-agent', null, context);
//         const reply = await dhqAI('trade-chat', userMessage, context);
// ══════════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Master System Prompt ────────────────────────────────────────
// This is the AI's core identity — shared across all features.
const DHQ_IDENTITY = `You are the DHQ AI — the dynasty fantasy football intelligence engine powering Fantasy Wars (ReconAI + War Room).

CORE KNOWLEDGE:
- DHQ values: 0-10,000 scale, derived from 5 years of league-specific scoring data blended with FantasyCalc market consensus (75% engine / 25% market)
- Value tiers: 7000+ = Elite, 4000+ = Starter, 2000+ = Depth, <2000 = Stash
- Pick values (blended industry + league data): 1st round ≈ 2000-7000 (early 1st ~7000, mid ~4500, late ~2000), 2nd ≈ 1200-1950, 3rd ≈ 850-1170, 4th ≈ 660-840. Values auto-adjust based on league age — young leagues weight industry consensus more, mature leagues weight their own draft history more.
- Always say "DHQ value" — never "FC", "KTC", or "FantasyCalc"
- IDP scoring matters: sacks, INTs, pass deflections are premium stats. Edge rushers and ball-hawk DBs are the IDP cornerstones.

PEAK AGE WINDOWS:
- QB: 24-34 (longest window, most valuable in SF)
- RB: 22-27 (shortest window, sell before 27)
- WR: 22-30 (second longest, prime assets)
- TE: 23-30 (late bloomers, patience pays)
- DL: 23-29 (sack production peaks early)
- LB: 23-28 (tackle machines, shorter peak)
- DB: 23-29 (INTs are volatile, PDs more stable)

DYNASTY PRINCIPLES:
- Youth + production = dynasty gold. Under-25 starters are the most valuable assets.
- Age 30+ players in dynasty are depreciating assets — sell before the cliff.
- RBs decline fastest. QBs hold longest. Plan accordingly.
- In Superflex, starting QBs are 2-3x more valuable than 1QB leagues.
- IDP leagues: DL/LB/DB depth matters. Late-round IDP picks hit more often than offensive ones.
- Roster construction > individual talent. A team with 2 elite + 8 starters beats 1 elite + 5 starters + 4 scrubs.

COMMUNICATION STYLE:
- Be direct and specific. Name real players, real DHQ values, real owners.
- Show your math when proposing trades.
- Keep responses concise (3-5 sentences for chat, longer for reports).
- Use Sleeper-ready language when drafting messages.
- Tailor advice to the user's mentality (win-now vs rebuild vs balanced).`;

// ── Feature-Specific Prompts (with Few-Shot Examples) ───────────
// Each feature gets the master identity PLUS feature-specific instructions.

const DHQ_PROMPTS = {

  // ── HOME CHAT ──────────────────────────────────────────────────
  'home-chat': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. You are answering general dynasty questions about the user's team.
Be helpful, specific, and reference their actual roster data.
If they ask about a specific player, include that player's DHQ value and peak window.
If they ask "what should I do?" — give 2-3 specific, actionable moves with reasoning.

EXAMPLE OF AN IDEAL RESPONSE:
User: "What moves should I make?"
Assistant: "Three moves to make right now:
1. **Add Marcus Williams (DB, DHQ 2,800)** — your DB2 slot is thin and he's the top available IDP. Bid $12 FAAB.
2. **Shop Derrick Henry (RB, DHQ 3,100)** — he's 31, past peak, and Team X needs an RB badly. Target their 2027 1st (DHQ ~4,000). Net gain: ~900 DHQ.
3. **Hold your 2026 1.03** — your biggest asset. Don't sell for anything less than a top-5 dynasty WR."`,
    maxTokens: 500,
  },

  // ── TRADE CHAT ─────────────────────────────────────────────────
  'trade-chat': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. You are a dynasty trade advisor with access to REAL league data.
RULES:
1. Name SPECIFIC owners from the league — use their actual names
2. MATH MUST WORK: both sides of a trade must be within 15% of equal DHQ value
3. Show the math: "Your side: Player A (DHQ 3500) + 2026 R2 (~DHQ 2000) = ~5500. Their side: Player B (DHQ 5200) = fair"
4. Only propose trades where BOTH sides benefit — explain what THEY gain
5. Draft a short Sleeper DM message the user can copy-paste
6. Adjust for team mentality: win-now = get better players, rebuilding = get picks/youth
7. Consider owner DNA/trade tendencies when available

EXAMPLE OF AN IDEAL RESPONSE:
User: "What can I get for Kelce?"
Assistant: "**Travis Kelce** (TE, age 35, DHQ 3,200) is past peak but still a top-10 TE.
**Best target: Big Loco's team** — he needs a TE (only 1 rostered) and is in win-now mode.
**Proposed trade:**
Your side: Kelce (DHQ 3,200)
Their side: 2026 R2 (DHQ ~2,800) + Dawson Knox (TE, DHQ 1,100) = DHQ 3,900
You gain ~700 DHQ in future value, they get an immediate TE upgrade.
**Sleeper DM:** 'Hey! Saw you are thin at TE — would you move your 2026 2nd + Knox for Kelce? Instant starter for your playoff push.'"`,
    maxTokens: 600,
  },

  // ── WAIVER CHAT ────────────────────────────────────────────────
  'waiver-chat': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. You are a dynasty waiver wire advisor.
Answer based ONLY on the actual available players listed in the context.
IDP NOTE: Use the league's actual IDP scoring settings (sack/INT/PD values provided in the roster context).
DBs with INT/PD potential are premium. Edge rushers with sack upside too.
Be specific — name actual players from the available list. 3-5 sentences max.

EXAMPLE OF AN IDEAL RESPONSE:
User: "Who should I pick up this week?"
Assistant: "Top 3 waiver adds:
1. **Aidan Hutchinson (DL, DHQ 3,400)** — elite edge rusher returning from injury, your DL2 is empty. Bid $25 FAAB.
2. **Rashod Bateman (WR, DHQ 1,600)** — WR3 upside at $5 FAAB.
3. **Tyler Badie (RB, DHQ 800)** — handcuff lottery ticket, $1 FAAB."`,
    maxTokens: 400,
  },

  // ── WAIVER AGENT (JSON output — skip few-shot) ─────────────────
  'waiver-agent': {
    system: DHQ_IDENTITY + `\n\nYou MUST respond with ONLY a JSON object. No markdown, no backticks, no explanation text.`,
    instructions: `Context is provided as JSON. CRITICAL RULES:
1. ONLY recommend players from the AVAILABLE list. Do NOT invent players.
2. Rookies (0 years experience) can ONLY be added through the rookie draft, NOT waivers.
3. Only recommend VETERAN free agents who have played at least 1 NFL season.
4. Respond with ONLY a JSON object.

Output format:
{"recommendations":[{"name":"player","position":"POS","team":"TM","rank":1,"age":0,"dynastyValue":0,"reason":"why","faab_low":0,"faab_high":0,"copyText":"Sleeper msg"}]}`,
    maxTokens: 600,
  },

  // ── DRAFT CHAT ─────────────────────────────────────────────────
  'draft-chat': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. You are a rookie draft advisor for dynasty fantasy football.
RULES:
- Never recommend K or IDP in rounds 1-2. Offense-first in early rounds.
- IDP is mid-late round value only.
- In SF leagues, QBs are 2-3x more valuable — adjust board accordingly.
- Draft for ceiling in rebuild, floor if contending.
- Consider league tendencies — if the league overdrafts a position, target falling value elsewhere.
- NOTE: Sleeper's rookie data improves as the NFL draft approaches. Pre-draft rankings are speculative.

EXAMPLE OF AN IDEAL RESPONSE:
User: "Who should I take at 1.05?"
Assistant: "At **1.05** in your SF league, target the best RB — your RB room is aging (Henry 31, Mixon 30).
**Board at 1.05:**
1. Ashton Jeanty (RB, DHQ ~7,800) — day-1 starter profile, elite ceiling
2. Luther Burden (WR, DHQ ~6,200) — BPA play with elite route-running
Avoid QB here — you have Lamar + Stroud. IDP this early wastes capital."`,
    maxTokens: 500,
  },

  // ── DRAFT SCOUTING (detailed report) ───────────────────────────
  'draft-scout': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. Generate a comprehensive rookie draft scouting report.
Include:
1. TOP 3 POSITIONS TO TARGET — ranked by roster need + historical hit rates
2. DRAFT BOARD — 6 specific rookies with name, pos, NFL team, target round, roster fit
3. PICK STRATEGY — trade up/down recommendations based on pick slot value
4. AVOID — positions or rounds with poor historical returns in this league
Search the web for current rookie rankings. Be specific with prospect names.`,
    maxTokens: 1200,
    useWebSearch: true,
  },

  // ── TRADE SCOUT (opponent analysis) ────────────────────────────
  'trade-scout': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. Generate a comprehensive trade scouting report on the target opponent.
Include:
1. TEAM TIER — contender/rebuilding/stuck? Their championship window?
2. DESPERATE NEEDS — specific positions, graded by urgency
3. TRADE TENDENCIES — do they sell picks or buy them? Stars or depth?
4. PLAYERS TO TARGET — top 3 specific players to acquire, with why each is gettable and what to offer
5. APPROACH STRATEGY — what to lead with, how to frame the offer
6. SLEEPER DM — ready-to-paste message opening the trade conversation
Be direct and specific. Name real players and real offers. Note IDP gaps if applicable.

EXAMPLE OF AN IDEAL RESPONSE:
Assistant: "**TEAM TIER:** Rebuilding (3-9, DHQ 62k). Window is 2+ years away.
**DESPERATE NEEDS:** QB (0 top-32 QBs — critical), RB (1 starter, need 2)
**TRADE TENDENCIES:** Pick hoarder — acquired 4 picks in last 3 trades. Will overpay for proven starters.
**TARGET #1:** Their 2026 1st (projected top-3). Offer: James Cook (RB, DHQ 4,200) — fills their RB need, you get a premium pick.
**Sleeper DM:** 'Hey man, I see you need RBs. Would you move your 2026 1st for Cook? He would be a day-1 starter for you.'"`,
    maxTokens: 900,
  },

  // ── PICK ANALYSIS ──────────────────────────────────────────────
  'pick-analysis': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. Analyze the user's draft pick portfolio.
Include:
1. SELL NOW — picks to trade while value is high
2. HOLD — picks worth keeping given the user's mentality
3. BUY — picks to acquire from other teams (and who might sell)
4. OVERALL ASSESSMENT — pick-rich or pick-poor vs league? Impact on dynasty timeline?
Be specific with round and year for each recommendation.

EXAMPLE OF AN IDEAL RESPONSE:
Assistant: "**SELL NOW:** 2026 2.08 (DHQ ~2,600) — late 2nds bust 70% of the time. Package with a depth player to upgrade.
**HOLD:** 2026 1.03 (DHQ ~7,500) — top-3 pick in a loaded class, your rebuild cornerstone.
**BUY:** Target Scooter's 2027 1st — he's in win-now mode and has sold picks before. Offer your 2026 3rd + a veteran starter.
**Overall:** Pick-rich (top 25%). Well-positioned for a 2-year rebuild."`,
    maxTokens: 600,
  },

  // ── PLAYER SCOUT REPORT ────────────────────────────────────────
  'player-scout': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. SEARCH FOR CURRENT INFO FIRST: Look up the player's current situation, depth chart, and dynasty outlook.
Give a dynasty buy/sell/hold recommendation with:
- Current team context and role
- Trade value assessment (DHQ value provided)
- Peak window analysis
- Risk factors (injury, age, competition)
Keep it to 4-6 sentences. Be definitive — give a clear recommendation.

EXAMPLE OF AN IDEAL RESPONSE:
Assistant: "**Amon-Ra St. Brown (WR, age 25, DHQ 7,400) — HOLD.** Elite WR1 locked in as Detroit's target leader. At 25 he's entering his prime (22-30 for WRs) with 5+ elite years ahead. DHQ 7,400 is fair — you'd need a top-3 pick + a starter to replace this production. Only sell for 8,000+ DHQ in return value."`,
    maxTokens: 500,
    useWebSearch: true,
  },

  // ── POWER RANKINGS X POST (skip few-shot) ──────────────────────
  'power-posts': {
    system: 'You are @ReconAI_FW, a bold and entertaining dynasty fantasy football analyst on X (Twitter).',
    instructions: `Context is provided as JSON. Write one X post (max 280 chars) per team in the power rankings.
Be opinionated, funny, and use fantasy football culture. Reference records and roster situations.
Output as JSON: {"posts":[{"team":"name","rank":N,"post":"text"}]}`,
    maxTokens: 800,
  },

  // ── MEMORY SUMMARIZER (skip few-shot) ──────────────────────────
  'memory-summary': {
    system: 'Summarize dynasty fantasy football conversations.',
    instructions: `Summarize this conversation in ONE sentence, max 15 words.
Be specific about players and decisions discussed.`,
    maxTokens: 80,
  },

  // ── STRATEGY WALKTHROUGH ───────────────────────────────────────
  'strategy-analysis': {
    system: DHQ_IDENTITY,
    instructions: `Context is provided as JSON. The user just set their team strategy. Give a brief (3-4 sentences) personalized assessment of their roster given their strategy. Be specific about players. End with one actionable recommendation.`,
    maxTokens: 400,
  },

  // ── NEWS (Grok-specific) ───────────────────────────────────────
  'player-news': {
    system: `You are a dynasty fantasy football news reporter. IMPORTANT: ONLY report news about the SPECIFIC player asked about. Do NOT mention any other players. Give 2-3 sentences of the latest news from X/Twitter about this one player. Focus on: trades, injuries, depth chart changes, contract news. If you have no recent news about this specific player, say "No recent news found."`,
    instructions: '',
    maxTokens: 300,
  },
};

// ── Context Builders (Structured JSON — Improvement A) ──────────
// All builders return JSON strings. Convenience functions wrap them
// with section markers like [ROSTER_CONTEXT], [MENTALITY], etc.

function dhqBuildRosterContext(compact) {
  const S = window.S || window.App?.S;
  if (!S?.user) return '';
  const myR = window.myR || window.App?.myR;
  const my = typeof myR === 'function' ? myR() : null;
  if (!my) return '';
  const pName = window.pName || window.App?.pName || (id => id);
  const pPos = window.pPos || window.App?.pPos || (() => '');
  const pAge = window.pAge || window.App?.pAge || (() => '');
  const pM = window.pM || window.App?.pM || (p => p);
  const dynastyValue = window.dynastyValue || window.App?.dynastyValue || (() => 0);
  const playerStats = S.playerStats || {};
  const peakWindows = window.App?.peakWindows || { QB: [24, 34], RB: [22, 27], WR: [22, 30], TE: [23, 30], DL: [23, 29], LB: [23, 28], DB: [23, 29] };
  const s = my.settings || {};
  const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const sc = league?.scoring_settings || {};
  const isSF = !!(league?.roster_positions?.includes('SUPER_FLEX'));
  const isIDP = !!(league?.roster_positions?.some(p => ['DL', 'LB', 'DB', 'IDP_FLEX'].includes(p)));
  const rp = league?.roster_positions || [];
  const sorted = [...(S.rosters || [])].sort((a, b) => (b.settings?.wins || 0) - (a.settings?.wins || 0));
  const rank = sorted.findIndex(r => r.roster_id === S.myRosterId) + 1;
  const totalVal = (my.players || []).reduce((sum, p) => sum + dynastyValue(p), 0);

  const peakLabel = (pid) => {
    const pos = pM(pPos(pid));
    const age = pAge(pid);
    if (!age || !pos) return 'Unknown';
    const pw = peakWindows[pos] || [23, 29];
    if (age < pw[0]) return 'Pre-peak';
    if (age <= pw[1]) return 'Peak';
    return 'Post-peak';
  };

  const starterPids = (my.starters || []).filter(p => p && p !== '0');
  const starterObjs = starterPids
    .map(pid => {
      const val = dynastyValue(pid);
      const age = pAge(pid) || 0;
      const ppg = playerStats[pid]?.seasonAvg || playerStats[pid]?.prevAvg || 0;
      return { name: pName(pid), pos: pPos(pid), age, dhq: val, ppg: +ppg.toFixed(1), peak: peakLabel(pid) };
    })
    .sort((a, b) => b.dhq - a.dhq);

  const benchPids = (my.players || []).filter(p => !starterPids.includes(p) && !(my.reserve || []).includes(p) && !(my.taxi || []).includes(p));
  const benchObjs = benchPids
    .map(pid => ({ name: pName(pid), pos: pPos(pid), age: pAge(pid) || 0, dhq: dynastyValue(pid) }))
    .filter(x => x.dhq > 0)
    .sort((a, b) => b.dhq - a.dhq);

  const record = (s.wins || 0) + '-' + (s.losses || 0);
  const leagueName = league?.name || '?';
  const teams = (S.rosters || []).length;
  const formatStr = teams + '-team' + (isSF ? ' Superflex' : ' 1QB') + (isIDP ? ' IDP' : '');

  if (compact) {
    return JSON.stringify({
      user: S.user.display_name,
      rank: rank,
      teams: teams,
      record: record,
      dhqTotal: totalVal,
      starters: starterObjs.slice(0, 5),
      topBench: benchObjs.slice(0, 5),
      league: leagueName,
      format: formatStr,
    });
  }

  // Full context — includes gaps, surpluses, picks, FAAB, IDP scoring
  const posCounts = {};
  (my.players || []).forEach(pid => { const pos = pM(pPos(pid)); if (pos) posCounts[pos] = (posCounts[pos] || 0) + 1; });

  const offPositions = ['QB', 'RB', 'WR', 'TE'];
  const idpPositions = ['DL', 'LB', 'DB'];
  const allPositions = isIDP ? offPositions.concat(idpPositions) : offPositions;
  const gaps = [];
  const surpluses = [];
  allPositions.forEach(pos => {
    const need = rp.filter(sl => sl === pos || (sl === 'FLEX' && ['RB', 'WR', 'TE'].includes(pos)) || (sl === 'SUPER_FLEX' && pos === 'QB') || (sl === 'IDP_FLEX' && idpPositions.includes(pos))).length;
    const have = posCounts[pos] || 0;
    if (have <= need) gaps.push(pos);
    if (have >= need + 3) surpluses.push(pos);
  });

  const picks = (S.tradedPicks || [])
    .filter(p => p.owner_id === S.myRosterId)
    .map(p => p.season + ' R' + p.round)
    .sort();

  const getFAAB = window.getFAAB || window.App?.getFAAB;
  const faabData = typeof getFAAB === 'function' ? getFAAB() : null;
  const faab = faabData ? { remaining: faabData.remaining || 0, budget: faabData.budget || 200 } : { remaining: 0, budget: 200 };

  const idpScoring = {
    sack: sc.idp_sack || 4,
    int: sc.idp_int || 5,
    pd: sc.idp_pass_def || 3,
  };

  return JSON.stringify({
    user: S.user.display_name,
    rank: rank,
    teams: teams,
    record: record,
    dhqTotal: totalVal,
    starters: starterObjs,
    topBench: benchObjs.slice(0, 8),
    league: leagueName,
    format: formatStr,
    gaps: gaps,
    surpluses: surpluses,
    picks: picks,
    faab: faab,
    idpScoring: idpScoring,
  });
}

function dhqBuildMentalityContext() {
  const loadMentality = window.loadMentality || window.App?.loadMentality;
  if (typeof loadMentality !== 'function') return '';
  const m = loadMentality();
  const labels = {
    mentality: { winnow: 'WIN NOW', rebuild: 'REBUILD', balanced: 'BALANCED', prime: '2-3YR WINDOW' },
  };
  return JSON.stringify({
    mentality: labels.mentality[m.mentality] || m.mentality || 'BALANCED',
    untouchable: m.neverDrop || '',
    notes: m.notes ? m.notes.substring(0, 150) : '',
  });
}

function dhqBuildLeagueContext() {
  const S = window.S || window.App?.S;
  const LI = window.App?.LI || {};
  if (!S?.rosters?.length) return '';
  const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const sc = league?.scoring_settings || {};
  const isSF = !!(league?.roster_positions?.includes('SUPER_FLEX'));
  const isIDP = !!(league?.roster_positions?.some(p => ['DL', 'LB', 'DB', 'IDP_FLEX'].includes(p)));
  const lt = LI.leagueTradeTendencies || {};
  return JSON.stringify({
    totalTrades: lt.totalTrades || 0,
    pickHeavy: lt.pickHeavy || 0,
    avgAssetsPerSide: lt.avgAssetsPerSide || 0,
    scoringType: (sc.rec === 1) ? 'full-ppr' : (sc.rec === 0.5) ? 'half-ppr' : (sc.rec === 0) ? 'standard' : 'custom',
    isSF: isSF,
    isIDP: isIDP,
  });
}

function dhqBuildOwnerProfiles() {
  const S = window.S || window.App?.S;
  const LI = window.App?.LI || {};
  if (!S?.rosters?.length || !LI.ownerProfiles) return '';
  const pM = window.pM || (p => p);
  const pPos = window.pPos || (() => '');
  const pNameShort = window.pNameShort || (id => id);
  const dynastyValue = window.dynastyValue || (() => 0);
  const league = S.leagues?.find(l => l.league_id === S.currentLeagueId);
  const rp = league?.roster_positions || [];
  const allTotals = S.rosters.map(r => (r.players || []).reduce((sum, pid) => sum + dynastyValue(pid), 0));
  const avgTotal = allTotals.length ? allTotals.reduce((a, b) => a + b, 0) / allTotals.length : 80000;

  // Championship data
  const championships = window.App?.LI?.championships || {};
  const leagueUsersHistory = window.App?.LI?.leagueUsersHistory || {};

  // Count championships per roster
  const champCounts = {};
  const runnerUpCounts = {};
  Object.values(championships).forEach(c => {
    if (c.champion) champCounts[c.champion] = (champCounts[c.champion] || 0) + 1;
    if (c.runnerUp) runnerUpCounts[c.runnerUp] = (runnerUpCounts[c.runnerUp] || 0) + 1;
  });

  // Count tenure per user
  const tenureByUser = {};
  Object.values(leagueUsersHistory).forEach(users => {
    (users || []).forEach(u => {
      if (!tenureByUser[u.user_id]) tenureByUser[u.user_id] = 0;
      tenureByUser[u.user_id]++;
    });
  });

  // Detect rivalries for the current user
  const detectRivalries = window.App?.detectRivalries;
  const rivalries = detectRivalries ? detectRivalries(S.myRosterId) : [];

  const profiles = S.rosters.filter(r => r.roster_id !== S.myRosterId).map(r => {
    const name = S.leagueUsers.find(u => u.user_id === r.owner_id)?.display_name || 'Team';
    const st = r.settings || {};
    const record = (st.wins || 0) + '-' + (st.losses || 0);
    const totalVal = (r.players || []).reduce((sum, pid) => sum + dynastyValue(pid), 0);
    const posCounts = {};
    (r.players || []).forEach(pid => { const pos = pM(pPos(pid)); if (pos) posCounts[pos] = (posCounts[pos] || 0) + 1; });
    const weakPositions = ['QB', 'RB', 'WR', 'TE'].filter(pos => {
      const need = rp.filter(s2 => s2 === pos || (s2 === 'FLEX' && ['RB', 'WR', 'TE'].includes(pos)) || (s2 === 'SUPER_FLEX' && pos === 'QB')).length;
      return (posCounts[pos] || 0) <= need;
    });
    const topPlayers = (r.players || []).map(pid => ({ pid, val: dynastyValue(pid) })).sort((a, b) => b.val - a.val).slice(0, 2)
      .map(x => ({ name: pNameShort(x.pid), pos: pPos(x.pid), dhq: x.val }));
    const dna = LI.ownerProfiles?.[r.roster_id];
    const contending = totalVal > avgTotal * 1.1 ? 'contender' : totalVal < avgTotal * 0.85 ? 'rebuilder' : 'mid-tier';

    // Championship + tenure data
    const champs = champCounts[r.roster_id] || 0;
    const runners = runnerUpCounts[r.roster_id] || 0;
    const tenure = tenureByUser[r.owner_id] || 1;
    const isNew = tenure <= 1;
    const tenureNote = isNew ? 'NEW OWNER' : tenure >= 4 ? tenure + 'yr veteran' : '';

    // Rivalry detection
    const isRival = rivalries.find(rv => rv.rosterId === r.roster_id);

    return {
      name: name,
      record: record,
      tier: contending,
      dhqTotal: totalVal,
      championships: champs,
      runnerUps: runners,
      playoffAppearances: 0, // populated when bracket data is richer
      tenure: tenure,
      isNewOwner: isNew,
      tenureNote: tenureNote,
      rivalry: isRival ? { wins: isRival.wins, losses: isRival.losses } : null,
      needs: weakPositions,
      stars: topPlayers,
      dna: dna?.trades > 0 ? dna.dna : '',
      tradesWon: dna?.tradesWon || 0,
      tradesLost: dna?.tradesLost || 0,
    };
  }).slice(0, 12);

  return JSON.stringify(profiles);
}

// ── News Enrichment — Improvement D ─────────────────────────────
// Extracts player names from user message, checks caches, fires
// non-blocking news fetch to warm cache for next request.

function dhqEnrichWithNews(message) {
  if (!message) return '';
  const S = window.S || window.App?.S;
  const pName = window.pName || window.App?.pName || (id => id);

  // Extract possible player names — 2+ word capitalized sequences
  const namePatterns = message.match(/[A-Z][a-z]+(?:\s+[A-Z][a-z'.()-]+)+/g) || [];

  // Match against S.players to confirm real players
  const playerNames = [];
  if (S?.players) {
    const rawLower = new Set(namePatterns.map(n => n.toLowerCase()));
    for (const pid of Object.keys(S.players)) {
      const p = S.players[pid];
      const fullName = ((p.first_name || '') + ' ' + (p.last_name || '')).trim();
      if (fullName && rawLower.has(fullName.toLowerCase())) {
        playerNames.push({ id: pid, name: fullName });
      }
    }
  }
  // Keep unmatched raw patterns too (user might reference players not in S.players)
  namePatterns.forEach(n => {
    if (!playerNames.find(p => p.name.toLowerCase() === n.toLowerCase())) {
      playerNames.push({ id: null, name: n });
    }
  });

  if (!playerNames.length) return '';

  const newsLines = [];

  // 1. Check window._newsCache (populated by callGrokNews)
  const grokCache = window._newsCache || {};
  playerNames.forEach(function(entry) {
    const key = Object.keys(grokCache).find(function(k) {
      return k.toLowerCase().includes(entry.name.toLowerCase()) || entry.name.toLowerCase().includes(k.toLowerCase());
    });
    if (key && grokCache[key]) {
      var headline = typeof grokCache[key] === 'string' ? grokCache[key] : (grokCache[key].headline || grokCache[key].text || '');
      if (headline) newsLines.push(entry.name + ': ' + headline.substring(0, 120));
    }
  });

  // 2. Check localStorage dhq_news_cache (ESPN RSS)
  try {
    var espnRaw = localStorage.getItem('dhq_news_cache');
    if (espnRaw) {
      var espnCache = JSON.parse(espnRaw);
      var espnItems = espnCache.items || espnCache.headlines || [];
      if (Array.isArray(espnItems)) {
        playerNames.forEach(function(entry) {
          var nameLower = entry.name.toLowerCase();
          var match = espnItems.find(function(item) {
            var text = (item.title || item.headline || '').toLowerCase();
            return text.includes(nameLower) || nameLower.split(' ').every(function(w) { return text.includes(w); });
          });
          if (match && !newsLines.find(function(l) { return l.startsWith(entry.name + ':'); })) {
            newsLines.push(entry.name + ': ' + (match.title || match.headline).substring(0, 120));
          }
        });
      }
    }
  } catch (e) { /* localStorage unavailable or parse error */ }

  // 3. Fire non-blocking callGrokNews to populate cache for next time
  var callGrokNews = window.callGrokNews || window.App?.callGrokNews;
  if (typeof callGrokNews === 'function') {
    playerNames.forEach(function(entry) {
      try { callGrokNews(entry.name); } catch (e) { /* non-blocking */ }
    });
  }

  if (!newsLines.length) return '';
  return '[PLAYER_NEWS]\n' + newsLines.join('\n') + '\n';
}

// ── Response Validation — Improvement C ─────────────────────────
// Scans AI responses for player names and validates them against
// the league's actual player database.

function extractPlayerNames(text) {
  var names = new Set();
  // Match **Name** patterns (bold markdown)
  var boldPattern = /\*\*([A-Z][a-z]+(?:\s+[A-Z][a-z'.()-]+)+)/g;
  var match;
  while ((match = boldPattern.exec(text)) !== null) {
    var name = match[1].replace(/\s*\(.*$/, '').trim();
    if (name.split(' ').length >= 2) names.add(name);
  }
  // Match Name (POS patterns without bold
  var posPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z'.()-]+)+)\s*\((QB|RB|WR|TE|DL|LB|DB|K|DEF)/g;
  while ((match = posPattern.exec(text)) !== null) {
    var name2 = match[1].trim();
    if (name2.split(' ').length >= 2) names.add(name2);
  }
  return Array.from(names);
}

function findPlayerId(name) {
  var S = window.S || window.App?.S;
  if (!S?.players) return null;
  var nameLower = name.toLowerCase().trim();
  for (var pid of Object.keys(S.players)) {
    var p = S.players[pid];
    var fullName = ((p.first_name || '') + ' ' + (p.last_name || '')).toLowerCase().trim();
    if (fullName === nameLower) return pid;
  }
  // Fuzzy fallback: match last name + first initial
  var parts = nameLower.split(' ');
  var lastName = parts[parts.length - 1];
  for (var pid2 of Object.keys(S.players)) {
    var p2 = S.players[pid2];
    if ((p2.last_name || '').toLowerCase() === lastName && (p2.first_name || '').toLowerCase().startsWith(parts[0])) {
      return pid2;
    }
  }
  return null;
}

// Response name extraction — uses regex patterns to find player names in AI output
function extractResponseNames(text) {
  const names = [];
  const patterns = [
    /\*\*([A-Z][a-z]+ [A-Z][a-z']+)\*\*/g,   // **First Last**
    /([A-Z][a-z]+ [A-Z][a-z']+)\s*\(/g,       // First Last (
  ];
  patterns.forEach(p => { let m; while ((m = p.exec(text))) names.push(m[1]); });
  return [...new Set(names)];
}

function isRostered(pid) {
  const S = window.S || window.App?.S;
  if (!S?.rosters) return false;
  return S.rosters.some(r => (r.players || []).includes(pid));
}

function isOnMyRoster(pid) {
  const S = window.S || window.App?.S;
  if (!S?.rosters || !S.myRosterId) return false;
  const my = S.rosters.find(r => r.roster_id === S.myRosterId);
  return my ? (my.players || []).includes(pid) : false;
}

function checkTradeMath(text) {
  const valPattern = /(?:DHQ\s*~?|~)\s*([\d,]+)/gi;
  const vals = [];
  let m;
  while ((m = valPattern.exec(text))) vals.push(parseInt(m[1].replace(/,/g, ''), 10));
  if (vals.length < 2) return null;
  const mid = Math.floor(vals.length / 2);
  const sideA = vals.slice(0, mid).reduce((a, b) => a + b, 0);
  const sideB = vals.slice(mid).reduce((a, b) => a + b, 0);
  if (sideA === 0 || sideB === 0) return null;
  const ratio = Math.abs(sideA - sideB) / Math.max(sideA, sideB);
  return ratio > 0.20 ? { sideA, sideB, ratio: Math.round(ratio * 100) } : null;
}

const VALIDATION_TYPES = ['home-chat', 'trade-chat', 'waiver-chat', 'waiver-agent', 'draft-chat'];

function validateAIResponse(type, response, ctx) {
  if (!VALIDATION_TYPES.includes(type)) return { text: response, issues: [] };
  const text = typeof response === 'string' ? response : JSON.stringify(response);
  const issues = [];
  const names = extractResponseNames(text);
  const isWaiver = type === 'waiver-chat' || type === 'waiver-agent';
  const isTrade = type === 'trade-chat';

  for (const name of names) {
    const pid = findPlayerId(name);
    // Check 1: Player existence — flag possible hallucinations
    if (!pid) {
      issues.push(`[${name}] could not be verified in your league's player database`);
      continue;
    }
    // Check 2: Waiver recs — player should NOT already be rostered
    if (isWaiver && isRostered(pid)) {
      issues.push(`[${name}] appears to already be rostered \u2014 this recommendation may need adjustment`);
    }
    // Check 3: Trade recs — don't suggest acquiring your own player
    if (isTrade && isOnMyRoster(pid)) {
      const nameIdx = text.indexOf(name);
      const preceding = text.substring(Math.max(0, nameIdx - 80), nameIdx).toLowerCase();
      if (/target|acquire|get|their side/.test(preceding)) {
        issues.push(`[${name}] is already on your roster \u2014 this recommendation may need adjustment`);
      }
    }
  }

  // Check 4: Trade math — verify both sides within 20%
  if (isTrade) {
    const imbalance = checkTradeMath(text);
    if (imbalance) {
      issues.push(`Trade values appear imbalanced (${imbalance.sideA.toLocaleString()} vs ${imbalance.sideB.toLocaleString()}, ${imbalance.ratio}% gap)`);
    }
  }

  if (!issues.length) return { text: response, issues: [] };
  const notes = '\n\n' + issues.map(i => '\u26A0\uFE0F Note: ' + i + '.').join('\n');
  const validated = typeof response === 'string' ? response + notes : response;
  return { text: validated, issues };
}

// ── Main Entry Point ────────────────────────────────────────────
// type:    one of the keys in DHQ_PROMPTS
// message: the user's message (optional for agent-type prompts)
// context: additional context string to inject (optional)
// options: { messages: [] } for multi-turn conversations

async function dhqAI(type, message, context, options) {
  const config = DHQ_PROMPTS[type];
  if (!config) throw new Error(`Unknown DHQ AI type: ${type}`);

  const system = config.system;
  const maxTokens = config.maxTokens || 500;
  const useWebSearch = config.useWebSearch || false;

  // Improvement D: Inject real-time news for applicable types
  const newsTypes = ['home-chat', 'trade-chat', 'player-scout', 'draft-chat'];
  let newsContext = '';
  if (newsTypes.includes(type)) {
    newsContext = dhqEnrichWithNews(message);
  }

  // Capture user preferences for chat types
  const chatTypes = ['home-chat','trade-chat','waiver-chat','draft-chat'];
  if (chatTypes.includes(type) && message) {
    try { if (typeof captureUserPreferences === 'function') captureUserPreferences(message); } catch (e) {}
  }

  // Build the full prompt
  let fullContext = '';
  if (config.instructions) fullContext += config.instructions + '\n\n';
  if (newsContext) fullContext += newsContext + '\n';
  if (context) fullContext += context + '\n\n';

  // Inject league memory for context-rich types
  const memoryTypes = ['home-chat','trade-chat','waiver-chat','draft-chat','trade-scout','player-scout','pick-analysis'];
  if (memoryTypes.includes(type)) {
    try {
      const memCtx = await buildMemoryContext(window.S?.currentLeagueId);
      if (memCtx) fullContext += memCtx + '\n\n';
    } catch (e) {}
  }

  // Construct messages array
  let messages;
  if (options?.messages) {
    // Multi-turn: inject context into the last user message
    messages = options.messages.map((m, i) => {
      if (m.role === 'user' && i === options.messages.length - 1) {
        return { role: 'user', content: fullContext + m.content };
      }
      if (m.role === 'assistant' && m.content.length > 400) {
        return { role: 'assistant', content: m.content.substring(0, 400) + '...' };
      }
      return m;
    });
  } else {
    messages = [{ role: 'user', content: fullContext + (message || '') }];
  }

  // Route through callClaude (which handles server-side vs client-side)
  const callClaude = window.callClaude || window.App?.callClaude;
  if (typeof callClaude !== 'function') throw new Error('No AI engine available');

  // We prepend system to the first user message
  const systemPrefixed = messages.map((m, i) => {
    if (i === 0 && m.role === 'user') {
      return { role: 'user', content: '[System: ' + system + ']\n\n' + m.content };
    }
    return m;
  });

  const reply = await callClaude(systemPrefixed, useWebSearch, 2, maxTokens, type);

  // Validate response — fast, non-blocking, appends notes if issues found
  const validated = validateAIResponse(type, reply, {
    myRosterId: window.S?.myRosterId,
    rosters: window.S?.rosters,
  });

  return validated.text;
}

// ── Convenience Functions ───────────────────────────────────────

// Full context builder — assembles labeled JSON sections for detailed prompts
function dhqContext(includeOwners) {
  const parts = [];
  const roster = dhqBuildRosterContext(false);
  if (roster) parts.push('[ROSTER_CONTEXT]\n' + roster);
  const mentality = dhqBuildMentalityContext();
  if (mentality) parts.push('[MENTALITY]\n' + mentality);
  const league = dhqBuildLeagueContext();
  if (league) parts.push('[LEAGUE]\n' + league);
  if (includeOwners) {
    const owners = dhqBuildOwnerProfiles();
    if (owners) parts.push('[OWNERS]\n' + owners);
  }
  return parts.join('\n\n');
}

// Compact context builder — assembles labeled JSON sections for chat
function dhqCompactContext() {
  const parts = [];
  const roster = dhqBuildRosterContext(true);
  if (roster) parts.push('[ROSTER_CONTEXT]\n' + roster);
  const mentality = dhqBuildMentalityContext();
  if (mentality) parts.push('[MENTALITY]\n' + mentality);
  return parts.join('\n\n');
}

// ── Exports ─────────────────────────────────────────────────────
Object.assign(window.App, {
  DHQ_IDENTITY,
  DHQ_PROMPTS,
  dhqAI,
  dhqContext,
  dhqCompactContext,
  dhqBuildRosterContext,
  dhqBuildMentalityContext,
  dhqBuildLeagueContext,
  dhqBuildOwnerProfiles,
  dhqEnrichWithNews,
  extractPlayerNames,
  findPlayerId,
  validateAIResponse,
});

Object.assign(window, {
  dhqAI,
  dhqContext,
  dhqCompactContext,
  dhqBuildRosterContext,
  dhqBuildMentalityContext,
  dhqBuildLeagueContext,
  dhqBuildOwnerProfiles,
  dhqEnrichWithNews,
  extractPlayerNames,
  findPlayerId,
  validateAIResponse,
});

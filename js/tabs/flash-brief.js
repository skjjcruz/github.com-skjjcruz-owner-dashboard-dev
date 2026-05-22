// ══════════════════════════════════════════════════════════════════
// js/tabs/flash-brief.js — IntelligenceBriefWidget + FieldNotesWidget
// These are dashboard widget components, consumed by DashboardPanel
// in js/tabs/dashboard.js via window.IntelligenceBriefWidget /
// window.FieldNotesWidget. The old FlashBriefPanel 2×2 tab was
// removed — ticker/standings now render only from dashboard.js.
// ══════════════════════════════════════════════════════════════════

function ordinal(n) { const s = ['th','st','nd','rd']; const v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); }

const BRIEF_PERSONALITY = {
    default: {
        greeting: (t, name) => (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + ', ' + name + '.',
        elite: (rank, hs) => "Your roster is elite — top of the food chain right now.",
        contender: (rank, hs) => "Your roster's sitting in solid shape — " + ordinal(rank) + " in the league with a health score of " + hs + ". You're right in the mix.",
        crossroads: (rank, hs) => "You're at a crossroads — ranked " + ordinal(rank) + " with a health score of " + hs + ". Some decisions coming up that'll define your direction.",
        rebuilding: (rank, hs) => "Rebuilding mode — ranked " + ordinal(rank) + ". Health score is " + hs + ". But that's where the opportunity is.",
        waiver: (name, pos, dhq) => "I've been watching the wire — " + name + " is sitting out there unclaimed.",
        trade: (count) => "I've mapped out the owners in your league. A few look ripe for a deal.",
        draft: (days, date) => "Draft is " + days + " day" + (days !== 1 ? 's' : '') + " out. Time to sharpen your board.",
        rank: (rank, tier) => "You're #" + rank + " in the league pecking order right now.",
    },
    general: {
        greeting: (t, name) => name + ". Listen up.",
        elite: (rank, hs) => "Health score " + hs + ". That's dominance. Don't get comfortable — maintain that edge.",
        contender: (rank, hs) => "Ranked " + ordinal(rank) + ". Health score " + hs + ". Solid, but solid doesn't win championships. Push harder.",
        crossroads: (rank, hs) => "Ranked " + ordinal(rank) + ". Health score " + hs + ". You're at a crossroads and I need you to make a decision. Now.",
        rebuilding: (rank, hs) => "Ranked " + ordinal(rank) + ". Health score " + hs + ". We're in rebuild mode. That means discipline, not panic.",
        waiver: (name, pos, dhq) => name + " is available on the wire. Pick him up before your opponents wake up.",
        trade: (count) => "I've profiled every owner in this league. Time to exploit their weaknesses.",
        draft: (days, date) => days + " days until the draft. You better have your board locked in.",
        rank: (rank, tier) => "You're " + ordinal(rank) + ". " + (rank <= 3 ? "Good. Stay hungry." : "Not good enough. Let's fix it."),
    },
    enthusiast: {
        greeting: (t, name) => "Hey! " + (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + "! LET'S GO, " + name + "!",
        elite: (rank, hs) => "ELITE! Man, you are COOKING right now! Health score " + hs + " — that's what I'm talking about!",
        contender: (rank, hs) => "Dude, " + ordinal(rank) + " in the league! Health score " + hs + "! You've got JUICE right now, let's keep it rolling!",
        crossroads: (rank, hs) => "Okay okay okay — ranked " + ordinal(rank) + ", health score " + hs + ". We're at a CROSSROADS but that's where the MAGIC happens!",
        rebuilding: (rank, hs) => "Alright, " + ordinal(rank) + " place, health score " + hs + " — REBUILDING BABY! This is where you lay the foundation for something SPECIAL!",
        waiver: (name, pos, dhq) => "OH MAN — " + name + " is just sitting there on the wire! You GOTTA grab this guy!",
        trade: (count) => "I've been studying every owner in this league and I am FIRED UP about some trade targets!",
        draft: (days, date) => "DRAFT IN " + days + " DAYS! Oh man I love this time of year! Let's get your board DIALED IN!",
        rank: (rank, tier) => "You're #" + rank + "! " + (rank <= 3 ? "TOP THREE BABY!" : "Let's CLIMB!"),
    },
    bayou: {
        greeting: (t, name) => "Mornin', cher. How we doin' today, " + name + "?",
        elite: (rank, hs) => "Boy I tell you what, this roster is NASTY good. Health score " + hs + ". Ain't nobody touchin' us right now.",
        contender: (rank, hs) => "We sittin' at " + ordinal(rank) + ", health score " + hs + ". That's a good gumbo right there — just need a little more seasoning.",
        crossroads: (rank, hs) => "We at a crossroads, " + ordinal(rank) + " place, health score " + hs + ". Time to fish or cut bait, ya heard me?",
        rebuilding: (rank, hs) => "Look, we " + ordinal(rank) + " right now. Health score " + hs + ". But down here we know how to build somethin' from nothin'.",
        waiver: (name, pos, dhq) => name + " just fell off somebody's bayou boat and landed right on the wire. Go get 'em.",
        trade: (count) => "I been watchin' these owners real close. Got a few that's ready to make a deal.",
        draft: (days, date) => "Draft's " + days + " days out. Time to set them trotlines and see what we catch.",
        rank: (rank, tier) => "We #" + rank + " in the peckin' order. " + (rank <= 3 ? "Top of the food chain, baby!" : "We comin' for 'em."),
    },
    wit: {
        greeting: (t, name) => (t < 12 ? 'Morning' : t < 17 ? 'Afternoon' : 'Evening') + ", " + name + ". Your opponents didn't get any smarter overnight.",
        elite: (rank, hs) => "Elite tier. Health score " + hs + ". Try not to let it go to your head — though I suppose your leaguemates already have.",
        contender: (rank, hs) => ordinal(rank) + " place, health score " + hs + ". Solid enough to be dangerous, not quite good enough to be cocky about it.",
        crossroads: (rank, hs) => "Ranked " + ordinal(rank) + ", health score " + hs + ". You're at a crossroads — which, historically, is where people make their worst decisions. Let's not do that.",
        rebuilding: (rank, hs) => ordinal(rank) + " place. Health score " + hs + ". Rebuilding. The good news? It's hard to get worse. The bad news? Your leaguemates know it too.",
        waiver: (name, pos, dhq) => name + " is sitting on the waiver wire like a forgotten lunch. Someone's going to eat eventually — might as well be you.",
        trade: (count) => "I've studied every owner in your league. Some of them actually think they're good at this.",
        draft: (days, date) => days + " days to the draft. Plenty of time for your opponents to overthink their boards.",
        rank: (rank, tier) => "#" + rank + " in the league. " + (rank <= 3 ? "Not bad. Almost impressive." : "Room for improvement, as they say diplomatically."),
    },
    closer: {
        greeting: (t, name) => "Let's go to work, " + name + ".",
        elite: (rank, hs) => "Elite. Period. Health score " + hs + ". Now protect it.",
        contender: (rank, hs) => ordinal(rank) + " place. Health score " + hs + ". You play to win the game.",
        crossroads: (rank, hs) => ordinal(rank) + ". Health score " + hs + ". Crossroads. Make a decision and commit. No half-measures.",
        rebuilding: (rank, hs) => ordinal(rank) + ". Health score " + hs + ". Rebuilding. You don't build a house by wishing — you lay bricks. Let's go.",
        waiver: (name, pos, dhq) => name + " is on the wire. Go get him. Done.",
        trade: (count) => "Owners profiled. Weaknesses identified. Time to make moves.",
        draft: (days, date) => days + " days. Draft. Be ready.",
        rank: (rank, tier) => "#" + rank + ". " + (rank <= 3 ? "Keep it." : "Change it."),
    },
    strategist: {
        greeting: (t, name) => (t < 12 ? 'Good morning' : t < 17 ? 'Good afternoon' : 'Good evening') + ", " + name + ". Let's review the board.",
        elite: (rank, hs) => "Health score " + hs + ". Elite positioning. Portfolio is optimized — focus shifts to sustaining competitive advantage.",
        contender: (rank, hs) => "Position: " + ordinal(rank) + ". Health score: " + hs + ". Contender-class roster. Key variable: positional gaps and trade leverage.",
        crossroads: (rank, hs) => "Position: " + ordinal(rank) + ". Health score: " + hs + ". Crossroads classification. Decision matrix: commit to competing or pivot to accumulation.",
        rebuilding: (rank, hs) => "Position: " + ordinal(rank) + ". Health score: " + hs + ". Rebuild phase. Optimal strategy: maximize asset acquisition, minimize win-now spending.",
        waiver: (name, pos, dhq) => "Waiver wire analysis: " + name + " at " + pos + " (DHQ " + dhq.toLocaleString() + ") available. Addresses your positional deficit.",
        trade: (count) => "Owner analysis complete. " + count + " trade scenarios identified with positive expected value.",
        draft: (days, date) => "T-minus " + days + " days to draft. Board calibration recommended.",
        rank: (rank, tier) => "League position: " + ordinal(rank) + ". Classification: " + tier + ".",
    },
};

// ══════════════════════════════════════════════════════════════════
// IntelligenceBriefWidget — Alex's greeting + action CTAs
// Renders as a dashboard widget at md / lg / xl sizes. The xl size
// spans the full dashboard grid width for the premium landing look.
// ══════════════════════════════════════════════════════════════════
function IntelligenceBriefWidget({
  size = 'xl',
  myRoster,
  rankedTeams,
  sleeperUserId,
  currentLeague,
  briefDraftInfo,
  playersData,
  setActiveTab,
  navigateWidget,
}) {
    const myAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
    const tier = (myAssess?.tier || 'UNKNOWN').toUpperCase();
    const hs = myAssess?.healthScore || 0;
    const needs = myAssess?.needs || [];
    const elites = typeof window.App?.countElitePlayers === 'function' ? window.App.countElitePlayers(myRoster?.players || []) : 0;
    const myRank = (rankedTeams || []).findIndex(t => t.userId === sleeperUserId) + 1;
    const scores = window.App?.LI?.playerScores || {};
    const ownerProfiles = window.App?.LI?.ownerProfiles || {};

    // FAAB
    const budget = currentLeague?.settings?.waiver_budget || 0;
    const spent = myRoster?.settings?.waiver_budget_used || 0;
    const faabRemaining = Math.max(0, budget - spent);

    // Best waiver target
    const waiverTarget = useMemo(() => {
        if (!needs.length) return null;
        const normPos = window.App?.normPos || (p => p);
        const rostered = new Set();
        (currentLeague?.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => rostered.add(String(pid))));
        const needPos = typeof needs[0] === 'string' ? needs[0] : needs[0]?.pos;
        if (!needPos) return null;
        const candidates = Object.entries(playersData || {})
            .filter(([pid, p]) => !rostered.has(pid) && normPos(p.position) === needPos && p.team && p.active !== false && (scores[pid] || 0) >= 1500)
            .map(([pid, p]) => ({ pid, name: p.full_name || '', dhq: scores[pid] || 0, pos: needPos, team: p.team }))
            .sort((a, b) => b.dhq - a.dhq);
        if (!candidates.length && needs.length > 1) {
            for (let i = 1; i < Math.min(needs.length, 4); i++) {
                const altPos = typeof needs[i] === 'string' ? needs[i] : needs[i]?.pos;
                if (!altPos) continue;
                const alt = Object.entries(playersData || {})
                    .filter(([pid, p]) => !rostered.has(pid) && normPos(p.position) === altPos && p.team && p.active !== false && (scores[pid] || 0) >= 1500)
                    .map(([pid, p]) => ({ pid, name: p.full_name || '', dhq: scores[pid] || 0, pos: altPos, team: p.team }))
                    .sort((a, b) => b.dhq - a.dhq);
                if (alt.length) return alt[0];
            }
        }
        return candidates[0] || null;
    }, [needs, playersData, scores, currentLeague]);

    // Key drops (high-value players dropped in last 3 weeks)
    const keyDrops = useMemo(() => {
        const drops = [];
        const transactions = window.S?.transactions || {};
        const curWeek = window.S?.currentWeek || 1;
        for (let w = curWeek; w >= Math.max(1, curWeek - 2); w--) {
            ((transactions['w' + w]) || []).forEach(t => {
                if (t.type !== 'free_agent' && t.type !== 'waiver') return;
                Object.keys(t.drops || {}).forEach(pid => {
                    const dhq = scores[pid] || 0;
                    if (dhq >= 1500) drops.push({ pid, name: playersData?.[pid]?.full_name || '?', dhq, pos: playersData?.[pid]?.position || '?' });
                });
            });
        }
        return drops.sort((a, b) => b.dhq - a.dhq).slice(0, 3);
    }, [scores, playersData]);

    // Draft countdown
    const draftCountdown = useMemo(() => {
        if (!briefDraftInfo?.start_time || briefDraftInfo.status !== 'pre_draft') return null;
        const diff = briefDraftInfo.start_time - Date.now();
        if (diff <= 0) return null;
        const days = Math.floor(diff / 86400000);
        const hours = Math.floor((diff % 86400000) / 3600000);
        return { days, hours, date: new Date(briefDraftInfo.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
    }, [briefDraftInfo]);

    // Active trades in league
    const activeTrades = useMemo(() => {
        const txns = window.S?.transactions || {};
        const flat = Array.isArray(txns) ? txns : Object.values(txns).flat();
        return flat.filter(t => t.type === 'trade').length;
    }, []);

    // Greeting based on time of day + personality
    const hour = new Date().getHours();
    const userName = window.S?.user?.display_name || window.S?.user?.username || 'Commander';
    const alexStyle = localStorage.getItem('wr_alex_style') || 'default';
    const p = BRIEF_PERSONALITY[alexStyle] || BRIEF_PERSONALITY.default;
    const greetingText = p.greeting(hour, userName);

    // Build Alex's conversational briefing
    const needPos = needs.length ? (typeof needs[0] === 'string' ? needs[0] : needs[0]?.pos) : '';
    const tierMsg = tier === 'ELITE' ? p.elite(myRank, hs)
        : tier === 'CONTENDER' ? p.contender(myRank, hs)
        : tier === 'CROSSROADS' ? p.crossroads(myRank, hs)
        : p.rebuilding(myRank, hs);

    // Portfolio vs league average
    const portfolioComparison = (() => {
        const myDHQ = (myRoster?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
        const allDHQs = (currentLeague?.rosters || []).map(r => (r.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0));
        const avgDHQ = allDHQs.length ? allDHQs.reduce((a, b) => a + b, 0) / allDHQs.length : 0;
        if (avgDHQ > 0) {
            const pct = Math.round((myDHQ - avgDHQ) / avgDHQ * 100);
            return pct > 0 ? `Your portfolio is ${pct}% above league average.` : pct < 0 ? `Your portfolio trails the league average by ${Math.abs(pct)}%.` : '';
        }
        return '';
    })();

    // AlexSettings focus areas — the narrative fragments are gated by whichever
    // areas the user has enabled, so turning off "trades" or "waivers" in
    // Alex Insights quiets those lines here too.
    const alexFocus = (window.WR?.AlexSettings?.get?.()?.focus) || { trades: true, waivers: true, gmStyle: true };

    // Full briefing text — used at tall/xl/xxl
    let briefText = tierMsg;
    if (portfolioComparison) briefText += ' ' + portfolioComparison;
    if (elites > 0 && alexFocus.gmStyle !== false) briefText += ` You've got ${elites} elite player${elites > 1 ? 's' : ''} anchoring the roster.`;
    if (needPos && alexFocus.gmStyle !== false) briefText += ` Your biggest gap is at ${needPos} — I've been keeping an eye on options for you.`;
    if (activeTrades > 0 && alexFocus.trades !== false) briefText += ` ${activeTrades} trade${activeTrades > 1 ? 's have' : ' has'} gone down in the league recently. Worth watching who's moving what.`;
    if (budget > 0 && alexFocus.waivers !== false) briefText += ` You've got $${faabRemaining} of $${budget} FAAB left to work with.`;

    // Three-sentence summary — fits a 160px-tall md row, no scroll
    const threeSentence = (() => {
        const parts = [tierMsg];
        if (needPos && alexFocus.gmStyle !== false) parts.push(`Biggest gap: ${needPos}.`);
        else if (elites > 0) parts.push(`${elites} elite anchor${elites > 1 ? 's' : ''}.`);
        if (waiverTarget && alexFocus.waivers !== false) parts.push(`${waiverTarget.name} (${waiverTarget.pos}) sitting on the wire.`);
        else if (draftCountdown) parts.push(`Draft in ${draftCountdown.days} day${draftCountdown.days !== 1 ? 's' : ''}.`);
        else if (activeTrades > 0 && alexFocus.trades !== false) parts.push(`${activeTrades} recent trade${activeTrades > 1 ? 's' : ''} in your league.`);
        else parts.push(`Ranked ${ordinal(myRank)} in the league.`);
        return parts.slice(0, 3).join(' ');
    })();

    // One-sentence headline — used at lg
    const oneSentence = tierMsg;

    const alexAvatar = (() => {
        const key = localStorage.getItem('wr_alex_avatar') || 'brain';
        const map = { brain:'\u{1F9E0}', target:'\u{1F3AF}', chart:'\u{1F4CA}', football:'\u{1F3C8}', bolt:'\u26A1', fire:'\u{1F525}', medal:'\u{1F396}\uFE0F', trophy:'\u{1F3C6}' };
        return map[key] || '\u{1F9E0}';
    })();

    const cardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const goTo = (target) => {
        if (navigateWidget) navigateWidget(target);
        else if (setActiveTab) setActiveTab(target);
    };

    // ── Action list (priority-ordered, focus-gated) ─────────────────
    const actions = [];
    if (alexFocus.waivers !== false && waiverTarget) {
        actions.push({
            icon: '🎯', tab: 'fa',
            title: p.waiver(waiverTarget.name, waiverTarget.pos, waiverTarget.dhq),
            detail: [
                React.createElement('span', { key: 'n', style: { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }, onClick: e => { e.stopPropagation(); if (typeof window.openPlayerModal === 'function' && waiverTarget.pid) window.openPlayerModal(waiverTarget.pid); } }, waiverTarget.name),
                ` · ${waiverTarget.pos} · DHQ ${waiverTarget.dhq.toLocaleString()} · Fills your ${waiverTarget.pos} gap.`,
            ],
        });
    }
    if (alexFocus.waivers !== false && keyDrops.length > 0) {
        actions.push({
            icon: '⚠️', tab: 'fa',
            title: `Heads up — ${keyDrops.length > 1 ? 'some high-value players hit' : 'a high-value player hit'} the wire recently.`,
            detail: [
                ...keyDrops.map((d, i) => [
                    i > 0 ? ', ' : '',
                    React.createElement('span', { key: d.pid || i, style: { color: 'var(--accent)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: '2px' }, onClick: e => { e.stopPropagation(); if (typeof window.openPlayerModal === 'function' && d.pid) window.openPlayerModal(d.pid); } }, `${d.name} (${d.pos}, ${d.dhq.toLocaleString()})`),
                ]).flat(),
                '. Might be worth scooping up before someone else does.',
            ],
        });
    }
    if (alexFocus.trades !== false) {
        actions.push({
            icon: '🔄', tab: 'trades',
            title: p.trade(Object.keys(ownerProfiles).length),
            detail: 'Let me show you who needs what — and what you could get in return.',
        });
    }
    if (alexFocus.draft !== false && draftCountdown) {
        actions.push({
            icon: '📋', tab: 'draft',
            title: p.draft(draftCountdown.days, draftCountdown.date),
            detail: `${draftCountdown.date} · I've got your scouting report ready when you are.`,
        });
    }
    actions.push({
        icon: '🏆', tab: 'analytics',
        title: p.rank(myRank, tier),
        detail: `${tier} tier · See where everyone else stands.`,
    });

    // ── Reusable action button ───────────────────────────────────────
    const baseBtn = { background: 'rgba(212,175,55,0.05)', border: '1px solid rgba(212,175,55,0.15)', borderRadius: '10px', color: 'var(--gold)', cursor: 'pointer', fontFamily: 'var(--font-body)', fontWeight: 500, textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: '10px', transition: 'all 0.15s', lineHeight: 1.4 };
    function renderActionBtn(a, key, opts = {}) {
        const compact = !!opts.compact;
        const btnStyle = {
            ...baseBtn,
            padding: compact ? '6px 10px' : '12px 16px',
            fontSize: compact ? '0.72rem' : '0.82rem',
            ...(opts.style || {}),
        };
        return React.createElement('button', {
            key,
            onClick: () => goTo(a.tab), style: btnStyle,
            onMouseEnter: e => e.currentTarget.style.background = 'rgba(212,175,55,0.15)',
            onMouseLeave: e => e.currentTarget.style.background = 'rgba(212,175,55,0.05)',
        },
            React.createElement('span', { style: { fontSize: compact ? '0.85rem' : '1rem', flexShrink: 0 } }, a.icon),
            React.createElement('div', { style: { minWidth: 0, flex: 1 } },
                React.createElement('div', { style: { fontWeight: 600, color: 'var(--white)', fontSize: compact ? '0.74rem' : '0.85rem' } }, a.title),
                !compact && React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', marginTop: '2px' } },
                    Array.isArray(a.detail) ? a.detail : a.detail
                ),
            ),
        );
    }

    // ── Reusable header ─────────────────────────────────────────────
    function header(opts = {}) {
        const tight = !!opts.tight;
        return React.createElement('div', { style: { padding: tight ? '8px 14px 6px' : '20px 20px 0', borderBottom: '1px solid rgba(212,175,55,0.1)', paddingBottom: tight ? '6px' : '12px', flexShrink: 0 } },
            React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: tight ? '0.62rem' : '0.72rem', color: 'var(--gold)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: tight ? '2px' : '4px', display: 'flex', alignItems: 'center', gap: '6px' } },
                React.createElement('span', { style: { fontSize: tight ? '0.8rem' : '0.9rem' } }, alexAvatar),
                'INTELLIGENCE BRIEFING',
            ),
            React.createElement('div', { style: { fontSize: tight ? '0.92rem' : '1.2rem', fontWeight: 700, color: 'var(--white)' } }, greetingText),
        );
    }

    // ── md (2×1, 160px tall) — 3 sentences, no scroll ────────────────
    if (size === 'md') {
        return React.createElement('div', { onClick: () => goTo('alex'), style: { ...cardStyle, cursor: 'pointer' } },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'flex', alignItems: 'center', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' } }, threeSentence),
            ),
        );
    }

    // ── lg (2×2, 320px tall) — 1 sentence + 3 actions, no scroll ─────
    if (size === 'lg') {
        const top3 = actions.slice(0, 3);
        return React.createElement('div', { style: cardStyle },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', flexShrink: 0 } }, oneSentence),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minHeight: 0 } },
                    ...top3.map((a, i) => renderActionBtn(a, 'lg-' + i, { compact: true, titleClamp: 1 })),
                ),
            ),
        );
    }

    // ── tall (2×4, 640px tall) — full vertical layout ────────────────
    if (size === 'tall') {
        return React.createElement('div', { style: cardStyle },
            header(),
            React.createElement('div', { style: { padding: '16px 20px', flex: 1, overflowY: 'auto' } },
                React.createElement('div', { style: { fontSize: '0.85rem', color: 'var(--silver)', lineHeight: 1.75, marginBottom: '20px' } }, briefText),
                React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                    ...actions.map((a, i) => renderActionBtn(a, 'tall-' + i)),
                ),
            ),
        );
    }

    // ── xl (4×2, 320×640) — split columns, no scroll ─────────────────
    if (size === 'xl') {
        const top4 = actions.slice(0, 4);
        return React.createElement('div', { style: cardStyle },
            header({ tight: true }),
            React.createElement('div', { style: { padding: '10px 14px', flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '14px', overflow: 'hidden' } },
                React.createElement('div', { style: { fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.65, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 9, WebkitBoxOrient: 'vertical' } }, briefText),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', minHeight: 0 } },
                    ...top4.map((a, i) => renderActionBtn(a, 'xl-' + i, { compact: true, titleClamp: 2 })),
                ),
            ),
        );
    }

    // ── xxl (4×4, ~640×640) — full real-estate dashboard ─────────────
    if (size === 'xxl') {
        const posBars = (window.App?.calcPosGrades?.(myRoster?.roster_id, currentLeague?.rosters, playersData) || []);

        const myDHQ = (myRoster?.players || []).reduce((s, pid) => s + (window.App?.LI?.playerScores?.[pid] || 0), 0);
        const kpis = [
            { label: 'HEALTH', value: hs, col: hs >= 80 ? '#2ECC71' : hs >= 60 ? '#D4AF37' : hs >= 40 ? '#F0A500' : '#E74C3C' },
            { label: 'RANK', value: '#' + (myRank || '—'), col: '#D4AF37' },
            { label: 'TIER', value: tier, col: tier === 'ELITE' ? '#2ECC71' : tier === 'CONTENDER' ? '#D4AF37' : tier === 'CROSSROADS' ? '#F0A500' : '#E74C3C' },
            { label: 'ELITES', value: elites, col: '#2ECC71' },
            { label: 'DHQ', value: myDHQ >= 1000 ? Math.round(myDHQ / 1000) + 'k' : myDHQ, col: '#D4AF37' },
            { label: 'FAAB', value: budget > 0 ? '$' + faabRemaining : '—', col: '#7C6BF8' },
        ];

        return React.createElement('div', { style: cardStyle },
            header(),
            React.createElement('div', { style: { padding: '14px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflow: 'hidden' } },
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '6px', flexShrink: 0 } },
                    ...kpis.map((k, i) => React.createElement('div', {
                        key: i,
                        style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '6px', padding: '8px 6px', textAlign: 'center' },
                    },
                        React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 700, color: k.col, lineHeight: 1.1 } }, String(k.value)),
                        React.createElement('div', { style: { fontSize: '0.6rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '3px' } }, k.label),
                    )),
                ),
                React.createElement('div', { style: { flexShrink: 0 } },
                    React.createElement('div', { style: { fontSize: '0.62rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' } }, 'Position Health'),
                    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gap: '6px' } },
                        ...posBars.map((pb, i) => React.createElement('div', { key: i, style: { textAlign: 'center' } },
                            React.createElement('div', { style: { fontSize: '0.6rem', fontWeight: 700, color: 'var(--silver)' } }, pb.pos),
                            React.createElement('div', { style: { fontFamily: 'JetBrains Mono, monospace', fontSize: '1rem', fontWeight: 700, color: pb.col, lineHeight: 1, margin: '2px 0' } }, pb.grade),
                            React.createElement('div', { style: { height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' } },
                                React.createElement('div', { style: { width: pb.pct + '%', height: '100%', background: pb.col } }),
                            ),
                            React.createElement('div', { style: { fontSize: '0.55rem', color: 'var(--silver)', opacity: 0.6, marginTop: '2px', fontFamily: 'JetBrains Mono, monospace' } }, '#' + pb.rank + '/' + pb.totalTeams),
                        )),
                    ),
                ),
                React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 1fr)', gap: '16px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 } },
                        React.createElement('div', { style: { fontSize: '0.62rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Alex\u2019s Read'),
                        React.createElement('div', { style: { fontSize: '0.85rem', color: 'var(--silver)', lineHeight: 1.7, overflowY: 'auto' } }, briefText),
                    ),
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 } },
                        React.createElement('div', { style: { fontSize: '0.62rem', fontWeight: 700, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.08em' } }, 'Action Items'),
                        ...actions.slice(0, 5).map((a, i) => renderActionBtn(a, 'xxl-' + i, { compact: true, titleClamp: 2 })),
                    ),
                ),
            ),
        );
    }

    // Default: tall layout
    return React.createElement('div', { style: cardStyle },
        header(),
        React.createElement('div', { style: { padding: '16px 20px', flex: 1, overflowY: 'auto' } },
            React.createElement('div', { style: { fontSize: '0.85rem', color: 'var(--silver)', lineHeight: 1.75, marginBottom: '20px' } }, briefText),
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                ...actions.map((a, i) => renderActionBtn(a, 'def-' + i)),
            ),
        ),
    );
}

// ══════════════════════════════════════════════════════════════════
// FieldNotesWidget — Scout/War Room session log feed (v2)
// Groups entries by type (icon-derived) so users see a clear breakdown.
// All sizes are no-scroll: smaller sizes show counts/last entry, larger
// sizes show grouped sections with cap on entries per group.
// ══════════════════════════════════════════════════════════════════
function FieldNotesWidget({ size = 'lg', navigateWidget }) {
    const [fieldEntries, setFieldEntries] = useState([]);
    useEffect(() => {
        const fallback = () => {
            try {
                const raw = localStorage.getItem('scout_field_log_v1');
                if (raw) { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) setFieldEntries(parsed.slice(0, 30)); }
            } catch {}
        };
        if (window.OD?.loadFieldLog) {
            window.OD.loadFieldLog(null, 30).then(data => {
                if (data && data.length) setFieldEntries(data);
                else fallback();
            }).catch(fallback);
        } else {
            fallback();
        }
    }, []);

    // Group entries by their `category` field (set when the action is logged).
    // Fall back to source-based grouping when category is missing.
    const CATEGORY_META = {
        roster:    { label: 'Roster moves',  color: '#2ECC71' },
        trade:     { label: 'Trade activity', color: '#7C6BF8' },
        waiver:    { label: 'Waiver moves',  color: '#00c8b4' },
        draft:     { label: 'Draft prep',     color: '#F0A500' },
        research:  { label: 'Research',       color: '#D4AF37' },
        league:    { label: 'League intel',   color: '#5DADE2' },
        scout:     { label: 'Scout sessions', color: '#00c8b4' },
        warroom:   { label: 'War Room',       color: '#D4AF37' },
    };
    const classify = (e) => {
        const cat = (e.category || '').toLowerCase();
        if (cat && CATEGORY_META[cat]) return { key: cat, ...CATEGORY_META[cat] };
        // Fallback by source
        const fallback = e.source === 'warroom' ? 'warroom' : 'scout';
        return { key: fallback, ...CATEGORY_META[fallback] };
    };

    // Group entries by type, sorted by recency within
    const groups = useMemo(() => {
        const out = {};
        (fieldEntries || []).forEach(e => {
            const r = classify(e);
            if (!out[r.key]) out[r.key] = { key: r.key, label: r.label, color: r.color, entries: [] };
            out[r.key].entries.push(e);
        });
        Object.values(out).forEach(g => g.entries.sort((a, b) => (b.ts || 0) - (a.ts || 0)));
        return Object.values(out).sort((a, b) => b.entries.length - a.entries.length);
    }, [fieldEntries]);

    const totalCount = fieldEntries.length;
    const monoFont = "'JetBrains Mono', monospace";
    const cardStyle = { background: 'var(--black)', border: 'var(--card-border, 1px solid rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius, 10px)', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' };
    const openNotes = () => navigateWidget && navigateWidget('fieldNotes');
    const noteCardStyle = { ...cardStyle, cursor: navigateWidget ? 'pointer' : 'default' };

    function fmtTime(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function renderEntry(e, i) {
        return React.createElement('div', { key: e.id || i, style: { display: 'flex', alignItems: 'center', gap: '6px', padding: '3px 0', fontSize: '0.7rem', fontFamily: monoFont, borderBottom: '1px solid rgba(255,255,255,0.03)' } },
            React.createElement('span', { style: { fontSize: '0.78rem' } }, e.icon || '📋'),
            React.createElement('span', { style: { flex: 1, color: 'var(--silver)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, e.text || ''),
            React.createElement('span', { style: { fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)' } }, fmtTime(e.ts)),
        );
    }

    function emptyState(opts = {}) {
        return React.createElement('div', { style: { textAlign: 'center', padding: opts.tight ? '12px 0' : '40px 0', color: 'var(--silver)', opacity: 0.5, fontFamily: monoFont } },
            React.createElement('div', { style: { fontSize: opts.tight ? '1.4rem' : '2rem', marginBottom: '6px' } }, '📋'),
            React.createElement('div', { style: { fontSize: '0.78rem', fontWeight: 700 } }, 'No field notes yet'),
            !opts.tight && React.createElement('div', { style: { fontSize: '0.7rem', marginTop: '4px' } }, 'Actions from Scout will appear here.'),
        );
    }

    // ── SLIM (1×2, ~80×160): big number + proportional category bars ──
    if (size === 'slim') {
        const maxCount = Math.max(...groups.map(g => g.entries.length), 1);
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '8px 8px 4px', textAlign: 'center', flexShrink: 0, borderBottom: '1px solid rgba(212,175,55,0.08)' } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '0.58rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '1px' } }, 'NOTES'),
                React.createElement('div', { style: { fontSize: '1.5rem', fontWeight: 700, color: 'var(--white)', fontFamily: monoFont, lineHeight: 1 } }, totalCount),
            ),
            React.createElement('div', { style: { flex: 1, padding: '6px 6px', display: 'flex', flexDirection: 'column', gap: '4px', overflow: 'hidden' } },
                groups.length === 0
                    ? React.createElement('div', { style: { textAlign: 'center', color: 'var(--silver)', opacity: 0.5, fontSize: '0.6rem', fontFamily: monoFont, padding: '8px 0' } }, 'No notes yet')
                    : groups.slice(0, 5).map(g => {
                        const pct = (g.entries.length / maxCount) * 100;
                        return React.createElement('div', { key: g.key, style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                            React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.56rem', fontFamily: monoFont } },
                                React.createElement('span', { style: { color: g.color, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.label.split(' ')[0]),
                                React.createElement('span', { style: { color: 'var(--white)', fontWeight: 700 } }, g.entries.length),
                            ),
                            React.createElement('div', { style: { height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' } },
                                React.createElement('div', { style: { width: pct + '%', height: '100%', background: g.color, transition: '0.3s' } }),
                            ),
                        );
                    }),
            ),
        );
    }

    // ── NARROW (1×4): vertical type counts + a few latest entries ──
    if (size === 'narrow') {
        const latest = fieldEntries.slice(0, 5);
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '8px 8px 6px', borderBottom: '1px solid rgba(212,175,55,0.1)', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '0.64rem', color: 'var(--gold)', letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: '0.62rem', color: 'var(--silver)', marginTop: '1px', fontFamily: monoFont } }, totalCount + ' total'),
            ),
            React.createElement('div', { style: { flex: 1, padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState({ tight: true }) : React.createElement(React.Fragment, null,
                    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '3px' } },
                        ...groups.slice(0, 6).map(g => React.createElement('div', { key: g.key, style: { display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.6rem', fontFamily: monoFont } },
                            React.createElement('div', { style: { width: 4, height: 4, borderRadius: 2, background: g.color, flexShrink: 0 } }),
                            React.createElement('span', { style: { color: 'var(--silver)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, g.label),
                            React.createElement('span', { style: { fontWeight: 700, color: 'var(--white)' } }, g.entries.length),
                        )),
                    ),
                    React.createElement('div', { style: { borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '4px', flex: 1, minHeight: 0, overflow: 'hidden' } },
                        React.createElement('div', { style: { fontSize: '0.56rem', color: 'var(--gold)', letterSpacing: '0.05em', textTransform: 'uppercase', fontWeight: 700, marginBottom: '3px', fontFamily: monoFont } }, 'Recent'),
                        ...latest.map((e, i) => React.createElement('div', { key: i, style: { fontSize: '0.6rem', color: 'var(--silver)', fontFamily: monoFont, padding: '1px 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (e.icon || '·') + ' ' + (e.text || ''))),
                    ),
                ),
            ),
        );
    }

    // ── LG (2×2): grouped sections — top 2 groups, top 3 each ──
    if (size === 'lg') {
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '12px 16px 8px', borderBottom: '1px solid rgba(212,175,55,0.1)', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '1rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: '0.7rem', color: 'var(--silver)', fontFamily: monoFont, marginTop: '2px' } }, totalCount + ' entries · ' + groups.length + ' types'),
            ),
            React.createElement('div', { style: { padding: '8px 14px', flex: 1, display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState() :
                    groups.slice(0, 3).map(g => React.createElement('div', { key: g.key, style: { borderLeft: '2px solid ' + g.color, paddingLeft: '8px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' } },
                            React.createElement('span', { style: { fontSize: '0.62rem', fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: monoFont } }, g.label),
                            React.createElement('span', { style: { fontSize: '0.6rem', color: 'rgba(255,255,255,0.4)', fontFamily: monoFont } }, g.entries.length),
                        ),
                        ...g.entries.slice(0, 2).map((e, i) => renderEntry(e, i)),
                    )),
            ),
        );
    }

    // ── TALL (2×4): all groups, more entries each, no scroll ──
    if (size === 'tall') {
        return React.createElement('div', { onClick: openNotes, title: 'Open GM\'s Office', style: noteCardStyle },
            React.createElement('div', { style: { padding: '14px 18px 10px', borderBottom: '1px solid rgba(212,175,55,0.1)', flexShrink: 0 } },
                React.createElement('div', { style: { fontFamily: monoFont, fontSize: '1.1rem', color: 'var(--gold)', letterSpacing: '0.08em', textTransform: 'uppercase', fontWeight: 700 } }, 'FIELD NOTES'),
                React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', fontFamily: monoFont, marginTop: '2px' } }, 'Intel grouped by type · ' + totalCount + ' entries'),
            ),
            React.createElement('div', { style: { padding: '10px 16px', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', overflow: 'hidden' } },
                groups.length === 0 ? emptyState() :
                    groups.slice(0, 5).map(g => React.createElement('div', { key: g.key, style: { borderLeft: '2px solid ' + g.color, paddingLeft: '8px' } },
                        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '3px' } },
                            React.createElement('span', { style: { fontSize: '0.66rem', fontWeight: 700, color: g.color, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: monoFont } }, g.label),
                            React.createElement('span', { style: { fontSize: '0.62rem', color: 'rgba(255,255,255,0.4)', fontFamily: monoFont } }, g.entries.length),
                        ),
                        ...g.entries.slice(0, 3).map((e, i) => renderEntry(e, i)),
                    )),
            ),
        );
    }

    return null;
}

// Expose globally so dashboard.js can render them as widgets
window.IntelligenceBriefWidget = IntelligenceBriefWidget;
window.FieldNotesWidget = FieldNotesWidget;

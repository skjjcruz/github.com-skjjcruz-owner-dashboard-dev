// ══════════════════════════════════════════════════════════════════
// js/tabs/my-team.js — MyTeamTab: roster view with format-aware value labels,
// PPG stats, age curves, acquisition history, and column customization
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

function MyTeamTab({
  // Core data
  myRoster,
  currentLeague,
  leagueSkin,
  playersData,
  statsData,
  stats2025Data,
  standings,
  sleeperUserId,

  // Roster filter / sort / columns
  rosterFilter,
  setRosterFilter,
  rosterSort,
  setRosterSort,
  visibleCols,
  setVisibleCols,
  expandedPid,
  setExpandedPid,
  showColPicker,
  setShowColPicker,
  colPreset,
  setColPreset,

  // Compare sub-view was promoted to its own top-level tab (js/tabs/compare.js)
  // so myTeamView / compareTeamId props are gone.

  // GM Strategy
  gmStrategy,
  setGmStrategy,
  gmStrategyOpen,
  setGmStrategyOpen,

  // Alex avatar
  setAlexAvatar,
  setAvatarKey,

  // Navigation / Recon panel
  setActiveTab,
  setReconPanelOpen,
  sendReconMessage,

  // Misc
  timeRecomputeTs,
  setTimeRecomputeTs,
  getAcquisitionInfo: getAcquisitionInfoProp,
}) {
  // Fallback if prop not passed — prevents crash
  const getAcquisitionInfo = typeof getAcquisitionInfoProp === 'function' ? getAcquisitionInfoProp : () => ({ method: 'Unknown', date: '', cost: '' });
  const resolvedLeagueSkin = leagueSkin || window.App?.LeagueSkin?.getCurrent?.() || null;
  const skinFeatures = resolvedLeagueSkin?.features || {};
  const skinVocabulary = resolvedLeagueSkin?.vocabulary || {};
  const valueLabel = skinVocabulary.valueLabel || 'DHQ Dynasty Value';
  const valueShortLabel = skinVocabulary.valueShortLabel || 'Value';

  // Scout-free vs Pro. Free keeps every raw column + sort/filter/tags/IR/taxi;
  // the verdict layer (Move column, DROP? chips, row tints, Action lens,
  // dossier roster call, START/SIT line, Dynasty Read AI) keys on this one
  // predicate — wrIsPro only, never canAccess/getTier (shadowing hazard).
  const isPro = typeof window.wrIsPro === 'function' ? window.wrIsPro() : true;

  function calcRawPts(s) { return window.App.calcRawPts(s, currentLeague?.scoring_settings); }

  function getPlayerName(playerId) {
    const player = playersData[playerId];
    if (!player) return `Player ${playerId}`;
    return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
  }

  // Rookie/prospect join — name→prospect index (rebuilt when the rookie CSV lands,
  // signalled by timeRecomputeTs). Resolves a roster player to its rookie-data
  // record so the rich scouting fields surface in columns + the Rookies filter.
  const RookieFields = window.App?.RookieFields;
  const rookieIndex = React.useMemo(() => RookieFields ? RookieFields.buildIndex() : new Map(), [timeRecomputeTs]);
  const prospectForRow = React.useCallback((r) => RookieFields ? RookieFields.lookup(rookieIndex, r?.p, { posGuard: true }) : null, [rookieIndex]);
  const isRookieRow = React.useCallback((r) => {
    if (!r || !r.p) return false;
    const pr = prospectForRow(r);
    return RookieFields ? RookieFields.isRookie(r.p, pr, { cur: statsData, prev: stats2025Data }) : false;
  }, [prospectForRow, statsData, stats2025Data]);

  // ── GM Strategy — single source of truth. Live-updates on GM Strategy save. ──
  // Drives untouchable lock badges, target/sell position accents, and a sell-rule
  // nudge on the roster recommendation. Hook is called once, unconditionally.
  const gm = window.WR.GmMode.useGmEffects(currentLeague);
  const gmTargetPositions = gm?.targetPositions instanceof Set ? gm.targetPositions : new Set();
  const gmSellPositions = gm?.sellPositions instanceof Set ? gm.sellPositions : new Set();
  const gmUntouchable = gm?.untouchable instanceof Set ? gm.untouchable : new Set();
  // Parse free-text sell rules like "Sell RB age 27+" leniently. Returns
  // { pos: 'RB', minAge: 27 } per parseable rule; unparseable rules are ignored.
  const gmSellRulesParsed = React.useMemo(() => {
    const out = [];
    (gm?.sellRules || []).forEach(rule => {
      try {
        const s = String(rule);
        const posM = s.match(/\b(QB|RB|WR|TE|K|DEF|DL|LB|DB)\b/i);
        const ageM = s.match(/age\s*(\d{1,2})\s*\+?/i);
        if (!posM && !ageM) return; // nothing structured to match on
        out.push({
          pos: posM ? posM[1].toUpperCase() : null,
          minAge: ageM ? parseInt(ageM[1], 10) : null,
        });
      } catch {}
    });
    return out;
  }, [gm?.sellRules]);
  // Does a row trip a sell rule or a sell-position? Used to nudge the rec.
  const gmTripsSell = React.useCallback((r) => {
    if (!r) return false;
    const pos = String(r.pos);
    if (gmSellPositions.has(pos)) return true;
    return gmSellRulesParsed.some(rule => {
      const posOk = !rule.pos || rule.pos === pos;
      const ageOk = rule.minAge == null || (r.age != null && r.age >= rule.minAge);
      // A rule with neither a usable pos nor age constraint shouldn't fire blindly.
      if (rule.pos == null && rule.minAge == null) return false;
      return posOk && ageOk;
    });
  }, [gmSellPositions, gmSellRulesParsed]);

  // ── Weekly start/sit projections (redraft) — league-scored via App.WeeklyProj.
  // Computed once; the 'proj' column + its sort read it. Neutral matchup until the
  // projections feed lands; guarded so dynasty/offseason rows just render '—'.
  const weeklyLineup = React.useMemo(() => {
    const WP = window.App && window.App.WeeklyProj;
    if (!WP || !myRoster || !currentLeague) return null;
    try {
      const res = WP.optimalForRoster(myRoster, currentLeague, { playersData, statsData, priorData: stats2025Data });
      return { res, starterSet: new Set((res.optimal.starters || []).map(s => String(s.pid))), objective: res.objective };
    } catch (e) { if (window.wrLog) window.wrLog('myteam.weeklyProj', e); return null; }
  }, [myRoster, currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs]);
  const projFor = (pid) => (weeklyLineup && weeklyLineup.res.projections[pid]) || null;

  // Build rest-of-season values for REDRAFT leagues so the value column + sort
  // + coloring reflect ROS production instead of dynasty DHQ. No-op (falls back
  // to DHQ) for dynasty/keeper, offseason, or when no weeks remain.
  React.useMemo(() => {
    try {
      window.App?.PlayerValue?.ensureRos?.({
        leagueId: currentLeague?.league_id || currentLeague?.id,
        league: currentLeague, playersData, statsData, priorData: stats2025Data,
        skin: resolvedLeagueSkin,
      });
    } catch (e) { if (window.wrLog) window.wrLog('myteam.ensureRos', e); }
    return null;
  }, [currentLeague, playersData, statsData, stats2025Data, timeRecomputeTs]);

  // ── filteredAndSortedRows (formerly a sibling function of renderMyTeamTab) ──
  function filteredAndSortedRows(rows) {
    const offPos = new Set(['QB','RB','WR','TE','K','DEF']);
    const idpPos = new Set(['DL','LB','DB']);
    let filtered = rows;
    if (rosterFilter === 'Starters') filtered = rows.filter(r => r.isStarter);
    else if (rosterFilter === 'Bench') filtered = rows.filter(r => !r.isStarter && !r.isIR && !r.isTaxi);
    else if (rosterFilter === 'Taxi') filtered = rows.filter(r => r.isTaxi);
    else if (rosterFilter === 'IR') filtered = rows.filter(r => r.isIR);
    else if (rosterFilter === 'Offense') filtered = rows.filter(r => offPos.has(r.pos));
    else if (rosterFilter === 'IDP') filtered = rows.filter(r => idpPos.has(r.pos));
    else if (rosterFilter === 'Rookies') filtered = rows.filter(r => isRookieRow(r));

    const posOrder = {QB:0,RB:1,WR:2,TE:3,K:4,DEF:5,DL:6,LB:7,DB:8};
    return [...filtered].sort((a, b) => {
      const {key, dir} = rosterSort;
      if (rosterGroupMode !== 'none') {
        const gd = (getRowGroupRank(a) - getRowGroupRank(b)) || String(getRowGroupKey(a)).localeCompare(String(getRowGroupKey(b)));
        if (gd !== 0) return gd;
      }
      if (key === 'dhq') return (b.dhq - a.dhq) * dir;
      if (key === 'age') return ((a.age||99) - (b.age||99)) * dir;
      if (key === 'ppg') {
        // Honor the rolling PPG window so sort order matches what's displayed.
        let av = a.curPPG || 0, bv = b.curPPG || 0;
        if (ppgWindow !== 'season' && typeof window.App?.computeRollingPPG === 'function') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const ra = window.App.computeRollingPPG(a.pid, n);
          const rb = window.App.computeRollingPPG(b.pid, n);
          // Only override if rolling data is available for the player; else fall back to seasonal.
          if (ra > 0) av = ra;
          if (rb > 0) bv = rb;
        }
        return (bv - av) * dir;
      }
      if (key === 'proj') {
        const obj = weeklyLineup?.objective || 'median';
        const pv = r => { const p = projFor(r.pid); return p && p.available ? (p.points[obj] || 0) : -1; };
        return (pv(b) - pv(a)) * dir;
      }
      if (key === 'hi' || key === 'lo') {
        const f = r => window.App?.WeeklyProj?.formStats?.(r.pid, 'season');
        const v = r => { const s = f(r); return s ? (key === 'hi' ? s.high : s.low) : -1; };
        return (v(b) - v(a)) * dir;
      }
      if (key === 'prev') return ((b.prevPPG||0) - (a.prevPPG||0)) * dir;
      if (key === 'trend') return ((b.trend||0) - (a.trend||0)) * dir;
      if (key === 'gp') return ((b.curGP||0) - (a.curGP||0)) * dir;
      if (key === 'durability') return ((b.durabilityGP||0) - (a.durabilityGP||0)) * dir;
      if (key === 'name') { const na = getPlayerName(a.pid).toLowerCase(), nb = getPlayerName(b.pid).toLowerCase(); return (na < nb ? -1 : na > nb ? 1 : 0) * dir; }
      if (key === 'pos') { const d = ((posOrder[a.pos] ?? 99) - (posOrder[b.pos] ?? 99)); return d !== 0 ? d * dir : (b.dhq - a.dhq); }
      if (key === 'peak') return ((b.peakYrsLeft||0) - (a.peakYrsLeft||0)) * dir;
      if (key === 'action') {
        // rec holds mixed-case labels ('Sell High', 'Build Around', 'Hold Core'…) — sort by family, not exact key.
        const fam = r => /sell/i.test(r.rec || '') ? 0 : /stash/i.test(r.rec || '') ? 1 : /buy|build|core/i.test(r.rec || '') ? 3 : 2;
        return (fam(b) - fam(a)) * dir;
      }
      if (key === 'yrsExp') return ((b.p.years_exp||0) - (a.p.years_exp||0)) * dir;
      if (key === 'college') { const ca = (a.p.college||'').toLowerCase(), cb = (b.p.college||'').toLowerCase(); return (ca < cb ? -1 : ca > cb ? 1 : 0) * dir; }
      if (key === 'nflDraft') return (((a.p.draft_round || (a.p.draft_pick ? Math.ceil(a.p.draft_pick/32) : 99)) - (b.p.draft_round || (b.p.draft_pick ? Math.ceil(b.p.draft_pick/32) : 99))) * dir);
      if (key === 'posRankLg') return (a.dhq - b.dhq) * dir; // proxy: higher dhq = better rank
      if (key === 'posRankNfl') return ((a.meta?.fcRank||999) - (b.meta?.fcRank||999)) * dir;
      if (key === 'starterSzn') return ((b.meta?.starterSeasons||0) - (a.meta?.starterSeasons||0)) * dir;
      if (key === 'height') return ((b.p.height||0) - (a.p.height||0)) * dir;
      if (key === 'weight') return ((b.p.weight||0) - (a.p.weight||0)) * dir;
      if (key === 'depthChart') return ((a.p.depth_chart_order||99) - (b.p.depth_chart_order||99)) * dir;
      if (key === 'slot') { const ord = {starter:0,taxi:1,bench:2,ir:3}; return ((ord[a.section]||9) - (ord[b.section]||9)) * dir; }
      if (key === 'acquired') { const aa = getAcquisitionInfo(a.pid, myRoster?.roster_id), ab = getAcquisitionInfo(b.pid, myRoster?.roster_id); return (aa.method < ab.method ? -1 : aa.method > ab.method ? 1 : 0) * dir; }
      if (key === 'acquiredDate') { const aa = getAcquisitionInfo(a.pid, myRoster?.roster_id), ab = getAcquisitionInfo(b.pid, myRoster?.roster_id); return (aa.date < ab.date ? -1 : aa.date > ab.date ? 1 : 0) * dir; }
      if (key === 'sos') {
        const getSosRank = (r) => { const s = window.App?.SOS?.getPlayerSOS?.(r.pid, r.pos, r.p?.team); return s?.avgRank || 16; };
        return (getSosRank(b) - getSosRank(a)) * dir; // higher rank = easier = sort first by default
      }
      // Rookie columns — resolve the prospect record; non-rookies sort last.
      if (key === 'rkSlot' || key === 'rkTeam' || key === 'rkRank' || key === 'rkTier' || key === 'rkProfile') {
        const pa = prospectForRow(a), pb = prospectForRow(b);
        if (key === 'rkTeam') { const ta = (pa?.nflTeam || ''), tb = (pb?.nflTeam || ''); if (!ta !== !tb) return ta ? -dir : dir; return (ta < tb ? -1 : ta > tb ? 1 : 0) * dir; }
        if (key === 'rkSlot') {
          const slot = p => !p ? 1e9 : (Number(p.draftRound) > 0 ? Number(p.draftRound) * 100 + (Number(p.draftPick) || 99) : 9000);
          return (slot(pa) - slot(pb)) * dir;
        }
        if (key === 'rkProfile') {
          const spd = p => { const s = parseFloat(p?.speed); return Number.isFinite(s) && s > 0 ? s : 1e9; };
          return (spd(pa) - spd(pb)) * dir; // faster 40 first on ascending
        }
        // rkRank / rkTier — lower consensus rank is better; non-rookies last.
        const rank = p => (p && (p.consensusRank ?? p.rank) != null) ? Number(p.consensusRank ?? p.rank) : 1e9;
        return (rank(pa) - rank(pb)) * dir;
      }
      return 0;
    });
  }

  if (!myRoster) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;

  // Dynasty (E2): the START/SIT verdict is suppressed at every tier — the Wk
  // column keeps raw pts + matchup grade, and the Redraft preset disappears.
  const wkVerdict = skinFeatures.showWeeklyVerdict !== false;
  const ROSTER_COLUMNS = {
    pos:        { label: 'Position', shortLabel: 'Pos', width: '38px', group: 'core' },
    age:        { label: 'Age', shortLabel: 'Age', width: '38px', group: 'dynasty' },
    dhq:        { label: valueLabel, shortLabel: valueShortLabel, width: '60px', group: 'dynasty' },
    ppg:        { label: 'Points Per Game', shortLabel: 'PPG', width: '48px', group: 'stats' },
    proj:       { label: isPro && wkVerdict ? 'This Week — projected pts + start/sit (league-scored)' : 'This Week — projected pts (league-scored)', shortLabel: 'Wk', width: '62px', group: 'stats' },
    hi:         { label: 'Season High — most fantasy pts in a week', shortLabel: 'Hi', width: '40px', group: 'stats' },
    lo:         { label: 'Season Low — fewest fantasy pts in a played week', shortLabel: 'Lo', width: '40px', group: 'stats' },
    prev:       { label: 'Previous Season PPG', shortLabel: 'Last', width: '44px', group: 'stats' },
    trend:      { label: 'Year-over-Year PPG Change (%) — how this season\u2019s PPG compares to last season\u2019s', shortLabel: 'Trend', width: '52px', group: 'dynasty' },
    peak:       { label: 'Peak Window Phase', shortLabel: 'Peak', width: '50px', group: 'dynasty' },
    action:     { label: 'Trade Recommendation', shortLabel: 'Move', width: '54px', group: 'dynasty' },
    gp:         { label: 'Games Played', shortLabel: 'GP', width: '36px', group: 'stats' },
    durability: { label: 'Durability — games played out of 17 (green=15+, amber=10-14, red=<10)', shortLabel: 'Dur', width: '40px', group: 'stats' },
    yrsExp:     { label: 'Years of Experience', shortLabel: 'Exp', width: '38px', group: 'dynasty' },
    college:    { label: 'College', shortLabel: 'School', width: '82px', group: 'scout' },
    // nflDraft removed — Sleeper doesn't reliably provide draft capital data
    posRankLg:  { label: 'League Position Rank', shortLabel: 'Lg #', width: '46px', group: 'dynasty' },
    posRankNfl: { label: 'NFL Position Rank', shortLabel: 'NFL #', width: '48px', group: 'dynasty' },
    starterSzn: { label: 'Starter Seasons', shortLabel: 'Starts', width: '48px', group: 'dynasty' },
    height:     { label: 'Height', shortLabel: 'Ht', width: '42px', group: 'scout' },
    weight:     { label: 'Weight (lbs)', shortLabel: 'Wt', width: '42px', group: 'scout' },
    depthChart: { label: 'Depth Chart Position', shortLabel: 'Depth', width: '48px', group: 'scout' },
    slot:       { label: 'Roster Slot', shortLabel: 'Slot', width: '48px', group: 'core' },
    acquired:   { label: 'Acquisition Method', shortLabel: 'Added', width: '74px', group: 'core' },
    acquiredDate: { label: 'Date Acquired', shortLabel: 'When', width: '60px', group: 'core' },
    sos:        { label: 'Sched Strength (1=hardest, 32=easiest)', shortLabel: 'SOS', width: '44px', group: 'stats' },
    // Rookie/prospect columns — sourced from the rookie-data record (prospectForRow),
    // NOT the Sleeper object (Sleeper draft capital is unreliable). '—' for vets.
    rkSlot:     { label: 'NFL Draft Slot (rookie)', shortLabel: 'Draft', width: '54px', group: 'scout' },
    rkTeam:     { label: 'Drafted NFL Team (rookie)', shortLabel: 'Drafted', width: '50px', group: 'scout' },
    rkRank:     { label: 'Rookie Consensus Rank', shortLabel: 'Cons #', width: '48px', group: 'scout' },
    rkTier:     { label: 'Rookie Tier', shortLabel: 'Tier', width: '64px', group: 'scout' },
    rkProfile:  { label: 'Rookie Profile (Ht · Wt · 40)', shortLabel: 'Profile', width: '112px', group: 'scout' },
  };
  // Free: the Move/Trade-Recommendation column is a verdict → Pro. Dropping
  // the def removes it everywhere at once — the Customize picker, the 'full'
  // preset (derives from keys), the header + cell render, and persisted
  // column prefs (both filter on ROSTER_COLUMNS[key]) — so a saved custom
  // view can't resurrect it.
  if (!isPro) delete ROSTER_COLUMNS.action;

  // Dynasty (E2): 'proj' leaves the default preset — still user-addable
  // (raw pts; renderCell strips the verdict so saved views can't resurrect it).
  const COLUMN_PRESETS = {
    default: ['pos','age','dhq','posRankLg','ppg',...(wkVerdict ? ['proj'] : []),'durability','peak','action','sos'].filter(k => ROSTER_COLUMNS[k]),
    ...(wkVerdict ? { redraft: ['pos','proj','ppg','prev','trend','hi','lo','sos'] } : {}),
    stats:   ['pos','dhq','ppg','prev','trend','gp','durability','sos'],
    scout:   ['pos','age','college','slot','height','weight','depthChart','yrsExp','starterSzn','posRankNfl'],
    rookie:  ['pos','age','college','rkSlot','rkTeam','rkRank','rkTier','rkProfile'],
    full:    Object.keys(ROSTER_COLUMNS),
  };
  const COLUMN_PRESET_META = {
    default: { label: 'Default', tone: 'decision board' },
    redraft: { label: 'Redraft', tone: 'weekly + form' },
    stats: { label: 'Stats', tone: 'production' },
    scout: { label: 'Scout', tone: 'profile' },
    rookie: { label: 'Rookie', tone: 'prospect profile' },
    full: { label: 'Deep Data', tone: 'all fields' },
  };
  const rosterFilterOptions = [
    'All',
    'Starters',
    'Bench',
    ...(skinFeatures.showTaxi === false ? [] : ['Taxi']),
    'IR',
    'Offense',
    ...(skinFeatures.showIDP === false ? [] : ['IDP']),
    'Rookies',
  ];
  const rosterFilterKey = rosterFilterOptions.join('|');
  React.useEffect(() => {
    if (rosterFilter && !rosterFilterOptions.includes(rosterFilter)) setRosterFilter('All');
  }, [rosterFilter, rosterFilterKey]);

  const allPlayers = myRoster.players || [];
  const starters = new Set(myRoster.starters || []);
  const reserve = new Set(myRoster.reserve || []);
  const taxi = new Set(myRoster.taxi || []);

  const normPos = window.App.normPos;

  // Build enriched player rows
  const rows = allPlayers.map(pid => {
    const p = playersData[pid];
    if (!p) return null;
    const pos = normPos(p.position) || p.position || '?';
    const dhq = window.App?.PlayerValue?.getValue ? window.App.PlayerValue.getValue(pid, { skin: resolvedLeagueSkin }) : (window.App?.LI?.playerScores?.[pid] || 0);
    const meta = window.App?.LI?.playerMeta?.[pid];
    const st = statsData[pid] || {};
    const prev = stats2025Data?.[pid] || {};

    const curPts = calcRawPts(st) || 0;
    const curGP = st.gp || 0;
    const curPPG = curGP > 0 ? +(curPts / curGP).toFixed(1) : 0;

    const prevPts = calcRawPts(prev) || 0;
    const prevGP = prev.gp || 0;
    const prevPPG = prevGP > 0 ? +(prevPts / prevGP).toFixed(1) : 0;

    // Effective PPG: use current season if available, else fallback to previous season
    const effectivePPG = curPPG > 0 ? curPPG : prevPPG;
    const effectiveGP = curGP > 0 ? curGP : prevGP;
    // 2-year rolling average GP for durability (use meta.recentGP if available for longer history)
    const durabilityGP = meta?.recentGP > 0 ? meta.recentGP : (curGP > 0 && prevGP > 0 ? Math.round((curGP + prevGP) / 2) : effectiveGP);

    const trend = meta?.trend || (prevPPG && curPPG ? Math.round((curPPG - prevPPG) / prevPPG * 100) : 0);

    const age = p.age || (p.birth_date ? Math.floor((Date.now() - new Date(p.birth_date).getTime()) / 31557600000) : null);
    const isStarter = starters.has(pid);
    const isIR = reserve.has(pid);
    const isTaxi = taxi.has(pid);
    const section = isStarter ? 'starter' : isIR ? 'ir' : isTaxi ? 'taxi' : 'bench';

    const curve = typeof window.App?.getAgeCurve === 'function'
      ? window.App.getAgeCurve(pos)
      : { build: [22, 24], peak: (window.App.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
    const [pLo, pHi] = curve.peak;
    const declineHi = curve.decline[1];
    const peakRangeHi = Math.max(declineHi + 2, age ? age + 1 : declineHi + 2);
    const peakPct = age ? Math.max(0, Math.min(100, ((age - (pLo-4)) / (peakRangeHi - (pLo-4))) * 100)) : 50;
    const peakPhase = !age ? '\u2014' : age < pLo ? 'PRE' : age <= pHi ? 'PRIME' : age <= declineHi ? 'VET' : 'POST';
    const peakYrsLeft = age ? Math.max(0, pHi - age) : 0;
    const valueYrsLeft = age ? Math.max(0, declineHi - age) : 0;

    const _pidElite = typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(pid) : dhq >= 7000;
    // Recommendation for MY roster — shared getPlayerAction() with simplified
    // fallback. Free: rec stays null (the seeded fallback is a rec too), so
    // every consumer — Move column, row tints, Action lens, dossier call,
    // dynasty-read clause — degrades to raw-only even if a gate is missed.
    const pa = isPro && typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
    let rec = !isPro ? null : pa ? pa.label : (valueYrsLeft <= 0 ? 'Sell' : _pidElite && peakYrsLeft >= 3 ? 'Hold Core' : peakYrsLeft >= 4 && dhq < 4000 ? 'Stash' : 'Hold');
    // Action family code (SELL_HIGH vs SELL etc.) — the dossier's market-posture
    // sub-line keys off this so a "past value window" Sell never reads "sell high".
    let recAction = !isPro ? null : pa ? pa.action : (valueYrsLeft <= 0 ? 'SELL' : _pidElite && peakYrsLeft >= 3 ? 'CORE' : peakYrsLeft >= 4 && dhq < 4000 ? 'STASH' : 'HOLD');

    // GM Strategy nudge — a VISUAL flag over the engine verdict. getPlayerAction
    // is now strategy-aware and returns GM-steered sells with a 'GM plan:'
    // reason; detect those so the flag survives. The local gmTripsSell steer
    // remains only for the simplified fallback rec (engine not loaded).
    // Pro-only (Q8): it marks/steers the app's verdict, unlike passive accents.
    const gmIsUntouchable = gmUntouchable.has(String(pid));
    const gmEngineNudge = !!(pa && /^GM plan/i.test(pa.reason || '') && /SELL/i.test(pa.action || ''));
    const gmSellNudge = isPro && !gmIsUntouchable && (gmEngineNudge || (!/sell|buy|build|core/i.test(rec) && gmTripsSell({ pos, age })));
    if (gmSellNudge && !/sell/i.test(rec)) { rec = 'Sell'; recAction = 'SELL'; }
    const gmIsTarget = gmTargetPositions.has(String(pos));
    const gmIsSellPos = gmSellPositions.has(String(pos));

    return { pid, p, pos, dhq, age, curPPG, prevPPG, effectivePPG, effectiveGP, prevGP, durabilityGP, trend, isStarter, isIR, isTaxi, section, peakPhase, peakPct, peakYrsLeft, valueYrsLeft, rec, recAction, curGP, meta, injury: p.injury_status, gmIsUntouchable, gmSellNudge, gmIsTarget, gmIsSellPos };
  }).filter(Boolean);

  // Position-level PPG percentiles for color coding
  const posPPGs = {};
  rows.forEach(r => {
    if (!posPPGs[r.pos]) posPPGs[r.pos] = [];
    if (r.curPPG > 0) posPPGs[r.pos].push(r.curPPG);
  });
  const posP75 = {}, posP25 = {};
  Object.entries(posPPGs).forEach(([pos, vals]) => {
    vals.sort((a,b) => a-b);
    posP75[pos] = vals[Math.floor(vals.length * 0.75)] || 10;
    posP25[pos] = vals[Math.floor(vals.length * 0.25)] || 5;
  });

  // Cell background helpers (FM-style colored cells)
  const dhqBg = () => 'transparent';
  const dhqCol = v => v > 0 ? 'var(--white)' : 'var(--ov-7, rgba(255,255,255,0.25))';
  const ageBg = () => 'transparent';
  const ageCol = () => 'var(--silver)';
  const ppgBg = () => 'transparent';
  const trendBg = () => 'transparent';
  const posColors = window.App.POS_COLORS;

  // Drop candidate PIDs: non-starters with lowest DHQ (bottom 3 bench players)
  const dropCandidatePids = React.useMemo(() => {
    const benchPlayers = rows.filter(r => !r.isStarter && !r.isIR && !r.isTaxi)
      .sort((a, b) => a.dhq - b.dhq).slice(0, 3);
    return new Set(benchPlayers.map(r => r.pid));
  }, [rows]);

  // Dismissed drop alerts (persisted in localStorage per league)
  const [dismissedDrops, setDismissedDrops] = React.useState(() => {
    try {
      const leagueId = currentLeague?.id || currentLeague?.league_id || '';
      const stored = localStorage.getItem('wr_dismissed_drops_' + leagueId);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  // Rolling PPG window — persisted per-user. 'season' = full season-to-date,
  // 'l5' / 'l3' = last N games computed from window.App.computeRollingPPG
  // (populated once wr:weekly-points-loaded fires).
  const [ppgWindow, setPpgWindow] = React.useState(() => {
    try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {}
  }, [ppgWindow]);
  const [rowDensity, setRowDensity] = React.useState(() => {
    try { return localStorage.getItem('wr_roster_density') || 'comfortable'; } catch { return 'comfortable'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_roster_density', rowDensity); } catch {}
  }, [rowDensity]);
  const [rosterGroupMode, setRosterGroupMode] = React.useState(() => {
    try { return localStorage.getItem('wr_roster_group_mode') || 'position'; } catch { return 'position'; }
  });
  React.useEffect(() => {
    try { localStorage.setItem('wr_roster_group_mode', rosterGroupMode); } catch {}
  }, [rosterGroupMode]);
  // Free: the Action grouping lens organizes the board by verdict → Pro.
  // Clamp a persisted pick back to position (the option is also filtered out
  // of GROUP_MODES below). Safe pre-clamp render: free rows carry rec=null,
  // so the lens has no verdicts to reveal.
  React.useEffect(() => {
    if (!isPro && rosterGroupMode === 'action') setRosterGroupMode('position');
  }, [isPro, rosterGroupMode]);
  const [, forceAcquisitionRerender] = React.useState(0);
  // Force a re-render when weekly points become available so rolling-PPG cells update.
  const [, forcePpgRerender] = React.useState(0);
  React.useEffect(() => {
    const h = () => forcePpgRerender(n => n + 1);
    window.addEventListener('wr:weekly-points-loaded', h);
    return () => window.removeEventListener('wr:weekly-points-loaded', h);
  }, []);

  // Dynasty Read AI — paid-tier web-search news synthesis, fired only for the
  // currently expanded row (one open at a time), template-first. Result is keyed
  // by pid; the shared weekly cache means repeat opens are an instant hit.
  const [aiReads, setAiReads] = React.useState({});
  // The clamp+fade+"Full read" disclosure that used to live here was extracted
  // to the shared WR.ClampedRead (js/components/wr-primitives.js); it measures
  // its own overflow and remounts (collapsed) per expanded row.
  // Track the roster board's VISIBLE width so the expand card pins to the viewport
  // instead of stretching to the full (horizontally-scrolling) table width.
  const boardScrollRef = React.useRef(null);
  const [boardWidth, setBoardWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    const measure = () => setBoardWidth(el.clientWidth);
    measure();
    let ro;
    if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(measure); ro.observe(el); }
    window.addEventListener('resize', measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  React.useEffect(() => {
    const pid = expandedPid;
    // Free: never auto-fire dynasty_read on row expand — BYOK routes (S.apiKey
    // → callClaude) bypass the OD.callAI tripwire, so the trigger itself must
    // gate. The seeded buildDynastyRead template below still renders.
    if (!isPro) return;
    if (!pid || aiReads[pid] || typeof window.fetchDynastyRead !== 'function') return;
    const p = playersData?.[pid];
    if (!p) return;
    let alive = true;
    const nfl = window.S?.nflState || {};
    const ctx = {
      pid,
      name: p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim(),
      team: p.team || '',
      pos: (window.App?.normPos ? window.App.normPos(p.position) : p.position) || '',
      age: p.age || null,
      season: nfl.season || '',
      week: nfl.display_week || nfl.week || 0,
    };
    // Debounce: only fetch after the row stays expanded briefly, so quickly
    // expanding/collapsing rows doesn't fire a scouting call per glance.
    const timer = setTimeout(() => {
      window.fetchDynastyRead(ctx, { fallback: '' }).then((txt) => {
        if (alive && txt) setAiReads(prev => (prev[pid] ? prev : { ...prev, [pid]: txt }));
      });
    }, 600);
    return () => { alive = false; clearTimeout(timer); };
  }, [expandedPid]);
  const dismissDrop = React.useCallback((pid) => {
    const playerName = window.App?.playersData?.[pid]?.full_name || pid;
    setDismissedDrops(prev => {
      const next = new Set(prev);
      next.add(pid);
      try {
        const leagueId = currentLeague?.id || currentLeague?.league_id || '';
        localStorage.setItem('wr_dismissed_drops_' + leagueId, JSON.stringify([...next]));
      } catch {}
      return next;
    });
    window.wrLogAction?.('\uD83D\uDEAB', 'Dismissed drop alert for ' + playerName, 'roster', { players: [{ name: playerName, pid: pid }], actionType: 'dismiss-drop' });
  }, [currentLeague]);

  const GROUP_MODES = [
    { key: 'position', label: 'Position' },
    { key: 'slot', label: 'Slot' },
    { key: 'action', label: 'Action' },
    { key: 'age', label: 'Age' },
    { key: 'peak', label: 'Peak' },
    { key: 'none', label: 'None' },
  ].filter(g => isPro || g.key !== 'action'); // Action lens = verdict grouping → Pro
  const activeGroupModeLabel = GROUP_MODES.find(g => g.key === rosterGroupMode)?.label || 'Position';
  const slotOrder = { starter: 0, bench: 1, taxi: 2, ir: 3 };
  const recGroup = (rec) => /sell/i.test(rec || '') ? 'Sell'
    : /buy|build|core/i.test(rec || '') ? 'Build'
    : /stash/i.test(rec || '') ? 'Stash'
    : 'Hold';
  const getAgeBand = (r) => !r.age ? 'Unknown' : r.age <= 24 ? 'Youth' : r.age <= 29 ? 'Prime' : r.age <= 32 ? 'Veteran' : 'Post';
  const getRowGroupKey = (r) => {
    if (rosterGroupMode === 'none') return 'all';
    if (rosterGroupMode === 'slot') return r.section;
    if (rosterGroupMode === 'action') return recGroup(r.rec).toLowerCase();
    if (rosterGroupMode === 'age') return getAgeBand(r).toLowerCase();
    if (rosterGroupMode === 'peak') return (r.peakPhase || 'unknown').toLowerCase();
    return r.pos || '?';
  };
  const getRowGroupLabel = (r) => {
    if (rosterGroupMode === 'slot') return r.section === 'starter' ? 'Starters' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench';
    if (rosterGroupMode === 'action') return recGroup(r.rec);
    if (rosterGroupMode === 'age') return getAgeBand(r);
    if (rosterGroupMode === 'peak') return r.peakPhase || 'Unknown';
    return r.pos || '?';
  };
  const getRowGroupRank = (r) => {
    const posRank = {QB:0,RB:1,WR:2,TE:3,K:4,DL:5,LB:6,DB:7};
    const actionRank = { build: 0, hold: 1, stash: 2, sell: 3 };
    const ageRank = { youth: 0, prime: 1, veteran: 2, post: 3, unknown: 4 };
    const peakRank = { pre: 0, prime: 1, vet: 2, post: 3, unknown: 4 };
    if (rosterGroupMode === 'slot') return slotOrder[r.section] ?? 9;
    if (rosterGroupMode === 'action') return actionRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'age') return ageRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'peak') return peakRank[getRowGroupKey(r)] ?? 9;
    if (rosterGroupMode === 'none') return 0;
    return posRank[r.pos] ?? 99;
  };
  // Group dividers use the single gold accent for structure — no per-group rainbow.
  const getRowGroupColor = () => 'var(--gold)';

  const filtered = filteredAndSortedRows(rows);
  const filteredPosCounts = filtered.reduce((acc, r) => {
    const key = getRowGroupKey(r);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const rosterTagMeta = {
    trade: { bg: 'rgba(240,165,0,0.13)', col: 'var(--warn)', lbl: 'Trade' },
    cut: { bg: 'rgba(231,76,60,0.13)', col: 'var(--bad)', lbl: 'Cut' },
    untouchable: { bg: 'rgba(46,204,113,0.13)', col: 'var(--good)', lbl: 'Core' },
    watch: { bg: 'rgba(52,152,219,0.13)', col: 'var(--k-3498db, #3498db)', lbl: 'Watch' },
  };
  const slotTagMeta = {
    starter: { bg: 'var(--ov-3, rgba(255,255,255,0.045))', col: 'var(--white)', lbl: 'STR' },
    bench: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'BN' },
    taxi: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'TAX' },
    ir: { bg: 'var(--ov-2, rgba(255,255,255,0.03))', col: 'var(--silver)', lbl: 'IR' },
  };
  const inlineTag = (cfg, key) => cfg ? (
    <span key={key} style={{
      fontSize: 'var(--text-micro, 0.6875rem)',
      padding: '2px 5px',
      borderRadius: '4px',
      fontWeight: 600,
      background: cfg.bg,
      color: cfg.col,
      border: '1px solid ' + wrAlpha(cfg.col, '33'),
      flexShrink: 0,
      lineHeight: 1,
      letterSpacing: '0.035em',
      textTransform: 'uppercase',
    }}>{cfg.lbl}</span>
  ) : null;

  const controlBtn = (active) => ({
    padding: '6px 11px',
    fontSize: '0.72rem',
    fontWeight: active ? 800 : 650,
    fontFamily: 'var(--font-body)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: active ? 'var(--gold)' : 'var(--ov-3, rgba(255,255,255,0.045))',
    color: active ? 'var(--black)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--gold)' : 'var(--ov-5, rgba(255,255,255,0.09))'),
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  // Compact dropdown used across the roster toolbar (mirrors free-agency's rkSelectStyle).
  const rosterSelectStyle = (active) => ({
    padding: '4px 6px',
    minHeight: '44px',
    fontSize: '0.72rem',
    fontFamily: 'var(--font-body)',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    background: active ? 'var(--acc-fill2, rgba(212,175,55,0.13))' : 'var(--ov-3, rgba(255,255,255,0.045))',
    color: active ? 'var(--gold)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--acc-line3, rgba(212,175,55,0.4))' : 'var(--ov-6, rgba(255,255,255,0.1))'),
    borderRadius: '6px',
    cursor: 'pointer',
    outline: 'none',
    minWidth: 0,
  });
  const groupLabelStyle = { fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, whiteSpace: 'nowrap' };
  const sameColumnSet = (a, b) => a.length === b.length && a.every((key, idx) => key === b[idx]);
  const activePresetKey = Object.entries(COLUMN_PRESETS).find(([, cols]) => sameColumnSet(cols, visibleCols))?.[0] || 'custom';
  const activePresetMeta = COLUMN_PRESET_META[activePresetKey] || { label: 'Custom', tone: visibleCols.length + ' fields' };
  const isDeepData = activePresetKey === 'full';
  // Shared viewport seam (js/shared/viewport.js) — one debounced app-wide
  // listener; thresholds below (560/820/834/1023) are unchanged.
  const rosterViewportWidth = window.WR.useViewport().width;
  const isNarrowRoster = rosterViewportWidth <= 560;
  const isTabletRoster = rosterViewportWidth > 560 && rosterViewportWidth <= 1023;
  // iPad/phone: collapse the Scope/View/PPG/Rows/Group control stack behind a
  // single "Filters" bar so it stops eating ~400px above the roster table.
  const isCompactRoster = rosterViewportWidth <= 1023;
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  // Filtering visibleCols on ROSTER_COLUMNS here is what keeps a persisted
  // 'action' pref from rendering for free (its def is deleted above); the
  // narrow 3-col set swaps the Move slot for 'peak' on free.
  const rosterTableCols = (isNarrowRoster
    ? ['pos', 'dhq', isPro ? 'action' : 'peak']
    : visibleCols).filter(key => ROSTER_COLUMNS[key]);
  const visibleColGroupStarts = new Set();
  rosterTableCols.forEach((key, idx) => {
    const prev = rosterTableCols[idx - 1];
    if (idx > 0 && ROSTER_COLUMNS[key]?.group !== ROSTER_COLUMNS[prev]?.group) visibleColGroupStarts.add(key);
  });
  const isCompactRows = rowDensity === 'compact' || isNarrowRoster;
  const rowHeight = isCompactRows ? 38 : 46;
  const avatarSize = isNarrowRoster ? 22 : (isCompactRows ? 26 : 30);
  const playerNameSize = isNarrowRoster ? '0.74rem' : (isCompactRows ? '0.78rem' : '0.84rem');
  const columnGroups = ['core', 'dynasty', 'stats', 'scout'].map(group => ({
    group,
    columns: Object.entries(ROSTER_COLUMNS).filter(([, col]) => col.group === group),
  })).filter(g => g.columns.length > 0);
  const playerColWidth = isNarrowRoster ? 156 : isTabletRoster ? 220 : 292;
  const visibleDataWidth = rosterTableCols.reduce((sum, key) => sum + parseInt(ROSTER_COLUMNS[key]?.width || '0', 10), 0);
  const tableMinWidth = playerColWidth + visibleDataWidth;
  const setCustomColumns = (updater) => {
    setVisibleCols(prev => typeof updater === 'function' ? updater(prev) : updater);
    setColPreset('custom');
  };
  const moveVisibleColumn = (key, delta) => {
    setCustomColumns(prev => {
      const idx = prev.indexOf(key);
      if (idx < 0) return prev;
      const nextIdx = Math.max(0, Math.min(prev.length - 1, idx + delta));
      if (nextIdx === idx) return prev;
      const next = prev.slice();
      const [item] = next.splice(idx, 1);
      next.splice(nextIdx, 0, item);
      return next;
    });
  };
  const removeVisibleColumn = (key) => setCustomColumns(prev => prev.filter(c => c !== key));
  const addVisibleColumn = (key) => setCustomColumns(prev => prev.includes(key) ? prev : [...prev, key]);
  const activeColumnOrder = visibleCols.filter(key => ROSTER_COLUMNS[key]);
  const inactiveColumnCount = Object.keys(ROSTER_COLUMNS).filter(key => !visibleCols.includes(key)).length;
  const formatHeight = h => h ? Math.floor(h / 12) + "'" + h % 12 + '"' : null;
  const _slotLabel = r => r.section === 'starter' ? 'Starter' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench';
  const getLeaguePositionRank = r => {
    const allAtPos = (currentLeague.rosters || []).flatMap(ros => (ros.players || []).filter(pid => {
      const pp = playersData[pid];
      return pp && (normPos(pp.position) === r.pos);
    })).map(pid => ({ pid, dhq: window.App?.LI?.playerScores?.[pid] || 0 })).sort((a, b) => b.dhq - a.dhq);
    const rank = allAtPos.findIndex(x => x.pid === r.pid) + 1;
    return rank > 0 ? rank : null;
  };
  const dynastyTierLabel = r => (typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(r.pid) : r.dhq >= 7000) ? 'elite asset'
    : r.dhq >= 4000 ? 'starter-grade asset'
    : r.dhq >= 2000 ? 'depth asset'
    : 'stash-level asset';
  const buildDynastyRead = r => {
    const rank = getLeaguePositionRank(r);
    // Unscored players get a neutral opener — no tier verdict fabricated from a missing score.
    const valueLine = r.dhq > 0
      ? r.dhq.toLocaleString() + ' ' + valueShortLabel + (rank ? ' and ' + r.pos + rank + ' in this league' : '') + ' makes him a ' + dynastyTierLabel(r) + '.'
      : 'No ' + valueShortLabel + ' score yet — judge on role and production.';
    const productionLine = r.effectivePPG ? r.effectivePPG + ' PPG across ' + (r.effectiveGP || 0) + ((r.effectiveGP || 0) === 1 ? ' game' : ' games') : 'No stable recent production sample';
    const ageLine = r.age ? 'Age ' + r.age + ' is ' + (r.peakPhase === 'PRE' ? 'before the prime window' : r.peakPhase === 'PRIME' ? 'inside the prime window' : r.peakPhase === 'VET' ? 'in the veteran value band' : 'past the normal value window') : 'Age window unknown';
    const trendLine = r.trend >= 15 ? 'production is rising' : r.trend <= -15 ? 'production is sliding' : 'production is steady';
    // Free: the "roster call is X" clause is a verdict — the raw restatement
    // (value, tier-from-value, production, age window, trend) stays.
    const recClause = isPro
      ? ', so the current roster call is ' + String(r.rec || 'Hold').toLowerCase() + ' while ' + trendLine
      : ', and ' + trendLine;
    return valueLine + ' ' + productionLine + '; ' + ageLine + recClause + '.';
  };

  // renderCell — renders each data cell with FM-style coloring
  function renderCell(colKey, r) {
    const col = ROSTER_COLUMNS[colKey];
    const isGroupStart = visibleColGroupStarts.has(colKey);
    const base = { width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCompactRows ? '0.73rem' : '0.78rem', padding: '0 5px', borderLeft: isGroupStart ? '1px solid var(--acc-fill2, rgba(212,175,55,0.12))' : '1px solid var(--ov-1, rgba(255,255,255,0.024))', color: 'rgba(235,235,240,0.78)', lineHeight: 1.1 };

    switch(colKey) {
      case 'proj': {
        const p = projFor(r.pid);
        if (!p) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.45 }}>{'—'}</span></div>;
        if (!p.available) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--warn)', opacity: 0.85, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.03em' }}>{p.injuryStatus || 'OUT'}</span></div>;
        const obj = weeklyLineup?.objective || 'median';
        const pts = p.points[obj] || 0;
        const isStart = !!(weeklyLineup && weeklyLineup.starterSet.has(String(r.pid)));
        const g = p.matchupGrade;
        const gcol = g === 'A' ? 'var(--good)' : g === 'B' ? 'var(--gold)' : g === 'D' ? 'var(--warn)' : g === 'F' ? 'var(--bad)' : 'var(--silver)';
        // Free: raw projected pts keep rendering; START/SIT (optimizer output)
        // + matchup grade (interpretive read) are the Pro line. Dynasty (E2):
        // only the START/SIT verdict is suppressed — Pro keeps the matchup
        // grade, and saved views keep the raw pts.
        return <div key={colKey} style={{...base, flexDirection: 'column', gap: '0px'}} title={'Projected ' + pts.toFixed(1) + ' pts' + (isPro ? ' · matchup ' + g : '') + (p.opponent && p.opponent.abbr ? ' vs ' + p.opponent.abbr : '')}>
          <span style={{ color: 'var(--white)', fontWeight: 600, fontSize: '0.76rem', fontFamily: 'var(--font-body)' }}>{pts > 0 ? pts.toFixed(1) : '—'}</span>
          {isPro && <span style={{ fontSize: '0.54rem', fontWeight: 700, letterSpacing: '0.03em', color: wkVerdict ? (isStart ? 'var(--good)' : 'var(--silver)') : gcol }}>{wkVerdict ? (isStart ? 'START' : 'SIT') : ''}<span style={{ color: gcol, marginLeft: wkVerdict ? '3px' : '0px' }}>{g}</span></span>}
        </div>;
      }
      case 'hi': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return <div key={colKey} style={{...base}}><span style={{ color: fs ? 'var(--good, #2ecc71)' : 'var(--silver)', opacity: fs ? 1 : 0.45, fontWeight: 550 }}>{fs ? fs.high.toFixed(1) : '—'}</span></div>; }
      case 'lo': { const fs = window.App?.WeeklyProj?.formStats?.(r.pid, 'season'); return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: fs ? 0.85 : 0.45 }}>{fs ? fs.low.toFixed(1) : '—'}</span></div>; }
      case 'pos': return <div key={colKey} style={{...base}}><span style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 550, color: 'var(--silver)' }}>{window.App?.posLabel?.(r.pos) || (r.pos === 'DEF' ? 'D/ST' : r.pos)}</span></div>;
      case 'age': return <div key={colKey} style={{...base, background: ageBg(r.age, r.pos)}}><span style={{ color: ageCol(r.age, r.pos), fontWeight: 550 }}>{r.age||'\u2014'}</span></div>;
      case 'dhq': {
        // Redraft \u2192 show projected rest-of-season POINTS (tier-colored by the
        // scaled value r.dhq). Dynasty/keeper \u2192 the scaled value as before.
        const rosPts = (resolvedLeagueSkin?.type === 'redraft' && window.App?.PlayerValue?.getRosPoints) ? window.App.PlayerValue.getRosPoints(r.pid) : null;
        const showRos = rosPts != null;
        const disp = showRos ? (rosPts > 0 ? Math.round(rosPts).toLocaleString() : '\u2014') : (r.dhq > 0 ? r.dhq.toLocaleString() : '\u2014');
        const title = showRos ? ('\u2248 ' + Math.round(rosPts) + ' projected pts rest-of-season') : '';
        return <div key={colKey} style={{...base, background: dhqBg(r.dhq)}} title={title}><span style={{ color: dhqCol(r.dhq), fontWeight: 600, fontFamily: 'var(--font-body)', fontSize: '0.78rem' }}>{disp}</span></div>;
      }
      case 'ppg': {
        // Rolling PPG override — swap in last-N-games PPG when user toggled the window.
        // If a window is active but weekly data isn't ready for this player, fall back
        // to seasonal and mark the cell "· Szn" so the user knows it's not rolling.
        let shown = r.effectivePPG;
        let marker = r.curPPG === 0 && r.prevPPG > 0 ? '*' : '';
        if (ppgWindow !== 'season') {
          const n = ppgWindow === 'l3' ? 3 : 5;
          const rolling = typeof window.App?.computeRollingPPG === 'function'
            ? window.App.computeRollingPPG(r.pid, n)
            : 0;
          if (rolling > 0) { shown = rolling; marker = ' · L' + n; }
          else { marker = ' · Szn'; }
        }
        return <div key={colKey} style={{...base, background: ppgBg(shown, r.pos)}}><span style={{ color: 'var(--silver)', fontWeight: 500 }}>{shown > 0 ? shown : '\u2014'}{marker}</span></div>;
      }
      case 'prev': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.6 }}>{r.prevPPG > 0 ? r.prevPPG : '\u2014'}</span></div>;
      case 'trend': {
        const trendBars = (() => {
          const t = r.trend || 0;
          const up = t > 0;
          const color = 'var(--silver)';
          const heights = up ? [4, 6, 8, 11, 14] : t < 0 ? [14, 11, 8, 6, 4] : [8, 9, 10, 9, 8];
          return React.createElement('div', { className: 'wr-spark' }, ...heights.map((h, i) => React.createElement('div', { key: i, className: 'wr-spark-bar', style: { height: h + 'px', background: color } })));
        })();
        return <div key={colKey} style={{...base, background: trendBg(r.trend), flexDirection: 'column', gap: '1px'}}>
          <span style={{ color: 'var(--silver)', fontWeight: 550, fontSize: '0.7rem' }}>{r.trend>0?'+'+r.trend+'%':r.trend<0?r.trend+'%':'\u2014'}</span>
          {trendBars}
        </div>;
      }
		      case 'peak': return <div key={colKey} style={{...base, flexDirection: 'column', gap: '1px'}}>
		        <span style={{ fontSize: '0.7rem', fontWeight: 550, color: 'var(--silver)' }}>{r.peakPhase}</span>
        <div style={{ width: '30px', height: '3px', borderRadius: '1px', background: 'var(--ov-4, rgba(255,255,255,0.06))', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position:'absolute',left:r.peakPct+'%',top:'-1px',width:'2px',height:'5px',background:'var(--silver)',borderRadius:'1px' }}></div>
        </div>
      </div>;
      case 'action': {
        const ann = getPlayerAnnotation(r.pid);
        const gmNudgeTitle = r.gmSellNudge ? 'Nudged to Sell by GM Strategy (position/age trips a sell rule)' : '';
        // Retired / no-longer-active players (Sleeper active:false) can't help
        // you — the move is simply to cut them.
        const isRetired = r.p && r.p.active === false;
        if (isRetired) {
          return <div key={colKey} style={{...base, flexDirection:'column', gap:'2px', alignItems:'center'}} title="Player is no longer active in the NFL — cut to free the roster spot">
            <span style={{ fontSize:'var(--text-micro, 0.6875rem)', fontWeight:800, textTransform:'uppercase', letterSpacing:'0.04em', color:'var(--bad)' }}>Cut</span>
          </div>;
        }
        return <div key={colKey} style={{...base, flexDirection:'column', gap:'2px', alignItems:'center'}} title={gmNudgeTitle || ann?.text || ''}>
          <span style={{ fontSize:'var(--text-micro, 0.6875rem)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.03em',color:/sell/i.test(r.rec)?'var(--bad)':/buy|build|core/i.test(r.rec)?'var(--good)':'var(--silver)' }}>{r.rec}</span>
          {r.gmSellNudge && <span style={{ fontSize: '0.56rem', fontWeight: 800, color: 'var(--warn)', letterSpacing: '0.05em', opacity: 0.85, lineHeight: 1 }}>GM</span>}
        </div>;
      }
      case 'gp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.74rem' }}>{r.effectiveGP > 0 ? r.effectiveGP : '\u2014'}{r.curGP === 0 && r.prevGP > 0 ? '*' : ''}</span></div>;
      case 'durability': { const gpForDur = r.durabilityGP || 0; return <div key={colKey} style={{...base}} title={'Avg GP: ' + gpForDur + '/17'}><div style={{ width:'24px',height:'4px',borderRadius:'2px',background:'var(--ov-4, rgba(255,255,255,0.06))',overflow:'hidden' }}><div style={{ width:Math.min(100,(gpForDur/17)*100)+'%',height:'100%',background:'var(--silver)',opacity:0.7,borderRadius:'2px' }}></div></div></div>; }
      case 'yrsExp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{r.p.years_exp ?? '\u2014'}</span></div>;
      case 'college': return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.p.college || '\u2014'}</span></div>;
      case 'nflDraft': { const dr = r.p.draft_round; const dp = r.p.draft_pick; const dy = r.p.draft_year; const dRound = dr || (dp ? Math.ceil(dp / 32) : null); const draftLabel = dRound ? (dy ? "'" + String(dy).slice(2) + ' ' : '') + 'Rd ' + dRound + (dp ? '.' + ((dp - 1) % 32 + 1) : '') : (r.p.undrafted === true || (r.p.years_exp > 0 && !dp && !dr) ? 'UDFA' : '\u2014'); return <div key={colKey} style={{...base}}><span style={{ color: dRound ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: '0.74rem' }}>{draftLabel}</span></div>; }
      case 'posRankLg': {
        const rank = getLeaguePositionRank(r);
        return <div key={colKey} style={{...base}}><span style={{ color: rank && rank<=3?'var(--white)':'var(--silver)', fontWeight: 450 }}>{rank ? '#'+rank : '\u2014'}</span></div>;
      }
      case 'posRankNfl': {
        const meta = r.meta;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{meta?.fcRank ? '#'+meta.fcRank : '\u2014'}</span></div>;
      }
      case 'starterSzn': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontWeight: 500 }}>{r.meta?.starterSeasons ?? '\u2014'}</span></div>;
      case 'height': {
        const h = r.p.height;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{h ? Math.floor(h/12)+"'"+h%12+'"' : '\u2014'}</span></div>;
      }
      case 'weight': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{r.p.weight || '\u2014'}</span></div>;
      case 'depthChart': return <div key={colKey} style={{...base}}><span style={{ color: r.p.depth_chart_order != null ? 'var(--silver)' : 'var(--ov-8, rgba(255,255,255,0.3))', fontSize: '0.72rem' }}>{r.p.depth_chart_order != null ? r.pos + (r.p.depth_chart_order + 1) : (r.section === 'ir' ? 'IR' : (!r.p.team || r.p.team === 'FA') ? 'FA' : 'N/A')}</span></div>;
      case 'slot': return <div key={colKey} style={{...base}}><span style={{ fontSize:'0.76rem',color:'var(--silver)',opacity:0.65,textTransform:'uppercase' }}>{r.section==='starter'?'STR':r.section==='ir'?'IR':r.section==='taxi'?'TAX':'BN'}</span></div>;
      case 'acquired': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const col = 'var(--silver)';
        const methods = ['Drafted', 'Traded', 'Waiver', 'FA', 'Original'];
        return <div key={colKey} style={{...base}}><span
          style={{ fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 600, color: col, padding: '1px 5px', borderRadius: '3px', border: `1px solid ${col}40`, background: `${col}10`, cursor: 'pointer' }}
          title="Click to change acquisition method"
          onClick={e => {
            e.stopPropagation();
            const curIdx = methods.indexOf(acq.method);
            const next = methods[(curIdx + 1) % methods.length];
            try {
              const overrides = JSON.parse(localStorage.getItem('wr_acquired_overrides') || '{}');
              overrides[r.pid] = { method: next, date: acq.date || '\u2014', cost: '' };
              localStorage.setItem('wr_acquired_overrides', JSON.stringify(overrides));
              forceAcquisitionRerender(n => n + 1);
            } catch {}
          }}
        >{acq.method}{acq.cost ? ' ' + acq.cost : ''}</span></div>;
      }
      case 'acquiredDate': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const show = acq.date && acq.date !== '\u2014' ? acq.date : '';
        return <div key={colKey} style={{...base}}><span style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.8 }}>{show || '\u2014'}</span></div>;
      }
      case 'sos': {
        const sosMod = window.App?.SOS;
        if (!sosMod?.ready) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))', fontSize: '0.72rem' }}>{'\u2014'}</span></div>;
        const team = r.p?.team;
        if (!team || team === 'FA') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))' }}>{'\u2014'}</span></div>;
        const sos = sosMod.getPlayerSOS(r.pid, r.pos, team);
        if (!sos) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-7, rgba(255,255,255,0.2))' }}>{'\u2014'}</span></div>;
        return <div key={colKey} style={{...base, flexDirection: 'column', gap: '1px'}} title={sos.label + ' schedule (' + sos.avgRank + '/32)'}>
          <span style={{ color: 'var(--silver)', fontWeight: 600, fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>{sos.avgRank}</span>
          <span style={{ color: 'var(--silver)', fontSize: 'var(--text-micro, 0.6875rem)', opacity: 0.7 }}>{sos.label.toUpperCase()}</span>
        </div>;
      }
      case 'rkSlot': case 'rkTeam': case 'rkRank': case 'rkTier': case 'rkProfile': {
        const rf = window.App?.RookieFields?.fields?.(prospectForRow(r)) || null;
        if (!rf) return <div key={colKey} style={{...base}}><span style={{ color: 'var(--ov-8, rgba(255,255,255,0.3))' }}>{'\u2014'}</span></div>;
        if (colKey === 'rkSlot') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.74rem', fontWeight: 600 }}>{rf.draftSlot || '\u2014'}</span></div>;
        if (colKey === 'rkTeam') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{rf.nflTeam || '\u2014'}</span></div>;
        if (colKey === 'rkRank') return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontFamily: 'var(--font-mono)' }}>{rf.consensusRank != null ? rf.consensusRank : '\u2014'}</span></div>;
        if (colKey === 'rkTier') return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontWeight: 600, fontSize: '0.72rem' }}>{rf.tierLabel || '\u2014'}</span></div>;
        return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span title={rf.profile} style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rf.profile || '\u2014'}</span></div>;
      }
      default: return <div key={colKey} style={{...base}}>{'\u2014'}</div>;
    }
  }

  return (
    <div style={{ padding: 'var(--card-pad, 16px 18px)', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {isCompactRoster && (() => {
        const ppgLabelMap = { season: 'Season', l5: 'L5', l3: 'L3' };
        const rowLabelMap = { comfortable: 'Comfort', compact: 'Compact' };
        const groupLabel = (GROUP_MODES.find(g => g.key === rosterGroupMode) || {}).label || 'None';
        const viewLabel = (COLUMN_PRESET_META[activePresetKey] || {}).label || activePresetKey;
        const summary = [rosterFilter, viewLabel, ppgLabelMap[ppgWindow] || ppgWindow, rowLabelMap[rowDensity] || rowDensity, groupLabel].join(' · ');
        return (
          <button onClick={() => setFiltersOpen(o => !o)} aria-expanded={filtersOpen} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--surf-solid, rgba(20,20,26,0.72))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius)', padding: '10px 12px', minHeight: '44px', cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em', flexShrink: 0 }}>Filters</span>
            {!filtersOpen && <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}>{summary}</span>}
            <span style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, whiteSpace: 'nowrap', flexShrink: 0 }}>{filtered.length}/{allPlayers.length}</span>
            <span style={{ color: 'var(--gold)', fontSize: 'var(--text-body, 1rem)', flexShrink: 0, transition: 'transform 0.15s', transform: filtersOpen ? 'rotate(180deg)' : 'none' }}>{'▾'}</span>
          </button>
        );
      })()}

      {/* Phone (≤767): the expanded filter row must wrap — 6 selects + Customize
          + SavedViewBar are ~700px of nowrap controls, which overflow a 375px
          viewport with no scroll path (body is overflow-x:clip). Tablet/desktop
          keep the shipped single-line nowrap bar. */}
      {(!isCompactRoster || filtersOpen) && (
      <section style={{ background: 'var(--surf-solid, rgba(20,20,26,0.72))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: 'var(--card-radius)', padding: 'var(--card-pad-sm)', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: rosterViewportWidth <= 767 ? 'wrap' : 'nowrap', minWidth: 0 }}>
        <span className="wr-module-toolbar-label">Scope</span>
        <select value={rosterFilter} onChange={e => setRosterFilter(e.target.value)} style={rosterSelectStyle(rosterFilter !== 'All')} title="Show a slot or position group">
          {rosterFilterOptions.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <span className="wr-module-toolbar-label">View</span>
        <select value={activePresetKey} onChange={e => { const key = e.target.value; const cols = COLUMN_PRESETS[key]; if (!cols) return; setVisibleCols(cols); setColPreset(key); if (key === 'rookie') setRosterFilter('Rookies'); else if (rosterFilter === 'Rookies') setRosterFilter('All'); }} style={rosterSelectStyle(activePresetKey !== 'default')} title="Column preset">
          {Object.keys(COLUMN_PRESETS).map(key => <option key={key} value={key}>{COLUMN_PRESET_META[key]?.label || key}</option>)}
          {activePresetKey === 'custom' && <option value="custom">Custom</option>}
        </select>
        <button onClick={() => setShowColPicker(!showColPicker)} style={{ ...controlBtn(showColPicker || activePresetKey === 'custom'), minHeight: '44px', flexShrink: 0 }} title="Add, remove, or reorder columns">Customize</button>

        <span className="wr-module-toolbar-label">PPG</span>
        <select value={ppgWindow} onChange={e => setPpgWindow(e.target.value)} style={rosterSelectStyle(ppgWindow !== 'season')} title="Points-per-game window">
          <option value="season">Season</option>
          <option value="l5">L5</option>
          <option value="l3">L3</option>
        </select>

        <span className="wr-module-toolbar-label">Rows</span>
        <select value={rowDensity} onChange={e => setRowDensity(e.target.value)} style={rosterSelectStyle(rowDensity !== 'comfortable')} title="Row density">
          <option value="comfortable">Comfort</option>
          <option value="compact">Compact</option>
        </select>

        <span className="wr-module-toolbar-label">Group</span>
        <select value={rosterGroupMode} onChange={e => setRosterGroupMode(e.target.value)} style={rosterSelectStyle(rosterGroupMode !== 'position')} title="Group rows by">
          {GROUP_MODES.map(opt => <option key={opt.key} value={opt.key}>{opt.label}</option>)}
        </select>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, whiteSpace: 'nowrap' }}>{filtered.length} / {allPlayers.length} shown</span>
          {window.WR?.SavedViews?.SavedViewBar && React.createElement(window.WR.SavedViews.SavedViewBar, {
            surface: 'roster',
            leagueId: currentLeague?.id,
            currentState: { columns: visibleCols, sort: rosterSort, filters: { rosterFilter, rosterGroupMode, rowDensity } },
            onApply: (v) => {
              if (Array.isArray(v.columns) && v.columns.length) { setVisibleCols(v.columns); setColPreset('custom'); }
              if (v.sort && v.sort.key) setRosterSort({ key: v.sort.key, dir: v.sort.dir || 1 });
              if (v.filters && typeof v.filters.rosterFilter === 'string') setRosterFilter(v.filters.rosterFilter);
              if (v.filters && typeof v.filters.rosterGroupMode === 'string') setRosterGroupMode(v.filters.rosterGroupMode);
              if (v.filters && typeof v.filters.rowDensity === 'string') setRowDensity(v.filters.rowDensity);
            },
          })}
        </div>
      </section>
      )}

      <div>

      {/* Column picker dropdown */}
      {showColPicker && (
        <div style={{ background: 'linear-gradient(180deg, var(--surf-solid, rgba(22,22,29,0.98)), var(--surf-solid, rgba(10,10,14,0.98)))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', borderRadius: '10px', padding: '12px', marginBottom: '10px', boxShadow: '0 10px 28px rgba(0,0,0,0.24)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: 'var(--text-title, 1.125rem)', color: 'var(--white)', fontWeight: 700, letterSpacing: '0.04em' }}>Customize Columns</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58 }}>{visibleCols.length} of {Object.keys(ROSTER_COLUMNS).length} active</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setCustomColumns(Object.keys(ROSTER_COLUMNS))} style={controlBtn(inactiveColumnCount === 0)}>All Fields</button>
              <button onClick={() => setCustomColumns(COLUMN_PRESETS.default)} style={controlBtn(activePresetKey === 'default')}>Reset Default</button>
            </div>
          </div>

          <div className="mt-board-grid" style={{ display: 'grid', gridTemplateColumns: rosterViewportWidth <= 820 ? '1fr' : 'minmax(280px, 0.9fr) minmax(360px, 1.4fr)', gap: '12px', alignItems: 'start' }}>
            <div style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: '8px', padding: '10px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>Active Order</div>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.54 }}>{activeColumnOrder.length} visible</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', paddingRight: '2px' }}>
                {activeColumnOrder.length === 0 ? (
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px dashed var(--ov-6, rgba(255,255,255,0.12))', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
                ) : activeColumnOrder.map((key, idx) => {
                  const col = ROSTER_COLUMNS[key];
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 26px 26px 26px', gap: '5px', alignItems: 'center', padding: '5px 6px', borderRadius: '7px', background: 'var(--acc-fill2, rgba(212,175,55,0.075))', border: '1px solid var(--acc-fill3, rgba(212,175,55,0.14))' }}>
                      <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: 'var(--text-micro, 0.6875rem)', textAlign: 'right' }}>{idx + 1}</span>
                      <span title={col.label} style={{ color: 'var(--white)', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                      <button disabled={idx === 0} onClick={() => moveVisibleColumn(key, -1)} title="Move left" style={{ height: '24px', borderRadius: '5px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === 0 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === 0 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === 0 ? 'default' : 'pointer' }}>{'\u2039'}</button>
                      <button disabled={idx === activeColumnOrder.length - 1} onClick={() => moveVisibleColumn(key, 1)} title="Move right" style={{ height: '24px', borderRadius: '5px', border: '1px solid var(--ov-5, rgba(255,255,255,0.09))', background: idx === activeColumnOrder.length - 1 ? 'var(--ov-2, rgba(255,255,255,0.025))' : 'var(--ov-4, rgba(255,255,255,0.06))', color: idx === activeColumnOrder.length - 1 ? 'var(--ov-7, rgba(255,255,255,0.24))' : 'var(--silver)', cursor: idx === activeColumnOrder.length - 1 ? 'default' : 'pointer' }}>{'\u203A'}</button>
                      <button onClick={() => removeVisibleColumn(key)} title="Hide column" style={{ height: '24px', borderRadius: '5px', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: 'var(--bad)', cursor: 'pointer' }}>{'\u00D7'}</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid var(--ov-4, rgba(255,255,255,0.07))' }}>
                <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '7px' }}>Group Rows By</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {GROUP_MODES.map(opt => (
                    <button key={opt.key} onClick={() => setRosterGroupMode(opt.key)} style={controlBtn(rosterGroupMode === opt.key)}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
              {columnGroups.map(({ group, columns }) => (
                <div key={group} style={{ background: 'var(--ov-2, rgba(255,255,255,0.025))', border: '1px solid var(--ov-4, rgba(255,255,255,0.07))', borderRadius: '8px', padding: '8px' }}>
                  <div style={{ marginBottom: '6px', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>{group}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {columns.map(([key, col]) => {
                      const active = visibleCols.includes(key);
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 7px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.74rem', background: active ? 'var(--acc-fill2, rgba(212,175,55,0.1))' : 'var(--ov-1, rgba(255,255,255,0.018))', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'var(--acc-fill3, rgba(212,175,55,0.18))' : 'var(--ov-3, rgba(255,255,255,0.04))') }}>
                          <input type="checkbox" checked={active} onChange={() => {
                            if (active) removeVisibleColumn(key);
                            else addVisibleColumn(key);
                          }} style={{ accentColor: 'var(--gold)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Roster table with inline expand cards */}
      <div style={{ border: '1px solid var(--ov-5, rgba(255,255,255,0.075))', borderRadius: 'var(--card-radius)', overflow: 'hidden', background: 'var(--surf-solid, rgba(12,12,17,0.98))', boxShadow: '0 10px 24px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '7px 10px', borderBottom: '1px solid var(--ov-4, rgba(255,255,255,0.06))', background: 'var(--ov-1, rgba(255,255,255,0.018))' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontSize: 'var(--text-title, 1.125rem)', fontWeight: 700 }}>Roster Board</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: isDeepData ? 'var(--gold)' : 'var(--silver)', opacity: isDeepData ? 0.86 : 0.58 }}>{activePresetMeta.label} · {visibleCols.length} fields</div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: rosterGroupMode === 'none' ? 'var(--silver)' : 'var(--gold)', opacity: 0.62 }}>Grouped by {activeGroupModeLabel}</div>
            <div style={{ marginLeft: 'auto', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: 'var(--gold)', letterSpacing: '0.04em' }}>
              {filtered.length} player{filtered.length === 1 ? '' : 's'}
            </div>
            <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.52, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sort: {ROSTER_COLUMNS[rosterSort.key]?.shortLabel || (rosterSort.key === 'name' ? 'Player' : rosterSort.key)}
            </div>
          </div>
        </div>
        <div ref={boardScrollRef} style={{ overflowX: 'auto', overflowY: 'clip', background: 'linear-gradient(90deg, var(--ov-1, rgba(255,255,255,0.02)), transparent 12%, transparent 88%, var(--ov-1, rgba(255,255,255,0.018)))' }}>
          <div style={{ minWidth: tableMinWidth + 'px' }}>
            {/* Header row */}
            <div style={{ display: 'flex', height: '32px', background: 'var(--ov-2, rgba(255,255,255,0.03))', borderBottom: '1px solid var(--ov-6, rgba(255,255,255,0.12))', position: 'sticky', top: 0, zIndex: 5 }}>
              <div title="Player" style={{ width: playerColWidth + 'px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 10px', fontSize: '0.72rem', fontWeight: 600, color: rosterSort.key === 'name' ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', letterSpacing: '0.035em', cursor: 'pointer', userSelect: 'none', borderRight: '1px solid var(--ov-6, rgba(255,255,255,0.1))', textTransform: 'uppercase', position: 'sticky', left: 0, zIndex: 7, background: 'linear-gradient(180deg, var(--k-1b1d23, #1b1d23), var(--k-15161b, #15161b))', boxShadow: '8px 0 14px rgba(0,0,0,0.2)' }}
                onClick={() => setRosterSort(prev => prev.key === 'name' ? {...prev, dir: prev.dir*-1} : {key: 'name', dir: 1})}>
                Player{rosterSort.key === 'name' ? (rosterSort.dir === -1 ? ' v' : ' ^') : ''}
              </div>
              <div style={{ flex: 1, display: 'flex' }}>
                {rosterTableCols.map(colKey => {
                  const col = ROSTER_COLUMNS[colKey];
                  if (!col) return null;
                  const isSorted = rosterSort.key === colKey;
                  const isGroupStart = visibleColGroupStarts.has(colKey);
                  return (
                    <div key={colKey} title={col.label} onClick={() => setRosterSort(prev => prev.key === colKey ? {...prev, dir: prev.dir*-1} : {key: colKey, dir: 1})}
                      style={{ width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: isSorted ? 700 : 600, color: isSorted ? 'var(--gold)' : 'var(--silver)', fontFamily: 'var(--font-body)', letterSpacing: '0.025em', cursor: 'pointer', userSelect: 'none', textTransform: 'uppercase', borderLeft: isGroupStart ? '1px solid var(--ov-4, rgba(255,255,255,0.06))' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', padding: '0 3px', textAlign: 'center', lineHeight: 1.05, background: isSorted ? 'var(--acc-fill1, rgba(212,175,55,0.06))' : 'transparent' }}>
                      <span>{col.shortLabel || col.label}{rosterSort.key === colKey ? (rosterSort.dir === -1 ? ' v' : ' ^') : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Player rows + inline expand */}
            {filtered.map((r, idx) => {
              const isExpanded = expandedPid === r.pid;
              const rowGroupKey = getRowGroupKey(r);
              const startsPositionGroup = rosterGroupMode !== 'none' && (idx === 0 || getRowGroupKey(filtered[idx - 1]) !== rowGroupKey);
              const rowBg = isExpanded ? 'var(--acc-fill1, rgba(212,175,55,0.058))' : idx % 2 === 1 ? 'var(--ov-1, rgba(255,255,255,0.018))' : 'var(--ov-1, rgba(255,255,255,0.006))';

              const _recLower = (r.rec || '').toLowerCase();
          const actionClass = _recLower === 'sell now' || _recLower === 'sell' ? 'wr-row-sell' :
            _recLower === 'sell high' ? 'wr-row-sell-high' :
            _recLower === 'hold core' || _recLower === 'build around' ? 'wr-row-core' : '';
          const untouchables = (window._wrGmStrategy?.untouchable || []);
          const isUntouchable = untouchables.includes(r.pid);

          return (
            <React.Fragment key={r.pid}>
              {startsPositionGroup && (
	                <div style={{ display: 'flex', height: isCompactRows ? '24px' : '28px', borderTop: idx === 0 ? 'none' : '2px solid var(--acc-line3, rgba(212,175,55,0.45))', borderBottom: '1px solid var(--ov-5, rgba(255,255,255,0.08))', background: 'var(--ov-6, rgba(255,255,255,0.10))' }}>
	                  <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', background: 'var(--k-262932, #262932)', borderLeft: '3px solid var(--gold)', borderRight: '1px solid var(--ov-5, rgba(255,255,255,0.08))', boxShadow: '8px 0 14px rgba(0,0,0,0.16)' }}>
	                    <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.84rem', color: getRowGroupColor(r), fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{getRowGroupLabel(r)}</span>
	                    <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{filteredPosCounts[rowGroupKey]} players</span>
                  </div>
                  <div style={{ flex: 1, borderLeft: '1px solid var(--ov-2, rgba(255,255,255,0.025))' }} />
                </div>
              )}
              {/* Normal row */}
              <div className={[actionClass, isUntouchable ? 'wr-untouchable' : ''].filter(Boolean).join(' ')} role="button" tabIndex={0} title="Open roster player detail" style={{ display: 'flex', overflow: 'visible', borderTop: 'none', borderBottom: isExpanded ? 'none' : '1px solid var(--ov-3, rgba(255,255,255,0.035))', cursor: 'pointer', background: rowBg, transition: 'background 0.1s' }}
                onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedPid(prev => prev === r.pid ? null : r.pid); } }}
                onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'var(--acc-fill1, rgba(212,175,55,0.06))'; }}
                onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = rowBg; }}>
                {/* Frozen player info */}
	                <div style={{ width: playerColWidth + 'px', flexShrink: 0, height: rowHeight + 'px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', borderRight: '1px solid var(--acc-fill2, rgba(212,175,55,0.1))', position: 'sticky', left: 0, zIndex: 3, background: idx % 2 === 1 ? 'var(--k-191b21, #191b21)' : 'var(--k-131418, #131418)', boxShadow: '8px 0 14px rgba(0,0,0,0.16)' }}>
                  <div style={{ width: avatarSize + 'px', height: avatarSize + 'px', flexShrink: 0 }}><img src={'https://sleepercdn.com/content/nfl/players/thumb/'+r.pid+'.jpg'} alt="" onError={e=>e.target.style.display='none'} style={{ width: avatarSize + 'px', height: avatarSize + 'px', borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--ov-5, rgba(255,255,255,0.08))' }} /></div>
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
	                      <span style={{ fontWeight: 650, color: 'var(--white)', fontSize: playerNameSize, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getPlayerName(r.pid)}</span>
                      {inlineTag(slotTagMeta[r.section], 'slot-' + r.pid)}
                      {inlineTag(rosterTagMeta[window._playerTags?.[r.pid]], 'tag-' + r.pid)}
                      {/* GM Strategy: untouchable lock — distinct from manual tag system */}
                      {r.gmIsUntouchable && <span title="GM Strategy: untouchable — locked from sell flags" style={{ fontSize: 'var(--text-micro, 0.6875rem)', flexShrink: 0, lineHeight: 1, color: 'var(--good)' }}>{'🛡'}</span>}
                      {/* GM Strategy: acquisition-focus / sell-candidate position accents */}
                      {!r.gmIsUntouchable && r.gmIsTarget && <span title="GM Strategy: acquisition-focus position" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'var(--acc-fill2, rgba(212,175,55,0.12))', color: 'var(--gold)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.28))', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>TGT</span>}
                      {!r.gmIsUntouchable && r.gmIsSellPos && <span title="GM Strategy: sell-candidate position" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 800, background: 'rgba(240,165,0,0.13)', color: 'var(--warn)', border: '1px solid rgba(240,165,0,0.32)', flexShrink: 0, lineHeight: 1, letterSpacing: '0.03em' }}>SELL</span>}
                      {isPro && dropCandidatePids.has(r.pid) && !dismissedDrops.has(r.pid) && <span onClick={e => { e.stopPropagation(); dismissDrop(r.pid); }} title="Drop candidate (click to dismiss)" style={{ fontSize: 'var(--text-micro, 0.6875rem)', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, background: 'rgba(231,76,60,0.2)', color: 'var(--bad)', border: '1px solid rgba(231,76,60,0.4)', flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>DROP?</span>}
                    </div>
                    <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.62, marginTop: '1px' }}>{r.p.team || 'FA'}{r.injury ? ' \u00B7 '+r.injury : ''}</div>
                  </div>
                  <span style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', opacity: 0.42 }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
                {/* Data columns */}
                <div style={{ flex: 1, display: 'flex', height: rowHeight + 'px', overflow: 'hidden' }}>
                  {rosterTableCols.map(colKey => ROSTER_COLUMNS[colKey] ? renderCell(colKey, r) : null)}
                </div>
              </div>

              {/* Inline expand card — Madden/FM style */}
              {isExpanded && (
                <div style={{ borderBottom: '2px solid var(--acc-line1, rgba(212,175,55,0.2))', background: 'linear-gradient(180deg, var(--surf-solid, rgba(18,18,24,0.99)), var(--surf-solid, rgba(6,6,10,0.99)))', padding: '12px 14px', animation: 'wrFadeIn 0.2s ease', position: 'sticky', left: 0, zIndex: 3, width: boardWidth ? boardWidth + 'px' : '100%', boxSizing: 'border-box' }}>
                  {/* ── Dossier (02 "clear hierarchy"): identity + roster call → signals strip → read + signals → curve → stats ── */}
                  {(() => {
                    const verdict = r.rec || 'Hold';
                    const isSell = /sell/i.test(verdict), isBuy = /buy|build|core/i.test(verdict);
                    const vColor = isSell ? 'var(--bad)' : isBuy ? 'var(--good)' : 'var(--gold)';
                    const tier = (typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(r.pid) : r.dhq >= 7000) ? 'Elite' : r.dhq >= 4000 ? 'Starter' : r.dhq >= 2000 ? 'Depth' : 'Stash';
                    const field = (currentLeague.rosters || []).flatMap(ros => (ros.players || []).filter(pid2 => normPos(playersData[pid2]?.position) === r.pos)).map(pid2 => ({ pid: pid2, dhq: window.App?.LI?.playerScores?.[pid2] || 0 })).filter(x => x.dhq > 0).sort((a, b) => b.dhq - a.dhq);
                    const rank = field.findIndex(x => x.pid === r.pid) + 1;
                    const narrow = rosterViewportWidth <= 834;
                    const posLbl = window.App?.posLabel?.(r.pos) || (r.pos === 'DEF' ? 'D/ST' : r.pos);
                    const chip = (bg, col) => ({ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: bg, color: col, whiteSpace: 'nowrap' });
                    const primeEnd = r.peakYrsLeft > 0 && r.age ? r.age + r.peakYrsLeft : null;
                    const sigWindow = (r.peakPhase || '—') + (primeEnd ? ' · thru ' + primeEnd : r.valueYrsLeft > 0 ? ' · ~' + r.valueYrsLeft + 'yr value' : '');
                    const sigRisk = r.injury ? r.injury : (r.durabilityGP && r.durabilityGP < 13 ? '~' + r.durabilityGP + ' GP/yr' : 'no current flags');
                    const sigFloor = r.isStarter ? 'weekly starter' : (r.p.depth_chart_order != null && r.p.depth_chart_order <= 1 ? 'rotation role' : 'bench / depth');
                    const sigCeiling = r.trend >= 10 ? 'trending up' : (tier === 'Elite' || tier === 'Starter') ? 'proven ' + tier.toLowerCase() : r.peakPhase === 'PRE' ? 'developing' : 'limited upside';
                    // Market posture tracks the actual action family from getPlayerAction —
                    // a "past value window" SELL must not read as "sell high".
                    const actionFam = r.recAction || (/sell high/i.test(verdict) ? 'SELL_HIGH' : /sell/i.test(verdict) ? 'SELL' : /buy/i.test(verdict) ? 'BUY' : /build|core/i.test(verdict) ? 'CORE' : /stash/i.test(verdict) ? 'STASH' : 'HOLD');
                    const marketCall = actionFam === 'SELL_HIGH' ? 'sell high'
                      : actionFam === 'SELL' ? 'sell while value remains'
                      : (actionFam === 'CORE' || actionFam === 'BUILD') ? "cornerstone — don't move cheap"
                      : actionFam === 'BUY' ? 'buy low'
                      : "don't overpay";
                    const callSub = tier + ' ' + posLbl + ' · ' + marketCall;
                    const sigRow = (label, val, last) => (<div style={{ display: 'flex', gap: '9px', alignItems: 'baseline', padding: '6px 0', borderBottom: last ? 'none' : '1px solid rgba(255,255,255,0.05)', fontSize: '0.74rem' }}><span style={{ minWidth: '52px', color: 'var(--silver)', opacity: 0.65 }}>{label}</span><span style={{ color: 'var(--white)', fontWeight: 600 }}>{val}</span></div>);
                    return (<React.Fragment>
                      {/* Identity + roster call */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '10px', flexWrap: 'wrap' }}>
                        <div style={{ flexShrink: 0, position: 'relative' }}>
                          <img src={'https://sleepercdn.com/content/nfl/players/' + r.pid + '.jpg'} alt="" onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} style={{ width: '58px', height: '58px', borderRadius: '8px', objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))' }} />
                          <div style={{ display: 'none', width: '58px', height: '58px', borderRadius: '8px', background: 'var(--charcoal)', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', fontWeight: 700, color: 'var(--silver)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))' }}>{(r.p.first_name || '?')[0]}{(r.p.last_name || '?')[0]}</div>
                          <div style={{ position: 'absolute', bottom: '-4px', left: '50%', transform: 'translateX(-50%)', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, padding: '1px 7px', borderRadius: '7px', background: (posColors[r.pos] || 'var(--k-666666, #666666)') + '22', color: posColors[r.pos] || 'var(--silver)', whiteSpace: 'nowrap' }}>{posLbl}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: '150px' }}>
                          <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.35rem', color: 'var(--white)', letterSpacing: '0.01em', lineHeight: 1.04 }}>{r.p.full_name || getPlayerName(r.pid)}</div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--silver)', marginTop: '3px', lineHeight: 1.4 }}>
                            {posLbl} {'·'} {r.p.team || 'FA'} {'·'} Age {r.age || '?'} {'·'} {r.p.years_exp || 0}yr exp
                            {formatHeight(r.p.height) ? ' · ' + formatHeight(r.p.height) : ''}
                            {r.p.college ? ' · ' + r.p.college : ''}
                            {r.injury ? <span style={{ color: 'var(--bad)', fontWeight: 700 }}> {'·'} {r.injury}</span> : null}
                          </div>
                        </div>
                        {isPro ? (
                        <div style={{ textAlign: 'right', minWidth: '120px' }}>
                          <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Roster call</div>
                          <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.6rem', fontWeight: 700, color: vColor, lineHeight: 1.05, textTransform: 'uppercase' }}>{verdict}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--silver)' }}>{callSub}</div>
                        </div>
                        ) : (
                        // Free: verdict + "sell high / buy low" sub are Pro — live lock teaser in the same slot.
                        <button onClick={e => { e.stopPropagation(); if (window.showProLaunchPage) window.showProLaunchPage(); else if (window.showUpgradePrompt) window.showUpgradePrompt('analytics_depth'); }}
                          title="Buy/sell roster calls are a Pro read"
                          style={{ textAlign: 'right', minWidth: '120px', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                          <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>Roster call</div>
                          <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.15rem', fontWeight: 700, color: 'var(--gold)', lineHeight: 1.2, textTransform: 'uppercase' }}>{'🔒'} Pro</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--silver)' }}>Unlock buy/sell calls</div>
                        </button>
                        )}
                      </div>

                      {/* Signals chip strip */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
                        <span style={chip(dhqBg(r.dhq), dhqCol(r.dhq))}>{tier} {'·'} {r.dhq.toLocaleString()} DHQ</span>
                        {rank > 0 ? <span style={chip('var(--ov-3, rgba(255,255,255,0.05))', 'var(--gold)')}>{r.pos}{rank}</span> : null}
                        <span style={chip(r.peakPhase === 'PRE' ? 'rgba(46,204,113,0.1)' : r.peakPhase === 'POST' ? 'rgba(231,76,60,0.1)' : 'var(--acc-fill2, rgba(212,175,55,0.08))', r.peakPhase === 'PRE' ? 'var(--good)' : r.peakPhase === 'POST' ? 'var(--bad)' : 'var(--gold)')}>{r.peakPhase}{r.peakYrsLeft > 0 ? ' · ~' + r.peakYrsLeft + 'yr' : ''}</span>
                        {r.effectivePPG ? <span style={chip('var(--ov-3, rgba(255,255,255,0.05))', 'var(--white)')}>{r.effectivePPG} PPG</span> : null}
                        {r.injury ? <span style={chip('rgba(231,76,60,0.13)', 'var(--bad)')}>{r.injury}</span> : null}
                      </div>

                      {/* Dynasty read | signals */}
                      <div style={{ display: 'grid', gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '10px', marginBottom: '10px', alignItems: 'start' }}>
                        <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px 11px', minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '5px' }}>Dynasty Read</div>
                          {window.WR?.ClampedRead
                            ? React.createElement(window.WR.ClampedRead, { text: aiReads[r.pid] || buildDynastyRead(r), maxHeight: 104, style: { fontSize: '0.8rem', color: 'var(--k-d8d8de, #d8d8de)', lineHeight: 1.45 } })
                            : <div style={{ fontSize: '0.8rem', color: 'var(--k-d8d8de, #d8d8de)', lineHeight: 1.45 }}>{aiReads[r.pid] || buildDynastyRead(r)}</div>}
                        </div>
                        <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.065))', borderRadius: '8px', padding: '9px 11px', minWidth: 0 }}>
                          <div style={{ fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '4px' }}>Signals</div>
                          {sigRow('Ceiling', sigCeiling)}
                          {sigRow('Floor', sigFloor)}
                          {sigRow('Risk', sigRisk)}
                          {sigRow('Window', sigWindow, true)}
                        </div>
                      </div>
                    </React.Fragment>);
                  })()}

		                  {/* Age Curve visualization */}
	                  {(() => {
	                    const nP = r.pos === 'DE' || r.pos === 'DT' ? 'DL' : r.pos === 'CB' || r.pos === 'S' ? 'DB' : r.pos;
	                    const curve = typeof window.App?.getAgeCurve === 'function'
	                      ? window.App.getAgeCurve(nP)
	                      : { build: [22, 24], peak: (window.App.peakWindows || {})[nP] || [24, 29], decline: [30, 32] };
	                    const [pLo, pHi] = curve.peak;
	                    const declineHi = curve.decline[1];
	                    const ages = Array.from({length: 17}, (_, i) => i + 20);
                    return <div style={{ background: 'var(--ov-1, rgba(255,255,255,0.02))', border: '1px solid var(--ov-4, rgba(255,255,255,0.06))', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Age Curve</div>
	                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{'Currently age ' + (r.age || '?') + ' \u00B7 ' + r.peakPhase + ' \u00B7 ' + (r.peakYrsLeft > 0 ? '~' + r.peakYrsLeft + ' peak yr left' : r.valueYrsLeft > 0 ? '~' + r.valueYrsLeft + ' value yr left' : 'Past value window')}</div>
                      </div>
                      <div style={{ display: 'flex', height: '22px', borderRadius: '5px', overflow: 'hidden', gap: '1px' }}>
                        {ages.map(a => {
	                          const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' : a < pLo ? 'rgba(46,204,113,0.45)' : (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' : a <= declineHi ? 'var(--acc-line3, rgba(212,175,55,0.45))' : 'rgba(231,76,60,0.35)';
                          const isMe = a === (r.age || 0);
                          return <div key={a} style={{ flex: 1, background: col, opacity: isMe ? 1 : 0.55, outline: isMe ? '2px solid var(--gold)' : 'none', outlineOffset: '-1px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-micro, 0.6875rem)', fontWeight: 700, color: isMe ? 'var(--text-primary)' : 'transparent' }}>{isMe ? a : ''}</div>;
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-micro, 0.6875rem)', color: 'var(--silver)', marginTop: '3px' }}>
	                        <span>20</span><span>{'Peak ' + pLo + '\u2013' + pHi + ' / Value thru ' + declineHi}</span><span>36</span>
                      </div>
                    </div>;
                  })()}

                  {/* Career Stats Table */}
                  <InlineCareerStats pid={r.pid} pos={r.pos} player={r.p} scoringSettings={currentLeague?.scoring_settings} statsData={statsData} />

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={e => { e.stopPropagation(); const playerName = r.p.full_name || getPlayerName(r.pid); setReconPanelOpen(true); sendReconMessage("I'd like help with " + playerName + ". Here are my options:\n1. Who are the best trade partners for " + playerName + "?\n2. What's the long-term projection for " + playerName + "?\n3. Should I hold or sell " + playerName + " right now?"); }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'rgba(124,107,248,0.15)', color: 'var(--purple)', border: '1px solid rgba(124,107,248,0.3)', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>ASK ALEX</button>
                    {/* Phase 2: News button removed per user feedback (2026-04-18) */}
                    {[{tag:'trade',label:'TRADE BLOCK',bg:'rgba(240,165,0,0.15)',col:'var(--warn)',border:'rgba(240,165,0,0.3)'},{tag:'cut',label:'CUT',bg:'rgba(231,76,60,0.15)',col:'var(--bad)',border:'rgba(231,76,60,0.3)'},{tag:'untouchable',label:'UNTOUCHABLE',bg:'rgba(46,204,113,0.15)',col:'var(--good)',border:'rgba(46,204,113,0.3)'},{tag:'watch',label:'WATCH',bg:'rgba(52,152,219,0.15)',col:'var(--k-3498db, #3498db)',border:'rgba(52,152,219,0.3)'}].map(t => {
                      const isActive = window._playerTags?.[r.pid] === t.tag;
                      return <button key={t.tag} onClick={e => { e.stopPropagation(); const leagueId = currentLeague.id || currentLeague.league_id || ''; const tags = window._playerTags || {}; const wasActive = tags[r.pid] === t.tag; if (wasActive) delete tags[r.pid]; else tags[r.pid] = t.tag; window._playerTags = { ...tags }; if (window.OD?.savePlayerTags) window.OD.savePlayerTags(leagueId, tags); if (!wasActive) { const playerName = r.p.full_name || getPlayerName(r.pid); window.wrLogAction?.('\uD83C\uDFF7\uFE0F', 'Tagged ' + playerName + ' as ' + t.label, 'roster', { players: [{ name: playerName, pid: r.pid }], actionType: 'tag' }); } setTimeRecomputeTs(Date.now()); }} style={{ padding: '7px 12px', minHeight: '44px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', background: isActive ? t.bg : 'transparent', color: isActive ? t.col : 'var(--silver)', border: '1px solid ' + (isActive ? t.border : 'var(--ov-6, rgba(255,255,255,0.1))'), borderRadius: '6px', cursor: 'pointer', fontWeight: isActive ? 700 : 400, letterSpacing: '0.03em' }}>{t.label}</button>;
                    })}
                    <button onClick={e => { e.stopPropagation(); setExpandedPid(null); }} style={{ padding: '7px 16px', minHeight: '44px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '6px', cursor: 'pointer' }}>COLLAPSE</button>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
            })}
            {filtered.length === 0 && (
              <div style={{ display: 'flex', minHeight: '76px', borderTop: '1px solid var(--ov-3, rgba(255,255,255,0.04))', background: 'var(--ov-1, rgba(255,255,255,0.012))' }}>
                <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: 'var(--k-0d0d13, #0d0d13)', borderRight: '1px solid var(--acc-fill2, rgba(212,175,55,0.12))', display: 'flex', alignItems: 'center', padding: '0 12px', color: 'var(--silver)', fontWeight: 700 }}>No players</div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', padding: '0 14px', color: 'var(--silver)', opacity: 0.58, fontSize: '0.78rem' }}>No roster rows match this view.</div>
              </div>
            )}
          </div>
        </div>
      </div>

      </div>
    </div>
  );
}

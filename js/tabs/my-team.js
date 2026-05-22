// ══════════════════════════════════════════════════════════════════
// js/tabs/my-team.js — MyTeamTab: Dynasty roster view with DHQ values,
// PPG stats, age curves, acquisition history, and column customization
// Extracted from league-detail.js. Props: all required state from LeagueDetail.
// ══════════════════════════════════════════════════════════════════

function MyTeamTab({
  // Core data
  myRoster,
  currentLeague,
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

  function calcRawPts(s) { return window.App.calcRawPts(s, currentLeague?.scoring_settings); }

  function getPlayerName(playerId) {
    const player = playersData[playerId];
    if (!player) return `Player ${playerId}`;
    return player.full_name || `${player.first_name || ''} ${player.last_name || ''}`.trim() || `Player ${playerId}`;
  }

  // ── filteredAndSortedRows (formerly a sibling function of renderMyTeamTab) ──
  function filteredAndSortedRows(rows) {
    const offPos = new Set(['QB','RB','WR','TE','K']);
    const idpPos = new Set(['DL','LB','DB']);
    let filtered = rows;
    if (rosterFilter === 'Starters') filtered = rows.filter(r => r.isStarter);
    else if (rosterFilter === 'Bench') filtered = rows.filter(r => !r.isStarter && !r.isIR && !r.isTaxi);
    else if (rosterFilter === 'Taxi') filtered = rows.filter(r => r.isTaxi);
    else if (rosterFilter === 'IR') filtered = rows.filter(r => r.isIR);
    else if (rosterFilter === 'Offense') filtered = rows.filter(r => offPos.has(r.pos));
    else if (rosterFilter === 'IDP') filtered = rows.filter(r => idpPos.has(r.pos));

    const posOrder = {QB:0,RB:1,WR:2,TE:3,K:4,DL:5,LB:6,DB:7};
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
      if (key === 'prev') return ((b.prevPPG||0) - (a.prevPPG||0)) * dir;
      if (key === 'trend') return ((b.trend||0) - (a.trend||0)) * dir;
      if (key === 'gp') return ((b.curGP||0) - (a.curGP||0)) * dir;
      if (key === 'durability') return ((b.durabilityGP||0) - (a.durabilityGP||0)) * dir;
      if (key === 'name') { const na = getPlayerName(a.pid).toLowerCase(), nb = getPlayerName(b.pid).toLowerCase(); return (na < nb ? -1 : na > nb ? 1 : 0) * dir; }
      if (key === 'pos') { const d = ((posOrder[a.pos] ?? 99) - (posOrder[b.pos] ?? 99)); return d !== 0 ? d * dir : (b.dhq - a.dhq); }
      if (key === 'peak') return ((b.peakYrsLeft||0) - (a.peakYrsLeft||0)) * dir;
      if (key === 'action') { const ord = {BUY:3,HOLD:2,SELL:1}; return ((ord[b.rec]||0) - (ord[a.rec]||0)) * dir; }
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
      return 0;
    });
  }

  if (!myRoster) return <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--silver)' }}>No roster found</div>;

  const ROSTER_COLUMNS = {
    pos:        { label: 'Position', shortLabel: 'Pos', width: '40px', group: 'core' },
    age:        { label: 'Age', shortLabel: 'Age', width: '38px', group: 'dynasty' },
    dhq:        { label: 'DHQ Dynasty Value', shortLabel: 'DHQ', width: '64px', group: 'dynasty' },
    ppg:        { label: 'Points Per Game', shortLabel: 'PPG', width: '48px', group: 'stats' },
    prev:       { label: 'Previous Season PPG', shortLabel: 'Prev', width: '48px', group: 'stats' },
    trend:      { label: 'Year-over-Year PPG Change (%) — how this season\u2019s PPG compares to last season\u2019s', shortLabel: 'Trend', width: '58px', group: 'dynasty' },
    peak:       { label: 'Peak Window Phase', shortLabel: 'Peak', width: '50px', group: 'dynasty' },
    action:     { label: 'Trade Recommendation', shortLabel: 'Action', width: '56px', group: 'dynasty' },
    gp:         { label: 'Games Played', shortLabel: 'GP', width: '36px', group: 'stats' },
    durability: { label: 'Durability — games played out of 17 (green=15+, amber=10-14, red=<10)', shortLabel: 'Dur', width: '40px', group: 'stats' },
    yrsExp:     { label: 'Years of Experience', shortLabel: 'Exp', width: '38px', group: 'dynasty' },
    college:    { label: 'College', shortLabel: 'College', width: '90px', group: 'scout' },
    // nflDraft removed — Sleeper doesn't reliably provide draft capital data
    posRankLg:  { label: 'League Position Rank', shortLabel: 'Lg Rank', width: '54px', group: 'dynasty' },
    posRankNfl: { label: 'NFL Position Rank', shortLabel: 'NFL Rank', width: '56px', group: 'dynasty' },
    starterSzn: { label: 'Starter Seasons', shortLabel: 'Str Szn', width: '48px', group: 'dynasty' },
    height:     { label: 'Height', shortLabel: 'Ht', width: '42px', group: 'scout' },
    weight:     { label: 'Weight (lbs)', shortLabel: 'Wt', width: '42px', group: 'scout' },
    depthChart: { label: 'Depth Chart Position', shortLabel: 'Depth', width: '48px', group: 'scout' },
    slot:       { label: 'Roster Slot', shortLabel: 'Slot', width: '48px', group: 'core' },
    acquired:   { label: 'Acquisition Method', shortLabel: 'Acquired', width: '82px', group: 'core' },
    acquiredDate: { label: 'Date Acquired', shortLabel: 'Date', width: '64px', group: 'core' },
    sos:        { label: 'Sched Strength (1=hardest, 32=easiest)', shortLabel: 'SOS', width: '44px', group: 'stats' },
  };

  const COLUMN_PRESETS = {
    default: ['pos','age','dhq','posRankLg','ppg','durability','peak','action','sos'],
    stats:   ['pos','dhq','ppg','prev','trend','gp','durability','sos'],
    scout:   ['pos','age','college','slot','height','weight','depthChart','yrsExp','starterSzn','posRankNfl'],
    full:    Object.keys(ROSTER_COLUMNS),
  };
  const COLUMN_PRESET_META = {
    default: { label: 'Default', tone: 'decision board' },
    stats: { label: 'Stats', tone: 'production' },
    scout: { label: 'Scout', tone: 'profile' },
    full: { label: 'Deep Data', tone: 'all fields' },
  };

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
    const dhq = window.App?.LI?.playerScores?.[pid] || 0;
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
    // Recommendation for MY roster — shared getPlayerAction() with simplified fallback
    const pa = typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
    const rec = pa ? pa.label : (valueYrsLeft <= 0 ? 'Sell' : _pidElite && peakYrsLeft >= 3 ? 'Hold Core' : peakYrsLeft >= 4 && dhq < 4000 ? 'Stash' : 'Hold');

    return { pid, p, pos, dhq, age, curPPG, prevPPG, effectivePPG, effectiveGP, prevGP, durabilityGP, trend, isStarter, isIR, isTaxi, section, peakPhase, peakPct, peakYrsLeft, valueYrsLeft, rec, curGP, meta, injury: p.injury_status };
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
  const dhqBg = v => v >= 7000 ? 'rgba(46,204,113,0.15)' : v >= 4000 ? 'rgba(52,152,219,0.12)' : v >= 2000 ? 'rgba(255,255,255,0.04)' : 'transparent';
  const dhqCol = v => v >= 7000 ? '#2ECC71' : v >= 4000 ? '#3498DB' : v >= 2000 ? 'var(--silver)' : 'rgba(255,255,255,0.25)';
  const agePhase = (a, pos) => {
    if (!a) return 'unknown';
    const curve = typeof window.App?.getAgeCurve === 'function'
      ? window.App.getAgeCurve(pos)
      : { build: [22, 24], peak: (window.App.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
    return a < curve.peak[0] ? 'young' : a <= curve.peak[1] ? 'prime' : a <= curve.decline[1] ? 'veteran' : 'post';
  };
  const ageBg = (a, pos) => ({ young: 'rgba(46,204,113,0.07)', prime: 'transparent', veteran: 'rgba(240,165,0,0.055)', post: 'rgba(231,76,60,0.06)' }[agePhase(a, pos)] || 'transparent');
  const ageCol = (a, pos) => ({ young: '#2ECC71', prime: 'var(--white)', veteran: '#F0A500', post: '#E74C3C' }[agePhase(a, pos)] || 'var(--silver)');
  const ppgBg = (v, pos) => v >= (posP75[pos]||10) ? 'rgba(46,204,113,0.055)' : v <= (posP25[pos]||3) ? 'rgba(231,76,60,0.04)' : 'transparent';
  const trendBg = t => t >= 15 ? 'rgba(46,204,113,0.05)' : t <= -15 ? 'rgba(231,76,60,0.045)' : 'transparent';
  const statusCol = s => s === 'starter' ? 'var(--gold)' : s === 'ir' ? '#E74C3C' : s === 'taxi' ? '#3498DB' : 'transparent';
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
  const [, forceAcquisitionRerender] = React.useState(0);
  // Force a re-render when weekly points become available so rolling-PPG cells update.
  const [, forcePpgRerender] = React.useState(0);
  React.useEffect(() => {
    const h = () => forcePpgRerender(n => n + 1);
    window.addEventListener('wr:weekly-points-loaded', h);
    return () => window.removeEventListener('wr:weekly-points-loaded', h);
  }, []);
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
  ];
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
  const getRowGroupColor = (r) => {
    if (rosterGroupMode === 'slot') return statusCol(r.section) === 'transparent' ? 'rgba(255,255,255,0.5)' : statusCol(r.section);
    if (rosterGroupMode === 'action') return /sell/i.test(r.rec || '') ? '#E74C3C' : /buy|build|core/i.test(r.rec || '') ? '#2ECC71' : /stash/i.test(r.rec || '') ? '#3498DB' : 'var(--gold)';
    if (rosterGroupMode === 'age') return getAgeBand(r) === 'Youth' ? '#2ECC71' : getAgeBand(r) === 'Prime' ? 'var(--gold)' : getAgeBand(r) === 'Veteran' ? '#F0A500' : '#E74C3C';
    if (rosterGroupMode === 'peak') return r.peakPhase === 'PRIME' ? '#2ECC71' : r.peakPhase === 'PRE' ? '#3498DB' : r.peakPhase === 'VET' ? '#F0A500' : '#E74C3C';
    return posColors[r.pos] || 'var(--gold)';
  };

  const filtered = filteredAndSortedRows(rows);
  const filteredPosCounts = filtered.reduce((acc, r) => {
    const key = getRowGroupKey(r);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const starterRows = rows.filter(r => r.isStarter);
  const tierAssess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null;
  const tier = (tierAssess?.tier || '').toUpperCase();
  const tierLabel = tier ? tier.charAt(0) + tier.slice(1).toLowerCase() : 'Unranked';
  const needs = tierAssess?.needs?.slice(0, 3) || [];
  const sectionCounts = rows.reduce((acc, r) => {
    acc[r.section] = (acc[r.section] || 0) + 1;
    return acc;
  }, { starter: 0, bench: 0, taxi: 0, ir: 0 });
  const posOrder = ['QB', 'RB', 'WR', 'TE', 'DL', 'LB', 'DB', 'K'];
  const posMix = posOrder.map(pos => ({
    pos,
    count: rows.filter(r => r.pos === pos).length,
    color: posColors[pos] || 'var(--silver)',
  })).filter(p => p.count > 0);
  const sellCount = rows.filter(r => /sell/i.test(r.rec || '')).length;
  const stashCount = rows.filter(r => /stash|buy|build/i.test(r.rec || '')).length;
  const bestPosition = posMix.slice().sort((a, b) => b.count - a.count)[0];
  const oldestStarter = starterRows.filter(r => r.age).sort((a, b) => (b.age || 0) - (a.age || 0))[0];
  const boardInsightChips = [
    sellCount > 0 ? { label: sellCount + ' sell flags', color: '#E74C3C' } : null,
    stashCount > 0 ? { label: stashCount + ' build assets', color: '#2ECC71' } : null,
    needs[0] ? { label: needs.slice(0, 2).map(n => n.pos).join('/') + ' needs', color: 'var(--gold)' } : null,
    oldestStarter ? { label: 'Oldest starter ' + oldestStarter.pos + ' ' + oldestStarter.age, color: '#F0A500' } : null,
    bestPosition ? { label: bestPosition.pos + ' depth ' + bestPosition.count, color: bestPosition.color } : null,
  ].filter(Boolean);
  const rosterTagMeta = {
    trade: { bg: 'rgba(240,165,0,0.13)', col: '#F0A500', lbl: 'Trade' },
    cut: { bg: 'rgba(231,76,60,0.13)', col: '#E74C3C', lbl: 'Cut' },
    untouchable: { bg: 'rgba(46,204,113,0.13)', col: '#2ECC71', lbl: 'Core' },
    watch: { bg: 'rgba(52,152,219,0.13)', col: '#3498DB', lbl: 'Watch' },
  };
  const slotTagMeta = {
    starter: { bg: 'rgba(212,175,55,0.12)', col: 'var(--gold)', lbl: 'STR' },
    bench: { bg: 'rgba(255,255,255,0.055)', col: 'var(--silver)', lbl: 'BN' },
    taxi: { bg: 'rgba(52,152,219,0.12)', col: '#3498DB', lbl: 'TAX' },
    ir: { bg: 'rgba(231,76,60,0.12)', col: '#E74C3C', lbl: 'IR' },
  };
  const inlineTag = (cfg, key) => cfg ? (
    <span key={key} style={{
      fontSize: '0.58rem',
      padding: '2px 5px',
      borderRadius: '4px',
      fontWeight: 800,
      background: cfg.bg,
      color: cfg.col,
      border: '1px solid ' + cfg.col + '33',
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
    background: active ? 'var(--gold)' : 'rgba(255,255,255,0.045)',
    color: active ? 'var(--black)' : 'var(--silver)',
    border: '1px solid ' + (active ? 'var(--gold)' : 'rgba(255,255,255,0.09)'),
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  });
  const groupLabelStyle = { fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, whiteSpace: 'nowrap' };
  const sameColumnSet = (a, b) => a.length === b.length && a.every((key, idx) => key === b[idx]);
  const activePresetKey = Object.entries(COLUMN_PRESETS).find(([, cols]) => sameColumnSet(cols, visibleCols))?.[0] || 'custom';
  const activePresetMeta = COLUMN_PRESET_META[activePresetKey] || { label: 'Custom', tone: visibleCols.length + ' fields' };
  const isDeepData = activePresetKey === 'full';
  const visibleColGroupStarts = new Set();
  visibleCols.forEach((key, idx) => {
    const prev = visibleCols[idx - 1];
    if (idx > 0 && ROSTER_COLUMNS[key]?.group !== ROSTER_COLUMNS[prev]?.group) visibleColGroupStarts.add(key);
  });
  const columnGroupLabelFor = (key) => ROSTER_COLUMNS[key]?.group ? ROSTER_COLUMNS[key].group.toUpperCase() : '';
  const isCompactRows = rowDensity === 'compact';
  const rowHeight = isCompactRows ? 38 : 46;
  const avatarSize = isCompactRows ? 26 : 30;
  const playerNameSize = isCompactRows ? '0.78rem' : '0.84rem';
  const columnGroups = ['core', 'dynasty', 'stats', 'scout'].map(group => ({
    group,
    columns: Object.entries(ROSTER_COLUMNS).filter(([, col]) => col.group === group),
  })).filter(g => g.columns.length > 0);
  const playerColWidth = 292;
  const visibleDataWidth = visibleCols.reduce((sum, key) => sum + parseInt(ROSTER_COLUMNS[key]?.width || '0', 10), 0);
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

  // renderCell — renders each data cell with FM-style coloring
  function renderCell(colKey, r) {
    const col = ROSTER_COLUMNS[colKey];
    const isGroupStart = visibleColGroupStarts.has(colKey);
    const base = { width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: isCompactRows ? '0.78rem' : '0.84rem', padding: '0 5px', borderLeft: isGroupStart ? '2px solid rgba(212,175,55,0.18)' : '1px solid rgba(255,255,255,0.026)', lineHeight: 1.1 };

    switch(colKey) {
      case 'pos': return <div key={colKey} style={{...base}}><span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '1px 4px', borderRadius: '2px', background: (posColors[r.pos]||'#666')+'22', color: posColors[r.pos]||'var(--silver)' }}>{r.pos}</span></div>;
      case 'age': return <div key={colKey} style={{...base, background: ageBg(r.age, r.pos)}}><span style={{ color: ageCol(r.age, r.pos), fontWeight: 600 }}>{r.age||'\u2014'}</span></div>;
      case 'dhq': return <div key={colKey} style={{...base, background: dhqBg(r.dhq)}}><span style={{ color: dhqCol(r.dhq), fontWeight: 700, fontFamily: 'var(--font-body)', fontSize: '0.82rem' }}>{r.dhq > 0 ? r.dhq.toLocaleString() : '\u2014'}</span></div>;
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
        return <div key={colKey} style={{...base, background: ppgBg(shown, r.pos)}}><span style={{ color: shown >= (posP75[r.pos]||10) ? '#2ECC71' : 'var(--silver)' }}>{shown > 0 ? shown : '\u2014'}{marker}</span></div>;
      }
      case 'prev': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', opacity: 0.6 }}>{r.prevPPG > 0 ? r.prevPPG : '\u2014'}</span></div>;
      case 'trend': {
        const trendBars = (() => {
          const t = r.trend || 0;
          const up = t > 0;
          const color = t >= 15 ? '#2ECC71' : t <= -15 ? '#E74C3C' : 'var(--silver)';
          const heights = up ? [4, 6, 8, 11, 14] : t < 0 ? [14, 11, 8, 6, 4] : [8, 9, 10, 9, 8];
          return React.createElement('div', { className: 'wr-spark' }, ...heights.map((h, i) => React.createElement('div', { key: i, className: 'wr-spark-bar', style: { height: h + 'px', background: color } })));
        })();
        return <div key={colKey} style={{...base, background: trendBg(r.trend), flexDirection: 'column', gap: '1px'}}>
          <span style={{ color: r.trend>=15?'#2ECC71':r.trend<=-15?'#E74C3C':'var(--silver)', fontWeight: 600, fontSize: '0.74rem' }}>{r.trend>0?'+'+r.trend+'%':r.trend<0?r.trend+'%':'\u2014'}</span>
          {trendBars}
        </div>;
      }
	      case 'peak': return <div key={colKey} style={{...base, flexDirection: 'column', gap: '1px'}}>
	        <span style={{ fontSize: '0.76rem', fontWeight: 700, color: r.peakPhase==='PRIME'?'#2ECC71':r.peakPhase==='PRE'?'#3498DB':r.peakPhase==='VET'?'#F0A500':'#E74C3C' }}>{r.peakPhase}</span>
        <div style={{ width: '30px', height: '3px', borderRadius: '1px', background: 'rgba(255,255,255,0.06)', overflow: 'hidden', position: 'relative' }}>
          <div style={{ position:'absolute',left:0,top:0,height:'100%',width:'30%',background:'rgba(52,152,219,0.4)' }}></div>
          <div style={{ position:'absolute',left:'30%',top:0,height:'100%',width:'40%',background:'rgba(46,204,113,0.4)' }}></div>
          <div style={{ position:'absolute',left:'70%',top:0,height:'100%',width:'30%',background:'rgba(231,76,60,0.3)' }}></div>
          <div style={{ position:'absolute',left:r.peakPct+'%',top:'-1px',width:'2px',height:'5px',background:'var(--white)',borderRadius:'1px' }}></div>
        </div>
      </div>;
      case 'action': {
        const ann = getPlayerAnnotation(r.pid);
        return <div key={colKey} style={{...base, flexDirection:'column', gap:'2px', alignItems:'center'}} title={ann?.text || ''}>
          <span style={{ fontSize:'0.74rem',fontWeight:700,padding:'3px 8px',borderRadius:'4px',background:/sell/i.test(r.rec)?'rgba(231,76,60,0.15)':/buy|build|core/i.test(r.rec)?'rgba(46,204,113,0.18)':'rgba(212,175,55,0.15)',color:/sell/i.test(r.rec)?'#E74C3C':/buy|build|core/i.test(r.rec)?'#2ECC71':'var(--gold)',border:'1px solid '+(/sell/i.test(r.rec)?'rgba(231,76,60,0.3)':/buy|build|core/i.test(r.rec)?'rgba(46,204,113,0.3)':'rgba(212,175,55,0.3)') }}>{r.rec}</span>
        </div>;
      }
      case 'gp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.74rem' }}>{r.effectiveGP > 0 ? r.effectiveGP : '\u2014'}{r.curGP === 0 && r.prevGP > 0 ? '*' : ''}</span></div>;
      case 'durability': { const gpForDur = r.durabilityGP || 0; return <div key={colKey} style={{...base}} title={'Avg GP: ' + gpForDur + '/17'}><div style={{ width:'24px',height:'4px',borderRadius:'2px',background:'rgba(255,255,255,0.06)',overflow:'hidden' }}><div style={{ width:Math.min(100,(gpForDur/17)*100)+'%',height:'100%',background:gpForDur>=15?'#2ECC71':gpForDur>=10?'#F0A500':'#E74C3C',borderRadius:'2px' }}></div></div></div>; }
      case 'yrsExp': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{r.p.years_exp ?? '\u2014'}</span></div>;
      case 'college': return <div key={colKey} style={{...base, justifyContent: 'flex-start'}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.p.college || '\u2014'}</span></div>;
      case 'nflDraft': { const dr = r.p.draft_round; const dp = r.p.draft_pick; const dy = r.p.draft_year; const dRound = dr || (dp ? Math.ceil(dp / 32) : null); const draftLabel = dRound ? (dy ? "'" + String(dy).slice(2) + ' ' : '') + 'Rd ' + dRound + (dp ? '.' + ((dp - 1) % 32 + 1) : '') : (r.p.undrafted === true || (r.p.years_exp > 0 && !dp && !dr) ? 'UDFA' : '\u2014'); return <div key={colKey} style={{...base}}><span style={{ color: dRound ? 'var(--silver)' : 'rgba(255,255,255,0.3)', fontSize: '0.74rem' }}>{draftLabel}</span></div>; }
      case 'posRankLg': {
        const allAtPos = (currentLeague.rosters||[]).flatMap(ros => (ros.players||[]).filter(pid => {
          const pp = playersData[pid];
          return pp && (normPos(pp.position) === r.pos);
        })).map(pid => ({pid, dhq: window.App?.LI?.playerScores?.[pid] || 0})).sort((a,b) => b.dhq - a.dhq);
        const rank = allAtPos.findIndex(x => x.pid === r.pid) + 1;
        return <div key={colKey} style={{...base}}><span style={{ color: rank<=3?'#2ECC71':rank<=8?'var(--gold)':'var(--silver)', fontWeight: rank<=3?700:400 }}>{rank > 0 ? '#'+rank : '\u2014'}</span></div>;
      }
      case 'posRankNfl': {
        const meta = r.meta;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)' }}>{meta?.fcRank ? '#'+meta.fcRank : '\u2014'}</span></div>;
      }
      case 'starterSzn': return <div key={colKey} style={{...base}}><span style={{ color: (r.meta?.starterSeasons||0)>=3?'#2ECC71':(r.meta?.starterSeasons||0)>=1?'var(--gold)':'var(--silver)', fontWeight: 600 }}>{r.meta?.starterSeasons ?? '\u2014'}</span></div>;
      case 'height': {
        const h = r.p.height;
        return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{h ? Math.floor(h/12)+"'"+h%12+'"' : '\u2014'}</span></div>;
      }
      case 'weight': return <div key={colKey} style={{...base}}><span style={{ color: 'var(--silver)', fontSize: '0.72rem' }}>{r.p.weight || '\u2014'}</span></div>;
      case 'depthChart': return <div key={colKey} style={{...base}}><span style={{ color: r.p.depth_chart_order != null ? 'var(--silver)' : 'rgba(255,255,255,0.3)', fontSize: '0.72rem' }}>{r.p.depth_chart_order != null ? r.pos + (r.p.depth_chart_order + 1) : (r.section === 'ir' ? 'IR' : (!r.p.team || r.p.team === 'FA') ? 'FA' : 'N/A')}</span></div>;
      case 'slot': return <div key={colKey} style={{...base}}><span style={{ fontSize:'0.76rem',color:'var(--silver)',opacity:0.65,textTransform:'uppercase' }}>{r.section==='starter'?'STR':r.section==='ir'?'IR':r.section==='taxi'?'TAX':'BN'}</span></div>;
      case 'acquired': {
        const acq = getAcquisitionInfo(r.pid, myRoster?.roster_id);
        const methodColors = { Drafted: '#3498DB', Traded: '#9B59B6', Waiver: 'var(--gold)', FA: '#2ECC71', Original: 'var(--silver)' };
        const col = methodColors[acq.method] || 'var(--silver)';
        const methods = ['Drafted', 'Traded', 'Waiver', 'FA', 'Original'];
        return <div key={colKey} style={{...base}}><span
          style={{ fontSize: '0.65rem', fontWeight: 600, color: col, padding: '1px 5px', borderRadius: '3px', border: `1px solid ${col}40`, background: `${col}10`, cursor: 'pointer' }}
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
        if (!sosMod?.ready) return <div key={colKey} style={{...base}}><span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '0.72rem' }}>{'\u2014'}</span></div>;
        const team = r.p?.team;
        if (!team || team === 'FA') return <div key={colKey} style={{...base}}><span style={{ color: 'rgba(255,255,255,0.2)' }}>{'\u2014'}</span></div>;
        const sos = sosMod.getPlayerSOS(r.pid, r.pos, team);
        if (!sos) return <div key={colKey} style={{...base}}><span style={{ color: 'rgba(255,255,255,0.2)' }}>{'\u2014'}</span></div>;
        const sosBg = sos.avgRank >= 25 ? 'rgba(46,204,113,0.12)' : sos.avgRank <= 8 ? 'rgba(231,76,60,0.1)' : 'transparent';
        return <div key={colKey} style={{...base, background: sosBg, flexDirection: 'column', gap: '1px'}} title={sos.label + ' schedule (' + sos.avgRank + '/32)'}>
          <span style={{ color: sos.color, fontWeight: 700, fontSize: '0.82rem', fontFamily: 'var(--font-body)' }}>{sos.avgRank}</span>
          <span style={{ color: sos.color, fontSize: '0.58rem', opacity: 0.8 }}>{sos.label.toUpperCase()}</span>
        </div>;
      }
      default: return <div key={colKey} style={{...base}}>{'\u2014'}</div>;
    }
  }

  return (
    <div style={{ padding: 'var(--card-pad, 14px 16px)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <section style={{ background: 'rgba(20,20,26,0.78)', border: '1px solid rgba(255,255,255,0.075)', borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '14px', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 240, flex: '1 1 520px' }}>
            <div style={{ fontSize: '0.62rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800 }}>My Roster</div>
            <div style={{ marginTop: '3px', display: 'flex', alignItems: 'center', gap: '9px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.45rem', lineHeight: 1, color: 'var(--white)', fontWeight: 700, letterSpacing: '0.02em' }}>{tierLabel} Roster</span>
              {(() => {
                const champs = window.App?.LI?.championships || {};
                const myChampCount = Object.values(champs).filter(c => c.champion === myRoster?.roster_id).length;
                if (myChampCount <= 0) return null;
                return <span style={{ fontSize: '0.66rem', color: 'var(--gold)', fontWeight: 800, border: '1px solid rgba(212,175,55,0.24)', borderRadius: '999px', padding: '2px 8px', background: 'rgba(212,175,55,0.08)' }}>{myChampCount > 1 ? myChampCount + 'x ' : ''}Champion</span>;
              })()}
            </div>
            <div style={{ marginTop: '5px', fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.78, lineHeight: 1.45 }}>
              {allPlayers.length} players &middot; {sectionCounts.starter} starters &middot; {sectionCounts.bench} bench &middot; {sectionCounts.taxi} taxi &middot; {sectionCounts.ir} IR
            </div>
          </div>
        </div>

        {(boardInsightChips.length > 0 || needs.length > 0) && (
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {boardInsightChips.filter(chip => !/needs/i.test(chip.label)).slice(0, 2).map(chip => (
              <span key={chip.label} style={{ fontSize: '0.66rem', color: chip.color, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', borderRadius: '999px', padding: '2px 8px', fontWeight: 700, letterSpacing: '0.02em' }}>{chip.label}</span>
            ))}
            {needs.slice(0, 2).map(n => (
              <span key={n.pos} style={{ fontSize: '0.66rem', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.2)', background: 'rgba(212,175,55,0.07)', borderRadius: '999px', padding: '2px 8px', fontWeight: 700, letterSpacing: '0.02em' }}>{n.pos} need</span>
            ))}
          </div>
        )}
      </section>

      <section style={{ background: 'rgba(20,20,26,0.78)', border: '1px solid rgba(255,255,255,0.075)', borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div className="wr-module-toolbar">
          <span className="wr-module-toolbar-label">Scope</span>
          <div className="wr-module-nav">
          {['All','Starters','Bench','Taxi','IR','Offense','IDP'].map(f => (
            <button key={f} className={rosterFilter === f ? 'is-active' : ''} onClick={() => setRosterFilter(f)}>{f}</button>
          ))}
          </div>
          <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.66, whiteSpace: 'nowrap' }}>{filtered.length} of {allPlayers.length} shown</span>
        </div>

        <div className="wr-module-toolbar">
          <span className="wr-module-toolbar-label">Columns</span>
          <div className="wr-module-nav">
          {Object.entries(COLUMN_PRESETS).map(([key, cols]) => (
            <button key={key} className={activePresetKey === key ? 'is-active' : ''} onClick={() => { setVisibleCols(cols); setColPreset(key); }}>{COLUMN_PRESET_META[key]?.label || key}</button>
          ))}
          <button className={(showColPicker || activePresetKey === 'custom') ? 'is-active' : ''} onClick={() => setShowColPicker(!showColPicker)}>Customize</button>
          </div>
          <span className="wr-module-toolbar-label">PPG</span>
          <div className="wr-module-nav">
          {[{k:'season',l:'Season'},{k:'l5',l:'L5'},{k:'l3',l:'L3'}].map(opt => (
            <button key={opt.k} className={ppgWindow === opt.k ? 'is-active' : ''} onClick={() => setPpgWindow(opt.k)} title={opt.k === 'season' ? 'Season-to-date PPG' : 'Last ' + (opt.k === 'l5' ? 5 : 3) + ' games — requires weekly data'}>{opt.l}</button>
          ))}
          </div>
          <span className="wr-module-toolbar-label">Density</span>
          <div className="wr-module-nav">
          {[{k:'comfortable',l:'Comfort'},{k:'compact',l:'Compact'}].map(opt => (
            <button key={opt.k} className={rowDensity === opt.k ? 'is-active' : ''} onClick={() => setRowDensity(opt.k)}>{opt.l}</button>
          ))}
          </div>
          <span className="wr-module-toolbar-label">Group</span>
          <div className="wr-module-nav">
          {GROUP_MODES.map(opt => (
            <button key={opt.key} className={rosterGroupMode === opt.key ? 'is-active' : ''} onClick={() => setRosterGroupMode(opt.key)}>{opt.label}</button>
          ))}
          </div>
        </div>

        {window.WR?.SavedViews?.SavedViewBar && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {React.createElement(window.WR.SavedViews.SavedViewBar, {
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
        )}
      </section>

      <div>

      {/* Column picker dropdown */}
      {showColPicker && (
        <div style={{ background: 'linear-gradient(180deg, rgba(22,22,29,0.98), rgba(10,10,14,0.98))', border: '1px solid rgba(212,175,55,0.22)', borderRadius: '10px', padding: '12px', marginBottom: '10px', boxShadow: '0 10px 28px rgba(0,0,0,0.24)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', color: 'var(--white)', fontWeight: 700, letterSpacing: '0.04em' }}>Customize Columns</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.58 }}>{visibleCols.length} of {Object.keys(ROSTER_COLUMNS).length} active</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={() => setCustomColumns(Object.keys(ROSTER_COLUMNS))} style={controlBtn(inactiveColumnCount === 0)}>All Fields</button>
              <button onClick={() => setCustomColumns(COLUMN_PRESETS.default)} style={controlBtn(activePresetKey === 'default')}>Reset Default</button>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 0.9fr) minmax(360px, 1.4fr)', gap: '12px', alignItems: 'start' }}>
            <div style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '10px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '8px' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>Active Order</div>
                <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.54 }}>{activeColumnOrder.length} visible</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', paddingRight: '2px' }}>
                {activeColumnOrder.length === 0 ? (
                  <div style={{ padding: '12px', borderRadius: '8px', border: '1px dashed rgba(255,255,255,0.12)', color: 'var(--silver)', opacity: 0.62, fontSize: '0.74rem' }}>Only the player column is visible.</div>
                ) : activeColumnOrder.map((key, idx) => {
                  const col = ROSTER_COLUMNS[key];
                  return (
                    <div key={key} style={{ display: 'grid', gridTemplateColumns: '22px minmax(0, 1fr) 26px 26px 26px', gap: '5px', alignItems: 'center', padding: '5px 6px', borderRadius: '7px', background: 'rgba(212,175,55,0.075)', border: '1px solid rgba(212,175,55,0.14)' }}>
                      <span style={{ color: 'var(--silver)', opacity: 0.55, fontSize: '0.68rem', textAlign: 'right' }}>{idx + 1}</span>
                      <span title={col.label} style={{ color: 'var(--white)', fontSize: '0.74rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col.shortLabel || col.label}</span>
                      <button disabled={idx === 0} onClick={() => moveVisibleColumn(key, -1)} title="Move left" style={{ height: '24px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.09)', background: idx === 0 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.06)', color: idx === 0 ? 'rgba(255,255,255,0.24)' : 'var(--silver)', cursor: idx === 0 ? 'default' : 'pointer' }}>{'\u2039'}</button>
                      <button disabled={idx === activeColumnOrder.length - 1} onClick={() => moveVisibleColumn(key, 1)} title="Move right" style={{ height: '24px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.09)', background: idx === activeColumnOrder.length - 1 ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.06)', color: idx === activeColumnOrder.length - 1 ? 'rgba(255,255,255,0.24)' : 'var(--silver)', cursor: idx === activeColumnOrder.length - 1 ? 'default' : 'pointer' }}>{'\u203A'}</button>
                      <button onClick={() => removeVisibleColumn(key)} title="Hide column" style={{ height: '24px', borderRadius: '5px', border: '1px solid rgba(231,76,60,0.22)', background: 'rgba(231,76,60,0.08)', color: '#E74C3C', cursor: 'pointer' }}>{'\u00D7'}</button>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
                <div style={{ fontSize: '0.62rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '7px' }}>Group Rows By</div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {GROUP_MODES.map(opt => (
                    <button key={opt.key} onClick={() => setRosterGroupMode(opt.key)} style={controlBtn(rosterGroupMode === opt.key)}>{opt.label}</button>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px' }}>
              {columnGroups.map(({ group, columns }) => (
                <div key={group} style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '8px', padding: '8px' }}>
                  <div style={{ marginBottom: '6px', fontSize: '0.62rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800 }}>{group}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {columns.map(([key, col]) => {
                      const active = visibleCols.includes(key);
                      return (
                        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '7px', padding: '5px 7px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.74rem', background: active ? 'rgba(212,175,55,0.1)' : 'rgba(255,255,255,0.018)', color: active ? 'var(--gold)' : 'var(--silver)', border: '1px solid ' + (active ? 'rgba(212,175,55,0.18)' : 'rgba(255,255,255,0.04)') }}>
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
      <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: '10px', overflow: 'hidden', background: 'rgba(12,12,17,0.98)', boxShadow: '0 12px 32px rgba(0,0,0,0.25)' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.025)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ fontFamily: 'Rajdhani, sans-serif', color: 'var(--white)', fontSize: '1.02rem', fontWeight: 700, letterSpacing: '0.04em' }}>Roster Board</div>
            <div style={{ fontSize: '0.72rem', color: isDeepData ? 'var(--gold)' : 'var(--silver)', opacity: isDeepData ? 0.9 : 0.56, border: isDeepData ? '1px solid rgba(212,175,55,0.24)' : '1px solid rgba(255,255,255,0.08)', borderRadius: '999px', padding: '2px 8px', background: isDeepData ? 'rgba(212,175,55,0.08)' : 'rgba(255,255,255,0.035)' }}>{activePresetMeta.label} · {visibleCols.length} fields</div>
            <div style={{ fontSize: '0.72rem', color: rosterGroupMode === 'none' ? 'var(--silver)' : 'var(--gold)', opacity: 0.68, border: '1px solid rgba(255,255,255,0.08)', borderRadius: '999px', padding: '2px 8px', background: 'rgba(255,255,255,0.035)' }}>Grouped: {activeGroupModeLabel}</div>
            <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.48, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{activePresetMeta.tone}</div>
            <div style={{ marginLeft: 'auto', fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Sorted by {ROSTER_COLUMNS[rosterSort.key]?.shortLabel || (rosterSort.key === 'name' ? 'Player' : rosterSort.key)}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '7px' }}>
            {boardInsightChips.map(chip => (
              <span key={chip.label} style={{ fontSize: '0.66rem', color: chip.color, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.035)', borderRadius: '999px', padding: '2px 8px', fontWeight: 700, letterSpacing: '0.02em' }}>{chip.label}</span>
            ))}
          </div>
        </div>
        <div style={{ overflowX: 'auto', background: 'linear-gradient(90deg, rgba(255,255,255,0.02), transparent 12%, transparent 88%, rgba(255,255,255,0.018))' }}>
          <div style={{ minWidth: tableMinWidth + 'px' }}>
            {/* Header row */}
            <div style={{ display: 'flex', height: '40px', background: 'linear-gradient(180deg, rgba(212,175,55,0.12), rgba(212,175,55,0.055))', borderBottom: '1px solid rgba(212,175,55,0.24)', position: 'sticky', top: 0, zIndex: 5 }}>
              <div title="Player" style={{ width: playerColWidth + 'px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: '0.78rem', fontWeight: 800, color: rosterSort.key === 'name' ? 'var(--white)' : 'var(--gold)', fontFamily: 'var(--font-body)', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none', borderRight: '1px solid rgba(212,175,55,0.2)', textTransform: 'uppercase', position: 'sticky', left: 0, zIndex: 7, background: 'linear-gradient(180deg, #272315, #17150d)', boxShadow: '10px 0 18px rgba(0,0,0,0.24)' }}
                onClick={() => setRosterSort(prev => prev.key === 'name' ? {...prev, dir: prev.dir*-1} : {key: 'name', dir: 1})}>
                Player{rosterSort.key === 'name' ? (rosterSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''}
              </div>
              <div style={{ flex: 1, display: 'flex' }}>
                {visibleCols.map(colKey => {
                  const col = ROSTER_COLUMNS[colKey];
                  if (!col) return null;
                  const isSorted = rosterSort.key === colKey;
                  const isGroupStart = visibleColGroupStarts.has(colKey);
                  return (
                    <div key={colKey} title={col.label} onClick={() => setRosterSort(prev => prev.key === colKey ? {...prev, dir: prev.dir*-1} : {key: colKey, dir: 1})}
                      style={{ width: col.width, minWidth: col.width, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '0.76rem', fontWeight: 800, color: isSorted ? 'var(--white)' : 'var(--gold)', fontFamily: 'var(--font-body)', letterSpacing: '0.045em', cursor: 'pointer', userSelect: 'none', textTransform: 'uppercase', borderLeft: isGroupStart ? '2px solid rgba(212,175,55,0.28)' : '1px solid rgba(255,255,255,0.045)', padding: '0 4px', textAlign: 'center', lineHeight: 1.05, background: isSorted ? 'rgba(212,175,55,0.13)' : isGroupStart ? 'rgba(212,175,55,0.035)' : 'transparent' }}>
                      {isGroupStart && <span style={{ fontSize: '0.44rem', color: 'var(--silver)', opacity: 0.52, letterSpacing: '0.08em', lineHeight: 1 }}>{columnGroupLabelFor(colKey)}</span>}
                      <span>{col.shortLabel || col.label}{rosterSort.key === colKey ? (rosterSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Player rows + inline expand */}
            {filtered.map((r, idx) => {
              const isExpanded = expandedPid === r.pid;
              const contract = window.NFL_CONTRACTS?.[r.pid];
              const rowGroupKey = getRowGroupKey(r);
              const startsPositionGroup = rosterGroupMode !== 'none' && (idx === 0 || getRowGroupKey(filtered[idx - 1]) !== rowGroupKey);
              const rowBg = isExpanded ? 'rgba(212,175,55,0.075)' : idx % 2 === 1 ? 'rgba(255,255,255,0.024)' : 'rgba(255,255,255,0.008)';

              const _recLower = (r.rec || '').toLowerCase();
          const actionClass = _recLower === 'sell now' || _recLower === 'sell' ? 'wr-row-sell' :
            _recLower === 'sell high' ? 'wr-row-sell-high' :
            _recLower === 'hold core' || _recLower === 'build around' ? 'wr-row-core' : '';
          const untouchables = (window._wrGmStrategy?.untouchable || []);
          const isUntouchable = untouchables.includes(r.pid);

          return (
            <React.Fragment key={r.pid}>
              {startsPositionGroup && (
                <div style={{ display: 'flex', height: isCompactRows ? '22px' : '24px', borderTop: idx === 0 ? 'none' : '1px solid rgba(212,175,55,0.14)', borderBottom: '1px solid rgba(255,255,255,0.035)', background: 'linear-gradient(90deg, rgba(212,175,55,0.075), rgba(212,175,55,0.025) 36%, rgba(255,255,255,0.012))' }}>
                  <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 4, display: 'flex', alignItems: 'center', gap: '8px', padding: '0 12px', background: 'linear-gradient(90deg, #15130e, #111117)', borderRight: '1px solid rgba(212,175,55,0.14)', boxShadow: '10px 0 18px rgba(0,0,0,0.18)' }}>
                    <span style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '0.82rem', color: getRowGroupColor(r), fontWeight: 800, letterSpacing: '0.08em' }}>{getRowGroupLabel(r)}</span>
                    <span style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{filteredPosCounts[rowGroupKey]} players</span>
                  </div>
                  <div style={{ flex: 1, borderLeft: '1px solid rgba(255,255,255,0.025)' }} />
                </div>
              )}
              {/* Normal row */}
              <div className={[actionClass, isUntouchable ? 'wr-untouchable' : ''].filter(Boolean).join(' ')} style={{ display: 'flex', overflow: 'visible', borderTop: 'none', borderBottom: isExpanded ? 'none' : '1px solid rgba(255,255,255,0.035)', cursor: 'pointer', background: rowBg, transition: 'background 0.1s' }}
                onClick={() => setExpandedPid(prev => prev === r.pid ? null : r.pid)}
                onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = 'rgba(212,175,55,0.06)'; }}
                onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = rowBg; }}>
                {/* Frozen player info */}
                <div style={{ width: playerColWidth + 'px', flexShrink: 0, height: rowHeight + 'px', display: 'flex', alignItems: 'center', gap: '8px', padding: '0 10px', borderRight: '1px solid rgba(212,175,55,0.12)', position: 'sticky', left: 0, zIndex: 3, background: 'inherit', boxShadow: '10px 0 18px rgba(0,0,0,0.18)' }}>
                  <div style={{ width: avatarSize + 'px', height: avatarSize + 'px', flexShrink: 0 }}><img src={'https://sleepercdn.com/content/nfl/players/thumb/'+r.pid+'.jpg'} alt="" onError={e=>e.target.style.display='none'} style={{ width: avatarSize + 'px', height: avatarSize + 'px', borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.08)' }} /></div>
                  <div style={{ overflow: 'hidden', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <span style={{ fontWeight: 700, color: 'var(--white)', fontSize: playerNameSize, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{getPlayerName(r.pid)}</span>
                      {inlineTag(slotTagMeta[r.section], 'slot-' + r.pid)}
                      {inlineTag(rosterTagMeta[window._playerTags?.[r.pid]], 'tag-' + r.pid)}
                      {dropCandidatePids.has(r.pid) && !dismissedDrops.has(r.pid) && <span onClick={e => { e.stopPropagation(); dismissDrop(r.pid); }} title="Drop candidate (click to dismiss)" style={{ fontSize: '0.56rem', padding: '1px 4px', borderRadius: '3px', fontWeight: 700, background: 'rgba(231,76,60,0.2)', color: '#E74C3C', border: '1px solid rgba(231,76,60,0.4)', flexShrink: 0, cursor: 'pointer', lineHeight: 1 }}>DROP?</span>}
                    </div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--silver)', opacity: 0.62, marginTop: '1px' }}>{r.p.team || 'FA'}{r.injury ? ' \u00B7 '+r.injury : ''}</div>
                  </div>
                  <span style={{ fontSize: '0.68rem', color: 'var(--gold)', opacity: 0.42 }}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
                </div>
                {/* Data columns */}
                <div style={{ flex: 1, display: 'flex', height: rowHeight + 'px', overflow: 'hidden' }}>
                  {visibleCols.map(colKey => ROSTER_COLUMNS[colKey] ? renderCell(colKey, r) : null)}
                </div>
              </div>

              {/* Inline expand card — Madden/FM style */}
              {isExpanded && (
                <div style={{ borderBottom: '2px solid rgba(212,175,55,0.25)', background: 'linear-gradient(180deg, rgba(18,18,24,0.99), rgba(6,6,10,0.99))', padding: '16px 20px', animation: 'wrFadeIn 0.2s ease' }}>
                  {/* Player dossier */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.72fr) minmax(360px, 1.25fr) minmax(220px, 0.72fr)', gap: '12px', marginBottom: '14px', alignItems: 'stretch' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '82px minmax(0, 1fr)', gap: '12px', alignItems: 'center', background: 'rgba(255,255,255,0.026)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '9px', padding: '10px' }}>
                      <div style={{ flexShrink: 0, position: 'relative' }}>
                        <img src={'https://sleepercdn.com/content/nfl/players/'+r.pid+'.jpg'} alt="" onError={e=>{e.target.style.display='none';e.target.nextSibling.style.display='flex';}} style={{ width: '78px', height: '78px', borderRadius: '10px', objectFit: 'cover', objectPosition: 'top', border: '2px solid rgba(212,175,55,0.28)' }} />
                        <div style={{ display: 'none', width: '78px', height: '78px', borderRadius: '10px', background: 'var(--charcoal)', alignItems: 'center', justifyContent: 'center', fontSize: '1.4rem', fontWeight: 700, color: 'var(--silver)', border: '2px solid rgba(212,175,55,0.2)' }}>{(r.p.first_name||'?')[0]}{(r.p.last_name||'?')[0]}</div>
                        <div style={{ position: 'absolute', bottom: '-4px', left: '50%', transform: 'translateX(-50%)', fontSize: '0.7rem', fontWeight: 700, padding: '1px 8px', borderRadius: '8px', background: (posColors[r.pos]||'#666')+'25', color: posColors[r.pos]||'var(--silver)', whiteSpace: 'nowrap' }}>{r.pos}</div>
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.34rem', color: 'var(--white)', letterSpacing: '0.02em', lineHeight: 1.08, display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.p.full_name || getPlayerName(r.pid)}</span>
                        </div>
                        <div style={{ fontSize: '0.76rem', color: 'var(--silver)', marginTop: '4px', lineHeight: 1.35 }}>
                          {r.p.team || 'FA'} {'\u00B7'} Age {r.age || '?'} {'\u00B7'} {r.p.years_exp||0}yr exp
                          {r.p.college ? ' \u00B7 '+r.p.college : ''}
                        </div>
                        {r.injury && <div style={{ fontSize: '0.72rem', color: '#E74C3C', fontWeight: 700, marginTop: '5px' }}>{r.injury}</div>}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.022)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '9px', padding: '10px 12px', minWidth: 0 }}>
                      <div style={{ fontSize: '0.62rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 800, marginBottom: '5px' }}>Dynasty Read</div>
                      <div style={{ fontSize: '0.82rem', color: '#d8d8de', lineHeight: 1.42 }}>
	                        {r.peakPhase === 'PRE' && r.dhq >= 4000 ? 'Rising asset with ' + r.peakYrsLeft + ' peak years ahead. Buy window closing.' :
	                         r.peakPhase === 'PRIME' && r.dhq >= 7000 ? 'Elite producer in prime. Cornerstone dynasty asset.' :
	                         r.peakPhase === 'PRIME' && r.dhq >= 4000 ? 'Solid starter in peak window. ' + r.peakYrsLeft + ' productive years left.' :
	                         r.peakPhase === 'VET' ? 'Past elite peak but still in the valuable veteran band. ' + (r.valueYrsLeft ? r.valueYrsLeft + ' value years left.' : 'Final value year.') :
	                         r.peakPhase === 'POST' ? 'Past value window \u2014 dynasty value declining. ' + (r.dhq >= 3000 ? 'Sell before the cliff.' : 'Move for any return.') :
	                         r.dhq < 2000 ? 'Depth piece. Low dynasty value.' :
                         'Moderate dynasty asset. Watch trajectory.'}
                        {r.trend >= 20 ? ' Trending up ' + r.trend + '%.' : r.trend <= -20 ? ' Production down ' + Math.abs(r.trend) + '%.' : ''}
                      </div>
                    </div>
                    <div style={{ background: 'rgba(255,255,255,0.022)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: '9px', padding: '10px 12px', minWidth: 0 }}>
                      <div style={{ fontSize: '0.62rem', color: 'var(--silver)', opacity: 0.58, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 800, marginBottom: '7px' }}>Decision Stack</div>
                      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, fontFamily: 'var(--font-body)', padding: '3px 10px', borderRadius: '999px', background: /sell/i.test(r.rec) ? 'rgba(231,76,60,0.15)' : /buy|build|core/i.test(r.rec) ? 'rgba(46,204,113,0.15)' : 'rgba(212,175,55,0.12)', color: /sell/i.test(r.rec) ? '#E74C3C' : /buy|build|core/i.test(r.rec) ? '#2ECC71' : 'var(--gold)', letterSpacing: '0.03em' }}>{r.rec}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: '999px', background: dhqBg(r.dhq), color: dhqCol(r.dhq) }}>
                          {(typeof window.App?.isElitePlayer === 'function' ? window.App.isElitePlayer(r.pid) : r.dhq >= 7000) ? 'Elite' : r.dhq >= 4000 ? 'Starter' : r.dhq >= 2000 ? 'Depth' : 'Stash'} {'\u00B7'} {r.dhq.toLocaleString()} DHQ
                        </span>
                        <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '999px', background: r.peakPhase === 'PRE' ? 'rgba(46,204,113,0.1)' : r.peakPhase === 'POST' ? 'rgba(231,76,60,0.1)' : 'rgba(212,175,55,0.08)', color: r.peakPhase === 'PRE' ? '#2ECC71' : r.peakPhase === 'POST' ? '#E74C3C' : 'var(--gold)', fontWeight: 700 }}>{r.peakPhase}</span>
                      </div>
                      <div style={{ marginTop: '8px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '0.72rem', color: 'var(--silver)' }}>
                        <div><span style={{ opacity: 0.55 }}>Slot </span><strong style={{ color: 'var(--white)' }}>{r.section === 'starter' ? 'Starter' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench'}</strong></div>
                        <div><span style={{ opacity: 0.55 }}>Depth </span><strong style={{ color: 'var(--white)' }}>{r.p.depth_chart_order != null ? r.pos + (r.p.depth_chart_order + 1) : '\u2014'}</strong></div>
                        <div><span style={{ opacity: 0.55 }}>Peak </span><strong style={{ color: 'var(--white)' }}>{r.peakYrsLeft > 0 ? r.peakYrsLeft + ' yrs' : '\u2014'}</strong></div>
                        <div><span style={{ opacity: 0.55 }}>Trend </span><strong style={{ color: r.trend >= 15 ? '#2ECC71' : r.trend <= -15 ? '#E74C3C' : 'var(--white)' }}>{r.trend ? (r.trend > 0 ? '+' : '') + r.trend + '%' : '\u2014'}</strong></div>
                      </div>
                    </div>
                  </div>

                  {/* Stat boxes grid — Madden style */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))', gap: '6px', marginBottom: '14px' }}>
                    {(() => {
                      const dhqPct = Math.min(100, Math.round((r.dhq / 10000) * 100));
                      const dhqFilled = Math.round(dhqPct / 10);
                      const dhqColor = r.dhq >= 7000 ? 'filled-green' : r.dhq >= 4000 ? 'filled' : 'filled-red';
                      return [
                        { label: 'DHQ', val: r.dhq > 0 ? r.dhq.toLocaleString() : '\u2014', col: dhqCol(r.dhq), gauge: true },
                        { label: 'RANK', val: (() => {
                          const allAtPos = (currentLeague.rosters||[]).flatMap(ros=>(ros.players||[]).filter(pid2=>normPos(playersData[pid2]?.position)===r.pos)).map(pid2=>({pid:pid2,dhq:window.App?.LI?.playerScores?.[pid2]||0})).sort((a,b)=>b.dhq-a.dhq);
                          const rank = allAtPos.findIndex(x=>x.pid===r.pid)+1;
                          return rank > 0 ? r.pos + rank : '\u2014';
                        })(), col: 'var(--gold)' },
                        { label: 'PPG', val: r.effectivePPG || '\u2014', col: r.effectivePPG >= (posP75[r.pos]||10) ? '#2ECC71' : 'var(--text-primary)' },
                        { label: 'GP', val: r.effectiveGP || '\u2014', col: r.effectiveGP >= 14 ? '#2ECC71' : r.effectiveGP >= 10 ? 'var(--silver)' : '#E74C3C' },
                        { label: 'TREND', val: r.trend ? (r.trend > 0 ? '+' : '') + r.trend + '%' : '\u2014', col: r.trend >= 15 ? '#2ECC71' : r.trend <= -15 ? '#E74C3C' : 'var(--silver)' },
                        { label: 'DEPTH', val: r.p.depth_chart_order != null ? r.pos + (r.p.depth_chart_order + 1) : '\u2014', col: r.p.depth_chart_order != null && r.p.depth_chart_order <= 1 ? '#2ECC71' : 'var(--silver)' },
                      ].map((s, i) => (
                        <div key={i} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '8px 6px', textAlign: 'center' }}>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.1rem', fontWeight: 600, color: s.col, letterSpacing: 0 }}>{s.val}</div>
                          {s.gauge && <div className="wr-gauge" style={{ marginTop: '3px' }}>{Array.from({length: 10}, (_, gi) => <div key={gi} className={'wr-gauge-seg' + (gi < dhqFilled ? ' ' + dhqColor : '')}></div>)}</div>}
                          <div style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: '2px' }}>{s.label}</div>
                        </div>
                      ));
                    })()}
                  </div>

                  {/* Physical + Draft Profile */}
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px' }}>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>Profile</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px', fontSize: '0.78rem' }}>
                      <div><span style={{ color: 'var(--silver)', opacity: 0.6 }}>Ht </span><span style={{ color: 'var(--white)' }}>{r.p.height ? Math.floor(r.p.height/12)+"'"+r.p.height%12+'"' : '\u2014'}</span></div>
                      <div><span style={{ color: 'var(--silver)', opacity: 0.6 }}>Wt </span><span style={{ color: 'var(--white)' }}>{r.p.weight ? r.p.weight+'lbs' : '\u2014'}</span></div>
                      <div><span style={{ color: 'var(--silver)', opacity: 0.6 }}>Slot </span><span style={{ color: 'var(--white)' }}>{r.section === 'starter' ? 'Starter' : r.section === 'ir' ? 'IR' : r.section === 'taxi' ? 'Taxi' : 'Bench'}</span></div>
                      <div><span style={{ color: 'var(--silver)', opacity: 0.6 }}>Exp </span><span style={{ color: 'var(--white)' }}>{r.p.years_exp || 0}yr</span></div>
                      {r.p.college && <div><span style={{ color: 'var(--silver)', opacity: 0.6 }}>College </span><span style={{ color: 'var(--white)' }}>{r.p.college}</span></div>}
                      {r.p.depth_chart_order != null && <div><span style={{ color: 'var(--silver)', opacity: 0.6 }}>NFL Depth </span><span style={{ color: r.p.depth_chart_order <= 1 ? '#2ECC71' : 'var(--white)' }}>{r.pos + (r.p.depth_chart_order + 1)}</span></div>}
                    </div>
                  </div>

	                  {/* Age Curve visualization */}
	                  {(() => {
	                    const nP = r.pos === 'DE' || r.pos === 'DT' ? 'DL' : r.pos === 'CB' || r.pos === 'S' ? 'DB' : r.pos;
	                    const curve = typeof window.App?.getAgeCurve === 'function'
	                      ? window.App.getAgeCurve(nP)
	                      : { build: [22, 24], peak: (window.App.peakWindows || {})[nP] || [24, 29], decline: [30, 32] };
	                    const [pLo, pHi] = curve.peak;
	                    const declineHi = curve.decline[1];
	                    const ages = Array.from({length: 17}, (_, i) => i + 20);
                    return <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Age Curve</div>
	                        <div style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{'Currently age ' + (r.age || '?') + ' \u00B7 ' + r.peakPhase + ' \u00B7 ' + (r.peakYrsLeft > 0 ? '~' + r.peakYrsLeft + ' peak yr left' : r.valueYrsLeft > 0 ? '~' + r.valueYrsLeft + ' value yr left' : 'Past value window')}</div>
                      </div>
                      <div style={{ display: 'flex', height: '22px', borderRadius: '5px', overflow: 'hidden', gap: '1px' }}>
                        {ages.map(a => {
	                          const col = a < pLo - 3 ? 'rgba(96,165,250,0.3)' : a < pLo ? 'rgba(46,204,113,0.45)' : (a >= pLo && a <= pHi) ? 'rgba(46,204,113,0.75)' : a <= declineHi ? 'rgba(212,175,55,0.45)' : 'rgba(231,76,60,0.35)';
                          const isMe = a === (r.age || 0);
                          return <div key={a} style={{ flex: 1, background: col, opacity: isMe ? 1 : 0.55, outline: isMe ? '2px solid #D4AF37' : 'none', outlineOffset: '-1px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.6rem', fontWeight: 700, color: isMe ? 'var(--text-primary)' : 'transparent' }}>{isMe ? a : ''}</div>;
                        })}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: 'var(--silver)', marginTop: '3px' }}>
	                        <span>20</span><span>{'Peak ' + pLo + '\u2013' + pHi + ' / Value thru ' + declineHi}</span><span>36</span>
                      </div>
                    </div>;
                  })()}

                  {/* Career Stats Table */}
                  <InlineCareerStats pid={r.pid} pos={r.pos} player={r.p} scoringSettings={currentLeague?.scoring_settings} statsData={statsData} />

                  {/* Action buttons */}
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button onClick={e => { e.stopPropagation(); const playerName = r.p.full_name || getPlayerName(r.pid); setReconPanelOpen(true); sendReconMessage("I'd like help with " + playerName + ". Here are my options:\n1. Who are the best trade partners for " + playerName + "?\n2. What's the long-term projection for " + playerName + "?\n3. Should I hold or sell " + playerName + " right now?"); }} style={{ padding: '7px 16px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'rgba(124,107,248,0.15)', color: '#9b8afb', border: '1px solid rgba(124,107,248,0.3)', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 }}>ASK ALEX</button>
                    {/* Phase 2: News button removed per user feedback (2026-04-18) */}
                    {[{tag:'trade',label:'TRADE BLOCK',bg:'rgba(240,165,0,0.15)',col:'#F0A500',border:'rgba(240,165,0,0.3)'},{tag:'cut',label:'CUT',bg:'rgba(231,76,60,0.15)',col:'#E74C3C',border:'rgba(231,76,60,0.3)'},{tag:'untouchable',label:'UNTOUCHABLE',bg:'rgba(46,204,113,0.15)',col:'#2ECC71',border:'rgba(46,204,113,0.3)'},{tag:'watch',label:'WATCH',bg:'rgba(52,152,219,0.15)',col:'#3498DB',border:'rgba(52,152,219,0.3)'}].map(t => {
                      const isActive = window._playerTags?.[r.pid] === t.tag;
                      return <button key={t.tag} onClick={e => { e.stopPropagation(); const leagueId = currentLeague.id || currentLeague.league_id || ''; const tags = window._playerTags || {}; const wasActive = tags[r.pid] === t.tag; if (wasActive) delete tags[r.pid]; else tags[r.pid] = t.tag; window._playerTags = { ...tags }; if (window.OD?.savePlayerTags) window.OD.savePlayerTags(leagueId, tags); if (!wasActive) { const playerName = r.p.full_name || getPlayerName(r.pid); window.wrLogAction?.('\uD83C\uDFF7\uFE0F', 'Tagged ' + playerName + ' as ' + t.label, 'roster', { players: [{ name: playerName, pid: r.pid }], actionType: 'tag' }); } setTimeRecomputeTs(Date.now()); }} style={{ padding: '7px 12px', fontSize: '0.72rem', fontFamily: 'var(--font-body)', background: isActive ? t.bg : 'transparent', color: isActive ? t.col : 'var(--silver)', border: '1px solid ' + (isActive ? t.border : 'rgba(255,255,255,0.1)'), borderRadius: '6px', cursor: 'pointer', fontWeight: isActive ? 700 : 400, letterSpacing: '0.03em' }}>{t.label}</button>;
                    })}
                    <button onClick={e => { e.stopPropagation(); setExpandedPid(null); }} style={{ padding: '7px 16px', fontSize: '0.78rem', fontFamily: 'var(--font-body)', background: 'transparent', color: 'var(--silver)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '6px', cursor: 'pointer' }}>COLLAPSE</button>
                  </div>
                </div>
              )}
            </React.Fragment>
          );
            })}
            {filtered.length === 0 && (
              <div style={{ display: 'flex', minHeight: '76px', borderTop: '1px solid rgba(255,255,255,0.04)', background: 'rgba(255,255,255,0.012)' }}>
                <div style={{ width: playerColWidth + 'px', flexShrink: 0, position: 'sticky', left: 0, zIndex: 3, background: '#0d0d13', borderRight: '1px solid rgba(212,175,55,0.12)', display: 'flex', alignItems: 'center', padding: '0 12px', color: 'var(--silver)', fontWeight: 700 }}>No players</div>
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

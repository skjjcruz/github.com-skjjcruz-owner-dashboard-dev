// ══════════════════════════════════════════════════════════════════
// shared/player-modal.js — War Room Player Card
// Full-featured player modal with War Room gold/black palette,
// career stats, trade profile, position ranks, and dynasty insights.
// Requires: shared/constants.js, shared/dhq-engine.js, shared/sleeper-api.js
// ══════════════════════════════════════════════════════════════════

window.App = window.App || {};

// ── Career stats cache ──────────────────────────────────────────
const _fwCareerCache = {};

// ── Position colors ────────────────────────────────────────────
const _fwPosColor = {
  QB:'rgba(96,165,250,.18)', RB:'rgba(46,204,113,.18)', WR:'rgba(212,175,55,.18)',
  TE:'rgba(251,191,36,.18)', K:'rgba(139,143,154,.12)', DL:'rgba(251,146,60,.18)',
  LB:'rgba(167,139,250,.18)', DB:'rgba(244,114,182,.18)', DEF:'rgba(248,113,113,.12)'
};
const _fwPosText = {
  QB:'#60a5fa', RB:'#2ECC71', WR:'#D4AF37', TE:'#fbbf24', K:'#a8acb8',
  DL:'#fb923c', LB:'#a78bfa', DB:'#f472b6', DEF:'#f87171'
};

// ── War Room theme colors ─────────────────────────────────────
const _wr = {
  gold: '#D4AF37', black: '#0a0a0f', charcoal: '#111318', panel: '#181b22',
  border: 'rgba(212,175,55,.2)', borderDim: 'rgba(255,255,255,.07)',
  text: '#f0f0f3', text2: '#a8acb8', text3: '#7d8291',
  green: '#2ECC71', red: '#E74C3C', amber: '#fbbf24',
  goldBg: 'rgba(212,175,55,.08)', goldBorder: 'rgba(212,175,55,.25)',
};

// ── Helper: normalize IDP positions ───────────────────────────
function _fwNormPos(p) {
  if (['DE','DT','NT','IDL','EDGE'].includes(p)) return 'DL';
  if (['CB','S','SS','FS'].includes(p)) return 'DB';
  if (['OLB','ILB','MLB'].includes(p)) return 'LB';
  return p;
}

// ── Helper: FantasyPros URL ────────────────────────────────────
function _fwFPUrl(name) {
  if (!name) return '#';
  return 'https://www.fantasypros.com/nfl/players/' +
    name.toLowerCase().replace(/[.']/g,'').replace(/[^a-z0-9]+/g,'-').replace(/-+$/,'') + '.php';
}

// ── Helper: peak years ────────────────────────────────────────
const _fwPeaks = {QB:[27,33],RB:[22,26],WR:[24,29],TE:[25,30],DL:[24,29],LB:[23,28],DB:[24,29]};
function _fwPeakYears(pos, age) {
  const [lo,hi] = _fwPeaks[pos] || [24,29];
  if (!age) return {label:'\u2014',desc:'',lo,hi};
  if (age < lo-3) return {label:'Seedling',desc:(lo-age)+'yr to peak',lo,hi};
  if (age < lo) return {label:'Rising',desc:(lo-age)+'yr to peak',lo,hi};
  if (age <= hi) return {label:'Peak',desc:Math.max(0,hi-age)<=0?'final yr':'~'+(hi-age)+'yr left',lo,hi};
  if (age <= hi+2) return {label:'Veteran',desc:(age-hi)+'yr past peak',lo,hi};
  return {label:'Declining',desc:(age-hi)+'yr past peak',lo,hi};
}

// ── Helper: compute fantasy points from raw stats ─────────────
function _fwCalcPts(raw, sc) {
  if (!raw) return 0;
  if (typeof calcRawPts === 'function') return calcRawPts(raw, sc);
  if (typeof calcFantasyPts === 'function') return calcFantasyPts(raw, sc);
  if (window.App?.Sleeper?.calcFantasyPts) return window.App.Sleeper.calcFantasyPts(raw, sc);
  return 0;
}

// ── Inject modal DOM ──────────────────────────────────────────
function _ensureModalDOM() {
  if (document.getElementById('fw-player-modal')) return;
  const div = document.createElement('div');
  div.innerHTML = `
  <div id="fw-player-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);z-index:10000;align-items:flex-start;justify-content:center;padding:16px;overflow-y:auto">
    <div style="background:linear-gradient(135deg,${_wr.charcoal} 0%,${_wr.panel} 100%);border:2px solid ${_wr.gold};border-radius:16px;width:100%;max-width:640px;margin:auto;position:relative;box-shadow:0 16px 64px rgba(0,0,0,.7),0 0 0 1px rgba(212,175,55,.1);animation:fwModalIn .25s ease">
      <style>
        @keyframes fwModalIn{from{opacity:0;transform:translateY(12px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        #fw-player-modal *{box-sizing:border-box}
        .fwpm-stat-box{padding:10px 6px;text-align:center;border-right:1px solid ${_wr.borderDim}}
        .fwpm-stat-box:last-child{border-right:none}
        .fwpm-stat-val{font-size:17px;font-weight:800;letter-spacing:-.03em;line-height:1;font-family:'Bebas Neue',Oswald,monospace}
        .fwpm-stat-lbl{font-size:13px;color:${_wr.text2};text-transform:uppercase;letter-spacing:.06em;margin-top:5px;font-weight:600}
        .fwpm-section{margin-bottom:14px}
        .fwpm-section-title{font-family:'Bebas Neue',Oswald,sans-serif;font-size:13px;font-weight:600;color:${_wr.text2};text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
        .fwpm-card-box{background:${_wr.panel};border:1px solid ${_wr.border};border-radius:10px;padding:12px}
        .fwpm-btn{font-size:13px;padding:7px 16px;background:${_wr.panel};border:1px solid ${_wr.border};border-radius:8px;color:${_wr.text2};text-decoration:none;cursor:pointer;font-family:Oswald,sans-serif;font-weight:600;text-transform:uppercase;letter-spacing:.04em;transition:all .15s;display:inline-block}
        .fwpm-btn:hover{background:${_wr.goldBg};color:${_wr.gold};border-color:${_wr.gold}}
        .fwpm-btn-gold{background:${_wr.gold};color:${_wr.black};border-color:${_wr.gold}}
        .fwpm-btn-gold:hover{background:#c9a42e}
        .fwpm-career-row{display:grid;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);gap:3px;font-size:13px}
        .fwpm-career-row:last-child{border-bottom:none}
        .fwpm-career-hdr{font-size:13px;font-weight:700;color:${_wr.text3};text-transform:uppercase}
      </style>
      <!-- Banner -->
      <div id="fwpm-banner" style="border-radius:14px 14px 0 0;padding:20px 22px;position:relative;overflow:hidden;background:linear-gradient(135deg,${_wr.panel} 0%,rgba(212,175,55,.04) 100%)">
        <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 20% 50%,rgba(212,175,55,.06),transparent 60%);pointer-events:none"></div>
        <button onclick="closeFWPlayerModal()" style="position:absolute;top:12px;right:12px;background:rgba(0,0,0,.5);border:1px solid ${_wr.border};color:${_wr.text2};cursor:pointer;font-size:18px;line-height:1;width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;z-index:1;font-weight:400">&times;</button>
        <div style="display:flex;gap:16px;align-items:flex-start">
          <div style="position:relative;flex-shrink:0">
            <img id="fwpm-photo" src="" style="width:90px;height:90px;border-radius:12px;object-fit:cover;object-position:top;border:2px solid ${_wr.border}" onerror="this.style.display='none';document.getElementById('fwpm-initials').style.display='flex'"/>
            <div id="fwpm-initials" style="display:none;width:90px;height:90px;border-radius:12px;background:${_wr.panel};align-items:center;justify-content:center;font-size:26px;font-weight:700;color:${_wr.text3};border:2px solid ${_wr.border}"></div>
            <div id="fwpm-pos" style="position:absolute;bottom:-6px;left:50%;transform:translateX(-50%);font-size:13px;font-weight:700;padding:2px 8px;border-radius:10px;white-space:nowrap"></div>
          </div>
          <div style="flex:1;min-width:0;padding-top:2px">
            <div id="fwpm-name" style="font-family:'Bebas Neue',Oswald,sans-serif;font-size:22px;font-weight:700;letter-spacing:.02em;color:${_wr.text};line-height:1.1;margin-bottom:4px"></div>
            <!-- Insight blurb -->
            <div id="fwpm-insight" style="margin-bottom:6px"></div>
            <div id="fwpm-bio" style="font-size:13px;color:${_wr.text2};margin-bottom:6px"></div>
            <div id="fwpm-tags" style="display:flex;gap:6px;flex-wrap:wrap"></div>
          </div>
        </div>
      </div>
      <!-- Stats bar -->
      <div id="fwpm-stats" style="display:grid;grid-template-columns:repeat(5,1fr);border-bottom:1px solid ${_wr.borderDim}"></div>
      <!-- Body -->
      <div style="padding:16px 20px">
        <!-- Age curve -->
        <div class="fwpm-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
            <div class="fwpm-section-title" style="margin-bottom:0">Age Curve</div>
            <div id="fwpm-peak-tag" style="font-size:13px;color:${_wr.text2}"></div>
          </div>
          <div id="fwpm-curve" style="display:flex;height:22px;border-radius:5px;overflow:hidden;gap:1px"></div>
          <div id="fwpm-curve-lbl" style="display:flex;justify-content:space-between;font-size:13px;color:${_wr.text3};margin-top:3px"></div>
        </div>
        <!-- Value + Trade Profile -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
          <div class="fwpm-card-box">
            <div style="font-size:13px;color:${_wr.text3};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Dynasty Trade Value</div>
            <div id="fwpm-val" style="font-size:24px;font-weight:800;letter-spacing:-.02em;color:${_wr.gold};font-family:'Bebas Neue',Oswald,monospace"></div>
            <div id="fwpm-tier" style="font-size:13px;color:${_wr.text2};margin-top:2px"></div>
          </div>
          <div id="fwpm-right" class="fwpm-card-box"></div>
        </div>
        <!-- Career Stats -->
        <div class="fwpm-section">
          <div class="fwpm-section-title" id="fwpm-stats-title">Career Stats</div>
          <div id="fwpm-career" style="background:${_wr.panel};border:1px solid ${_wr.border};border-radius:8px;padding:10px 12px;overflow-x:auto"></div>
        </div>
        <!-- Actions -->
        <div id="fwpm-actions" style="display:flex;gap:8px;flex-wrap:wrap"></div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(div.firstElementChild);
  document.getElementById('fw-player-modal').addEventListener('click', e => {
    if (e.target.id === 'fw-player-modal') closeFWPlayerModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeFWPlayerModal();
  });
}

// ── Fetch career stats from Sleeper ────────────────────────────
async function _fwFetchCareerStats(pid, currentYear, yrsExp) {
  if (_fwCareerCache[pid]) return _fwCareerCache[pid];
  const maxYears = Math.min(yrsExp + 1, 8); // up to 8 years back
  const startYear = Math.max(currentYear - maxYears + 1, 2018); // Sleeper data starts ~2018
  const years = [];
  for (let y = currentYear; y >= startYear; y--) years.push(y);

  const results = {};
  const SLEEPER_BASE = 'https://api.sleeper.app/v1';

  await Promise.all(years.map(async yr => {
    const cacheKey = `fw_stats_${yr}`;
    let allStats;
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        const d = JSON.parse(cached);
        if (Date.now() - d.ts < 7200000) { allStats = d.data; }
      }
    } catch(e) {}
    if (!allStats) {
      try {
        const resp = await fetch(`${SLEEPER_BASE}/stats/nfl/regular/${yr}`);
        if (resp.ok) {
          allStats = await resp.json();
          try { sessionStorage.setItem(cacheKey, JSON.stringify({ data: allStats, ts: Date.now() })); } catch(e) {}
        }
      } catch(e) {}
    }
    if (allStats && allStats[pid]) {
      results[yr] = allStats[pid];
    }
  }));

  _fwCareerCache[pid] = results;
  return results;
}

// ── Build career stats table ──────────────────────────────────
function _fwBuildCareerTable(pid, careerData, pos, sc, playerObj) {
  const isIDP = ['DL','LB','DB'].includes(pos);
  const isQB = pos === 'QB';
  const isRB = pos === 'RB';
  const isK = pos === 'K';

  let cols = [];
  if (isQB) cols = [{k:'gp',l:'GP'},{k:'pass_cmp',l:'CMP'},{k:'pass_att',l:'ATT'},{k:'pass_yd',l:'YDS'},{k:'pass_td',l:'TD'},{k:'pass_int',l:'INT'},{k:'rush_yd',l:'RUSH'},{k:'fpts',l:'FPTS'}];
  else if (isRB) cols = [{k:'gp',l:'GP'},{k:'rush_att',l:'ATT'},{k:'rush_yd',l:'YDS'},{k:'rush_td',l:'TD'},{k:'rec',l:'REC'},{k:'rec_yd',l:'REC YD'},{k:'rec_tgt',l:'TGT'},{k:'fpts',l:'FPTS'}];
  else if (['WR','TE'].includes(pos)) cols = [{k:'gp',l:'GP'},{k:'rec_tgt',l:'TGT'},{k:'rec',l:'REC'},{k:'rec_yd',l:'YDS'},{k:'rec_td',l:'TD'},{k:'rush_yd',l:'RUSH'},{k:'fpts',l:'FPTS'}];
  else if (isK) cols = [{k:'gp',l:'GP'},{k:'fgm',l:'FGM'},{k:'fga',l:'FGA'},{k:'fgm_50p',l:'50+'},{k:'xpm',l:'XPM'},{k:'xpa',l:'XPA'},{k:'fpts',l:'FPTS'}];
  else if (isIDP) cols = [{k:'gp',l:'GP'},{k:'idp_tkl',l:'TKL'},{k:'idp_sack',l:'SACK'},{k:'idp_int',l:'INT'},{k:'idp_pass_def',l:'PD'},{k:'idp_qb_hit',l:'QBH'},{k:'idp_ff',l:'FF'},{k:'fpts',l:'FPTS'}];
  else cols = [{k:'gp',l:'GP'},{k:'fpts',l:'FPTS'}];

  const gridCols = `38px 30px ${cols.map(() => '1fr').join(' ')}`;

  const years = Object.keys(careerData).sort((a,b) => b-a);
  if (!years.length) return `<div style="color:${_wr.text3};font-size:13px;padding:4px 0">No career stats available.</div>`;

  const parseRow = (raw, yr) => {
    if (!raw) return null;
    const g = (...keys) => { for (const k of keys) { if (raw[k] != null && raw[k] !== 0) return raw[k]; } return 0; };
    const gp = g('gp','games_played') || 0;
    if (gp === 0 && !g('pass_yd') && !g('rush_yd') && !g('rec_yd') && !g('idp_tkl_solo')) return null;
    const fpts = _fwCalcPts(raw, sc);
    return {
      yr, gp, fpts: +fpts.toFixed(1),
      pass_cmp: g('pass_cmp'), pass_att: g('pass_att'), pass_yd: g('pass_yd'), pass_td: g('pass_td'), pass_int: g('pass_int'),
      rush_att: g('rush_att'), rush_yd: g('rush_yd'), rush_td: g('rush_td'),
      rec: g('rec'), rec_yd: g('rec_yd'), rec_td: g('rec_td'), rec_tgt: g('rec_tgt','targets','tgt'),
      idp_tkl: g('idp_tkl_solo','tkl_solo') + g('idp_tkl_ast','tkl_ast'),
      idp_sack: g('idp_sack','sack'), idp_int: g('idp_int','def_int','int'),
      idp_pass_def: g('idp_pass_def','def_pass_def','pass_defended'),
      idp_qb_hit: g('idp_qb_hit','qb_hit'), idp_ff: g('idp_ff','ff','fumble_forced'),
      fgm: g('fgm','fg_made'), fga: g('fga','fg_att'), fgm_50p: g('fgm_50p','fgm_50_plus','fg_made_50_plus'),
      xpm: g('xpm','xp_made'), xpa: g('xpa','xp_att'),
      // Extra efficiency metrics
      _raw: raw,
    };
  };

  const rows = years.map(yr => parseRow(careerData[yr], yr)).filter(Boolean);
  if (!rows.length) return `<div style="color:${_wr.text3};font-size:13px;padding:4px 0">No career stats available.</div>`;

  const fmt = (v, k) => {
    if (v == null || (v === 0 && k !== 'pass_int')) return `<span style="color:${_wr.text3}">\u2014</span>`;
    if (k === 'fpts') return `<span style="color:${_wr.gold};font-weight:700">${v}</span>`;
    if (['pass_yd','rush_yd','rec_yd'].includes(k)) return `<strong>${Math.round(v).toLocaleString()}</strong>`;
    if (['idp_sack','idp_int','idp_ff','idp_qb_hit'].includes(k) && v >= 5) return `<span style="color:${_wr.green};font-weight:600">${Number.isInteger(v)?v:v.toFixed(1)}</span>`;
    if (k === 'idp_tkl' && v >= 80) return `<span style="color:${_wr.green};font-weight:600">${Math.round(v)}</span>`;
    return Number.isInteger(v) ? v : v.toFixed(1);
  };

  // Career totals row
  let totalsRow = '';
  if (rows.length >= 2) {
    const totals = { yr: 'TOT', gp: 0, fpts: 0 };
    cols.forEach(c => { if (c.k !== 'gp' && c.k !== 'fpts') totals[c.k] = 0; });
    rows.forEach(r => {
      totals.gp += r.gp || 0;
      totals.fpts += r.fpts || 0;
      cols.forEach(c => { if (c.k !== 'gp' && c.k !== 'fpts') totals[c.k] = (totals[c.k]||0) + (r[c.k]||0); });
    });
    totals.fpts = +totals.fpts.toFixed(1);
    totalsRow = `
      <div class="fwpm-career-row" style="grid-template-columns:${gridCols};border-top:2px solid ${_wr.border};padding-top:6px;font-weight:700">
        <div style="font-size:13px;font-weight:800;color:${_wr.gold}">TOT</div>
        <div></div>
        ${cols.map(c => `<div style="text-align:right;color:${_wr.text}">${fmt(totals[c.k], c.k)}</div>`).join('')}
      </div>`;
  }

  return `
    <div class="fwpm-career-row" style="grid-template-columns:${gridCols};padding-bottom:5px;border-bottom:2px solid ${_wr.border};margin-bottom:2px">
      <div class="fwpm-career-hdr">YR</div>
      <div class="fwpm-career-hdr">TM</div>
      ${cols.map(c => `<div class="fwpm-career-hdr" style="text-align:right">${c.l}</div>`).join('')}
    </div>
    ${rows.map(r => `
      <div class="fwpm-career-row" style="grid-template-columns:${gridCols}">
        <div style="font-weight:700;color:${_wr.text3}">${r.yr}</div>
        <div style="font-weight:700;padding:1px 3px;border-radius:3px;background:${_wr.goldBg};color:${_wr.text3};text-align:center;font-size:13px">${playerObj.team||'FA'}</div>
        ${cols.map(c => `<div style="font-weight:600;text-align:right;color:${_wr.text}">${fmt(r[c.k], c.k)}</div>`).join('')}
      </div>`).join('')}
    ${totalsRow}`;
}

// ── Main: open player modal ────────────────────────────────────
function openFWPlayerModal(playerIdOrObj, playersData, statsData, scoringSettings) {
  _ensureModalDOM();

  // Resolve player data
  let pid, p, stats;
  if (typeof playerIdOrObj === 'object') {
    p = playerIdOrObj;
    pid = p.player_id || p.id || '';
    stats = statsData?.[pid] || {};
  } else {
    pid = String(playerIdOrObj);
    const players = (window.S && window.S.players) || playersData || {};
    p = players[pid];
    if (!p) { console.warn('[FW] Player not found:', pid); return; }
    stats = (window.S && window.S.playerStats?.[pid]) || statsData?.[pid] || {};
  }

  const pos = _fwNormPos(p.position || '');
  const age = p.age || 0;
  const name = p.full_name || ((p.first_name||'') + ' ' + (p.last_name||'')).trim() || pid;
  const team = p.team || 'FA';
  const exp = p.years_exp ?? 0;
  const pk = _fwPeakYears(pos, age);
  const isIDP = ['DL','LB','DB'].includes(pos);

  const LI = window.App.LI || {};
  const LI_LOADED = window.App.LI_LOADED || false;

  // DHQ value
  const val = (typeof dynastyValue === 'function') ? dynastyValue(pid) : (LI.playerScores?.[pid] || 0);
  const tier = val >= 7000 ? 'Elite' : val >= 4000 ? 'Starter' : val >= 2000 ? 'Depth' : val > 0 ? 'Stash' : '\u2014';
  const tierCol = val >= 7000 ? _wr.green : val >= 4000 ? _wr.gold : val >= 2000 ? _wr.text2 : _wr.text3;

  // Position rank from DHQ engine
  const fcRankData = (typeof getPlayerRank === 'function') ? getPlayerRank(pid) : null;

  // Meta from DHQ
  const meta = LI.playerMeta?.[pid];
  const trend = meta?.trend || 0;
  const peakYrsLeft = meta?.peakYrsLeft || 0;

  // Scoring settings
  const sc = scoringSettings ||
    (window.S && window.S.leagues?.find(l => l.league_id === (window.S?.currentLeagueId))?.scoring_settings) || {};

  // Raw stats
  const rawStats = stats.prevRawStats || stats.curRawStats || stats;
  const gamesPlayed = stats.gp || rawStats?.gp || 0;
  let ppg = stats.prevAvg || stats.seasonAvg || 0;
  let total = stats.prevTotal || stats.seasonTotal || 0;
  if (!ppg && gamesPlayed > 0) {
    const pts = _fwCalcPts(rawStats, sc);
    if (pts) { total = Math.round(pts * 10) / 10; ppg = +(pts / gamesPlayed).toFixed(1); }
  }

  // ── Photo ──
  const photo = document.getElementById('fwpm-photo');
  photo.src = `https://sleepercdn.com/content/nfl/players/${pid}.jpg`;
  photo.style.display = '';
  const initials = document.getElementById('fwpm-initials');
  initials.textContent = ((p.first_name||'?')[0] + (p.last_name||'?')[0]).toUpperCase();
  initials.style.display = 'none';

  // ── Position badge ──
  const posBadge = document.getElementById('fwpm-pos');
  posBadge.textContent = pos;
  posBadge.style.background = _fwPosColor[pos] || 'rgba(212,175,55,.15)';
  posBadge.style.color = _fwPosText[pos] || _wr.gold;

  // ── Name ──
  document.getElementById('fwpm-name').textContent = name;

  // ── Insight blurb ──
  const insightEl = document.getElementById('fwpm-insight');
  if (meta && val > 0) {
    const yrsPast = Math.max(0, age - pk.hi);
    const yrsExp = exp;
    let blurb = '', blurbCol = _wr.amber;

    if (meta.source === 'FC_ROOKIE') {
      blurb = `Incoming rookie with ${peakYrsLeft||'?'} peak years ahead. Value based on DHQ dynasty consensus.`;
      blurbCol = _wr.green;
    } else if (meta.sitMult <= 0.45) {
      blurb = `Not rostered by anyone in the league and no NFL team. ${yrsPast>=2?'Likely retired or out of football.':'Needs a landing spot.'}`;
      blurbCol = _wr.red;
    } else if (yrsPast >= 5) {
      const extra = gamesPlayed <= 12 && gamesPlayed > 0 ? ` Only played ${gamesPlayed} games last year.` : '';
      const trendNote = trend <= -15 ? ` Production down ${Math.abs(trend)}%.` : '';
      blurb = `${yrsExp>8?yrsExp+'-year veteran, ':''}${yrsPast} years past ${pos} prime at age ${age}. On borrowed time \u2014 sell if anyone's buying.${extra}${trendNote}`;
      blurbCol = _wr.red;
    } else if (yrsPast >= 2) {
      const trendNote = trend <= -20 ? ` PPG dropped ${Math.abs(trend)}% last season.` : trend >= 15 ? ` Still trending up ${trend}% \u2014 defying age.` : '';
      const gpNote = gamesPlayed <= 12 && gamesPlayed > 0 ? ` Durability concern \u2014 only ${gamesPlayed} games.` : '';
      blurb = `${yrsPast} years past ${pos} peak at age ${age}. ${meta.starterSeasons>=4?'Proven producer but ':''}Dynasty value declining.${trendNote}${gpNote}`;
      blurbCol = _wr.red;
    } else if (yrsPast === 1) {
      const trendNote = trend <= -20 ? ` PPG fell ${Math.abs(trend)}% \u2014 the decline may be starting.` : trend >= 15 ? ` Still improving (+${trend}%) \u2014 could have more in the tank.` : ' Watch closely this season.';
      blurb = `Just exited ${pos} peak window at age ${age}.${trendNote}`;
      blurbCol = _wr.amber;
    } else if (age <= pk.lo && peakYrsLeft >= 5) {
      const prodNote = meta.starterSeasons >= 2 ? ` Already a ${meta.starterSeasons}-year starter at just ${age} \u2014 rare.` : meta.starterSeasons === 1 ? ' Showed starter-level production in year one.' : ' Still developing.';
      const trendNote = trend >= 20 ? ` PPG up ${trend}% \u2014 breakout trajectory.` : '';
      blurb = `${peakYrsLeft} peak years ahead at age ${age}.${prodNote}${trendNote} Dynasty stock rising.`;
      blurbCol = _wr.green;
    } else if (peakYrsLeft >= 3) {
      const eliteNote = meta.sitMult >= 1.30 && age <= 25 ? ' Elite young producer \u2014 exactly what dynasty is about.' : '';
      const trendNote = trend >= 20 ? ` PPG up ${trend}% year-over-year.` : '';
      blurb = `In prime with ${peakYrsLeft} peak years left. ${meta.starterSeasons>=3?meta.starterSeasons+'-year proven starter. ':''}${eliteNote}${trendNote}`;
      blurbCol = _wr.green;
    } else if (peakYrsLeft >= 1) {
      const trendNote = trend <= -20 ? ` Production declining (${trend}%).` : '';
      blurb = `${peakYrsLeft} peak year${peakYrsLeft>1?'s':''} left at age ${age}. Window closing${meta.starterSeasons>=3?' but still a reliable starter':''}.${trendNote}`;
      blurbCol = _wr.amber;
    } else {
      blurb = `At the edge of ${pos} peak at age ${age}. Value peaks now \u2014 it only goes down from here.`;
      blurbCol = _wr.amber;
    }

    if (gamesPlayed <= 8 && gamesPlayed > 0 && !blurb.includes('games')) blurb += ` Only ${gamesPlayed} games last season.`;

    if (blurb) {
      const bg = blurbCol === _wr.red ? 'rgba(231,76,60,.08)' : blurbCol === _wr.green ? 'rgba(46,204,113,.08)' : 'rgba(212,175,55,.08)';
      insightEl.innerHTML = `<div style="font-size:11.5px;color:${blurbCol};line-height:1.45;padding:6px 10px;background:${bg};border-radius:6px;border-left:3px solid ${blurbCol}">${blurb}</div>`;
    } else insightEl.innerHTML = '';
  } else insightEl.innerHTML = '';

  // ── Bio ──
  const teamFull = (typeof fullTeam === 'function') ? fullTeam(team) : team;
  document.getElementById('fwpm-bio').innerHTML = `${pos} \u00B7 ${teamFull} \u00B7 Age ${age || '?'} \u00B7 ${exp}yr exp${p.college ? ' \u00B7 '+p.college : ''}`;

  // ── Tags ──
  const tags = [];
  if (p.injury_status) tags.push(`<span style="background:rgba(231,76,60,.1);color:${_wr.red};font-size:13px;font-weight:700;padding:2px 8px;border-radius:20px">${p.injury_status}</span>`);
  if (fcRankData && fcRankData.pos) tags.push(`<span style="background:rgba(212,175,55,.1);color:${_wr.gold};font-size:13px;font-weight:700;padding:2px 8px;border-radius:20px">#${fcRankData.pos} ${pos}</span>`);
  // League position rank
  const S = window.App.S || window.S || {};
  if (S.rosters) {
    const myRoster = S.rosters?.find(r => r.owner_id === S.myUserId || (r.co_owners||[]).includes(S.myUserId));
    const posRank = _fwLeaguePosRank(pid, pos, S);
    if (posRank) tags.push(`<span style="background:rgba(46,204,113,.1);color:${_wr.green};font-size:13px;font-weight:700;padding:2px 8px;border-radius:20px">${pos}${posRank} in league</span>`);
  }
  if (p.height || p.weight) {
    const ht = p.height ? Math.floor(p.height/12)+"'"+(p.height%12)+'"' : '';
    const wt = p.weight ? p.weight+'lbs' : '';
    tags.push(`<span style="background:rgba(255,255,255,.04);color:${_wr.text3};font-size:13px;padding:2px 8px;border-radius:20px">${[ht,wt].filter(Boolean).join(' \u00B7 ')}</span>`);
  }
  document.getElementById('fwpm-tags').innerHTML = tags.join('');

  // ── Stats bar ──
  const curYear = parseInt(S.season) || new Date().getFullYear();
  const prevYr = String(curYear - 1).slice(2);
  const trendLabel = trend > 100 ? 'Rising' : trend < -100 ? 'Falling' : 'Stable';
  const trendCol = trend > 100 ? _wr.green : trend < -100 ? _wr.red : _wr.text3;

  let statBoxes;
  if (isIDP && rawStats) {
    const idpPts = _fwCalcPts(rawStats, sc);
    const gp = rawStats.gp || 17;
    const idpPPG = +(idpPts / Math.max(1, gp)).toFixed(1);
    const tkl = Math.round((rawStats.idp_tkl_solo||0) + (rawStats.idp_tkl_ast||0));
    const sacks = +(rawStats.idp_sack||0).toFixed(1);
    const ints = rawStats.idp_int || 0;
    const pds = rawStats.idp_pass_def || 0;
    statBoxes = [
      {val: val > 0 ? val.toLocaleString() : '\u2014', lbl: 'DHQ Value', col: tierCol},
      {val: fcRankData ? '#'+fcRankData.pos : '\u2014', lbl: 'Pos Rank', col: _wr.gold},
      {val: idpPPG || '\u2014', lbl: 'IDP PPG', col: idpPPG >= 6 ? _wr.green : idpPPG >= 3 ? _wr.text : _wr.text3},
      {val: tkl || '\u2014', lbl: 'Tackles', col: tkl >= 80 ? _wr.green : tkl >= 40 ? _wr.text : _wr.text3},
      {val: pos === 'DB' ? (ints+'/'+pds) : String(sacks), lbl: pos === 'DB' ? 'INT/PD' : 'Sacks', col: _wr.text},
    ];
  } else {
    statBoxes = [
      {val: val > 0 ? val.toLocaleString() : '\u2014', lbl: 'DHQ Value', col: tierCol},
      {val: fcRankData ? '#'+fcRankData.pos : '\u2014', lbl: 'Pos Rank', col: _wr.gold},
      {val: ppg ? ppg.toFixed(1) : '\u2014', lbl: `'${prevYr} PPG`, col: ppg > 15 ? _wr.green : ppg > 8 ? _wr.text : _wr.text3},
      {val: total ? Math.round(total) : '\u2014', lbl: `'${prevYr} Total`, col: _wr.text2},
      {val: trendLabel, lbl: '30d Trend', col: trendCol},
    ];
  }

  document.getElementById('fwpm-stats').innerHTML = statBoxes.map(s =>
    `<div class="fwpm-stat-box">
      <div class="fwpm-stat-val" style="color:${s.col}">${s.val}</div>
      <div class="fwpm-stat-lbl">${s.lbl}</div>
    </div>`
  ).join('');

  // ── Age curve ──
  const ages = Array.from({length: 17}, (_, i) => i + 20);
  document.getElementById('fwpm-curve').innerHTML = ages.map(a => {
    const col = a < pk.lo-3 ? 'rgba(96,165,250,.3)' : a < pk.lo ? 'rgba(46,204,113,.45)' :
      (a >= pk.lo && a <= pk.hi) ? 'rgba(46,204,113,.75)' : a <= pk.hi+2 ? 'rgba(212,175,55,.45)' : 'rgba(231,76,60,.35)';
    return `<div style="flex:1;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;cursor:default;background:${col};opacity:${a===age?1:0.55};outline:${a===age?'2px solid '+_wr.gold:'none'};outline-offset:-1px;color:${a===age?_wr.text:'transparent'}">${a===age?age:''}</div>`;
  }).join('');
  document.getElementById('fwpm-peak-tag').textContent = `Currently age ${age || '?'} \u00B7 ${pk.label} \u00B7 ${pk.desc}`;
  document.getElementById('fwpm-curve-lbl').innerHTML = `<span>20</span><span>Peak ${pk.lo}\u2013${pk.hi}</span><span>36</span>`;

  // ── Trade value ──
  document.getElementById('fwpm-val').textContent = val > 0 ? val.toLocaleString() : LI_LOADED ? '\u2014' : 'Loading...';
  document.getElementById('fwpm-tier').innerHTML = val > 0
    ? `<span style="color:${tierCol}">${tier}</span>${fcRankData ? ' \u00B7 Overall #'+fcRankData.overall : ''}`
    : LI_LOADED ? `<span style="color:${_wr.text3}">No DHQ data</span>` : `<span style="color:${_wr.text3}">DHQ loading...</span>`;

  // ── Right panel: Trade Profile (offense) or IDP stats ──
  const rightPanel = document.getElementById('fwpm-right');
  if (isIDP && rawStats) {
    const gp = rawStats.gp || 17;
    const idpPts2 = _fwCalcPts(rawStats, sc);
    const idpPPG2 = +(idpPts2 / Math.max(1, gp)).toFixed(1);
    const tkl = Math.round((rawStats.idp_tkl_solo||0) + (rawStats.idp_tkl_ast||0));
    const sacks = +(rawStats.idp_sack||0).toFixed(1);
    const ints = rawStats.idp_int || 0;
    const pds = rawStats.idp_pass_def || 0;
    const ff = rawStats.idp_ff || 0;
    const qbhits = rawStats.idp_qb_hit || 0;
    const tklLoss = rawStats.idp_tkl_loss || 0;
    rightPanel.innerHTML = `
      <div style="font-size:13px;color:${_wr.text3};text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">IDP Stats <span style="font-weight:400;text-transform:none">\u00B7 ${gp}gp</span></div>
      <div style="font-size:20px;font-weight:800;color:${_wr.green};margin-bottom:6px;font-family:'Bebas Neue',Oswald,monospace">${idpPPG2||'\u2014'} <span style="font-size:13px;font-weight:600;color:${_wr.text2}">PPG</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px">
        ${tkl?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${tkl}</strong> tackles</div>`:''}
        ${sacks?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${sacks}</strong> sacks</div>`:''}
        ${ints?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${ints}</strong> INT</div>`:''}
        ${pds?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${pds}</strong> PD</div>`:''}
        ${ff?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${ff}</strong> FF</div>`:''}
        ${qbhits?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${qbhits}</strong> QB hits</div>`:''}
        ${tklLoss?`<div style="font-size:13px;color:${_wr.text2}"><strong style="color:${_wr.text}">${tklLoss}</strong> TFL</div>`:''}
      </div>`;
  } else {
    // Trade Profile: BUY / HOLD / SELL
    const rec = peakYrsLeft <= 0 ? 'SELL' : peakYrsLeft <= 2 ? (trend >= 10 ? 'HOLD' : 'SELL') : (val >= 7000 ? 'HOLD' : 'BUY');
    const recCol = rec === 'BUY' ? _wr.green : rec === 'HOLD' ? _wr.gold : _wr.red;
    const tpTrend = trend >= 15 ? '+'+trend+'%' : trend <= -15 ? trend+'%' : 'Stable';
    const tpTrendCol = trend >= 15 ? _wr.green : trend <= -15 ? _wr.red : _wr.text3;

    rightPanel.innerHTML = `
      <div style="font-size:13px;color:${_wr.text3};text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">Trade Profile</div>
      <div style="font-size:22px;font-weight:800;color:${recCol};font-family:'Bebas Neue',Oswald,monospace;letter-spacing:.02em">${rec}</div>
      <div style="font-size:13px;color:${_wr.text2};margin-top:4px;line-height:1.4">
        <span style="color:${tpTrendCol}">${tpTrend}</span> \u00B7 ${peakYrsLeft > 0 ? peakYrsLeft+' peak yr'+(peakYrsLeft>1?'s':'')+' left' : 'Past peak'}
      </div>`;
  }

  // ── Career stats ──
  const careerEl = document.getElementById('fwpm-career');
  const titleEl = document.getElementById('fwpm-stats-title');

  // Show current-year stats immediately if available, then fetch career
  if (rawStats && Object.keys(rawStats).length > 1) {
    const quickData = {};
    quickData[curYear] = rawStats;
    if (stats.prevRawStats) quickData[curYear - 1] = stats.prevRawStats;
    titleEl.textContent = 'Career Stats';
    careerEl.innerHTML = _fwBuildCareerTable(pid, quickData, pos, sc, p);
  } else {
    careerEl.innerHTML = `<div style="color:${_wr.text3};font-size:13px;padding:4px 0">Loading career stats...</div>`;
  }

  // Fetch full career in background
  _fwFetchCareerStats(pid, curYear, exp).then(careerData => {
    if (Object.keys(careerData).length) {
      const yrs = Object.keys(careerData).sort();
      titleEl.textContent = yrs.length > 1
        ? `Career Stats \u00B7 '${String(yrs[0]).slice(-2)}\u2013'${String(yrs[yrs.length-1]).slice(-2)}`
        : `'${String(yrs[0]).slice(-2)} Season Stats`;
      careerEl.innerHTML = _fwBuildCareerTable(pid, careerData, pos, sc, p);
    }
  }).catch(() => {});

  // ── Actions ──
  const actionsEl = document.getElementById('fwpm-actions');
  actionsEl.innerHTML = `
    <a href="${_fwFPUrl(name)}" target="_blank" class="fwpm-btn">FantasyPros</a>
    <a href="https://sleeper.com/players/nfl/${pid}" target="_blank" class="fwpm-btn">Sleeper</a>`;

  // ── Show ──
  document.getElementById('fw-player-modal').style.display = 'flex';
}

// ── Helper: league position rank ────────────────────────────────
function _fwLeaguePosRank(pid, pos, S) {
  if (!S.rosters || !window.App.LI?.playerScores) return null;
  const scores = window.App.LI.playerScores;
  const meta = window.App.LI.playerMeta || {};
  const allRostered = [];
  S.rosters.forEach(r => (r.players || []).forEach(p => {
    if (meta[p]?.pos === pos && scores[p] > 0) allRostered.push({ pid: p, val: scores[p] });
  }));
  allRostered.sort((a, b) => b.val - a.val);
  const idx = allRostered.findIndex(x => x.pid === String(pid));
  return idx >= 0 ? idx + 1 : null;
}

// ── Close ──────────────────────────────────────────────────────
function closeFWPlayerModal() {
  const el = document.getElementById('fw-player-modal');
  if (el) el.style.display = 'none';
}

// ── Expose globally ────────────────────────────────────────────
window.openFWPlayerModal = openFWPlayerModal;
window.closeFWPlayerModal = closeFWPlayerModal;
window.App.openFWPlayerModal = openFWPlayerModal;
window.App.closeFWPlayerModal = closeFWPlayerModal;

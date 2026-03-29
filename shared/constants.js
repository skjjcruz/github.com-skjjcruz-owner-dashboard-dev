// ══════════════════════════════════════════════════════════════════
// shared/constants.js — Fantasy Wars shared constants
// ══════════════════════════════════════════════════════════════════

window.App = window.App || {};

window.App.posMap={QB:'QB',RB:'RB',WR:'WR',TE:'TE',FLEX:'FLEX',SUPER_FLEX:'SF',K:'K',DEF:'DEF',BN:'BN',IDP_FLEX:'IDP',DL:'DL',LB:'LB',DB:'DB',REC_FLEX:'FLEX',WR_RB_FLEX:'FLEX',WR_TE:'FLEX'};

window.App.posClass=s=>{const p=window.App.posMap[s]||s||'FLEX';return{QB:'pQB',RB:'pRB',WR:'pWR',TE:'pTE',K:'pK',DEF:'pDEF',FLEX:'pFLEX',SF:'pSF',BN:'pBN',DL:'pDL',LB:'pLB',DB:'pDB',IDP:'pIDP'}[p]||'pFLEX'};

// Expose as bare globals for modules that reference them without namespace
window.posMap = window.App.posMap;
window.posClass = window.App.posClass;

window.App.NFL_TEAMS={
  ARI:'Arizona Cardinals',ATL:'Atlanta Falcons',BAL:'Baltimore Ravens',BUF:'Buffalo Bills',
  CAR:'Carolina Panthers',CHI:'Chicago Bears',CIN:'Cincinnati Bengals',CLE:'Cleveland Browns',
  DAL:'Dallas Cowboys',DEN:'Denver Broncos',DET:'Detroit Lions',GB:'Green Bay Packers',
  HOU:'Houston Texans',IND:'Indianapolis Colts',JAX:'Jacksonville Jaguars',KC:'Kansas City Chiefs',
  LAC:'Los Angeles Chargers',LAR:'Los Angeles Rams',LV:'Las Vegas Raiders',MIA:'Miami Dolphins',
  MIN:'Minnesota Vikings',NE:'New England Patriots',NO:'New Orleans Saints',NYG:'New York Giants',
  NYJ:'New York Jets',PHI:'Philadelphia Eagles',PIT:'Pittsburgh Steelers',SEA:'Seattle Seahawks',
  SF:'San Francisco 49ers',TB:'Tampa Bay Buccaneers',TEN:'Tennessee Titans',WAS:'Washington Commanders',
  FA:'Free Agent'
};

window.App.fullTeam=abbr=>window.App.NFL_TEAMS[abbr]||abbr||'FA';
window.NFL_TEAMS = window.App.NFL_TEAMS;
window.fullTeam = window.App.fullTeam;

// AI-sourced peak age curves — loaded async, with research-backed defaults
window.App.PEAK_CURVES={
  QB:{lo:27,hi:32,src:'default'},RB:{lo:22,hi:26,src:'default'},
  WR:{lo:24,hi:29,src:'default'},TE:{lo:25,hi:30,src:'default'},
  EDGE:{lo:24,hi:29,src:'default'},DT:{lo:24,hi:29,src:'default'},
  LB:{lo:23,hi:28,src:'default'},CB:{lo:24,hi:29,src:'default'},
  S:{lo:25,hi:30,src:'default'},K:{lo:26,hi:36,src:'default'},
};

// ── Age curves: position-specific peak windows (DHQ engine) ──
window.App.peakWindows={QB:[24,34],RB:[22,27],WR:[22,30],TE:[23,30],DL:[23,29],LB:[23,28],DB:[23,29]};

// ── Position-specific decay rates (per year past peak end) ──
window.App.decayRates={QB:0.06,RB:0.25,WR:0.14,TE:0.12,DL:0.15,LB:0.15,DB:0.14};

// ── Draft pick values ──────────────────────────────────────────
// Standard dynasty pick values (approximate DLF/KTC scale)
window.App.BASE_PICK_VALUES={
  '1.01':10050,'1.02':9150,'1.03':8350,'1.04':7600,'1.05':6900,
  '1.06':6250,'1.07':5700,'1.08':5250,'1.09':4800,'1.10':4450,
  '1.11':4150,'1.12':3800,
  '2.01':4650,'2.02':4350,'2.03':4050,'2.04':3750,'2.05':3450,
  '2.06':3150,'2.07':2950,'2.08':2700,'2.09':2500,'2.10':2250,
  '2.11':2100,'2.12':1950,
  '3.01':2650,'3.02':2400,'3.03':2200,'3.04':2000,'3.05':1800,
  '3.06':1650,'3.07':1500,'3.08':1350,'3.09':1250,'3.10':1100,
  '3.11':1000,'3.12':925,
  '4.01':1300,'4.02':1200,'4.03':1100,'4.04':1000,'4.05':925,
  '4.06':850,'4.07':775,'4.08':725,'4.09':675,'4.10':600,
  '4.11':550,'4.12':500,
  '5.01':700,'5.02':650,'5.03':600,'5.04':550,'5.05':500,
  '5.06':450,'5.07':400,'5.08':350,'5.09':325,'5.10':300,
  '5.11':275,'5.12':250,
};

// ── Player Value — DHQ Primary ───────────────────────────────
window.App.tradeValueTier=function(val){
  if(val>=7000)return{tier:'Elite',col:'var(--green)'};
  if(val>=4000)return{tier:'Starter',col:'var(--accent)'};
  if(val>=2000)return{tier:'Depth',col:'var(--text2)'};
  if(val>0)return{tier:'Stash',col:'var(--text3)'};
  return{tier:'—',col:'var(--text3)'};
};
window.tradeValueTier = window.App.tradeValueTier;

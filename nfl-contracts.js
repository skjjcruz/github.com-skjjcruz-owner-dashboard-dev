// ══════════════════════════════════════════════════════════════════
// nfl-contracts.js — NFL Contract Data (2025-2026 offseason snapshot)
// Source: Spotrac / OverTheCap public data, manually curated.
// Usage: window.NFL_CONTRACTS[sleeper_player_id] = { aav, yrsLeft, total, guaranteed }
// Update each offseason or after major signings.
// ══════════════════════════════════════════════════════════════════

window.NFL_CONTRACTS = {
  // ── QB ──────────────────────────────────────────────────────────
  "4046":  { aav: 55.0, yrsLeft: 7, total: 503.0, guaranteed: 200.0 },  // Dak Prescott
  "6770":  { aav: 55.0, yrsLeft: 8, total: 275.0, guaranteed: 141.0 },  // Joe Burrow
  "6904":  { aav: 53.0, yrsLeft: 3, total: 160.0, guaranteed: 100.0 },  // Tua Tagovailoa
  "4881":  { aav: 52.0, yrsLeft: 7, total: 364.0, guaranteed: 200.0 },  // Lamar Jackson
  "6801":  { aav: 51.0, yrsLeft: 3, total: 153.0, guaranteed: 110.0 },  // Jordan Love
  "6797":  { aav: 50.0, yrsLeft: 3, total: 150.0, guaranteed: 100.0 },  // Jalen Hurts
  "4017":  { aav: 45.0, yrsLeft: 7, total: 450.0, guaranteed: 141.5 },  // Patrick Mahomes
  "3321":  { aav: 46.0, yrsLeft: 2, total: 92.0, guaranteed: 72.0 },    // Josh Allen
  "7553":  { aav: 40.0, yrsLeft: 3, total: 120.0, guaranteed: 92.0 },   // Trevor Lawrence
  "7523":  { aav: 37.0, yrsLeft: 3, total: 110.0, guaranteed: 76.0 },   // Justin Herbert
  "6083":  { aav: 35.0, yrsLeft: 2, total: 70.0, guaranteed: 50.0 },    // Kyler Murray
  "7588":  { aav: 34.0, yrsLeft: 4, total: 137.0, guaranteed: 100.0 },  // Jayden Daniels
  "4984":  { aav: 32.0, yrsLeft: 2, total: 64.0, guaranteed: 48.0 },    // Daniel Jones
  "11560": { aav: 30.0, yrsLeft: 3, total: 89.0, guaranteed: 67.0 },    // Caleb Williams
  "8183":  { aav: 12.0, yrsLeft: 4, total: 47.0, guaranteed: 30.0 },    // Drake Maye
  "8154":  { aav: 9.0,  yrsLeft: 3, total: 27.0, guaranteed: 20.0 },    // Bo Nix
  "4018":  { aav: 25.0, yrsLeft: 1, total: 25.0, guaranteed: 0 },       // Deshaun Watson
  "4029":  { aav: 40.0, yrsLeft: 1, total: 40.0, guaranteed: 0 },       // Jared Goff
  "96":    { aav: 0, yrsLeft: 0, total: 0, guaranteed: 0 },             // Aaron Rodgers (FA/Retired)
  "5122":  { aav: 8.0,  yrsLeft: 2, total: 16.0, guaranteed: 8.0 },     // Baker Mayfield
  "7591":  { aav: 5.0,  yrsLeft: 3, total: 14.5, guaranteed: 9.0 },     // Michael Penix Jr
  "8155":  { aav: 8.0,  yrsLeft: 3, total: 24.0, guaranteed: 15.0 },    // JJ McCarthy

  // ── RB ──────────────────────────────────────────────────────────
  "8150":  { aav: 9.0,  yrsLeft: 3, total: 27.0, guaranteed: 18.0 },    // Bijan Robinson
  "6813":  { aav: 8.0,  yrsLeft: 3, total: 24.0, guaranteed: 14.0 },    // Jonathan Taylor
  "7569":  { aav: 5.5,  yrsLeft: 2, total: 11.0, guaranteed: 6.0 },     // Breece Hall
  "8167":  { aav: 6.5,  yrsLeft: 3, total: 19.5, guaranteed: 10.0 },    // Jahmyr Gibbs
  "6806":  { aav: 7.0,  yrsLeft: 2, total: 14.0, guaranteed: 8.0 },     // Travis Etienne
  "4866":  { aav: 12.0, yrsLeft: 1, total: 12.0, guaranteed: 0 },       // Josh Jacobs
  "5849":  { aav: 8.0,  yrsLeft: 1, total: 8.0, guaranteed: 0 },        // Kenneth Walker
  "4981":  { aav: 10.0, yrsLeft: 3, total: 30.0, guaranteed: 15.0 },    // Saquon Barkley
  "4199":  { aav: 5.0,  yrsLeft: 1, total: 5.0, guaranteed: 0 },        // Derrick Henry
  "6790":  { aav: 7.5,  yrsLeft: 2, total: 15.0, guaranteed: 8.0 },     // De'Von Achane
  "7543":  { aav: 5.0,  yrsLeft: 2, total: 10.0, guaranteed: 5.5 },     // Devon Achane
  "5012":  { aav: 5.0,  yrsLeft: 2, total: 10.0, guaranteed: 4.0 },     // James Cook

  // ── WR ──────────────────────────────────────────────────────────
  "7547":  { aav: 35.0, yrsLeft: 4, total: 140.0, guaranteed: 100.0 },  // Ja'Marr Chase
  "6794":  { aav: 28.0, yrsLeft: 3, total: 84.0, guaranteed: 60.0 },    // Justin Jefferson
  "6786":  { aav: 30.0, yrsLeft: 4, total: 120.0, guaranteed: 84.0 },   // CeeDee Lamb
  "7564":  { aav: 28.0, yrsLeft: 3, total: 84.0, guaranteed: 60.0 },    // Amon-Ra St. Brown
  "5859":  { aav: 20.0, yrsLeft: 3, total: 60.0, guaranteed: 35.0 },    // Chris Olave
  "5857":  { aav: 22.0, yrsLeft: 3, total: 66.0, guaranteed: 40.0 },    // Garrett Wilson
  "5872":  { aav: 18.0, yrsLeft: 2, total: 36.0, guaranteed: 20.0 },    // Drake London
  "7585":  { aav: 9.0,  yrsLeft: 3, total: 26.0, guaranteed: 15.0 },    // Malik Nabers
  "7561":  { aav: 9.0,  yrsLeft: 3, total: 26.0, guaranteed: 15.0 },    // Marvin Harrison Jr
  "5848":  { aav: 25.0, yrsLeft: 3, total: 75.0, guaranteed: 48.0 },    // Jaylen Waddle
  "4039":  { aav: 30.0, yrsLeft: 1, total: 30.0, guaranteed: 0 },       // Tyreek Hill
  "4993":  { aav: 25.0, yrsLeft: 1, total: 25.0, guaranteed: 0 },       // DK Metcalf
  "4950":  { aav: 24.0, yrsLeft: 2, total: 48.0, guaranteed: 30.0 },    // AJ Brown
  "5850":  { aav: 17.0, yrsLeft: 2, total: 34.0, guaranteed: 18.0 },    // Jaxon Smith-Njigba
  "3164":  { aav: 24.0, yrsLeft: 1, total: 24.0, guaranteed: 0 },       // Davante Adams
  "4988":  { aav: 20.0, yrsLeft: 2, total: 40.0, guaranteed: 22.0 },    // Brandon Aiyuk
  "4034":  { aav: 20.0, yrsLeft: 1, total: 20.0, guaranteed: 0 },       // Mike Evans

  // ── TE ──────────────────────────────────────────────────────────
  "2216":  { aav: 14.0, yrsLeft: 1, total: 14.0, guaranteed: 0 },       // Travis Kelce
  "4943":  { aav: 16.0, yrsLeft: 2, total: 32.0, guaranteed: 18.0 },    // Mark Andrews
  "5001":  { aav: 14.0, yrsLeft: 3, total: 42.0, guaranteed: 22.0 },    // TJ Hockenson
  "6803":  { aav: 12.0, yrsLeft: 2, total: 24.0, guaranteed: 14.0 },    // Kyle Pitts
  "7571":  { aav: 6.0,  yrsLeft: 2, total: 12.0, guaranteed: 5.0 },     // Sam LaPorta
  "5549":  { aav: 9.0,  yrsLeft: 2, total: 18.0, guaranteed: 8.0 },     // Pat Freiermuth
  "7556":  { aav: 11.0, yrsLeft: 3, total: 33.0, guaranteed: 18.0 },    // Dalton Kincaid
  "8178":  { aav: 7.0,  yrsLeft: 3, total: 21.0, guaranteed: 12.0 },    // Brock Bowers
  "4033":  { aav: 14.0, yrsLeft: 1, total: 14.0, guaranteed: 0 },       // George Kittle
  "5133":  { aav: 9.0,  yrsLeft: 2, total: 18.0, guaranteed: 8.0 },     // Trey McBride

  // ── DL ──────────────────────────────────────────────────────────
  "3271":  { aav: 34.0, yrsLeft: 2, total: 68.0, guaranteed: 40.0 },    // Myles Garrett
  "6783":  { aav: 28.0, yrsLeft: 3, total: 84.0, guaranteed: 56.0 },    // Chase Young
  "4040":  { aav: 30.0, yrsLeft: 2, total: 60.0, guaranteed: 35.0 },    // Nick Bosa
  "5890":  { aav: 25.0, yrsLeft: 3, total: 75.0, guaranteed: 50.0 },    // Aidan Hutchinson
  "7601":  { aav: 8.0,  yrsLeft: 3, total: 24.0, guaranteed: 14.0 },    // Will Anderson Jr
  "6130":  { aav: 22.0, yrsLeft: 2, total: 44.0, guaranteed: 24.0 },    // Micah Parsons

  // ── LB ──────────────────────────────────────────────────────────
  "5870":  { aav: 18.0, yrsLeft: 3, total: 54.0, guaranteed: 32.0 },    // Devin Lloyd
  "4985":  { aav: 20.0, yrsLeft: 2, total: 40.0, guaranteed: 22.0 },    // Fred Warner
  "7596":  { aav: 6.0,  yrsLeft: 3, total: 18.0, guaranteed: 10.0 },    // Jack Campbell
  "7605":  { aav: 12.0, yrsLeft: 3, total: 36.0, guaranteed: 18.0 },    // Trenton Simpson

  // ── DB ──────────────────────────────────────────────────────────
  "5013":  { aav: 19.0, yrsLeft: 3, total: 57.0, guaranteed: 35.0 },    // Sauce Gardner
  "5895":  { aav: 18.0, yrsLeft: 2, total: 36.0, guaranteed: 20.0 },    // Derek Stingley Jr
  "4037":  { aav: 16.0, yrsLeft: 1, total: 16.0, guaranteed: 0 },       // Derwin James
  "6793":  { aav: 12.0, yrsLeft: 3, total: 36.0, guaranteed: 18.0 },    // Kyle Hamilton
};

// Helper: format salary for display
window.formatSalary = function(m) {
  if (!m || m <= 0) return '\u2014';
  return m >= 1 ? '$' + m.toFixed(0) + 'M' : '$' + (m * 1000).toFixed(0) + 'K';
};

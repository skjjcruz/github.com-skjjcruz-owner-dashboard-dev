// ══════════════════════════════════════════════════════════════════
// free-agency.js — FreeAgencyTab component
// ══════════════════════════════════════════════════════════════════
    // ══════════════════════════════════════════════════════════════════════════
    // END TRADE CALCULATOR TAB
    // ══════════════════════════════════════════════════════════════════════════

    // ══════════════════════════════════════════════════════════════════════════
    // FREE AGENCY TAB — migrated from free-agency.html
    // ══════════════════════════════════════════════════════════════════════════
    // Phase 6 deferred: FA column registry — mirrors the My Roster column contract so
    // SavedViewBar's `columns` slot round-trips correctly between surfaces.
    const FA_COLUMNS = {
        pos:        { label: 'Position',                shortLabel: 'Pos',    width: '40px', sortKey: 'pos',   group: 'core'    },
        team:       { label: 'NFL Team',                shortLabel: 'Team',   width: '44px', sortKey: 'team',  group: 'core'    },
        age:        { label: 'Age',                     shortLabel: 'Age',    width: '34px', sortKey: 'age',   group: 'dynasty' },
        dhq:        { label: 'DHQ Dynasty Value',       shortLabel: 'DHQ',    width: '58px', sortKey: 'dhq',   group: 'dynasty' },
        ppg:        { label: 'Points Per Game',         shortLabel: 'PPG',    width: '44px', sortKey: 'ppg',   group: 'stats'   },
        peakYr:     { label: 'Peak Years Left',         shortLabel: 'Peak',   width: '44px', sortKey: 'peak',  group: 'dynasty' },
        yrsExp:     { label: 'NFL Years Experience',    shortLabel: 'Exp',    width: '38px', sortKey: 'exp',   group: 'dynasty' },
        college:    { label: 'College',                 shortLabel: 'College',width: '90px', sortKey: 'college', group: 'scout' },
        height:     { label: 'Height',                  shortLabel: 'Ht',     width: '44px', sortKey: 'height',  group: 'scout' },
        weight:     { label: 'Weight (lbs)',            shortLabel: 'Wt',     width: '42px', sortKey: 'weight',  group: 'scout' },
        depthChart: { label: 'NFL Depth Chart Position',shortLabel: 'Depth',  width: '50px', group: 'scout'   },
        injury:     { label: 'Injury Status',           shortLabel: 'Inj',    width: '46px', sortKey: 'injury',  group: 'stats' },
        faab:       { label: 'Suggested FAAB Bid',      shortLabel: 'FAAB',   width: '60px', group: 'stats'   },
        fit:        { label: 'Roster Fit',              shortLabel: 'Fit',    width: '76px', group: 'stats'   },
    };
    const FA_COLUMN_PRESETS = {
        default: ['pos','team','age','dhq','ppg','faab','fit'],
        scout:   ['pos','age','college','height','weight','depthChart'],
        bidding: ['pos','team','dhq','ppg','faab','fit','injury'],
        full:    Object.keys(FA_COLUMNS),
    };

    function FreeAgencyTab({ playersData, statsData, prevStatsData, myRoster, currentLeague, sleeperUserId, timeRecomputeTs, viewMode, briefDraftInfo }) {
        const [faTargets, setFaTargets] = useState([]);
        const [faFilter, setFaFilter] = useState('');
        const [faBudget, setFaBudget] = useState({ total: 0, spent: 0 });
        const [faSort, setFaSort] = useState({ key: 'dhq', dir: -1 });
        const [faSelectedPid, setFaSelectedPid] = useState(null);
        const [faSearch, setFaSearch] = useState('');
        const [visibleFaCols, setVisibleFaCols] = useState(() => {
            const stored = window.App?.WrStorage?.get?.('wr_fa_cols');
            const valid = Array.isArray(stored) ? stored.filter(k => FA_COLUMNS[k]) : [];
            return valid.length ? valid : FA_COLUMN_PRESETS.default;
        });
        const [faColPreset, setFaColPreset] = useState('default');
        const [showFaColPicker, setShowFaColPicker] = useState(false);
        // Rolling PPG window — shared localStorage key with My Roster so the setting persists across tabs.
        const [ppgWindow, setPpgWindow] = useState(() => { try { return localStorage.getItem('wr_ppg_window') || 'season'; } catch { return 'season'; } });
        useEffect(() => { try { localStorage.setItem('wr_ppg_window', ppgWindow); } catch {} }, [ppgWindow]);
        const [, forcePpgRerender] = useState(0);
        useEffect(() => {
            const h = () => forcePpgRerender(n => n + 1);
            window.addEventListener('wr:weekly-points-loaded', h);
            return () => window.removeEventListener('wr:weekly-points-loaded', h);
        }, []);

        useEffect(() => { try { window.App?.WrStorage?.set?.('wr_fa_cols', visibleFaCols); } catch {} }, [visibleFaCols]);

        const normPos = window.App.normPos;
        const calcRawPts = (s) => window.App.calcRawPts(s, currentLeague?.scoring_settings);
        const normName = (s) => (s || '').toLowerCase().replace(/[''`.]/g, '').replace(/\s+(jr\.?|sr\.?|ii|iii|iv)$/, '').replace(/\s+/g, ' ').trim();
        const hasUpcomingRookieDraft = briefDraftInfo?.status === 'pre_draft'
            || (window.S?.drafts || []).some(d => d?.status === 'pre_draft');
        const prospectNames = useMemo(() => {
            if (!hasUpcomingRookieDraft || typeof window.getProspects !== 'function') return new Set();
            return new Set((window.getProspects() || []).map(p => normName(p.name)).filter(Boolean));
        }, [hasUpcomingRookieDraft, timeRecomputeTs]);
        const isDraftProspect = useCallback((pid, p) => {
            if (!hasUpcomingRookieDraft || !p) return false;
            const name = normName(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')).trim());
            if (prospectNames.has(name)) return true;
            const exp = Number(p.years_exp || 0);
            const hasNflStats = (statsData?.[pid]?.gp || 0) > 0 || ((prevStatsData || {})[pid]?.gp || 0) > 0;
            return exp === 0 && !!p.college && !hasNflStats;
        }, [hasUpcomingRookieDraft, prospectNames, statsData, prevStatsData]);

        // Load FA targets from Supabase/localStorage
        useEffect(() => {
            if (window.OD?.loadTargets) {
                window.OD.loadTargets(currentLeague.league_id || currentLeague.id).then(data => {
                    if (data) { setFaTargets(data.targets || []); setFaBudget({ total: data.startingBudget || 200, spent: 0 }); }
                }).catch(err => window.wrLog('fa.loadTargets', err));
            }
        }, []);

        // Find available (unrostered) players
        const rostered = useMemo(() => {
            const set = new Set();
            (currentLeague.rosters || []).forEach(r => (r.players || []).concat(r.taxi || [], r.reserve || []).forEach(pid => set.add(String(pid))));
            return set;
        }, [currentLeague]);

        const availablePlayers = useMemo(() => {
            return Object.entries(playersData)
                .filter(([pid, p]) => !rostered.has(pid) && p.team && p.status !== 'Inactive' && p.status !== 'Retired' && p.active !== false && !isDraftProspect(pid, p))
                .map(([pid, p]) => ({ pid, p, dhq: window.App?.LI?.playerScores?.[pid] || 0, pos: normPos(p.position) || p.position }))
                .sort((a, b) => b.dhq - a.dhq)
                .slice(0, 300);
        }, [playersData, rostered, timeRecomputeTs, isDraftProspect]);

        const posColors = window.App.POS_COLORS;
        const faPosOrder = { QB:0, RB:1, WR:2, TE:3, K:4, DL:5, LB:6, DB:7 };

        function faSortIndicator(key) { return faSort.key === key ? (faSort.dir === -1 ? ' \u25BC' : ' \u25B2') : ''; }
        function handleFaSort(key) { setFaSort(prev => prev.key === key ? { ...prev, dir: prev.dir * -1 } : { key, dir: -1 }); }

        // Sort filtered results
        const sortedPlayers = useMemo(() => {
            const q = faSearch.trim().toLowerCase();
            const filtered = availablePlayers.filter(x => {
                const pos = normPos(x.p.position) || x.p.position || '';
                if (faFilter && pos !== faFilter) return false;
                if (!q) return true;
                const name = (x.p.full_name || ((x.p.first_name || '') + ' ' + (x.p.last_name || '')).trim()).toLowerCase();
                const team = (x.p.team || 'FA').toLowerCase();
                const college = (x.p.college || '').toLowerCase();
                return name.includes(q) || team.includes(q) || pos.toLowerCase().includes(q) || college.includes(q);
            });
            return filtered.sort((a, b) => {
                const dir = faSort.dir;
                const k = faSort.key;
                if (k === 'name') {
                    const na = (a.p.full_name || ((a.p.first_name || '') + ' ' + (a.p.last_name || '')).trim()).toLowerCase();
                    const nb = (b.p.full_name || ((b.p.first_name || '') + ' ' + (b.p.last_name || '')).trim()).toLowerCase();
                    return dir * na.localeCompare(nb);
                }
                if (k === 'pos') return dir * ((normPos(a.p.position) || '').localeCompare(normPos(b.p.position) || ''));
                if (k === 'age') return dir * ((a.p.age || 0) - (b.p.age || 0));
                if (k === 'dhq') return dir * (a.dhq - b.dhq);
                if (k === 'ppg') {
                    const sa = statsData[a.pid] || {}; const sb = statsData[b.pid] || {};
                    const pa = sa.gp > 0 ? calcRawPts(sa) / sa.gp : 0;
                    const pb = sb.gp > 0 ? calcRawPts(sb) / sb.gp : 0;
                    return dir * (pa - pb);
                }
                if (k === 'team') return dir * ((a.p.team || '').localeCompare(b.p.team || ''));
                if (k === 'trend') {
                    const ta = window.App?.LI?.playerTrends?.[a.pid] || 0;
                    const tb = window.App?.LI?.playerTrends?.[b.pid] || 0;
                    return dir * (ta - tb);
                }
                if (k === 'peak') {
                    const pa2 = window.App?.LI?.playerPeaks?.[a.pid] || 0;
                    const pb2 = window.App?.LI?.playerPeaks?.[b.pid] || 0;
                    return dir * (pa2 - pb2);
                }
                if (k === 'exp') return dir * ((a.p.years_exp || 0) - (b.p.years_exp || 0));
                if (k === 'injury') return dir * ((a.p.injury_status || '').localeCompare(b.p.injury_status || ''));
                return 0;
            }).slice(0, 50);
        }, [availablePlayers, faFilter, faSearch, faSort, statsData]);

        const faHeaderStyle = { fontSize: '0.78rem', fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--font-body)', textTransform: 'uppercase', letterSpacing: '0.04em', cursor: 'pointer', userSelect: 'none' };

        // Compute roster needs for recommendations
        const assess = useMemo(() => typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(myRoster?.roster_id) : null, [myRoster]);
        const peaks = window.App.peakWindows || {};
        const ageCurveFor = pos => typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { build: [22, 24], peak: peaks[pos] || [24, 29], decline: [30, 32] };
        const peakYearsFor = (pos, age) => {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.peak[1] - (age || 25));
        };
        const valueYearsFor = (pos, age) => {
            const curve = ageCurveFor(pos);
            return Math.max(0, curve.decline[1] - (age || 25));
        };
        const budget = currentLeague?.settings?.waiver_budget || myRoster?.settings?.waiver_budget || 0;
        const spent = myRoster?.settings?.waiver_budget_used || 0;
        const remaining = Math.max(0, budget - spent);
        const hasFAAB = budget > 0;
        const faabMinBid = currentLeague?.settings?.waiver_budget_min ?? 0;

        // ── League format detection (for scarcity multipliers) ──
        const rosterPositions = currentLeague?.roster_positions || [];
        const isSuperFlex = rosterPositions.includes('SUPER_FLEX');
        const scoring = currentLeague?.scoring_settings || {};
        const isTEP = (scoring.bonus_rec_te || scoring.rec_te || 0) > 0;
        const teamTier = assess?.tier || '';
        const teamWindow = assess?.window || '';
        const isRebuilding = teamTier === 'REBUILDING' || teamWindow === 'REBUILDING';
        const isContending = teamTier === 'ELITE' || teamTier === 'CONTENDER' || teamWindow === 'CONTENDING';

        // ── Positional scarcity multipliers based on league format ──
        function getScarcityMultiplier(pos) {
            let mult = 1.0;
            if (isSuperFlex && pos === 'QB') mult = 1.8;
            if (isTEP && pos === 'TE') mult = 1.5;
            // RB scarcity: if league has 2+ RB slots + FLEX, RBs are scarce
            const rbSlots = rosterPositions.filter(s => s === 'RB').length;
            if (pos === 'RB' && rbSlots >= 2) mult = Math.max(mult, 1.3);
            return mult;
        }

        // Smart FAAB recommendation — now with team mode + scarcity awareness
        function faabSuggest(dhq, pos, playerAge) {
            if (!hasFAAB || dhq <= 0) return null;

            // ── Quality gate: skip replacement-level players ──
            if (dhq < 500) return null; // Below minimum quality threshold

            // ── Team mode gate ──
            if (isRebuilding && (playerAge || 30) > 25 && dhq < 2000) {
                // Rebuilding teams should NOT bid on older low-value players
                return null;
            }

            const floor = faabMinBid || 1;
            // Apply scarcity multiplier to base valuation
            const scarcity = getScarcityMultiplier(pos);
            const base = Math.round((dhq / 250) * scarcity);
            const cap = Math.round(remaining * 0.15);

            // Team mode adjustment
            let modeMultiplier = 1.0;
            if (isRebuilding) modeMultiplier = 0.6; // Rebuilders spend less, save FAAB
            if (isContending) modeMultiplier = 1.2; // Contenders bid aggressively on starters

            const adjusted = Math.round(base * modeMultiplier);
            const sug = Math.max(floor, Math.min(cap, adjusted));
            const lo = Math.max(floor, Math.round(sug * 0.7));
            const hi = Math.min(remaining, Math.round(sug * 1.4));

            // Competition: count teams with deficit at this position
            let competitors = 0;
            if (assess && currentLeague.rosters) {
                const reqCount = rosterPositions.filter(s => normPos(s) === pos || s === 'FLEX' || s === 'SUPER_FLEX').length;
                currentLeague.rosters.forEach(r => {
                    if (r.roster_id === myRoster?.roster_id) return;
                    const cnt = (r.players || []).filter(pid => normPos(playersData[pid]?.position) === pos).length;
                    if (cnt < reqCount) competitors++;
                });
            }
            const conf = competitors <= 1 ? 'Low competition' : competitors <= 3 ? 'Moderate' : 'High demand';
            const confCol = competitors <= 1 ? '#2ECC71' : competitors <= 3 ? '#F0A500' : '#E74C3C';
            return { sug, lo, hi, conf, confCol, competitors, scarcity, modeMultiplier };
        }

        // Top recommendations at weak positions — with quality + mode filtering
        const recommendations = useMemo(() => {
            if (!assess?.needs?.length) return [];
            const needPositions = assess.needs.slice(0, 3).map(n => n.pos);

            // ── Dynamic DHQ floor: scales down if wire is thin ──
            // Hard floor is 500, but if the best available at needed positions is below that,
            // drop to 25% of the best available DHQ so we always show something.
            const bestAvailDhq = availablePlayers
                .filter(x => needPositions.includes(x.pos))
                .reduce((m, x) => Math.max(m, x.dhq), 0);
            const dynamicFloor = Math.min(500, Math.max(100, Math.round(bestAvailDhq * 0.25)));

            // ── Minimum quality threshold: dynamic DHQ floor ──
            // ── Rebuild mode: age ≤ 25 unless DHQ > 2000 (genuinely good player) ──
            return availablePlayers
                .filter(x => {
                    if (!needPositions.includes(x.pos)) return false;
                    if (x.dhq < dynamicFloor) return false;
                    if (isRebuilding && (x.p.age || 30) > 25 && x.dhq < 2000) return false; // Rebuilders skip old low-value
                    return true;
                })
                .slice(0, 8)
                .map(x => {
                    const st = statsData[x.pid] || {};
                    const ppg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : 0;
                    // PPG quality check: skip if PPG < 5 with enough games
                    if (ppg > 0 && ppg < 5.0 && (st.gp || 0) >= 6) return null;
                    const need = assess.needs.find(n => n.pos === x.pos);
	                    const peakYrs = peakYearsFor(x.pos, x.p.age);
	                    const valueYrs = valueYearsFor(x.pos, x.p.age);
	                    const faab = faabSuggest(x.dhq, x.pos, x.p.age);
	                    return { ...x, ppg, need, peakYrs, valueYrs, faab };
                })
                .filter(Boolean);
        }, [availablePlayers, assess, statsData]);

        // Selected player detail
        const selPlayer = faSelectedPid ? playersData[faSelectedPid] : null;
        const selStats = faSelectedPid ? statsData[faSelectedPid] || {} : {};
        const selPrevStats = faSelectedPid ? (prevStatsData || {})[faSelectedPid] || {} : {};
        const selDhq = faSelectedPid ? (window.App?.LI?.playerScores?.[faSelectedPid] || 0) : 0;
        const selPpg = selStats.gp > 0 ? +(calcRawPts(selStats) / selStats.gp).toFixed(1) : (selPrevStats.gp > 0 ? +(calcRawPts(selPrevStats) / selPrevStats.gp).toFixed(1) : 0);
        const selPos = selPlayer ? normPos(selPlayer.position) : '';
        const selPeakYrs = selPlayer ? peakYearsFor(selPos, selPlayer.age) : 0;
        const selValueYrs = selPlayer ? valueYearsFor(selPos, selPlayer.age) : 0;
        const selFaab = faSelectedPid ? faabSuggest(selDhq, selPos, selPlayer?.age) : null;
        const selInitials = selPlayer ? ((selPlayer.first_name||'?')[0] + (selPlayer.last_name||'?')[0]).toUpperCase() : '';

        function openFaPlayer(pid) {
            if (window.WR && typeof window.WR.openPlayerCard === 'function') {
                window.WR.openPlayerCard(pid, { scoringSettings: currentLeague?.scoring_settings });
            } else if (typeof window.openFWPlayerModal === 'function') {
                window.openFWPlayerModal(pid, playersData, statsData, currentLeague?.scoring_settings);
            } else {
                setFaSelectedPid(pid);
            }
        }

        function playerName(p) {
            return p?.full_name || ((p?.first_name || '') + ' ' + (p?.last_name || '')).trim() || 'Unknown';
        }

        function seasonPpgFor(pid) {
            const st = statsData[pid] || {};
            const prevSt = (prevStatsData || {})[pid] || {};
            if (st.gp > 0) return +(calcRawPts(st) / st.gp).toFixed(1);
            if (prevSt.gp > 0) return +(calcRawPts(prevSt) / prevSt.gp).toFixed(1);
            return 0;
        }

        function windowRead(pos, age) {
            const peakYrs = peakYearsFor(pos, age);
            const valueYrs = valueYearsFor(pos, age);
            if (peakYrs >= 4) return { label: peakYrs + 'yr peak', short: 'Rising', color: '#2ECC71', peakYrs, valueYrs };
            if (peakYrs >= 1) return { label: peakYrs + 'yr peak', short: 'Prime', color: 'var(--gold)', peakYrs, valueYrs };
            if (valueYrs >= 1) return { label: valueYrs + 'yr value', short: 'Vet', color: '#F0A500', peakYrs, valueYrs };
            return { label: 'short term', short: 'Post', color: '#E74C3C', peakYrs, valueYrs };
        }

        function fitRead(pos) {
            const need = assess?.needs?.find(n => n.pos === pos);
            if (need?.urgency === 'deficit') return { label: 'Fills deficit', short: 'Deficit', score: 4, color: '#2ECC71', need };
            if (need) return { label: 'Fills thin room', short: 'Thin', score: 3, color: '#2ECC71', need };
            if (assess?.strengths?.includes(pos)) return { label: 'Surplus stash', short: 'Stash', score: 1, color: 'var(--silver)', need: null };
            return { label: 'Depth add', short: 'Depth', score: 2, color: 'var(--silver)', need: null };
        }

        function gradeLabel(g) {
            if (g === 'A') return { label: 'Strong', bg: 'rgba(46,204,113,0.12)' };
            if (g === 'B') return { label: 'OK', bg: 'rgba(255,255,255,0.06)' };
            if (g === 'C') return { label: 'Thin', bg: 'rgba(240,165,0,0.10)' };
            if (g === 'D') return { label: 'Weak', bg: 'rgba(240,165,0,0.10)' };
            return { label: 'Deficit', bg: 'rgba(231,76,60,0.10)' };
        }

        function rosterNeedsPosition(roster, pos) {
            const reqCount = rosterPositions.filter(s =>
                normPos(s) === pos ||
                (s === 'FLEX' && ['RB','WR','TE'].includes(pos)) ||
                (s === 'SUPER_FLEX' && ['QB','RB','WR','TE'].includes(pos))
            ).length;
            const minimum = Math.max(1, reqCount);
            const count = (roster?.players || []).filter(pid => normPos(playersData[pid]?.position) === pos).length;
            return count < minimum;
        }

        function decorateFaCandidate(x) {
            const pos = x.pos || normPos(x.p?.position) || x.p?.position || '';
            const ppg = x.ppg != null ? x.ppg : seasonPpgFor(x.pid);
            const win = windowRead(pos, x.p?.age);
            const fit = fitRead(pos);
            const faab = x.faab || faabSuggest(x.dhq, pos, x.p?.age);
            const why = fit.need
                ? 'Addresses your ' + pos + ' ' + fit.need.urgency + ' and keeps the bid in a controlled range.'
                : win.peakYrs > 0
                    ? 'Adds usable dynasty runway without forcing a major FAAB commitment.'
                    : 'Short-window depth. Treat as a tactical add, not a core asset.';
            return { ...x, pos, ppg, faab, fit, fitScore: fit.score, peakYrs: win.peakYrs, valueYrs: win.valueYrs, windowLabel: win.label, windowShort: win.short, windowColor: win.color, why };
        }

        const faabMarketRows = (currentLeague.rosters || []).map(r => {
            const user = (currentLeague.users || []).find(u => u.user_id === r.owner_id);
            const rBudget = Number(currentLeague?.settings?.waiver_budget || 0);
            const rSpent = Number(r.settings?.waiver_budget_used || 0);
            const rRemaining = Math.max(0, rBudget - rSpent);
            return {
                roster: r,
                rosterId: r.roster_id,
                name: user?.display_name || user?.username || ('Team ' + r.roster_id),
                remaining: rRemaining,
                pct: rBudget > 0 ? Math.round((rRemaining / rBudget) * 100) : 0,
                isMe: r.roster_id === myRoster?.roster_id,
            };
        }).sort((a, b) => b.remaining - a.remaining);
        const myFaabRank = faabMarketRows.findIndex(r => r.isMe) + 1;
        const leagueAvgRemaining = faabMarketRows.length
            ? Math.round(faabMarketRows.reduce((s, r) => s + r.remaining, 0) / faabMarketRows.length)
            : 0;
        const canOutbidRows = faabMarketRows.filter(r => !r.isMe && r.remaining > remaining).slice(0, 5);

        const posGrades = window.App?.calcPosGrades?.(myRoster?.roster_id, currentLeague?.rosters, playersData) || [];
        const posGradeMap = {};
        posGrades.forEach(g => posGradeMap[g.pos] = g);
        const rosterGapRows = ['QB','RB','WR','TE','K','DL','LB','DB']
            .filter(pos => (assess?.posAssessment || {})[pos])
            .map(pos => {
                const data = assess.posAssessment[pos] || {};
                const pg = posGradeMap[pos] || { grade: 'C', col: '#F0A500', rank: 0, totalTeams: 0 };
                const gl = gradeLabel(pg.grade);
                const bestWire = availablePlayers.find(x => x.pos === pos);
                return { pos, data, grade: pg.grade, label: gl.label, color: pg.col, bg: gl.bg, rank: pg.rank, totalTeams: pg.totalTeams, bestWire };
            })
            .sort((a, b) => {
                const order = { F: 0, D: 1, C: 2, B: 3, A: 4 };
                return (order[a.grade] ?? 2) - (order[b.grade] ?? 2) || (faPosOrder[a.pos] ?? 9) - (faPosOrder[b.pos] ?? 9);
            });

        const actionBoardPlayers = availablePlayers
            .map(decorateFaCandidate)
            .sort((a, b) => (b.fitScore * 5000 + b.dhq + (b.ppg || 0) * 35) - (a.fitScore * 5000 + a.dhq + (a.ppg || 0) * 35));
        const priorityAdds = (recommendations.length ? recommendations : actionBoardPlayers)
            .map(decorateFaCandidate)
            .sort((a, b) => (b.fitScore * 5000 + b.dhq) - (a.fitScore * 5000 + a.dhq))
            .slice(0, 5);
        const dropCandidates = (myRoster?.players || [])
            .filter(pid => !(myRoster?.starters || []).includes(pid))
            .map(pid => {
                const p = playersData[pid];
                if (!p) return null;
                const pos = normPos(p.position) || p.position;
                const dhq = window.App?.LI?.playerScores?.[pid] || 0;
                const win = windowRead(pos, p.age);
                return { pid, p, pos, dhq, name: playerName(p), windowLabel: win.label, windowColor: win.color };
            })
            .filter(Boolean)
            .sort((a, b) => a.dhq - b.dhq)
            .slice(0, 6);
        const usedUpgradeAdds = new Set();
        const upgradePairs = dropCandidates.map(drop => {
            const add = actionBoardPlayers.find(x =>
                !usedUpgradeAdds.has(x.pid) &&
                x.dhq > drop.dhq + 400 &&
                (x.pos === drop.pos || x.fitScore >= 3)
            );
            if (!add) return null;
            usedUpgradeAdds.add(add.pid);
            return { drop, add, gain: add.dhq - drop.dhq };
        }).filter(Boolean).slice(0, 4);
        const recentDrops = (() => {
            const out = [];
            const transactions = window.S?.transactions || {};
            const curWeek = window.S?.currentWeek || 1;
            for (let w = curWeek; w >= Math.max(1, curWeek - 2); w--) {
                (transactions['w' + w] || []).forEach(t => {
                    if (t.type !== 'free_agent' && t.type !== 'waiver') return;
                    Object.keys(t.drops || {}).forEach(pid => {
                        const p = playersData[pid];
                        const dhq = window.App?.LI?.playerScores?.[pid] || 0;
                        if (!p || dhq < 1500 || rostered.has(String(pid))) return;
                        out.push({ pid, name: playerName(p), pos: normPos(p.position) || p.position, dhq, week: w });
                    });
                });
            }
            return out.sort((a, b) => b.dhq - a.dhq).slice(0, 4);
        })();
        const positionThreats = Array.from(new Set([...(assess?.needs || []).map(n => n.pos), ...actionBoardPlayers.slice(0, 6).map(x => x.pos)]))
            .slice(0, 6)
            .map(pos => {
                const top = faabMarketRows.find(r => !r.isMe && rosterNeedsPosition(r.roster, pos));
                return { pos, top };
            })
            .filter(x => x.top);

        function renderCandidateRow(x, i, isPrimary) {
            const dhqCol = x.dhq >= 4000 ? '#3498DB' : x.dhq >= 2000 ? 'var(--silver)' : 'rgba(255,255,255,0.45)';
            return (
                <button key={x.pid} className={'fa-hq-candidate' + (isPrimary ? ' is-primary' : '')} onClick={() => openFaPlayer(x.pid)}>
                    <span className="fa-hq-rank">{i + 1}</span>
                    <span className="fa-hq-player-main">
                        <strong>{playerName(x.p)}</strong>
                        <em>{x.p.team || 'FA'} · {x.pos} · {x.windowLabel}</em>
                    </span>
                    <span className="fa-hq-player-fit" style={{ color: x.fit.color }}>{x.fit.short}</span>
                    <span className="fa-hq-player-value">
                        <strong style={{ color: dhqCol }}>{x.dhq ? x.dhq.toLocaleString() : '—'}</strong>
                        <em>{x.faab ? '$' + x.faab.lo + '-' + x.faab.hi : 'No bid'}</em>
                    </span>
                    <span className="fa-hq-why">{x.why}</span>
                </button>
            );
        }

        function renderActionHQ(compact = false) {
            const topAdds = priorityAdds.slice(0, compact ? 4 : 5);
            const boardRows = actionBoardPlayers.slice(0, compact ? 6 : 8);
            const swapRows = upgradePairs.slice(0, compact ? 3 : 4);
            const freshRows = recentDrops.slice(0, compact ? 2 : 3);
            const deficitChips = (assess?.needs || []).filter(n => n.urgency === 'deficit').map(n => n.pos);
            const thinChips = (assess?.needs || []).filter(n => n.urgency === 'thin').map(n => n.pos);
            const starterReq = rosterGapRows.reduce((s, r) => s + Math.max(1, r.data.startingReq || r.data.minQuality || 1), 0);
            const starterFilled = rosterGapRows.reduce((s, r) => {
                const req = Math.max(1, r.data.startingReq || r.data.minQuality || 1);
                const filled = r.data.nflStarters || Math.min(r.data.actual || 0, req);
                return s + Math.min(filled, req);
            }, 0);
            const starterCoverage = starterReq ? Math.round((starterFilled / starterReq) * 100) : null;
            const pressureScore = boardRows.reduce((s, r) => s + (r.faab?.competitors || 0), 0);
            const pressure = pressureScore >= 14 ? 'High' : pressureScore >= 7 ? 'Moderate' : 'Low';
            const pressureColor = pressure === 'High' ? '#E74C3C' : pressure === 'Moderate' ? '#F0A500' : '#2ECC71';
            const faabColor = remaining > budget * 0.5 ? '#2ECC71' : remaining > budget * 0.25 ? '#F0A500' : '#E74C3C';
            return (
                <section className={'fa-hq-shell' + (compact ? ' is-compact' : '')}>
                    <div className="fa-hq-hero">
                        <div>
                            <span>Free Agency Action HQ</span>
                            <h2>{topAdds[0] ? topAdds[0].p.full_name || playerName(topAdds[0].p) : 'No urgent add surfaced'}</h2>
                            <p>{topAdds[0] ? topAdds[0].why : 'Your market is clean enough to browse for stashes and tactical depth.'}</p>
                        </div>
                        <div className="fa-hq-hero-kpis">
                            {hasFAAB && <div><span>FAAB</span><strong style={{ color: faabColor }}>${remaining}</strong><em>#{myFaabRank || '—'}/{faabMarketRows.length || '—'} · avg ${leagueAvgRemaining}</em></div>}
                            <div><span>Pressure</span><strong style={{ color: pressureColor }}>{pressure}</strong><em>{pressureScore} competitor signals</em></div>
                            <div><span>Coverage</span><strong>{starterCoverage == null ? '—' : starterCoverage + '%'}</strong><em>{deficitChips.length ? deficitChips.join(', ') + ' deficits' : starterCoverage == null ? 'Assessment pending' : 'No red rooms'}</em></div>
                        </div>
                    </div>

                    <div className="fa-hq-grid">
                        <aside className="fa-hq-panel">
                            <div className="fa-hq-panel-head">
                                <span>Priority Moves</span>
                                <em>{topAdds.length} add targets · {swapRows.length} swaps</em>
                            </div>
                            <div className="fa-hq-stack">
                                {topAdds.length ? topAdds.map((x, i) => (
                                    <button key={x.pid} className="fa-hq-mini-card" onClick={() => openFaPlayer(x.pid)}>
                                        <strong>{playerName(x.p)} <span style={{ color: posColors[x.pos] || 'var(--silver)' }}>{x.pos}</span></strong>
                                        <em>{x.fit.label} · {x.dhq.toLocaleString()} DHQ{x.faab ? ' · $' + x.faab.lo + '-' + x.faab.hi : ''}</em>
                                    </button>
                                )) : <div className="fa-hq-empty">No priority adds match your current roster needs.</div>}
                            </div>

                            <div className="fa-hq-subhead">Best Add/Drop Upgrades</div>
                            <div className="fa-hq-stack">
                                {swapRows.length ? swapRows.map(pair => (
                                    <button key={pair.drop.pid + '-' + pair.add.pid} className="fa-hq-swap" onClick={() => openFaPlayer(pair.add.pid)}>
                                        <span><b>Drop</b>{pair.drop.name}<em>{pair.drop.dhq.toLocaleString()}</em></span>
                                        <span><b>Add</b>{playerName(pair.add.p)}<em>+{pair.gain.toLocaleString()}</em></span>
                                    </button>
                                )) : <div className="fa-hq-empty">No obvious add/drop upgrade found from the current wire.</div>}
                            </div>

                            <div className="fa-hq-subhead">Fresh Drop Alerts</div>
                            <div className="fa-hq-stack">
                                {freshRows.length ? freshRows.map(d => (
                                    <button key={d.pid} className="fa-hq-mini-card is-alert" onClick={() => openFaPlayer(d.pid)}>
                                        <strong>{d.name} <span>{d.pos}</span></strong>
                                        <em>Dropped W{d.week} · {d.dhq.toLocaleString()} DHQ</em>
                                    </button>
                                )) : <div className="fa-hq-empty">No startable recent drops are sitting on the wire.</div>}
                            </div>
                        </aside>

                        <main className="fa-hq-panel fa-hq-board">
                            <div className="fa-hq-panel-head">
                                <span>Ranked Waiver Board</span>
                                <em>bid range, fit, window, and reason</em>
                            </div>
                            <div className="fa-hq-board-list">
                                {boardRows.map((x, i) => renderCandidateRow(x, i, i === 0))}
                            </div>
                        </main>

                        <aside className="fa-hq-panel">
                            <div className="fa-hq-panel-head">
                                <span>Market Leverage</span>
                                <em>{canOutbidRows.length ? canOutbidRows.length + ' teams can outbid you' : 'You control most bids'}</em>
                            </div>
                            {hasFAAB && <div className="fa-hq-faab-card">
                                <strong style={{ color: faabColor }}>${remaining}</strong>
                                <span>of ${budget} left · #{myFaabRank || '—'} in FAAB</span>
                                <i style={{ width: budget > 0 ? Math.max(3, Math.round((remaining / budget) * 100)) + '%' : '0%', background: faabColor }} />
                            </div>}
                            <div className="fa-hq-competitors">
                                {(canOutbidRows.length ? canOutbidRows : faabMarketRows.filter(r => !r.isMe).slice(0, 4)).map(r => (
                                    <div key={r.rosterId}>
                                        <span>{r.name}</span>
                                        <strong>${r.remaining}</strong>
                                    </div>
                                ))}
                            </div>

                            <div className="fa-hq-subhead">Position Threats</div>
                            <div className="fa-hq-threats">
                                {positionThreats.length ? positionThreats.map(t => (
                                    <div key={t.pos}>
                                        <span style={{ color: posColors[t.pos] || 'var(--silver)' }}>{t.pos}</span>
                                        <em>{t.top.name}</em>
                                        <strong>${t.top.remaining}</strong>
                                    </div>
                                )) : <div className="fa-hq-empty">No clear outbid threat by position.</div>}
                            </div>

                            <div className="fa-hq-subhead">Roster Gap Matrix</div>
                            <div className="fa-hq-gap-matrix">
                                {rosterGapRows.map(row => (
                                    <div key={row.pos} style={{ background: row.bg }}>
                                        <span style={{ color: posColors[row.pos] || row.color }}>{row.pos}</span>
                                        <strong className="fa-gap-badge" style={{ color: row.color, borderColor: row.color }}>{row.label}</strong>
                                        <em>{row.data.nflStarters || Math.min(row.data.actual || 0, row.data.minQuality || row.data.startingReq || 0)}/{row.data.minQuality || row.data.startingReq || 0}</em>
                                        <i>{row.bestWire ? playerName(row.bestWire.p) : '—'}</i>
                                    </div>
                                ))}
                            </div>
                        </aside>
                    </div>
                </section>
            );
        }

        // ── COMMAND VIEW: shared Action HQ, without the deep market table ──
        if (viewMode === 'command') {
            if (!canAccess('fa-decision-engine')) {
                return React.createElement(UpgradeGate, {
                    feature: 'fa-decision-engine',
                    title: 'UNLOCK WAIVER INTELLIGENCE',
                    description: 'Get FAAB bid recommendations with confidence levels, tiered targets ranked by roster impact, and market pressure analysis. Know exactly who to bid on and how much.',
                    targetTier: 'warroom'
                });
            }
            return (
                <div className="fa-page wr-fade-in">
                    <div className="wr-module-strip">
                        <div className="wr-module-context">
                            <span>Waivers</span>
                            <strong>Action HQ</strong>
                            <em>Add/drop priorities, FAAB leverage, and roster-fit targeting.</em>
                        </div>
                        <div className="wr-module-actions">
                            <span className="wr-module-pill">Command</span>
                        </div>
                    </div>
                    {renderActionHQ(true)}
                </div>
            );
        }

        // ── ANALYST VIEW: full market terminal ──
        return (
            <div className="fa-page wr-fade-in">
                <div className="wr-module-strip">
                    <div className="wr-module-context">
                        <span>Waivers</span>
                        <strong>Action HQ</strong>
                        <em>Add/drop priorities, FAAB leverage, and full market exploration.</em>
                    </div>
                    <div className="wr-module-actions">
                        <span className="wr-module-pill">Analyst</span>
                    </div>
                </div>

                {renderActionHQ(false)}

                <section className="fa-market-shell">
                <div className="fa-market-head">
                    <div>
                        <span>Market Explorer</span>
                        <p>{sortedPlayers.length} shown from {availablePlayers.length} available players. Saved views and custom columns still apply.</p>
                    </div>
                    <div className="fa-market-search">
                        <input value={faSearch} onChange={e => setFaSearch(e.target.value)} placeholder="Search player, team, college..." />
                    </div>
                </div>

                <div className="fa-market-toolbar wr-module-toolbar">
                    <span className="wr-module-toolbar-label">POS</span>
                    <div className="wr-module-nav">
                    {['', 'QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'].map(pos =>
                        <button key={pos} className={faFilter === pos ? 'is-active' : ''} onClick={() => setFaFilter(pos)}>{pos || 'All'}</button>
                    )}
                    </div>
                </div>

                {/* Phase 6 deferred: presets + column picker + SavedViewBar */}
                <div className="fa-market-toolbar wr-module-toolbar">
                    <span className="wr-module-toolbar-label">View</span>
                    <div className="wr-module-nav">
                    {Object.entries(FA_COLUMN_PRESETS).map(([key, cols]) => (
                        <button key={key} className={faColPreset === key ? 'is-active' : ''} onClick={() => { setVisibleFaCols(cols); setFaColPreset(key); }}>{key}</button>
                    ))}
                    <button className={showFaColPicker ? 'is-active' : ''} onClick={() => setShowFaColPicker(!showFaColPicker)}>Columns</button>
                    </div>
                    {/* Rolling PPG window selector — shared with My Roster */}
                    <span className="wr-module-toolbar-label">PPG</span>
                    <div className="wr-module-nav">
                    {[{k:'season',l:'Season'},{k:'l5',l:'L5'},{k:'l3',l:'L3'}].map(opt => (
                        <button key={opt.k} className={ppgWindow === opt.k ? 'is-active' : ''} onClick={() => setPpgWindow(opt.k)} title={opt.k === 'season' ? 'Season-to-date PPG' : 'Last ' + (opt.k === 'l5' ? 5 : 3) + ' games'}>{opt.l}</button>
                    ))}
                    </div>

                    {window.WR?.SavedViews?.SavedViewBar && (
                        <div style={{ marginLeft: 'auto' }}>
                            {React.createElement(window.WR.SavedViews.SavedViewBar, {
                                surface: 'free_agency',
                                leagueId: currentLeague?.id || currentLeague?.league_id,
                                currentState: { columns: visibleFaCols, sort: faSort, filters: { faFilter, faSearch } },
                                onApply: (v) => {
                                    if (Array.isArray(v.columns) && v.columns.length) { setVisibleFaCols(v.columns); setFaColPreset('custom'); }
                                    if (v.sort && v.sort.key) setFaSort({ key: v.sort.key, dir: v.sort.dir || 1 });
                                    if (v.filters && typeof v.filters.faFilter === 'string') setFaFilter(v.filters.faFilter);
                                    if (v.filters && typeof v.filters.faSearch === 'string') setFaSearch(v.filters.faSearch);
                                },
                            })}
                        </div>
                    )}
                </div>

                {showFaColPicker && (
                    <div style={{ background: '#0a0a0a', border: '2px solid rgba(212,175,55,0.3)', borderRadius: '8px', padding: '12px', marginBottom: '8px' }}>
                        {/* Active columns — reorderable */}
                        <div style={{ fontSize: '0.64rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 }}>Active order (click ◀ ▶ to reorder)</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '12px' }}>
                            {visibleFaCols.map((key, i) => {
                                const col = FA_COLUMNS[key]; if (!col) return null;
                                const moveLeft = () => { setFaColPreset('custom'); setVisibleFaCols(prev => { if (i === 0) return prev; const next = [...prev]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; }); };
                                const moveRight = () => { setFaColPreset('custom'); setVisibleFaCols(prev => { if (i === prev.length - 1) return prev; const next = [...prev]; [next[i + 1], next[i]] = [next[i], next[i + 1]]; return next; }); };
                                const remove = () => { setFaColPreset('custom'); setVisibleFaCols(prev => prev.filter(c => c !== key)); };
                                return (
                                    <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: '2px', padding: '2px 4px 2px 8px', borderRadius: '4px', fontSize: '0.72rem', background: 'rgba(212,175,55,0.12)', border: '1px solid rgba(212,175,55,0.35)', color: 'var(--gold)' }}>
                                        <span style={{ marginRight: '4px' }}>{col.shortLabel}</span>
                                        <button onClick={moveLeft} disabled={i === 0} title="Move left" style={{ padding: '0 3px', background: 'transparent', border: 'none', color: i === 0 ? 'rgba(212,175,55,0.25)' : 'var(--gold)', cursor: i === 0 ? 'default' : 'pointer', fontSize: '0.66rem' }}>◀</button>
                                        <button onClick={moveRight} disabled={i === visibleFaCols.length - 1} title="Move right" style={{ padding: '0 3px', background: 'transparent', border: 'none', color: i === visibleFaCols.length - 1 ? 'rgba(212,175,55,0.25)' : 'var(--gold)', cursor: i === visibleFaCols.length - 1 ? 'default' : 'pointer', fontSize: '0.66rem' }}>▶</button>
                                        <button onClick={remove} title="Remove" style={{ padding: '0 4px', background: 'transparent', border: 'none', color: '#E74C3C', cursor: 'pointer', fontSize: '0.7rem' }}>×</button>
                                    </span>
                                );
                            })}
                        </div>

                        {/* All available columns — tick to add */}
                        <div style={{ fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', fontWeight: 700 }}>Available columns</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
                            {Object.entries(FA_COLUMNS).map(([key, col]) => {
                                const active = visibleFaCols.includes(key);
                                return (
                                    <label key={key} style={{
                                        display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px',
                                        borderRadius: '4px', cursor: 'pointer', fontSize: '0.76rem',
                                        background: active ? 'rgba(212,175,55,0.1)' : 'transparent',
                                        color: active ? 'var(--gold)' : 'var(--silver)'
                                    }}>
                                        <input type="checkbox" checked={active} onChange={() => {
                                            setVisibleFaCols(prev => active ? prev.filter(c => c !== key) : [...prev, key]);
                                            setFaColPreset('custom');
                                        }} style={{ accentColor: 'var(--gold)' }} />
                                        {col.label}
                                        <span style={{ fontSize: '0.7rem', opacity: 0.6, marginLeft: 'auto' }}>{col.group}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Dynamic grid — photo + Player + configured columns */}
                {(() => {
                    const gridTemplate = '32px 1fr ' + visibleFaCols.map(k => (FA_COLUMNS[k]?.width || '44px')).join(' ');
                    return <div style={{ background: 'var(--black)', border: '1px solid rgba(212,175,55,0.2)', borderRadius: '10px', overflow: 'hidden' }}>
                        {/* Header */}
                        <div style={{ display: 'grid', gridTemplateColumns: gridTemplate, gap: '4px', padding: '8px 12px', background: 'rgba(212,175,55,0.06)', borderBottom: '2px solid rgba(212,175,55,0.2)' }}>
                            <span style={faHeaderStyle}></span>
                            <span style={faHeaderStyle} onClick={() => handleFaSort('name')}>Player{faSortIndicator('name')}</span>
                            {visibleFaCols.map(k => {
                                const col = FA_COLUMNS[k]; if (!col) return null;
                                const clickable = !!col.sortKey;
                                return <span key={k} style={{ ...faHeaderStyle, cursor: clickable ? 'pointer' : 'default' }} title={col.label}
                                    onClick={() => clickable && handleFaSort(col.sortKey)}>
                                    {col.shortLabel}{clickable ? faSortIndicator(col.sortKey) : ''}
                                </span>;
                            })}
                        </div>
                        {/* Body */}
                        <div style={{ maxHeight: 'none', overflow: 'visible' }}>
                            {sortedPlayers.map(({ pid, p, dhq }) => {
                                const pos = normPos(p.position) || p.position;
                                const st = statsData[pid] || {};
                                const prevSt = (prevStatsData || {})[pid] || {};
                                const seasonPpg = st.gp > 0 ? +(calcRawPts(st) / st.gp).toFixed(1) : (prevSt.gp > 0 ? +(calcRawPts(prevSt) / prevSt.gp).toFixed(1) : 0);
                                // Rolling PPG — swap in when user toggled L5/L3 and weekly data is loaded.
                                // If a window is active but the player has no weekly data yet, annotate
                                // the cell with "· Szn" so the user knows the shown value is seasonal.
                                let ppg = seasonPpg;
                                let ppgMarker = '';
                                if (ppgWindow !== 'season') {
                                    const n = ppgWindow === 'l3' ? 3 : 5;
                                    const rolling = typeof window.App?.computeRollingPPG === 'function'
                                        ? window.App.computeRollingPPG(pid, n)
                                        : 0;
                                    if (rolling > 0) { ppg = rolling; ppgMarker = ' · L' + n; }
                                    else { ppgMarker = ' · Szn'; }
                                }
	                                const dhqCol = dhq >= 7000 ? '#2ECC71' : dhq >= 4000 ? '#3498DB' : dhq >= 2000 ? 'var(--silver)' : 'rgba(255,255,255,0.25)';
	                                const faab = faabSuggest(dhq, pos);
		                                const peakYrs = peakYearsFor(pos, p.age);
		                                const valueYrs = valueYearsFor(pos, p.age);
		                                const peakLabel = peakYrs >= 4 ? 'Rising' : peakYrs >= 1 ? 'Prime' : valueYrs >= 1 ? 'Vet' : 'Post';
		                                const peakCol = peakYrs >= 4 ? '#2ECC71' : peakYrs >= 1 ? 'var(--gold)' : valueYrs >= 1 ? '#F0A500' : '#E74C3C';
                                const fit = fitRead(pos);
                                const renderCell = (k) => {
                                    switch (k) {
                                        case 'pos':        return <span style={{ fontSize: '0.76rem', fontWeight: 700, color: posColors[pos] || 'var(--silver)' }}>{pos}</span>;
                                        case 'team':       return <span style={{ fontSize: '0.74rem', color: 'var(--silver)', fontWeight: 600 }}>{p.team || 'FA'}</span>;
                                        case 'age':        return <span style={{ fontSize: '0.78rem', color: 'var(--silver)' }}>{p.age || '\u2014'}</span>;
                                        case 'dhq':        return <span style={{ fontSize: '0.82rem', fontWeight: 700, fontFamily: 'var(--font-body)', color: dhqCol }}>{dhq > 0 ? dhq.toLocaleString() : '\u2014'}</span>;
                                        case 'ppg':        return <span style={{ fontSize: '0.78rem', color: ppg >= 10 ? '#2ECC71' : ppg >= 5 ? 'var(--silver)' : 'rgba(255,255,255,0.3)' }}>{ppg > 0 ? ppg : '\u2014'}{ppgMarker}</span>;
                                        case 'peakYr':     return <span style={{ fontSize: '0.74rem', color: peakCol, fontWeight: 600 }}>{peakLabel}</span>;
                                        case 'yrsExp':     return <span style={{ fontSize: '0.74rem', color: 'var(--silver)' }}>{p.years_exp != null ? p.years_exp : '\u2014'}</span>;
                                        case 'college':    return <span style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.college || '\u2014'}</span>;
                                        case 'height':     return <span style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{p.height ? Math.floor(p.height/12) + "'" + (p.height%12) + '"' : '\u2014'}</span>;
                                        case 'weight':     return <span style={{ fontSize: '0.72rem', color: 'var(--silver)' }}>{p.weight || '\u2014'}</span>;
                                        case 'depthChart': return <span style={{ fontSize: '0.72rem', color: p.depth_chart_order != null ? 'var(--silver)' : 'rgba(255,255,255,0.3)' }}>{p.depth_chart_order != null ? pos + (p.depth_chart_order + 1) : '\u2014'}</span>;
                                        case 'injury':     return <span style={{ fontSize: '0.72rem', fontWeight: 600, color: p.injury_status ? '#E74C3C' : 'rgba(255,255,255,0.3)' }}>{p.injury_status || '—'}</span>;
                                        case 'faab':       return <span style={{ fontSize: '0.74rem', color: 'var(--gold)', fontWeight: 700 }}>{faab ? '$' + faab.lo + '-' + faab.hi : '\u2014'}</span>;
                                        case 'fit':        return <span style={{ fontSize: '0.72rem', color: fit.color, fontWeight: 700 }}>{fit.short}</span>;
                                        default:           return <span>—</span>;
                                    }
                                };
                                return <div key={pid} onClick={() => {
                                    openFaPlayer(pid);
                                }} style={{ display: 'grid', gridTemplateColumns: gridTemplate, background: faSelectedPid === pid ? 'rgba(212,175,55,0.08)' : 'transparent', gap: '4px', padding: '7px 12px', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', alignItems: 'center', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(212,175,55,0.05)'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                    <div className={'wr-ring wr-ring-' + pos} style={{ width: '26px', height: '26px', borderRadius: '50%', overflow: 'hidden', background: 'rgba(212,175,55,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                        <img src={'https://sleepercdn.com/content/nfl/players/' + pid + '.jpg'} alt="" style={{ width: '26px', height: '26px', borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.1)' }} onError={e => { e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:10px;font-weight:700;color:var(--gold)'; s.textContent=((p.first_name||'?')[0]+(p.last_name||'?')[0]).toUpperCase(); e.target.after(s); }} />
                                    </div>
                                    <div style={{ overflow: 'hidden' }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--white)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Unknown'}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--silver)', opacity: 0.55 }}>{p.team || 'FA'}{p.injury_status ? ' · ' : ''}{p.injury_status ? <span style={{ color: '#E74C3C' }}>{p.injury_status}</span> : ''}</div>
                                    </div>
                                    {visibleFaCols.map(k => <span key={k} style={{ display: 'flex', alignItems: 'center' }}>{renderCell(k)}</span>)}
                                </div>;
                            })}
                        </div>
                    </div>;
                })()}
                </section>

                {/* ── RIGHT: PLAYER DETAIL PANEL ── */}
                {faSelectedPid && selPlayer && <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: '380px', background: 'linear-gradient(135deg, var(--off-black), var(--charcoal))', borderLeft: '2px solid var(--gold)', zIndex: 200, overflowY: 'auto', padding: '20px', boxShadow: '-8px 0 32px rgba(0,0,0,0.5)' }}>
                    {/* Close */}
                    <button onClick={() => setFaSelectedPid(null)} style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(212,175,55,0.3)', color: 'var(--silver)', width: '28px', height: '28px', borderRadius: '50%', cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>&times;</button>

                    {/* Photo + Name */}
                    <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginBottom: '16px' }}>
                        <div style={{ width: '64px', height: '64px', borderRadius: '12px', overflow: 'hidden', background: 'rgba(212,175,55,0.1)', border: '2px solid rgba(212,175,55,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <img src={'https://sleepercdn.com/content/nfl/players/' + faSelectedPid + '.jpg'} style={{ width: '64px', height: '64px', objectFit: 'cover' }} onError={e => { e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:20px;font-weight:700;color:var(--gold)'; s.textContent=selInitials; e.target.after(s); }} />
                        </div>
                        <div>
                            <div style={{ fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--white)', letterSpacing: '0.02em' }}>{selPlayer.full_name || 'Unknown'}</div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--silver)' }}>{selPos} · {selPlayer.team || 'FA'} · Age {selPlayer.age || '?'} · {selPlayer.years_exp ?? 0}yr exp{selPlayer.college ? ' · ' + selPlayer.college : ''}</div>
                        </div>
                    </div>

                    {/* Key Stats Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '16px' }}>
                        {[
                            { val: selDhq > 0 ? selDhq.toLocaleString() : '\u2014', label: 'DHQ VALUE', col: selDhq >= 7000 ? '#2ECC71' : selDhq >= 4000 ? '#3498DB' : selDhq >= 2000 ? 'var(--silver)' : 'var(--silver)' },
                            { val: selPpg || '\u2014', label: 'PPG', col: selPpg >= 10 ? '#2ECC71' : selPpg >= 5 ? 'var(--silver)' : 'var(--silver)' },
	                            { val: selPeakYrs > 0 ? selPeakYrs + 'yr' : selValueYrs + 'yr', label: selPeakYrs > 0 ? 'PEAK LEFT' : 'VALUE LEFT', col: selPeakYrs >= 4 ? '#2ECC71' : selPeakYrs >= 1 ? 'var(--gold)' : selValueYrs >= 1 ? '#F0A500' : '#E74C3C' },
                        ].map((s, i) => <div key={i} style={{ textAlign: 'center', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', padding: '10px 6px', border: '1px solid rgba(255,255,255,0.06)' }}>
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.3rem', fontWeight: 600, color: s.col }}>{s.val}</div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                        </div>)}
                    </div>

                    {/* FAAB Recommendation */}
                    {selFaab && <div style={{ background: 'rgba(212,175,55,0.06)', border: '1px solid rgba(212,175,55,0.25)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>FAAB Recommendation</div>
                        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '1.8rem', fontWeight: 600, color: 'var(--gold)' }}>{'$' + selFaab.lo + ' \u2013 $' + selFaab.hi}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--silver)', marginTop: '4px' }}>Suggested: <strong style={{ color: 'var(--white)' }}>{'$' + selFaab.sug}</strong> of ${remaining} remaining</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px' }}>
                            <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: selFaab.confCol }} />
                            <span style={{ fontSize: '0.78rem', color: selFaab.confCol, fontWeight: 600 }}>{selFaab.conf}</span>
                            <span style={{ fontSize: '0.74rem', color: 'var(--silver)', opacity: 0.6 }}>{selFaab.competitors} other team{selFaab.competitors !== 1 ? 's' : ''} need {selPos}</span>
                        </div>
                    </div>}

                    {/* Roster Fit */}
                    {assess && (() => {
                        const need = assess.needs?.find(n => n.pos === selPos);
                        const strength = assess.strengths?.includes(selPos);
                        return <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>ROSTER FIT</div>
                            {need && <div style={{ fontSize: '0.82rem', color: '#2ECC71', fontWeight: 600, marginBottom: '4px' }}>Fills {selPos} {need.urgency}</div>}
                            {strength && <div style={{ fontSize: '0.82rem', color: 'var(--silver)', opacity: 0.7, marginBottom: '4px' }}>You already have {selPos} surplus — stash only</div>}
                            {!need && !strength && <div style={{ fontSize: '0.82rem', color: 'var(--silver)', marginBottom: '4px' }}>Depth add at {selPos}</div>}
                            <div style={{ fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.6 }}>
	                                {selPeakYrs >= 4 ? 'Long dynasty window — buy low candidate' : selPeakYrs >= 1 ? 'In production window — immediate contributor' : selValueYrs >= 1 ? 'Veteran value window — short-term contributor' : 'Past value window — short-term rental only'}
                            </div>
                        </div>;
                    })()}

                    {/* Season Stats */}
                    {selStats.gp > 0 && <div style={{ marginBottom: '16px' }}>
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: '0.82rem', color: 'var(--silver)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>SEASON STATS</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                            {[
                                ['Games', selStats.gp],
                                ['Total Pts', selStats.pts_half_ppr ? Math.round(selStats.pts_half_ppr) : Math.round(calcRawPts(selStats))],
                                ['PPG', selPpg],
                                selStats.pass_yd ? ['Pass Yds', Math.round(selStats.pass_yd).toLocaleString()] : selStats.rush_yd ? ['Rush Yds', Math.round(selStats.rush_yd).toLocaleString()] : selStats.rec ? ['Receptions', selStats.rec] : null,
                                selStats.pass_td ? ['Pass TD', selStats.pass_td] : selStats.rush_td ? ['Rush TD', selStats.rush_td] : selStats.rec_td ? ['Rec TD', selStats.rec_td] : null,
                                selStats.rec_yd ? ['Rec Yds', Math.round(selStats.rec_yd).toLocaleString()] : null,
                            ].filter(Boolean).map(([label, val], i) => <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 8px', background: 'rgba(255,255,255,0.02)', borderRadius: '4px' }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6 }}>{label}</span>
                                <span style={{ fontSize: '0.78rem', color: 'var(--white)', fontWeight: 600 }}>{val}</span>
                            </div>)}
                        </div>
                    </div>}

                    {/* Physical */}
                    {(selPlayer.height || selPlayer.weight) && <div style={{ fontSize: '0.78rem', color: 'var(--silver)', opacity: 0.6, marginBottom: '16px' }}>
                        {selPlayer.height ? Math.floor(selPlayer.height/12) + "'" + (selPlayer.height%12) + '"' : ''}{selPlayer.weight ? ' · ' + selPlayer.weight + 'lbs' : ''}
                    </div>}

                    {/* Action */}
                    <button onClick={() => openFaPlayer(faSelectedPid)} style={{ width: '100%', padding: '10px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '8px', fontFamily: 'Rajdhani, sans-serif', fontSize: '1rem', letterSpacing: '0.06em', cursor: 'pointer' }}>FULL PLAYER CARD</button>
                </div>}
            </div>
        );
    }

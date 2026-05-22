// ══════════════════════════════════════════════════════════════════
// components.js — Shared UI components (UpgradeGate, GMMessage, etc.)
// ══════════════════════════════════════════════════════════════════
    const COMPONENTS_WR_KEYS  = window.App.WR_KEYS;
    const ComponentsStorage = window.App.WrStorage;
    function UpgradeGate({ feature, title, description, targetTier, children, onClose }) {
        const tier = getUserTier();
        const hasAccess = canAccess(feature);

        if (hasAccess) return children || null;

        // Check one-time taste
        const [tasteUsed, setTasteUsed] = React.useState(false);
        if (children && hasTasteLeft() && !tasteUsed) {
            return React.createElement(React.Fragment, null,
                children,
                React.createElement('div', { style: { textAlign:'center', padding:'12px', background:'rgba(212,175,55,0.06)', border:'1px solid rgba(212,175,55,0.2)', borderRadius:'8px', marginTop:'12px' } },
                    React.createElement('div', { style: { fontSize:'0.82rem', color:'var(--gold)', fontWeight:700, marginBottom:'4px' } }, 'Free preview — upgrade to keep using this feature'),
                    React.createElement('button', { onClick: () => setTasteUsed(true), style: { padding:'6px 16px', background:'var(--gold)', color:'var(--black)', border:'none', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'0.9rem', cursor:'pointer' } }, 'Got it')
                )
            );
        }

        const tierLabel = targetTier === 'scout' ? 'Scout' : 'War Room';
        const tierPrice = targetTier === 'scout' ? '$4.99/mo' : '$9.99/mo';

        return React.createElement('div', { style: { background:'linear-gradient(135deg, var(--off-black), var(--charcoal))', border:'1px solid rgba(212,175,55,0.2)', borderRadius:'10px', padding:'28px 24px', textAlign:'center', maxWidth:'480px', margin:'20px auto' } },
            React.createElement('div', { style: { fontFamily:'Rajdhani, sans-serif', fontSize:'1.6rem', color:'var(--gold)', letterSpacing:'0.06em', marginBottom:'8px' } }, title || 'UPGRADE TO UNLOCK'),
            React.createElement('div', { style: { fontSize:'0.88rem', color:'var(--silver)', lineHeight:1.7, marginBottom:'16px' } }, description || 'This feature requires a paid subscription.'),
            React.createElement('div', { style: { display:'flex', gap:'10px', justifyContent:'center', marginBottom:'12px' } },
                React.createElement('button', { onClick: () => { window.location.href = 'landing.html'; }, style: { padding:'10px 24px', background:'var(--gold)', color:'var(--black)', border:'none', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'1.1rem', letterSpacing:'0.05em', cursor:'pointer' } }, 'Unlock ' + tierLabel + ' — ' + tierPrice),
            ),
            React.createElement('div', { style: { fontSize:'0.76rem', color:'var(--silver)', opacity:0.5 } }, 'Currently on Scout (free) plan'),
            onClose ? React.createElement('button', { onClick: onClose, style: { marginTop:'10px', background:'none', border:'none', color:'var(--silver)', cursor:'pointer', fontSize:'0.78rem' } }, 'Maybe later') : null
        );
    }
    window.UpgradeGate = UpgradeGate;
    // canAccess lives in core.js closure; do NOT re-assign to window
    // (overwrites shared/tier.js and causes infinite recursion via _sharedCanAccess)
    window.getUserTier = getUserTier;

    // ===== PLAYER INLINE CARD (bottom-right, non-blocking) =====
    function PlayerInlineCard({ pid, playersData, statsData, onClose, onFullProfile }) {
        const p = playersData?.[pid];
        if (!p) return null;
        const pos = p.position || '?';
        const name = p.full_name || ((p.first_name||'') + ' ' + (p.last_name||'')).trim();
        const dhq = window.App?.LI?.playerScores?.[pid] || 0;
        const meta = window.App?.LI?.playerMeta?.[pid] || {};
        const st = statsData?.[pid] || {};
        const nPos = ['DE','DT','NT'].includes(pos)?'DL':['CB','S','SS','FS'].includes(pos)?'DB':['OLB','ILB','MLB'].includes(pos)?'LB':pos;
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(nPos)
            : { build: [22, 24], peak: (window.App.peakWindows || {})[nPos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const age = p.age || 0;
        const peakYrs = Math.max(0, pHi - age);
        const valueYrs = Math.max(0, declineHi - age);
        const peakLabel = age < pLo ? 'Rising' : age <= pHi ? 'Prime' : age <= declineHi ? 'Veteran' : 'Post-Window';
        const peakCol = age < pLo ? '#2ECC71' : age <= pHi ? '#D4AF37' : age <= declineHi ? '#F0A500' : '#E74C3C';
        const dhqCol = dhq >= 7000 ? '#2ECC71' : dhq >= 4000 ? '#3498DB' : dhq >= 2000 ? '#D0D0D0' : 'rgba(255,255,255,0.3)';
        // Use league scoring_settings for PPG (matches roster table calculation)
        const scoring = window.S?.leagues?.[0]?.scoring_settings;
        const ppgRaw = window.App.calcPPG(st, scoring);
        const ppg = ppgRaw > 0 ? +ppgRaw.toFixed(1) : (meta.ppg || 0);
        const trend = meta.trend || 0;
        // Use shared getPlayerAction if available (ownership-aware)
        const pa = typeof window.getPlayerAction === 'function' ? window.getPlayerAction(pid) : null;
        const rec = pa ? pa.label.toUpperCase() : (peakYrs <= 0 && trend <= -10 ? 'SELL NOW' : peakYrs <= 0 ? 'SELL' : peakYrs <= 2 ? 'SELL' : dhq >= 7000 && peakYrs >= 3 ? 'HOLD CORE' : 'HOLD');
        const recCol = rec.includes('SELL') ? '#E74C3C' : rec.includes('BUY') ? '#2ECC71' : '#D4AF37';
        const initials = ((p.first_name||'?')[0] + (p.last_name||'?')[0]).toUpperCase();

        // Check roster context
        const S = window.S || {};
        const myRoster = (S.rosters || []).find(r => r.roster_id === S.myRosterId);
        const isOnMyTeam = myRoster?.players?.includes(pid);

        // Smart positioning: ensure card is fully visible
        const isMobile = typeof window !== 'undefined' && window.innerWidth < 440;
        const cardStyle = isMobile
            ? { position:'fixed', bottom:0, left:0, right:0, width:'100%', maxHeight:'85vh', overflowY:'auto', background:'#0a0b0d', border:'none', borderTop:'2px solid rgba(212,175,55,0.4)', borderRadius:'14px 14px 0 0', zIndex:250, boxShadow:'0 -12px 48px rgba(0,0,0,0.7)', animation:'wrFadeIn 0.2s ease' }
            : { position:'fixed', bottom:'80px', right:'24px', width:'360px', maxHeight:'calc(100vh - 100px)', overflowY:'auto', background:'#0a0b0d', border:'2px solid rgba(212,175,55,0.4)', borderRadius:'14px', zIndex:250, boxShadow:'0 12px 48px rgba(0,0,0,0.7)', animation:'wrFadeIn 0.2s ease' };

        return React.createElement('div', { style: cardStyle },
            // Header with photo
            React.createElement('div', { style:{ padding:'14px 16px', background:'linear-gradient(135deg, rgba(212,175,55,0.08), transparent)', borderBottom:'1px solid rgba(212,175,55,0.15)', display:'flex', gap:'12px', alignItems:'center' } },
                React.createElement('div', { className: 'wr-ring wr-ring-' + nPos, style:{ width:'48px', height:'48px', borderRadius:'10px', overflow:'hidden', background:'rgba(212,175,55,0.1)', border:'1px solid rgba(212,175,55,0.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 } },
                    React.createElement('img', { src:'https://sleepercdn.com/content/nfl/players/'+pid+'.jpg', style:{width:'48px',height:'48px',objectFit:'cover'}, onError:function(e){ e.target.style.display='none'; const s=document.createElement('span'); s.style.cssText='font-size:16px;font-weight:700;color:#D4AF37'; s.textContent=initials; e.target.after(s);; } })
                ),
                React.createElement('div', { style:{flex:1} },
                    React.createElement('div', { style:{ fontFamily:'Rajdhani, sans-serif', fontSize:'1.2rem', color: 'var(--text-primary)', letterSpacing:'0.02em' } }, name),
                    React.createElement('div', { style:{ fontSize:'0.78rem', color:'#D0D0D0' } }, nPos+' \u00B7 '+(p.team||'FA')+' \u00B7 Age '+(age||'?')+(p.college ? ' \u00B7 '+p.college : ''))
                ),
                React.createElement('button', { onClick:onClose, style:{ background:'none', border:'none', color: 'var(--text-muted)', cursor:'pointer', fontSize:'1.1rem', padding:'2px' } }, '\u2715')
            ),
            // Stats row
            React.createElement('div', { style:{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'4px', padding:'10px 16px', borderBottom:'1px solid rgba(255,255,255,0.06)' } },
                ...[
                    { val:dhq>0?dhq.toLocaleString():'\u2014', lbl:'DHQ', col:dhqCol, gauge:true },
                    { val:ppg||'\u2014', lbl:'PPG', col:ppg>=10?'#2ECC71':'#D0D0D0' },
                    { val:peakYrs>0?peakYrs+'yr':valueYrs+'yr', lbl:peakYrs>0?'PEAK':'VALUE', col:peakCol },
                    { val:rec, lbl:'ACTION', col:recCol }
                ].map(function(s,i){ var dhqFilled=s.gauge?Math.round(Math.min(10,dhq/1000)):0; var gCol=dhq>=7000?'filled-green':dhq>=4000?'filled':'filled-red'; return React.createElement('div', { key:i, style:{textAlign:'center'} },
                    React.createElement('div', { style:{ fontFamily:'JetBrains Mono, monospace', fontSize:'1rem', fontWeight:600, color:s.col } }, s.val),
                    s.gauge ? React.createElement('div', { className:'wr-gauge', style:{marginTop:'2px'} }, Array.from({length:10}, function(_,gi){ return React.createElement('div', { key:gi, className:'wr-gauge-seg'+(gi<dhqFilled?' '+gCol:'') }); })) : null,
                    React.createElement('div', { style:{ fontSize:'0.68rem', color: 'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' } }, s.lbl)
                ); })
            ),
            // Age curve visualization
            React.createElement('div', { style:{ padding:'8px 16px' } },
                React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' } },
                    React.createElement('div', { style:{ fontSize:'0.68rem', color: 'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', fontWeight:700 } }, 'Age Curve'),
                    React.createElement('div', { style:{ fontSize:'0.72rem', color:peakCol } }, peakLabel+' \u00B7 '+(peakYrs > 0 ? peakYrs+'yr peak left' : valueYrs > 0 ? valueYrs+'yr value left' : 'Past value window'))
                ),
                React.createElement('div', { style:{ display:'flex', height:'16px', borderRadius:'4px', overflow:'hidden', gap:'1px' } },
                    ...Array.from({length:17}, function(_,i){ var a=i+20; var col=a<pLo-3?'rgba(96,165,250,0.3)':a<pLo?'rgba(46,204,113,0.45)':(a>=pLo&&a<=pHi)?'rgba(46,204,113,0.75)':a<=declineHi?'rgba(212,175,55,0.45)':'rgba(231,76,60,0.35)'; return React.createElement('div', { key:a, style:{ flex:1, background:col, opacity:a===age?1:0.55, outline:a===age?'2px solid #D4AF37':'none', outlineOffset:'-1px', display:'flex', alignItems:'center', justifyContent:'center', fontSize:'0.6rem', fontWeight:700, color:a===age?'var(--text-primary)':'transparent' } }, a===age?String(age):''); })
                ),
                React.createElement('div', { style:{ display:'flex', justifyContent:'space-between', fontSize:'0.64rem', color: 'var(--text-muted)', marginTop:'2px' } },
                    React.createElement('span', null, '20'),
                    React.createElement('span', null, 'Peak '+pLo+'\u2013'+pHi),
                    React.createElement('span', null, '36')
                )
            ),
            // Recommendation line — Alex Ingram insight (persona-aware)
            React.createElement('div', { style:{ padding:'6px 12px', margin:'0 8px', background:'rgba(212,175,55,0.04)', borderLeft:'3px solid rgba(212,175,55,0.4)', borderRadius:'0 6px 6px 0', display:'flex', gap:'6px', alignItems:'flex-start' } },
                React.createElement('div', { style:{ width:'18px', height:'18px', borderRadius:'5px', background:'linear-gradient(135deg, #D4AF37, #B8941E)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, fontSize:'0.5rem', fontWeight:800, color:'#0A0A0A', fontFamily:'Rajdhani, sans-serif', marginTop:'2px' } }, 'AI'),
                React.createElement('div', { style:{ fontSize:'0.78rem', color:'#D0D0D0', lineHeight:1.5 } },
                    (() => {
                        const S = window.S || {};
                        const rosters = S.rosters || [];
                        const alexStyle = localStorage.getItem('wr_alex_style') || 'default';
                        // Count teams that need this position (only if player is on my team)
                        const needCount = isOnMyTeam ? rosters.filter(r => {
                            if (r.roster_id === S.myRosterId) return false;
                            const assess = typeof window.assessTeamFromGlobal === 'function' ? window.assessTeamFromGlobal(r.roster_id) : null;
                            return assess?.needs?.some(n => n.pos === nPos);
                        }).length : 0;

                        // Base insight
                        let insight = '';
                        if (isOnMyTeam && needCount >= 3) insight = needCount + ' teams need ' + nPos + ' \u2014 strong trade leverage.';
	                        else if (isOnMyTeam && valueYrs <= 1 && dhq >= 3000) insight = 'Sell window closing. Move before value drops.';
                        else if (!isOnMyTeam && peakYrs >= 5 && dhq < 4000) insight = 'Buy-low candidate \u2014 young with room to grow.';
                        else if (peakYrs >= 4) insight = 'Long dynasty window \u2014 cornerstone asset.';
                        else if (peakYrs >= 1) insight = 'In production window.';
	                        else insight = 'Past value window \u2014 value declining.';

                        // Persona flavor
                        const flavors = {
                            general: { sell: 'Execute the trade. No hesitation.', buy: 'Acquire this player. That\'s an order.', hold: 'Hold the line. Don\'t get sentimental.' },
                            enthusiast: { sell: 'Cash in NOW while you can! This is exciting!', buy: 'OH MAN you gotta get this guy!', hold: 'Love this player! Keep building around them!' },
                            bayou: { sell: 'Time to let this one swim downstream, cher.', buy: 'Go get \'em before someone else does, ya hear?', hold: 'This one\'s a keeper. Don\'t nobody touch \'em.' },
                            wit: { sell: 'Your leaguemates still think he\'s worth something. Exploit that.', buy: 'Undervalued. Their loss, your gain.', hold: 'Solid. Try not to overthink it.' },
                            closer: { sell: 'Sell. Now. Done.', buy: 'Get it done. Close.', hold: 'Hold. Period.' },
                            strategist: { sell: 'Optimal exit point. Maximize return on declining asset.', buy: 'Favorable risk-reward profile. Recommend acquisition.', hold: 'Asset performing within expected parameters. Maintain position.' },
                        };
                        const f = flavors[alexStyle];
                        if (f) {
                            const isSell = rec.includes('SELL');
                            const isBuy = rec.includes('BUY');
                            insight += ' ' + (isSell ? f.sell : isBuy ? f.buy : f.hold);
                        }
                        return insight;
                    })(),
                    trend >= 20 ? ' Trending up '+trend+'%.' : trend <= -15 ? ' Production down '+Math.abs(trend)+'%.' : ''
                )
            ),
            // Action buttons
            React.createElement('div', { style:{ padding:'10px 16px', display:'flex', gap:'6px', borderTop:'1px solid rgba(255,255,255,0.06)' } },
                React.createElement('button', { onClick:onFullProfile, style:{ flex:1, padding:'8px', background:'#D4AF37', color:'#0A0A0A', border:'none', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'0.9rem', cursor:'pointer' } }, 'FULL PROFILE'),
                React.createElement('button', { onClick:onClose, style:{ padding:'8px 14px', background:'transparent', border:'1px solid rgba(212,175,55,0.3)', color:'#D4AF37', borderRadius:'6px', fontFamily:'Rajdhani, sans-serif', fontSize:'0.9rem', cursor:'pointer' } }, 'CLOSE')
            )
        );
    }

    // ===== GLOBAL UI COMPONENTS =====
    function Tip({ children }) {
        const [open, setOpen] = React.useState(false);
        const ref = React.useRef(null);

        React.useEffect(() => {
            if (!open) return;
            const close = () => setOpen(false);
            setTimeout(() => document.addEventListener('click', close), 10);
            return () => document.removeEventListener('click', close);
        }, [open]);

        return React.createElement('span', { ref: ref, style: { position: 'relative', display: 'inline-flex' } },
            React.createElement('span', {
                className: 'wr-tip-icon',
                onClick: function(e) { e.stopPropagation(); setOpen(!open); },
                onMouseEnter: function() { setOpen(true); },
            }, '?'),
            open ? React.createElement('div', {
                className: 'wr-tip-box show',
                onClick: function(e) { e.stopPropagation(); },
                onMouseEnter: function() { setOpen(true); },
                onMouseLeave: function() { setTimeout(function() { setOpen(false); }, 2000); },
                style: { position: 'fixed', top: (ref.current?.getBoundingClientRect()?.bottom || 0) + 6 + 'px', left: Math.min(ref.current?.getBoundingClientRect()?.left || 0, window.innerWidth - 240) + 'px', width: '220px', zIndex: 9999, whiteSpace: 'normal' }
            }, children) : null
        );
    }

    // ===== ALEX INGRAM AVATAR SYSTEM =====
    const ALEX_AVATARS = [
        { id: 'badge', label: 'Gold Badge', src: null },
        { id: 'exec', label: 'The Executive', src: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&crop=face' },
        { id: 'analyst', label: 'The Analyst', src: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=120&h=120&fit=crop&crop=face' },
        { id: 'coach', label: 'The Coach', src: 'https://images.unsplash.com/photo-1560250097-0b93528c311a?w=120&h=120&fit=crop&crop=face' },
        { id: 'scout', label: 'The Scout', src: 'https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=120&h=120&fit=crop&crop=face' },
    ];
    function getAlexAvatar() {
        return ComponentsStorage.get(COMPONENTS_WR_KEYS.ALEX_AVATAR, 'badge') || 'badge';
    }
    function setAlexAvatar(id) {
        ComponentsStorage.set(COMPONENTS_WR_KEYS.ALEX_AVATAR, id);
    }
    function AlexAvatar({ size }) {
        const sz = size || 28;
        const av = ALEX_AVATARS.find(a => a.id === getAlexAvatar());
        if (av && av.src) {
            return React.createElement('img', { src: av.src, alt: 'Alex', style: { width: sz+'px', height: sz+'px', borderRadius: sz > 24 ? '8px' : '6px', objectFit: 'cover', flexShrink: 0, border: '2px solid rgba(212,175,55,0.4)' } });
        }
        return React.createElement('div', { style: { width: sz+'px', height: sz+'px', borderRadius: sz > 24 ? '8px' : '6px', background: 'linear-gradient(135deg, #D4AF37, #B8941E)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: (sz * 0.024) + 'rem', fontWeight: 800, color: '#0A0A0A', fontFamily: 'Rajdhani, sans-serif' } }, 'AI');
    }
    window.AlexAvatar = AlexAvatar;
    window.ALEX_AVATARS = ALEX_AVATARS;

    // ===== ALEX INGRAM — AI GM MESSAGE COMPONENT (Slack-style) =====
    function GMMessage({ children, timestamp, compact, title }) {
        const now = timestamp || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        if (compact) {
            return React.createElement('div', { style: {
                display: 'flex', gap: '8px', alignItems: 'flex-start', padding: '4px 10px',
                background: 'rgba(212,175,55,0.04)', borderRadius: '8px', marginBottom: '6px',
                border: '1px solid rgba(212,175,55,0.1)'
            }},
                React.createElement(AlexAvatar, { size: 20 }),
                React.createElement('div', { style: { flex: 1 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '1px' } },
                        React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.72rem', color: 'var(--gold)', letterSpacing: '0.03em' } }, 'Alex Ingram')
                    ),
                    React.createElement('div', { style: { fontSize: '0.78rem', color: 'var(--silver)', lineHeight: 1.4 } }, children)
                )
            );
        }
        return React.createElement('div', { style: {
            background: 'rgba(212,175,55,0.03)', border: '1px solid rgba(212,175,55,0.12)',
            borderRadius: '8px', padding: '10px 14px', marginBottom: '8px'
        }},
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } },
                React.createElement(AlexAvatar, { size: 28 }),
                React.createElement('div', { style: { flex: 1 } },
                    React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                        React.createElement('span', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '0.86rem', color: 'var(--gold)', letterSpacing: '0.03em' } }, 'Alex Ingram')
                    ),
                    React.createElement('span', { style: { fontSize: '0.6rem', color: 'var(--silver)', opacity: 0.35 } }, now)
                )
            ),
            title && React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: '0.78rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' } }, title),
            React.createElement('div', { style: { fontSize: '0.82rem', color: '#D0D0D0', lineHeight: 1.4 } }, children)
        );
    }
    window.GMMessage = GMMessage;

    // ===== INLINE CAREER STATS (for expanded player card) =====
    function InlineCareerStats({ pid, pos, player, scoringSettings, statsData }) {
        const [html, setHtml] = React.useState(null);
        const [collegeHtml, setCollegeHtml] = React.useState(null);
        const [loading, setLoading] = React.useState(true);
        React.useEffect(() => {
            let cancelled = false;
            const sc = scoringSettings || {};
            const curYear = parseInt(window.S?.season) || new Date().getFullYear();
            const exp = player?.years_exp || 0;

            // Check for college stats first
            if (typeof window.buildCollegeStatsTable === 'function') {
                const cHtml = window.buildCollegeStatsTable(pid);
                if (cHtml) setCollegeHtml(cHtml);
            }

            // Show immediate data from statsData while fetching career
            const quickData = {};
            const st = statsData?.[pid];
            if (st && Object.keys(st).length > 1) quickData[curYear] = st;

            if (typeof window.fwBuildCareerTable === 'function' && Object.keys(quickData).length) {
                setHtml(window.fwBuildCareerTable(pid, quickData, pos, sc, player));
                setLoading(false);
            }

            // Fetch full career in background
            if (typeof window.fwFetchCareerStats === 'function') {
                window.fwFetchCareerStats(pid, curYear, exp).then(careerData => {
                    if (cancelled) return;
                    if (Object.keys(careerData).length && typeof window.fwBuildCareerTable === 'function') {
                        setHtml(window.fwBuildCareerTable(pid, careerData, pos, sc, player));
                    }
                    setLoading(false);
                }).catch(() => setLoading(false));
            } else {
                setLoading(false);
            }
            return () => { cancelled = true; };
        }, [pid]);

        const collegeData = window.COLLEGE_STATS?.[pid];
        const sections = [];

        // College stats section
        if (collegeHtml) {
            sections.push(React.createElement('div', { key: 'college', style: { marginBottom: html ? '14px' : 0 } },
                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' } },
                    'College Stats',
                    collegeData && React.createElement('span', { style: { fontSize: '0.64rem', color: 'var(--silver)', opacity: 0.5, textTransform: 'none', fontFamily: 'inherit', letterSpacing: 0 } }, collegeData.school + ' \u00B7 ' + collegeData.conf + ' \u00B7 ' + collegeData.years)
                ),
                React.createElement('div', { dangerouslySetInnerHTML: { __html: collegeHtml }, style: { fontSize: '13px' } })
            ));
        }

        // NFL stats section — skip for rookies (no NFL production yet)
        const isRookie = (player?.years_exp || 0) === 0;
        if (html && !isRookie) {
            sections.push(React.createElement('div', { key: 'nfl' },
                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } }, 'NFL Stats'),
                React.createElement('div', { dangerouslySetInnerHTML: { __html: html }, style: { fontSize: '13px' } })
            ));
        } else if (loading && !isRookie) {
            sections.push(React.createElement('div', { key: 'loading', style: { fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.5 } }, 'Loading stats...'));
        }

        if (!sections.length) {
            sections.push(React.createElement('div', { key: 'empty' },
                React.createElement('div', { style: { fontFamily: 'var(--font-body)', fontSize: '0.7rem', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' } }, 'Career Stats'),
                React.createElement('div', { style: { fontSize: '0.76rem', color: 'var(--silver)', opacity: 0.5 } }, 'No stats available')
            ));
        }

        return React.createElement('div', { style: { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px' } }, ...sections);
    }

    function SkeletonRows({ count, cols }) {
        const rows = [];
        for (let i = 0; i < (count||6); i++) {
            rows.push(React.createElement('div', { key:i, className:'skel-row' },
                React.createElement('div', { className:'skel skel-circle' }),
                React.createElement('div', { style:{flex:1} },
                    React.createElement('div', { className:'skel skel-line', style:{width:(60+Math.random()*30)+'%'} })
                ),
                React.createElement('div', { className:'skel skel-line', style:{width:'50px',marginBottom:0} })
            ));
        }
        return React.createElement('div', null, rows);
    }

    function SkeletonKPI() {
        return React.createElement('div', { className:'skel-card', style:{textAlign:'center',minWidth:'120px'} },
            React.createElement('div', { className:'skel skel-line', style:{width:'60%',margin:'0 auto 8px'} }),
            React.createElement('div', { className:'skel skel-line', style:{width:'40%',height:'24px',margin:'0 auto 6px'} }),
            React.createElement('div', { className:'skel skel-line', style:{width:'50%',margin:'0 auto'} })
        );
    }

    // ===== CONTEXTUAL AI ANNOTATION ENGINE =====
    // Pre-computed insights from DHQ data — no API calls needed.
    // Returns short text annotations for roster, matchup, and analytics views.
    function getPlayerAnnotation(pid) {
        const LI = window.App?.LI || {};
        const meta = LI.playerMeta?.[pid];
        const dhq = LI.playerScores?.[pid] || 0;
        if (!meta || !dhq) return null;
        const age = meta.age || 0;
        const pos = meta.pos || '';
        const curve = typeof window.App?.getAgeCurve === 'function'
            ? window.App.getAgeCurve(pos)
            : { build: [22, 24], peak: (window.App.peakWindows || {})[pos] || [24, 29], decline: [30, 32] };
        const [pLo, pHi] = curve.peak;
        const declineHi = curve.decline[1];
        const peakYrsLeft = meta.peakYrsLeft || Math.max(0, pHi - age);
        const valueYrsLeft = Math.max(0, declineHi - age);
        const trend = meta.trend || 0;

        if (age > declineHi && dhq >= 2000) return { text: 'Sell high \u2014 past value window', color: '#E74C3C', rec: 'SELL' };
        if (age > pHi && age <= declineHi && dhq >= 3000 && trend <= -10) return { text: 'Veteran decline band \u2014 monitor closely', color: '#F0A500', rec: 'HOLD' };
        if (peakYrsLeft >= 5 && dhq >= 3000) return { text: peakYrsLeft + ' peak yrs ahead \u2014 cornerstone', color: '#2ECC71', rec: 'HOLD' };
        if (peakYrsLeft >= 3 && trend >= 15) return { text: 'Breakout trajectory +' + trend + '%', color: '#2ECC71', rec: 'HOLD' };
        if (age >= pLo && age <= pHi && dhq >= 5000) return { text: 'Prime window \u2014 maximize now', color: 'var(--gold)', rec: 'HOLD' };
        if (valueYrsLeft <= 1 && dhq >= 2000) return { text: 'Window closing \u2014 sell or ride', color: '#F0A500', rec: 'HOLD' };
        return null;
    }

    function getMatchupAnnotation(myPPG, oppPPG, pos) {
        const diff = myPPG - oppPPG;
        if (diff > 5) return { text: 'Strong edge +' + diff.toFixed(1), color: '#2ECC71' };
        if (diff > 2) return { text: 'Slight edge', color: '#2ECC71' };
        if (diff < -5) return { text: 'Vulnerable \u2014 ' + diff.toFixed(1), color: '#E74C3C' };
        if (diff < -2) return { text: 'Disadvantage', color: '#E74C3C' };
        return { text: 'Even matchup', color: 'var(--silver)' };
    }

    function getKpiAnnotation(kpiKey, value) {
        const LI = window.App?.LI || {};
        const S = window.App?.S || window.S || {};
        const scores = LI.playerScores || {};
        const rosters = S.rosters || [];
        if (!rosters.length) return '';

        const myTotal = (rosters.find(r => r.roster_id === S.myRosterId)?.players || []).reduce((s, pid) => s + (scores[pid] || 0), 0);
        const avgTotal = rosters.reduce((s, r) => s + (r.players || []).reduce((ps, pid) => ps + (scores[pid] || 0), 0), 0) / rosters.length;

        if (kpiKey === 'portfolio' || kpiKey === 'value-rank') {
            const pct = avgTotal > 0 ? Math.round((myTotal - avgTotal) / avgTotal * 100) : 0;
            return pct > 0 ? '\u2191 ' + pct + '% above league avg' : pct < 0 ? '\u2193 ' + Math.abs(pct) + '% below league avg' : '\u2192 At league average';
        }
        if (kpiKey === 'health-score') {
            const v = parseInt(value) || 0;
            return v >= 85 ? '\u2191 Championship caliber' : v >= 70 ? '\u2192 Playoff contender' : v >= 55 ? '\u2193 Work to do' : '\u2193 Rebuild mode';
        }
        if (kpiKey === 'aging-cliff') {
            const v = parseInt(value) || 0;
            return v > 30 ? '\u26A0 High risk \u2014 sell aging assets' : v > 15 ? '\u2192 Moderate \u2014 monitor closely' : '\u2191 Sustainable roster age';
        }
        return '';
    }
    window.getPlayerAnnotation = getPlayerAnnotation;
    window.getMatchupAnnotation = getMatchupAnnotation;
    window.getKpiAnnotation = getKpiAnnotation;

    // Error Boundary — catches render crashes and shows recovery UI
    class ErrorBoundary extends React.Component {
        constructor(props) {
            super(props);
            this.state = { hasError: false, error: null };
        }
        static getDerivedStateFromError(error) {
            return { hasError: true, error };
        }
        componentDidCatch(error, info) {
            console.error('[War Room] Render crash:', error, info.componentStack);
        }
        render() {
            if (this.state.hasError) {
                return React.createElement('div', {
                    style: {
                        padding: '40px 20px', textAlign: 'center', maxWidth: '500px',
                        margin: '80px auto', background: 'var(--black)', border: '1px solid rgba(231,76,60,0.3)',
                        borderRadius: '10px'
                    }
                },
                    React.createElement('div', { style: { fontSize: '2rem', marginBottom: '12px' } }, '\u26A0\uFE0F'),
                    React.createElement('div', { style: { fontFamily: 'Rajdhani, sans-serif', fontSize: '1.4rem', color: 'var(--white)', marginBottom: '8px' } }, 'Something went wrong'),
                    React.createElement('div', { style: { fontSize: '0.82rem', color: 'var(--silver)', lineHeight: 1.6, marginBottom: '16px' } },
                        'War Room encountered an error. This usually fixes itself on reload.'),
                    React.createElement('button', {
                        onClick: () => { this.setState({ hasError: false, error: null }); },
                        style: { padding: '10px 24px', background: 'var(--gold)', color: 'var(--black)', border: 'none', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '1rem', cursor: 'pointer', marginRight: '8px' }
                    }, 'Try Again'),
                    React.createElement('button', {
                        onClick: () => window.location.reload(),
                        style: { padding: '10px 24px', background: 'transparent', color: 'var(--gold)', border: '1px solid rgba(212,175,55,0.3)', borderRadius: '6px', fontFamily: 'var(--font-body)', fontSize: '1rem', cursor: 'pointer' }
                    }, 'Reload Page'),
                    React.createElement('div', { style: { fontSize: '0.72rem', color: 'var(--silver)', opacity: 0.5, marginTop: '12px' } },
                        String(this.state.error?.message || '').substring(0, 100))
                );
            }
            return this.props.children;
        }
    }
    window.ErrorBoundary = ErrorBoundary;

    function TradeFinderTab({ allRosters, myRosterId, assessments, ownerDna, playersData, picksByOwner, getPlayerValue, getPickValue, calcOwnerPosture, calcPsychTaxes, calcAcceptanceLikelihood, DNA_TYPES, autoTarget, onAutoTargetConsumed }) {
        const [finderMode, setFinderMode] = React.useState('my');
        const [finderAsset, setFinderAsset] = React.useState(null);
        const [finderResults, setFinderResults] = React.useState(null);
        const autoTargetRef = React.useRef(false);

        const myPlayers = React.useMemo(() => (allRosters.find(r => r.roster_id === myRosterId)?.players || [])
            .map(pid => ({ pid, name: playersData[pid]?.full_name || pid, pos: playersData[pid]?.position || '?', val: getPlayerValue(pid).value }))
            .filter(p => p.val > 0).sort((a,b) => b.val - a.val), [allRosters, playersData]);

        const allLeaguePlayers = React.useMemo(() => {
            const list = [];
            allRosters.forEach(r => { if (r.roster_id === myRosterId) return; (r.players || []).forEach(pid => { const p = playersData[pid]; if (!p) return; const val = getPlayerValue(pid).value; if (val > 0) list.push({ pid, name: p.full_name || pid, pos: p.position || '?', val, rosterId: r.roster_id }); }); });
            return list.sort((a,b) => b.val - a.val);
        }, [allRosters, playersData]);

        function generateTrades(pid, mode) {
            const val = getPlayerValue(pid).value;
            if (!val) { setFinderResults([]); return; }
            const tolerance = 0.20, minVal = val*(1-tolerance), maxVal = val*(1+tolerance);
            const myAssess = assessments.find(a => a.rosterId === myRosterId);
            const results = [];

            if (mode === 'my') {
                allRosters.forEach(r => {
                    if (r.roster_id === myRosterId) return;
                    const ta = assessments.find(a => a.rosterId === r.roster_id); if (!ta) return;
                    const dk = ownerDna[ta.ownerId] || 'NONE';
                    const tp = calcOwnerPosture(ta, dk);
                    const theirP = (r.players||[]).map(p=>({pid:p,val:getPlayerValue(p).value})).filter(p=>p.val>0).sort((a,b)=>b.val-a.val);
                    const trades = [];
                    // 1-for-1
                    theirP.forEach(tp2 => { if (tp2.val >= minVal && tp2.val <= maxVal) { const taxes = calcPsychTaxes(myAssess,ta,dk,tp); const lk = calcAcceptanceLikelihood(val,tp2.val,dk,taxes,myAssess,ta); trades.push({give:[{pid,val}],receive:[{pid:tp2.pid,val:tp2.val}],givePicks:[],receivePicks:[],diff:tp2.val-val,likelihood:lk,type:'1-for-1'}); }});
                    // 2-for-1
                    for(let i=0;i<Math.min(theirP.length,12);i++){for(let j=i+1;j<Math.min(theirP.length,12);j++){const c=theirP[i].val+theirP[j].val;if(c>=minVal&&c<=maxVal){const taxes=calcPsychTaxes(myAssess,ta,dk,tp);const lk=calcAcceptanceLikelihood(val,c,dk,taxes,myAssess,ta);trades.push({give:[{pid,val}],receive:[{pid:theirP[i].pid,val:theirP[i].val},{pid:theirP[j].pid,val:theirP[j].val}],givePicks:[],receivePicks:[],diff:c-val,likelihood:lk,type:'2-for-1'});break;}}}
                    // Player + pick
                    const theirPicks = picksByOwner[ta.ownerId]||[];
                    theirP.slice(0,8).forEach(tp2=>{if(tp2.val>=val)return;const gap=val-tp2.val;const bp=theirPicks.find(pk=>{const pv=getPickValue(pk.year||pk.season,pk.round,allRosters.length);return Math.abs(pv-gap)<=val*tolerance;});if(bp){const pv=getPickValue(bp.year||bp.season,bp.round,allRosters.length);const total=tp2.val+pv;const taxes=calcPsychTaxes(myAssess,ta,dk,tp);const lk=calcAcceptanceLikelihood(val,total,dk,taxes,myAssess,ta);trades.push({give:[{pid,val}],receive:[{pid:tp2.pid,val:tp2.val}],givePicks:[],receivePicks:[{...bp,val:pv}],diff:total-val,likelihood:lk,type:'Player + Pick'});}});
                    trades.sort((a,b)=>b.likelihood-a.likelihood);
                    if(trades.length) results.push({team:ta,dnaKey:dk,trades:trades.slice(0,3)});
                });
            } else {
                const ownerR = allRosters.find(r=>(r.players||[]).includes(pid));
                if(!ownerR){setFinderResults([]);return;}
                const ta=assessments.find(a=>a.rosterId===ownerR.roster_id);if(!ta){setFinderResults([]);return;}
                const dk=ownerDna[ta.ownerId]||'NONE';const tp=calcOwnerPosture(ta,dk);
                const myR=allRosters.find(r=>r.roster_id===myRosterId);
                const myP2=(myR?.players||[]).filter(p=>p!==pid).map(p=>({pid:p,val:getPlayerValue(p).value})).filter(p=>p.val>0).sort((a,b)=>b.val-a.val);
                const trades=[];
                myP2.forEach(mp=>{if(mp.val>=minVal&&mp.val<=maxVal){const taxes=calcPsychTaxes(myAssess,ta,dk,tp);const lk=calcAcceptanceLikelihood(mp.val,val,dk,taxes,myAssess,ta);trades.push({give:[{pid:mp.pid,val:mp.val}],receive:[{pid,val}],givePicks:[],receivePicks:[],diff:val-mp.val,likelihood:lk,type:'1-for-1'});}});
                for(let i=0;i<Math.min(myP2.length,12);i++){for(let j=i+1;j<Math.min(myP2.length,12);j++){const c=myP2[i].val+myP2[j].val;if(c>=minVal&&c<=maxVal){const taxes=calcPsychTaxes(myAssess,ta,dk,tp);const lk=calcAcceptanceLikelihood(c,val,dk,taxes,myAssess,ta);trades.push({give:[{pid:myP2[i].pid,val:myP2[i].val},{pid:myP2[j].pid,val:myP2[j].val}],receive:[{pid,val}],givePicks:[],receivePicks:[],diff:val-c,likelihood:lk,type:'2-for-1'});break;}}}
                trades.sort((a,b)=>b.likelihood-a.likelihood);
                if(trades.length) results.push({team:ta,dnaKey:dk,trades:trades.slice(0,3)});
            }
            results.sort((a,b)=>Math.max(...b.trades.map(t=>t.likelihood))-Math.max(...a.trades.map(t=>t.likelihood)));
            setFinderResults(results);
            const targetName = playersData[pid]?.full_name || pid;
            window.wrLogAction?.('\uD83D\uDD0D', 'Ran trade finder targeting ' + targetName, 'trade', { players: [{ name: targetName, pid: pid }], actionType: 'trade-finder' });
        }

        // Auto-target from GENERATE TRADES button in Intelligence Briefing
        React.useEffect(() => {
            if (autoTarget && !autoTargetRef.current) {
                autoTargetRef.current = true;
                setFinderMode(autoTarget.mode || 'acquire');
                setFinderAsset(autoTarget.pid);
                setFinderResults(null);
                setTimeout(() => { generateTrades(autoTarget.pid, autoTarget.mode || 'acquire'); if (onAutoTargetConsumed) onAutoTargetConsumed(); }, 50);
            } else if (!autoTarget) { autoTargetRef.current = false; }
        }, [autoTarget]);

        const pName=pid=>playersData[pid]?.full_name||pid;
        const pPos=pid=>playersData[pid]?.position||'?';

        // Time Context awareness
        const currentSeason = parseInt(window.S?.season) || new Date().getFullYear();
        const baseSeason = parseInt(window.App?.LI?._baseScoresBackup ? Object.keys(window.App.LI._baseScoresBackup).length > 0 ? currentSeason : currentSeason : currentSeason);
        const isProjected = !!window.App?.LI?._projectedYear;
        const evalYear = window.App?.LI?._projectedYear || currentSeason;

        // Multi-year value calculator
        function getMultiYearDelta(tradeObj) {
            if (!window.App?.LI?._baseScoresBackup) return null;
            const baseScores = window.App.LI._baseScoresBackup;
            const results = [];
            for (let delta = 0; delta <= 2; delta++) {
                const yr = currentSeason + delta;
                let giveVal = 0, getVal = 0;
                tradeObj.give.forEach(p => {
                    const base = baseScores[p.pid] || p.val;
                    const proj = typeof projectPlayerValue === 'function' ? projectPlayerValue(p.pid, base, playersData[p.pid]?.age, playersData[p.pid]?.position || '', delta) : base;
                    giveVal += proj;
                });
                tradeObj.receive.forEach(p => {
                    const base = baseScores[p.pid] || p.val;
                    const proj = typeof projectPlayerValue === 'function' ? projectPlayerValue(p.pid, base, playersData[p.pid]?.age, playersData[p.pid]?.position || '', delta) : base;
                    getVal += proj;
                });
                results.push({ year: yr, diff: getVal - giveVal });
            }
            return results;
        }

        // Window impact
        function getWindowImpact(tradeObj) {
            const givePeakTotal = tradeObj.give.reduce((s, p) => {
                const age = playersData[p.pid]?.age || 25;
                const pos = playersData[p.pid]?.position || '';
                const end = typeof window.App?.getValueWindowEnd === 'function' ? window.App.getValueWindowEnd(pos) : ((window.App.peakWindows || {})[pos] || [24, 29])[1];
                return s + Math.max(0, end - age);
            }, 0);
            const getPeakTotal = tradeObj.receive.reduce((s, p) => {
                const age = playersData[p.pid]?.age || 25;
                const pos = playersData[p.pid]?.position || '';
                const end = typeof window.App?.getValueWindowEnd === 'function' ? window.App.getValueWindowEnd(pos) : ((window.App.peakWindows || {})[pos] || [24, 29])[1];
                return s + Math.max(0, end - age);
            }, 0);
            const peakDelta = getPeakTotal - givePeakTotal;
            if (peakDelta >= 3) return { label: 'Extends window', icon: '\u2191', col: '#2ECC71' };
            if (peakDelta <= -3) return { label: 'Shortens window', icon: '\u2193', col: '#E74C3C' };
            return { label: 'Window neutral', icon: '\u2192', col: 'var(--silver)' };
        }

        return React.createElement('div', null,
            // Time context banner
            isProjected ? React.createElement('div', { style:{fontSize:'0.76rem',color:'#3498DB',background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:'6px',padding:'6px 12px',marginBottom:'10px',display:'flex',alignItems:'center',gap:'6px'} },
                React.createElement('span', null, 'Evaluated in '+evalYear+' (Projected Values)'),
            ) : null,
            React.createElement('div', {style:{fontSize:'0.78rem',color:'var(--silver)',opacity:0.65,marginBottom:'0.75rem',lineHeight:1.5}}, 'Select any player to generate trade proposals. Shows offers within 20% value variance ranked by acceptance likelihood. ', React.createElement(Tip, null, 'Builds 1-for-1, 2-for-1, and player+pick combos. Acceptance % uses DNA type, psychological taxes, and trade posture.')),
            React.createElement('div', {style:{display:'flex',gap:'0.5rem',marginBottom:'1rem'}},
                React.createElement('button', {onClick:()=>{setFinderMode('my');setFinderAsset(null);setFinderResults(null);},style:{padding:'7px 16px',fontSize:'0.78rem',fontFamily: 'var(--font-body)',textTransform:'uppercase',background:finderMode==='my'?'var(--gold)':'rgba(255,255,255,0.04)',color:finderMode==='my'?'var(--black)':'var(--silver)',border:'1px solid '+(finderMode==='my'?'var(--gold)':'rgba(255,255,255,0.08)'),borderRadius:'4px',cursor:'pointer'}}, 'Trade My Player'),
                React.createElement('button', {onClick:()=>{setFinderMode('acquire');setFinderAsset(null);setFinderResults(null);},style:{padding:'7px 16px',fontSize:'0.78rem',fontFamily: 'var(--font-body)',textTransform:'uppercase',background:finderMode==='acquire'?'var(--gold)':'rgba(255,255,255,0.04)',color:finderMode==='acquire'?'var(--black)':'var(--silver)',border:'1px solid '+(finderMode==='acquire'?'var(--gold)':'rgba(255,255,255,0.08)'),borderRadius:'4px',cursor:'pointer'}}, 'Acquire a Player')
            ),
            React.createElement('div', {style:{fontSize:'0.74rem',color:'var(--gold)',textTransform:'uppercase',marginBottom:'0.3rem',fontWeight:700}}, finderMode==='my'?'Select your player to shop':'Select a player to acquire'),
            React.createElement('div', {style:{display:'flex',flexWrap:'wrap',gap:'0.35rem',maxHeight:'200px',overflowY:'auto',marginBottom:'1rem',padding:'10px',background:'rgba(255,255,255,0.02)',borderRadius:'8px',border:'1px solid rgba(212,175,55,0.12)'}},
                ...(finderMode==='my'?myPlayers:allLeaguePlayers).slice(0,60).map(p=>
                    React.createElement('button', {key:p.pid, onClick:()=>{setFinderAsset(p.pid);setFinderResults(null);generateTrades(p.pid,finderMode);}, style:{padding:'5px 12px',fontSize:'0.74rem',fontFamily: 'var(--font-body)',borderRadius:'4px',cursor:'pointer',background:finderAsset===p.pid?'var(--gold)':'rgba(255,255,255,0.04)',color:finderAsset===p.pid?'var(--black)':'var(--silver)',border:'1px solid '+(finderAsset===p.pid?'var(--gold)':'rgba(255,255,255,0.06)')}}, p.name+' '+p.val.toLocaleString())
                )
            ),
            finderResults && !finderResults.length ? React.createElement('div', {style:{color:'var(--silver)',fontSize:'0.82rem',textAlign:'center',padding:'2rem'}}, 'No viable trades found within 20% value variance.') : null,
            finderResults ? finderResults.map((r,ri) =>
                React.createElement('div', {key:ri, style:{marginBottom:'1.25rem'}, className:'wr-fade-in'},
                    React.createElement('div', {style:{display:'flex',alignItems:'center',gap:'0.5rem',marginBottom:'0.5rem',paddingBottom:'0.4rem',borderBottom:'1px solid rgba(212,175,55,0.15)'}},
                        React.createElement('span', {style:{fontFamily:'Rajdhani, sans-serif',fontSize:'1rem',color:'var(--white)'}}, r.team.ownerName),
                        React.createElement('span', {style:{fontSize:'0.72rem',color:'var(--silver)',opacity:0.65}}, r.team.teamName),
                        React.createElement('span', {style:{fontSize:'0.7rem',fontWeight:700,color:r.team.tierColor,background:r.team.tierBg,padding:'0.15rem 0.4rem',borderRadius:'3px'}}, r.team.tier),
                        r.dnaKey!=='NONE'?React.createElement('span', {style:{fontSize:'0.7rem',color:(DNA_TYPES[r.dnaKey]||{}).color,fontWeight:700}}, (DNA_TYPES[r.dnaKey]||{}).label):null
                    ),
                    ...r.trades.map((t,ti) => {
                        const giveT=t.give.reduce((s,p)=>s+p.val,0)+t.givePicks.reduce((s,p)=>s+(p.val||0),0);
                        const getT=t.receive.reduce((s,p)=>s+p.val,0)+t.receivePicks.reduce((s,p)=>s+(p.val||0),0);
                        return React.createElement('div', {key:ti, style:{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(212,175,55,0.15)',borderRadius:'8px',padding:'0.75rem',marginBottom:'0.5rem'}},
                            React.createElement('div', {style:{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'0.5rem'}},
                                React.createElement('span', {style:{fontSize:'0.74rem',color:'var(--gold)',fontWeight:700,textTransform:'uppercase'}}, t.type),
                                React.createElement('div', {style:{display:'flex',gap:'0.5rem',alignItems:'center'}},
                                    React.createElement('span', {style:{fontSize:'0.74rem',color:t.diff>=0?'var(--win-green)':'var(--loss-red)'}}, (t.diff>=0?'You gain ':'You give ')+Math.abs(Math.round(t.diff)).toLocaleString()+' DHQ'),
                                    React.createElement('span', {style:{fontSize:'0.78rem',fontWeight:700,color:t.likelihood>=60?'var(--win-green)':t.likelihood>=40?'#F0A500':'var(--loss-red)',background:(t.likelihood>=60?'rgba(46,204,113,0.1)':t.likelihood>=40?'rgba(240,165,0,0.1)':'rgba(231,76,60,0.1)'),padding:'0.15rem 0.5rem',borderRadius:'4px'}}, Math.round(t.likelihood)+'%')
                                )
                            ),
                            React.createElement('div', {style:{display:'grid',gridTemplateColumns:'1fr auto 1fr',gap:'0.5rem',alignItems:'start'}},
                                React.createElement('div', null,
                                    React.createElement('div', {style:{fontSize:'0.7rem',color:'var(--loss-red)',textTransform:'uppercase',marginBottom:'0.25rem',fontWeight:700}}, 'Send ('+giveT.toLocaleString()+')'),
                                    ...t.give.map(p=>React.createElement('div', {key:p.pid,style:{fontSize:'0.78rem',color:'var(--white)',fontWeight:600}}, pName(p.pid), React.createElement('span', {style:{color:'var(--silver)',fontSize:'0.72rem',marginLeft:'4px'}}, pPos(p.pid)+' '+p.val.toLocaleString()))),
                                    ...t.givePicks.map((pk,i)=>React.createElement('div', {key:'gp'+i,style:{fontSize:'0.78rem',color:'var(--gold)',fontWeight:600}}, (pk.year||pk.season)+' R'+pk.round))
                                ),
                                React.createElement('div', {style:{fontSize:'1.1rem',color:'var(--gold)',alignSelf:'center',fontWeight:700}}, '\u21C4'),
                                React.createElement('div', null,
                                    React.createElement('div', {style:{fontSize:'0.7rem',color:'var(--win-green)',textTransform:'uppercase',marginBottom:'0.25rem',fontWeight:700}}, 'Get ('+getT.toLocaleString()+')'),
                                    ...t.receive.map(p=>React.createElement('div', {key:p.pid,style:{fontSize:'0.78rem',color:'var(--white)',fontWeight:600}}, pName(p.pid), React.createElement('span', {style:{color:'var(--silver)',fontSize:'0.72rem',marginLeft:'4px'}}, pPos(p.pid)+' '+p.val.toLocaleString()))),
                                    ...t.receivePicks.map((pk,i)=>React.createElement('div', {key:'rp'+i,style:{fontSize:'0.78rem',color:'var(--gold)',fontWeight:600}}, (pk.year||pk.season)+' R'+pk.round))
                                )
                            ),
                            // Multi-year delta + window impact
                            (() => {
                                const multiYear = getMultiYearDelta(t);
                                const winImpact = getWindowImpact(t);
                                if (!multiYear) return null;
                                return React.createElement('div', {style:{display:'flex',gap:'10px',alignItems:'center',marginTop:'8px',paddingTop:'8px',borderTop:'1px solid rgba(255,255,255,0.04)',flexWrap:'wrap'}},
                                    // Multi-year trend
                                    ...multiYear.map((yr,yi) => React.createElement('span', {key:yi, style:{fontSize:'0.72rem',color:yr.diff>=0?'#2ECC71':'#E74C3C',fontWeight:600}},
                                        (yr.diff>=0?'+':'')+Math.round(yr.diff).toLocaleString()+' ('+yr.year+')'
                                    )),
                                    // Trend arrow
                                    React.createElement('span', {style:{fontSize:'0.72rem',color:multiYear[2].diff>multiYear[0].diff?'#2ECC71':multiYear[2].diff<multiYear[0].diff?'#E74C3C':'var(--silver)'}},
                                        multiYear[2].diff>multiYear[0].diff?'\uD83D\uDCC8 improving':multiYear[2].diff<multiYear[0].diff?'\uD83D\uDCC9 declining':'\u27A1 neutral'
                                    ),
                                    // Window impact
                                    React.createElement('span', {style:{fontSize:'0.72rem',color:winImpact.col,marginLeft:'auto',fontWeight:600}}, winImpact.icon+' '+winImpact.label)
                                );
                            })()
                        );
                    })
                )
            ) : null
        );
    }

    // ===== DEV MODE =====
    const IS_LOCAL = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    const DEV_MODE = new URLSearchParams(window.location.search).has('dev') || window.location.hostname.includes('sandbox') || IS_LOCAL;
    const DEV_DEBUG = new URLSearchParams(window.location.search).get('dev') === 'true';
    if (DEV_MODE) {
        console.log('%c[DEV MODE] All features unlocked, auth bypassed','color:#D4AF37;font-weight:bold;font-size:14px');
        const b = document.createElement('div');
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#D4AF37;color:#000;font-size:11px;font-weight:700;text-align:center;padding:3px;letter-spacing:.05em;font-family:monospace';
        b.textContent = IS_LOCAL ? '⚡ LOCAL DEV — bigloco auto-logged in, all features unlocked' : 'SANDBOX — changes here do not affect production';
        document.body.prepend(b);
    }

    // ===== AUTHENTICATION CHECK =====
    const AUTH_KEY    = 'od_auth_v1';
    const SESSION_KEY = 'fw_session_v1';

    const legacyAuth   = localStorage.getItem(AUTH_KEY);
    const newSession   = (() => { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; } })();
    const isAuthed     = !!(legacyAuth || newSession?.token || DEV_MODE);

    if (!isAuthed) {
        window.location.href = 'landing.html';
    }

    let sleeperUsername = '';
    // Dev mode: use URL param or default test username
    if (DEV_MODE) {
        sleeperUsername = new URLSearchParams(window.location.search).get('user') || 'bigloco';
    }
    try {
        if (legacyAuth && !sleeperUsername) {
            const credentials = JSON.parse(legacyAuth);
            sleeperUsername = credentials.username || '';
            // Sync username to Team Comps page localStorage key so it auto-logs in
            if (sleeperUsername) {
                localStorage.setItem('od_locked_username_v2', sleeperUsername);
            }
        }
    } catch (e) {
        localStorage.removeItem(AUTH_KEY);
        if (!newSession?.token) window.location.href = 'landing.html';
    }

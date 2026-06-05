// ══════════════════════════════════════════════════════════════════
// settings.js — SettingsModal component
// ══════════════════════════════════════════════════════════════════

    // ── Sub-components (hooks require stable component boundaries) ──

    function AlexTab({ sectionStyle, sectionTitle }) {
        const styles = window.ALEX_STYLES || { default: { name: 'Default', tone: 'Confident but not arrogant. Direct, data-driven, with personality.' }, general: { name: 'The General', tone: 'Intense, demanding, motivational. Short powerful sentences.' }, enthusiast: { name: 'The Enthusiast', tone: 'Excitable, passionate, full of energy. Uses vivid football jargon.' }, bayou: { name: 'The Bayou', tone: 'Folksy, raw, passionate. Southern warmth and earthiness.' }, wit: { name: 'The Wit', tone: 'Sarcastic, confident, clever. Sharp tongue and sharper mind.' }, closer: { name: 'The Closer', tone: 'Direct, emphatic, no-nonsense. Every sentence is declarative.' }, strategist: { name: 'The Strategist', tone: 'Calculated, competitive, analytical. Cold precision.' } };
        const [currentStyle, setCurrentStyleLocal] = React.useState(localStorage.getItem('wr_alex_style') || 'default');
        const [currentAvatar, setCurrentAvatar] = React.useState(localStorage.getItem('wr_alex_avatar') || 'brain');
        return (<>
        <div style={sectionStyle}>
            <div style={sectionTitle}>COMMUNICATION STYLE</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem' }}>Choose how Alex communicates. This affects all AI responses — briefings, chat, trade analysis, draft scouting.</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {Object.entries(styles).map(([key, style]) => (
                    <button key={key} onClick={() => { localStorage.setItem('wr_alex_style', key); setCurrentStyleLocal(key); }}
                        style={{
                            padding: '12px 14px', textAlign: 'left',
                            background: currentStyle === key ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                            border: currentStyle === key ? '2px solid var(--gold)' : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                            borderRadius: '10px', cursor: 'pointer', transition: 'all 0.15s',
                        }}>
                        <div style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: currentStyle === key ? 'var(--gold)' : 'var(--white)', marginBottom: '3px' }}>
                            {style.name} {currentStyle === key && '\u2713'}
                        </div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.4 }}>
                            {style.tone.substring(0, 120)}{style.tone.length > 120 ? '...' : ''}
                        </div>
                    </button>
                ))}
            </div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.5, marginTop: '8px' }}>Changes take effect on next page load.</div>
        </div>
        <div style={sectionStyle}>
            <div style={sectionTitle}>AVATAR</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem' }}>Choose Alex's look. Displayed in briefings and chat.</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
                {[
                    { key: 'brain', emoji: '\u{1F9E0}', label: 'The Analyst' },
                    { key: 'target', emoji: '\u{1F3AF}', label: 'The Scout' },
                    { key: 'chart', emoji: '\u{1F4CA}', label: 'The Strategist' },
                    { key: 'football', emoji: '\u{1F3C8}', label: 'The Coach' },
                    { key: 'bolt', emoji: '\u26A1', label: 'The Spark' },
                    { key: 'fire', emoji: '\u{1F525}', label: 'The Motivator' },
                    { key: 'medal', emoji: '\u{1F396}\uFE0F', label: 'The General' },
                    { key: 'trophy', emoji: '\u{1F3C6}', label: 'The Winner' },
                ].map(av => {
                    const isActive = currentAvatar === av.key;
                    return <button key={av.key} onClick={() => { localStorage.setItem('wr_alex_avatar', av.key); setCurrentAvatar(av.key); }}
                        style={{
                            padding: '12px 8px', textAlign: 'center',
                            background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.08))' : 'var(--ov-1, rgba(255,255,255,0.02))',
                            border: isActive ? '2px solid var(--gold)' : '1px solid var(--ov-5, rgba(255,255,255,0.08))',
                            borderRadius: '10px', cursor: 'pointer',
                        }}>
                        <div style={{ fontSize: '1.6rem', marginBottom: '4px' }}>{av.emoji}</div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: isActive ? 'var(--gold)' : 'var(--silver)' }}>{av.label}</div>
                    </button>;
                })}
            </div>
        </div>
        <div style={sectionStyle}>
            <div style={sectionTitle}>GM BRIEFING</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.45 }}>Replay the first-launch Dynasty HQ briefing any time you want to re-orient the room.</div>
            <button onClick={() => { if (window.replayWRTutorial) window.replayWRTutorial(); }} style={{ width: '100%', padding: '0.65rem 0.85rem', background: 'var(--acc-fill2, rgba(212,175,55,0.1))', border: '1px solid var(--acc-line2, rgba(212,175,55,0.35))', borderRadius: '6px', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>Replay GM Briefing</button>
        </div>
        </>);
    }

    function CommissionerTab({ sectionStyle, sectionTitle }) {
        const leagueId = (window.S || {}).currentLeagueId || '';
        const [docs, setDocs] = React.useState([]);
        const [uploading, setUploading] = React.useState(false);
        const [uploadMsg, setUploadMsg] = React.useState('');

        React.useEffect(() => {
            if (window.OD?.listLeagueDocs && leagueId) {
                window.OD.listLeagueDocs(leagueId).then(d => setDocs(d || []));
            }
        }, [leagueId]);

        const handleFileUpload = async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true); setUploadMsg('');
            try {
                const text = await file.text();
                if (!text.trim()) { setUploadMsg('File is empty.'); setUploading(false); return; }
                const name = file.name.toLowerCase();
                const category = name.includes('bylaw') ? 'bylaws' : name.includes('award') ? 'awards' : name.includes('calendar') || name.includes('schedule') ? 'calendar' : name.includes('scor') ? 'scoring' : 'general';
                const ok = await window.OD.uploadLeagueDoc(leagueId, file.name, text, category);
                if (ok) {
                    setUploadMsg('Uploaded! Alex will now reference this document.');
                    const updated = await window.OD.listLeagueDocs(leagueId);
                    setDocs(updated || []);
                    const ctx = await window.OD.getLeagueDocsContext(leagueId);
                    if (ctx) window._leagueDocsContext = ctx;
                } else { setUploadMsg('Upload failed. Check your connection.'); }
            } catch (err) { setUploadMsg('Error: ' + (err.message || 'Unknown')); }
            setUploading(false);
        };

        const handleDelete = async (docName) => {
            if (!confirm('Delete "' + docName + '"? Alex will no longer reference it.')) return;
            await window.OD?.deleteLeagueDoc(leagueId, docName);
            const updated = await window.OD?.listLeagueDocs(leagueId);
            setDocs(updated || []);
            const ctx = await window.OD?.getLeagueDocsContext(leagueId);
            window._leagueDocsContext = ctx || '';
        };

        return (<>
        <div style={sectionStyle}>
            <div style={sectionTitle}>LEAGUE DOCUMENTS</div>
            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                Upload your league bylaws, awards history, custom rules, or any league-specific documents. Alex will use these to answer league questions and reference your league's customs.
            </div>
            {!leagueId ? (
                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.5 }}>Connect a league first to upload documents.</div>
            ) : (<>
                <div style={{ marginBottom: '12px' }}>
                    <label style={{
                        display: 'block', padding: '14px', textAlign: 'center',
                        background: 'var(--acc-fill1, rgba(212,175,55,0.06))', border: '2px dashed var(--acc-line1, rgba(212,175,55,0.25))',
                        borderRadius: '10px', cursor: 'pointer', fontSize: 'var(--text-body, 1rem)', color: 'var(--gold)', fontWeight: 600,
                    }}>
                        {uploading ? 'Uploading...' : '+ Upload Document (.txt, .md, .csv)'}
                        <input type="file" accept=".txt,.md,.csv,.text" onChange={handleFileUpload} style={{ display: 'none' }} />
                    </label>
                    {uploadMsg && <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: uploadMsg.includes('fail') || uploadMsg.includes('Error') ? 'var(--k-f87171, #f87171)' : 'var(--k-34d399, #34d399)', marginTop: '6px' }}>{uploadMsg}</div>}
                </div>
                {docs.length > 0 && (
                    <div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>UPLOADED ({docs.length})</div>
                        {docs.map((d, i) => (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px solid var(--ov-3, rgba(255,255,255,0.04))' }}>
                                <span style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--white)', flex: 1 }}>{d.name}</span>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', padding: '1px 6px', borderRadius: '6px', background: 'var(--acc-fill2, rgba(212,175,55,0.1))' }}>{d.category}</span>
                                <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>{new Date(d.uploadedAt).toLocaleDateString()}</span>
                                <button onClick={() => handleDelete(d.name)} style={{ background: 'none', border: 'none', color: 'var(--k-f87171, #f87171)', cursor: 'pointer', fontSize: 'var(--text-label, 0.75rem)', padding: '2px 6px', minHeight: '44px', minWidth: '44px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>Delete</button>
                            </div>
                        ))}
                    </div>
                )}
            </>)}
        </div>
        </>);
    }

    function SettingsContent({ onClose, initDisplayName, onDisplayNameSave, leagueMates, mode = 'modal' }) {
        const [settingsTab, setSettingsTab] = React.useState('account');
        const [pwMsg, setPwMsg] = React.useState('');
        const [currentPw, setCurrentPw] = React.useState('');
        const [newPw, setNewPw] = React.useState('');
        const [confirmPw, setConfirmPw] = React.useState('');
        const [displayName, setDisplayName] = React.useState(initDisplayName || '');
        const [matesAccess, setMatesAccess] = React.useState(null); // Set of usernames with accounts
        const [giftLinks, setGiftLinks] = React.useState({}); // { username: { url, password } }
        const [giftingFor, setGiftingFor] = React.useState(null);

        const isGiftedAccount = React.useMemo(() => {
            try {
                const auth = JSON.parse(localStorage.getItem('od_auth_v1') || '{}');
                return !!auth.isGifted;
            } catch { return false; }
        }, []);

        const currentTier = React.useMemo(() => {
            try {
                const p = JSON.parse(localStorage.getItem('od_profile_v1') || '{}');
                const appTier = typeof window.getUserTier === 'function' ? window.getUserTier() : null;
                return appTier || p.tier || 'free';
            } catch { return 'free'; }
        }, []);

        const tierLabel = { free: 'Dynasty HQ Free', trial: 'Dynasty HQ Trial', scout: 'Scout', warroom: 'Dynasty HQ', pro: 'Dynasty HQ Pro', power: 'Dynasty HQ Power', paid: 'Paid' };
        const tierColor = { free: 'var(--silver)', trial: 'var(--silver)', scout: 'var(--silver)', warroom: 'var(--gold)', pro: 'var(--gold)', power: 'var(--k-a855f7, #a855f7)', paid: 'var(--gold)' };
        const tierBg    = { free: 'rgba(192,192,192,0.12)', trial: 'rgba(192,192,192,0.12)', scout: 'rgba(192,192,192,0.12)', warroom: 'var(--acc-fill2, rgba(212,175,55,0.12))', pro: 'var(--acc-fill2, rgba(212,175,55,0.12))', power: 'rgba(168,85,247,0.12)', paid: 'var(--acc-fill2, rgba(212,175,55,0.12))' };

        function goToManagePlan() {
            window.location.href = 'onboarding.html?manage=true';
        }

        function handleCancelPlan() {
            if (!confirm('Open plan management to cancel or change your plan?')) return;
            goToManagePlan();
        }

        function handleDisplayNameSave() {
            if (typeof onDisplayNameSave === 'function') onDisplayNameSave(displayName);
            else localStorage.setItem('od_display_name', displayName);
        }

        async function handleChangePassword() {
            setPwMsg('');
            if (!currentPw || !newPw || !confirmPw) { setPwMsg('x Fill in all fields'); return; }
            if (newPw !== confirmPw) { setPwMsg('x New passwords do not match'); return; }
            if (newPw.length < 6) { setPwMsg('x Password must be at least 6 characters'); return; }
            try {
                // Verify current password against stored hash
                const AUTH_KEY = 'od_auth_v1';
                const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
                const encoder = new TextEncoder();
                const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(currentPw));
                const currentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');

                if (auth.passwordHash && auth.passwordHash !== currentHash) {
                    // Also try Supabase in case this is a gifted account
                    const result = await window.OD.verifySupabasePassword(sleeperUsername, currentPw);
                    if (!result || !result.match) {
                        setPwMsg('x Current password is incorrect');
                        return;
                    }
                }
                // Update Supabase
                await window.OD.updatePassword(sleeperUsername, newPw);
                // Update localStorage
                const newHashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(newPw));
                const newHash = Array.from(new Uint8Array(newHashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
                localStorage.setItem(AUTH_KEY, JSON.stringify({ ...auth, passwordHash: newHash, isGifted: false }));
                setCurrentPw(''); setNewPw(''); setConfirmPw('');
                setPwMsg('ok Password updated');
            } catch (e) {
                setPwMsg('x Failed to update password');
            }
        }

        // Load leaguemate access status when modal opens
        React.useEffect(() => {
            if (!leagueMates || leagueMates.length === 0) return;
            const usernames = leagueMates.map(m => m.username).filter(Boolean);
            window.OD.checkUsersAccess(usernames).then(setMatesAccess).catch(() => setMatesAccess(new Set()));
        }, []);

        async function handleGiftAccess(mate) {
            const username = mate.username;
            if (!username) return;
            setGiftingFor(username);
            try {
                // Generate a random 8-char initial password
                const pw = Array.from(crypto.getRandomValues(new Uint8Array(4)))
                    .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
                await window.OD.createGiftUser({
                    sleeperUsername: username,
                    password: pw,
                    displayName: mate.display_name || null,
                });
                const base = window.location.href.replace(/\/[^/]*$/, '/');
                const url = `${base}login.html?for=${encodeURIComponent(username)}`;
                setGiftLinks(prev => ({ ...prev, [username]: { url, password: pw } }));
                setMatesAccess(prev => new Set([...(prev || []), username]));
            } catch (e) {
                console.error('Gift failed:', e);
            }
            setGiftingFor(null);
        }

        const sectionStyle = { marginBottom: 'var(--space-xl)', padding: 'var(--card-pad)', background: 'var(--acc-fill1, rgba(212,175,55,0.07))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.2))', borderRadius: 'var(--card-radius)' };
        const sectionTitle = { fontFamily: 'var(--font-title)', fontSize: 'var(--text-title, 1.125rem)', color: 'var(--gold)', letterSpacing: '0.12em', marginBottom: '0.75rem' };
        const inputStyle = { width: '100%', padding: '0.55rem 0.75rem', background: 'var(--black)', border: '1px solid var(--acc-line2, rgba(212,175,55,0.3))', borderRadius: '6px', color: 'var(--white)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', marginBottom: '0.5rem' };
        const btnPrimary = { flex: 1, padding: '0.6rem', minHeight: '44px', background: 'var(--gold)', border: 'none', borderRadius: '6px', color: 'var(--black)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' };
        const btnOutline = { flex: 1, padding: '0.6rem', minHeight: '44px', background: 'transparent', border: '1px solid var(--gold)', borderRadius: '6px', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' };
        const isModule = mode === 'module';
        const shellStyle = isModule
            ? { background: 'linear-gradient(135deg, var(--off-black) 0%, var(--charcoal) 100%)', border: '1px solid var(--acc-line1, rgba(212,175,55,0.24))', borderRadius: '10px', padding: '1.1rem', width: '100%', boxSizing: 'border-box', boxShadow: '0 12px 28px rgba(0,0,0,0.22)' }
            : { background: 'linear-gradient(135deg, var(--off-black) 0%, var(--charcoal) 100%)', border: '3px solid var(--gold)', borderRadius: '12px', padding: '1.5rem', maxWidth: 'min(720px, calc(100vw - 48px))', width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.8)', maxHeight: '90vh', overflowY: 'auto' };

        if (isModule) {
            const moduleSectionStyle = { ...sectionStyle, marginBottom: '0.7rem', background: 'var(--ov-2, rgba(255,255,255,0.025))' };
            const moduleGridStyle = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px', alignItems: 'start' };
            const moduleColumnStyle = { minWidth: 0 };
            return (
                <div className="wr-settings-module-screen" style={{ width: '100%' }}>
                    <div className="wr-module-strip" style={{ marginBottom: '12px' }}>
                        <div>
                            <span>Settings</span>
                            <strong>Account and app controls</strong>
                            <em>Logged in as {sleeperUsername}</em>
                        </div>
                    </div>
                    {isGiftedAccount && (
                        <div style={{ marginBottom: '12px', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', background: 'var(--acc-fill2, rgba(212,175,55,0.12))', border: '1px solid var(--acc-line1, rgba(212,175,55,0.22))', padding: '0.55rem 0.75rem', borderRadius: '6px' }}>
                            Gifted account - change your password below.
                        </div>
                    )}
                    <div className="wr-settings-module-grid" style={moduleGridStyle}>
                        <div style={moduleColumnStyle}>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>ACCOUNT</div>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.5rem' }}>Display name</div>
                                <div style={{ display: 'flex', gap: '0.5rem' }}>
                                    <input
                                        style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                                        placeholder={sleeperUsername}
                                        value={displayName}
                                        onChange={e => setDisplayName(e.target.value)}
                                    />
                                    <button onClick={handleDisplayNameSave} style={{ ...btnPrimary, flex: 'none', padding: '0.55rem 0.85rem' }}>Save</button>
                                </div>
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>PASSWORD</div>
                                <input style={inputStyle} type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                                <input style={inputStyle} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                                <input style={{ ...inputStyle, marginBottom: '0.75rem' }} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
                                <button onClick={handleChangePassword} style={{ ...btnPrimary, width: '100%', flex: 'none' }}>Update Password</button>
                                {pwMsg && <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: pwMsg.startsWith('ok') ? 'var(--win-green)' : 'var(--k-e74c3c, #e74c3c)' }}>{pwMsg}</div>}
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>ACCOUNT ACTIONS</div>
                                <button onClick={handleLogout} style={{ width: '100%', padding: '0.7rem', background: 'rgba(231,76,60,0.18)', border: '1px solid rgba(231,76,60,0.45)', borderRadius: '6px', color: 'var(--k-fca5a5, #fca5a5)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
                                    Logout
                                </button>
                            </div>
                        </div>

                        <div style={moduleColumnStyle}>
                            <AlexTab sectionStyle={moduleSectionStyle} sectionTitle={sectionTitle} />
                        </div>

                        <div style={moduleColumnStyle}>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>DISPLAY</div>
                                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                                    Change the visual style of your dashboard widgets.
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                    {(window.WrTheme ? window.WrTheme.list() : ['default']).map(themeId => {
                                        const t = window.WrTheme?.themes?.[themeId] || {};
                                        const isActive = (window.WrTheme?.current || 'default') === themeId;
                                        return (
                                            <button key={themeId} onClick={() => {
                                                if (window.WrTheme) window.WrTheme.set(themeId);
                                                setSettingsTab('display');
                                            }} style={{
                                                padding: '16px 14px',
                                                background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                                border: isActive ? '2px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                                borderRadius: t.card?.radius || '8px',
                                                cursor: 'pointer',
                                                textAlign: 'center',
                                                transition: '0.15s',
                                            }}>
                                                <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>{t.preview || '\uD83C\uDFA8'}</div>
                                                <div style={{
                                                    fontFamily: 'var(--font-title)',
                                                    fontSize: 'var(--text-body, 1rem)',
                                                    fontWeight: 700,
                                                    color: isActive ? 'var(--gold)' : 'var(--white)',
                                                    letterSpacing: '0.06em',
                                                }}>{t.name || themeId}</div>
                                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '4px' }}>
                                                    {themeId === 'default' ? 'Dark mode - gold accent' : themeId === 'light' ? 'Light mode - clean and bright' : 'Custom theme'}
                                                </div>
                                                {isActive && (
                                                    <div style={{
                                                        marginTop: '8px',
                                                        fontSize: 'var(--text-label, 0.75rem)',
                                                        fontWeight: 700,
                                                        color: 'var(--gold)',
                                                        textTransform: 'uppercase',
                                                        letterSpacing: '0.08em',
                                                    }}>ACTIVE</div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                            <CommissionerTab sectionStyle={moduleSectionStyle} sectionTitle={sectionTitle} />
                        </div>

                        <div style={moduleColumnStyle}>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>PLAN</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                                    <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>Current plan:</span>
                                    <span style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: tierColor[currentTier] || 'var(--silver)', background: tierBg[currentTier] || 'rgba(192,192,192,0.12)', padding: '0.15rem 0.55rem', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                        {tierLabel[currentTier] || 'Dynasty HQ Free'}
                                    </span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                                    <button onClick={goToManagePlan} style={{ ...btnPrimary, fontSize: 'var(--text-label, 0.75rem)' }}>Upgrade</button>
                                    <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Change Plan</button>
                                    <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Gift Sub</button>
                                    <button onClick={handleCancelPlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)', borderColor: 'rgba(231,76,60,0.35)', color: 'var(--k-e74c3c, #e74c3c)' }}>Cancel</button>
                                </div>
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>AI KEY</div>
                                <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.55, marginBottom: '0.75rem' }}>
                                    Session-only BYO keys are supported during onboarding and in the AI controls.
                                </div>
                                <button onClick={() => { window.location.href = 'onboarding.html?manage=true#byo'; }} style={{ ...btnOutline, width: '100%', flex: 'none', fontSize: 'var(--text-body, 1rem)' }}>Review AI Setup</button>
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>DATA</div>
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                    <button onClick={() => {
                                        Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                                        if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; }
                                        alert('DHQ cache cleared. Reload to rebuild.');
                                    }} style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '4px', color: 'var(--k-e74c3c, #e74c3c)', cursor: 'pointer' }}>
                                        Clear DHQ Cache
                                    </button>
                                    <button onClick={() => { sessionStorage.clear(); alert('Session cache cleared.'); }}
                                        style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' }}>
                                        Clear Session Cache
                                    </button>
                                </div>
                            </div>
                            <div style={moduleSectionStyle}>
                                <div style={sectionTitle}>ABOUT</div>
                                <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.65 }}>
                                    Dynasty HQ v2.0 &middot; Powered by DHQ Engine
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            );
        }

        return (
                <div className={isModule ? 'wr-settings-module' : 'wr-settings-modal'} style={shellStyle} onClick={isModule ? undefined : (e) => e.stopPropagation()}>
                    <h2 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--text-title)', color: 'var(--gold)', marginBottom: '0.55rem', textAlign: isModule ? 'left' : 'center', letterSpacing: '0.12em' }}>SETTINGS</h2>

                    <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '1rem' }}>
                        Logged in as: <strong style={{ color: 'var(--white)' }}>{sleeperUsername}</strong>
                        {isGiftedAccount && <span style={{ marginLeft: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--gold)', background: 'var(--acc-fill3, rgba(212,175,55,0.15))', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>GIFTED — change your password below</span>}
                    </div>

                    {/* Tab bar */}
                    <div className="wr-module-nav" style={{ marginBottom: '1.25rem' }}>
                        {[
                            { id: 'account', label: 'Account' },
                            { id: 'alex', label: 'Alex' },
                            { id: 'display', label: 'Display' },
                            { id: 'commissioner', label: 'Commish' },
                            { id: 'subscription', label: 'Plan' },
                            { id: 'data', label: 'Data' },
                        ].map(tab => (
                            <button key={tab.id} className={settingsTab === tab.id ? 'is-active' : ''} onClick={() => setSettingsTab(tab.id)}>{tab.label}</button>
                        ))}
                    </div>

                    {/* ══ ACCOUNT TAB ══ */}
                    {settingsTab === 'account' && (<>
                    {/* ── DISPLAY NAME ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>DISPLAY NAME</div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', marginBottom: '0.5rem' }}>Custom name (optional)</div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <input
                                style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
                                placeholder={sleeperUsername}
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                            />
                            <button onClick={handleDisplayNameSave} style={{ ...btnPrimary, flex: 'none', padding: '0.55rem 0.85rem' }}>Save</button>
                        </div>
                    </div>

                    {/* ── CHANGE PASSWORD ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>CHANGE PASSWORD</div>
                        <input style={inputStyle} type="password" placeholder="Current password" value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
                        <input style={inputStyle} type="password" placeholder="New password" value={newPw} onChange={e => setNewPw(e.target.value)} />
                        <input style={{ ...inputStyle, marginBottom: '0.75rem' }} type="password" placeholder="Confirm new password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} />
                        <button onClick={handleChangePassword} style={{ ...btnPrimary, width: '100%', flex: 'none' }}>Update Password</button>
                        {pwMsg && <div style={{ marginTop: '0.5rem', fontSize: 'var(--text-label, 0.75rem)', color: pwMsg.startsWith('ok') ? 'var(--win-green)' : 'var(--k-e74c3c, #e74c3c)' }}>{pwMsg}</div>}
                    </div>

                    {/* Phase 10: Leaguemate Access card removed per user feedback (2026-04-18) */}
                    </>)}

                    {/* ══ ALEX TAB — Coaching Style + Avatar ══ */}
                    {settingsTab === 'alex' && <AlexTab sectionStyle={sectionStyle} sectionTitle={sectionTitle} />}

                    {/* ══ DISPLAY TAB ══ */}
                    {settingsTab === 'display' && (<>
                        <div style={sectionStyle}>
                            <div style={sectionTitle}>DASHBOARD THEME</div>
                            <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                                Change the visual style of your dashboard widgets.
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                                {(window.WrTheme ? window.WrTheme.list() : ['default']).map(themeId => {
                                    const t = window.WrTheme?.themes?.[themeId] || {};
                                    const isActive = (window.WrTheme?.current || 'default') === themeId;
                                    return (
                                        <button key={themeId} onClick={() => {
                                            if (window.WrTheme) window.WrTheme.set(themeId);
                                            // Force re-render by updating a dummy state
                                            setSettingsTab('display');
                                        }} style={{
                                            padding: '16px 14px',
                                            background: isActive ? 'var(--acc-fill2, rgba(212,175,55,0.12))' : 'var(--ov-2, rgba(255,255,255,0.03))',
                                            border: isActive ? '2px solid var(--gold)' : '1px solid var(--ov-6, rgba(255,255,255,0.1))',
                                            borderRadius: t.card?.radius || '8px',
                                            cursor: 'pointer',
                                            textAlign: 'center',
                                            transition: '0.15s',
                                        }}>
                                            <div style={{ fontSize: '1.6rem', marginBottom: '6px' }}>{t.preview || '🎨'}</div>
                                            <div style={{
                                                fontFamily: 'var(--font-title)',
                                                fontSize: 'var(--text-body, 1rem)',
                                                fontWeight: 700,
                                                color: isActive ? 'var(--gold)' : 'var(--white)',
                                                letterSpacing: '0.06em',
                                            }}>{t.name || themeId}</div>
                                            <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', opacity: 0.6, marginTop: '4px' }}>
                                                {themeId === 'default' ? 'Dark mode · gold accent' : themeId === 'light' ? 'Light mode · clean & bright' : 'Custom theme'}
                                            </div>
                                            {isActive && (
                                                <div style={{
                                                    marginTop: '8px',
                                                    fontSize: 'var(--text-label, 0.75rem)',
                                                    fontWeight: 700,
                                                    color: 'var(--gold)',
                                                    textTransform: 'uppercase',
                                                    letterSpacing: '0.08em',
                                                }}>ACTIVE</div>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </>)}

                    {/* ══ COMMISSIONER TAB — League Docs ══ */}
                    {settingsTab === 'commissioner' && <CommissionerTab sectionStyle={sectionStyle} sectionTitle={sectionTitle} />}

                    {/* ══ SUBSCRIPTION TAB ══ */}
                    {settingsTab === 'subscription' && (<>
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>CURRENT PLAN</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.85rem' }}>
                            <span style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)' }}>Current plan:</span>
                            <span style={{ fontSize: 'var(--text-body, 1rem)', fontWeight: 700, color: tierColor[currentTier] || 'var(--silver)', background: tierBg[currentTier] || 'rgba(192,192,192,0.12)', padding: '0.15rem 0.55rem', borderRadius: '4px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                                {tierLabel[currentTier] || 'Dynasty HQ Free'}
                            </span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                            <button onClick={goToManagePlan} style={{ ...btnPrimary, fontSize: 'var(--text-label, 0.75rem)' }}>Upgrade</button>
                            <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Change Plan</button>
                            <button onClick={goToManagePlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)' }}>Gift Sub</button>
                            <button onClick={handleCancelPlan} style={{ ...btnOutline, fontSize: 'var(--text-label, 0.75rem)', borderColor: 'rgba(231,76,60,0.35)', color: 'var(--k-e74c3c, #e74c3c)' }}>Cancel</button>
                        </div>
                        <div style={{ marginTop: '0.6rem', fontSize: 'var(--text-label, 0.75rem)', color: 'var(--ov-8, rgba(255,255,255,0.3))', textAlign: 'center' }}>Manage your Dynasty HQ subscription</div>
                    </div>

                    <div style={sectionStyle}>
                        <div style={sectionTitle}>BYO AI KEY</div>
                        <div style={{ fontSize: 'var(--text-label, 0.75rem)', color: 'var(--silver)', lineHeight: 1.55, marginBottom: '0.75rem' }}>
                            Session-only BYO keys are supported during onboarding and in the AI controls. They are not stored in localStorage and they bypass included query limits only for that session.
                        </div>
                        <button onClick={() => { window.location.href = 'onboarding.html?manage=true#byo'; }} style={{ ...btnOutline, width: '100%', flex: 'none', fontSize: 'var(--text-body, 1rem)' }}>Review AI Setup</button>
                    </div>
                    </>)}

                    {/* ══ DATA TAB ══ */}
                    {settingsTab === 'data' && (<>
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>CACHE MANAGEMENT</div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                            <button onClick={() => {
                                Object.keys(localStorage).filter(k => k.startsWith('dhq_leagueintel_') || k.startsWith('dhq_hist_')).forEach(k => localStorage.removeItem(k));
                                if (window.App) { window.App.LI = {}; window.App.LI_LOADED = false; }
                                alert('DHQ cache cleared. Reload to rebuild.');
                            }} style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'rgba(231,76,60,0.1)', border: '1px solid rgba(231,76,60,0.3)', borderRadius: '4px', color: 'var(--k-e74c3c, #e74c3c)', cursor: 'pointer' }}>
                                Clear DHQ Cache
                            </button>
                            <button onClick={() => { sessionStorage.clear(); alert('Session cache cleared.'); }}
                                style={{ padding: '6px 12px', minHeight: '44px', fontSize: 'var(--text-body, 1rem)', fontFamily: 'var(--font-body)', background: 'var(--ov-3, rgba(255,255,255,0.04))', border: '1px solid var(--ov-6, rgba(255,255,255,0.1))', borderRadius: '4px', color: 'var(--silver)', cursor: 'pointer' }}>
                                Clear Session Cache
                            </button>
                        </div>
                    </div>

                    {/* ── ABOUT ── */}
                    <div style={sectionStyle}>
                        <div style={sectionTitle}>ABOUT</div>
                        <div style={{ fontSize: 'var(--text-body, 1rem)', color: 'var(--silver)', opacity: 0.65 }}>
                            Dynasty HQ v2.0 &middot; Powered by DHQ Engine
                        </div>
                    </div>
                    </>)}

                    <div style={{ display: 'flex', gap: '0.75rem', flexDirection: 'column', marginTop: '1.5rem' }}>
                        <button onClick={handleLogout} style={{ padding: '0.75rem', background: 'linear-gradient(135deg, var(--k-e74c3c, #e74c3c) 0%, var(--k-c0392b, #c0392b) 100%)', border: 'none', borderRadius: '8px', color: 'white', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
                            Logout
                        </button>
                        {!isModule && <button onClick={onClose} style={{ padding: '0.75rem', background: 'var(--black)', border: '2px solid var(--gold)', borderRadius: '8px', color: 'var(--gold)', fontFamily: 'var(--font-body)', fontSize: 'var(--text-body, 1rem)', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer' }}>
                            Close
                        </button>}
                    </div>
                </div>
        );
    }

    function SettingsModal(props) {
        return (
            <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }} onClick={props.onClose}>
                <SettingsContent {...props} mode="modal" />
            </div>
        );
    }

    function SettingsModule(props) {
        return (
            <div style={{ padding: '10px 16px 16px', maxWidth: '1380px', margin: '0 auto' }}>
                <SettingsContent {...props} mode="module" />
            </div>
        );
    }

    window.SettingsModal = SettingsModal;
    window.SettingsModule = SettingsModule;

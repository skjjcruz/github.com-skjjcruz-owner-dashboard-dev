// ══════════════════════════════════════════════════════════════════
// js/pro-launch.js — Pro upgrade page
// Full-screen premium launch experience. Tiers: Scout (free) → Pro Monthly → Pro Annual
// ══════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // Checkout runs through upgrade.html (billing picker → Stripe via
  // fw-create-checkout), which needs the user's session token — a static
  // payment link can't attach the subscription to the right account.
  const CHECKOUT_URL = 'upgrade.html';
  const INTEREST_KEY = 'dhq_pro_interest';

  // Same three plan cards as the app facer page (landing.html pricing) —
  // one source of truth for names, notes, and features.
  const TIERS = [
    { name: 'Scout', price: '$0', period: '', note: 'Free — all your leagues',
      features: ['All your Sleeper leagues', 'League-specific DHQ values', 'Player cards with age curves', 'Team diagnosis', '1 AI query per day'],
      accent: 'rgba(255,255,255,0.3)' },
    { name: 'Pro Monthly', price: '$9.99', period: '/mo', note: '7-day free trial · cancel anytime', badge: 'Most Popular',
      features: ['Everything in Scout', 'Unlimited Sleeper leagues', '10 AI calls per day', 'Owner DNA profiles', 'Trade memory + finder', 'Draft command + pick values', 'Scout + War Room access'],
      accent: '#D4AF37', recommended: true },
    { name: 'Pro Annual', price: '$99.99', period: '/yr', note: 'Best value — ~$8.33/mo · 7-day free trial', badge: 'Best Value',
      features: ['Everything in Pro Monthly', '15 AI calls per day', 'Locked-in annual rate', 'Save ~17% vs monthly', 'Priority feature access'],
      accent: '#D4AF37' },
  ];

  const FAQ_ITEMS = [
    {
      q: 'Can I cancel anytime?',
      a: 'Yes. Cancel with one click from your account settings. No questions asked, no penalty, and you keep access through the end of your billing period.',
    },
    {
      q: 'What happens to my data if I downgrade?',
      a: 'Your data stays — Field Log notes, Owner DNA profiles, and league history are retained. You just lose access to premium features until you resubscribe.',
    },
    {
      q: 'What does Pro add over Scout?',
      a: 'Scout is the free tier — all your Sleeper leagues with DHQ values and team diagnosis. Pro unlocks everything: 10 AI calls a day (15 on annual), Owner DNA, trade memory and finder, and the draft command center.',
    },
    {
      q: 'How does the 7-day free trial work?',
      a: 'Both Pro plans start with a 7-day free trial. You get full access immediately and can cancel any time during the trial without being charged.',
    },
  ];

  // ── Trial recap ────────────────────────────────────────────────
  function _getTrialRecap() {
    try {
      const raw = localStorage.getItem('dhq_trial_usage');
      if (!raw) return [];
      const u = JSON.parse(raw);
      return [
        u.trade_scenarios_explored > 0 && `${u.trade_scenarios_explored} trade scenario${u.trade_scenarios_explored !== 1 ? 's' : ''} explored`,
        u.briefings_received > 0       && `${u.briefings_received} daily briefing${u.briefings_received !== 1 ? 's' : ''} received`,
        u.draft_targets_flagged > 0    && `${u.draft_targets_flagged} draft target${u.draft_targets_flagged !== 1 ? 's' : ''} flagged`,
        u.ai_chats_sent > 0            && `${u.ai_chats_sent} Scout message${u.ai_chats_sent !== 1 ? 's' : ''} sent`,
        u.owner_dna_views > 0          && `${u.owner_dna_views} owner profile${u.owner_dna_views !== 1 ? 's' : ''} viewed`,
        u.waiver_bids_placed > 0       && `${u.waiver_bids_placed} waiver recommendation${u.waiver_bids_placed !== 1 ? 's' : ''} used`,
      ].filter(Boolean);
    } catch { return []; }
  }

  // ── Stripe / subscribe handler ─────────────────────────────────
  function handleSubscribe() {
    // Record conversion intent so we can follow up
    try {
      const entry = { ts: Date.now(), tier: typeof getTier === 'function' ? getTier() : 'unknown' };
      localStorage.setItem(INTEREST_KEY, JSON.stringify(entry));
    } catch {}
    window.OD?.track?.('checkout_started', {
      platform: 'reconai',
      module: 'upgrade',
      entityType: 'product',
      entityId: 'war_room',
      metadata: { source: 'pro_launch', tier: typeof getTier === 'function' ? getTier() : 'unknown' },
    });

    // Same tab: the funnel is part of the app, and every page that loads
    // this module lives in the same directory as onboarding.html.
    window.location.href = CHECKOUT_URL;
  }

  // ── DOM ────────────────────────────────────────────────────────
  function _ensureDOM() {
    if (document.getElementById('pro-launch-overlay')) return;

    const el = document.createElement('div');
    el.id = 'pro-launch-overlay';
    el.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:10002',
      'background:#090909',
      'overflow-y:auto',
      '-webkit-overflow-scrolling:touch',
      'opacity:0',
      'transition:opacity .22s ease',
    ].join(';');

    el.innerHTML = `
      <!-- Subdued DHQ watermark backdrop, same treatment as the connect page -->
      <div aria-hidden="true" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:clamp(400px,60vw,900px);height:clamp(400px,60vw,900px);background:url('icon-192.png') center/contain no-repeat;opacity:.06;filter:brightness(1.2);pointer-events:none"></div>
      <div style="position:relative;min-height:100vh;max-width:540px;margin:0 auto;padding:0 20px 80px">

        <!-- Sticky close bar -->
        <div style="position:sticky;top:0;z-index:2;display:flex;justify-content:flex-end;padding:14px 0 6px;background:#090909">
          <button id="pro-launch-close"
            style="background:rgba(255,255,255,.09);border:none;border-radius:50%;width:36px;height:36px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.7);font-size:20px;line-height:1;font-family:inherit;flex-shrink:0;transition:background .15s"
            onmouseover="this.style.background='rgba(255,255,255,.16)'"
            onmouseout="this.style.background='rgba(255,255,255,.09)'">&#x2715;</button>
        </div>

        <!-- Hero -->
        <div style="text-align:center;padding:12px 0 32px">
          <img src="icon-192.png" alt="Dynasty HQ" style="width:64px;height:64px;border-radius:15px;margin:0 auto 22px;display:block;box-shadow:0 4px 22px rgba(212,175,55,.25)">
          <h1 id="pro-launch-hero-heading" style="font-size:42px;font-weight:800;letter-spacing:0;line-height:1.06;margin:0 0 20px;background:linear-gradient(160deg,#ffffff 30%,#d4af37 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text">Every roster.<br>Every move.<br>One room.</h1>
          <div style="font-size:15px;color:rgba(255,255,255,.4);margin-bottom:28px;line-height:1.65;max-width:360px;margin-left:auto;margin-right:auto">Sleeper-first dynasty intelligence powered by AI. Scout comes free — upgrade to unlock the full command center.</div>
        </div>

        <!-- Plan cards (same three as the app facer pricing) -->
        <div id="pro-launch-tiers" style="display:flex;flex-direction:column;gap:14px;margin-bottom:32px"></div>

        <!-- Trial recap (shown only if usage data exists) -->
        <div id="pro-launch-recap" style="display:none;background:rgba(212,175,55,.06);border:1px solid rgba(212,175,55,.16);border-radius:14px;padding:16px 20px;margin-bottom:32px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:rgba(212,175,55,.6);margin-bottom:10px">Your trial activity</div>
          <div id="pro-launch-recap-list"></div>
        </div>

        <!-- Primary CTA -->
        <button id="pro-launch-cta"
          style="width:100%;padding:18px;background:linear-gradient(135deg,#d4af37,#b8941f);color:#1a1000;border:none;border-radius:14px;font-size:16px;font-weight:800;cursor:pointer;letter-spacing:0;box-shadow:0 8px 32px rgba(212,175,55,.32);margin-bottom:12px;font-family:inherit;transition:transform .15s,box-shadow .15s"
          onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 14px 48px rgba(212,175,55,.45)'"
          onmouseout="this.style.transform='';this.style.boxShadow='0 8px 32px rgba(212,175,55,.32)'">
          Upgrade to Pro &mdash; $9.99/mo &middot; 7-day free trial
        </button>

        <!-- Secondary: continue with free -->
        <div style="text-align:center;margin-bottom:36px">
          <button id="pro-launch-skip"
            style="background:none;border:none;cursor:pointer;font-size:13px;color:rgba(255,255,255,.28);font-family:inherit;padding:10px;transition:color .15s"
            onmouseover="this.style.color='rgba(255,255,255,.55)'"
            onmouseout="this.style.color='rgba(255,255,255,.28)'">
            Continue with Free
          </button>
          <div style="font-size:11px;color:rgba(255,255,255,.15);margin-top:2px">Secure checkout via Stripe &middot; Cancel in one click</div>
        </div>

        <!-- Product proof -->
        <div id="pro-launch-social" style="margin-bottom:36px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:14px;padding:20px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:rgba(255,255,255,.22);margin-bottom:16px;text-align:center">Built for the live product</div>
          <div style="display:flex;gap:8px;align-items:center;justify-content:center;margin-bottom:20px;flex-wrap:wrap">
            <div style="background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.18);border-radius:12px;padding:8px 16px;text-align:center">
              <div style="font-size:22px;font-weight:800;color:#d4af37;letter-spacing:0">Sleeper</div>
              <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:1px">Live platform</div>
            </div>
            <div style="background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.18);border-radius:12px;padding:8px 16px;text-align:center">
              <div style="font-size:22px;font-weight:800;color:#d4af37;letter-spacing:0">Scout</div>
              <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:1px">Mobile surface</div>
            </div>
            <div style="background:rgba(212,175,55,.08);border:1px solid rgba(212,175,55,.18);border-radius:12px;padding:8px 16px;text-align:center">
              <div style="font-size:22px;font-weight:800;color:#d4af37;letter-spacing:0">War Room</div>
              <div style="font-size:11px;color:rgba(255,255,255,.35);margin-top:1px">Desktop surface</div>
            </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px 16px">
              <div style="font-size:13px;color:rgba(255,255,255,.72);font-weight:700;margin-bottom:6px">Owner DNA</div>
              <div style="font-size:13px;color:rgba(255,255,255,.55);line-height:1.6">Spot manager tendencies, trade pressure, and deal timing from your active Sleeper league.</div>
            </div>
            <div style="background:rgba(255,255,255,.04);border-radius:10px;padding:14px 16px">
              <div style="font-size:13px;color:rgba(255,255,255,.72);font-weight:700;margin-bottom:6px">League briefings</div>
              <div style="font-size:13px;color:rgba(255,255,255,.55);line-height:1.6">Turn roster changes, waiver windows, and contender shifts into weekly action items.</div>
            </div>
          </div>
        </div>

        <!-- FAQ -->
        <div style="border-top:1px solid rgba(255,255,255,.07);padding-top:28px;margin-bottom:24px">
          <div style="font-size:11px;font-weight:700;letter-spacing:0;text-transform:uppercase;color:rgba(255,255,255,.22);margin-bottom:16px">Common questions</div>
          <div id="pro-launch-faq"></div>
        </div>

        <!-- Manage subscription link (paid users only) -->
        <div id="pro-launch-manage" style="display:none;text-align:center;padding-bottom:8px">
          <button
            onclick="if(typeof showToast==='function')showToast('Subscription management coming soon')"
            style="background:none;border:none;cursor:pointer;font-size:13px;color:rgba(255,255,255,.25);text-decoration:underline;font-family:inherit;padding:8px">
            Manage Subscription
          </button>
        </div>

      </div>`;

    document.body.appendChild(el);
    document.getElementById('pro-launch-close').addEventListener('click', hideProLaunchPage);
    document.getElementById('pro-launch-skip').addEventListener('click', hideProLaunchPage);
  }

  // ── Render helpers ─────────────────────────────────────────────
  function _renderTiers() {
    const container = document.getElementById('pro-launch-tiers');
    if (!container) return;
    const currentTier = typeof getTier === 'function' ? getTier() : 'free';
    container.innerHTML = TIERS.map(t => {
      const isCurrent = (currentTier === 'paid' && t.name.startsWith('Pro')) || (currentTier === 'free' && t.name === 'Scout');
      return `
      <div style="background:${t.recommended ? 'rgba(212,175,55,.06)' : 'rgba(255,255,255,.03)'};border:${t.recommended ? '2px solid rgba(212,175,55,.35)' : '1px solid rgba(255,255,255,.08)'};border-radius:14px;padding:20px 22px;position:relative;${isCurrent ? 'outline:2px solid rgba(46,204,113,.4);outline-offset:2px' : ''}">
        ${t.badge ? `<div style="position:absolute;top:-10px;right:16px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#1a1204;background:#d4af37;border-radius:5px;padding:2px 8px;white-space:nowrap">${t.badge}</div>` : ''}
        <div style="font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-bottom:8px">${t.name}</div>
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px">
          <span style="font-size:26px;font-weight:800;color:#fff;letter-spacing:0">${t.price}</span>
          <span style="font-size:13px;color:rgba(255,255,255,.3)">${t.period}</span>
        </div>
        <div style="font-size:12px;color:${t.recommended ? '#d4af37' : 'rgba(255,255,255,.35)'};margin-bottom:12px">${t.note}</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${t.features.map(f => `<div style="font-size:12.5px;color:rgba(255,255,255,.5);display:flex;align-items:center;gap:7px"><span style="color:${t.accent};font-size:11px;flex-shrink:0">✓</span>${f}</div>`).join('')}
        </div>
        ${isCurrent ? '<div style="margin-top:10px;font-size:11px;font-weight:700;color:#2ECC71;text-transform:uppercase;letter-spacing:0">CURRENT PLAN</div>' : ''}
      </div>`;
    }).join('');
  }

  function _renderRecap() {
    const wrap = document.getElementById('pro-launch-recap');
    const list = document.getElementById('pro-launch-recap-list');
    if (!wrap || !list) return;
    const stats = _getTrialRecap();
    if (!stats.length) { wrap.style.display = 'none'; return; }
    list.innerHTML = stats.map(s => `
      <div style="display:flex;align-items:center;gap:8px;font-size:13px;color:rgba(255,255,255,.6);padding:3px 0">
        <span style="color:#d4af37;font-size:11px;font-weight:700;flex-shrink:0">✓</span>${s}
      </div>`).join('');
    wrap.style.display = 'block';
  }

  function _renderFAQ() {
    const container = document.getElementById('pro-launch-faq');
    if (!container) return;
    container.innerHTML = FAQ_ITEMS.map(item => `
      <div style="border-bottom:1px solid rgba(255,255,255,.06)">
        <button onclick="(function(b){var a=b.nextElementSibling,o=a.style.maxHeight==='0px'||!a.style.maxHeight;a.style.maxHeight=o?(a.scrollHeight+'px'):'0px';a.style.opacity=o?'1':'0';b.querySelector('.faq-ch').style.transform=o?'rotate(180deg)':'rotate(0)'})(this)"
          style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 0;background:none;border:none;cursor:pointer;font-family:inherit;text-align:left">
          <span style="font-size:14px;font-weight:600;color:rgba(255,255,255,.65);line-height:1.35">${item.q}</span>
          <svg class="faq-ch" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="2.5" style="flex-shrink:0;transition:transform .22s"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div style="max-height:0;overflow:hidden;opacity:0;transition:max-height .28s ease,opacity .22s ease">
          <div style="padding:0 0 15px;font-size:13px;color:rgba(255,255,255,.38);line-height:1.68">${item.a}</div>
        </div>
      </div>`).join('');
  }

  // ── ESC key ────────────────────────────────────────────────────
  let _escBound = false;
  function _bindEsc() {
    if (_escBound) return;
    _escBound = true;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') hideProLaunchPage(); });
  }

  // ── Public API ─────────────────────────────────────────────────
  function showProLaunchPage() {
    _ensureDOM();
    _bindEsc();

    const overlay = document.getElementById('pro-launch-overlay');
    if (!overlay) return;

    // Manage subscription section — only for paid users
    const tier = typeof getTier === 'function' ? getTier() : 'free';
    const manageEl = document.getElementById('pro-launch-manage');
    if (manageEl) manageEl.style.display = tier === 'paid' ? '' : 'none';

    // Populate content
    _renderTiers();
    _renderFAQ();
    _renderRecap();

    // Show with fade-in
    overlay.scrollTop = 0;
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => { overlay.style.opacity = '1'; });

    // Wire CTA
    const cta = document.getElementById('pro-launch-cta');
    if (cta) cta.onclick = handleSubscribe;
  }

  function hideProLaunchPage() {
    const overlay = document.getElementById('pro-launch-overlay');
    if (!overlay) return;
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.style.display = 'none';
      document.body.style.overflow = '';
    }, 220);
  }

  window.showProLaunchPage  = showProLaunchPage;
  window.hideProLaunchPage  = hideProLaunchPage;
  window.handleSubscribe    = handleSubscribe;
  window.App = window.App || {};
  window.App.showProLaunchPage = showProLaunchPage;
  window.App.hideProLaunchPage = hideProLaunchPage;
  window.App.handleSubscribe   = handleSubscribe;
})();

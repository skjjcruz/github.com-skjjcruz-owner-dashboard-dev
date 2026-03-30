/*  ai-dispatch.js  — Multi-provider AI dispatcher (shared)
 *  Extracted from js/ai-chat.js so both ReconAI and War Room can use it.
 *  Exposes: PROVIDERS, updateProviderHint, hasServerAI, hasAnyAI,
 *           callClaude, callGrokNews
 *  Globals expected: window.S (state), window.OD (Supabase/server-side),
 *    window.$ (DOM helper), window.DHQ_IDENTITY, window.DHQ_PROMPTS
 */
window.App = window.App || {};

// ── AI Provider config ───────────────────────────────────────
const PROVIDERS = {
  gemini: {
    name: 'Gemini Flash (Free)',
    placeholder: 'AIza...',
    hint: 'Free tier at <a href="https://aistudio.google.com/apikey" target="_blank">aistudio.google.com</a>. 1M tokens/day free. No web search.',
    defaultModel: 'gemini-1.5-flash',
    validate: k => k.length > 10,
  },
  anthropic: {
    name: 'Claude (Anthropic)',
    placeholder: 'sk-ant-...',
    hint: 'Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>. Supports web search.',
    defaultModel: 'claude-sonnet-4-20250514',
    validate: k => k.startsWith('sk-'),
  },
};

// Smart model routing — use the best model for each task type
const MODEL_ROUTING = {
  // Complex reasoning — needs best model
  'trade-chat': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'trade-scout': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'draft-scout': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'pick-analysis': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  'player-scout': { provider: 'anthropic', model: 'claude-sonnet-4-20250514' },
  // Medium complexity — good cheap model
  'home-chat': { provider: 'gemini', model: 'gemini-2.0-flash' },
  'waiver-chat': { provider: 'gemini', model: 'gemini-2.0-flash' },
  'waiver-agent': { provider: 'gemini', model: 'gemini-2.0-flash' },
  'draft-chat': { provider: 'gemini', model: 'gemini-2.0-flash' },
  'strategy-analysis': { provider: 'gemini', model: 'gemini-2.0-flash' },
  // Simple tasks — cheapest model
  'memory-summary': { provider: 'gemini', model: 'gemini-2.0-flash' },
  'power-posts': { provider: 'gemini', model: 'gemini-2.0-flash' },
};

// ── Provider hint UI helper ──────────────────────────────────
function updateProviderHint(){
  const sel=(window.$||document.getElementById.bind(document))('ai-provider-sel');if(!sel)return;
  const prov=sel.value;
  const hints={
    gemini:{text:'Gemini Flash — FREE tier, good quality',color:'var(--green)'},
    anthropic:{text:'Claude Sonnet — best quality, requires paid API key',color:'var(--accent)'},
  };
  const h=hints[prov]||{text:'',color:'var(--text3)'};
  const el=(window.$||document.getElementById.bind(document))('provider-hint');
  if(el){el.textContent=h.text;el.style.color=h.color;}
}

// ── Helper: check if server-side AI is available ─────────────
function hasServerAI(){
  return !!(window.OD?.callAI && window.OD?.getSessionToken && window.OD.getSessionToken());
}

// ── Helper: check if ANY AI is available (server or client key) ─
function hasAnyAI(showPrompt=false){
  const S = window.S || window.App?.S || {};
  // Paywall check: free tier has no AI access
  if (typeof canAccess === 'function' && !canAccess('ai-unlimited')) {
    if (showPrompt && typeof showUpgradePrompt === 'function') {
      const containers = ['home-chat-msgs','trade-chat-msgs','wq-chat-msgs','draft-msgs'];
      const el = containers.map(id => document.getElementById(id)).find(e => e && e.offsetParent !== null);
      if (el) showUpgradePrompt('ai-unlimited', el);
    }
    return false;
  }
  return !!(S.apiKey || hasServerAI());
}

// ── Core AI call ──────────────────────────────────────────────
// Priority: 1) Server-side via OD.callAI (no user key needed)
//           2) Client-side via user's API key (existing behavior)
async function callClaude(messages, useWebSearch=false, _retries=2, maxTok=600, callType=null){
  // Smart model routing: if callType is set AND user has the required API key, route to optimal model
  // If user has manually set a provider/model in settings, respect that (user override)
  const S = window.S || window.App?.S || {};
  const userOverride = S.aiProvider && S.apiKey; // user explicitly configured a provider

  let effectiveProvider, effectiveModel;
  if (userOverride) {
    // User set their own key — use their choice
    effectiveProvider = S.aiProvider;
    effectiveModel = S.aiModel || PROVIDERS[S.aiProvider]?.defaultModel;
  } else if (callType && MODEL_ROUTING[callType]) {
    // Smart routing — pick optimal model for this task
    const route = MODEL_ROUTING[callType];
    effectiveProvider = route.provider;
    effectiveModel = route.model;
  } else {
    effectiveProvider = S.aiProvider || 'gemini';
    effectiveModel = S.aiModel || PROVIDERS[effectiveProvider]?.defaultModel;
  }

  // Web search only available on Anthropic — fall back if needed
  if (useWebSearch && effectiveProvider !== 'anthropic') {
    effectiveProvider = 'anthropic';
    effectiveModel = PROVIDERS.anthropic.defaultModel;
  }

  const sys = (typeof DHQ_IDENTITY !== 'undefined') ? DHQ_IDENTITY : 'Dynasty FF advisor. Values from DHQ (0-10000 scale, league-derived). Be specific with player names and DHQ values. Sleeper-ready messages when asked.';

  // ── SERVER-SIDE PATH: use OD.callAI Edge Function ──────────
  // Available when user has a Supabase session (no API key required)
  if(hasServerAI()){
    try{
      // Build a single context string from the messages array
      const lastUserMsg = [...messages].reverse().find(m=>m.role==='user');
      const contextParts = messages.map(m => m.role.toUpperCase()+': '+m.content).join('\n');
      const effectiveType = callType || 'recon-chat';
      const result = await window.OD.callAI({
        type: effectiveType,
        context: JSON.stringify({
          system: sys,
          messages: messages,
          callType: effectiveType,
          userMessage: lastUserMsg?.content || '',
          maxTokens: maxTok,
          useWebSearch: useWebSearch,
        }),
      });
      const reply = result?.analysis || result?.response || result?.text ||
        (typeof result === 'string' ? result : JSON.stringify(result));
      // Expose usage for UI (rate limit indicator)
      if(result?.usage){
        window.App.aiUsage = result.usage;
        window.dispatchEvent(new CustomEvent('ai-usage-updated', { detail: result.usage }));
      }
      // Cache the response in Supabase
      if(window.OD.saveAIAnalysis && S.currentLeagueId){
        window.OD.saveAIAnalysis(
          S.currentLeagueId,
          effectiveType,
          (lastUserMsg?.content||'').substring(0,200),
          reply
        ).catch(()=>{}); // fire and forget
      }
      return reply || 'No response.';
    }catch(serverErr){
      // Rate limit — show clear message, don't fall back to BYOK
      if(serverErr.message && serverErr.message.includes('Daily limit reached')){
        // Expose usage from error if available
        if(serverErr.usage) window.App.aiUsage = serverErr.usage;
        throw new Error(serverErr.message);
      }
      console.warn('[ai-dispatch] Server AI failed, falling back to client:', serverErr.message);
      // Fall through to client-side if user has an API key
      if(!S.apiKey) throw serverErr;
    }
  }

  // ── CLIENT-SIDE PATH: direct API calls with user's key ─────
  if(!S.apiKey) throw new Error('No AI available. Connect your account or add an API key in Settings.');

  // Fallback: if saved provider was removed (groq/openai/grok), default to gemini
  const provider = PROVIDERS[effectiveProvider] ? effectiveProvider : 'gemini';
  const apiKey = S.apiKey;
  const model = effectiveModel || PROVIDERS[provider]?.defaultModel || 'claude-sonnet-4-20250514';
  // Web search only works with Anthropic — silently disable for other providers
  if(provider !== 'anthropic') useWebSearch = false;

  for(let attempt=0; attempt<=_retries; attempt++){
    let res, data;
    try{
      if(provider === 'anthropic'){
        const body = {model, max_tokens:maxTok, system:sys, messages};
        if(useWebSearch){body.tools=[{type:'web_search_20250305',name:'web_search'}];body.max_tokens=Math.max(maxTok,1500);}
        const headers = {'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'};
        if(useWebSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
        res = await fetch('https://fragrant-brook-c770.jacobcrusinberry.workers.dev/', {method:'POST', headers, body:JSON.stringify(body)});
        if((res.status===429||res.status===529)&&attempt<_retries){await new Promise(r=>setTimeout(r,(attempt+1)*10000));continue;}
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error?.message||'API error '+res.status);}
        data = await res.json();
        if(data.error) throw new Error(data.error.message||'API error');
        return (data.content||[]).filter(c=>c.type==='text').map(c=>c.text||'').join('') || 'No response.';

      } else if(provider === 'gemini'){
        const body = {model, max_tokens:maxTok, messages:[{role:'system',content:sys},...messages]};
        res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {method:'POST', headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey}, body:JSON.stringify(body)});
        if((res.status===429)&&attempt<_retries){await new Promise(r=>setTimeout(r,(attempt+1)*10000));continue;}
        if(!res.ok){const e=await res.json().catch(()=>({}));throw new Error(e.error?.message||'API error '+res.status);}
        data = await res.json();
        if(data.error) throw new Error(data.error.message||'Gemini error');
        return data.choices?.[0]?.message?.content || 'No response.';
      }
    } catch(e){
      if(attempt < _retries && (e.message.includes('429')||e.message.includes('rate'))){
        await new Promise(r=>setTimeout(r,(attempt+1)*10000)); continue;
      }
      throw e;
    }
  }
  throw new Error('Rate limit — please wait and try again.');
}

// ── Grok News — real-time X/Twitter intelligence ──────────────
const _newsCache={};
async function callGrokNews(query, maxTok=300){
  const S = window.S || window.App?.S || {};
  const xaiKey=localStorage.getItem('dynastyhq_xai_key')||(S.aiProvider==='grok'?S.apiKey:'');
  if(!xaiKey)return null;
  try{
    const sys=(typeof DHQ_PROMPTS!=='undefined'&&DHQ_PROMPTS['player-news'])?DHQ_PROMPTS['player-news'].system:'You are a sports news aggregator. Provide recent NFL player news.';
    const res=await fetch('https://api.x.ai/v1/chat/completions',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+xaiKey},
      body:JSON.stringify({model:'grok-3-mini',max_tokens:maxTok,messages:[{role:'system',content:sys},{role:'user',content:query}]})
    });
    if(!res.ok)return null;
    const data=await res.json();
    return data.choices?.[0]?.message?.content||null;
  }catch(e){console.warn('Grok news error:',e);return null;}
}

// ── Expose on window.App AND window (for dhq-ai.js compatibility) ──
Object.assign(window.App, {
  PROVIDERS,
  MODEL_ROUTING,
  _newsCache,
  updateProviderHint,
  hasServerAI,
  hasAnyAI,
  callClaude,
  callGrokNews,
});

window.PROVIDERS = PROVIDERS;
window.updateProviderHint = updateProviderHint;
window.hasServerAI = hasServerAI;
window.hasAnyAI = hasAnyAI;
window.callClaude = callClaude;
window.callGrokNews = callGrokNews;
window._newsCache = _newsCache;

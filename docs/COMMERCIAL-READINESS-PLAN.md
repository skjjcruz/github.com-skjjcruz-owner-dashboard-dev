# Commercial-Readiness Plan — WarRoom + ReconAI

**Goal:** transition the two apps from a production-shaped prototype to a commercial-grade
service that stays up and stays fast as load grows from ~10K → 100K → 1M users.

**Strategy (decided):** *Phased hardening* on **Cloudflare** — keep the Supabase serverless
backend (already commercial-grade in pattern), re-architect the frontend / delivery / caching
layer in dependency order. No big-bang rewrite.

---

## 0. What "100% of the time" actually means

Literal 100% uptime is not achievable by anyone — AWS, Google, Stripe, and Supabase all
publish 99.9–99.99% SLAs. What we engineer for instead:

| Principle | Concrete target |
|---|---|
| **Service-level objective (SLO)** | **99.95% availability** (≈ 22 min downtime/month error budget) |
| **No single point of failure (SPOF)** | No one dependency can take the whole app down |
| **Graceful degradation** | If AI / a data provider / the DB hiccups, the app stays usable with reduced features, never a blank screen |
| **Blast-radius isolation** | A failure or abuse in one app/provider can't drain the other |
| **Observability** | We detect and alert *before* users report it |

The current architecture violates the first two: a single bad ReconAI Pages deploy breaks
**both** apps (SPOF), and GitHub Pages has no SLA. Phase 0 + Phase 1 fix that.

---

## 1. Target architecture (Cloudflare + Supabase)

```
              Cloudflare (edge / CDN / WAF / DDoS)
              ├─ Pages: WarRoom static app (built, versioned)
              ├─ Pages: ReconAI static PWA (built, versioned)
              ├─ Workers: edge cache + data proxy (Sleeper/ESPN/MFL/Yahoo)
              ├─ KV: shared rate-limit + hot-config
              └─ R2: large static assets (players.json, images)
                          │  HTTPS (JWT / anon key)
                          ▼
              Supabase (backend — unchanged pattern)
              ├─ Postgres + RLS  (+ Supavisor pooler, read replica)
              ├─ Edge Functions: ai-analyze, auth, billing
              └─ provider keys server-side
                          │
                          ▼
         Anthropic · Gemini · OpenAI · Stripe · Sleeper/ESPN/MFL/Yahoo
```

**Kept as-is (already commercial-grade):** server-side AI router with per-user + global
cost caps + kill switch; RLS on every table; Stripe + tiered plans; secrets server-side;
per-call telemetry.

**Re-architected:** hosting, shared-code delivery, caching, data plane, DB scaling,
rate-limiter correctness, observability.

---

## 2. Phases

Each phase is shippable on its own and raises the scale ceiling. Effort is rough
engineer-time. "Unlocks" = the user scale the app reliably supports after the phase.

### Phase 0 — Kill the SPOF (unlocks: reliability at any scale) · ~1 week

The runtime CDN coupling is the most "un-commercial" thing in the stack: WarRoom loads its
core business logic at runtime from ReconAI's Pages host via `js/shared/shared-loader.js`.
One bad ReconAI deploy → both apps break live, with only `||` fallbacks.

- [ ] **Replace live `<script>` CDN-sharing with a versioned, bundled package.**
      Publish ReconAI `/shared/*` as a private npm package (or git submodule pinned to a
      SHA). Both apps `import` a **pinned version**; a shared change ships only via an
      explicit version bump + redeploy — never live-mutating production.
- [ ] Delete the runtime fetch path in `shared-loader.js` once both apps build the shared
      package in.
- [ ] **Decide the Supabase project question** (see §5): this fork wires **two** projects
      (`hovnqztlbsgsywrbidbh` = WarRoom, `sxshiqyxhhifvtfqawbq` = ReconAI) while the
      architecture doc claims one. Pick one model deliberately and make CI + config agree.

**Exit:** no app can break another at runtime. Deploys are atomic and reversible.

### Phase 1 — Real host + build pipeline (unlocks: ~100K) · ~1–2 weeks

- [ ] **Move both frontends to Cloudflare Pages** (off GitHub Pages). Gets WAF, DDoS
      protection, edge headers, global CDN, instant rollback, and **preview environments**
      per PR.
- [ ] **Add a build step; remove in-browser Babel.** `@babel/standalone` (in WarRoom
      `package.json`) currently transpiles JSX in every visitor's browser. Move to a
      Vite/esbuild build (ReconAI already uses Vite) → smaller payloads, faster startup,
      no client CPU tax.
- [ ] **Cache headers + immutable hashed assets** so returning visitors hit cache, not origin.
- [ ] **CI/CD with preview + staged rollout:** PR → preview env → automated tests →
      promote to prod. Wire the existing test suites (`npm test`) as the gate.

**Exit:** production-grade host with WAF, rollback, preview envs, and a real build.

### Phase 2 — Caching + data plane (unlocks: ~250K, big cost drop) · ~2–3 weeks

The cheapest scaling win the analysis flagged. Today the browser hits Sleeper directly,
including the **~15MB `/players/nfl`** payload (`js/core.js`), and there is **no response
cache** anywhere.

- [ ] **Serve `players.json` from R2 as a versioned, gzipped asset** refreshed by a daily
      Worker cron — not a 15MB per-client download from a third party you don't control.
- [ ] **Put a Cloudflare Worker edge cache in front of Sleeper/ESPN/MFL/Yahoo.** Cache
      league/roster reads for a short TTL; collapses N client requests into 1 origin
      request and shields you from third-party rate limits.
- [ ] **Add response caching for AI** where safe (identical prompt+context → cached answer
      with short TTL) — directly lowers the AI bill.
- [ ] **Fix the proxy rate-limiters.** `espn-proxy` (keyed by IP) and `mfl-proxy` (keyed by
      user id) both use an **in-memory `Map`** that stops limiting once Edge Functions
      autoscale. Move to **Cloudflare KV / Deno KV** (shared across isolates) and unify the
      keying. This is a real abuse/cost hole today.

**Exit:** you own your data plane, third-party dependency risk is contained, and AI/data
cost per user drops.

### Phase 3 — Database scale + quota consolidation (unlocks: ~500K) · ~2–3 weeks

Every AI call does **1 invocation + 3 DB writes + 2 analytics writes**, all synchronous,
against a single Postgres primary.

- [ ] **Enable Supavisor/pgBouncer transaction pooling** (config today shows tiny local
      pool defaults) and right-size connections.
- [ ] **Add a read replica** for read-heavy paths (profiles, league data, analytics reads).
- [ ] **Batch/queue the high-volume writes.** `analytics_events` (insert-only, 2/call) and
      usage accounting should be buffered (Worker queue / async) instead of inline on the
      request path. Partition `analytics_events` by time.
- [ ] **Consolidate the three quota systems into one.** Today: `reserve_ai_usage` +
      `ai_usage_daily/monthly` (WarRoom), legacy `increment_rate_limit` + `ai_rate_limits`
      (ReconAI), **plus** a Deno-KV 10/min limiter in `ai-analyze`. Standardize on the
      `reserve_ai_usage` model; retire the legacy path. Verify the global-cost aggregation
      isn't a hot-row contention point under load.

**Exit:** the DB is no longer the concurrency ceiling; quota logic is one auditable system.

### Phase 4 — 1M / concurrency readiness + operability (unlocks: 1M) · ~3–4 weeks

"1M pinging at once" is a *concurrency* problem (tens of thousands of RPS), past today's
~1–3K RPS ceiling **and** past provider org-level rate limits.

- [ ] **Queue + backpressure in front of AI providers.** On provider 429/503, return a
      graceful "busy, retrying" state, not an error. The router already has provider
      fallback (Anthropic→on 429); extend with a real queue + retry/jitter.
- [ ] **Raise provider quotas** (Anthropic/OpenAI/Gemini org RPM/TPM) ahead of launch; keep
      the cheap-tier routing + prompt caching that already exist.
- [ ] **Extend `scripts/ai-scale-load-model.cjs`** to add a **1M tier and an RPS/concurrency
      dimension** (today it hard-asserts 2M invocations as the ceiling and models only
      monthly volume). Wire the stubbed staging probe (`AI_LOAD_SEND`) to a staging endpoint
      and capture real p50/p95 before launch.
- [ ] **Run a real load test** to 1M-equivalent peak; tune from measured numbers.
- [ ] **Observability + alerting + on-call:** dashboards for availability, p95 latency,
      error rate, AI cost burn vs. the $50/day-$1000/mo caps, provider health. Alert on SLO
      burn. Sentry is already wired — add uptime + synthetic checks + paging.
- [ ] **Runbooks + DR:** documented kill-switch use (`AI_KILL_SWITCH`), provider-outage
      playbook, DB failover/restore drill, and a tested rollback for every deploy surface.

**Exit:** the system holds at 1M peak with measured headroom, alarms before users notice,
and a human can recover any failure mode from a runbook.

---

## 3. Cross-cutting (every phase)

- **Security:** Cloudflare WAF + rate limiting at the edge; keep secrets server-side; keep
  RLS. Add bot/DDoS rules before launch.
- **Blast-radius:** decide whether WarRoom and ReconAI share one Supabase project or two
  (§5). Two = isolation (one app's abuse can't drain the other's global AI cap); one =
  simpler ops. This is a deliberate trade, not an accident to leave unresolved.
- **Cost governance:** keep the per-user + global caps; add cost-burn alerting so the
  circuit breaker is a backstop, not the first signal.

---

## 4. Cost ceiling reality (from `ai-scale-load-model.cjs`)

| Users | AI cost / mo (normal mix) | AI cost / mo (premium-heavy) |
|---|---|---|
| 1,000 | ~$103 | — |
| 100,000 | ~$8,844 | ~$74,016 |
| 1,000,000 | ~$88K | ~$740K |

≈ **$0.088 / user / month** at the normal mix. Per-user monthly cost caps (free $1,
warroom $6, pro $35, commissioner $150) bound worst case — AI spend scales with your *paid
mix*, not raw traffic. Infra (Cloudflare + Supabase scale tier + R2/KV) is a small fraction
of the AI line at every milestone.

---

## 5. Open decisions to confirm

1. **One Supabase project or two?** Code wires two; doc says one. Drives §3 blast-radius.
2. **Shared-package mechanism:** private npm registry vs. pinned git submodule for the
   ReconAI `/shared` code (Phase 0).
3. **Target launch scale + date:** sets how far down the phases we go before go-live.

---

## 6. Sequence summary

```
Phase 0  Kill SPOF (versioned shared pkg)        ~1 wk   → reliability
Phase 1  Cloudflare Pages + build step           ~1-2 wk → ~100K
Phase 2  Caching + data plane + proxy fix        ~2-3 wk → ~250K, cost↓
Phase 3  DB scale + quota consolidation          ~2-3 wk → ~500K
Phase 4  Concurrency + observability + DR         ~3-4 wk → 1M
```

Total ≈ **9–13 weeks** of focused work to a measured-1M-ready, 99.95%-SLO commercial
service, keeping the existing backend pattern and re-architecting only the delivery layer.

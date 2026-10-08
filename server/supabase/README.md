# DHQ serving endpoint (engine project)

`functions/dhq-tools` answers questions about a member's leagues from what the
engine builder stored, in milliseconds. One URL, two ways in: MCP (JSON-RPC:
initialize, tools/list, tools/call) for ChatGPT / Claude / Gemini / any agent,
and plain REST (`POST {"tool": "...", "args": {...}}`).

- Auth: `Authorization: Bearer dhq_ck_…` — a DHQ Connect key minted with the
  "Engine admin" workflow (mint-key). Only the key's SHA-256 is stored.
- Scope: every tool is limited to leagues the key's member has a team in.
- Read-only. Nothing writes to Sleeper or any league.
- Deployed by `.github/workflows/engine-deploy.yml` to project
  `hovnqztlbsgsywrbidbh` (never the live app's project). The trade math is the
  engine's own trade-engine.js, vendored into the function at deploy time.

Local check: `deno run --allow-read --allow-env functions/dhq-tools/local-test.ts`
after a builder dry run (see ../engine/README.md).

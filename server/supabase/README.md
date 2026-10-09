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

## How the tools are organised (dhq-tools 0.5)

- **Verdict tools** (`verdicts.ts`) run the app's own methods and return a
  call with its reasons: `get_start_sit` (the Lineup screen's solver, from
  `js/shared/startsit-engine.js`), `get_roster_needs` (the team assessor),
  `get_player_outlook` (the player-action chain), `compare_players`,
  `find_trade_targets` (the Trade Center partner board), `get_draft_board`,
  `get_waiver_bid` (the FAAB model, `js/shared/faab-engine.js`). DHQ decides;
  the member's AI explains.
- **Data tools** (`tools.ts`): leagues, teams, players, projections, matchup,
  trades, waivers, pick values.
- **Methods** (`skills.ts`): one plain-English method per question type,
  served as MCP prompts and attached to each verdict as `method`.
- **Live facts** (`live.ts`): lineups, live points, game status and injury
  designations are read from Sleeper at answer time; values come from the
  two-hourly build. Results carry `live_as_of` and `numbers_as_of`.
- **News**: the builder stores each NFL team's last week of ESPN headlines;
  a player's latest report is read live from ESPN's public feed.
- **Usage and limits**: every call is logged to `connect_usage`; a key may
  make 60 calls a minute.

## The question bank

`question-bank.ts` asks the tools real member questions and checks each
answer contains the facts it must. It runs in `engine-deploy.yml` before
anything is deployed, against a dry-run build of the test league. When an
answer goes wrong in real use, add a question for it here first.

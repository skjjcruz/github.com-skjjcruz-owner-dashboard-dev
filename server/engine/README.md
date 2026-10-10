# DHQ engine on the server

The same engine the app and website run in the browser (`reconai-shared/*.js`),
run in Node against Sleeper, with the result stored in the engine Supabase
project (`hovnqztlbsgsywrbidbh`, separate from the live app's database).

- `headless.js` — a browser stand-in that loads the engine files unchanged and
  builds one league from Sleeper. No engine code is modified.
- `run.js` — builds every active league in `connect_leagues`, upserts into
  `league_intel`, keeps shared lookups in `engine_cache`, logs to `engine_runs`.
- `schema.sql` — the tables (idempotent; RLS on, service role only).
- `.github/workflows/engine-build.yml` — runs it every 2 hours and on demand.

Local dry run (no database): `LEAGUES=<league id> node server/engine/run.js --dry`
writes `server/engine/out/<league id>.json`.

Besides the engine's output (`intel`, `assessments`, `dna`), each row's
`snapshot` carries the raw league facts the serving tools read: rosters, users,
picks, this season's waiver/FA moves (`txns`), every regular-season week's
matchup rows (`weeks`: `{week: [{roster_id, matchup_id, points}]}`, future
weeks are the posted pairings with 0 points) and past seasons (`history`: each
season's roster owners and weekly scores, cached in `engine_cache` once a
season is complete).

Why a scheduled job and not an edge function: a cold league build pulls ~200
Sleeper calls and ~30 MB of stats and takes 3–5 s of CPU; edge functions get 2 s.
The build runs here, the serving layer (later) reads the stored result in ms.

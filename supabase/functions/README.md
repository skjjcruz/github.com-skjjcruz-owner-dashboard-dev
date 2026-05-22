# Supabase Function Ownership

The production Supabase project is shared by Scout and War Room. War Room owns
account, billing, admin, and server AI functions.

## Owned Here

- `ai-analyze` - official server AI routing, rate limits, telemetry, and model policy.
- `get-session-token` - legacy Sleeper username JWT session issuer.
- `set-password` - gifted-user password setup.
- `fw-signup`, `fw-signin` - email auth.
- `fw-create-checkout`, `fw-stripe-webhook` - Stripe subscription lifecycle.
- `admin-list-users` - admin user/subscription listing.

## Owned By ReconAI

- `espn-proxy` - ESPN private league proxy.
- `mfl-proxy` - MyFantasyLeague CORS/server relay.
- `yahoo-proxy` - Yahoo OAuth callback, token storage, refresh, and API proxy.

Deploy individual functions by name from the owning repo. Do not deploy a
same-named function from the other repo.

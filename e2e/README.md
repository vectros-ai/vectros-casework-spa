# casework-spa e2e smoke suite

Playwright e2e test for this app. Runs against a local Vite dev server (or a real deployed
instance, with `--deployed`) driving your Vectros API, using a dedicated Auth0 test identity —
never a real human's account. Useful both to verify your own fork after deploying it and as a
template for testing your own customizations.

## What it covers

Six spec files, run in numeric order (`fullyParallel: false`, `workers: 1`):

- **`01-login-failure.spec.ts`** — a bad/forged authorization code at `/callback` shows the app's
  own "Sign-in failed" error screen, not a blank page. No real Auth0 login involved — deliberately
  its own file so it never pays for (or depends on) a real hosted-login round trip.
- **`01-login.spec.ts`** — sign in through the real Auth0-hosted Universal Login page, land
  authenticated, mint a Vectros partner-API token off the session.
- **`02-orgs.spec.ts`** — create (idempotent — reuses an existing fixture org by name), edit, and
  delete an org.
- **`03-clients.spec.ts`** — create (idempotent, org-scoped), edit, archive/reactivate a client.
- **`04-cases.spec.ts`** — create a case for an existing client, the status filter (`All`/`Open`/
  `Active`/`Closed`), case-detail status change + add an entry, and the org column that only
  appears once a caller's cases span more than one org.
- **`05-team.spec.ts`** — the roster lists the signed-in caller correctly, and a live invite
  exercises the invite flow end to end.

`fixtures/testData.ts` holds the shared, idempotent fixture-creation helpers (`ensureOrgExists`,
`ensureClientExists`, `pickOrgIfPresent`) the org/client/case specs build on — two persistent
fixture orgs (`Smoke Org A`/`Smoke Org B`) and one fixture client, reused across runs rather than
grown fresh every time. Cases and team invites are **not** deduped the same way: neither has a
delete UI in this app, so each run creates a little more of both — accepted as harmless clutter,
the same tradeoff most e2e suites make elsewhere.

## Known gaps — named, not silently dropped

- **No "Ask" (RAG) coverage.** `CaseAskPanel` (the case-scoped Ask drawer) isn't exercised.
  Streaming SSE interactions are a heavier automation surface than the rest of this suite, and
  there's no standalone Ask page (it's reached only from a case's detail screen).
- **No document upload coverage.** `AddCaseDocumentDialog` isn't exercised.
- **No `case-handler`-role coverage.** Every spec runs as the smoke user, provisioned as
  `hr-admin` — the broadest role, covering the most screens. `case-handler`'s own, narrower access
  paths (self-founded-only clients, membership-gated reach) are untested here.
- **No full accept-invite round trip for a SECOND identity.** `05-team.spec.ts` confirms an invite
  succeeds and the roster reflects it, not a second party actually accepting it and signing in.
  (The smoke user's OWN accept-invite + first-login round trip **is** exercised — see
  `fixtures/authed.ts` — this gap is specifically about a *second*, distinct identity's full loop,
  which would need its own throwaway Auth0 user.)
- **Multi-org membership-only discovery path untested.** `useAccessibleOrgs`/`useAccessibleClients`
  union founder reach with membership reach; this suite only exercises the founder path (the smoke
  user founds every fixture org/client itself).

## Setup

### Prerequisites

- Node.js >= 20
- **The app itself already set up** — its own `.env.local` (`VITE_AUTH0_DOMAIN` /
  `VITE_AUTH0_CLIENT_ID` / `VITE_AUTH0_AUDIENCE` / `VITE_VECTROS_EXCHANGE_URL` /
  `VITE_VECTROS_API_URL`), per the repo root `README.md`. This suite does NOT set those for you —
  it only supplies the test user's own credentials (below). Skip this if you're only ever running
  `--deployed` against an already-deployed instance (no local Vite boot, so the app's own env
  config is irrelevant here).
- A dedicated test user in your own Auth0 tenant (not a real human's account)
- **A local dev cert for the app** (`.cert/` at the repo root) — this suite runs the app over
  `https://localhost:3003`, not plain `http`, because the invite flow's `acceptUrl` validation
  requires it. Generate one per clone/machine — see `../docs/AUTH0-SETUP.md`. Not needed for
  `--deployed` mode.

### One-time

```bash
cd e2e
npm install
npx playwright install chromium
cp .env.example .env    # fill in SMOKE_USER_EMAIL / SMOKE_USER_PASSWORD

cd ..
npm install    # skip if you're only ever running --deployed
```

### Per-run

```bash
cd e2e

./run.sh                                                    # full suite, local Vite vs your API
CASEWORK_SPA_DEPLOYED_URL="https://your-deployment.example.com" ./run.sh --deployed
./run.sh tests/01-login.spec.ts                              # one spec (either mode)
./run.sh -- --headed                                         # extra playwright args after --
```

`run.sh` loads your `.env`, lets Playwright's `webServer` block boot/reuse the local dev server
(skipped entirely in `--deployed` mode), and never prints your password — even accidental leakage
into Playwright's own output is scrubbed before anything reaches the terminal.

`--deployed` points at a real deployed instance instead of booting a local server — faster
feedback, and the actual hosted-vs-local parity check this suite exists to give. See
`../docs/VERCEL-SETUP.md` for deploying your own.

## Notes

- **One test has a known, low-frequency flake**: `04-cases.spec.ts`'s status-change case races
  real async record indexing (`case` is a HYBRID-indexed schema — indexing runs after create, and
  its own write bumps the record's version). The spec gives it a real settle window and retries,
  but there's no deterministic signal in this UI to poll instead of guessing a duration. If it
  flakes, re-run rather than chase full determinism here.
- **A generic "Sign-in failed" page (or a `freshLogin` timeout) is almost never Auth0's own
  infra** — it's this app's `CallbackPage.tsx` rendering its own error state. Before assuming an
  Auth0-side cause (rate limit, brute-force lock), match the on-screen copy against
  `src/i18n/messages.en.json` and pull a real network trace (`./run.sh <spec> -- --trace on`, then
  inspect the trace's network log) — a real code regression looks identical to infra throttling
  from the screenshot alone.
- Every run does a real, fresh, successful Auth0 login for the smoke user; [Auth0's own documented
  rate limit](https://auth0.com/docs/troubleshoot/customer-support/operational-policies/rate-limit-policy)
  for a database-connection login (20 attempts/minute from one IP to the same account, successes
  included) is real but unlikely to be your first explanation for a failure.

# Casework

A forkable HR case-management reference app for the Vectros platform, built entirely as a static
single-page app — **no application server of its own**. Sign-in is handled by Auth0; every other
read and write goes straight from the browser to the Vectros API, authorized by a token your Auth0
tenant and the Vectros platform exchange directly.

A **RAVV stack** app — **R**eact, **A**uth, **V**ercel, **V**ectros: a UI framework, an identity
provider, a static host, and a data/authorization platform, with nothing else in between. The
[Quickstart](#quickstart) below is the fastest path from a fork to a running instance; each of the
four pieces has its own deeper setup doc linked from there.

**HR case management isn't the point.** This app demonstrates one specific way to grant access on
Vectros: an org invites its own members, and nobody signs themselves up. Swap the domain and the
same shape works for client engagements at a firm, field-service jobs, or anything where "who's in
my org" and "what can they see" needs enforcing, not just displaying. It's a genuine, non-toy
reference implementation, not a claim that this specific app is ready to replace a real HR product.
Other access shapes Vectros supports (a self-signed-up founder creating their own isolated
compartment, a public "floor" role with staff elevated on top) use the same underlying primitives
differently; this is the first one published.

**What's built:**

- Sign-in via Auth0 (Universal Login, token exchange, session handling)
- Org, client, and case management
- A team roster with an invite flow
- A self-service account page (password reset, two-factor management)
- A chat-style "Ask" panel grounded on a case's own notes and documents (full access for
  `hr-admin`; `case-handler`'s access is still blocked on a platform-side scope limitation, see
  `CaseAskPanel.tsx`'s header comment)
- Every list paginated through to the end, not just the first page

## Why no backend?

Vectros gives this app a full backend already: a secure, scalable, structured data store (typed
records and documents) with full-text search, semantic search, and flexible filtering unified into
one hybrid index, per-compartment isolation enforced structurally rather than by a WHERE clause you
have to remember every time, grounded AI answers with citations over that same data, and a
tamper-evident audit trail. None of that is application code here: it's driven entirely by the
declarative access policy in [`blueprint/casework.blueprint.yaml`](blueprint/casework.blueprint.yaml).
There's no API layer to write, deploy, or secure, because there's no API layer: this app talks to
Vectros's own API directly, and Vectros's own authorization model does the rest.

## Stack

- **React 19** + **TypeScript**, built with **Vite**
- **[@vectros-ai/react](https://www.npmjs.com/package/@vectros-ai/react)** — the shared auth
  adapter, layout shell, and schema-driven form/list primitives
- **Auth0** (`@auth0/auth0-spa-js`) — hosted sign-in via Universal Login
- **MUI** for UI primitives, **TanStack Query** for data fetching, **react-router** for routing,
  **react-intl** for copy

## Quickstart

Five steps, in order, from a fork to a running instance with your own first admin signed in. Each
step links to a deeper doc for the parts worth explaining in full rather than cramming here.

**1. Clone and install**

```bash
npm install
cp .env.example .env.local
```

Fill in `.env.local` with your Auth0 application's domain, client ID, and audience, and your
Vectros API host once you have them from steps 2-3 below — see `.env.example` for what each
variable means. Needed before `npm run dev` will start (`src/config.ts` fails fast at module load
on a missing value); not needed for step 4's Vercel deploy, which reads the same values from the
Vercel dashboard's own environment variables instead.

**2. Set up Auth0** — a tenant, an application, an API, and the (easy-to-miss) step that
authorizes one for the other. Full walkthrough: [`docs/AUTH0-SETUP.md`](docs/AUTH0-SETUP.md).

**3. Apply this app's blueprint to your Vectros deployment** — provisions the roles, schemas, and
trusted-issuer registration this app needs; creates no users yet.
[`docs/AUTH0-SETUP.md`](docs/AUTH0-SETUP.md) step 5 has the exact command
(`vectros bootstrap --blueprint blueprint/casework.blueprint.yaml ...`).

**4. Deploy to Vercel** (or any static host — see that doc for the general shape). Full
walkthrough: [`docs/VERCEL-SETUP.md`](docs/VERCEL-SETUP.md). You'll need this step's deployed URL
to finish step 2's callback-URL registration and to send the invite in step 5 — the two are meant
to be done together, not strictly in the order listed here.

**5. Invite yourself as the first admin.** This app has no self-signup — every account, including
the very first one, is invited. That's deliberate: it's built for a single company's own
case-management team, not a public sign-up funnel, so there's no "create an account" link anywhere
in the UI. Send yourself an `hr-admin` invite with the CLI, no root key needed. **`--accept-url`
is required** — the platform sends the invite email itself by default, and refuses the call
without somewhere to point it — so this step needs step 4's real, publicly-reachable deployed URL:

```bash
vectros login   # if you aren't already
vectros identity invite --context casework --role hr-admin --email admin@example.com \
  --accept-url "https://<your-deployed-app-url>/accept"
```

Accept the invite email, sign in, and you'll land on this app with full admin access — from there,
use the Team screen to invite everyone else the normal way. This one CLI command is the only step
that happens outside this app's own UI.

**Working locally instead of deploying first?** Once `.env.local` is filled in (step 1), `npm run
dev` gets you developing and signing in against a local dev server for steps 2-3 without ever
reaching step 4 — come back to deploying when you're ready to invite a real first admin (step 5
needs a real deployed URL either way).

### Forking

Every place this app hardcodes a name, color, or copy string is deliberately routed through one of
a small number of files:

- `src/brand.ts` — product name, colors, support contact
- `src/theme.ts` — derives the MUI theme from `src/brand.ts`
- `src/config.ts` — runtime configuration (Auth0 + Vectros API endpoints), read from `VITE_*`
  env vars
- `src/i18n/messages.en.json` — this app's own copy (merged over `@vectros-ai/react`'s shared
  component strings)

To use a different identity provider, replace the `Auth0AuthProvider` instantiation in
`src/main.tsx` with an adapter implementing `@vectros-ai/react`'s `AuthProviderAdapter` interface
(a Cognito reference implementation ships in the same package).

**Forking with a coding agent?** See [`docs/AGENTS.md`](docs/AGENTS.md) — a machine-oriented
reference to every override point above, the data model, and the invariants that must not break.
Get the blueprint's permission grants wrong and it's a narrow, reviewable mistake in one file; the
platform enforces the isolation either way, not the agent.

## Smoke testing

A Playwright smoke suite exercising this app end to end (sign-in, orgs, clients, cases, and the
team/invite flow) ships alongside this app in an `e2e/` directory, pointed at your own test
credentials instead of ours. Run it with `e2e/run.sh` against a local dev server or your own
deployed instance. It isn't wired into CI as an automated regression gate yet; that's tracked
separately.

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview a production build locally |
| `npm test` | Run the test suite once |
| `npm run test:watch` | Run tests in watch mode |
| `npm run lint` | Lint the source tree |
| `npm run format` | Format with Prettier |

## License

Apache-2.0 — see [LICENSE](LICENSE).

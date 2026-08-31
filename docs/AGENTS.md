# AGENTS.md — forking this app with a coding agent

Machine-oriented reference for an agent (or a human moving fast) adapting this app to a new
brand, identity provider, or data model. Human-oriented walkthroughs live in the
[README](../README.md), [`AUTH0-SETUP.md`](AUTH0-SETUP.md), and [`VERCEL-SETUP.md`](VERCEL-SETUP.md) — read
this instead when the task is "change file X to do Y," not "understand the product."

Every pointer below names the file that is the actual source of truth. Where this doc and that
file disagree, the file wins — this doc summarizes, it does not redefine.

## The shape of the app in one paragraph

A Vite + React + TypeScript SPA with **no application server of its own**. Every read/write goes
straight from the browser to the Vectros API, authorized by a token exchanged from an Auth0
session. All authorization — who can see which org/client/case, who can invite whom — is enforced
by the Vectros platform against the access policy in
[`blueprint/casework.blueprint.yaml`](../blueprint/casework.blueprint.yaml), not by any code in
this repository. This app renders UI and calls the SDK; it does not decide who is allowed to do
what.

## Override points (rebrand / re-theme / recopy)

| To change | Edit exactly this file | Nothing else should hardcode this |
|---|---|---|
| Product name, brand colors, support email | [`src/brand.ts`](../src/brand.ts) — the `BrandConfig` interface documents every field | No component, page, or string literal in `src/` should hardcode a product name or hex color |
| Derived MUI theme (typography, component overrides) | [`src/theme.ts`](../src/theme.ts) — consumes `BRAND.colors`, nothing else | — |
| Runtime config (Auth0 domain/client id/audience, Vectros API URLs) | [`src/config.ts`](../src/config.ts) — `requireEnv`-backed, fails fast at module load if a `VITE_*` var is missing | Never read `import.meta.env` directly outside this file |
| User-facing copy (English) | [`src/i18n/messages.en.json`](../src/i18n/messages.en.json) — merged over `@vectros-ai/react`'s own shared-component strings | No literal UI string in JSX — always `<FormattedMessage id="…">` or `intl.formatMessage` |
| Logo asset | Drop a file in [`public/`](../public/) and point `BrandConfig.logo` at it (omit to fall back to text) | — |

## Identity provider

This app ships an Auth0 adapter. To swap identity providers:

1. Implement `@vectros-ai/react`'s `AuthProviderAdapter` interface — consult that package's
   published types (`node_modules/@vectros-ai/react/dist/**/*.d.ts` once installed, or its own
   docs) for the exact shape. A Cognito reference implementation ships in the same package
   (`@vectros-ai/react/providers/cognito` — mirrors the shape `Auth0AuthProvider` below uses) —
   read it before writing a third adapter from scratch.
2. Replace the `Auth0AuthProvider` instantiation in [`src/main.tsx`](../src/main.tsx) (imported
   from `@vectros-ai/react/providers/auth0`) with your adapter.
3. This app's own [`src/auth/index.ts`](../src/auth/index.ts) narrows the package's generic
   `useAuth()` to a `HostedRedirectAuth` facet via `assertHostedAuth` — keep that narrowing if
   your new provider is also a hosted-redirect flow (Authorization Code + PKCE, no embedded
   credential form); replace it if not. Every call site in `src/` imports `useAuth`/`useScopeGate`
   from `./auth`, never from `@vectros-ai/react` directly — preserve that indirection so a future
   provider swap stays a one-file change.
4. Update [`blueprint/casework.blueprint.yaml`](../blueprint/casework.blueprint.yaml)'s `issuers:`
   block to match your provider's issuer/JWKS/audience shape, and re-apply it
   (`vectros blueprint apply`) — the platform trusts tokens by issuer, not by "was built with
   Auth0."

## Data model

The entire data model — schemas, identity namespaces, roles, and every access-control clause — is
declared in one file: [`blueprint/casework.blueprint.yaml`](../blueprint/casework.blueprint.yaml).
Its own header + inline comments are the canonical explanation of every design decision (why a
clause is scoped the way it is, why a dimension is included or omitted) — read it directly rather
than this doc's summary of it. Two things worth knowing before you start editing it:

- **A schema field or a role clause you add here is the ONLY way to grant new access** — there is
  no code-level authorization anywhere in `src/`. If a screen needs new data, it needs a new
  schema field (or type) AND a role clause granting the relevant verb on it, in the same change.
- **Adding a new record/entity type**: declare it under `schemas:`, then add the corresponding
  `allowedActions` entries to whichever role(s) should reach it under `roles:`. The two existing
  roles (`case-handler`, `hr-admin`) are a good template for the create/read/update/delete-split
  pattern this blueprint uses throughout — read either role's own clauses top to bottom before
  adding a third role or a new resource type.

## Invariants — do not break these

- **No application server.** Every network call in `src/api/` and `src/hooks/` goes directly from
  the browser to the Vectros API (via [`src/api/vectrosApi.ts`](../src/api/vectrosApi.ts)'s
  `vectrosApiClient()`) or to Auth0. Do not introduce a backend/proxy/serverless function — the
  whole point of this reference app is that none is needed.
- **All authorization lives in the blueprint's access policy, never in this app's code.** A
  component may hide a control the caller can't use (better UX), but must never be the thing that
  actually prevents an unauthorized call — the platform enforces that regardless of what the UI
  does. If you find yourself writing an `if (role === 'hr-admin')` check to protect data, the fix
  belongs in the blueprint's `dataScope`, not in `src/`.
- **`acceptUrl` must be `https://` with a non-IP-literal host before the first invite works** —
  `https://localhost:3003` satisfies this (a local dev server is fine); `http://127.0.0.1:3003`
  does not. The exact rule (and why — anti-open-redirect/anti-SSRF, not a "must be reachable from
  the internet" requirement) is `AUTH0-SETUP.md` §4a's, not restated here. This app builds
  `acceptUrl` from `window.location.origin` at call time (`src/api/inviteMember.ts`), so wherever
  the app is actually served from must satisfy that rule.
- **`vectrosApiClient()` is a lazy singleton** (`src/api/vectrosApi.ts`) — this app is
  single-tenant/single-context by construction (see that file's own header comment for why).
  Don't add a second client instance or a tenant-switching mechanism without first reading why one
  doesn't exist today.
- **`hr-admin`/`case-handler` role ids stay hyphenated, not underscored** — the platform's role-id
  validation rejects an underscore; see the blueprint's own comment on `roles:`.

## Verifying a change

This app ships with an end-to-end Playwright suite in [`e2e/`](../e2e) (sign-in, orgs, clients,
cases, team/invite) that runs against a real Vectros deployment using your own Auth0 test identity
— see [`e2e/README.md`](../e2e/README.md) for setup and `e2e/run.sh` to run it. It's the fastest way
to confirm a change didn't break the core flows, but it has real gaps, named in its own README: no
`case-handler`-role coverage (every spec runs as `hr-admin`, the broader role), no "Ask" panel
coverage, no document-upload coverage. Don't treat a green run as proof those paths still work.
It also isn't wired into this repo's own CI as an automated gate — run it yourself before and after
a change that touches auth, roles, or any of the flows it does cover.

## Where to look for the "why," not just the "what"

Nearly every non-trivial piece of this app carries a header comment explaining the design
reasoning, not just the mechanics — that comment is the canonical explanation, written closer to
the code than any external doc can stay. Before asking "why is this built this way," read the
file's own top-of-file comment first:

- `src/api/createCase.ts`, `src/api/inviteMember.ts` — the multi-call sequences with no
  server-side rollback, and why that's an accepted platform limitation, not a bug.
- `src/lib/drainPages.ts` — the pagination-draining helper every list query in this app uses;
  read it before adding a new paginated list.
- `src/pages/protected/cases/CaseAskPanel.tsx` — the RAG "Ask" panel's scope requirements, and
  the one platform-side limitation ([`README.md`](../README.md)'s "What's built" list references
  it too) that still blocks `case-handler`'s own access to it.

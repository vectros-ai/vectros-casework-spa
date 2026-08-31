# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.0.0] - 2026-08-30

### Added

- Vite + React + TypeScript app scaffold, deployable to Vercel with zero application server —
  fork it, point it at your own Auth0 tenant and Vectros tenant, and ship. `docs/AUTH0-SETUP.md`
  and `docs/VERCEL-SETUP.md` walk through both setups end to end, including two Vercel-specific
  gotchas found by actually deploying this app: Vercel's Deployment Protection blocks Auth0's own
  callback redirect unless disabled for Production, and the `vercel.json` this repo ships is what
  keeps client-side routes (`/callback`, specifically) from 404ing on a direct navigation.
- Auth0 Universal Login sign-in (`/login`, `/callback`) via `@vectros-ai/react`'s
  `Auth0AuthProvider` and the Vectros token-exchange endpoint, plus an accept-invite flow
  (`/accept`) for this app's Shape 1 (Captive Enterprise, no self-signup) access model: reads the
  invite token off the URL, drives the same Auth0 hosted-redirect flow as sign-in, then binds the
  invite once Auth0 returns — surfacing a real error if the bind itself fails, rather than
  dropping the invitee onto an empty Home screen with no explanation.
- Org management: list, create, and edit a founder's orgs — creating one navigates straight to its
  detail page.
- Client management: list, create, edit, and archive/reactivate a client (an employee) within an
  org, with data isolation between the `hr-admin` and `case-handler` roles. Creating one navigates
  to its detail page; archiving confirms first; both actions confirm success explicitly; a
  breadcrumb links back to the client's own org.
- Case management: create a case for a new or existing client — creating the client and its
  document folder in the same flow, gated on `records:c:case`; a filterable case list
  (open/active/closed/all), tolerant of a partial per-org load failure, with an org column shown
  once a caller's cases span more than one org; a status-change control that confirms success and
  re-syncs the cached record on a version conflict; a chronological entries list (`case_note`)
  whose composer only flags a required field once it's been touched, not the instant the page
  loads; and a document list/upload section.
- Team management: an org roster (a pending invitee shown with its own status and color, distinct
  from an active member) and an invite flow for adding `hr-admin`/`case-handler` users.
- Every list in the app — orgs, clients, team roster, cases, case entries, case documents — is
  fully paged rather than showing only the platform API's first page (`src/lib/drainPages.ts`), so
  a real deployment that grows past the default 20-per-page ceiling doesn't lose access to
  anything past it.
- Account management: profile info, a self-service password-reset email (database-connection
  users only — auto-detected via Auth0's own `sub` claim convention), and two-factor-authentication
  management by re-running sign-in into Auth0's own hosted enrollment screens. Both are zero-backend
  by design; see `docs/AUTH0-SETUP.md` for turning on MFA and an optional upgrade path once Auth0's
  My Account API is available on your tenant.
- A full end-to-end smoke-test suite (sign-in, orgs, clients, cases, team/invite), runnable
  against a local dev server or a real deployed instance. Ships alongside the app in this release
  as a fork-runnable `e2e/` directory; not yet wired into CI as an automated gate. See this
  README's "Smoke testing" section.
- Brand/theme/config seams (`src/brand.ts`, `src/theme.ts`, `src/config.ts`) for forking.
- This app's own access-control blueprint, `blueprint/casework.blueprint.yaml` — apply it, edit
  it, fork it from right here. `docs/AUTH0-SETUP.md` step 5 and the README's Quickstart both walk
  through applying it.

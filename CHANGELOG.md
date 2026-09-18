# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [1.2.1] - 2026-09-17

### Fixed

- **Creating a client with a start date no longer fails with a non-ISO-format error.** The field
  had no `date`-only widget hint, so it defaulted to a datetime-local picker; the browser's
  timezone-naive `YYYY-MM-DDTHH:mm` value failed the platform's ISO validation on save. An
  employee's start date has no time component to begin with — it's now a plain date picker, and
  the value it sends (`YYYY-MM-DD`) is accepted. ⚠️ **Re-apply this blueprint** (this app's own
  Quickstart step 3) for existing deployments — this is a `renderHints` change on the
  `client_profile` schema, fetched live from the platform rather than baked into this app's build.
- **Uploading a document to a case now works against an API that makes presigned upload URLs
  single-use.**
  Such an API bakes a conditional-write header into the upload URL's signature and names it in the
  upload response (`requiredHeaderName` / `requiredHeaderValue`); a PUT without that header is
  rejected by storage with a 403. The app now sends whatever header the response names, and no
  extra header when the response names none, so it works against API versions on either side of
  the change.
- **Re-running a search no longer re-issues every page already loaded.** Refreshing a search, or
  submitting the same term again, used to re-fetch each page that "Load more" had loaded, one
  search request per page. It now starts again from the first page. A repeat submit while a search
  is still running is ignored rather than sending a duplicate request. Going back to an earlier
  search, or the network reconnecting, no longer re-fetches every loaded page either: going back
  runs its first page once, and a reconnect runs nothing.
- **Three source comments carried repo-relative internal paths** to sibling reference apps
  (a type-pinning comment, the ESLint config header, and a pagination comment) that resolve to
  nothing in this app's own public mirror. Reworded to state the same guidance descriptively instead; no
  behavioral change.

### Changed

- **Repinned to `@vectros-ai/sdk` 0.44.0.** No API surface this app uses changed shape beyond the
  presigned-upload fix already noted above.

## [1.2.0] - 2026-09-07

### Changed

- **Now built and tested against `@vectros-ai/sdk` `^0.43.0`** (was `^0.42.0`). No application code
  needed to change: nothing this app calls was removed, renamed or re-typed across the release, and
  the type-check is clean against the new client.

  Three **server-side** behaviour changes in the same release reach this app once that API is
  deployed. They arrive with the API, not with this dependency bump, and none of them needed a code
  change here:

  - A browser request to an **unmatched route**, or one blocked before it reaches a handler, now
    comes back as the status it was shaped to be instead of an opaque CORS failure with no status.
  - The entity update path now rejects a `status` outside `ACTIVE`/`SUSPENDED` rather than storing
    it. This app only ever sends those two, in canonical upper case.
  - `POST /v1/auth/token/exchange` now re-reads the access profile's status on every request instead
    of trusting a memoized scope, so a suspended profile is refused immediately rather than
    continuing to mint tokens for up to five minutes. Sign-in for a just-suspended profile therefore
    fails sooner than it used to.

- **`blueprint/casework.blueprint.yaml`: corrected two comments that described platform behaviour
  inaccurately.** Comments only — the blueprint's parsed content is byte-for-byte unchanged, so no
  re-apply and no blueprint version bump is needed.
  - The client-deactivation note claimed `SUSPENDED` entities are "blocked from new operations" by
    the platform, citing the SDK's `EntityRequest.status` documentation as its authority. That was
    never true and the SDK documentation no longer says it: the platform stores `status` and hands
    it back unchanged, and a `SUSPENDED` entity stays readable, updatable and referenceable.
    **No behaviour changed, and the corrected note is blunter than the old one:** nothing enforces
    the status — not the platform, and not this app either. Deactivating a client renders an
    "Archived" chip and flips the archive/reactivate button, and that is all. A suspended client is
    still editable, still listed, and still selectable when creating a case. A fork that needs
    deactivation to have teeth has to add those checks itself.
  - The `case.caseType` note explained that `status` was left non-filterable to avoid overwriting a
    lifecycle `status` key the platform writes into every record's search metadata. The platform no
    longer writes that key, and `status` is not a reserved filterable field id on either the record
    or the document surface, so there is no collision to avoid. `status` stays non-filterable for
    the ordinary product reason (search results here only read `caseType`), and the note now lists
    the field ids that genuinely are reserved. **The 1.1.0 entry below repeats the same withdrawn
    claim and points at that comment for a "full trace"** — it is left as published, but treat it as
    retracted by this entry.

- **`createCase`, `inviteMember` and `ClientDetailPage` no longer claim the platform has no
  composed-write endpoint.** It has one: a stored script executed synchronously, whose writes all
  commit as a single transaction. It does not close these particular sequences, because a script
  reaches records, documents and folders but not identity entities or invitations — and each of
  these sequences has a leg of exactly that kind. The comments now describe that boundary instead
  of a gap that no longer exists. No behaviour change; these remain client-driven sequences.

- **Reads of the caller's own user id follow `@vectros-ai/react` 0.12.0's public `userId` identity
  key.** `useScopeGate` now resolves `identity` from the mint response's server-resolved
  `resolvedScope` field, which uses the public spelling `userId` rather than the untranslated
  internal JWT key. A fork carrying its own reads of `identity.partnerUserId` must make the same
  change when it bumps. Left unchanged they do not crash — they degrade silently onto the existing
  "no `userId`" warn-and-don't-query path, so own-case counts, org/client founder checks and
  self-authored rows quietly stop resolving.

### Fixed

- **A search can now be re-run.** Searching again for a term already on screen returned the same
  results without re-querying, so an entry added moments earlier could stay invisible until the page
  was reloaded. Indexing is asynchronous and takes a few seconds, which made this easiest to hit
  right after adding a case entry. Submitting the same term now runs the search again, and a refresh
  control sits beside the result count, on the "no results" state and on the error state.

- **Creating a case is now one transaction: either the case and its folder both exist, or neither
  does — and re-submitting one never creates a second.** Creating a case makes two writes -- the
  case's folder, then the case record carrying that folder's id. Driven from the browser those could
  fail independently, and a failure between them left a folder with no case attached to it and no
  way to clean it up. They now run as a single stored operation on the server, which commits both or
  neither.

  The identifiers a submission uses are derived from the values it sends, so submitting the same
  case again reuses them rather than minting new ones: the client, the case and the folder each
  resolve to the row the first attempt created instead of a second one. That holds whether the first
  attempt succeeded, failed, or never reported back, and it survives closing the dialog and
  reopening it. Changing the form makes it a different submission, as intended, and creating the
  case successfully ends it — an identical case raised later is a new one.

  A request that has already succeeded is additionally short-circuited: repeating it returns the
  original response without running anything. That applies to a successful response and to one
  reporting an unknown outcome; any other failure is retried for real, which is why the derived
  identifiers above are what actually prevents the duplicate.

  One situation still needs a human: if the operation runs out of time while its writes may already
  have committed, the API reports the outcome as unknown and repeating the request returns that same
  answer. Check whether the case exists before creating it again.

  ⚠️ **Re-apply this blueprint** (this app's own Quickstart step 3) before deploying this version,
  and deploy against an API of **0.43.0 or later**. The blueprint adds the stored operation and the
  permission to run it; the API version matters because case creation now sends an
  `Idempotency-Key` header, which earlier deployments do not allow through their cross-origin
  preflight. Against either an un-applied blueprint or an older API, **case creation fails
  outright** — on the primary path, not only on a retry.

  The client record is still created first and separately, so a failure after that point can still
  leave a client with no case. That is a smaller gap than the one this closes, and closing it needs
  a platform capability that does not exist yet.

- **A failed document upload no longer leaves a document behind with no file in it.** Attaching a
  document to a case is two steps: the document is created, then the bytes are sent. A rejected
  upload was already cleaned up; an upload that came back without a destination to send the bytes to
  was not, and left a document on the case that could not be opened or downloaded. Both failures are
  now cleaned up, and the upload error is what gets reported rather than a cleanup error. A document
  the upload did not itself create is never removed this way.

  This needs the blueprint re-applied too: case handlers and HR admins can now delete a document
  they own, which is what the cleanup uses. It does not let either role delete anyone else's.

## [1.1.0] - 2026-09-01

### Added

- **Hybrid search** (`/search`) across cases, case entries, and case documents — `hr-admin` only
  for now (`case-handler`'s access is blocked on the same platform-side scope limitation as the
  "Ask" panel; see `SearchPage.tsx`'s header comment). Uses the promoted `SearchResultCard`/
  `SearchModeToggle` primitives from `@vectros-ai/react` `0.11.0`.

### Fixed

- **Double `+` on every create/add button.** `orgs.createButton`/`clients.createButton`/
  `cases.createButton`/`team.inviteButton` baked a literal `"+ "` into their copy on top of an
  already-rendered icon — dropped the literal prefix, the icon alone now supplies the plus.
  (`clientDetail.assignButton` is unaffected — it has no icon, so its own `+` was already correct.)

### Changed

- `blueprint/casework.blueprint.yaml`: `case.caseType`/`case_note.caseId`/`case_document.caseId`
  are now `filterable`, so a search result carries a real title and can route back to its case —
  previously no field on any of these schemas was filterable, so search results carried only their
  bare `recordType`. `case.status` deliberately was NOT made filterable, despite the same
  reasoning otherwise applying — it collides with a search-metadata key the platform's own
  indexer already writes unconditionally (see the blueprint's own comment on that field for the
  full trace). **Re-apply this blueprint** (this app's own Quickstart step 3) for existing
  deployments — this only changes what a case/case entry/document writes into its search metadata
  going forward, not what's already indexed: an existing record's search result won't carry a
  title or a case link until it's next re-saved (or explicitly reindexed).

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

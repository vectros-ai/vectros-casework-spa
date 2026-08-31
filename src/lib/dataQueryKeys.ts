// ---------------------------------------------------------------------------
// dataQueryKeys — a single source of truth for TanStack Query keys.
//
// Centralized so a mutation's `invalidateQueries` call and the query it's
// meant to refetch can never drift into two different key shapes written by
// hand in two different files.
// ---------------------------------------------------------------------------

export const dataQueryKeys = {
  /** The orgs the signed-in caller founded (`GET /v1/entities/org?userId=`) —
   *  the ONLY enumerable-by-param `entities:r:org` clause this blueprint
   *  grants (live-verified: a bare, unscoped `entities/org` list
   *  call 403s, same authorization gate an unscoped case list hits — see
   *  CasesListPage's own comment). Shared by CreateCaseDialog, CasesListPage,
   *  and TeamPage's invite dialog — one query key, one cache entry. */
  orgsFounded: () => ['orgs', 'founded'] as const,
  /** The signed-in caller's own `org_membership` rows (self-only read) — the
   *  orgs they belong to WITHOUT having founded them. Paired with
   *  `orgsFounded()` by `useAccessibleOrgs` to build the full org-picker set
   *  for CreateCaseDialog / TeamPage's InviteDialog. */
  orgMemberships: () => ['orgs', 'memberships'] as const,
  /** A single org entity, by id. */
  org: (id: string) => ['orgs', 'entity', id] as const,
  /** A single client entity, by id — used by `CaseDetailPage`'s breadcrumb to
   *  resolve a case's `client:<id>` scope to a display name. */
  client: (id: string) => ['clients', 'entity', id] as const,
  /** The context-wide member roster (`GET /v1/app-contexts/{contextId}/profiles`). */
  team: () => ['team', 'roster'] as const,
  /** The client entities belonging to a given org (`GET /v1/entities/client?scope=org:<id>`) — the
   *  BROAD, org-wide source `useAccessibleClients` unions with the two below. Works for `hr-admin`;
   *  403s for `case-handler` as of item C's data-isolation pass (expected, not an error — see that
   *  hook's own header comment). */
  clientsForOrg: (orgId: string) => ['clients', 'byOrg', orgId] as const,
  /** Clients the signed-in caller personally founded (`GET /v1/entities/client?userId=`) — not
   *  org-scoped by the call itself, `useAccessibleClients` filters to one org client-side. */
  clientsFoundedBy: (userId: string) => ['clients', 'founder', userId] as const,
  /** The signed-in caller's own `client_membership` rows (self-only read) — clients they were
   *  GRANTED access to without founding. Mirrors `orgMemberships()` one tier down. */
  clientMemberships: () => ['clients', 'memberships'] as const,
  /** Every `client_membership` row for ONE client, by the org it belongs to — `hr-admin`'s
   *  `ClientDetailPage` Members section. Keyed by orgId (not clientId): the underlying call is
   *  `listRecords({type:'client_membership', scope:'org:<id>'})` (the only single-dim filter this
   *  role's own clause needs — `scope:client`/`userId` are both `${{ any }}` — see that clause's
   *  own comment), filtered client-side to this one client's rows, mirroring the exact reasoning
   *  `hr-admin`'s case-list query already applies for the identical single-dim-filter shape. */
  clientMembersByOrg: (orgId: string) => ['clients', 'membersByOrg', orgId] as const,
  /** The single schema resolved for a given record type. */
  schemaByType: (typeName: string) => ['schemas', 'byType', typeName] as const,
  /** The case list, keyed by the applied status filter ('all' = unfiltered). */
  cases: (statusFilter: string) => ['cases', statusFilter] as const,
  /** A single case record, by id. */
  case: (id: string) => ['cases', 'record', id] as const,
  /** A case's entries (`case_note` records), by the owning case id. */
  caseNotes: (caseId: string) => ['cases', 'record', caseId, 'notes'] as const,
  /** A case's own documents (`case_document`), by the owning case id (its own
   *  `caseId` lookup field — see `CaseDetailPage`'s header comment). */
  caseDocuments: (caseId: string) => ['cases', 'documents', caseId] as const,
  /** The inference model registry (`GET /v1/models`) — shared by every AI surface. */
  inferenceModels: () => ['inference', 'models'] as const,
};

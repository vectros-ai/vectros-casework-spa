// ---------------------------------------------------------------------------
// useAccessibleOrgs — every org the signed-in caller can create a case or
// send an invite into: orgs they FOUNDED, union orgs they hold `org_membership`
// in. Shared by CreateCaseDialog's org picker and TeamPage's InviteDialog org
// picker — both used to query ONLY `dataQueryKeys.orgsFounded()`, which
// silently omitted any org an invited-not-founding case-handler or hr-admin
// belongs to (never a founder, only ever a member — the exact gap
// `CasesListPage`'s own case-list query hit and fixed for READS; this is the
// same fix for the CREATE-side pickers).
//
// Discovery mechanism: `records:r:org_membership` (self-only,
// `dataScope: { userId: self.userId }`, held by both real-user roles this
// app's blueprint declares) returns every org_membership row this caller is
// the TARGET of — each stamped
// `scopes: ['org:<id>']` at invite time (`inviteMember.ts`). Extract the
// distinct org ids, then resolve each to its entity (name) via
// `entities:r:org`'s `orgReach`/`under.self.userId` clause, which is
// satisfied once `member.scope.org` resolves from that same row — no
// separate "am I actually a member" check needed, the entity read itself
// proves it.
//
// Founder orgs are fetched the same way `orgsFounded()` always has
// (`entities:r:org` with `userId: self.userId`); a founder is never ALSO
// double-counted via membership (founding never writes an `org_membership`
// row for the founder — see the blueprint's own comment on `hr-admin`'s
// case-authority clause), but this hook dedupes by id defensively anyway
// rather than relying on that invariant holding forever.
// ---------------------------------------------------------------------------

import { useQueries, useQuery } from '@tanstack/react-query';
import { CASEWORK_CONTEXT_ID, vectrosApiClient } from '../api/vectrosApi';
import type { EntityResponse, RecordResponse } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';
import { drainPages } from '../lib/drainPages';

export interface AccessibleOrgsResult {
  readonly orgs: readonly EntityResponse[];
  readonly isPending: boolean;
  readonly isError: boolean;
  /** Neither pending nor errored — mirrors `useQuery`'s own `isSuccess`, so a
   *  call site can keep the same `isPending`/`isError`/`isSuccess` triad it
   *  already uses for every other query in this app. */
  readonly isSuccess: boolean;
  readonly error: unknown;
}

/** The distinct `org:<id>` values named by a set of records' `scopes`, in
 *  first-seen order. Shared shape with `CasesListPage`'s own `distinctOrgIds`
 *  (that one narrows a list of `case` records to their org column; this one
 *  narrows a list of `org_membership` rows to the orgs they grant) — kept as
 *  two small local functions rather than one shared export, since the two
 *  callers' record shapes only coincidentally overlap (`scopes` is generic to
 *  every record type, not something worth abstracting a helper module over
 *  for two three-line call sites). */
function distinctOrgIdsFromScopes(records: ReadonlyArray<Pick<RecordResponse, 'scopes'>>): string[] {
  const seen = new Set<string>();
  for (const r of records) {
    const orgScope = (r.scopes ?? []).find((s) => s.startsWith('org:'));
    if (orgScope) seen.add(orgScope.slice('org:'.length));
  }
  return [...seen];
}

/**
 * `myUserId` — the caller's own `partnerUserId` (from `useScopeGate().identity`),
 * already resolved by the caller. `enabled` — gate the underlying queries off
 * a dialog's own `open` state, same convention every other on-demand query in
 * this app uses.
 */
export function useAccessibleOrgs(
  myUserId: string | undefined,
  enabled: boolean,
): AccessibleOrgsResult {
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';

  const founderQuery = useQuery({
    queryKey: dataQueryKeys.orgsFounded(),
    // Drained to completion, not a single un-paged call — see drainPages.ts's own header (the
    // same gap `fetchAllCasesForOrg` drains around for cases): a founder of more than 20 orgs
    // would otherwise silently lose everything past the first page.
    queryFn: () => {
      if (!hasUserId) throw new Error('myUserId not resolved'); // unreachable — guarded by `enabled`
      return drainPages((startFrom) =>
        vectrosApiClient().identity.listEntities({
          namespace: 'org',
          contextId: CASEWORK_CONTEXT_ID,
          userId: myUserId!,
          ...(startFrom ? { startFrom } : {}),
        }),
      );
    },
    enabled: enabled && hasUserId,
  });
  const founderOrgs: EntityResponse[] = founderQuery.data ?? [];
  const founderOrgIds = new Set(
    founderOrgs.map((o) => o.id).filter((id): id is string => typeof id === 'string'),
  );

  // `values: [myUserId]` is required, not optional — the API rejects a lookup with no
  // value/from+to/prefix mode set ("Provide one lookup mode"), it doesn't treat an omitted
  // `values` as "match every org_membership row" (confirmed against the live staging API,
  // 2026-08-28). The `dataScope { userId: self.userId }` on this grant would narrow the result to
  // the caller's own rows regardless, but the lookup mode still has to be supplied explicitly.
  // Drained to completion too — `lookupRecords` returns the same paged `{data, nextCursor}`
  // envelope (its own doc: "keep paging until nextCursor is null rather than stopping on an
  // empty page"), so a caller belonging to more than 20 orgs would otherwise lose the rest.
  const membershipQuery = useQuery({
    queryKey: dataQueryKeys.orgMemberships(),
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().records.lookupRecords({
          type: 'org_membership',
          field: 'targetUserId',
          values: [myUserId!],
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: enabled && hasUserId,
  });
  // Only resolve entities for a membership org NOT already in the founder
  // set — no point double-fetching a founder's own org.
  const missingOrgIds = distinctOrgIdsFromScopes(membershipQuery.data ?? []).filter(
    (id) => !founderOrgIds.has(id),
  );

  const memberOrgQueries = useQueries({
    queries: missingOrgIds.map((id) => ({
      queryKey: dataQueryKeys.org(id),
      queryFn: () =>
        vectrosApiClient().identity.getEntity({ namespace: 'org', id, contextId: CASEWORK_CONTEXT_ID }),
      enabled: enabled && membershipQuery.isSuccess,
    })),
  });
  const memberOrgs: EntityResponse[] = memberOrgQueries
    .map((q) => q.data)
    .filter((o): o is EntityResponse => o != null);

  // `memberOrgQueries` (the per-membership-org `getEntity` fan-out) was previously left OUT of
  // `isPending`/`isSuccess` —
  // once `founderQuery`/`membershipQuery` settled, `isSuccess` flipped true and `orgs` was read as
  // final while a membership-discovered org's entity fetch was still in flight, so a caller with
  // exactly one FOUNDED org and one MEMBER org saw a transient `orgs.length === 1` window: the org
  // picker stayed hidden, the single (wrong, founder-only) org got silently auto-selected, and
  // `canSubmit` went true — a real risk of creating a case / sending an invite against the wrong
  // org before the member org popped in a moment later.
  const memberOrgQueriesPending = memberOrgQueries.some((q) => q.isPending);
  const isPending =
    enabled && hasUserId && (founderQuery.isPending || membershipQuery.isPending || memberOrgQueriesPending);
  const isError = founderQuery.isError || membershipQuery.isError || memberOrgQueries.some((q) => q.isError);

  // Explicit id-based dedup on the FINAL list, not just on `missingOrgIds`'s per-render filter
  // against `founderOrgIds` — the filter alone is correct once both queries have settled, but this
  // makes the "never double-counted" guarantee real regardless of the two queries' relative timing
  // or the founder/no-self-membership invariant it otherwise leans on entirely.
  const seenOrgIds = new Set<string>();
  const orgs = [...founderOrgs, ...memberOrgs].filter((o) => {
    if (typeof o.id !== 'string') return true; // no id to dedup on — keep as-is, shouldn't happen in practice
    if (seenOrgIds.has(o.id)) return false;
    seenOrgIds.add(o.id);
    return true;
  });

  return {
    orgs,
    isPending,
    isError,
    isSuccess: !isPending && !isError,
    error:
      founderQuery.error ??
      membershipQuery.error ??
      memberOrgQueries.find((q) => q.isError)?.error,
  };
}

// ---------------------------------------------------------------------------
// useAccessibleClients — every client the signed-in caller can reach WITHIN
// one org: three discovery sources, unioned, because `hr-admin` and
// `case-handler` hold genuinely different-SHAPED grants on the `client`
// namespace (`casework.blueprint.yaml`, item C's data-isolation pass) —
// unlike `useAccessibleOrgs`, where both roles' org reach is founder-or-
// member alike, so one hook shape covers both there. Here it doesn't:
//
// 1. BROAD, org-wide (`entities:cr:client`, `hr-admin` only in practice) —
//    every client scoped to this org, regardless of relationship. Fails
//    closed (403) for `case-handler`, who holds no org-scoped client read at
//    all as of this pass — expected, not an error state for THIS hook: a
//    source that can't authorize for this caller just contributes nothing to
//    the union, the same way `useAccessibleOrgs`'s founder query contributes
//    nothing for a caller who's never founded an org.
// 2. FOUNDER (`entities:r:client`, `userId: self.userId`, both roles) —
//    clients this caller personally created.
// 3. MEMBER (`client_membership` self-read, both roles) — clients someone
//    else granted this caller access to. Currently the ONLY way a
//    case-handler reaches a client they didn't found — see this pass's own
//    "assign a case-handler to a client" UI (`ClientDetailPage`'s Members
//    section), which is what makes this source non-vacuous for the first
//    time.
//
// Overall `isError` is true only if EVERY source failed — one working
// source is a real, honest result; erroring only reflects a caller for whom
// nothing at all resolved (broken auth, network down), not "the broad query
// 403'd, which is normal for a case-handler."
// ---------------------------------------------------------------------------

import { useQueries, useQuery } from '@tanstack/react-query';
import { CASEWORK_CONTEXT_ID, vectrosApiClient } from '../api/vectrosApi';
import type { EntityResponse, RecordResponse } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';
import { drainPages } from '../lib/drainPages';

export interface AccessibleClientsResult {
  readonly clients: readonly EntityResponse[];
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly isSuccess: boolean;
  readonly error: unknown;
  readonly isFetching: boolean;
  /** Refetches every constituent source (the member-entity fan-out re-derives from a fresh
   *  `membershipQuery` on its own once that settles, same as its normal reactive behavior). */
  readonly refetch: () => void;
}

/** The distinct `client:<id>` values named by a set of records' `scopes`,
 *  restricted to rows that ALSO carry this org's own `scope:org:<id>` —
 *  same shape as `useAccessibleOrgs`'s `distinctOrgIdsFromScopes`, kept as
 *  its own small function rather than shared for the same reason that one
 *  gives (the two callers' record shapes only coincidentally overlap). */
function distinctClientIdsForOrg(
  records: ReadonlyArray<Pick<RecordResponse, 'scopes'>>,
  orgId: string,
): string[] {
  const seen = new Set<string>();
  for (const r of records) {
    const scopes = r.scopes ?? [];
    if (!scopes.includes(`org:${orgId}`)) continue;
    const clientScope = scopes.find((s) => s.startsWith('client:'));
    if (clientScope) seen.add(clientScope.slice('client:'.length));
  }
  return [...seen];
}

/**
 * `orgId` — which org's clients to discover (a client picker is always
 * scoped to one already-selected org, same as the existing quick-add flow).
 * `myUserId` — the caller's own `partnerUserId`. `enabled` — gate off a
 * dialog's `open` state / the page's own readiness, same convention every
 * other on-demand query in this app uses.
 */
export function useAccessibleClients(
  orgId: string,
  myUserId: string | undefined,
  enabled: boolean,
): AccessibleClientsResult {
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';
  const canQuery = enabled && orgId !== '' && hasUserId;

  // All three queries below drain to completion rather than taking a single un-paged call at
  // face value — `listEntities`/`lookupRecords` both default to a 20-item page (the same gap
  // `fetchAllCasesForOrg` drains around for cases; see drainPages.ts's own header), so an org
  // with more than 20 clients would otherwise silently lose everything past the first page.
  const broadQuery = useQuery({
    queryKey: dataQueryKeys.clientsForOrg(orgId),
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().identity.listEntities({
          namespace: 'client',
          contextId: CASEWORK_CONTEXT_ID,
          scope: `org:${orgId}`,
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: canQuery,
    retry: false,
  });
  const broadClients: EntityResponse[] = broadQuery.data ?? [];

  const founderQuery = useQuery({
    queryKey: dataQueryKeys.clientsFoundedBy(myUserId ?? ''),
    queryFn: () => {
      if (!hasUserId) throw new Error('myUserId not resolved'); // unreachable — guarded by `enabled`
      return drainPages((startFrom) =>
        vectrosApiClient().identity.listEntities({
          namespace: 'client',
          contextId: CASEWORK_CONTEXT_ID,
          userId: myUserId!,
          ...(startFrom ? { startFrom } : {}),
        }),
      );
    },
    enabled: canQuery,
    retry: false,
  });
  // Founder discovery isn't org-scoped (mirrors `useAccessibleOrgs`'s own founder query) — a
  // caller who founded clients in more than one org needs this filtered down to just this one.
  const founderClients: EntityResponse[] = (founderQuery.data ?? []).filter((c) =>
    (c.scopes ?? []).includes(`org:${orgId}`),
  );

  // `values: [myUserId]` is required — see `useAccessibleOrgs`'s identical lookup for why an
  // omitted `values` 400s rather than matching every row.
  const membershipQuery = useQuery({
    queryKey: dataQueryKeys.clientMemberships(),
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().records.lookupRecords({
          type: 'client_membership',
          field: 'targetUserId',
          values: [myUserId!],
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: canQuery,
    retry: false,
  });
  const knownIds = new Set(
    [...broadClients, ...founderClients].map((c) => c.id).filter((id): id is string => typeof id === 'string'),
  );
  const missingClientIds = distinctClientIdsForOrg(membershipQuery.data ?? [], orgId).filter(
    (id) => !knownIds.has(id),
  );

  const memberClientQueries = useQueries({
    queries: missingClientIds.map((id) => ({
      queryKey: dataQueryKeys.client(id),
      queryFn: () =>
        vectrosApiClient().identity.getEntity({ namespace: 'client', id, contextId: CASEWORK_CONTEXT_ID }),
      enabled: canQuery && membershipQuery.isSuccess,
      retry: false,
    })),
  });
  const memberClients: EntityResponse[] = memberClientQueries
    .map((q) => q.data)
    .filter((c): c is EntityResponse => c != null);

  const anyPending =
    broadQuery.isPending || founderQuery.isPending || membershipQuery.isPending ||
    memberClientQueries.some((q) => q.isPending);
  const isPending = canQuery && anyPending;

  // Every source errored — a real, hook-level failure. One or two 403ing (the broad query, for a
  // case-handler with no org-scoped grant) while another succeeds is a normal, expected shape, not
  // an error — see this file's own header comment. Deliberately NOT also checking
  // `memberClientQueries` here: when `membershipQuery` itself errors, its `.data` is `undefined`,
  // which forces `missingClientIds` to `[]` — so `memberClientQueries` is always empty in that
  // branch and has nothing left to check (review finding, 2026-08-28: an earlier draft of this line
  // DID check it, and the extra clause was dead code that read as a real check but never changed
  // the result — removed rather than left misleading).
  const allErrored = broadQuery.isError && founderQuery.isError && membershipQuery.isError;

  const seenIds = new Set<string>();
  const clients = [...broadClients, ...founderClients, ...memberClients].filter((c) => {
    if (typeof c.id !== 'string') return true; // no id to dedup on — keep as-is, shouldn't happen in practice
    if (seenIds.has(c.id)) return false;
    seenIds.add(c.id);
    return true;
  });

  return {
    clients,
    isPending,
    isError: canQuery && !isPending && allErrored,
    isSuccess: canQuery && !isPending && !allErrored,
    error: broadQuery.error ?? founderQuery.error ?? membershipQuery.error,
    isFetching:
      broadQuery.isFetching ||
      founderQuery.isFetching ||
      membershipQuery.isFetching ||
      memberClientQueries.some((q) => q.isFetching),
    refetch: () => {
      void broadQuery.refetch();
      void founderQuery.refetch();
      void membershipQuery.refetch();
    },
  };
}

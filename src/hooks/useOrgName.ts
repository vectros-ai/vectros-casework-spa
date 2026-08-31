// ---------------------------------------------------------------------------
// useOrgName — resolves an org id to its display name, falling back to the
// id itself while the fetch is pending or if the org has no name.
//
// Was independently re-authored identically in CaseDetailPage.tsx and
// ClientDetailPage.tsx (the org->client breadcrumb, and this hook's own
// namesake breadcrumb) — same query key, same queryFn, same `data?.name ||
// id` fallback, copy-pasted rather than shared. One implementation now.
// ---------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { CASEWORK_CONTEXT_ID, vectrosApiClient } from '../api/vectrosApi';
import type { EntityResponse } from '../api/vectrosApi';
import { dataQueryKeys } from '../lib/dataQueryKeys';

export interface UseOrgNameResult {
  /** The org's own name, or the org id itself while pending / if unnamed. Undefined only when
   *  `orgId` itself is undefined. */
  readonly name: string | undefined;
  readonly query: UseQueryResult<EntityResponse>;
}

export function useOrgName(orgId: string | undefined): UseOrgNameResult {
  const query = useQuery({
    queryKey: dataQueryKeys.org(orgId ?? ''),
    queryFn: () =>
      vectrosApiClient().identity.getEntity({ namespace: 'org', id: orgId ?? '', contextId: CASEWORK_CONTEXT_ID }),
    enabled: typeof orgId === 'string',
  });
  return { name: query.data?.name || orgId, query };
}

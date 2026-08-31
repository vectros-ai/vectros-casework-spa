// ---------------------------------------------------------------------------
// Vectros API client — casework-spa's @vectros-ai/sdk wiring.
//
// **Why the SDK (not hand-rolled fetch):** type-safe, generated from the
// backend's OpenAPI spec, so call sites stay in sync with backend changes by
// construction.
//
// **Auth bridge:** the SDK accepts a `token: () => Promise<string>` supplier;
// we delegate token resolution to `getVectrosApiToken` from `@vectros-ai/react`,
// wired at boot (main.tsx) to this app's Auth0 exchange provider.
//
// **A single client instance, unlike a multi-tenant app.** This app is
// single-tenant/single-context by construction: the
// exchanged token pins both the tenant and the app context server-side, from
// the registered issuer — there is never a second tenant or context to switch
// to. `getVectrosApiToken`'s first argument is a cache key the Auth0 exchange
// provider ignores entirely (see `Auth0AuthProvider.mintPartnerApiToken`), so
// any stable, non-empty string satisfies it; `EXCHANGE_RESOLVED_TENANT` exists
// only to be a self-documenting one.
// ---------------------------------------------------------------------------

import { VectrosClient } from '@vectros-ai/sdk';
import type { VectrosClient as _VectrosClient } from '@vectros-ai/sdk';

import { getVectrosApiToken } from '@vectros-ai/react';
import { VECTROS_API_CONFIG } from '../config';

export const EXCHANGE_RESOLVED_TENANT = 'exchange-resolved';

/**
 * The single app context this deployment provisions (`casework.blueprint.yaml`'s
 * `contextId: casework`). The `org`/`client` identity namespaces are registered
 * CONTEXT-OWNED, not tenant-wide, so every identity-entity call below must name
 * this explicitly — omitting it is rejected, not defaulted, for a context-placed
 * namespace. A fork renaming the blueprint's `contextId` must update this
 * constant to match.
 */
export const CASEWORK_CONTEXT_ID = 'casework';

let client: VectrosClient | undefined;

/** The configured `VectrosClient`, lazily instantiated once and reused. */
export function vectrosApiClient(): VectrosClient {
  if (!client) {
    client = new VectrosClient({
      environment: VECTROS_API_CONFIG.apiUrl,
      token: (): Promise<string> => getVectrosApiToken(EXCHANGE_RESOLVED_TENANT),
    });
  }
  return client;
}

/** Test-only helper. Clears the cached client so each test starts fresh. */
export function __resetVectrosApiClientCacheForTest(): void {
  client = undefined;
}

// ---------------------------------------------------------------------------
// Re-exports for consumer convenience (the SDK's request/response types live
// under the `Vectros` namespace — Fern's convention).
// ---------------------------------------------------------------------------

export { Vectros } from '@vectros-ai/sdk';
export type { VectrosClient } from '@vectros-ai/sdk';
export { VectrosError, VectrosTimeoutError } from '@vectros-ai/sdk';

type _Identity = _VectrosClient['identity'];
type _Schemas = _VectrosClient['schemas'];
type _Records = _VectrosClient['records'];

/** An identity entity (id, namespace, externalId, name, status, scopes, payload, schemaId, …). */
export type EntityResponse = Awaited<ReturnType<_Identity['getEntity']>>;
/** A schema describing a record/document/entity type (typeName, displayName, fields, …). */
export type SchemaResponse = NonNullable<
  Awaited<ReturnType<_Schemas['listSchemas']>>['data']
>[number];
/** A single record (id, typeName, payload, status, ownership, version, …). */
export type RecordResponse = Awaited<ReturnType<_Records['getRecord']>>;

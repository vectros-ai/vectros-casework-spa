// ---------------------------------------------------------------------------
// App-local auth barrel.
//
// casework-spa always uses Auth0AuthProvider (hosted-redirect), never an
// embedded-credential provider — so this wrapper narrows the package's
// generic `useAuth()` to the HostedRedirectAuth facet via `assertHostedAuth`,
// a real runtime-checked assertion (see @vectros-ai/react's assertFacet.ts
// for why: a bare `as` cast would silently keep compiling if main.tsx were
// ever repointed at an embedded provider without updating call sites, and
// every hosted call site would throw at runtime instead). Call sites import
// `useAuth` from HERE, not from '@vectros-ai/react', so they get
// `signInWithRedirect`/`handleRedirectCallback` fully typed with no
// per-call-site optional-chaining.
// ---------------------------------------------------------------------------

import {
  useAuth as useAuthBase,
  useScopeGate as useScopeGateBase,
  assertHostedAuth,
  type AuthContextValue,
  type HostedRedirectAuth,
  type ScopeGateValue,
} from '@vectros-ai/react';
import { EXCHANGE_RESOLVED_TENANT } from '../api/vectrosApi';

export { AuthProvider } from '@vectros-ai/react';
export type { AuthUser } from '@vectros-ai/react';

export function useAuth(): AuthContextValue & HostedRedirectAuth {
  const value = useAuthBase();
  assertHostedAuth(value);
  return value;
}

/**
 * useScopeGate, pinned to this app's single (exchange-resolved) tenant slot.
 *
 * `@vectros-ai/react`'s useScopeGate defaults to `useCurrentTenant()`'s active
 * tenant — a multi-tenant concept this app doesn't have (this app deliberately
 * drops `CurrentTenantProvider`, so `useCurrentTenant()`
 * falls back to its no-provider default of `tenant: null` here). Left
 * un-pinned, useScopeGate's mint effect never fires for a null tenant and
 * `loading` never resolves — every call site gating on it would hang forever,
 * not just start slow. Call sites import `useScopeGate` from HERE, not from
 * `@vectros-ai/react` directly, so this can't be forgotten per call site — the
 * same reasoning that motivates this file's `useAuth` wrapper above. Reuses
 * the SAME cache-key constant `vectrosApiClient` uses, so it shares that
 * cached mint rather than triggering a second exchange call under a different
 * cache slot.
 */
export function useScopeGate(): ScopeGateValue {
  return useScopeGateBase(EXCHANGE_RESOLVED_TENANT);
}

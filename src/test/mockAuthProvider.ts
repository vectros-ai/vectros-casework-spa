// ---------------------------------------------------------------------------
// makeMockAuthProvider — shared test double for the AuthProviderAdapter.
//
// Every method defaults to a `vi.fn()` with a benign resolved value so a
// component under test never hits an undefined method; pass `overrides` to
// pin the behavior a specific test cares about:
//
//     const auth = makeMockAuthProvider({
//       getCurrentUser: vi.fn().mockResolvedValue(aliceUser),
//     });
//
// The adapter contract lives in @vectros-ai/react; casework-spa always uses
// the hosted-redirect shape (core + HostedRedirectAuth), matching Auth0AuthProvider.
// ---------------------------------------------------------------------------

import { vi } from 'vitest';

import type { AuthProviderAdapter, HostedRedirectAuth } from '@vectros-ai/react';

/** The shape Auth0AuthProvider implements — this app is always this shape. */
export type FullMockProvider = AuthProviderAdapter & HostedRedirectAuth;

export function makeMockAuthProvider(overrides: Partial<FullMockProvider> = {}): FullMockProvider {
  return {
    getCurrentUser: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    getIdToken: vi.fn().mockResolvedValue(null),
    signInWithRedirect: vi.fn().mockResolvedValue(undefined),
    handleRedirectCallback: vi.fn().mockResolvedValue(undefined),
    acceptInvite: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

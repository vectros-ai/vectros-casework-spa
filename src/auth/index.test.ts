// ---------------------------------------------------------------------------
// auth/index.ts — the app-local useAuth/useScopeGate wrappers, previously
// untested (every page test mocks useScopeGate wholesale via '../auth', so
// the wrapper itself has never actually been run). Pins that useAuth calls
// assertHostedAuth and correctly propagates its pass/throw (assertHostedAuth
// itself is mocked here, not exercised for real -- that's @vectros-ai/react's
// own coverage, not this app's), and that useScopeGate pins
// EXCHANGE_RESOLVED_TENANT.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import type * as VectrosReact from '@vectros-ai/react';

// Spread the REAL `@vectros-ai/react` module and override only the three hooks under test — so
// every other export this file's own imports transitively touch (this module re-exports
// `AuthProvider` unchanged; `../api/vectrosApi` imports `getVectrosApiToken` at module scope)
// stays the genuine export rather than a hand-maintained stand-in that has to be kept in sync by
// hand as the real module's surface changes.
vi.mock('@vectros-ai/react', async (importOriginal) => ({
  ...(await importOriginal<typeof VectrosReact>()),
  useAuth: vi.fn(),
  useScopeGate: vi.fn(),
  assertHostedAuth: vi.fn(),
}));

import { useAuth as useAuthBase, useScopeGate as useScopeGateBase, assertHostedAuth } from '@vectros-ai/react';
import { useAuth, useScopeGate } from './index';
import { EXCHANGE_RESOLVED_TENANT } from '../api/vectrosApi';

const mockedUseAuthBase = vi.mocked(useAuthBase);
const mockedUseScopeGateBase = vi.mocked(useScopeGateBase);
const mockedAssertHostedAuth = vi.mocked(assertHostedAuth);

describe('useAuth', () => {
  beforeEach(() => {
    mockedUseAuthBase.mockReset();
    mockedAssertHostedAuth.mockReset();
  });

  it('narrows the base context through assertHostedAuth and returns it unchanged when it passes', () => {
    const hostedValue = { isAuthenticated: true, signInWithRedirect: vi.fn() };
    mockedUseAuthBase.mockReturnValue(hostedValue as never);
    mockedAssertHostedAuth.mockImplementation(() => undefined);

    const { result } = renderHook(() => useAuth());

    expect(mockedAssertHostedAuth).toHaveBeenCalledWith(hostedValue);
    expect(result.current).toBe(hostedValue);
  });

  it('propagates assertHostedAuth throwing, rather than swallowing a non-hosted context shape', () => {
    mockedUseAuthBase.mockReturnValue({ isAuthenticated: false } as never);
    mockedAssertHostedAuth.mockImplementation(() => {
      throw new Error('not a hosted-redirect auth context');
    });

    expect(() => renderHook(() => useAuth())).toThrow('not a hosted-redirect auth context');
  });
});

describe('useScopeGate', () => {
  beforeEach(() => {
    mockedUseScopeGateBase.mockReset();
  });

  it("pins the base hook to this app's single EXCHANGE_RESOLVED_TENANT slot, not the default active tenant", () => {
    const gateValue = { loading: false, allowed: true };
    mockedUseScopeGateBase.mockReturnValue(gateValue as never);

    const { result } = renderHook(() => useScopeGate());

    expect(mockedUseScopeGateBase).toHaveBeenCalledWith(EXCHANGE_RESOLVED_TENANT);
    expect(result.current).toBe(gateValue);
  });
});

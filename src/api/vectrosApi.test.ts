// ---------------------------------------------------------------------------
// vectrosApi.ts — direct coverage for `vectrosApiClient()`'s lazy-singleton
// caching, previously untested (every consumer mocks this module entirely,
// so the caching behavior itself — and the `__resetVectrosApiClientCacheForTest`
// helper this file already ships specifically to enable that testing — has
// never actually been exercised).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as VectrosSdk from '@vectros-ai/sdk';

// Spread the REAL `@vectros-ai/sdk` module and override only `VectrosClient` — so `Vectros`/
// `VectrosError`/`VectrosTimeoutError` (this file's own pass-through re-exports, never exercised
// by these tests) stay the genuine exports rather than a hand-maintained fake that could silently
// drift from the real module's shape.
vi.mock('@vectros-ai/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof VectrosSdk>()),
  VectrosClient: vi.fn(),
}));
vi.mock('@vectros-ai/react', () => ({ getVectrosApiToken: vi.fn().mockResolvedValue('tok_test') }));

import { VectrosClient } from '@vectros-ai/sdk';
import { getVectrosApiToken } from '@vectros-ai/react';
import { vectrosApiClient, EXCHANGE_RESOLVED_TENANT, __resetVectrosApiClientCacheForTest } from './vectrosApi';
import { VALID_ENV } from '../test/setup';

const mockedVectrosClient = vi.mocked(VectrosClient);
const mockedGetVectrosApiToken = vi.mocked(getVectrosApiToken);

describe('vectrosApiClient', () => {
  beforeEach(() => {
    mockedVectrosClient.mockClear();
    mockedGetVectrosApiToken.mockClear();
    // The one thing that actually needs resetting between tests -- the module's own
    // purpose-built helper for it, rather than blowing away and re-importing the whole module.
    __resetVectrosApiClientCacheForTest();
  });

  it('constructs a VectrosClient exactly once across repeated calls (lazy singleton)', () => {
    const first = vectrosApiClient();
    const second = vectrosApiClient();

    expect(mockedVectrosClient).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it('wires the client to the configured API url and a token supplier backed by getVectrosApiToken', async () => {
    vectrosApiClient();

    expect(mockedVectrosClient).toHaveBeenCalledWith(
      expect.objectContaining({ environment: VALID_ENV.VITE_VECTROS_API_URL, token: expect.any(Function) }),
    );
    const { token } = mockedVectrosClient.mock.calls[0]![0] as { token: () => Promise<string> };
    await expect(token()).resolves.toBe('tok_test');
    expect(mockedGetVectrosApiToken).toHaveBeenCalledWith(EXCHANGE_RESOLVED_TENANT);
  });

  it('__resetVectrosApiClientCacheForTest forces the next call to construct a fresh client', () => {
    const first = vectrosApiClient();
    __resetVectrosApiClientCacheForTest();
    const second = vectrosApiClient();

    expect(mockedVectrosClient).toHaveBeenCalledTimes(2);
    expect(first).not.toBe(second);
  });
});

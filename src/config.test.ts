// ---------------------------------------------------------------------------
// config.ts — the `requireEnv`-backed fail-fast config, previously untested.
// `src/test/setup.ts` stubs every required var to a valid value for every
// OTHER test file, which is exactly why this module's own failure branch —
// what happens when a var is missing or blank — has never actually run.
// Each test here stubs its own full set of env vars (rather than relying on
// setup.ts's stub, which `vi.unstubAllEnvs()` below clears) and re-imports
// the module fresh, since `AUTH0_CONFIG`/`VECTROS_API_CONFIG` are computed
// once at module load, not read lazily per access.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { VALID_ENV } from './test/setup';

function stubValidEnv(): void {
  for (const [key, value] of Object.entries(VALID_ENV)) {
    vi.stubEnv(key, value);
  }
}

beforeEach(() => {
  stubValidEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('config', () => {
  it('loads AUTH0_CONFIG and VECTROS_API_CONFIG when every required var is set, defaulting connection', async () => {
    const { AUTH0_CONFIG, VECTROS_API_CONFIG } = await import('./config');

    expect(AUTH0_CONFIG.domain).toBe(VALID_ENV.VITE_AUTH0_DOMAIN);
    expect(AUTH0_CONFIG.clientId).toBe(VALID_ENV.VITE_AUTH0_CLIENT_ID);
    expect(AUTH0_CONFIG.audience).toBe(VALID_ENV.VITE_AUTH0_AUDIENCE);
    expect(AUTH0_CONFIG.redirectUri).toMatch(/\/callback$/);
    // No VITE_AUTH0_CONNECTION stubbed above -- covers the default-when-unset branch too.
    expect(AUTH0_CONFIG.connection).toBe('Username-Password-Authentication');
    expect(VECTROS_API_CONFIG.exchangeUrl).toBe(VALID_ENV.VITE_VECTROS_EXCHANGE_URL);
    expect(VECTROS_API_CONFIG.apiUrl).toBe(VALID_ENV.VITE_VECTROS_API_URL);
  });

  it('uses VITE_AUTH0_CONNECTION when a fork sets a custom connection name', async () => {
    vi.stubEnv('VITE_AUTH0_CONNECTION', 'custom-connection');

    const { AUTH0_CONFIG } = await import('./config');

    expect(AUTH0_CONFIG.connection).toBe('custom-connection');
  });

  it('treats a whitespace-only VITE_AUTH0_CONNECTION as unset, same as omitting it', async () => {
    vi.stubEnv('VITE_AUTH0_CONNECTION', '   ');

    const { AUTH0_CONFIG } = await import('./config');

    expect(AUTH0_CONFIG.connection).toBe('Username-Password-Authentication');
  });

  it.each([
    // Both blank shapes (empty and whitespace-only) hit the same `!value || value.trim() === ''`
    // check in requireEnv() -- domain gets both rows as the representative case; the other four
    // required vars go through the identical code path, so one blank-shape row each is enough.
    ['VITE_AUTH0_DOMAIN', ''],
    ['VITE_AUTH0_DOMAIN', '   '],
    ['VITE_AUTH0_CLIENT_ID', ''],
    ['VITE_AUTH0_AUDIENCE', ''],
    ['VITE_VECTROS_EXCHANGE_URL', ''],
    ['VITE_VECTROS_API_URL', ''],
  ])('throws a Configuration-error naming %s when it is blank', async (name, blankValue) => {
    vi.stubEnv(name, blankValue);

    await expect(import('./config')).rejects.toThrow(
      new RegExp(`Configuration error: ${name} is not set`),
    );
  });
});

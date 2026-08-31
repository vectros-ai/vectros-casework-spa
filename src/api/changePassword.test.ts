// ---------------------------------------------------------------------------
// changePassword.ts tests — the direct (non-Vectros-SDK) call to Auth0's own
// change-password endpoint. Mocks `fetch` directly, same pattern
// AddCaseDocumentDialog.test.tsx already uses for its own raw-fetch upload
// call — this is the one other place in the app that bypasses
// vectrosApiClient() entirely.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPasswordChange } from './changePassword';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestPasswordChange', () => {
  it('POSTs to the tenant-domain change_password endpoint with client_id/email/connection', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, clone: () => ({}) });
    vi.stubGlobal('fetch', fetchMock);

    await requestPasswordChange('alice@example.com');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://test-tenant.us.auth0.com/dbconnections/change_password',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: 'testclientid1234567890',
          email: 'alice@example.com',
          connection: 'Username-Password-Authentication',
        }),
      }),
    );
  });

  it('throws with Auth0\'s error_description when the request is rejected', async () => {
    const errorBody = { error: 'bad_request', error_description: 'invalid email format' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        clone: () => ({ json: () => Promise.resolve(errorBody) }),
        text: () => Promise.resolve(JSON.stringify(errorBody)),
      }),
    );

    await expect(requestPasswordChange('not-an-email')).rejects.toThrow(
      'Password reset request failed: invalid email format',
    );
  });

  it('falls back to the raw response body when the error is not JSON (e.g. a plain-text 429)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        clone: () => ({ json: () => Promise.reject(new Error('not json')) }),
        text: () => Promise.resolve('Too many requests'),
      }),
    );

    await expect(requestPasswordChange('alice@example.com')).rejects.toThrow(
      'Password reset request failed: Too many requests',
    );
  });

  it('falls back to a bare status code when the response body is unreadable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        clone: () => ({ json: () => Promise.reject(new Error('not json')) }),
        text: () => Promise.reject(new Error('body already consumed')),
      }),
    );

    await expect(requestPasswordChange('alice@example.com')).rejects.toThrow(
      'Password reset request failed (500).',
    );
  });
});

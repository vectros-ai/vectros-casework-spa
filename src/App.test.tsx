// ---------------------------------------------------------------------------
// App route-table smoke tests.
//
// Verifies the load-bearing wiring facts of the shell:
//   1. An unauthenticated visitor to `/` is redirected to the login page.
//   2. An authenticated visitor to `/` lands on the home page inside AppLayout.
//   3. An unknown route renders the 404 page.
//
// Auth state is controlled via the mock adapter's getCurrentUser (the probe
// AuthProvider runs on mount). We use findBy* to await the async probe
// settling (RequireAuth shows a spinner until then).
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import App from './App';
import { TestProviders } from './test/TestProviders';
import { pageOf } from './test/pageOf';
import type { AuthUser } from '@vectros-ai/react';
import { setPartnerApiTokenMinter, __resetVectrosApiTokenCacheForTest } from '@vectros-ai/react';

vi.mock('./api/vectrosApi', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vitest's importOriginal idiom
  const actual = await importOriginal<typeof import('./api/vectrosApi')>();
  return { ...actual, vectrosApiClient: vi.fn() };
});
import { vectrosApiClient } from './api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

const ALICE: AuthUser = {
  sub: 'sub-alice-0001',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Example',
};

/** base64url-encode (no padding) — mirrors how a JWT segment is encoded. */
function b64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Build an `st_test_*`-shaped token carrying the given allowed_actions +
 *  identity, matching the real exchange-minted token's `scope` claim shape
 *  (see useScopeGate's own decode). */
function makeScopedToken(
  allowedActions: ReadonlyArray<string>,
  identity: Readonly<Record<string, string>> = {},
): string {
  const header = b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({ scope: { scopes: [{ allowed_actions: allowedActions }], identity } }),
  );
  return `st_test_${header}.${payload}.sig`;
}

describe('App routing', () => {
  it('redirects an unauthenticated visitor from / to the login page', async () => {
    render(
      <TestProviders initialEntries={['/']}>
        <App />
      </TestProviders>,
    );

    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
  });

  it('renders the home page for an authenticated visitor at /', async () => {
    render(
      <TestProviders
        initialEntries={['/']}
        authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}
      >
        <App />
      </TestProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
    expect(screen.getByText(/alice@example\.com/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open user menu' })).toBeInTheDocument();
  });

  it('renders the 404 page for an unknown route', async () => {
    render(
      <TestProviders initialEntries={['/no-such-route']}>
        <App />
      </TestProviders>,
    );

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  describe('Orgs — nav gating + route guard (the scopeGateTenant/tenantOverride wiring)', () => {
    beforeEach(() => {
      mockedClient.mockReturnValue({
        identity: { listEntities: vi.fn().mockResolvedValue(pageOf([])) },
      } as never);
    });

    afterEach(() => {
      __resetVectrosApiTokenCacheForTest();
    });

    it('shows the Orgs nav item and lets a caller with entities:c:org reach /orgs', async () => {
      const user = userEvent.setup();
      setPartnerApiTokenMinter(async () => ({
        token: makeScopedToken(['entities:c:org'], { partnerUserId: 'usr_alice' }),
        expiresAtMs: Date.now() + 60_000,
      }));

      render(
        <TestProviders
          initialEntries={['/']}
          authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}
        >
          <App />
        </TestProviders>,
      );

      await screen.findByRole('heading', { name: 'Welcome' });
      const orgsLink = await screen.findByRole('link', { name: 'Orgs' });
      await user.click(orgsLink);

      expect(await screen.findByRole('heading', { name: 'Orgs' })).toBeInTheDocument();
    });

    it('hides the Orgs nav item and redirects a caller without entities:c:org away from /orgs', async () => {
      setPartnerApiTokenMinter(async () => ({
        token: makeScopedToken([], {}),
        expiresAtMs: Date.now() + 60_000,
      }));

      render(
        <TestProviders
          initialEntries={['/orgs']}
          authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}
        >
          <App />
        </TestProviders>,
      );

      // RequireScope redirects to "/" — the Welcome heading, not Orgs.
      expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Orgs' })).not.toBeInTheDocument();
    });
  });

  describe('Cases — nav gating + route guard', () => {
    beforeEach(() => {
      mockedClient.mockReturnValue({
        records: { listRecords: vi.fn().mockResolvedValue(pageOf([])) },
      } as never);
    });

    afterEach(() => {
      __resetVectrosApiTokenCacheForTest();
    });

    it('shows the Cases nav item and lets a caller with records:r:case reach /cases', async () => {
      const user = userEvent.setup();
      setPartnerApiTokenMinter(async () => ({
        token: makeScopedToken(['records:r:case']),
        expiresAtMs: Date.now() + 60_000,
      }));

      render(
        <TestProviders
          initialEntries={['/']}
          authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}
        >
          <App />
        </TestProviders>,
      );

      await screen.findByRole('heading', { name: 'Welcome' });
      const casesLink = await screen.findByRole('link', { name: 'Cases' });
      await user.click(casesLink);

      expect(await screen.findByRole('heading', { name: 'Cases' })).toBeInTheDocument();
    });

    it('hides the Cases nav item and redirects a caller without records:r:case away from /cases', async () => {
      setPartnerApiTokenMinter(async () => ({
        token: makeScopedToken([]),
        expiresAtMs: Date.now() + 60_000,
      }));

      render(
        <TestProviders
          initialEntries={['/cases']}
          authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(ALICE) }}
        >
          <App />
        </TestProviders>,
      );

      expect(await screen.findByRole('heading', { name: 'Welcome' })).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Cases' })).not.toBeInTheDocument();
    });
  });
});

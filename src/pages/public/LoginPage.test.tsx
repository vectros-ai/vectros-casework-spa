// ---------------------------------------------------------------------------
// LoginPage tests — the sign-in entry point: the loading/redirect states, the
// "Continue" action kicking off the hosted redirect, its failure path, and
// the deep-link-restore redirect (RequireAuth's `state={{ from: location }}`
// round-trip) — previously untested despite this page being the primary entry
// point every user hits.
//
// Same rendering approach as AcceptInvitePage's suite: AuthProvider resolves
// `loading` asynchronously (a mount-time getCurrentUser() call), so every
// render below awaits the loading spinner clearing before asserting.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

import { LoginPage } from './LoginPage';
import { IntlProvider } from '../../i18n/IntlProvider';
import { AuthProvider } from '../../auth';
import { makeMockAuthProvider } from '../../test/mockAuthProvider';
import type { FullMockProvider } from '../../test/mockAuthProvider';

async function renderPage(
  initialEntries: readonly ({ pathname: string; state?: unknown } | string)[],
  overrides: Partial<FullMockProvider> = {},
): Promise<FullMockProvider> {
  const provider = makeMockAuthProvider(overrides);
  render(
    <IntlProvider>
      <AuthProvider provider={provider}>
        <MemoryRouter initialEntries={initialEntries as never}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/" element={<div>home page</div>} />
            <Route path="/cases/:id" element={<div>case detail page</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </IntlProvider>,
  );
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading session'));
  return provider;
}

describe('LoginPage', () => {
  it('not authenticated: shows the Continue button, no error', async () => {
    await renderPage(['/login']);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('clicking Continue kicks off the hosted redirect', async () => {
    const user = userEvent.setup();
    const provider = await renderPage(['/login']);

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(provider.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('a failure to start the redirect surfaces an error and re-enables the button', async () => {
    const user = userEvent.setup();
    await renderPage(['/login'], {
      signInWithRedirect: vi.fn().mockRejectedValue(new Error('network down')),
    });

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeEnabled();
  });

  it('already authenticated, no deep-link state: redirects to home', async () => {
    await renderPage(['/login'], {
      getCurrentUser: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'a@b.com' }),
    });

    expect(await screen.findByText('home page')).toBeInTheDocument();
  });

  it('already authenticated WITH deep-link state: restores the original destination instead of going home', async () => {
    // The feature this page's own header comment names as its whole reason to check
    // `isAuthenticated` before rendering anything: RequireAuth stashes `state: { from: location }`
    // when it detours an unauthenticated visit through here; once a session resolves, the visitor
    // should land back on the page they actually wanted, not always "/".
    await renderPage(
      [{ pathname: '/login', state: { from: { pathname: '/cases/case_1' } } }],
      { getCurrentUser: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'a@b.com' }) },
    );

    expect(await screen.findByText('case detail page')).toBeInTheDocument();
  });
});

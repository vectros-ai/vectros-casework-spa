// ---------------------------------------------------------------------------
// AcceptInvitePage tests — the "before" half of first-login onboarding:
// token parsing, the missing/malformed-token state, and
// that accepting stashes the token (pendingInvite.ts) before kicking off the
// same hosted-redirect flow LoginPage uses. The "after" half — actually
// binding the invite — is CallbackPage's own suite.
//
// AuthProvider resolves `loading` asynchronously (a mount-time
// getCurrentUser() call), so every render below awaits the loading spinner
// clearing before asserting on the real page content — a synchronous
// getByRole right after render() would race that effect.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

import { AcceptInvitePage } from './AcceptInvitePage';
import { IntlProvider } from '../../i18n/IntlProvider';
import { AuthProvider } from '../../auth';
import { makeMockAuthProvider } from '../../test/mockAuthProvider';
import type { FullMockProvider } from '../../test/mockAuthProvider';

async function renderPage(
  path: string,
  overrides: Partial<FullMockProvider> = {},
): Promise<FullMockProvider> {
  const provider = makeMockAuthProvider(overrides);
  render(
    <IntlProvider>
      <AuthProvider provider={provider}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/accept" element={<AcceptInvitePage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </IntlProvider>,
  );
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading session'));
  return provider;
}

describe('AcceptInvitePage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('missing token: no button offered, shows the incomplete-link message', async () => {
    await renderPage('/accept');
    expect(screen.getByRole('alert')).toHaveTextContent(/looks incomplete/i);
    expect(screen.getByRole('button', { name: /accept invite/i })).toBeDisabled();
  });

  it('malformed token (wrong prefix): treated the same as missing', async () => {
    await renderPage('/accept?t=not-an-invite-token');
    expect(screen.getByRole('alert')).toHaveTextContent(/looks incomplete/i);
    expect(screen.getByRole('button', { name: /accept invite/i })).toBeDisabled();
  });

  it('valid-shaped token: button enabled, no error shown', async () => {
    await renderPage('/accept?t=inv_abc123');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept invite/i })).toBeEnabled();
  });

  it('accepting stashes the token then kicks off the hosted redirect', async () => {
    const user = userEvent.setup();
    const provider = await renderPage('/accept?t=inv_abc123');

    await user.click(screen.getByRole('button', { name: /accept invite/i }));

    expect(sessionStorage.getItem('casework-spa:pendingInviteToken')).toBe('inv_abc123');
    expect(provider.signInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('a failure to start the redirect surfaces an error and re-enables the button', async () => {
    const user = userEvent.setup();
    await renderPage('/accept?t=inv_abc123', {
      signInWithRedirect: vi.fn().mockRejectedValue(new Error('network down')),
    });

    await user.click(screen.getByRole('button', { name: /accept invite/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /accept invite/i })).toBeEnabled();
  });

  it('already authenticated: explains the mismatch (with the current email) instead of silently redirecting, offers a sign-out path', async () => {
    // Regression guard: this used to render <Navigate to="/" /> here, silently dropping the
    // invite with no explanation — indistinguishable from a real failure to the person clicking
    // the link.
    await renderPage('/accept?t=inv_abc123', {
      getCurrentUser: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'a@b.com' }),
    });

    expect(screen.getByRole('status')).toHaveTextContent('a@b.com');
    expect(screen.queryByRole('button', { name: /accept invite/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
  });

  it('already authenticated, no email on the resolved user: falls back to a generic label instead of showing "undefined"', async () => {
    await renderPage('/accept?t=inv_abc123', {
      getCurrentUser: vi.fn().mockResolvedValue({ id: 'usr_1' }),
    });

    expect(screen.getByRole('status')).toHaveTextContent('another account');
  });

  it('already authenticated: clicking "Sign out" calls signOut()', async () => {
    const user = userEvent.setup();
    const provider = await renderPage('/accept?t=inv_abc123', {
      getCurrentUser: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'a@b.com' }),
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(provider.signOut).toHaveBeenCalledTimes(1);
  });
});

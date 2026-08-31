// ---------------------------------------------------------------------------
// CallbackPage tests — the single shared Auth0 redirect target for both plain
// sign-in and first-login invite acceptance. The invite-bind branch (reading
// pendingInvite.ts, calling acceptInvite()) is the new, previously-untested
// logic; the plain-sign-in path is covered too so the two don't drift.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';

import { CallbackPage } from './CallbackPage';
import { IntlProvider } from '../../i18n/IntlProvider';
import { AuthProvider } from '../../auth';
import { makeMockAuthProvider } from '../../test/mockAuthProvider';
import type { FullMockProvider } from '../../test/mockAuthProvider';
import { storePendingInviteToken } from '../../lib/pendingInvite';

function renderPage(
  overrides: Partial<FullMockProvider> = {},
  { strict = false }: { strict?: boolean } = {},
): FullMockProvider {
  // No blanket `getCurrentUser` default here, deliberately — each test picks it explicitly.
  // `AuthProvider`'s own mount-time refresh is what actually drives `isAuthenticated`, independent
  // of whether THIS page's own handleRedirectCallback/acceptInvite calls succeed. The redirect
  // guard below now ALSO checks `!error` (a real bug fix — see the "isAuthenticated already true"
  // test), so a failure test no longer needs to dodge `isAuthenticated` to get a meaningful
  // assertion; each test still picks `getCurrentUser` explicitly to match what it's testing.
  const provider = makeMockAuthProvider(overrides);
  const tree = (
    <IntlProvider>
      <AuthProvider provider={provider}>
        <MemoryRouter initialEntries={['/callback']}>
          <Routes>
            <Route path="/callback" element={<CallbackPage />} />
            <Route path="/" element={<div>home</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </IntlProvider>
  );
  render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return provider;
}

describe('CallbackPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  const AUTHENTICATED: Partial<FullMockProvider> = {
    getCurrentUser: vi.fn().mockResolvedValue({ id: 'usr_1', email: 'a@b.com' }),
  };

  it('plain sign-in: completes the redirect, never calls acceptInvite, lands on home', async () => {
    const provider = renderPage(AUTHENTICATED);
    await screen.findByText('home');
    expect(provider.handleRedirectCallback).toHaveBeenCalledTimes(1);
    expect(provider.acceptInvite).not.toHaveBeenCalled();
  });

  it('pending invite token: binds it after the redirect completes, then clears it', async () => {
    storePendingInviteToken('inv_abc123');
    const provider = renderPage(AUTHENTICATED);

    await screen.findByText('home');
    expect(provider.acceptInvite).toHaveBeenCalledWith('inv_abc123');
    expect(sessionStorage.getItem('casework-spa:pendingInviteToken')).toBeNull();
  });

  it('acceptInvite rejection: shows the invite-specific error, not the generic sign-in one', async () => {
    storePendingInviteToken('inv_abc123');
    renderPage({ acceptInvite: vi.fn().mockRejectedValue(new Error('bad invite token')) });

    expect(await screen.findByText(/couldn't accept this invite/i)).toBeInTheDocument();
    expect(screen.getByText(/ask your hr admin to resend it/i)).toBeInTheDocument();
  });

  it('REGRESSION: acceptInvite rejection still shows the error when isAuthenticated is ALREADY true — the redirect guard must not race it away', async () => {
    // The real bug: Auth0's own handleRedirectCallback sets
    // isAuthenticated true the moment IT succeeds, BEFORE the server-side acceptInvite() call
    // below even runs — so a realistic failure (Auth0 exchange succeeds, invite bind fails)
    // reaches `done` with isAuthenticated already true. Without `&& !error` on the redirect
    // guard, this test's own `home` text would win the race and the error would never render at
    // all — the invitee lands on an empty Home screen, fully signed in, with zero indication
    // their access was never actually granted.
    storePendingInviteToken('inv_abc123');
    renderPage({ ...AUTHENTICATED, acceptInvite: vi.fn().mockRejectedValue(new Error('bad invite token')) });

    expect(await screen.findByText(/couldn't accept this invite/i)).toBeInTheDocument();
    expect(screen.queryByText('home')).not.toBeInTheDocument();
  });

  it('handleRedirectCallback itself failing (no pending invite): generic sign-in error', async () => {
    renderPage({ handleRedirectCallback: vi.fn().mockRejectedValue(new Error('bad code')) });

    expect(await screen.findByText(/sign-in failed/i)).toBeInTheDocument();
  });

  it('REGRESSION: under StrictMode double-invoke, handleRedirectCallback runs exactly once and sign-in still lands on home', async () => {
    // Live-diagnosed 2026-08-28: every local/smoke-suite login failed with
    // "Sign-in failed" despite Auth0's own token exchange succeeding over the
    // network. Root cause was StrictMode's dev-only double effect-invoke: the
    // OLD `cancelled`-flag guard stopped the stale run's own state updates,
    // but did nothing to stop the stale run's handleRedirectCallback() call
    // from actually firing and racing the live run for the one-time
    // authorization code, so the LIVE run (the one whose state commits) could
    // lose that race and render failure even though sign-in truly succeeded.
    // This test pins the fix: exactly one call, and a clean landing on home.
    const provider = renderPage(AUTHENTICATED, { strict: true });

    await screen.findByText('home');
    expect(provider.handleRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it('handleRedirectCallback failing WITH a pending invite: never reads/clears it, never calls acceptInvite', async () => {
    // Asymmetric from the "no pending invite" case above ON PURPOSE: without
    // a token actually stored here, this assertion would pass regardless of
    // whether the read-and-clear step ever ran (the `try` block's first
    // `await` already threw, so control never reaches it either way) — the
    // token still being present afterward is the one observable fact that
    // actually distinguishes "never reached" from "reached and correctly
    // left alone".
    storePendingInviteToken('inv_abc123');
    const provider = renderPage({ handleRedirectCallback: vi.fn().mockRejectedValue(new Error('bad code')) });

    await waitFor(() => expect(screen.getByText(/sign-in failed/i)).toBeInTheDocument());
    expect(provider.acceptInvite).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('casework-spa:pendingInviteToken')).toBe('inv_abc123');
  });
});

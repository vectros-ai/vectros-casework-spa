// ---------------------------------------------------------------------------
// AccountPage tests — profile display, the database-vs-non-database
// password-change gate (the `sub` prefix check), the password-reset request
// itself, and the MFA "manage" redirect. Renders through the shared
// TestProviders harness (real AuthProvider + a mock adapter, same pattern
// HomePage.test.tsx uses) — so this also exercises the wrapper in
// src/auth/index.ts, not a mocked useAuth().
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitForElementToBeRemoved } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';

import { AccountPage } from './AccountPage';
import { TestProviders } from '../../test/TestProviders';
import type { FullMockProvider } from '../../test/mockAuthProvider';

vi.mock('../../api/changePassword', () => ({ requestPasswordChange: vi.fn() }));
import { requestPasswordChange } from '../../api/changePassword';

const mockedRequestPasswordChange = vi.mocked(requestPasswordChange);

const DB_USER = { sub: 'auth0|64f1', email: 'alice@example.com', firstName: 'Alice', lastName: 'Anders' };
const SOCIAL_USER = { sub: 'google-oauth2|10982', email: 'bob@example.com', firstName: null, lastName: null };

async function renderPage(authOverrides: Partial<FullMockProvider> = {}): Promise<void> {
  render(
    <TestProviders
      initialEntries={['/account']}
      authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue(DB_USER), ...authOverrides }}
    >
      <Routes>
        <Route path="/account" element={<AccountPage />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </TestProviders>,
  );
  await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading account…'));
}

describe('AccountPage', () => {
  it('shows a loading indicator while the auth session resolves, not a half-rendered page', async () => {
    // Regression guard: an early version of this page read `useAuth().user` without checking
    // `loading` at all -- during the resolving window `user` is null, so the page silently
    // rendered just a bare back button (no profile, no error, nothing) instead of a spinner.
    let resolveUser!: (value: typeof DB_USER) => void;
    const getCurrentUser = vi.fn(() => new Promise<typeof DB_USER>((resolve) => { resolveUser = resolve; }));
    render(
      <TestProviders initialEntries={['/account']} authOverrides={{ getCurrentUser }}>
        <Routes>
          <Route path="/account" element={<AccountPage />} />
        </Routes>
      </TestProviders>,
    );

    expect(screen.getByLabelText('Loading account…')).toBeInTheDocument();
    resolveUser(DB_USER);
    await waitForElementToBeRemoved(() => screen.queryByLabelText('Loading account…'));
    expect(screen.getByText('Alice Anders')).toBeInTheDocument();
  });

  it('shows the signed-in user\'s name and email', async () => {
    await renderPage();
    expect(screen.getByText('Alice Anders')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('shows the password-reset button for a database-connection user (sub prefixed auth0|)', async () => {
    await renderPage();
    expect(screen.getByRole('button', { name: 'Send password reset email' })).toBeInTheDocument();
  });

  it('hides the password-reset button and explains why for a social-connection user', async () => {
    await renderPage({ getCurrentUser: vi.fn().mockResolvedValue(SOCIAL_USER) });
    expect(screen.queryByRole('button', { name: 'Send password reset email' })).not.toBeInTheDocument();
    expect(
      screen.getByText("Your password is managed by your organization's sign-in provider, not here."),
    ).toBeInTheDocument();
  });

  it('sends the reset request for the signed-in user\'s own email and shows success', async () => {
    const user = userEvent.setup();
    mockedRequestPasswordChange.mockResolvedValue(undefined);
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Send password reset email' }));

    expect(mockedRequestPasswordChange).toHaveBeenCalledWith('alice@example.com');
    expect(await screen.findByText('Check your email for a link to set a new password.')).toBeInTheDocument();
  });

  it('surfaces the error\'s own detail message, not a swallowed generic one', async () => {
    // Regression guard: this used to run the error through extractErrorMessage, which only reads
    // an SDK-shaped `err.body.message` -- changePassword.ts throws a PLAIN Error (it never goes
    // through vectrosApiClient()), so extractErrorMessage always returned undefined here and the
    // specific Auth0 detail this component carefully extracts server-side was silently dropped.
    const user = userEvent.setup();
    mockedRequestPasswordChange.mockRejectedValue(new Error('Password reset request failed: invalid email format'));
    await renderPage();

    await user.click(screen.getByRole('button', { name: 'Send password reset email' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't send the password reset email");
    expect(alert).toHaveTextContent('Password reset request failed: invalid email format');
    expect(screen.getByRole('button', { name: 'Send password reset email' })).toBeEnabled();
  });

  it('"Manage two-factor authentication" re-runs sign-in with no returnTo (the redirect chain does not restore one)', async () => {
    // Regression guard: this button used to pass returnTo: '/account', which
    // signInWithRedirect DOES thread into Auth0's appState -- but nothing in this app's
    // CallbackPage ever reads it back; every successful callback hardcodes a redirect to '/'.
    // Asserting no options were passed pins that this component doesn't promise a round trip
    // the app doesn't implement.
    const user = userEvent.setup();
    const signInWithRedirect = vi.fn().mockResolvedValue(undefined);
    await renderPage({ signInWithRedirect });

    await user.click(screen.getByRole('button', { name: 'Manage two-factor authentication' }));

    // AuthProvider's own wrapper forwards its `options` param unconditionally, so a
    // zero-arg call here still reaches the adapter as an explicit `undefined`, not an
    // omitted argument.
    expect(signInWithRedirect).toHaveBeenCalledWith(undefined);
  });
});

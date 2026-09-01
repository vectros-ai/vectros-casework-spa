// ---------------------------------------------------------------------------
// HomePage tests — the "Check API connection" diagnostic, previously
// untested (App.test.tsx renders this page once for the shell smoke test,
// but never clicks the button). Uses the real getVectrosApiToken +
// setPartnerApiTokenMinter seam (same approach App.test.tsx already
// establishes) rather than mocking @vectros-ai/react directly, so this
// exercises the actual mint path, not a stand-in for it.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  setPartnerApiTokenMinter,
  __resetVectrosApiTokenCacheForTest,
} from '@vectros-ai/react';

import { HomePage } from './HomePage';
import { TestProviders } from '../../test/TestProviders';

afterEach(() => {
  __resetVectrosApiTokenCacheForTest();
  vi.restoreAllMocks();
});

describe('HomePage', () => {
  it('shows the signed-in user email', async () => {
    render(
      <TestProviders authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue({ sub: 's1', email: 'alice@example.com' }) }}>
        <HomePage />
      </TestProviders>,
    );

    expect(await screen.findByText(/alice@example.com/)).toBeInTheDocument();
  });

  it('shows a success message when the token mint succeeds', async () => {
    const user = userEvent.setup();
    setPartnerApiTokenMinter(vi.fn().mockResolvedValue({ token: 'st_ok', expiresAtMs: Date.now() + 60_000 }));
    render(
      <TestProviders authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue({ sub: 's1', email: 'alice@example.com' }) }}>
        <HomePage />
      </TestProviders>,
    );

    await screen.findByText(/alice@example.com/);
    await user.click(screen.getByRole('button', { name: /test api connection/i }));

    // Assert BY ROLE, not by text: the success path's `role="status"` (vs. the error path's
    // `role="alert"`, already covered by another test in this file) is a real, distinct signal
    // that a plain `findByText` would pass regardless of, matching how the error test below
    // checks its own.
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(/vectros api token was minted successfully/i);
  });

  it('shows an error message (with the underlying detail) when the token mint fails', async () => {
    const user = userEvent.setup();
    setPartnerApiTokenMinter(vi.fn().mockRejectedValue(new Error('exchange endpoint unreachable')));
    render(
      <TestProviders authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue({ sub: 's1', email: 'alice@example.com' }) }}>
        <HomePage />
      </TestProviders>,
    );

    await screen.findByText(/alice@example.com/);
    await user.click(screen.getByRole('button', { name: /test api connection/i }));

    // getVectrosApiToken retries once on a genuine mint failure (~1.5s shared delay) before
    // surfacing the error — see vectrosApiTokenCache.ts's own SHARED_MINT_RETRY_DELAY_MS — so this
    // needs a longer wait than the default.
    const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
    expect(alert).toHaveTextContent("Couldn't mint a Vectros API token");
    expect(alert).toHaveTextContent('exchange endpoint unreachable');
  });

  it('disables the button and shows a checking label while the mint is in flight', async () => {
    const user = userEvent.setup();
    let resolveMint!: (value: { token: string; expiresAtMs: number }) => void;
    setPartnerApiTokenMinter(
      () =>
        new Promise((resolve) => {
          resolveMint = resolve;
        }),
    );
    render(
      <TestProviders authOverrides={{ getCurrentUser: vi.fn().mockResolvedValue({ sub: 's1', email: 'alice@example.com' }) }}>
        <HomePage />
      </TestProviders>,
    );

    await screen.findByText(/alice@example.com/);
    await user.click(screen.getByRole('button', { name: /test api connection/i }));

    expect(screen.getByRole('button', { name: /checking/i })).toBeDisabled();

    resolveMint({ token: 'st_ok', expiresAtMs: Date.now() + 60_000 });
    expect(await screen.findByText(/minted successfully/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Failed sign-in: the one login-path spec that must NOT depend on a real
// Auth0 login succeeding. Deliberately its own file, not a second
// `test.describe` inside 01-login.spec.ts -- that file's file-level
// `test.use({ storageState: perFileAuth(test) })` registers `perFileAuth`'s
// `beforeAll` at FILE scope, not describe scope, so a nested describe that
// overrides `storageState` still pays for (and depends on) that file's real
// hosted-login round trip before it ever runs. This test needs no
// authenticated session at all, so it lives somewhere that never calls
// `perFileAuth` in the first place.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';

test.describe('failed sign-in', () => {
  // No `test.use({ storageState })` at all -- Playwright's default is an
  // empty, logged-out context, which is exactly what this test wants.

  test('a bad authorization code at /callback shows the app\'s own error screen, not a blank page', async ({
    page,
  }) => {
    // Every spec in 01-login.spec.ts exercises the happy path only -- nothing there drives a
    // failed exchange. A forged/expired code is the deterministic way to hit CallbackPage's own
    // catch branch against the real Auth0 SDK, without depending on Auth0 Universal Login's own UI.
    await page.goto('/callback?code=not-a-real-authorization-code&state=smoke-test-bad-code');

    await expect(page.getByRole('heading', { name: 'Sign-in failed' })).toBeVisible();
    // A real <a href="/login">, not a <button> -- MUI's Button leaves the native "link" role
    // in place rather than overriding it when it renders as an anchor.
    await expect(page.getByRole('link', { name: 'Back to sign in' })).toBeVisible();
  });
});

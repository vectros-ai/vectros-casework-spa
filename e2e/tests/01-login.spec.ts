// ---------------------------------------------------------------------------
// Sign-in smoke: the whole hosted-redirect + token-exchange chain, driven
// through the real Auth0 Universal Login page (see fixtures/authed.ts), plus
// the user menu's own "Account" link -- the one nav entry point every other
// spec file never has reason to visit.
// ---------------------------------------------------------------------------

import { test, expect } from '@playwright/test';
import { perFileAuth } from '../fixtures/authed';
import { loadCaseworkSpaEnv } from '../fixtures/env';

test.use({ storageState: perFileAuth(test) });

test.describe('sign-in', () => {
  test('lands authenticated and can mint a Vectros API token', async ({ page }) => {
    const env = loadCaseworkSpaEnv();
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();
    await expect(page.getByText(env.email)).toBeVisible();

    await page.getByRole('button', { name: 'Test API connection' }).click();
    await expect(page.getByText(/partner-API token was minted successfully/)).toBeVisible({
      timeout: 15_000,
    });
  });

  test('the "Account" menu item lands on a real page, not a 404', async ({ page }) => {
    const env = loadCaseworkSpaEnv();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: 'Welcome' })).toBeVisible();

    await page.getByRole('button', { name: 'Open user menu' }).click();
    await page.getByRole('menuitem', { name: 'Account' }).click();

    // The regression this pins: the shared AppLayout always renders this menu item, but
    // casework-spa previously declared no /account route at all -- clicking it dropped the
    // whole app shell and landed on the chrome-less 404 page instead.
    await expect(page.getByRole('heading', { level: 1, name: 'Account' })).toBeVisible();
    // Scoped to the page body, not the user menu -- the menu's own "Signed in as" block
    // (still mounted in a portal after the click above) shows the same email.
    const main = page.locator('#main-content');
    await expect(main.getByText(env.email)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send password reset email' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Manage two-factor authentication' })).toBeVisible();
  });
});

// The failed-sign-in case lives in 01-login-failure.spec.ts, not here -- see that file's own
// header comment for why (this file's file-level `perFileAuth` beforeAll would still run first).

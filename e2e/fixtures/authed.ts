import { type Browser, type TestType } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { loadCaseworkSpaEnv } from './env';

/**
 * Per-FILE fresh authentication, the same pattern this suite's sibling
 * reference-app smoke suites use — each authenticated spec file logs in
 * fresh into its own file-unique storageState rather than sharing one
 * across the whole run, so a token-refresh/revocation mid-run in one file
 * can't drop a later file to /login.
 *
 * The login itself is genuinely different from the Cognito-backed apps':
 * casework-spa is hosted-redirect (Auth0 Universal Login), so this drives the
 * REAL Auth0-hosted login page — a cross-origin navigation within the same
 * Playwright page — rather than filling an embedded form. That's not a
 * simplification; it's the only form of "login" this app has. Playwright's
 * storageState captures localStorage per-origin, so it correctly persists
 * both the Auth0 session and this app's own auth0-spa-js cache.
 *
 * Usage — at the TOP of an authenticated spec file:
 *
 *   import { test, expect } from '@playwright/test';
 *   import { perFileAuth } from '../fixtures/authed';
 *   test.use({ storageState: perFileAuth(test) });
 */
const AUTH_DIR = path.join(__dirname, '..', '.auth');
let fileSeq = 0;

export async function freshLogin(browser: Browser, storagePath: string): Promise<void> {
  const env = loadCaseworkSpaEnv();
  // storageState: undefined is REQUIRED — we're creating a fresh logged-out
  // context precisely to produce this file (the project's use.storageState
  // points at this not-yet-written path).
  const context = await browser.newContext({ baseURL: env.appUrl, storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto('/login', { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: 'Continue' }).click();

    // Cross-origin navigation to Auth0's hosted Universal Login page. Anchor
    // on the email field rather than a URL/title check — Auth0's own page
    // structure is the stable contract here, not its hostname or copy.
    await page.getByLabel('Email address').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByLabel('Email address').fill(env.email);
    // Not getByLabel('Password') — Auth0's password field renders a
    // visibility-toggle icon button whose own accessible name also contains
    // "Password", so a label query matches ambiguously (the same trap a
    // custom PasswordField component hits elsewhere in this app family).
    // The textbox-role query targets the input exclusively.
    await page.getByRole('textbox', { name: 'Password' }).fill(env.password);
    // exact: true — Auth0's page also has a "Continue with Google" button,
    // which a substring match on "Continue" resolves ambiguously.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();

    // Auth0 redirects back to /callback, which completes the token exchange
    // and navigates to / (HomePage, <h1>Welcome</h1>). Anchor on that heading
    // so the intermediate "Completing sign-in…" state doesn't race a false
    // match.
    await page
      .getByRole('heading', { level: 1, name: 'Welcome' })
      .waitFor({ state: 'visible', timeout: 30_000 });

    await context.storageState({ path: storagePath });
  } finally {
    await context.close();
  }
}

/**
 * Registers a `beforeAll` that logs in fresh for the calling spec file, and
 * returns the file-unique storageState path to feed `test.use({ storageState })`.
 */
export function perFileAuth(test: TestType<any, any>): string {
  const storagePath = path.join(AUTH_DIR, `file-${fileSeq++}.json`);
  test.beforeAll(async ({ browser }) => {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    await freshLogin(browser, storagePath);
  });
  return storagePath;
}

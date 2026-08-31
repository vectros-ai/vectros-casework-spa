import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * e2e smoke suite for casework-spa — verify your fork actually works end to
 * end. See README.md for setup.
 *
 * No globalSetup / default storageState here, unlike some other Playwright
 * suites: casework-spa's blueprint already provisions every schema, and each
 * spec authenticates fresh via fixtures/authed.ts's perFileAuth (the safer
 * default when unsure whether a shared session survives a mid-run token
 * refresh — Auth0's refresh-token rotation makes that a real, not just
 * theoretical, risk here).
 *
 * Local: ./run.sh loads your .env (SMOKE_USER_EMAIL/SMOKE_USER_PASSWORD),
 * then runs `npx playwright test`. The webServer block spins up Vite
 * (`npm run dev` in the repo root, one level up from this directory) on its
 * default port 3003 — that origin must already be registered as an Allowed
 * Callback URL on your Auth0 application.
 *
 * https, not http — the app's own vite.config.ts serves
 * `https://localhost:3003` whenever a local dev cert exists at `../.cert/`
 * (see `../docs/AUTH0-SETUP.md` — required for the invite flow, whose
 * acceptUrl validation rejects any non-https origin) and falls back to plain
 * http only when that cert is absent. Pointing this suite at https
 * unconditionally, with ignoreHTTPSErrors, means it works against a real
 * mkcert-trusted cert (no warning) or a plain self-signed one (untrusted,
 * would otherwise fail the connection) — and lets the team/invite spec
 * actually exercise the real acceptUrl path. Generate the cert once per
 * clone/machine per AUTH0-SETUP.md before running this suite.
 */
export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }], ['list']]
    : [['html', { open: 'never' }], ['list']],
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.CASEWORK_SPA_URL || 'https://localhost:3003',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: { args: ['--disable-quic'] },
      },
    },
  ],

  // Auto-start the Vite dev server unless SKIP_WEBSERVER is set (--deployed).
  // cwd is the repo root — one level up from this e2e/ directory.
  webServer: process.env.SKIP_WEBSERVER
    ? undefined
    : {
        command: 'npm run dev',
        cwd: path.resolve(__dirname, '..'),
        url: 'https://localhost:3003',
        ignoreHTTPSErrors: true,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});

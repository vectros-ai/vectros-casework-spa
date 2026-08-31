// ---------------------------------------------------------------------------
// Vitest setup — runs once before each test file.
//
// Imports `@testing-library/jest-dom` which extends `expect` with DOM
// matchers (toBeInTheDocument, toHaveTextContent, etc.).
//
// Also stubs Vite's `import.meta.env` reads so src/config.ts doesn't throw
// when imported from tests. Real integration tests can override individual
// values via vi.stubEnv() per test. `VALID_ENV` is exported so a test that
// needs to know "what does a valid env look like" (config.test.ts's own
// blank/missing-var cases) has one source of truth to import rather than a
// second hand-copied literal that could silently drift from this one.
// ---------------------------------------------------------------------------

import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

export const VALID_ENV = {
  VITE_AUTH0_DOMAIN: 'test-tenant.us.auth0.com',
  VITE_AUTH0_CLIENT_ID: 'testclientid1234567890',
  VITE_AUTH0_AUDIENCE: 'https://casework-api-test',
  VITE_VECTROS_EXCHANGE_URL: 'https://api.test.example/v1/auth/token/exchange',
  VITE_VECTROS_API_URL: 'https://api.test.example',
} as const;

for (const [key, value] of Object.entries(VALID_ENV)) {
  vi.stubEnv(key, value);
}

afterEach(() => {
  cleanup();
});

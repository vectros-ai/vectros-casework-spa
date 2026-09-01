/// <reference types="vitest" />
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Local self-signed dev cert (`.cert/`, gitignored — generate with:
//   openssl req -x509 -newkey rsa:2048 -keyout .cert/localhost-key.pem -out .cert/localhost-cert.pem \
//     -days 825 -nodes -subj "/CN=localhost" -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
// ). The platform's invite `acceptUrl` validation
// unconditionally requires `https://` with a domain-name host — an IP literal (`127.0.0.1`) or a
// plain `http://` origin is rejected for EVERY credential, root included, whenever `sendEmail` is
// true. That's real, deliberate app-level anti-open-redirect/anti-SSRF validation — do not treat it
// as a bug to work around. So a real
// end-to-end invite test needs the dev server itself on `https://localhost:<port>`, matching what
// this file's `server.host`/`server.https` below produce (`window.location.origin` in
// `inviteMember.ts` picks this up automatically — no other code change needed). Falls back to plain
// http if the cert isn't present, so a fresh clone without a generated cert still runs.
const localCert =
  existsSync('.cert/localhost-key.pem') && existsSync('.cert/localhost-cert.pem')
    ? { key: readFileSync('.cert/localhost-key.pem'), cert: readFileSync('.cert/localhost-cert.pem') }
    : undefined;

// ---------------------------------------------------------------------------
// Vite + Vitest configuration for casework-spa.
//
// resolve.alias — pre-publish, this workspace consumes @vectros-ai/react as
// its BUILT bundle (one module) rather than the src tree: importing src
// pulls the whole package + its dep graph into every file that touches it
// (ballooning import time in tests) and loads a 2nd @types/react. Run
// `npm run build -w @vectros-ai/react` after changing the lib (or
// `tsup --watch` during active lib development). This alias — and the
// matching one in tsconfig.json — is removed once @vectros-ai/react ships to
// the public npm registry and this app is forked as a standalone repo (a
// fork's package.json depends on the published version like any other dep).
//
// The lib ships Auth0AuthProvider as a SEPARATE entry point (not
// re-exported as a value from the main bundle — see that package's
// tsup.config.ts), so it needs its own alias, listed BEFORE the bare
// '@vectros-ai/react' entry: Vite/Rollup's alias matching is prefix-based,
// so the more specific key must be checked first or it's shadowed by the
// shorter one matching as a prefix.
//
// dedupe forces a single instance of every shared runtime dependency: with
// a built-dist alias, the app and the lib's externalized imports must
// resolve to ONE copy, or React/Query/Intl/Router lose shared context
// ("invalid hook call"; missing provider).
// ---------------------------------------------------------------------------

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
    },
    dedupe: [
      'react',
      'react-dom',
      '@mui/material',
      '@mui/icons-material',
      '@emotion/react',
      '@emotion/styled',
      '@tanstack/react-query',
      'react-intl',
      'react-router',
      '@auth0/auth0-spa-js',
      '@vectros-ai/sdk',
    ],
  },
  server: {
    // Distinct from the other first-party apps' dev ports (developer-portal
    // 3000, admin-app 3001, app.vectros.ai 3002) so all four can run
    // side-by-side locally. strictPort makes a collision a hard failure
    // instead of silently incrementing, and Auth0's "Allowed Callback URLs"
    // allow-list is keyed to an exact origin — a silent port bump would 400
    // on the very first sign-in redirect.
    port: 3003,
    strictPort: true,
    host: 'localhost',
    https: localCert,
  },
  preview: {
    port: 3003,
    strictPort: true,
    host: 'localhost',
    https: localCert,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // e2e/ (this app's own Playwright smoke suite, published alongside it in
    // the public mirror) sits inside this app root, and its *.spec.ts files
    // import @playwright/test, which isn't (and shouldn't be) an app-root
    // devDependency. Vitest's default include glob picks up both *.test.*
    // AND *.spec.* anywhere outside its own default excludes, so without
    // this, `npm test`/`npm run lint`'s typecheck break in every fork the
    // moment e2e/ exists alongside src/. Every app test uses *.test.{ts,tsx}
    // under src/; e2e/ exclusively uses *.spec.ts, so excluding it here is a
    // clean boundary, not a narrowing of what Vitest already covered.
    exclude: [...configDefaults.exclude, 'e2e/**'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // 'forks' (a fresh process per file), not the default 'threads' (a shared
    // worker whose module scope persists across files in the same worker) —
    // @testing-library/user-event caches a reference to jsdom's `document` in
    // a module-level WeakMap at import time. Under 'threads', a later file's
    // fresh jsdom document doesn't match the WeakMap's stale key, and
    // userEvent.setup() throws "Cannot read properties of undefined (reading
    // 'Symbol(Node prepared with document state workarounds)')" — reproduces
    // with any 2+ files run together, even ones with no relation to each
    // other; a single file in isolation always passes, which is what made
    // this look like it wasn't happening.
    pool: 'forks',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx', 'src/vite-env.d.ts'],
    },
  },
});

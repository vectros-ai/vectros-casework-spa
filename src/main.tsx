// ---------------------------------------------------------------------------
// Application entry point.
//
// Responsibilities (in order):
//   1. Validate runtime config (throws at module load if env is incomplete).
//   2. Install global unhandled-rejection / error logging — these complement
//      the React ErrorBoundary (which catches render-phase errors) by
//      catching async/Promise errors React does not see.
//   3. Set the document title from BRAND so a fork re-skins by touching one
//      file, not index.html.
//   4. Instantiate the Auth0 adapter and wire the partner-API token minter
//      to it.
//   5. Mount the React tree under StrictMode + ErrorBoundary +
//      QueryClientProvider + IntlProvider + ThemeProvider + Router.
// ---------------------------------------------------------------------------

import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { ErrorBoundary, setPartnerApiTokenMinter } from '@vectros-ai/react';
import { Auth0AuthProvider } from '@vectros-ai/react/providers/auth0';

import App from './App';
import { AuthProvider } from './auth';
import { AUTH0_CONFIG, VECTROS_API_CONFIG } from './config';
import { BRAND } from './brand';
import { theme } from './theme';
import { IntlProvider } from './i18n/IntlProvider';
import { createQueryClient } from './lib/queryClient';

// Module-level QueryClient singleton — one cache for the app lifetime. Tests
// instantiate fresh per-test clients (see src/test/*).
const queryClient = createQueryClient();

// 1. Config validated by importing it (requireEnv throws on missing values).

// 2. Global async error logging. Render-phase errors are caught by
//    ErrorBoundary; this covers everything else. No PII / query params logged.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[casework-spa] unhandled promise rejection', event.reason);
});
window.addEventListener('error', (event) => {
  console.error('[casework-spa] uncaught error', event.error ?? event.message);
});

// 3. Brand-driven document title.
document.title = BRAND.productName;

// 4. Instantiate the auth-provider adapter. To swap identity providers in a
//    fork, change THIS instantiation (and the matching import) — everything
//    downstream depends only on the provider-agnostic interfaces in
//    @vectros-ai/react.
const authProvider = new Auth0AuthProvider({
  domain: AUTH0_CONFIG.domain,
  clientId: AUTH0_CONFIG.clientId,
  redirectUri: AUTH0_CONFIG.redirectUri,
  exchangeEndpoint: VECTROS_API_CONFIG.exchangeUrl,
  authorizationParams: { audience: AUTH0_CONFIG.audience },
});

// 4a. Wire the partner-API token cache's minter to the just-instantiated
//     adapter. The cache (consumed by non-React code, e.g. an SDK client's
//     token supplier) stays provider-agnostic: it knows nothing about how a
//     bearer is minted. Auth0AuthProvider.mintPartnerApiToken does the
//     Vectros-specific work (the token-exchange call). A fork swaps the
//     provider above + wires its own minter here.
setPartnerApiTokenMinter((tenantId, contextId) =>
  authProvider.mintPartnerApiToken(tenantId, contextId),
);

// 5. Mount.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {/*
      ErrorBoundary intentionally lives OUTSIDE IntlProvider so the boundary
      can still render if react-intl itself fails to mount (catalog import
      error, etc.). ErrorBoundary's copy is hardcoded English + BRAND
      interpolation — a safety net for the safety net.
    */}
    <ErrorBoundary supportEmail={BRAND.supportEmail}>
      {/*
        QueryClientProvider sits inside ErrorBoundary so render errors from
        Query-driven components are caught by the same safety net, but
        OUTSIDE IntlProvider/ThemeProvider/Router so the cache is available
        to every consumer regardless of theming/intl/route boundaries.
        ReactQueryDevtools mounts only in dev — Vite's import.meta.env.DEV is
        statically false in prod, so this is dead-code-eliminated there.
      */}
      <QueryClientProvider client={queryClient}>
        {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        <IntlProvider>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <BrowserRouter>
              <AuthProvider provider={authProvider}>
                <App />
              </AuthProvider>
            </BrowserRouter>
          </ThemeProvider>
        </IntlProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);

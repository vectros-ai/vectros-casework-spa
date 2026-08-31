// ---------------------------------------------------------------------------
// TestProviders — the full provider stack for page/route tests.
//
// Composes (outer → inner): MemoryRouter → QueryClient → IntlProvider →
// AuthProvider(mock). Mirrors the runtime nesting in main.tsx closely enough
// that a routed page renders exactly as it would in the app, while every
// external dependency (auth adapter, router history) is controllable from
// the test.
//
//   - `initialEntries` seeds the MemoryRouter history (default `['/']`).
//   - `authOverrides` pins specific adapter methods (e.g. a signed-in user).
//     Defaults come from makeMockAuthProvider.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import type { Location } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@vectros-ai/react';

import { I18N_DEFAULT_LOCALE, IntlProvider } from '../i18n/IntlProvider';
import { makeMockAuthProvider } from './mockAuthProvider';
import type { FullMockProvider } from './mockAuthProvider';

interface TestProvidersProps {
  readonly children: ReactNode;
  /**
   * MemoryRouter seed history. Defaults to `['/']`. Entries may be a bare
   * path string or a partial `Location` (e.g. `{ pathname, state }`) to seed
   * router state such as a deep-link `from` redirect target.
   */
  readonly initialEntries?: ReadonlyArray<string | Partial<Location>>;
  /** Auth-adapter method overrides merged over makeMockAuthProvider defaults. */
  readonly authOverrides?: Partial<FullMockProvider>;
}

export function TestProviders({
  children,
  initialEntries = ['/'],
  authOverrides,
}: TestProvidersProps): React.JSX.Element {
  // A test-strict client: no retries, no background refetch, infinite gc so
  // assertion timing is deterministic. Constructed per render (each test's
  // render mounts a fresh TestProviders).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  return (
    <MemoryRouter initialEntries={[...initialEntries]}>
      <QueryClientProvider client={queryClient}>
        <IntlProvider locale={I18N_DEFAULT_LOCALE}>
          <AuthProvider provider={makeMockAuthProvider(authOverrides)}>{children}</AuthProvider>
        </IntlProvider>
      </QueryClientProvider>
    </MemoryRouter>
  );
}

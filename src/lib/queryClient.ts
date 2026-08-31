// ---------------------------------------------------------------------------
// TanStack Query (`@tanstack/react-query`) default configuration.
//
// One singleton lives at the app root (instantiated in `main.tsx`); tests
// instantiate fresh per-test clients via `createQueryClient()` to keep the
// cache from leaking across `it()` blocks.
//
//   - `retry: 1` — single transparent retry then bubble.
//   - `staleTime: 30_000` — 30s tolerance before a list read is considered
//     stale, killing the cross-component duplicate-fetch pattern.
//   - `gcTime: 5 * 60_000` — 5min cache lifetime.
//   - `refetchOnWindowFocus: false` — avoids surprising background refetches
//     on tab focus.
//   - `mutations.retry: 0` — mutations never auto-retry; a caller decides
//     whether a given mutation is safe to retry (idempotency, side effects).
// ---------------------------------------------------------------------------

import { QueryClient } from '@tanstack/react-query';

export const QUERY_CLIENT_DEFAULTS = {
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
} as const;

export function createQueryClient(): QueryClient {
  return new QueryClient(QUERY_CLIENT_DEFAULTS);
}

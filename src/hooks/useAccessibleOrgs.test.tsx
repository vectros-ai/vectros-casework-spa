// ---------------------------------------------------------------------------
// useAccessibleOrgs — unit coverage for the discovery/dedup logic itself,
// independent of either call site (CreateCaseDialog, TeamPage's InviteDialog)
// — both of those suites cover the integrated behavior; this one pins the
// hook's own contract: founder ∪ member orgs, deduped, error propagation.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useAccessibleOrgs } from './useAccessibleOrgs';
import { pageOf } from '../test/pageOf';

vi.mock('../api/vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from '../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function wrapperFor(queryClient: QueryClient): ({ children }: { children: ReactNode }) => React.JSX.Element {
  return ({ children }: { children: ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useAccessibleOrgs', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('returns only the founder set when the caller holds no org_membership rows', async () => {
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme' }]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    mockedClient.mockReturnValue({
      identity: { listEntities },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleOrgs('usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.orgs).toEqual([{ id: 'org_1', name: 'Acme' }]);
    // Regression guard (live-staging finding, 2026-08-28): the live API rejects a lookup with no
    // value/from+to/prefix mode set — an omitted `values` isn't "match every org_membership row",
    // it's a 400. Pin the exact self-lookup shape so this can't silently regress again.
    expect(lookupRecords).toHaveBeenCalledWith({
      type: 'org_membership',
      field: 'targetUserId',
      values: ['usr_1'],
    });
  });

  it('unions founder orgs with orgs discovered via org_membership, resolving each membership org id to its entity', async () => {
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Founded Org' }]));
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([{ id: 'mem_1', scopes: ['org:org_2'], payload: { targetUserId: 'usr_1', level: 'member' } }]),
    );
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_2', name: 'Member Org' });
    mockedClient.mockReturnValue({
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleOrgs('usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.orgs).toEqual([
      { id: 'org_1', name: 'Founded Org' },
      { id: 'org_2', name: 'Member Org' },
    ]);
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_2', contextId: 'casework' });
  });

  it('stays isPending (never flips isSuccess) while a membership-discovered org\'s entity fetch is still in flight', async () => {
    // Regression guard: isPending/isSuccess used to only look at the founder + membership-LOOKUP queries,
    // never the per-org getEntity fan-out — so a caller with one founded org and one member-only
    // org would see isSuccess flip true, and `orgs` read as final (missing the member org), for the
    // whole window before that org's entity fetch resolved. A caller of this hook (CreateCaseDialog,
    // TeamPage's InviteDialog) would silently auto-pin the wrong (founder-only) org during that
    // window, since `orgs.length === 1` looked final.
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Founded Org' }]));
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([{ id: 'mem_1', scopes: ['org:org_2'], payload: { targetUserId: 'usr_1', level: 'member' } }]),
    );
    let resolveGetEntity!: (value: { id: string; name: string }) => void;
    const getEntity = vi.fn(() => new Promise((resolve) => { resolveGetEntity = resolve; }));
    mockedClient.mockReturnValue({
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleOrgs('usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    // Founder + membership-lookup queries settle, but the membership org's own entity fetch is
    // still in flight — the hook must NOT report success yet, and `orgs` must not be treated as
    // the final (founder-only) set.
    await waitFor(() => expect(getEntity).toHaveBeenCalled());
    expect(result.current.isPending).toBe(true);
    expect(result.current.isSuccess).toBe(false);

    resolveGetEntity({ id: 'org_2', name: 'Member Org' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.orgs).toEqual([
      { id: 'org_1', name: 'Founded Org' },
      { id: 'org_2', name: 'Member Org' },
    ]);
  });

  it('does not double-fetch an org the caller already founded, even if it also appears in a membership row', async () => {
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Founded Org' }]));
    const lookupRecords = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'mem_1', scopes: ['org:org_1'], payload: { targetUserId: 'usr_1', level: 'admin' } }]));
    const getEntity = vi.fn();
    mockedClient.mockReturnValue({
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleOrgs('usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.orgs).toEqual([{ id: 'org_1', name: 'Founded Org' }]);
    expect(getEntity).not.toHaveBeenCalled();
  });

  it('surfaces isError when the membership lookup fails, even if the founder query succeeds', async () => {
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const lookupRecords = vi.fn().mockRejectedValue(new Error('lookup boom'));
    mockedClient.mockReturnValue({
      identity: { listEntities },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleOrgs('usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
  });

  it('runs no queries at all when disabled (myUserId unresolved)', () => {
    const listEntities = vi.fn();
    const lookupRecords = vi.fn();
    mockedClient.mockReturnValue({
      identity: { listEntities },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleOrgs(undefined, true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    expect(result.current.orgs).toEqual([]);
    expect(result.current.isPending).toBe(false);
    expect(listEntities).not.toHaveBeenCalled();
    expect(lookupRecords).not.toHaveBeenCalled();
  });
});

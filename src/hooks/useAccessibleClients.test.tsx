// ---------------------------------------------------------------------------
// useAccessibleClients — unit coverage for the discovery/dedup/error logic,
// independent of either call site (CreateCaseDialog, ClientsListPage). The
// case this hook exists FOR — a case-handler whose broad org-wide client
// read 403s, but who still resolves clients via founder/member discovery —
// is the one `useAccessibleOrgs`'s own equivalent test suite has no analog
// for, since both of ITS sources are self-scoped and never error for a
// caller who simply has none. See this hook's own header comment.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useAccessibleClients } from './useAccessibleClients';
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

describe('useAccessibleClients', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('an hr-admin-shaped caller sees the broad org-wide list (founder/member sources empty)', async () => {
    const listEntities = vi.fn().mockImplementation(({ scope }: { scope?: string; userId?: string }) =>
      scope ? Promise.resolve(pageOf([{ id: 'client_1', name: 'Acme Employee' }])) : Promise.resolve(pageOf([])),
    );
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    mockedClient.mockReturnValue({ identity: { listEntities }, records: { lookupRecords } } as never);

    const { result } = renderHook(() => useAccessibleClients('org_1', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.clients).toEqual([{ id: 'client_1', name: 'Acme Employee' }]);
    expect(listEntities).toHaveBeenCalledWith(
      expect.objectContaining({ namespace: 'client', scope: 'org:org_1' }),
    );
    // Regression guard (live-staging finding, 2026-08-28): the live API rejects a lookup with no
    // value/from+to/prefix mode set — an omitted `values` isn't "match every client_membership
    // row", it's a 400. Pin the exact self-lookup shape so this can't silently regress again.
    expect(lookupRecords).toHaveBeenCalledWith({
      type: 'client_membership',
      field: 'targetUserId',
      values: ['usr_1'],
    });
  });

  it('a case-handler-shaped caller (broad list 403s) still resolves clients via founder + member discovery — not reported as an error', async () => {
    const listEntities = vi.fn().mockImplementation(({ scope }: { scope?: string; userId?: string }) =>
      scope
        ? Promise.reject(new Error('403 forbidden'))
        : Promise.resolve(
            pageOf([{ id: 'client_founded', name: 'Founded By Me', scopes: ['org:org_1'] }]),
          ),
    );
    const getEntity = vi.fn().mockResolvedValue({ id: 'client_granted', name: 'Granted To Me' });
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'mem_1',
          scopes: ['org:org_1', 'client:client_granted'],
          payload: { targetUserId: 'usr_1', level: 'member' },
        },
      ]),
    );
    mockedClient.mockReturnValue({
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleClients('org_1', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.isError).toBe(false);
    expect(result.current.clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'client_founded', name: 'Founded By Me' }),
        expect.objectContaining({ id: 'client_granted', name: 'Granted To Me' }),
      ]),
    );
    expect(result.current.clients).toHaveLength(2);
  });

  it('filters out a membership row scoped to a DIFFERENT org', async () => {
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const getEntity = vi.fn();
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'mem_1',
          scopes: ['org:org_OTHER', 'client:client_x'],
          payload: { targetUserId: 'usr_1', level: 'member' },
        },
      ]),
    );
    mockedClient.mockReturnValue({
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleClients('org_1', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.clients).toEqual([]);
    expect(getEntity).not.toHaveBeenCalled();
  });

  it('dedupes a client that appears via both the broad list and founder discovery', async () => {
    const SAME_CLIENT = { id: 'client_1', name: 'Same Client' };
    const listEntities = vi.fn().mockResolvedValue(pageOf([SAME_CLIENT]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    mockedClient.mockReturnValue({ identity: { listEntities }, records: { lookupRecords } } as never);

    const { result } = renderHook(() => useAccessibleClients('org_1', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.clients).toEqual([SAME_CLIENT]);
  });

  it('stays isPending (never flips isSuccess) while a membership-discovered client\'s entity fetch is still in flight', async () => {
    // Regression guard, same bug shape `useAccessibleOrgs.test.tsx`'s own identical test documents:
    // this hook's `isPending` computation does fold in `memberClientQueries.some(q => q.isPending)`
    // correctly, but nothing pinned it against a future regression until now.
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'mem_1',
          scopes: ['org:org_1', 'client:client_granted'],
          payload: { targetUserId: 'usr_1', level: 'member' },
        },
      ]),
    );
    let resolveGetEntity!: (value: { id: string; name: string }) => void;
    const getEntity = vi.fn(() => new Promise((resolve) => { resolveGetEntity = resolve; }));
    mockedClient.mockReturnValue({
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    } as never);

    const { result } = renderHook(() => useAccessibleClients('org_1', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(getEntity).toHaveBeenCalled());
    expect(result.current.isPending).toBe(true);
    expect(result.current.isSuccess).toBe(false);

    resolveGetEntity({ id: 'client_granted', name: 'Granted To Me' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.clients).toEqual([{ id: 'client_granted', name: 'Granted To Me' }]);
  });

  it('reports isError only when EVERY source fails', async () => {
    const listEntities = vi.fn().mockRejectedValue(new Error('boom'));
    const lookupRecords = vi.fn().mockRejectedValue(new Error('boom'));
    mockedClient.mockReturnValue({ identity: { listEntities }, records: { lookupRecords } } as never);

    const { result } = renderHook(() => useAccessibleClients('org_1', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.isSuccess).toBe(false);
    expect(result.current.clients).toEqual([]);
  });

  it('runs no queries at all when disabled (no org selected yet)', () => {
    const listEntities = vi.fn();
    const lookupRecords = vi.fn();
    mockedClient.mockReturnValue({ identity: { listEntities }, records: { lookupRecords } } as never);

    const { result } = renderHook(() => useAccessibleClients('', 'usr_1', true), {
      wrapper: wrapperFor(testQueryClient()),
    });

    expect(result.current.clients).toEqual([]);
    expect(listEntities).not.toHaveBeenCalled();
    expect(lookupRecords).not.toHaveBeenCalled();
  });
});

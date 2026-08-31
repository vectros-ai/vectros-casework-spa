// ---------------------------------------------------------------------------
// useOrgName tests — the shared org-id-to-name resolver (was independently
// re-authored in CaseDetailPage.tsx and ClientDetailPage.tsx).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useOrgName } from './useOrgName';

vi.mock('../api/vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from '../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

function wrapperFor(): ({ children }: { children: ReactNode }) => React.JSX.Element {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }): React.JSX.Element => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useOrgName', () => {
  it('falls back to the org id while the fetch is pending, then resolves to the real name', async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_1', name: 'Acme Inc' });
    mockedClient.mockReturnValue({ identity: { getEntity } } as never);

    const { result } = renderHook(() => useOrgName('org_1'), { wrapper: wrapperFor() });

    expect(result.current.name).toBe('org_1');
    await waitFor(() => expect(result.current.name).toBe('Acme Inc'));
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_1', contextId: 'casework' });
  });

  it('falls back to the org id when the org has no name', async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_1', name: '' });
    mockedClient.mockReturnValue({ identity: { getEntity } } as never);

    const { result } = renderHook(() => useOrgName('org_1'), { wrapper: wrapperFor() });

    await waitFor(() => expect(result.current.query.isSuccess).toBe(true));
    expect(result.current.name).toBe('org_1');
  });

  it('does not fetch and returns undefined when orgId is undefined', () => {
    const getEntity = vi.fn();
    mockedClient.mockReturnValue({ identity: { getEntity } } as never);

    const { result } = renderHook(() => useOrgName(undefined), { wrapper: wrapperFor() });

    expect(result.current.name).toBeUndefined();
    expect(getEntity).not.toHaveBeenCalled();
  });
});

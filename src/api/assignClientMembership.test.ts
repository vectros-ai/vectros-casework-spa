// ---------------------------------------------------------------------------
// assignClientMembership — the write side of item C's data-isolation pass.
// Small and mechanical (one call), but the exact `userId`/payload shape is
// load-bearing: get it wrong and the row is either unauthorized (create-side
// coverage) or unreachable by the self-only discovery read that consumes it
// (`useAccessibleClients`) — see this file's own header comment.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('./vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from './vectrosApi';
import { assignClientMembership } from './assignClientMembership';

const mockedClient = vi.mocked(vectrosApiClient);

describe('assignClientMembership', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('stamps the ownership userId AND the payload targetUserId to the SAME value, scoped to both org and client', async () => {
    const createRecord = vi.fn().mockResolvedValue({ id: 'mem_1' });
    mockedClient.mockReturnValue({ records: { createRecord } } as never);

    await assignClientMembership({
      orgId: 'org_1',
      clientId: 'client_1',
      targetUserId: 'usr_handler',
      level: 'member',
    });

    expect(createRecord).toHaveBeenCalledWith({
      body: {
        typeName: 'client_membership',
        scopes: ['org:org_1', 'client:client_1'],
        userId: 'usr_handler',
        payload: { targetUserId: 'usr_handler', level: 'member' },
      },
    });
  });

  it('passes an admin-level assignment through unchanged', async () => {
    const createRecord = vi.fn().mockResolvedValue({ id: 'mem_2' });
    mockedClient.mockReturnValue({ records: { createRecord } } as never);

    await assignClientMembership({
      orgId: 'org_1',
      clientId: 'client_1',
      targetUserId: 'usr_handler',
      level: 'admin',
    });

    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ payload: { targetUserId: 'usr_handler', level: 'admin' } }) }),
    );
  });
});

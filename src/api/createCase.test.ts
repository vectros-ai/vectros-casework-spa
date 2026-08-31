// ---------------------------------------------------------------------------
// createCase.ts — direct unit coverage for the three-call sequence and its
// failure paths. `CasesListPage.test.tsx` exercises this through the
// dialog for the two mainstream cases (new client / existing client, both
// succeeding); it never isolates createCase.ts's OWN defensive throws or the
// partial-failure sequencing this file's header comment documents ("no
// rollback if a later step fails") — this file pins that behavior directly.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCase } from './createCase';

vi.mock('./vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from './vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

describe('createCase', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('throws before making any API call when neither clientId nor newClientName is given', async () => {
    const createEntity = vi.fn();
    const createRecord = vi.fn();
    const createFolder = vi.fn();
    mockedClient.mockReturnValue({
      identity: { createEntity, getEntity: vi.fn() },
      records: { createRecord },
      folders: { createFolder },
    } as never);

    await expect(
      createCase({ orgId: 'org_1', caseType: 'grievance', folderName: 'Grievance' }),
    ).rejects.toThrow('one of clientId or newClientName is required');
    expect(createEntity).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it('throws if the platform creates a client entity with no id', async () => {
    const createEntity = vi.fn().mockResolvedValue({ name: 'Jane Doe' }); // no `id`
    mockedClient.mockReturnValue({
      identity: { createEntity },
      records: { createRecord: vi.fn() },
      folders: { createFolder: vi.fn() },
    } as never);

    await expect(
      createCase({ orgId: 'org_1', newClientName: 'Jane Doe', caseType: 'grievance', folderName: 'Grievance' }),
    ).rejects.toThrow('did not return an id for the client entity');
  });

  it('resolves the existing client by id (getEntity, not createEntity) for a returning client', async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: 'client_9', name: 'Returning' });
    const createEntity = vi.fn();
    const createRecord = vi.fn().mockResolvedValue({ id: 'case_1', scopes: ['org:org_1', 'client:client_9'] });
    const createFolder = vi.fn().mockResolvedValue({ id: 'folder_1' });
    mockedClient.mockReturnValue({
      identity: { getEntity, createEntity },
      records: { createRecord },
      folders: { createFolder },
    } as never);

    await createCase({ orgId: 'org_1', clientId: 'client_9', caseType: 'grievance', folderName: 'Grievance' });

    expect(getEntity).toHaveBeenCalledWith({ namespace: 'client', id: 'client_9', contextId: 'casework' });
    expect(createEntity).not.toHaveBeenCalled();
  });

  it('propagates a folder-create failure WITHOUT rolling back the already-created client, and never reaches the case step (documented, no-rollback behavior)', async () => {
    // Folder is created BEFORE the case now (its id needs to be known to stamp
    // onto the case's own payload), so a folder failure is the one that skips
    // case creation entirely — the inverse of the old client→case→folder order.
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
    const createFolder = vi.fn().mockRejectedValue(new Error('folder create boom'));
    const createRecord = vi.fn();
    mockedClient.mockReturnValue({
      identity: { createEntity },
      records: { createRecord },
      folders: { createFolder },
    } as never);

    await expect(
      createCase({ orgId: 'org_1', newClientName: 'Jane Doe', caseType: 'grievance', folderName: 'Grievance' }),
    ).rejects.toThrow('folder create boom');

    // The client WAS created (step 1 succeeded) — this file's own header comment says explicitly
    // there is no rollback if a later step fails, so the case step is never reached.
    expect(createEntity).toHaveBeenCalledTimes(1);
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('propagates a case-create failure AFTER the folder has already been created (same no-rollback behavior, one step later)', async () => {
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
    const createFolder = vi.fn().mockResolvedValue({ id: 'folder_1' });
    const createRecord = vi.fn().mockRejectedValue(new Error('case create boom'));
    mockedClient.mockReturnValue({
      identity: { createEntity },
      records: { createRecord },
      folders: { createFolder },
    } as never);

    await expect(
      createCase({ orgId: 'org_1', newClientName: 'Jane Doe', caseType: 'grievance', folderName: 'Grievance' }),
    ).rejects.toThrow('case create boom');

    expect(createEntity).toHaveBeenCalledTimes(1);
    expect(createFolder).toHaveBeenCalledTimes(1);
  });

  it('stamps both org and client scopes on the case and folder, and carries assignedTo when given', async () => {
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
    const createRecord = vi.fn().mockResolvedValue({ id: 'case_1', scopes: ['org:org_1', 'client:client_new'] });
    const createFolder = vi.fn().mockResolvedValue({ id: 'folder_1' });
    mockedClient.mockReturnValue({
      identity: { createEntity },
      records: { createRecord },
      folders: { createFolder },
    } as never);

    await createCase({
      orgId: 'org_1',
      newClientName: 'Jane Doe',
      caseType: 'onboarding',
      assignedTo: 'usr_handler',
      folderName: 'Onboarding',
    });

    expect(createFolder).toHaveBeenCalledWith({
      body: expect.objectContaining({ scopes: ['org:org_1', 'client:client_new'] }),
    });
    expect(createRecord).toHaveBeenCalledWith({
      body: expect.objectContaining({
        scopes: ['org:org_1', 'client:client_new'],
        payload: expect.objectContaining({ assignedTo: 'usr_handler', folderId: 'folder_1' }),
      }),
    });
  });
});

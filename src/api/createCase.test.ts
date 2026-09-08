// ---------------------------------------------------------------------------
// createCase.ts — direct unit coverage for the entity call plus the ONE
// composed script execution that replaced the folder+record pair, and the
// failure paths of both. `CasesListPage.test.tsx` exercises this through the
// dialog for the two mainstream cases (new client / existing client, both
// succeeding); it never isolates createCase.ts's OWN defensive throws.
//
// Two cells here used to assert the opposite of what the code now does: they
// pinned "a folder-create failure leaves the client behind" and "a case-create
// failure leaves the FOLDER behind" as documented no-rollback behaviour. The
// second is the defect this change removes, so it is gone rather than inverted
// — there is no longer a separate folder step to fail on its own. The first
// survives in spirit: the client entity is still outside the transaction, and
// that residual is asserted below deliberately rather than left implied.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createCase } from './createCase';

vi.mock('./vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from './vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

/** A client stub with every surface createCase touches, overridable per test. */
function stub(over: {
  createEntity?: unknown;
  getEntity?: unknown;
  deleteEntity?: unknown;
  executeScript?: unknown;
  createFolder?: unknown;
  createRecord?: unknown;
}): void {
  mockedClient.mockReturnValue({
    identity: {
      createEntity: over.createEntity ?? vi.fn().mockResolvedValue({ id: 'client_default' }),
      getEntity: over.getEntity ?? vi.fn(),
      deleteEntity: over.deleteEntity ?? vi.fn(),
    },
    records: { createRecord: over.createRecord ?? vi.fn() },
    folders: { createFolder: over.createFolder ?? vi.fn() },
    scripts: { executeScript: over.executeScript ?? vi.fn() },
  } as never);
}

/**
 * An `executeScript` stub that echoes the externalId it was SENT, as the real
 * script does (it returns `record.externalId`). A fixed literal would fail the
 * echo check for the wrong reason — the caller mints a fresh UUID per call.
 */
function okExecute(): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((req: { input: { caseExternalId: string } }) =>
    Promise.resolve({
      result: { caseId: 'case_1', caseExternalId: req.input.caseExternalId, folderId: 'fld_1' },
      execution: { status: 'SUCCEEDED' },
    }),
  );
}

/** One submission's identity — the caller owns it; retries of the SAME submission reuse it. */
const SUBMISSION = 'sub_0000-1111';

describe('createCase', () => {
  beforeEach(() => {
    mockedClient.mockReset();
  });

  it('throws before making any API call when neither clientId nor newClientName is given', async () => {
    const createEntity = vi.fn();
    const executeScript = vi.fn();
    stub({ createEntity, executeScript });

    await expect(
      createCase({
        submissionId: SUBMISSION,
        orgId: 'org_1',
        caseType: 'grievance',
        folderName: 'Grievance',
      }),
    ).rejects.toThrow('one of clientId or newClientName is required');
    expect(createEntity).not.toHaveBeenCalled();
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('throws if the platform creates a client entity with no id', async () => {
    const executeScript = vi.fn();
    stub({ createEntity: vi.fn().mockResolvedValue({ name: 'Jane Doe' }), executeScript });

    await expect(
      createCase({
        submissionId: SUBMISSION,
        orgId: 'org_1',
        newClientName: 'Jane Doe',
        caseType: 'grievance',
        folderName: 'Grievance',
      }),
    ).rejects.toThrow('did not return an id for the client entity');
    // The compartment scope is built from that id — nothing may be composed without it.
    expect(executeScript).not.toHaveBeenCalled();
  });

  it('composes folder + case into ONE execution, and never calls the folder/record endpoints', async () => {
    const getEntity = vi.fn().mockResolvedValue({ id: 'client_9', name: 'Returning' });
    const createEntity = vi.fn();
    const createFolder = vi.fn();
    const createRecord = vi.fn();
    const executeScript = okExecute();
    stub({ getEntity, createEntity, createFolder, createRecord, executeScript });

    const out = await createCase({
      submissionId: SUBMISSION,
      orgId: 'org_1',
      clientId: 'client_9',
      caseType: 'grievance',
      folderName: 'Grievance',
    });

    // The returning-client path reads the entity, never creates one.
    expect(getEntity).toHaveBeenCalled();
    expect(createEntity).not.toHaveBeenCalled();
    // The whole point: the two independently-failing writes are gone.
    expect(createFolder).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
    expect(executeScript).toHaveBeenCalledTimes(1);
    const sent = (executeScript.mock.calls[0]?.[0] as { input: { caseExternalId: string } }).input
      .caseExternalId;
    expect(out).toEqual({
      caseId: 'case_1',
      caseExternalId: sent,
      folderId: 'fld_1',
      client: { id: 'client_9', name: 'Returning' },
    });
  });

  it('sends the composed payload the script declares — both scopes together, qualified script ref', async () => {
    const executeScript = okExecute();
    stub({
      createEntity: vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' }),
      executeScript,
    });

    await createCase({
      submissionId: SUBMISSION,
      orgId: 'org_1',
      newClientName: 'Jane Doe',
      caseType: 'accommodation',
      folderName: 'Accommodation',
      folderDescription: 'notes',
      assignedTo: 'usr_7',
    });

    const body = executeScript.mock.calls[0]?.[0] as {
      scriptRef: { name: string; version: string };
      input: Record<string, unknown>;
    };
    // Pinned by NAME: the blueprint grants `scripts:x:create-case`, qualified to
    // this one script, so a drifting name here is a 403 at the call site.
    expect(body.scriptRef).toEqual({ name: 'create-case', version: 'latest' });
    // Both compartment dimensions travel together — a case stamps org AND
    // client, and a partial scope list fails at the folder, inside the script.
    expect(body.input.scopes).toEqual(['org:org_1', 'client:client_new']);
    expect(body.input.caseType).toBe('accommodation');
    expect(body.input.folderName).toBe('Accommodation');
    expect(body.input.folderDescription).toBe('notes');
    expect(body.input.assignedTo).toBe('usr_7');
    // The caller owns the idempotency key and the business date, not the script.
    expect(typeof body.input.caseExternalId).toBe('string');
    expect(body.input.openedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sends the submission id as the Idempotency-Key, so a re-submission replays instead of duplicating', async () => {
    // Without this the platform cannot tell a retry from a new request: an execution whose response
    // was lost committed anyway, and the natural second click would mint fresh externalIds and
    // produce a second client, case and folder.
    const executeScript = okExecute();
    stub({ createEntity: vi.fn().mockResolvedValue({ id: 'client_new' }), executeScript });

    await createCase({
      submissionId: SUBMISSION,
      orgId: 'org_1',
      newClientName: 'Jane Doe',
      caseType: 'grievance',
      folderName: 'Grievance',
    });

    const body = executeScript.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['Idempotency-Key']).toBe(`case-create-${SUBMISSION}`);
  });

  it('derives BOTH externalIds from the submission, so the same submission retried reuses them', async () => {
    // The header alone is not enough: the platform compares a keyed request byte for byte, so a
    // body carrying a freshly minted id on every attempt is a DIFFERENT request under the same key
    // and is refused (422) rather than replayed. The ids have to be stable for the key to mean
    // anything.
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new' });
    const executeScript = okExecute();
    stub({ createEntity, executeScript });

    const run = async (): Promise<void> => {
      await createCase({
        submissionId: SUBMISSION,
        orgId: 'org_1',
        newClientName: 'Jane Doe',
        caseType: 'grievance',
        folderName: 'Grievance',
      });
    };
    await run();
    await run();

    // Same submission twice => byte-identical identity on both attempts.
    const [first, second] = createEntity.mock.calls.map(
      (c) => (c[0] as { body: { externalId: string } }).body.externalId,
    );
    expect(first).toBe(`client_${SUBMISSION}`);
    expect(second).toBe(first);

    const sent = executeScript.mock.calls.map(
      (c) => (c[0] as { input: { caseExternalId: string } }).input.caseExternalId,
    );
    expect(sent[0]).toBe(`case_${SUBMISSION}`);
    expect(sent[1]).toBe(sent[0]);
  });

  it('a DIFFERENT submission gets a different key and different ids', async () => {
    // The other direction, and the one that keeps an edited form from colliding with a used key.
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new' });
    const executeScript = okExecute();
    stub({ createEntity, executeScript });

    for (const id of [SUBMISSION, 'sub_2222-3333']) {
      await createCase({
        submissionId: id,
        orgId: 'org_1',
        newClientName: 'Jane Doe',
        caseType: 'grievance',
        folderName: 'Grievance',
      });
    }

    const keys = executeScript.mock.calls.map(
      (c) => (c[0] as Record<string, unknown>)['Idempotency-Key'],
    );
    expect(keys[0]).not.toBe(keys[1]);
    const ids = createEntity.mock.calls.map(
      (c) => (c[0] as { body: { externalId: string } }).body.externalId,
    );
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('omits the optional inputs entirely when not supplied, rather than sending undefined', async () => {
    const executeScript = okExecute();
    stub({ createEntity: vi.fn().mockResolvedValue({ id: 'client_x' }), executeScript });

    await createCase({
      submissionId: SUBMISSION,
      orgId: 'o',
      newClientName: 'N',
      caseType: 'grievance',
      folderName: 'F',
    });

    const body = executeScript.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect('folderDescription' in body.input).toBe(false);
    expect('assignedTo' in body.input).toBe(false);
  });

  it('ATOMICITY: a failed execution commits nothing — no folder and no case are left behind', async () => {
    // The assertion that justifies the whole change, and the one a happy-path
    // test cannot see. The platform commits before it responds, so a rejected
    // execution means nothing was written; what this pins on the client side is
    // that there is no longer a SEPARATE folder write that could have landed
    // first. Before this change the folder call had already succeeded by the
    // time the record call failed, and nothing undid it.
    const createFolder = vi.fn();
    const createRecord = vi.fn();
    const executeScript = vi.fn().mockRejectedValue(new Error('WRITE_BUFFER_CAP_EXCEEDED'));
    stub({
      createEntity: vi.fn().mockResolvedValue({ id: 'client_9' }),
      createFolder,
      createRecord,
      executeScript,
    });

    await expect(
      createCase({
        submissionId: SUBMISSION,
        orgId: 'org_1',
        newClientName: 'Jane',
        caseType: 'grievance',
        folderName: 'G',
      }),
    ).rejects.toThrow('WRITE_BUFFER_CAP_EXCEEDED');

    expect(createFolder).not.toHaveBeenCalled();
    expect(createRecord).not.toHaveBeenCalled();
  });

  it('RESIDUAL: the client entity is outside the transaction and is NOT rolled back', async () => {
    // Deliberate, and asserted so it is not mistaken for full atomicity. A
    // script reaches records, documents and folders — not identity entities —
    // so a failure after the entity create still leaves a client with no case.
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_orphan' });
    const deleteEntity = vi.fn();
    const executeScript = vi.fn().mockRejectedValue(new Error('boom'));
    stub({ createEntity, deleteEntity, executeScript });

    await expect(
      createCase({
        submissionId: SUBMISSION,
        orgId: 'org_1',
        newClientName: 'Jane',
        caseType: 'grievance',
        folderName: 'G',
      }),
    ).rejects.toThrow('boom');

    expect(createEntity).toHaveBeenCalledTimes(1);
    // The assertion the title actually claims: nothing undoes it. Without this the
    // cell asserts only that the entity was created, which every other cell here
    // already asserts.
    expect(deleteEntity).not.toHaveBeenCalled();
  });

  it('names WHICH half of the result was missing, not just that something was', async () => {
    // A single message for both sends whoever reads the alert into the wrong half
    // of the script.
    const cases: [Record<string, unknown>, RegExp][] = [
      [{ folderId: 'f' }, /returned no case id/],
      [{ caseId: 'c' }, /returned no folder id/],
    ];
    for (const [result, expected] of cases) {
      const executeScript = vi.fn().mockResolvedValue({ result, execution: {} });
      stub({ createEntity: vi.fn().mockResolvedValue({ id: 'c' }), executeScript });
      await expect(
        createCase({
          submissionId: SUBMISSION,
          orgId: 'o',
          newClientName: 'N',
          caseType: 'grievance',
          folderName: 'F',
        }),
      ).rejects.toThrow(expected);
    }
  });

  it('refuses an externalId echo that is not the one sent', async () => {
    // This key is what case_note.caseId and case_document.caseId resolve against,
    // so accepting a different value makes every later reference unresolvable.
    const executeScript = vi
      .fn()
      .mockResolvedValue({
        result: { caseId: 'c', caseExternalId: 'not-what-we-sent', folderId: 'f' },
        execution: {},
      });
    stub({ createEntity: vi.fn().mockResolvedValue({ id: 'c' }), executeScript });

    await expect(
      createCase({
        submissionId: SUBMISSION,
        orgId: 'o',
        newClientName: 'N',
        caseType: 'grievance',
        folderName: 'F',
      }),
    ).rejects.toThrow('echoed a different externalId');
  });
});

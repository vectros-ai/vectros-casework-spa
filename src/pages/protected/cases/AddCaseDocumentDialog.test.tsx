// ---------------------------------------------------------------------------
// AddCaseDocumentDialog tests — upload flow, size guard, and the fixed
// scope/folder/schema stamp (no picker for any of the three, unlike the
// upstream app-vectros-ai dialog this was ported from).
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AddCaseDocumentDialog } from './AddCaseDocumentDialog';
import { putBytesOrCompensate } from '../../../api/putBytesOrCompensate';
import { IntlProvider } from '../../../i18n/IntlProvider';
import { pageOf } from '../../../test/pageOf';

vi.mock('../../../api/vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from '../../../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

const SCHEMA = { id: 'schema_case_document', typeName: 'case_document' };

function renderDialog(
  client: Record<string, unknown>,
  props: Partial<React.ComponentProps<typeof AddCaseDocumentDialog>> = {},
) {
  mockedClient.mockReturnValue(client as never);
  const onClose = vi.fn();
  const onUploaded = vi.fn();
  render(
    <IntlProvider>
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <AddCaseDocumentDialog
          open
          caseId="case_1"
          folderId="folder_1"
          orgScope="org:org_1"
          clientScope="client:client_1"
          onClose={onClose}
          onUploaded={onUploaded}
          {...props}
        />
      </QueryClientProvider>
    </IntlProvider>,
  );
  return { onClose, onUploaded };
}

function pickFile(input: HTMLElement, file: File): Promise<void> {
  return userEvent.setup().upload(input, file);
}

describe('AddCaseDocumentDialog', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uploads the chosen file scoped to the case's own org/client and folder, bound to the case_document schema", async () => {
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi
      .fn()
      .mockResolvedValue({ id: 'doc_1', uploadUrl: 'https://s3.example/put' });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', fetchMock);

    const { onUploaded, onClose } = renderDialog({
      schemas: { listSchemas },
      documents: { uploadDocument },
    });

    const file = new File(['hello'], 'intake.pdf', { type: 'application/pdf' });
    await pickFile(screen.getByLabelText('File'), file);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Upload' }));

    await waitFor(() =>
      expect(uploadDocument).toHaveBeenCalledWith({
        fileName: 'intake.pdf',
        fileType: 'application/pdf',
        storeText: true,
        schemaId: 'schema_case_document',
        folderId: 'folder_1',
        scopes: ['org:org_1', 'client:client_1'],
        payload: { caseId: 'case_1' },
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://s3.example/put',
      expect.objectContaining({ method: 'PUT', body: file }),
    );
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('rejects a file over the 100 MB guard before ever calling uploadDocument', async () => {
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi.fn();
    renderDialog({ schemas: { listSchemas }, documents: { uploadDocument } });

    const big = new File(['x'], 'huge.bin', { type: 'application/octet-stream' });
    Object.defineProperty(big, 'size', { value: 101 * 1024 * 1024 });
    await pickFile(screen.getByLabelText('File'), big);

    expect(await screen.findByText(/larger than the 100 MB limit/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload' })).toBeDisabled();
    expect(uploadDocument).not.toHaveBeenCalled();
  });

  it('shows an error alert and keeps the dialog open when the upload fails', async () => {
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi.fn().mockRejectedValue(new Error('boom'));
    const { onClose } = renderDialog({ schemas: { listSchemas }, documents: { uploadDocument } });

    const file = new File(['hello'], 'intake.pdf', { type: 'application/pdf' });
    await pickFile(screen.getByLabelText('File'), file);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't upload this document");
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cleans up the phantom document record (best effort) when the S3 PUT fails after uploadDocument() already created it', async () => {
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi
      .fn()
      // `created: true` as the real endpoint always returns it on a fresh upload
      // -- the guard reads that flag, so a fixture omitting it tests a response
      // shape the API does not produce.
      .mockResolvedValue({ id: 'doc_orphan', created: true, uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    renderDialog({ schemas: { listSchemas }, documents: { uploadDocument, deleteDocument } });

    const file = new File(['hello'], 'intake.pdf', { type: 'application/pdf' });
    await pickFile(screen.getByLabelText('File'), file);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't upload this document");
    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_orphan' }));
  });

  it('still surfaces the original PUT failure, not a cleanup failure, when the best-effort delete also fails', async () => {
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi
      .fn()
      // `created: true` as the real endpoint always returns it on a fresh upload
      // -- the guard reads that flag, so a fixture omitting it tests a response
      // shape the API does not produce.
      .mockResolvedValue({ id: 'doc_orphan', created: true, uploadUrl: 'https://s3.example/put' });
    const deleteDocument = vi.fn().mockRejectedValue(new Error('delete also failed'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    renderDialog({ schemas: { listSchemas }, documents: { uploadDocument, deleteDocument } });

    const file = new File(['hello'], 'intake.pdf', { type: 'application/pdf' });
    await pickFile(screen.getByLabelText('File'), file);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't upload this document");
  });

  it('cleans up the document when the presign comes back without a URL', async () => {
    // The branch that used to leak: this check sat OUTSIDE the try, so the
    // document was created and then abandoned with no compensation at all.
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi.fn().mockResolvedValue({ id: 'doc_orphan', created: true });
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    renderDialog({ schemas: { listSchemas }, documents: { uploadDocument, deleteDocument } });

    const file = new File(['hello'], 'intake.pdf', { type: 'application/pdf' });
    await pickFile(screen.getByLabelText('File'), file);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Upload' }));

    await waitFor(() => expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_orphan' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a SYNCHRONOUSLY throwing delete still surfaces the upload error, not the cleanup one', async () => {
    // Driven through `putBytesOrCompensate` directly, NOT the dialog: the dialog renders identical
    // copy for every failure, so asserting on its alert cannot tell the upload error from the
    // cleanup one and the cell would pass with the `try`/`catch` reverted to a trailing `.catch()`
    // — precisely the bug it is named for. The rejection's identity is the observation that matters.
    //
    // Why the statement form is load-bearing: a client method that throws SYNCHRONOUSLY escapes a
    // promise `.catch`, skips the rethrow, and replaces the error the caller needs.
    // `mockRejectedValue` cannot exercise that path — only an implementation that throws can.
    const deleteDocument = vi.fn(() => {
      throw new Error('sync boom');
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    await expect(
      putBytesOrCompensate(
        { id: 'doc_orphan', created: true, uploadUrl: 'https://s3.example/put' },
        new File(['hello'], 'intake.pdf', { type: 'application/pdf' }),
        'application/pdf',
        deleteDocument as unknown as (args: { id: string }) => Promise<unknown>,
      ),
    ).rejects.toThrow('file upload failed: 403');
    expect(deleteDocument).toHaveBeenCalledWith({ id: 'doc_orphan' });
  });

  it('never deletes a document the upload did not create', async () => {
    // `created: false` means the API returned a document that already existed.
    // Unreachable from this dialog today (it sends no externalId, so nothing can
    // match) -- which is exactly why the guard needs a test: the day someone adds
    // one, an unguarded cleanup becomes a delete of the user's own document.
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const uploadDocument = vi.fn().mockResolvedValue({
      id: 'doc_preexisting',
      created: false,
      uploadUrl: 'https://s3.example/put',
    });
    const deleteDocument = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    renderDialog({ schemas: { listSchemas }, documents: { uploadDocument, deleteDocument } });

    const file = new File(['hello'], 'intake.pdf', { type: 'application/pdf' });
    await pickFile(screen.getByLabelText('File'), file);
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Upload' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't upload this document");
    expect(deleteDocument).not.toHaveBeenCalled();
  });
});

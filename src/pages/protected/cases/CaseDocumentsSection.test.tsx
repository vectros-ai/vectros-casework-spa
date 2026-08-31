// ---------------------------------------------------------------------------
// CaseDocumentsSection tests — list rendering, upload-gate visibility, and
// the download-link mint-on-click flow.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CaseDocumentsSection } from './CaseDocumentsSection';
import { IntlProvider } from '../../../i18n/IntlProvider';
import { pageOf } from '../../../test/pageOf';

vi.mock('../../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn(), CASEWORK_CONTEXT_ID: 'casework' }));
import { vectrosApiClient } from '../../../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);
const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

function renderSection(
  client: Record<string, unknown>,
  props: Partial<React.ComponentProps<typeof CaseDocumentsSection>> = {},
) {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CaseDocumentsSection
          caseId="case_1"
          folderId="folder_1"
          orgScope="org:org_1"
          clientScope="client:client_1"
          canUpload
          {...props}
        />
      </QueryClientProvider>
    </IntlProvider>,
  );
}

describe('CaseDocumentsSection', () => {
  it('lists documents by this case\'s own id, not by folder', async () => {
    const lookupDocuments = vi.fn().mockResolvedValue(
      pageOf([{ id: 'doc_1', title: 'Intake form.pdf', fileSize: 2048, indexStatus: 'INDEXED' }]),
    );
    renderSection({ documents: { lookupDocuments } });

    expect(await screen.findByText('Intake form.pdf')).toBeInTheDocument();
    expect(lookupDocuments).toHaveBeenCalledWith({
      type: 'case_document',
      field: 'caseId',
      value: 'case_1',
    });
  });

  it('shows the empty state distinctly from loading and error', async () => {
    const lookupDocuments = vi.fn().mockResolvedValue(pageOf([]));
    renderSection({ documents: { lookupDocuments } });
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
  });

  it('renders a load error alert on failure', async () => {
    const lookupDocuments = vi.fn().mockRejectedValue(new Error('network down'));
    renderSection({ documents: { lookupDocuments } });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load documents");
  });

  it('hides the upload control when canUpload is false', async () => {
    const lookupDocuments = vi.fn().mockResolvedValue(pageOf([]));
    renderSection({ documents: { lookupDocuments } }, { canUpload: false });
    await screen.findByText('No documents yet.');
    expect(screen.queryByRole('button', { name: 'Upload document' })).not.toBeInTheDocument();
  });

  it('shows the download failure as a real alert (role="alert"), matching every other error in the app', async () => {
    // Regression guard: this used to render as a bare caption Typography, easy to miss and
    // with no role="alert" -- unlike every other error surface in the app.
    const user = userEvent.setup();
    const lookupDocuments = vi.fn().mockResolvedValue(
      pageOf([{ id: 'doc_1', title: 'Intake form.pdf', fileSize: 2048, indexStatus: 'INDEXED' }]),
    );
    const getDocumentDownloadUrl = vi.fn().mockRejectedValue(new Error('link expired'));
    renderSection({ documents: { lookupDocuments, getDocumentDownloadUrl } });

    await user.click(await screen.findByRole('button', { name: 'Intake form.pdf' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't get a download link");
  });

  it('explains why the upload button is disabled for a case with no folder, instead of leaving it unexplained', async () => {
    // Regression guard: every OTHER disabled button in the app wraps in a Tooltip naming the
    // reason; this one didn't.
    const user = userEvent.setup();
    const lookupDocuments = vi.fn().mockResolvedValue(pageOf([]));
    renderSection({ documents: { lookupDocuments } }, { folderId: undefined });

    const uploadButton = await screen.findByRole('button', { name: 'Upload document' });
    expect(uploadButton).toBeDisabled();
    // A disabled button has `pointer-events: none`, so MUI's Tooltip pattern (and this test) must
    // target the wrapping <span> it's rendered in, not the button itself.
    await user.hover(uploadButton.parentElement as HTMLElement);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      "This case predates document folders, so uploads aren't available for it.",
    );
  });

  it('mints a fresh download URL and opens it when a document title is clicked', async () => {
    const user = userEvent.setup();
    const lookupDocuments = vi.fn().mockResolvedValue(
      pageOf([{ id: 'doc_1', title: 'Intake form.pdf', fileSize: 2048, indexStatus: 'INDEXED' }]),
    );
    const getDocumentDownloadUrl = vi.fn().mockResolvedValue({ downloadUrl: 'https://s3.example/get' });
    renderSection({ documents: { lookupDocuments, getDocumentDownloadUrl } });

    await user.click(await screen.findByRole('button', { name: 'Intake form.pdf' }));

    await waitFor(() => expect(getDocumentDownloadUrl).toHaveBeenCalledWith({ id: 'doc_1' }));
    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith('https://s3.example/get', '_blank', 'noopener,noreferrer'),
    );
  });
});

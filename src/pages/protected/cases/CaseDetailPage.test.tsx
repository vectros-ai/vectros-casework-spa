// ---------------------------------------------------------------------------
// CaseDetailPage tests — header/status-change, entries list, add-entry.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CaseDetailPage } from './CaseDetailPage';
import { IntlProvider } from '../../../i18n/IntlProvider';
import { pageOf } from '../../../test/pageOf';
import type { ScopeGateValue } from '@vectros-ai/react';

vi.mock('../../../auth', () => ({ useScopeGate: vi.fn() }));
import { useScopeGate } from '../../../auth';

vi.mock('../../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn(), CASEWORK_CONTEXT_ID: 'casework' }));
import { vectrosApiClient } from '../../../api/vectrosApi';

const mockedUseScopeGate = vi.mocked(useScopeGate);
const mockedClient = vi.mocked(vectrosApiClient);

const FULL_ACCESS_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['records:u:case', 'records:c:case_note'],
  identity: {},
  can: (a) => ['records:u:case', 'records:c:case_note'].includes(a),
};
const READ_ONLY_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: [],
  identity: {},
  can: () => false,
};

const CASE_RECORD = {
  id: 'case_1',
  externalId: 'case_ext_1',
  typeName: 'case',
  schemaId: 'schema_case',
  version: 3,
  payload: { caseType: 'grievance', status: 'open', openedAt: '2026-08-01', folderId: 'folder_1' },
  scopes: ['org:org_1', 'client:client_1'],
};

const NOTE_SCHEMA = {
  id: 'schema_case_note',
  typeName: 'case_note',
  fields: [
    { fieldId: 'noteType', fieldType: 'enum', required: true, enumValues: [{ value: 'intake' }, { value: 'update' }] },
    { fieldId: 'body', fieldType: 'string', required: true, renderHints: undefined },
  ],
};

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** Every test's client is merged onto this — documents defaults to empty
 *  rather than undefined, so a test that doesn't care about the documents
 *  section (most of them) doesn't have to stub it out just to avoid
 *  `documentsQuery` throwing on a missing mock method. */
function defaultClient(): Record<string, unknown> {
  return {
    documents: { lookupDocuments: vi.fn().mockResolvedValue(pageOf([])) },
  };
}

function renderPage(
  client: Record<string, unknown>,
  initialPath = '/cases/case_1',
  queryClient: QueryClient = testQueryClient(),
): QueryClient {
  mockedClient.mockReturnValue({ ...defaultClient(), ...client } as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/cases" element={<div>cases list page</div>} />
            <Route path="/cases/:id" element={<CaseDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return queryClient;
}

describe('CaseDetailPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReset();
  });

  it('loads and renders the case type as the heading, plus its entries', async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'note_1',
          payload: { noteType: 'intake', body: 'First contact made.' },
          createdAt: '2026-08-01T10:00:00Z',
          scopes: ['org:org_1', 'client:client_1'],
        },
      ]),
    );
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('heading', { name: 'grievance' })).toBeInTheDocument();
    expect(getRecord).toHaveBeenCalledWith({ id: 'case_1' });
    expect(await screen.findByText('First contact made.')).toBeInTheDocument();
    // Looked up by this exact case's own id — the platform's `filterByDataScope`
    // narrowing per-role (org-only for hr-admin, org+client for case-handler)
    // still runs underneath; this only pins WHICH rows are asked for.
    expect(lookupRecords).toHaveBeenCalledWith({ type: 'case_note', field: 'caseId', value: 'case_ext_1' });
  });

  it('shows a breadcrumb resolving the case\'s org and client scope to display names, org linked to OrgDetailPage', async () => {
    // A case's org/client are ownership scope dims, not payload fields — before this, nothing
    // resolved them to a name at all, so the page had no visible sense of which org/client a case
    // belongs to.
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const getEntity = vi.fn().mockImplementation(({ namespace, id }: { namespace: string; id: string }) =>
      Promise.resolve({
        id,
        name: namespace === 'org' ? 'Acme Corp' : 'Jane Doe',
      }),
    );
    renderPage({
      records: { getRecord, lookupRecords },
      schemas: { listSchemas: vi.fn() },
      identity: { getEntity },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Acme Corp' })).toHaveAttribute('href', '/orgs/org_1');
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_1', contextId: 'casework' });
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'client', id: 'client_1', contextId: 'casework' });
  });

  it("queries entries by this exact case's own id, not by a client-shared scope — the fix for a client with more than one case", async () => {
    // A client can have MORE than one case (createCase supports picking an
    // EXISTING client for a NEW case), so two different cases share the exact
    // same client:<id> scope. Before this fix, this page asked for every
    // case_note the caller could reach and filtered client-side by that
    // shared scope — indistinguishable between a client's two cases. The fix
    // is precision AT THE QUERY, not a client-side filter: `caseId` names
    // the exact case, so there's no client-side narrowing left to test here —
    // asserting the query's own args IS the regression guard.
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'note_mine',
          payload: { noteType: 'intake', body: 'Belongs to this case.', caseId: 'case_ext_1' },
          createdAt: '2026-08-01T10:00:00Z',
          scopes: ['org:org_1', 'client:client_1'],
        },
      ]),
    );
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByText('Belongs to this case.')).toBeInTheDocument();
    expect(lookupRecords).toHaveBeenCalledWith({ type: 'case_note', field: 'caseId', value: 'case_ext_1' });
  });

  it('renders a load error for a case the caller cannot reach', async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    renderPage({ records: { getRecord, lookupRecords: vi.fn() }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This case doesn't exist, or you don't have access to it.",
    );
  });

  it('renders a load error for the entries list when the case itself loads fine', async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockRejectedValue(new Error('network down'));
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load entries");
  });

  it('renders an error and keeps the composer open when adding an entry fails', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(pageOf([NOTE_SCHEMA]));
    const createRecord = vi.fn().mockRejectedValue(new Error('boom'));
    renderPage({
      records: { getRecord, lookupRecords, createRecord },
      schemas: { listSchemas },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    await user.click(await screen.findByLabelText(/noteType/i));
    await user.click(await screen.findByRole('option', { name: 'update' }));
    await user.type(await screen.findByLabelText(/body/i), 'Called the employee back.');
    await user.click(screen.getByRole('button', { name: 'Add entry' }));

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't add the entry");
    // The composer stays open/visible on failure — nothing navigates away or clears the form.
    expect(screen.getByLabelText(/body/i)).toHaveValue('Called the employee back.');
  });

  it('shows the entries empty state distinctly from loading', async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(await screen.findByText('No entries yet.')).toBeInTheDocument();
  });

  it('shows an explicit unavailable message, not a permanent spinner, for a case that predates externalId', async () => {
    // Regression guard, found live (2026-08-28): `notesQuery` is `enabled: typeof caseExternalId
    // === 'string'` — a DISABLED react-query reports `isPending: true` forever (never
    // distinguishes "actively fetching" from "never enabled"), so checking `isPending` alone
    // spun forever for a real pre-existing case with no `externalId`, no request ever made, no
    // error to show either. `lookupRecords` must never be called here — there is no valid case
    // id to look up by.
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const legacyCase = { ...CASE_RECORD, externalId: undefined };
    const getRecord = vi.fn().mockResolvedValue(legacyCase);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(
      await screen.findByText(
        "Entries aren't available for this case — it was created before entry linking was added.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading entries…')).not.toBeInTheDocument();
    expect(lookupRecords).not.toHaveBeenCalled();
  });

  it('shows a read-only status chip and no add-entry composer for a caller without write scope', async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    expect(screen.queryByText('Add entry')).not.toBeInTheDocument();
  });

  it('changes the case status via the select control when the caller can write', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const updateRecord = vi.fn().mockResolvedValue({ ...CASE_RECORD, payload: { ...CASE_RECORD.payload, status: 'active' } });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([NOTE_SCHEMA]));
    renderPage({
      records: { getRecord, lookupRecords, updateRecord },
      schemas: { listSchemas },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    await user.click(screen.getByLabelText('Status'));
    await user.click(await screen.findByRole('option', { name: 'active' }));

    await waitFor(() =>
      expect(updateRecord).toHaveBeenCalledWith({
        id: 'case_1',
        body: {
          typeName: 'case',
          schemaId: 'schema_case',
          payload: { caseType: 'grievance', status: 'active', openedAt: '2026-08-01', folderId: 'folder_1' },
          expectedVersion: 3,
        },
      }),
    );
    // Regression guard: the status control had an error path wired up but no matching success
    // confirmation, unlike this same page's Save action elsewhere.
    expect(await screen.findByText('Status updated.')).toBeInTheDocument();
  });

  it('invalidates the Cases list cache (not just the single-case query) when the status changes', async () => {
    // Regression guard: the list's own query key (['cases', statusFilter]) is a SEPARATE cache
    // entry from this page's single-case query (['cases', 'record', id]) — invalidating only the
    // latter left a status change made here invisible back on CasesListPage.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const updateRecord = vi.fn().mockResolvedValue({ ...CASE_RECORD, payload: { ...CASE_RECORD.payload, status: 'active' } });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([NOTE_SCHEMA]));
    const queryClient = testQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPage(
      { records: { getRecord, lookupRecords, updateRecord }, schemas: { listSchemas } },
      undefined,
      queryClient,
    );

    await screen.findByRole('heading', { name: 'grievance' });
    await user.click(screen.getByLabelText('Status'));
    await user.click(await screen.findByRole('option', { name: 'active' }));

    await waitFor(() => expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cases'] }));
  });

  it('re-fetches the case after a failed status update, so the next attempt is not stuck on a stale version', async () => {
    // Regression guard for a real bug found live (smoke suite, 2026-08-28): the platform's own
    // optimistic-concurrency check correctly 409s a stale write -- the everyday case of two people
    // having the same case open and one already having changed its status -- but without a refetch here, the
    // record in cache never updates, so clicking the dropdown again (the obvious next move, and
    // what the error text itself invites) resends the SAME stale version and fails identically
    // forever. A page reload was the only way out before this fix.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const updateRecord = vi.fn().mockRejectedValue(new Error('Version conflict'));
    const listSchemas = vi.fn().mockResolvedValue(pageOf([NOTE_SCHEMA]));
    const queryClient = testQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPage(
      { records: { getRecord, lookupRecords, updateRecord }, schemas: { listSchemas } },
      undefined,
      queryClient,
    );

    await screen.findByRole('heading', { name: 'grievance' });
    await user.click(screen.getByLabelText('Status'));
    await user.click(await screen.findByRole('option', { name: 'active' }));

    await screen.findByText("Couldn't update the case status");
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['cases', 'record', 'case_1'] });
  });

  it('adds an entry via the schema-driven composer when the caller can create case_note', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(pageOf([NOTE_SCHEMA]));
    const createRecord = vi.fn().mockResolvedValue({ id: 'note_new' });
    renderPage({
      records: { getRecord, lookupRecords, createRecord },
      schemas: { listSchemas },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    await user.click(await screen.findByLabelText(/noteType/i));
    await user.click(await screen.findByRole('option', { name: 'update' }));
    const bodyField = await screen.findByLabelText(/body/i);
    await user.type(bodyField, 'Called the employee back.');
    await user.click(screen.getByRole('button', { name: 'Add entry' }));

    await waitFor(() =>
      expect(createRecord).toHaveBeenCalledWith({
        body: {
          typeName: 'case_note',
          schemaId: 'schema_case_note',
          payload: { noteType: 'update', body: 'Called the employee back.', caseId: 'case_ext_1' },
          scopes: ['org:org_1', 'client:client_1'],
        },
      }),
    );
  });

  it('does not show the entry composer\'s required fields as errors until they are touched', async () => {
    // Regression guard: validateFields() runs eagerly
    // against the blank entryPayload every fresh page load starts with, so both NOTE_SCHEMA
    // required fields (noteType, body) used to render red the instant the case page loaded --
    // before the caller had touched the composer at all.
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(pageOf([NOTE_SCHEMA]));
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas } });

    await screen.findByRole('heading', { name: 'grievance' });
    await screen.findByLabelText(/body/i);
    expect(screen.queryByText('This field is required.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add entry' })).toBeDisabled();
  });

  it("passes this case's own externalId (not its route/system id) and its folderId (read straight off the case record, no query) down to the documents section", async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const lookupDocuments = vi.fn().mockResolvedValue(
      pageOf([{ id: 'doc_1', title: 'Intake form.pdf', fileSize: 2048, indexStatus: 'INDEXED' }]),
    );
    renderPage({
      records: { getRecord, lookupRecords },
      schemas: { listSchemas: vi.fn() },
      documents: { lookupDocuments },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    // No folders API call at all — folderId comes straight off CASE_RECORD.payload.
    expect(await screen.findByText('Intake form.pdf')).toBeInTheDocument();
    expect(lookupDocuments).toHaveBeenCalledWith({
      type: 'case_document',
      field: 'caseId',
      value: 'case_ext_1',
    });
  });

  it('still lists documents by caseId (no upload target) for a case that predates the folderId field', async () => {
    const uploadGate: ScopeGateValue = {
      loading: false,
      allowedActions: ['documents:c'],
      identity: {},
      can: (a) => a === 'documents:c',
    };
    mockedUseScopeGate.mockReturnValue(uploadGate);
    const getRecord = vi.fn().mockResolvedValue({
      ...CASE_RECORD,
      payload: { caseType: 'grievance', status: 'open', openedAt: '2026-08-01' }, // no folderId
    });
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const lookupDocuments = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      records: { getRecord, lookupRecords },
      schemas: { listSchemas: vi.fn() },
      documents: { lookupDocuments },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
    expect(lookupDocuments).toHaveBeenCalledWith({
      type: 'case_document',
      field: 'caseId',
      value: 'case_ext_1',
    });
    // Upload has nowhere to place a file without a folder id.
    expect(screen.getByRole('button', { name: 'Upload document' })).toBeDisabled();
  });

  it('gates the "Ask about this case" button on inference:r', async () => {
    const user = userEvent.setup();
    const askGate: ScopeGateValue = {
      loading: false,
      allowedActions: ['inference:r'],
      identity: {},
      can: (a) => a === 'inference:r',
    };
    mockedUseScopeGate.mockReturnValue(askGate);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      records: { getRecord, lookupRecords },
      schemas: { listSchemas: vi.fn() },
      inference: { listInferenceModels: vi.fn().mockResolvedValue({ models: [], defaultModel: undefined }) },
    });

    await screen.findByRole('heading', { name: 'grievance' });
    const askButton = await screen.findByRole('button', { name: 'Ask about this case' });
    await waitFor(() => expect(askButton).toBeEnabled());
    await user.click(askButton);

    expect(await screen.findByRole('heading', { name: 'Ask about this case', level: 2 })).toBeInTheDocument();
  });

  it('does not show the "Ask about this case" button for a caller without inference:r', async () => {
    mockedUseScopeGate.mockReturnValue(READ_ONLY_GATE);
    const getRecord = vi.fn().mockResolvedValue(CASE_RECORD);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ records: { getRecord, lookupRecords }, schemas: { listSchemas: vi.fn() } });

    await screen.findByRole('heading', { name: 'grievance' });
    expect(screen.queryByRole('button', { name: 'Ask about this case' })).not.toBeInTheDocument();
  });
});

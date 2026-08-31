// ---------------------------------------------------------------------------
// OrgDetailPage tests — load, edit/save, and the typed-name delete
// confirmation.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OrgDetailPage } from './OrgDetailPage';
import { IntlProvider } from '../../../i18n/IntlProvider';
import { pageOf } from '../../../test/pageOf';
import type { ScopeGateValue } from '@vectros-ai/react';

vi.mock('../../../auth', () => ({ useScopeGate: vi.fn() }));
import { useScopeGate } from '../../../auth';

vi.mock('../../../api/vectrosApi', () => ({
  vectrosApiClient: vi.fn(),
  CASEWORK_CONTEXT_ID: 'casework',
}));
import { vectrosApiClient } from '../../../api/vectrosApi';

const mockedUseScopeGate = vi.mocked(useScopeGate);
const mockedClient = vi.mocked(vectrosApiClient);

const FULL_ACCESS_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['entities:c:org', 'entities:u:org', 'entities:d:org'],
  identity: { partnerUserId: 'usr_alice' },
  can: (a) => ['entities:c:org', 'entities:u:org', 'entities:d:org'].includes(a),
};

const SCHEMA = {
  id: 'schema_org_profile',
  typeName: 'org_profile',
  fields: [
    {
      fieldId: 'industry',
      fieldType: 'enum',
      required: false,
      enumValues: [{ value: 'technology' }, { value: 'healthcare' }],
    },
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

function renderPage(
  client: unknown,
  initialPath = '/orgs/org_1',
  queryClient: QueryClient = testQueryClient(),
): QueryClient {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/orgs" element={<div>orgs list page</div>} />
            <Route path="/orgs/:id" element={<OrgDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return queryClient;
}

describe('OrgDetailPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReset();
  });

  it('loads and renders the org name as the page heading, with its schema fields seeded', async () => {
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue({
      id: 'org_1',
      externalId: 'org_ext_1',
      name: 'Acme Corp',
      payload: { industry: 'technology' },
    });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    renderPage({ identity: { getEntity }, schemas: { listSchemas } });

    expect(await screen.findByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_1', contextId: 'casework' });
    expect(await screen.findByLabelText(/Org name/)).toHaveValue('Acme Corp');
  });

  it('does not show a required field as an error on load, until it is touched -- even for an existing record missing it', async () => {
    // Regression guard: see ClientDetailPage's identical fix for the full rationale -- this edit
    // page previously passed validateFields()'s raw output straight through, latent as long as
    // every saved record already satisfied its schema.
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue({
      id: 'org_1',
      externalId: 'org_ext_1',
      name: 'Acme Corp',
      payload: {}, // missing the new required field below
    });
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'schema_org_profile',
          typeName: 'org_profile',
          fields: [{ fieldId: 'headquarters', fieldType: 'string', required: true }],
        },
      ]),
    );
    renderPage({ identity: { getEntity }, schemas: { listSchemas } });

    await screen.findByRole('heading', { name: 'Acme Corp' });
    await screen.findByLabelText('headquarters', { exact: false }); // rendered label is "headquarters *"
    expect(screen.queryByText('This field is required.')).not.toBeInTheDocument();
  });

  it('renders a load error for an org the caller cannot reach (uniform not-found)', async () => {
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    renderPage({ identity: { getEntity }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This org doesn't exist, or you don't have access to it.",
    );
  });

  it('saves an edited name', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue({
      id: 'org_1',
      externalId: 'org_ext_1',
      name: 'Acme Corp',
      payload: {},
    });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockResolvedValue({ id: 'org_1', name: 'Acme Corporation' });
    renderPage({ identity: { getEntity, updateEntity }, schemas: { listSchemas } });

    const nameField = await screen.findByLabelText(/Org name/);
    await user.clear(nameField);
    await user.type(nameField, 'Acme Corporation');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateEntity).toHaveBeenCalledWith({
        namespace: 'org',
        id: 'org_1',
        contextId: 'casework',
        body: {
          externalId: 'org_ext_1',
          name: 'Acme Corporation',
          schemaId: 'schema_org_profile',
          payload: {},
        },
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('surfaces a save error and keeps the edited name in the field', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue({
      id: 'org_1',
      externalId: 'org_ext_1',
      name: 'Acme Corp',
      payload: {},
    });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockRejectedValue(new Error('boom'));
    renderPage({ identity: { getEntity, updateEntity }, schemas: { listSchemas } });

    const nameField = await screen.findByLabelText(/Org name/);
    await user.clear(nameField);
    await user.type(nameField, 'Acme Corporation');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText("Couldn't save your changes")).toBeInTheDocument();
    expect(nameField).toHaveValue('Acme Corporation');
  });

  it('hides edit/delete controls for a caller without entities:u:org / entities:d:org', async () => {
    mockedUseScopeGate.mockReturnValue({
      loading: false,
      allowedActions: [],
      identity: { partnerUserId: 'usr_alice' },
      can: () => false,
    });
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_1', externalId: 'e', name: 'Acme Corp', payload: {} });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    renderPage({ identity: { getEntity }, schemas: { listSchemas } });

    await screen.findByRole('heading', { name: 'Acme Corp' });
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete org' })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Org name/)).toBeDisabled();
  });

  describe('delete confirmation', () => {
    it('keeps the confirm button disabled until the typed name matches exactly', async () => {
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi
        .fn()
        .mockResolvedValue({ id: 'org_1', externalId: 'e', name: 'Acme Corp', payload: {} });
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      renderPage({ identity: { getEntity }, schemas: { listSchemas } });

      await screen.findByRole('heading', { name: 'Acme Corp' });
      await user.click(screen.getByRole('button', { name: 'Delete org' }));

      const confirmButtons = screen.getAllByRole('button', { name: 'Delete org' });
      const dialogConfirm = confirmButtons[confirmButtons.length - 1];
      expect(dialogConfirm).toBeDisabled();

      await user.type(screen.getByLabelText(/Type "Acme Corp" to confirm/), 'Wrong Name');
      expect(dialogConfirm).toBeDisabled();
    });

    it('deletes the org and navigates back to the list once the typed name matches', async () => {
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi
        .fn()
        .mockResolvedValue({ id: 'org_1', externalId: 'e', name: 'Acme Corp', payload: {} });
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const deleteEntity = vi.fn().mockResolvedValue(undefined);
      renderPage({ identity: { getEntity, deleteEntity }, schemas: { listSchemas } });

      await screen.findByRole('heading', { name: 'Acme Corp' });
      await user.click(screen.getByRole('button', { name: 'Delete org' }));
      await user.type(screen.getByLabelText(/Type "Acme Corp" to confirm/), 'Acme Corp');

      const confirmButtons = screen.getAllByRole('button', { name: 'Delete org' });
      await user.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() =>
        expect(deleteEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_1', contextId: 'casework' }),
      );
      expect(await screen.findByText('orgs list page')).toBeInTheDocument();
    });

    it('invalidates both the founder-org list and this single-org cache entry on delete', async () => {
      // The delete-cache-gap fix itself (both invalidateQueries calls above) had no direct
      // regression test — only inferred from the nav-away assertion above, which would pass even
      // if one of the two invalidations were silently dropped again. Pins BOTH keys directly, same
      // pattern CaseDetailPage.test.tsx's own cache-invalidation tests use.
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi
        .fn()
        .mockResolvedValue({ id: 'org_1', externalId: 'e', name: 'Acme Corp', payload: {} });
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const deleteEntity = vi.fn().mockResolvedValue(undefined);
      const queryClient = testQueryClient();
      const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
      renderPage(
        { identity: { getEntity, deleteEntity }, schemas: { listSchemas } },
        '/orgs/org_1',
        queryClient,
      );

      await screen.findByRole('heading', { name: 'Acme Corp' });
      await user.click(screen.getByRole('button', { name: 'Delete org' }));
      await user.type(screen.getByLabelText(/Type "Acme Corp" to confirm/), 'Acme Corp');
      const confirmButtons = screen.getAllByRole('button', { name: 'Delete org' });
      await user.click(confirmButtons[confirmButtons.length - 1]!);

      await waitFor(() => expect(deleteEntity).toHaveBeenCalledTimes(1));
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orgs', 'founded'] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['orgs', 'entity', 'org_1'] });
    });

    it('surfaces a delete error with a request-id reference and keeps the dialog open', async () => {
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi
        .fn()
        .mockResolvedValue({ id: 'org_1', externalId: 'e', name: 'Acme Corp', payload: {} });
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const deleteEntity = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('boom'), { body: { requestId: 'req_abc123' } }));
      renderPage({ identity: { getEntity, deleteEntity }, schemas: { listSchemas } });

      await screen.findByRole('heading', { name: 'Acme Corp' });
      await user.click(screen.getByRole('button', { name: 'Delete org' }));
      await user.type(screen.getByLabelText(/Type "Acme Corp" to confirm/), 'Acme Corp');

      const confirmButtons = screen.getAllByRole('button', { name: 'Delete org' });
      await user.click(confirmButtons[confirmButtons.length - 1]!);

      expect(await screen.findByText("Couldn't delete the org")).toBeInTheDocument();
      expect(screen.getByText(/req_abc123/)).toBeInTheDocument();
      // Dialog stays open on failure — the typed confirmation is still there.
      expect(screen.getByLabelText(/Type "Acme Corp" to confirm/)).toHaveValue('Acme Corp');
    });
  });
});

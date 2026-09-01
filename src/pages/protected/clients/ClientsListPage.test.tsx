// ---------------------------------------------------------------------------
// ClientsListPage tests — the org-scoped client list + "+ Create client" flow.
// `useAccessibleOrgs`/`useAccessibleClients` have their own dedicated unit
// suites; this one covers the page's own wiring (which org gets queried,
// empty/error states, the create flow) with both hooks' underlying calls
// mocked at the SDK-client boundary.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ClientsListPage } from './ClientsListPage';
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

const CREATE_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['entities:c:client'],
  identity: { partnerUserId: 'usr_alice' },
  can: (a) => a === 'entities:c:client',
};

/** One founded org, no other discovery rows — the common single-org case. The editable picker
 *  doesn't render (no real choice to offer), but a disabled field naming the org still does. */
function singleOrgClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
    namespace === 'org' ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }])) : Promise.resolve(pageOf([])),
  );
  const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
  return {
    identity: { listEntities },
    records: { lookupRecords },
    schemas: { listSchemas: vi.fn() },
    ...overrides,
  };
}

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderPage(client: unknown, queryClient: QueryClient = testQueryClient()): QueryClient {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/clients']}>
          <Routes>
            <Route path="/clients" element={<ClientsListPage />} />
            <Route path="/clients/:id" element={<div>client detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return queryClient;
}

describe('ClientsListPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReset();
  });

  it('shows the empty state for a single-org caller with no clients', async () => {
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    renderPage(singleOrgClient());

    expect(await screen.findByText('No clients yet — create one to get started.')).toBeInTheDocument();
  });

  it('shows a disabled field naming the org for a single-org caller, matching Cases/Team\'s own pattern', async () => {
    // Regression guard: this page previously
    // showed NEITHER a picker NOR a disabled fallback for a single-org caller -- silently
    // omitting the field entirely, unlike CasesListPage's CreateCaseDialog and TeamPage's
    // InviteDialog, which both already showed the org named in a disabled field.
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    renderPage(singleOrgClient());

    const orgField = await screen.findByLabelText('Org');
    expect(orgField).toBeDisabled();
    expect(orgField).toHaveValue('Acme Inc');
  });

  it('lists clients for the caller\'s single org, linking to the detail page', async () => {
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    const listEntities = vi.fn().mockImplementation(({ namespace, scope }: { namespace: string; scope?: string }) => {
      if (namespace === 'org') return Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }]));
      if (namespace === 'client' && scope) {
        return Promise.resolve(pageOf([{ id: 'client_1', name: 'Jane Doe' }]));
      }
      return Promise.resolve(pageOf([]));
    });
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { listEntities },
      records: { lookupRecords },
      schemas: { listSchemas: vi.fn() },
    });

    expect(await screen.findByRole('link', { name: 'Jane Doe' })).toHaveAttribute('href', '/clients/client_1');
  });

  it('surfaces a load error when every discovery source fails', async () => {
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
      namespace === 'org'
        ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }]))
        : Promise.reject(new Error('network down')),
    );
    const lookupRecords = vi.fn().mockRejectedValue(new Error('network down'));
    renderPage({
      identity: { listEntities },
      records: { lookupRecords },
      schemas: { listSchemas: vi.fn() },
    });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your clients");
  });

  it('hides the create button and disables it for a caller without entities:c:client', async () => {
    mockedUseScopeGate.mockReturnValue({
      loading: false,
      allowedActions: [],
      identity: { partnerUserId: 'usr_alice' },
      can: () => false,
    });
    renderPage(singleOrgClient());

    await screen.findByText('No clients yet — create one to get started.');
    expect(screen.getByRole('button', { name: 'Create client' })).toBeDisabled();
  });

  it('creates a client scoped to the selected org with the schema-driven payload, then closes the dialog', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([{ id: 'schema_client_profile', typeName: 'client_profile', fields: [] }]),
    );
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
    const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
      namespace === 'org' ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }])) : Promise.resolve(pageOf([])),
    );
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { listEntities, createEntity },
      records: { lookupRecords },
      schemas: { listSchemas },
    });

    await screen.findByText('No clients yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    await user.type(await screen.findByLabelText(/Client name/), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    await waitFor(() => expect(createEntity).toHaveBeenCalledTimes(1));
    const call = createEntity.mock.calls[0]![0];
    expect(call.namespace).toBe('client');
    expect(call.contextId).toBe('casework');
    expect(call.body.name).toBe('Jane Doe');
    expect(call.body.schemaId).toBe('schema_client_profile');
    expect(call.body.scopes).toEqual(['org:org_1']);

    await waitFor(() => {
      expect(screen.queryByLabelText(/Client name/)).not.toBeInTheDocument();
    });
  });

  it('navigates to the new client\'s detail page on create, instead of just closing with no feedback', async () => {
    // Regression guard -- see OrgsListPage's identical fix.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([{ id: 'schema_client_profile', typeName: 'client_profile', fields: [] }]),
    );
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
    const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
      namespace === 'org' ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }])) : Promise.resolve(pageOf([])),
    );
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { listEntities, createEntity },
      records: { lookupRecords },
      schemas: { listSchemas },
    });

    await screen.findByText('No clients yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: 'Create client' }));
    await user.type(await screen.findByLabelText(/Client name/), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    expect(await screen.findByText('client detail page')).toBeInTheDocument();
  });

  it('does not show a required field as an error on a blank create-client form until it is touched', async () => {
    // Regression guard -- see OrgsListPage's identical fix.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'schema_client_profile',
          typeName: 'client_profile',
          fields: [
            {
              fieldId: 'department',
              fieldType: 'string',
              required: true,
            },
          ],
        },
      ]),
    );
    const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
      namespace === 'org' ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }])) : Promise.resolve(pageOf([])),
    );
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ identity: { listEntities }, records: { lookupRecords }, schemas: { listSchemas } });

    await screen.findByText('No clients yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    await screen.findByLabelText(/Client name/);
    expect(screen.queryByText('This field is required.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create client' })).toBeDisabled();
  });

  it('invalidates BOTH the broad org list AND the caller\'s own founder-discovery cache on create', async () => {
    // Regression guard (review finding, 2026-08-28): this used to invalidate only the broad
    // org-wide list — which 403s for a case-handler (their own `entities:r:client` is
    // founder/member-narrowed as of this pass) — so a case-handler creating their OWN client never
    // saw it appear in their own list until an unrelated cache eviction. `entities:c:client` is
    // granted org-wide to BOTH roles, so this is a real, reachable path, not a theoretical one.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(CREATE_GATE);
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([{ id: 'schema_client_profile', typeName: 'client_profile', fields: [] }]),
    );
    const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
    const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
      namespace === 'org' ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }])) : Promise.resolve(pageOf([])),
    );
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const queryClient = testQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPage(
      {
        identity: { listEntities, createEntity },
        records: { lookupRecords },
        schemas: { listSchemas },
      },
      queryClient,
    );

    await screen.findByText('No clients yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: 'Create client' }));
    await user.type(await screen.findByLabelText(/Client name/), 'Jane Doe');
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    await waitFor(() => expect(createEntity).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients', 'byOrg', 'org_1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients', 'founder', 'usr_alice'] });
  });
});

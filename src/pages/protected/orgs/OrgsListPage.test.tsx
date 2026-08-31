// ---------------------------------------------------------------------------
// OrgsListPage tests — the founder org list + "+ Create org" flow.
//
// useScopeGate and the SDK client are both mocked (same approach as
// app-vectros-ai's RecordEditorPage/RecordsPage suites): this page's own
// logic — which query fires when, how the create payload is assembled, the
// empty/loading/error states — is what's under test, not the real token
// mint or network layer.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { OrgsListPage } from './OrgsListPage';
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

const FOUNDER_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['entities:c:org'],
  identity: { partnerUserId: 'usr_alice' },
  can: (a) => a === 'entities:c:org',
};

function testQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
}

function renderPage(client: unknown): void {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={testQueryClient()}>
        <MemoryRouter initialEntries={['/orgs']}>
          <Routes>
            <Route path="/orgs" element={<OrgsListPage />} />
            <Route path="/orgs/:id" element={<div>detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
}

describe('OrgsListPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReset();
  });

  it('shows the empty state when the caller has founded no orgs', async () => {
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ identity: { listEntities }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByText('No orgs yet — create one to get started.')).toBeInTheDocument();
    expect(listEntities).toHaveBeenCalledWith({
      namespace: 'org',
      contextId: 'casework',
      userId: 'usr_alice',
    });
  });

  it('lists founded orgs, each badged Founder, linking to its detail page', async () => {
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'org_1', externalId: 'org_ext_1', name: 'Acme Corp' },
        { id: 'org_2', externalId: 'org_ext_2', name: 'Beta LLC' },
      ]),
    );
    renderPage({ identity: { listEntities }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('link', { name: 'Acme Corp' })).toHaveAttribute(
      'href',
      '/orgs/org_1',
    );
    expect(screen.getByRole('link', { name: 'Beta LLC' })).toHaveAttribute('href', '/orgs/org_2');
    expect(screen.getAllByText('Founder')).toHaveLength(2);
  });

  it('refetches the orgs list when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(
      pageOf([{ id: 'org_1', externalId: 'org_ext_1', name: 'Acme Corp' }]),
    );
    renderPage({ identity: { listEntities }, schemas: { listSchemas: vi.fn() } });

    await screen.findByRole('link', { name: 'Acme Corp' });
    expect(listEntities).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(listEntities).toHaveBeenCalledTimes(2));
  });

  it('surfaces a load error for the orgs list', async () => {
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockRejectedValue(new Error('network down'));
    renderPage({ identity: { listEntities }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load your orgs");
  });

  it('warns instead of querying when the scope gate resolves with no partnerUserId', async () => {
    mockedUseScopeGate.mockReturnValue({
      loading: false,
      allowedActions: ['entities:c:org'],
      identity: {},
      can: (a) => a === 'entities:c:org',
    });
    const listEntities = vi.fn();
    renderPage({ identity: { listEntities }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't resolve your account identity/i);
    expect(listEntities).not.toHaveBeenCalled();
  });

  it('hides the create button and disables it for a caller without entities:c:org', async () => {
    mockedUseScopeGate.mockReturnValue({
      loading: false,
      allowedActions: [],
      identity: { partnerUserId: 'usr_alice' },
      can: () => false,
    });
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ identity: { listEntities }, schemas: { listSchemas: vi.fn() } });

    await screen.findByText('No orgs yet — create one to get started.');
    expect(screen.getByRole('button', { name: '+ Create org' })).toBeDisabled();
  });

  it('creates an org with the entered name and schema-driven payload, then closes the dialog', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        {
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
        },
      ]),
    );
    const createEntity = vi.fn().mockResolvedValue({ id: 'org_new', name: 'Acme Corp' });
    renderPage({
      identity: { listEntities, createEntity },
      schemas: { listSchemas },
    });

    await screen.findByText('No orgs yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: '+ Create org' }));

    const nameField = await screen.findByLabelText(/Org name/);
    await user.type(nameField, 'Acme Corp');

    await user.click(screen.getByRole('button', { name: 'Create org' }));

    await waitFor(() => expect(createEntity).toHaveBeenCalledTimes(1));
    const call = createEntity.mock.calls[0]![0];
    expect(call.namespace).toBe('org');
    expect(call.contextId).toBe('casework');
    expect(call.body.name).toBe('Acme Corp');
    expect(call.body.schemaId).toBe('schema_org_profile');
    expect(typeof call.body.externalId).toBe('string');
    expect(call.body.externalId.length).toBeGreaterThan(0);

    // Dialog closes on success.
    await waitFor(() => {
      expect(screen.queryByLabelText(/Org name/)).not.toBeInTheDocument();
    });
  });

  it('navigates to the new org\'s detail page on create, instead of just closing with no feedback', async () => {
    // Regression guard: this dialog used to just close
    // silently on success -- the only sign anything happened was scanning the table for a new
    // row. Now matches CasesListPage's own create-flow pattern.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([{ id: 'schema_org_profile', typeName: 'org_profile', fields: [] }]),
    );
    const createEntity = vi.fn().mockResolvedValue({ id: 'org_new', name: 'Acme Corp' });
    renderPage({ identity: { listEntities, createEntity }, schemas: { listSchemas } });

    await screen.findByText('No orgs yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: '+ Create org' }));
    await user.type(await screen.findByLabelText(/Org name/), 'Acme Corp');
    await user.click(screen.getByRole('button', { name: 'Create org' }));

    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('does not show a required field as an error on a blank create-org form until it is touched', async () => {
    // Regression guard: validateFields() runs eagerly
    // against the blank payload every create dialog starts with, so a required schema field used
    // to render red the instant the dialog opened -- before the caller had typed anything.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'schema_org_profile',
          typeName: 'org_profile',
          fields: [
            {
              fieldId: 'industry',
              fieldType: 'enum',
              required: true,
              enumValues: [{ value: 'technology' }],
            },
          ],
        },
      ]),
    );
    renderPage({ identity: { listEntities }, schemas: { listSchemas } });

    await screen.findByText('No orgs yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: '+ Create org' }));

    await screen.findByLabelText(/Org name/);
    expect(screen.queryByText('This field is required.')).not.toBeInTheDocument();
    // The create button correctly stays disabled -- the field IS still genuinely invalid, only
    // its red error state is suppressed until touched.
    expect(screen.getByRole('button', { name: 'Create org' })).toBeDisabled();
  });

  it('surfaces a load error for the org_profile schema inside the create dialog', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockRejectedValue(new Error('network down'));
    renderPage({ identity: { listEntities }, schemas: { listSchemas } });

    await screen.findByText('No orgs yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: '+ Create org' }));

    expect(await screen.findByText("Couldn't load the org profile fields")).toBeInTheDocument();
  });

  it('surfaces a create error and keeps the dialog open on failure', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FOUNDER_GATE);
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([{ id: 'schema_org_profile', typeName: 'org_profile', fields: [] }]),
    );
    const createEntity = vi.fn().mockRejectedValue(new Error('boom'));
    renderPage({
      identity: { listEntities, createEntity },
      schemas: { listSchemas },
    });

    await screen.findByText('No orgs yet — create one to get started.');
    await user.click(screen.getByRole('button', { name: '+ Create org' }));
    await user.type(await screen.findByLabelText(/Org name/), 'Acme Corp');
    await user.click(screen.getByRole('button', { name: 'Create org' }));

    expect(await screen.findByText("Couldn't create the org")).toBeInTheDocument();
    // Dialog stays open on failure — the name field is still there to retry.
    expect(screen.getByLabelText(/Org name/)).toHaveValue('Acme Corp');
  });
});

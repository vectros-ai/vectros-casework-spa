// ---------------------------------------------------------------------------
// ClientDetailPage tests — load/edit/save, archive/reactivate (the `status`
// field, not a delete — see the page's own header comment), and the Members
// section (hr-admin-only `client_membership` list + assign flow).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { ClientDetailPage } from './ClientDetailPage';
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

/** hr-admin-shaped: edit + manage-members both available. */
const FULL_ACCESS_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['entities:u:client', 'records:c:client_membership'],
  identity: { partnerUserId: 'usr_admin' },
  can: (a) => ['entities:u:client', 'records:c:client_membership'].includes(a),
};

/** case-handler-shaped: can edit a client they're a member of, but never
 *  manages OTHER members — matches this role holding zero write reach on
 *  `client_membership` at all (the removed self-escalation grant). */
const MEMBER_ONLY_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['entities:u:client'],
  identity: { partnerUserId: 'usr_handler' },
  can: (a) => a === 'entities:u:client',
};

const SCHEMA = { id: 'schema_client_profile', typeName: 'client_profile', fields: [] };

const CLIENT = {
  id: 'client_1',
  externalId: 'client_ext_1',
  name: 'Jane Doe',
  status: 'ACTIVE',
  scopes: ['org:org_1', 'client:client_1'],
  payload: {},
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
  initialPath = '/clients/client_1',
  queryClient: QueryClient = testQueryClient(),
): QueryClient {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/clients" element={<div>clients list page</div>} />
            <Route path="/clients/:id" element={<ClientDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return queryClient;
}

describe('ClientDetailPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReset();
  });

  it('loads and renders the client name as the page heading, with its schema fields seeded', async () => {
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    expect(await screen.findByRole('heading', { name: 'Jane Doe' })).toBeInTheDocument();
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'client', id: 'client_1', contextId: 'casework' });
  });

  it('does not show a required field as an error on load, until it is touched -- even for an existing record missing it', async () => {
    // Regression guard: useTouchedFieldErrors was wired into the CREATE dialogs (a blank
    // payload) but originally missed on this EDIT page, latent as long as every saved record
    // already satisfied its schema. The moment client_profile gains a new required field an
    // existing record doesn't have (simulated here), this page would show that field red the
    // instant it loads, before the caller touched anything -- the exact same bug the create
    // dialogs already fixed, just triggered by schema evolution instead of a blank form.
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT); // payload: {} -- missing any new required field
    const listSchemas = vi.fn().mockResolvedValue(
      pageOf([
        {
          id: 'schema_client_profile',
          typeName: 'client_profile',
          fields: [{ fieldId: 'department', fieldType: 'string', required: true }],
        },
      ]),
    );
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    await screen.findByLabelText('department', { exact: false }); // rendered label is "department *"
    expect(screen.queryByText('This field is required.')).not.toBeInTheDocument();
  });

  it('shows a breadcrumb linking back to the client\'s own org', async () => {
    // Regression guard: this page already computed `orgId`
    // from the client's own scopes but never displayed or linked it -- a caller who reached a
    // client directly (not via CaseDetailPage's own org->client breadcrumb) had no way to tell or
    // navigate to which org it belonged to.
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
      namespace === 'org'
        ? Promise.resolve({ id: 'org_1', name: 'Acme Inc' })
        : Promise.resolve(CLIENT),
    );
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    const orgLink = screen.getByRole('link', { name: 'Acme Inc' });
    expect(orgLink).toHaveAttribute('href', '/orgs/org_1');
  });

  it('renders a load error for a client the caller cannot reach (uniform not-found)', async () => {
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { statusCode: 404 }));
    renderPage({ identity: { getEntity }, schemas: { listSchemas: vi.fn() } });

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "This client doesn't exist, or you don't have access to it.",
    );
  });

  it('saves an edited name', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockResolvedValue({ ...CLIENT, name: 'Jane R. Doe' });
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity, updateEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    const nameField = await screen.findByLabelText(/Client name/);
    await user.clear(nameField);
    await user.type(nameField, 'Jane R. Doe');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(updateEntity).toHaveBeenCalledWith({
        namespace: 'client',
        id: 'client_1',
        contextId: 'casework',
        body: {
          externalId: 'client_ext_1',
          name: 'Jane R. Doe',
          schemaId: 'schema_client_profile',
          payload: {},
        },
      }),
    );
    expect(await screen.findByText('Saved.')).toBeInTheDocument();
  });

  it('invalidates the list caches (broad org list + founder-discovery), not just the entity cache, on save', async () => {
    // Regression guard (review finding, 2026-08-28): this used to invalidate only
    // `dataQueryKeys.client(id)` — `ClientsListPage`/`CreateCaseDialog`'s existing-client picker
    // would show the OLD name for up to `staleTime` after navigating back. `OrgDetailPage.tsx`'s
    // own save/delete handlers invalidate both the entity AND the founder-list cache; this page's
    // own commit claimed to follow that pattern exactly but didn't, until now.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockResolvedValue({ ...CLIENT, name: 'Jane R. Doe' });
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const queryClient = testQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPage(
      {
        identity: { getEntity, updateEntity },
        schemas: { listSchemas },
        records: { listRecords },
        auth: { listAccessProfiles },
      },
      '/clients/client_1',
      queryClient,
    );

    const nameField = await screen.findByLabelText(/Client name/);
    await user.clear(nameField);
    await user.type(nameField, 'Jane R. Doe');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updateEntity).toHaveBeenCalledTimes(1));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients', 'entity', 'client_1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients', 'byOrg', 'org_1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clients', 'founder', 'usr_admin'] });
  });

  it('archives the client via the platform-native status field, not a delete call', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    // First resolve is the initial load (ACTIVE); every subsequent one (the post-archive
    // refetch this page's own invalidateClientCaches triggers) reflects the real new status --
    // otherwise `isSuspended` would stay stale and the success alert's own isSuspended-keyed
    // message choice couldn't be exercised honestly.
    const getEntity = vi.fn().mockResolvedValueOnce(CLIENT).mockResolvedValue({ ...CLIENT, status: 'SUSPENDED' });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockResolvedValue({ ...CLIENT, status: 'SUSPENDED' });
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const deleteEntity = vi.fn();
    renderPage({
      identity: { getEntity, updateEntity, deleteEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    await user.click(screen.getByRole('button', { name: 'Archive client' }));
    // Regression guard: archive now confirms first, via the shared ConfirmDialog, rather than
    // firing on the first click.
    await user.click(await screen.findByRole('button', { name: 'Yes, archive' }));

    await waitFor(() =>
      expect(updateEntity).toHaveBeenCalledWith({
        namespace: 'client',
        id: 'client_1',
        contextId: 'casework',
        body: { externalId: 'client_ext_1', status: 'SUSPENDED' },
      }),
    );
    expect(deleteEntity).not.toHaveBeenCalled();
    // Regression guard: archive had an error path wired up but no matching success
    // confirmation, unlike this same page's Save action.
    expect(await screen.findByText('Archived.')).toBeInTheDocument();
  });

  it('picks the correct success message from the mutation\'s OWN response, not a stale cached client', async () => {
    // Regression guard: invalidateClientCaches() only invalidates the client query -- it doesn't
    // await a refetch -- so on the render right after archiveMutation.onSuccess fires, `client`
    // (and the `isSuspended` derived from it) can still be the PRE-mutation value. Picking the
    // success message off `isSuspended` would show "Reactivated." right after an archive. Here
    // `getEntity` NEVER resolves the new status (simulating a slow/never-completing refetch), so
    // this only passes if the message comes from archiveMutation's own fresh response instead.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT); // always ACTIVE -- refetch never "arrives"
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockResolvedValue({ ...CLIENT, status: 'SUSPENDED' });
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity, updateEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    await user.click(screen.getByRole('button', { name: 'Archive client' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, archive' }));

    expect(await screen.findByText('Archived.')).toBeInTheDocument();
    expect(screen.queryByText('Reactivated.')).not.toBeInTheDocument();
  });

  it('shows a failed archive\'s error INSIDE the still-open confirm dialog, not occluded behind it', async () => {
    // Regression guard: ConfirmDialog has an error slot specifically so a failure renders
    // inside the still-open modal instead of being occluded behind it -- this page previously
    // never passed one, so a failed archive left the mutation's error alert in the page body,
    // invisible behind the open dialog backdrop, with nothing telling the caller it failed.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockRejectedValue(new Error('scope denied'));
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity, updateEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    await user.click(screen.getByRole('button', { name: 'Archive client' }));
    await user.click(await screen.findByRole('button', { name: 'Yes, archive' }));

    // The dialog's own confirm button is still present (the dialog never closed) AND an alert
    // is now visible -- both at once, proving the error rendered inside the open dialog rather
    // than requiring the caller to close it first to find out anything went wrong.
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't update the client's status");
    expect(screen.getByRole('button', { name: 'Yes, archive' })).toBeInTheDocument();
  });

  it('does not archive when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const updateEntity = vi.fn().mockResolvedValue({ ...CLIENT, status: 'SUSPENDED' });
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity, updateEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    await user.click(screen.getByRole('button', { name: 'Archive client' }));
    await screen.findByRole('button', { name: 'Yes, archive' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // MUI's Dialog exit transition keeps the button in the DOM briefly after Cancel.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Yes, archive' })).not.toBeInTheDocument(),
    );
    expect(updateEntity).not.toHaveBeenCalled();
  });

  it('shows a Reactivate action and the Archived badge for a suspended client', async () => {
    mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
    const getEntity = vi.fn().mockResolvedValue({ ...CLIENT, status: 'SUSPENDED' });
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    const listRecords = vi.fn().mockResolvedValue(pageOf([]));
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { getEntity },
      schemas: { listSchemas },
      records: { listRecords },
      auth: { listAccessProfiles },
    });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate client' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Archive client' })).not.toBeInTheDocument();
  });

  it('hides edit AND the Members section for a caller without entities:u:client / records:c:client_membership', async () => {
    mockedUseScopeGate.mockReturnValue({
      loading: false,
      allowedActions: [],
      identity: { partnerUserId: 'usr_x' },
      can: () => false,
    });
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    renderPage({ identity: { getEntity }, schemas: { listSchemas } });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(screen.queryByText('Members')).not.toBeInTheDocument();
  });

  it('a case-handler-shaped caller (member, not admin) can edit but sees no Members section', async () => {
    mockedUseScopeGate.mockReturnValue(MEMBER_ONLY_GATE);
    const getEntity = vi.fn().mockResolvedValue(CLIENT);
    const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
    renderPage({ identity: { getEntity }, schemas: { listSchemas } });

    await screen.findByRole('heading', { name: 'Jane Doe' });
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByText('Members')).not.toBeInTheDocument();
  });

  describe('Members section (hr-admin only)', () => {
    it('shows the empty state when no one has been granted access yet', async () => {
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi.fn().mockResolvedValue(CLIENT);
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
      renderPage({
        identity: { getEntity },
        schemas: { listSchemas },
        records: { listRecords },
        auth: { listAccessProfiles },
      });

      expect(await screen.findByText('Members')).toBeInTheDocument();
      expect(await screen.findByText("No one's been granted access to this client yet.")).toBeInTheDocument();
      expect(listRecords).toHaveBeenCalledWith({ type: 'client_membership', scope: 'org:org_1' });
    });

    it('lists a member row, filtered to THIS client and resolved to the roster\'s email', async () => {
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi.fn().mockResolvedValue(CLIENT);
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const listRecords = vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 'mem_1',
            scopes: ['org:org_1', 'client:client_1'],
            payload: { targetUserId: 'usr_handler', level: 'member' },
          },
          // A different client under the SAME org — must be filtered out.
          {
            id: 'mem_2',
            scopes: ['org:org_1', 'client:client_OTHER'],
            payload: { targetUserId: 'usr_other', level: 'admin' },
          },
        ]),
      );
      const listAccessProfiles = vi.fn().mockResolvedValue(
        pageOf([{ principalId: 'usr_handler', email: 'handler@acme.test', roleId: 'case-handler' }]),
      );
      renderPage({
        identity: { getEntity },
        schemas: { listSchemas },
        records: { listRecords },
        auth: { listAccessProfiles },
      });

      expect(await screen.findByText('handler@acme.test')).toBeInTheDocument();
      expect(screen.queryByText('usr_other')).not.toBeInTheDocument();
    });

    it('assigns a case handler at the chosen level and refreshes the members list', async () => {
      // Regression guard, tightened after a review finding: the original version of this test
      // asserted `createRecord`'s call shape but never actually verified a "refresh" happened — it
      // would have passed even if `onSuccess`'s invalidation were silently dropped. `listRecords`
      // now returns the NEW member row only after the assign succeeds, so the assertion below can
      // only pass if the invalidation actually re-fires the query and the new row renders.
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi.fn().mockResolvedValue(CLIENT);
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const listRecords = vi
        .fn()
        .mockResolvedValueOnce(pageOf([]))
        .mockResolvedValue(
          pageOf([
            {
              id: 'mem_new',
              scopes: ['org:org_1', 'client:client_1'],
              payload: { targetUserId: 'usr_handler', level: 'admin' },
            },
          ]),
        );
      const listAccessProfiles = vi.fn().mockResolvedValue(
        pageOf([
          { principalId: 'usr_handler', email: 'handler@acme.test', roleId: 'case-handler' },
          { principalId: 'usr_admin2', email: 'admin2@acme.test', roleId: 'hr-admin' },
        ]),
      );
      const createRecord = vi.fn().mockResolvedValue({ id: 'mem_new' });
      renderPage({
        identity: { getEntity },
        schemas: { listSchemas },
        records: { listRecords, createRecord },
        auth: { listAccessProfiles },
      });

      await screen.findByText("No one's been granted access to this client yet.");

      await user.click(await screen.findByRole('button', { name: '+ Assign' }));
      // Only the case-handler is offered — the hr-admin candidate is excluded (see the dialog's
      // own header comment on why granting an hr-admin client_membership is a legitimate no-op).
      await user.click(await screen.findByLabelText(/Case handler/));
      expect(await screen.findByRole('option', { name: 'handler@acme.test' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'admin2@acme.test' })).not.toBeInTheDocument();
      await user.click(screen.getByRole('option', { name: 'handler@acme.test' }));

      await user.click(screen.getByLabelText('Level'));
      await user.click(await screen.findByRole('option', { name: 'Admin' }));

      await user.click(screen.getByRole('button', { name: 'Assign' }));

      await waitFor(() =>
        expect(createRecord).toHaveBeenCalledWith({
          body: {
            typeName: 'client_membership',
            scopes: ['org:org_1', 'client:client_1'],
            userId: 'usr_handler',
            payload: { targetUserId: 'usr_handler', level: 'admin' },
          },
        }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
      });

      // The actual "refresh" claim: the new member row is now visible, which is only possible if
      // the mutation's `onSuccess` invalidation re-triggered `listRecords`.
      expect(await screen.findByText('handler@acme.test')).toBeInTheDocument();
      expect(listRecords).toHaveBeenCalledTimes(2);
    });

    it('excludes a case handler who already has a membership row on this client from the assign picker', async () => {
      // Regression guard (review finding, 2026-08-28): nothing previously stopped an admin from
      // creating a SECOND `client_membership` row for the same person — it would render as two
      // indistinguishable rows in the Members table (keyed on the record's own `id`, not
      // `targetUserId`).
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi.fn().mockResolvedValue(CLIENT);
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const listRecords = vi.fn().mockResolvedValue(
        pageOf([
          {
            id: 'mem_existing',
            scopes: ['org:org_1', 'client:client_1'],
            payload: { targetUserId: 'usr_handler', level: 'member' },
          },
        ]),
      );
      const listAccessProfiles = vi.fn().mockResolvedValue(
        pageOf([
          { principalId: 'usr_handler', email: 'handler@acme.test', roleId: 'case-handler' },
          { principalId: 'usr_handler2', email: 'handler2@acme.test', roleId: 'case-handler' },
        ]),
      );
      renderPage({
        identity: { getEntity },
        schemas: { listSchemas },
        records: { listRecords },
        auth: { listAccessProfiles },
      });

      await screen.findByText('handler@acme.test'); // the existing member row
      await user.click(screen.getByRole('button', { name: '+ Assign' }));
      await user.click(await screen.findByLabelText(/Case handler/));

      expect(await screen.findByRole('option', { name: 'handler2@acme.test' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: 'handler@acme.test' })).not.toBeInTheDocument();
    });

    it('surfaces an assign error and keeps the dialog open', async () => {
      const user = userEvent.setup();
      mockedUseScopeGate.mockReturnValue(FULL_ACCESS_GATE);
      const getEntity = vi.fn().mockResolvedValue(CLIENT);
      const listSchemas = vi.fn().mockResolvedValue(pageOf([SCHEMA]));
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const listAccessProfiles = vi.fn().mockResolvedValue(
        pageOf([{ principalId: 'usr_handler', email: 'handler@acme.test', roleId: 'case-handler' }]),
      );
      const createRecord = vi.fn().mockRejectedValue(new Error('boom'));
      renderPage({
        identity: { getEntity },
        schemas: { listSchemas },
        records: { listRecords, createRecord },
        auth: { listAccessProfiles },
      });

      await user.click(await screen.findByRole('button', { name: '+ Assign' }));
      await user.click(await screen.findByLabelText(/Case handler/));
      await user.click(await screen.findByRole('option', { name: 'handler@acme.test' }));
      await user.click(screen.getByRole('button', { name: 'Assign' }));

      expect(await screen.findByText("Couldn't assign this client")).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });
});

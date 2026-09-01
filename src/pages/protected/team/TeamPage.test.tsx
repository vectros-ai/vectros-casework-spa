// ---------------------------------------------------------------------------
// TeamPage tests — the roster + the two-call invite flow (inviteMember.ts).
//
// useScopeGate and the SDK client are both mocked, same approach as
// OrgsListPage's own suite: this page's logic — which query fires when, how
// the invite payload is assembled, the org-picker's show/hide/required
// behavior, the empty/loading/error states — is what's under test, not the
// real token mint or network layer.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { TeamPage } from './TeamPage';
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

const HR_ADMIN_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['profiles:c', 'profiles:r', 'profiles:d'],
  identity: { partnerUserId: 'usr_admin' },
  can: (a) => a === 'profiles:c' || a === 'profiles:r' || a === 'profiles:d',
};

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
        <MemoryRouter initialEntries={['/team']}>
          <Routes>
            <Route path="/team" element={<TeamPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
  return queryClient;
}

describe('TeamPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReset();
  });

  it('shows the empty state when the roster has no other members', async () => {
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('No one else has been invited yet.')).toBeInTheDocument();
    expect(listAccessProfiles).toHaveBeenCalledWith({ contextId: 'casework' });
  });

  it('lists the roster with principal, role, and status', async () => {
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'p1', principalId: 'usr_alice', roleId: 'case-handler', status: 'active' },
        { id: 'p2', principalId: 'usr_bob', roleId: 'hr-admin', status: 'suspended' },
      ]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('usr_alice')).toBeInTheDocument();
    expect(screen.getByText('Case handler')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('usr_bob')).toBeInTheDocument();
    expect(screen.getByText('HR admin')).toBeInTheDocument();
    expect(screen.getByText('Suspended')).toBeInTheDocument();
  });

  it('drains a second page rather than showing only the first 20 members', async () => {
    // Every other test in this file (and every other call
    // site drainPages was wired into) mocks a single FINAL page via pageOf, so drainPages'
    // actual multi-page loop was never exercised by the suite -- only by live/manual testing
    // (which is exactly how the underlying truncation bug was found in the first place). This
    // pins the real behavior: a caller of listAccessProfiles gets a live nextCursor on page 1,
    // and the roster must include page 2's member too, not just page 1's.
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: 'p1', principalId: 'usr_alice', roleId: 'case-handler', status: 'active' }],
        nextCursor: 'cursor-page-2',
      })
      .mockResolvedValueOnce(
        pageOf([{ id: 'p2', principalId: 'usr_bob', roleId: 'case-handler', status: 'active' }]),
      );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('usr_alice')).toBeInTheDocument();
    expect(await screen.findByText('usr_bob')).toBeInTheDocument();
    expect(listAccessProfiles).toHaveBeenCalledTimes(2);
    expect(listAccessProfiles).toHaveBeenNthCalledWith(2, { contextId: 'casework', startFrom: 'cursor-page-2' });
  });

  it('shows a pending invitee with its own localized label and color, not the raw status string in a "success" chip', async () => {
    // Regression guard: STATUS_LABEL_IDS never mapped
    // `pending` at all, so a freshly-invited teammate's status fell through to the raw
    // unlocalized string, AND the old color logic (`status === 'suspended' ? default : success`)
    // rendered it green -- visually indistinguishable from an actually-active member.
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'p1', principalId: 'usr_alice', roleId: 'case-handler', status: 'active' },
        { id: 'p2', principalId: 'usr_dana', roleId: 'case-handler', status: 'pending' },
      ]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    const pendingChip = (await screen.findByText('Pending')).closest('.MuiChip-root');
    const activeChip = screen.getByText('Active').closest('.MuiChip-root');
    expect(pendingChip).not.toBeNull();
    expect(activeChip).not.toBeNull();
    expect(pendingChip).toHaveClass('MuiChip-colorWarning');
    expect(activeChip).toHaveClass('MuiChip-colorSuccess');
    // Distinct colors, not the pre-fix "both render as success/green" bug.
    expect(pendingChip?.className).not.toBe(activeChip?.className);
  });

  it('labels a multi-role profile (roleIds, no singular roleId) by joining every role name', async () => {
    // This app never authors a roleIds-composed profile itself, but a roster reading someone
    // else's deployment should still render something meaningful rather than a blank role cell.
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([{ id: 'p1', principalId: 'usr_carol', roleIds: ['case-handler', 'hr-admin'], status: 'active' }]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('usr_carol')).toBeInTheDocument();
    expect(screen.getByText('case-handler, hr-admin')).toBeInTheDocument();
  });

  it('filters an inline-scoped profile (the platform SERVICE principal, no roleId/roleIds) out of the roster entirely', async () => {
    // Neither roleId nor roleIds set means the profile is inline-scoped, not role-referencing —
    // this app never authors that shape itself; the one thing that does is the platform's own
    // auto-created SERVICE principal for this context. A roster meant for a human admin to manage
    // their team shouldn't make them read past it.
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'p1', principalId: 'usr_service', scopes: [{ allowedActions: ['records:r:case'] }], status: 'active' },
      ]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('No one else has been invited yet.')).toBeInTheDocument();
    expect(screen.queryByText('usr_service')).not.toBeInTheDocument();
  });

  it("shows a member's resolved email (with the principalId as a secondary reference) when the platform resolved one", async () => {
    // hr-admin now holds users:r (this pass's own blueprint change) so a usr_ principal's email
    // resolves onto AccessProfileResponse — see the blueprint's own comment on that grant.
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'p1', principalId: 'usr_alice', roleId: 'case-handler', status: 'active', email: 'alice@acme.test' },
      ]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('alice@acme.test')).toBeInTheDocument();
    expect(screen.getByText('usr_alice')).toBeInTheDocument();
  });

  it('falls back to the raw principalId when no email resolved (e.g. a key_ principal, or an unresolved usr_ one)', async () => {
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([{ id: 'p1', principalId: 'key_abc123', roleId: 'case-handler', status: 'active' }]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByText('key_abc123')).toBeInTheDocument();
  });

  it('refetches the roster when the refresh button is clicked', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(
      pageOf([{ id: 'p1', principalId: 'usr_alice', roleId: 'case-handler', status: 'active' }]),
    );
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    await screen.findByText('usr_alice');
    expect(listAccessProfiles).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(listAccessProfiles).toHaveBeenCalledTimes(2));
  });

  it('surfaces a load error for the roster', async () => {
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockRejectedValue(new Error('network down'));
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load the team");
  });

  it('disables Invite for a caller without profiles:c', async () => {
    mockedUseScopeGate.mockReturnValue({
      loading: false,
      allowedActions: [],
      identity: { partnerUserId: 'usr_handler' },
      can: () => false,
    });
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ auth: { listAccessProfiles }, identity: {}, records: {} });

    await screen.findByText('No one else has been invited yet.');
    expect(screen.getByRole('button', { name: 'Invite' })).toBeDisabled();
  });

  it('single-org caller: org shown read-only (not an editable picker), invite sends the auto-selected org', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Corp' }]));
    const createInvite = vi.fn().mockResolvedValue({ userId: 'usr_new', emailSent: true });
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_1' });
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      auth: { listAccessProfiles, createInvite },
      identity: { listEntities },
      records: { createRecord, lookupRecords },
    });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    const emailField = await screen.findByLabelText(/Email/);
    await user.type(emailField, 'newbie@example.com');
    // Owner feedback 2026-08-26: a single org must still be VISIBLE (not an
    // editable picker — there's no real choice — but not silently hidden
    // either). Disabled, not absent.
    const orgField = screen.getByLabelText(/Org/);
    expect(orgField).toBeDisabled();
    expect(orgField).toHaveValue('Acme Corp');

    // Regression check for the live-verified 403: the org query MUST pass an explicit
    // userId — a bare, unscoped call 403s server-side (the platform's list-endpoint
    // authorization requires an explicit userId/scope match).
    expect(listEntities).toHaveBeenCalledWith({
      namespace: 'org',
      contextId: 'casework',
      userId: 'usr_admin',
    });

    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
    expect(createInvite).toHaveBeenCalledWith({
      email: 'newbie@example.com',
      contextId: 'casework',
      accessProfile: { roleId: 'case-handler' },
      acceptUrl: `${window.location.origin}/accept`,
    });
    await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
    expect(createRecord).toHaveBeenCalledWith({
      body: {
        typeName: 'org_membership',
        scopes: ['org:org_1'],
        userId: 'usr_new',
        payload: { targetUserId: 'usr_new', level: 'member' },
      },
    });

    // Dialog closes and the success banner shows on completion.
    await waitFor(() => {
      expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
    });
    expect(await screen.findByText('Invite sent.')).toBeInTheDocument();
  });

  it('InviteDialog surfaces a load error for the org query', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockRejectedValue(new Error('network down'));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ auth: { listAccessProfiles }, identity: { listEntities }, records: { lookupRecords } });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText("Couldn't load your orgs")).toBeInTheDocument();
  });

  it('InviteDialog shows the no-orgs state when the caller founded none', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ auth: { listAccessProfiles }, identity: { listEntities }, records: { lookupRecords } });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText(/found one first/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Email/)).not.toBeInTheDocument();
  });

  it('an invited-not-founding hr-admin sees their org via org_membership discovery, not just founder discovery', async () => {
    // The actual bug this fixes: the org picker used to query `orgsFounded()` alone, so an
    // hr-admin who was INVITED into an org (never founded one) had no org to pick from at all —
    // `useAccessibleOrgs` unions in orgs discovered via the caller's own `org_membership` rows.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    // Founder discovery returns nothing — this hr-admin founded no org.
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    // But holds a membership row scoped to an org someone else founded.
    const lookupRecords = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'mem_1', scopes: ['org:org_9'], payload: { targetUserId: 'usr_admin', level: 'member' } }]));
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_9', name: 'Globex Membership Org' });
    renderPage({
      auth: { listAccessProfiles },
      identity: { listEntities, getEntity },
      records: { lookupRecords },
    });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    // Single accessible org (via membership alone) — shown read-only, same as a single founded org.
    const orgField = await screen.findByLabelText(/Org/);
    expect(orgField).toHaveValue('Globex Membership Org');
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_9', contextId: 'casework' });
  });

  it('surfaces an invite error and keeps the dialog open on failure', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Corp' }]));
    const createInvite = vi.fn().mockRejectedValue(new Error('boom'));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      auth: { listAccessProfiles, createInvite },
      identity: { listEntities },
      records: { lookupRecords },
    });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    const emailField = await screen.findByLabelText(/Email/);
    await user.type(emailField, 'newbie@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    expect(await screen.findByText("Couldn't send the invite")).toBeInTheDocument();
    // Dialog stays open on failure — the typed email is still there to retry.
    expect(emailField).toHaveValue('newbie@example.com');
  });

  it('a step-2 (org-membership grant) failure shows a distinct message and still invalidates the roster', async () => {
    // inviteMember.ts's own header doc says a step-2 failure is
    // "recoverable, not... the whole invite failed" — createInvite (step 1) SUCCEEDS here, only the
    // org_membership createRecord (step 2) fails, and the UI must say something different from a
    // step-1 failure (which the test above covers) plus invalidate the roster, since a PENDING
    // profile now genuinely exists.
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Corp' }]));
    const createInvite = vi.fn().mockResolvedValue({ userId: 'usr_new', emailSent: true });
    const createRecord = vi.fn().mockRejectedValue(new Error('membership write boom'));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const queryClient = testQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPage(
      {
        auth: { listAccessProfiles, createInvite },
        identity: { listEntities },
        records: { createRecord, lookupRecords },
      },
      queryClient,
    );

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));
    const emailField = await screen.findByLabelText(/Email/);
    await user.type(emailField, 'newbie@example.com');
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Invite sent, but granting org access failed/),
    ).toBeInTheDocument();
    // NOT the step-1 generic message — the whole point of the distinction.
    expect(screen.queryByText("Couldn't send the invite")).not.toBeInTheDocument();
    // The dialog stays open (same as a step-1 failure) — but the roster IS invalidated, since the
    // invite itself went out and a PENDING profile now exists.
    expect(emailField).toHaveValue('newbie@example.com');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['team', 'roster'] });
  });

  it('multi-org caller: org picker appears and is required to submit', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'org_1', name: 'Acme Corp' },
        { id: 'org_2', name: 'Beta LLC' },
      ]),
    );
    const createInvite = vi.fn().mockResolvedValue({ userId: 'usr_new', emailSent: true });
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_1' });
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      auth: { listAccessProfiles, createInvite },
      identity: { listEntities },
      records: { createRecord, lookupRecords },
    });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    const emailField = await screen.findByLabelText(/Email/);
    await user.type(emailField, 'newbie@example.com');

    const orgField = await screen.findByLabelText(/Org/);
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeDisabled();

    await user.click(orgField);
    await user.click(await screen.findByRole('option', { name: 'Beta LLC' }));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
    expect(createRecord).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.objectContaining({ scopes: ['org:org_2'] }) }),
    );
  });

  it('inviting hr-admin sends that roleId, selected via the role picker', async () => {
    const user = userEvent.setup();
    mockedUseScopeGate.mockReturnValue(HR_ADMIN_GATE);
    const listAccessProfiles = vi.fn().mockResolvedValue(pageOf([]));
    const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Corp' }]));
    const createInvite = vi.fn().mockResolvedValue({ userId: 'usr_new', emailSent: true });
    const createRecord = vi.fn().mockResolvedValue({ id: 'rec_1' });
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      auth: { listAccessProfiles, createInvite },
      identity: { listEntities },
      records: { createRecord, lookupRecords },
    });

    await screen.findByText('No one else has been invited yet.');
    await user.click(screen.getByRole('button', { name: 'Invite' }));

    await user.type(await screen.findByLabelText(/Email/), 'admin2@example.com');
    await user.click(screen.getByLabelText('Role'));
    await user.click(await screen.findByRole('option', { name: 'HR admin' }));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(createInvite).toHaveBeenCalledTimes(1));
    expect(createInvite).toHaveBeenCalledWith(
      expect.objectContaining({ accessProfile: { roleId: 'hr-admin' } }),
    );
  });
});

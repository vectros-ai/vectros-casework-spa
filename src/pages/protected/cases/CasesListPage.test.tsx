// ---------------------------------------------------------------------------
// CasesListPage tests — status filter, empty/error states, the org column,
// org-discovery failure surfacing, and the per-org fan-out's pagination and
// partial-failure handling.
//
// The "all" filter fans `listRecords` out over the caller's OWN orgs
// (`useAccessibleOrgs` — the same founder+membership discovery
// `CreateCaseDialog`'s org picker already uses below), one
// `{ type: 'case', scope: 'org:<id>' }` call per org, fully paged. This
// satisfies both roles' gates and lets the platform's own row-level
// ownership filter narrow the rest automatically. A real status filter is
// unaffected — it always used `lookupRecords`, which never had this upfront
// gate at all. See CasesListPage.tsx's own header comment for the fuller
// rationale. Every top-level test below now needs `identity.listEntities`
// (founder discovery) mocked too, since the case-list query itself depends
// on `useAccessibleOrgs`, not just the "+ New case" org picker.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CasesListPage } from './CasesListPage';
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

/** No `records:c:case` — matches every pre-existing test's assumption (no
 *  "+ New case" button rendered). Create-flow tests below override this. */
const NO_CREATE_GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['records:r:case'],
  identity: { partnerUserId: 'usr_alice' },
  can: () => false,
};

/** One founded org — the common case, and what CASE_1/CASE_2's `org:org_1`
 *  scope below assumes. Only needed by the "+ New case" tests below, whose
 *  CreateCaseDialog org picker still uses founder-only discovery. */
function founderOfOneOrg(): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }]));
}

/** Mocks the case-list's own per-org `listRecords` fan-out: filters a case fixture list by the
 *  `scope` query param (`org:<id>`), mirroring what the real per-org call + the platform's
 *  row-level `filterByDataScope` narrowing would return. */
function listRecordsByOrg(cases: ReadonlyArray<{ scopes?: string[] }>): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockImplementation(({ scope }: { type: string; scope?: string }) =>
      Promise.resolve(pageOf(cases.filter((c) => (c.scopes ?? []).includes(scope ?? '')))),
    );
}

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
        <MemoryRouter initialEntries={['/cases']}>
          <Routes>
            <Route path="/cases" element={<CasesListPage />} />
            <Route path="/cases/:id" element={<div>case detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
}

const CASE_1 = {
  id: 'case_1',
  payload: { caseType: 'grievance', status: 'open', openedAt: '2026-08-01' },
  scopes: ['org:org_1', 'client:client_1'],
};
const CASE_2 = {
  id: 'case_2',
  payload: { caseType: 'onboarding', status: 'closed', openedAt: '2026-08-05' },
  scopes: ['org:org_1', 'client:client_2'],
};

describe('CasesListPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReturnValue(NO_CREATE_GATE);
  });

  it('shows the true-empty state (no filter applied)', async () => {
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    expect(await screen.findByText('You have no cases yet.')).toBeInTheDocument();
    expect(listRecords).toHaveBeenCalledWith({ type: 'case', scope: 'org:org_1' });
  });

  it('a case-handler (never an org founder) sees cases via org_membership discovery', async () => {
    // The actual bug this pass fixes: case-handler holds no `entities:r:org` founder-discovery
    // grant at all, so a founder-only org query would find zero orgs to fan out over. The org
    // fan-out uses `useAccessibleOrgs`, which unions in orgs discovered via the caller's own
    // `org_membership` rows — this pins that case-handler still sees cases through THAT path.
    const listEntities = vi.fn().mockResolvedValue(pageOf([])); // never a founder
    const lookupRecords = vi.fn().mockResolvedValue(
      pageOf([{ id: 'mem_1', scopes: ['org:org_1'], payload: { targetUserId: 'usr_alice', level: 'member' } }]),
    );
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_1', name: 'Membership Org' });
    const listRecords = listRecordsByOrg([CASE_1]);
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities, getEntity } });

    expect(await screen.findByRole('link', { name: 'Grievance' })).toBeInTheDocument();
  });

  it('refetches the case list when the refresh button is clicked', async () => {
    // Regression guard for item 1 of the rough-edges list: a status change made on
    // CaseDetailPage wasn't reflected back here because nothing ever invalidated this
    // page's own query keys. This pins the fix's OTHER half — the manual refresh
    // affordance itself actually re-pulls the case list.
    const user = userEvent.setup();
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([CASE_1]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    await screen.findByRole('link', { name: 'Grievance' });
    expect(listRecords).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    await waitFor(() => expect(listRecords).toHaveBeenCalledTimes(2));
  });

  it('lists cases with type, status, and opened date, linking to detail', async () => {
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([CASE_1, CASE_2]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    expect(await screen.findByRole('link', { name: 'Grievance' })).toHaveAttribute(
      'href',
      '/cases/case_1',
    );
    expect(screen.getByRole('link', { name: 'Onboarding' })).toHaveAttribute('href', '/cases/case_2');
    expect(screen.getByText('open')).toBeInTheDocument();
    expect(screen.getByText('closed')).toBeInTheDocument();
    expect(screen.getByText('2026-08-01')).toBeInTheDocument();
  });

  it('does not show an org column when every case shares one org', async () => {
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([CASE_1, CASE_2]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    const getEntity = vi.fn();
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities, getEntity } });

    await screen.findByRole('link', { name: 'Grievance' });
    expect(screen.queryByText('Org')).not.toBeInTheDocument();
    expect(getEntity).not.toHaveBeenCalled();
  });

  it('shows a resolved org-name column when cases span more than one org, reusing accessibleOrgs -- no redundant getEntity fetch', async () => {
    const multiOrgCase = { ...CASE_2, scopes: ['org:org_2', 'client:client_2'] };
    const listEntities = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }, { id: 'org_2', name: 'Beta LLC Inc' }]));
    const listRecords = listRecordsByOrg([CASE_1, multiOrgCase]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    const getEntity = vi.fn();
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities, getEntity } });

    await screen.findByRole('link', { name: 'Grievance' });
    // Both orgs' names come from `accessibleOrgs.orgs` (the `listEntities` mock above) -- not a
    // separate `getEntity` fetch, since both orgs are already known from founder discovery.
    expect(await screen.findByText('Acme Inc')).toBeInTheDocument();
    expect(await screen.findByText('Beta LLC Inc')).toBeInTheDocument();
    expect(getEntity).not.toHaveBeenCalled();
  });

  it('falls back to getEntity for an org column name NOT in accessibleOrgs.orgs (a case reached via a different clause)', async () => {
    // A real status filter's `lookupRecords` results aren't bounded to the caller's own
    // founder/membership org set the way the "all" fan-out is -- a case-handler can reach a case
    // through a client-scoped clause for an org they never founded or joined. accessibleOrgs.orgs
    // won't carry that org's name, so the fallback getEntity fetch is still real, needed behavior.
    const user = userEvent.setup();
    const localCase1 = { ...CASE_1, scopes: ['org:org_1', 'client:client_1'] };
    const outsideOrgCase = { ...CASE_2, scopes: ['org:org_9', 'client:client_2'] };
    const listEntities = founderOfOneOrg(); // only org_1
    const listRecords = listRecordsByOrg([localCase1]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([localCase1, outsideOrgCase]));
    const getEntity = vi.fn().mockResolvedValue({ id: 'org_9', name: 'Outside Org' });
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities, getEntity } });

    await screen.findByRole('link', { name: 'Grievance' });
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByText('Outside Org')).toBeInTheDocument();
    expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_9', contextId: 'casework' });
    // org_1 is already known from accessibleOrgs.orgs -- only the unknown org_9 gets fetched.
    expect(getEntity).toHaveBeenCalledTimes(1);
  });

  it('re-queries with the composite lookup when a status filter is applied', async () => {
    const user = userEvent.setup();
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([CASE_1, CASE_2]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([CASE_1]));
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    await screen.findByRole('link', { name: 'Grievance' });
    await user.click(screen.getByRole('button', { name: 'Open' }));

    await waitFor(() =>
      expect(lookupRecords).toHaveBeenCalledWith({
        type: 'case',
        field: 'status,assignedTo',
        values: ['open'],
      }),
    );
  });

  it('follows nextCursor to fetch every page of a single-status filter, not just the \'all\' fan-out', async () => {
    // The sibling "follows nextCursor..." test above only
    // covers the 'all' branch's fetchAllCasesForOrg -- every OTHER test in this file mocks
    // lookupRecords with a single FINAL page via pageOf, so the single-status branch's own
    // drainPages call (added this same pass) was never exercised by anything but live testing.
    // Distinct case types from CASE_1/CASE_2 (Grievance/Onboarding), so a match here can only
    // come from THIS filtered result, not a stale render of the initial 'all' fan-out.
    const user = userEvent.setup();
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([CASE_1, CASE_2]);
    const accommodationCase = {
      id: 'case_3',
      payload: { caseType: 'accommodation', status: 'open', openedAt: '2026-08-02' },
      scopes: ['org:org_1'],
    };
    const investigationCase = {
      id: 'case_4',
      payload: { caseType: 'investigation', status: 'open', openedAt: '2026-08-03' },
      scopes: ['org:org_1'],
    };
    // lookupRecords is shared with useAccessibleOrgs's own org_membership discovery call (fires
    // unconditionally on mount) -- a plain mockResolvedValueOnce sequence would hand that call
    // one of the status-filter's own pages by accident. Branch on `type` instead.
    let statusFilterCallCount = 0;
    const lookupRecords = vi.fn().mockImplementation((req: { type: string }) => {
      if (req.type !== 'case') return Promise.resolve(pageOf([]));
      statusFilterCallCount += 1;
      return statusFilterCallCount === 1
        ? Promise.resolve({ data: [accommodationCase], nextCursor: 'cursor_status_2' })
        : Promise.resolve({ data: [investigationCase], nextCursor: null });
    });
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    await screen.findByRole('link', { name: 'Grievance' });
    await user.click(screen.getByRole('button', { name: 'Open' }));

    expect(await screen.findByRole('link', { name: 'Accommodation' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Investigation' })).toBeInTheDocument();
    expect(lookupRecords).toHaveBeenCalledWith({ type: 'case', field: 'status,assignedTo', values: ['open'] });
    expect(lookupRecords).toHaveBeenCalledWith({
      type: 'case',
      field: 'status,assignedTo',
      values: ['open'],
      startFrom: 'cursor_status_2',
    });
  });

  it('distinguishes true-empty from filtered-empty', async () => {
    const user = userEvent.setup();
    const listEntities = founderOfOneOrg();
    const listRecords = listRecordsByOrg([CASE_1]);
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    await screen.findByRole('link', { name: 'Grievance' });
    await user.click(screen.getByRole('button', { name: 'Closed' }));

    expect(await screen.findByText('No cases match this filter.')).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    const listEntities = founderOfOneOrg();
    const listRecords = vi.fn().mockRejectedValue(new Error('network down'));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load cases");
  });

  it('surfaces an error (not a permanent spinner) when org discovery itself fails', async () => {
    // Regression guard: casesQuery is only ever ENABLED once accessibleOrgs.isSuccess (the "all"
    // branch needs the caller's own org ids first) -- if org discovery fails, casesQuery never
    // runs at all, so its own isPending/isError stay at their "never enabled" defaults. Without
    // explicitly checking accessibleOrgs.isError, the page would spin forever with no error shown.
    const listEntities = vi.fn().mockRejectedValue(new Error('org discovery down'));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    const listRecords = vi.fn();
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load cases");
    expect(listRecords).not.toHaveBeenCalled();
  });

  it('follows nextCursor to fetch every page of a single org\'s cases', async () => {
    // Regression guard: listRecords defaults to a 20-record page; a single un-paged call per org
    // would silently drop any org's cases past its first page.
    const listEntities = founderOfOneOrg();
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    const listRecords = vi
      .fn()
      .mockResolvedValueOnce({ data: [CASE_1], nextCursor: 'cursor_2' })
      .mockResolvedValueOnce({ data: [CASE_2], nextCursor: null });
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    await screen.findByRole('link', { name: 'Grievance' });
    expect(screen.getByRole('link', { name: 'Onboarding' })).toBeInTheDocument();
    expect(listRecords).toHaveBeenNthCalledWith(1, { type: 'case', scope: 'org:org_1' });
    expect(listRecords).toHaveBeenNthCalledWith(2, { type: 'case', scope: 'org:org_1', startFrom: 'cursor_2' });
  });

  it('shows cases from orgs that succeeded plus a warning, when one org among several fails', async () => {
    // Regression guard: Promise.all made the ENTIRE "all" view blank on any single org's transient
    // error, even though the other orgs' calls succeeded. Promise.allSettled must still surface
    // the successful orgs' cases, with a non-blocking warning naming the failure.
    const orgCase2 = { ...CASE_2, scopes: ['org:org_2', 'client:client_2'] };
    const listEntities = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }, { id: 'org_2', name: 'Beta LLC Inc' }]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    const listRecords = vi.fn().mockImplementation(({ scope }: { scope: string }) =>
      scope === 'org:org_1'
        ? Promise.reject(new Error('org_1 down'))
        : Promise.resolve(pageOf([orgCase2])),
    );
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    expect(await screen.findByRole('link', { name: 'Onboarding' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Grievance' })).not.toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't load cases for one org");
  });

  it('sorts the merged "all" fan-out by openedAt, not by which org happened to resolve first', async () => {
    // Regression guard: the fan-out's per-org results are concatenated in `myOrgIds` order, not
    // openedAt order -- without an explicit sort, a later-opened case from the FIRST-queried org
    // would render before an earlier-opened case from a later org, purely as an artifact of fetch
    // order rather than anything meaningful to a reader.
    const laterOrg1Case = { ...CASE_1, payload: { ...CASE_1.payload, openedAt: '2026-08-10' } };
    const earlierOrg2Case = {
      id: 'case_3',
      payload: { caseType: 'onboarding', status: 'open', openedAt: '2026-08-02' },
      scopes: ['org:org_2', 'client:client_3'],
    };
    const listEntities = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }, { id: 'org_2', name: 'Beta LLC Inc' }]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    // Fan-out queries org_1 before org_2 (myOrgIds order), so the later-opened org_1 case would
    // land first in the merged array if nothing re-sorted it.
    const listRecords = listRecordsByOrg([laterOrg1Case, earlierOrg2Case]);
    renderPage({ records: { listRecords, lookupRecords }, identity: { listEntities } });

    await screen.findByRole('link', { name: 'Grievance' });
    const table = screen.getByRole('table', { name: 'Cases' });
    const dataRows = within(table).getAllByRole('row').slice(1); // drop the header row
    expect(dataRows[0]).toHaveTextContent('2026-08-02');
    expect(dataRows[1]).toHaveTextContent('2026-08-10');
  });

  it('keys the cache by the accessible-org set, so a stale single-org cache entry is never served for a grown org set', async () => {
    // Regression guard: before this fix, the query key was just `['cases', 'all']` -- constant
    // across the caller's own org set growing, so a cache entry seeded under the OLD (smaller) org
    // set would be served forever, never noticing a new membership grant landed. Seed the cache
    // directly at the exact key the OLD code would have used (pre-fix, org-set-independent) and
    // confirm this render -- with a caller who now reaches TWO orgs -- does not settle for it.
    const qc = testQueryClient();
    qc.setQueryData(['cases', 'all'], { data: [CASE_1], failedOrgCount: 0 });

    const orgCase2 = { ...CASE_2, scopes: ['org:org_2', 'client:client_2'] };
    const listEntities = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }, { id: 'org_2', name: 'Beta LLC Inc' }]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
    const listRecords = listRecordsByOrg([CASE_1, orgCase2]);
    mockedClient.mockReturnValue({ records: { listRecords, lookupRecords }, identity: { listEntities } } as never);
    render(
      <IntlProvider>
        <QueryClientProvider client={qc}>
          <MemoryRouter initialEntries={['/cases']}>
            <Routes>
              <Route path="/cases" element={<CasesListPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </IntlProvider>,
    );

    // If the query key didn't include the org set, this render's query would exactly match the
    // pre-seeded `['cases', 'all']` entry above and never call listRecords at all -- it would just
    // show the stale single-org result (only 'Grievance', no 'Onboarding') forever.
    expect(await screen.findByRole('link', { name: 'Onboarding' })).toBeInTheDocument();
    expect(listRecords).toHaveBeenCalled();
  });

  describe('"+ New case"', () => {
    const CREATE_GATE: ScopeGateValue = {
      loading: false,
      allowedActions: ['records:c:case'],
      identity: { partnerUserId: 'usr_alice' },
      can: (a) => a === 'records:c:case',
    };

    it('is disabled (not hidden) without records:c:case, matching every other list page\'s create-button pattern', async () => {
      // Was hidden entirely; changed to disabled + tooltip to match Orgs/Clients/Team, which
      // all already used the more informative pattern -- explaining WHY, not just omitting
      // the affordance.
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
      const listEntities = founderOfOneOrg();
      renderPage({
        records: { listRecords, lookupRecords },
        identity: { getEntity: vi.fn(), listEntities },
      });

      await screen.findByText('You have no cases yet.');
      expect(screen.getByRole('button', { name: '+ New case' })).toBeDisabled();
    });

    it('shows the org read-only (not an editable picker) for a single-founded-org caller, and creates the client + case + folder in one flow', async () => {
      mockedUseScopeGate.mockReturnValue(CREATE_GATE);
      const user = userEvent.setup();
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
      const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }]));
      const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
      const createRecord = vi
        .fn()
        .mockResolvedValue({ id: 'case_new', scopes: ['org:org_1', 'client:client_new'] });
      const createFolder = vi.fn().mockResolvedValue({ id: 'folder_1', name: 'Grievance' });
      renderPage({
        records: { listRecords, lookupRecords, createRecord },
        identity: { getEntity: vi.fn(), listEntities, createEntity },
        folders: { createFolder },
      });

      await screen.findByText('You have no cases yet.');
      await user.click(screen.getByRole('button', { name: '+ New case' }));

      await screen.findByRole('heading', { name: 'New case' });
      // Owner feedback 2026-08-26: a single org must still be VISIBLE (not an
      // editable picker — there's no real choice — but not silently hidden).
      const orgField = screen.getByLabelText('Org');
      expect(orgField).toBeDisabled();
      expect(orgField).toHaveValue('Acme Inc');
      // "New client" is the default mode — no extra click needed to reach it.
      await user.type(screen.getByLabelText('Client name', { exact: false }), 'Jane Doe');
      await user.click(screen.getByLabelText('Case type'));
      await user.click(await screen.findByRole('option', { name: 'Grievance' }));
      await user.click(screen.getByRole('button', { name: 'Create case' }));

      await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
      expect(createEntity).toHaveBeenCalledWith({
        namespace: 'client',
        contextId: 'casework',
        body: expect.objectContaining({ name: 'Jane Doe', scopes: ['org:org_1'] }),
      });
      expect(createRecord).toHaveBeenCalledWith({
        body: expect.objectContaining({
          typeName: 'case',
          scopes: ['org:org_1', 'client:client_new'],
          payload: expect.objectContaining({ caseType: 'grievance', status: 'open' }),
        }),
      });
      expect(createFolder).toHaveBeenCalledWith({
        body: expect.objectContaining({
          name: 'Grievance',
          scopes: ['org:org_1', 'client:client_new'],
        }),
      });
      // Navigates to the new case on success.
      expect(await screen.findByText('case detail page')).toBeInTheDocument();
    });

    it('disables every form field while the create mutation is in flight', async () => {
      // Regression guard: the org/client/case-type/folder-name fields were previously still
      // editable while a create was pending — changing the org selector mid-submit would fire
      // the mutation's onSuccess with the NEW org id, invalidating the wrong org's client-list
      // cache (the actual write was unaffected, only cache freshness drifted).
      mockedUseScopeGate.mockReturnValue(CREATE_GATE);
      const user = userEvent.setup();
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
      const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }]));
      const createEntity = vi.fn().mockResolvedValue({ id: 'client_new', name: 'Jane Doe' });
      let resolveCreate!: (value: { id: string; scopes: string[] }) => void;
      const createRecord = vi.fn(
        () =>
          new Promise((resolve) => {
            resolveCreate = resolve;
          }),
      );
      const createFolder = vi.fn().mockResolvedValue({ id: 'folder_1', name: 'Grievance' });
      renderPage({
        records: { listRecords, lookupRecords, createRecord },
        identity: { getEntity: vi.fn(), listEntities, createEntity },
        folders: { createFolder },
      });

      await screen.findByText('You have no cases yet.');
      await user.click(screen.getByRole('button', { name: '+ New case' }));

      await screen.findByRole('heading', { name: 'New case' });
      await user.type(screen.getByLabelText('Client name', { exact: false }), 'Jane Doe');
      await user.click(screen.getByLabelText('Case type'));
      await user.click(await screen.findByRole('option', { name: 'Grievance' }));
      await user.click(screen.getByRole('button', { name: 'Create case' }));

      await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
      expect(screen.getByLabelText('Client name', { exact: false })).toBeDisabled();
      expect(screen.getByLabelText('Case type')).toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByLabelText('Folder name', { exact: false })).toBeDisabled();

      resolveCreate({ id: 'case_new', scopes: ['org:org_1', 'client:client_new'] });
    });

    it('switches to the existing-client picker and creates the case for the selected client (no new entity)', async () => {
      mockedUseScopeGate.mockReturnValue(CREATE_GATE);
      const user = userEvent.setup();
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
      const listEntities = vi.fn().mockImplementation(({ namespace }: { namespace: string }) =>
        namespace === 'org'
          ? Promise.resolve(pageOf([{ id: 'org_1', name: 'Acme Inc' }]))
          : Promise.resolve(pageOf([{ id: 'client_9', name: 'Returning Employee' }])),
      );
      const createEntity = vi.fn();
      // The "existing client" path resolves the SELECTED client by id (no list/create) —
      // see createCase.ts's `input.clientId` branch.
      const getEntity = vi.fn().mockResolvedValue({ id: 'client_9', name: 'Returning Employee' });
      const createRecord = vi
        .fn()
        .mockResolvedValue({ id: 'case_new', scopes: ['org:org_1', 'client:client_9'] });
      const createFolder = vi.fn().mockResolvedValue({ id: 'folder_1', name: 'Onboarding' });
      renderPage({
        records: { listRecords, lookupRecords, createRecord },
        identity: { getEntity, listEntities, createEntity },
        folders: { createFolder },
      });

      await screen.findByText('You have no cases yet.');
      await user.click(screen.getByRole('button', { name: '+ New case' }));
      await screen.findByRole('heading', { name: 'New case' });

      await user.click(screen.getByRole('button', { name: 'Existing client' }));
      await user.click(await screen.findByLabelText('Client'));
      await user.click(await screen.findByRole('option', { name: 'Returning Employee' }));
      await user.click(screen.getByLabelText('Case type'));
      await user.click(await screen.findByRole('option', { name: 'Onboarding' }));
      await user.click(screen.getByRole('button', { name: 'Create case' }));

      await waitFor(() => expect(createRecord).toHaveBeenCalledTimes(1));
      expect(createEntity).not.toHaveBeenCalled();
      expect(createRecord).toHaveBeenCalledWith({
        body: expect.objectContaining({
          typeName: 'case',
          scopes: ['org:org_1', 'client:client_9'],
        }),
      });
      expect(createFolder).toHaveBeenCalledWith({
        body: expect.objectContaining({ scopes: ['org:org_1', 'client:client_9'] }),
      });
    });

    it('a case-handler with no founded org still sees the org picker via org_membership discovery', async () => {
      // The actual bug this fixes: the org picker used to query `orgsFounded()` alone, which
      // never matches a case-handler (never a founder, only ever a member) — `useAccessibleOrgs`
      // unions in orgs discovered via the caller's own `org_membership` rows, the same discovery
      // grant CasesListPage's own case-list query already depends on for reads. `listRecords`
      // (the page's own "all" case-list load) and `lookupRecords` (useAccessibleOrgs's own-rows
      // membership lookup, now keyed by `values`, see that hook's own test) are separate mocks —
      // this test only cares that both resolve so the org picker renders.
      mockedUseScopeGate.mockReturnValue(CREATE_GATE);
      const user = userEvent.setup();
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi
        .fn()
        .mockImplementation(({ type }: { type: string }) =>
          type === 'org_membership'
            ? Promise.resolve(
                pageOf([{ id: 'mem_1', scopes: ['org:org_7'], payload: { targetUserId: 'usr_alice', level: 'member' } }]),
              )
            : Promise.resolve(pageOf([])),
        );
      const listEntities = vi.fn().mockResolvedValue(pageOf([])); // founded none
      const getEntity = vi.fn().mockResolvedValue({ id: 'org_7', name: 'Membership Org' });
      renderPage({
        records: { listRecords, lookupRecords },
        identity: { getEntity, listEntities },
      });

      await screen.findByText('You have no cases yet.');
      await user.click(screen.getByRole('button', { name: '+ New case' }));

      const orgField = await screen.findByLabelText('Org');
      expect(orgField).toBeDisabled();
      expect(orgField).toHaveValue('Membership Org');
      expect(getEntity).toHaveBeenCalledWith({ namespace: 'org', id: 'org_7', contextId: 'casework' });
    });

    it('shows an org picker (required) when the caller founded more than one org', async () => {
      mockedUseScopeGate.mockReturnValue(CREATE_GATE);
      const user = userEvent.setup();
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
      const listEntities = vi
        .fn()
        .mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme' }, { id: 'org_2', name: 'Globex' }]));
      renderPage({
        records: { listRecords, lookupRecords },
        identity: { getEntity: vi.fn(), listEntities },
      });

      await screen.findByText('You have no cases yet.');
      await user.click(screen.getByRole('button', { name: '+ New case' }));

      await screen.findByLabelText('Org');
      // Neither disabled nor pre-selected — a real choice, not a default.
      expect(screen.getByRole('button', { name: 'Create case' })).toBeDisabled();
    });

    it('surfaces a create error without closing the dialog', async () => {
      mockedUseScopeGate.mockReturnValue(CREATE_GATE);
      const user = userEvent.setup();
      const listRecords = vi.fn().mockResolvedValue(pageOf([]));
      const lookupRecords = vi.fn().mockResolvedValue(pageOf([])); // useAccessibleOrgs's org_membership discovery
      const listEntities = vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme' }]));
      const createEntity = vi.fn().mockResolvedValue({ id: 'client_new' });
      const createRecord = vi.fn().mockRejectedValue(new Error('boom'));
      renderPage({
        records: { listRecords, lookupRecords, createRecord },
        identity: { getEntity: vi.fn(), listEntities, createEntity },
      });

      await screen.findByText('You have no cases yet.');
      await user.click(screen.getByRole('button', { name: '+ New case' }));
      await user.type(screen.getByLabelText('Client name', { exact: false }), 'Jane Doe');
      await user.click(screen.getByLabelText('Case type'));
      await user.click(await screen.findByRole('option', { name: 'Onboarding' }));
      await user.click(screen.getByRole('button', { name: 'Create case' }));

      expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't create the case");
      expect(screen.getByRole('heading', { name: 'New case' })).toBeInTheDocument();
    });
  });
});

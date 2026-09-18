// ---------------------------------------------------------------------------
// SearchPage tests — the query/mode/org-scope submit flow, single vs.
// multi-org gating, and the three result shapes (`case` links directly,
// `case_note`/`case_document` resolve their `caseId` externalId to a case
// link best-effort, an unresolved reference renders with no link at all).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SearchPage } from './SearchPage';
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

const GATE: ScopeGateValue = {
  loading: false,
  allowedActions: ['profiles:r'],
  identity: { userId: 'usr_alice' },
  can: () => true,
};

function testQueryClient(staleTime = Infinity): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, staleTime },
      mutations: { retry: false },
    },
  });
}

function renderPage(client: unknown, opts: { staleTime?: number } = {}): void {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={testQueryClient(opts.staleTime)}>
        <MemoryRouter initialEntries={['/search']}>
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route path="/cases/:id" element={<div>case detail page</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </IntlProvider>,
  );
}

/** One founded org, no memberships — the common single-org caller shape
 *  every non-multi-org test below assumes. */
function singleFounderOrg(): {
  listEntities: ReturnType<typeof vi.fn>;
  lookupRecords: ReturnType<typeof vi.fn>;
} {
  return {
    listEntities: vi.fn().mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }])),
    lookupRecords: vi.fn().mockResolvedValue(pageOf([])), // org_membership discovery — none
  };
}

describe('SearchPage', () => {
  beforeEach(() => {
    mockedClient.mockReset();
    mockedUseScopeGate.mockReturnValue(GATE);
  });

  it('prompts for a query before any org picker or search runs', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi.fn();
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    expect(await screen.findByText('Enter a search term to get started.')).toBeInTheDocument();
    expect(content).not.toHaveBeenCalled();
  });

  it('shows the no-orgs empty state for a caller with no accessible org', async () => {
    const listEntities = vi.fn().mockResolvedValue(pageOf([]));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    renderPage({
      identity: { listEntities },
      records: { lookupRecords },
      search: { content: vi.fn() },
    });

    expect(
      await screen.findByText(
        "You don't have an org to search in yet — ask an HR admin to invite you.",
      ),
    ).toBeInTheDocument();
  });

  it('shows the no-orgs empty state (never runs org discovery or search) for a caller with no userId — scope gate degraded', async () => {
    // useAccessibleOrgs computes its OWN isSuccess gated on hasUserId (not the
    // underlying react-queries' native isPending, which would stay stuck true
    // forever for a permanently-disabled query) — so this degrades the exact
    // same way as "no accessible org", not a stuck spinner. Same behavior
    // OrgsListPage's own no-userId branch relies on.
    mockedUseScopeGate.mockReturnValue({ ...GATE, identity: {} });
    const listEntities = vi.fn();
    const lookupRecords = vi.fn();
    const content = vi.fn();
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    expect(
      await screen.findByText(
        "You don't have an org to search in yet — ask an HR admin to invite you.",
      ),
    ).toBeInTheDocument();
    expect(listEntities).not.toHaveBeenCalled();
    expect(lookupRecords).not.toHaveBeenCalled();

    // Submitting a query anyway must not run the search either — effectiveOrgId
    // can never resolve without a userId to discover orgs against.
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(content).not.toHaveBeenCalled());
  });

  it('a single-org caller searches immediately, scoped to that org, via a disabled picker naming it', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'case_1',
          metadata: { recordType: 'case', caseType: 'grievance' },
          contextText: 'A grievance about scheduling.',
        },
      ],
      totalResults: 1,
    });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    // A single-org caller sees a DISABLED field naming the org — never hidden entirely (regression
    // guard: OrgPickerField's own contract, matching every other caller of it in this app — see
    // that component's header comment on why "auto-selected with nothing shown" reads as broken).
    const orgField = await screen.findByLabelText('Org');
    expect(orgField).toBeDisabled();
    expect(orgField).toHaveValue('Acme Inc');

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'scheduling');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Grievance' })).toHaveAttribute(
      'href',
      '/cases/case_1',
    );
    expect(content).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'scheduling', mode: 'HYBRID', scope: 'org:org_1' }),
    );
  });

  it('re-submitting the SAME term runs the search again instead of serving the cached page', async () => {
    // react-query keys the search on the submitted term, so re-submitting an unchanged term changes
    // no key and issues no request. Indexing is asynchronous, so without an explicit refetch a search
    // run seconds before an entry is indexed stays empty however many times it is re-run.
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi
      .fn()
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      .mockResolvedValue({
        results: [
          {
            documentId: 'note_1',
            metadata: { recordType: 'case_note' },
            contextText: 'Now indexed.',
          },
        ],
        totalResults: 1,
      });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();
    expect(content).toHaveBeenCalledTimes(1);

    // The SAME term again. Before the fix this issued no call at all and the empty state stood.
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Now indexed.')).toBeInTheDocument();
  });

  it('offers the refresh control on the ERROR state, and it re-runs the failed search', async () => {
    // The third place the control lives, and the one a caller most wants after a transient 5xx:
    // without it the only way to retry is to re-submit the form.
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream exploded'))
      .mockResolvedValue({
        results: [
          { documentId: 'n9', metadata: { recordType: 'case_note' }, contextText: 'Back up.' },
        ],
        totalResults: 1,
      });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Couldn't run this search/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Re-run this search' }));
    expect(await screen.findByText('Back up.')).toBeInTheDocument();
  });

  it('offers the refresh control alongside a NON-empty result set too, and it re-runs', async () => {
    // Both other cells drive the EMPTY state, so neither would notice the control disappearing from
    // the results header — the half of the behaviour a caller with results actually sees.
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi
      .fn()
      .mockResolvedValueOnce({
        results: [
          { documentId: 'n1', metadata: { recordType: 'case_note' }, contextText: 'First pass.' },
        ],
        totalResults: 1,
      })
      .mockResolvedValue({
        results: [
          { documentId: 'n2', metadata: { recordType: 'case_note' }, contextText: 'Second pass.' },
        ],
        totalResults: 1,
      });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('First pass.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Re-run this search' }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Second pass.')).toBeInTheDocument();
  });

  it('treats a re-submit that only differs by surrounding whitespace as the same search, and re-runs it', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi
      .fn()
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      .mockResolvedValue({
        results: [
          {
            documentId: 'n3',
            metadata: { recordType: 'case_note' },
            contextText: 'Trimmed match.',
          },
        ],
        totalResults: 1,
      });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    const box = await screen.findByRole('textbox', { name: 'Search' });
    await userEvent.type(box, 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();

    // The trimmed value is unchanged, so this is the same search and must re-run rather than
    // fall through to the key-change path.
    await userEvent.type(box, '  ');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Trimmed match.')).toBeInTheDocument();
  });

  it('the refresh control re-runs the current search from the empty state', async () => {
    // The empty state is where a refresh matters most, so the control has to be reachable THERE and
    // not only alongside a result count the caller does not have yet.
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi
      .fn()
      .mockResolvedValueOnce({ results: [], totalResults: 0 })
      .mockResolvedValue({
        results: [
          {
            documentId: 'note_2',
            metadata: { recordType: 'case_note' },
            contextText: 'Arrived on the retry.',
          },
        ],
        totalResults: 1,
      });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/No results for/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Re-run this search' }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Arrived on the retry.')).toBeInTheDocument();
  });

  it('submitting a DIFFERENT term runs that term rather than re-running the old one', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi.fn().mockResolvedValue({ results: [], totalResults: 0 });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    const box = await screen.findByRole('textbox', { name: 'Search' });
    await userEvent.type(box, 'first');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(1));

    await userEvent.type(box, 'x'); // the box now reads "firstx"
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
    expect(content).toHaveBeenLastCalledWith(expect.objectContaining({ query: 'firstx', offset: 0 }));
  });

  it.each([
    ['the refresh control', 'Re-run this search'],
    ['re-submitting the same term', 'Search'],
  ])('re-running via %s after "Load more" fetches ONLY the first page, never re-billing every loaded page', async (_trigger, rerunButton) => {
    // A plain refetch() on an infinite query re-issues every loaded page in sequence: here that
    // would be a second, offset-carrying search the caller never asked for, and every search is billed.
    const { listEntities, lookupRecords } = singleFounderOrg();
    const firstPage = Array.from({ length: 25 }, (_, i) => ({
      documentId: `note_${i}`,
      metadata: { recordType: 'case_note' },
      contextText: `hit ${i}`,
    }));
    const content = vi
      .fn()
      .mockResolvedValueOnce({ results: firstPage, totalResults: 30 })
      .mockResolvedValueOnce({
        results: [{ documentId: 'note_25', metadata: { recordType: 'case_note' }, contextText: 'page two hit' }],
        totalResults: 30,
      })
      .mockResolvedValue({ results: firstPage, totalResults: 30 });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /load more/i }));
    expect(await screen.findByText('page two hit')).toBeInTheDocument();
    expect(content).toHaveBeenCalledTimes(2);

    await userEvent.click(screen.getByRole('button', { name: rerunButton }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(3));
    expect(content.mock.calls[2]?.[0]).toEqual(expect.objectContaining({ offset: 0 }));
    await waitFor(() => expect(screen.queryByText('page two hit')).not.toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(content).toHaveBeenCalledTimes(3);
  });

  it('does not send a duplicate request when the same term is re-submitted while a re-run is in flight', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    let resolveRerun: (value: unknown) => void = () => {};
    const content = vi
      .fn()
      .mockResolvedValueOnce({
        results: [{ documentId: 'n_a', metadata: { recordType: 'case_note' }, contextText: 'First.' }],
        totalResults: 1,
      })
      .mockImplementationOnce(() => new Promise((resolve) => { resolveRerun = resolve; }))
      .mockResolvedValue({ results: [], totalResults: 0 });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('First.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Search' })); // re-run, stays in flight
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Search' })); // must NOT restart it
    await new Promise((r) => setTimeout(r, 50));
    expect(content).toHaveBeenCalledTimes(2);

    resolveRerun({
      results: [{ documentId: 'n_b', metadata: { recordType: 'case_note' }, contextText: 'Second.' }],
      totalResults: 1,
    });
    expect(await screen.findByText('Second.')).toBeInTheDocument();
    expect(content).toHaveBeenCalledTimes(2);
  });

  it('drops a same-term re-submit while "Load more" is in flight, cancelling nothing', async () => {
    // Resetting during a next-page search would cancel a request already sent (and billed) and
    // re-issue page one on top of it.
    const { listEntities, lookupRecords } = singleFounderOrg();
    const firstPage = Array.from({ length: 25 }, (_, i) => ({
      documentId: `note_${i}`,
      metadata: { recordType: 'case_note' },
      contextText: `hit ${i}`,
    }));
    let resolvePageTwo: (value: unknown) => void = () => {};
    const content = vi
      .fn()
      .mockResolvedValueOnce({ results: firstPage, totalResults: 30 })
      .mockImplementationOnce(() => new Promise((resolve) => { resolvePageTwo = resolve; }))
      .mockResolvedValue({ results: firstPage, totalResults: 30 });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'marker');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await userEvent.click(await screen.findByRole('button', { name: /load more/i }));
    await waitFor(() => expect(content).toHaveBeenCalledTimes(2));

    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(content).toHaveBeenCalledTimes(2);

    resolvePageTwo({
      results: [{ documentId: 'note_25', metadata: { recordType: 'case_note' }, contextText: 'page two hit' }],
      totalResults: 30,
    });
    expect(await screen.findByText('page two hit')).toBeInTheDocument();
    expect(content).toHaveBeenCalledTimes(2);
  });

  describe('automatic refetches never re-walk loaded pages', () => {
    // Production data goes stale after a finite time, and react-query's automatic refetches
    // re-fetch every loaded page of an infinite query. `staleTime: 0` reproduces that staleness.
    const pagedContent = () =>
      vi.fn().mockImplementation(({ query, offset }: { query: string; offset: number }) =>
        Promise.resolve(
          offset === 0
            ? {
                totalResults: 30,
                results: Array.from({ length: 25 }, (_, i) => ({
                  documentId: `${query}_${i}`,
                  metadata: { recordType: 'case_note' },
                  contextText: `${query} hit ${i}`,
                })),
              }
            : {
                totalResults: 30,
                results: [
                  { documentId: `${query}_25`, metadata: { recordType: 'case_note' }, contextText: `${query} page two` },
                ],
              },
        ),
      );

    it('returning to an earlier term after Load more runs its first page once', async () => {
      const { listEntities, lookupRecords } = singleFounderOrg();
      const content = pagedContent();
      renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } }, { staleTime: 0 });
      const box = await screen.findByRole('textbox', { name: 'Search' });

      await userEvent.type(box, 'alpha');
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await userEvent.click(await screen.findByRole('button', { name: /load more/i }));
      expect(await screen.findByText('alpha page two')).toBeInTheDocument();

      await userEvent.clear(box);
      await userEvent.type(box, 'beta');
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(await screen.findByText('beta hit 0')).toBeInTheDocument();

      await userEvent.clear(box);
      await userEvent.type(box, 'alpha');
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      expect(await screen.findByText('alpha hit 0')).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 50));

      // alpha p1, alpha p2, beta p1, then alpha p1 once: never alpha p2 again.
      expect(content.mock.calls.map(([a]) => `${a.query}@${a.offset}`)).toEqual([
        'alpha@0',
        'alpha@25',
        'beta@0',
        'alpha@0',
      ]);
    });

    it('a network reconnect does not refetch a search with several pages loaded', async () => {
      const { listEntities, lookupRecords } = singleFounderOrg();
      const content = pagedContent();
      renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } }, { staleTime: 0 });

      await userEvent.type(await screen.findByRole('textbox', { name: 'Search' }), 'alpha');
      await userEvent.click(screen.getByRole('button', { name: 'Search' }));
      await userEvent.click(await screen.findByRole('button', { name: /load more/i }));
      expect(await screen.findByText('alpha page two')).toBeInTheDocument();
      expect(content).toHaveBeenCalledTimes(2);

      try {
        act(() => onlineManager.setOnline(false));
        act(() => onlineManager.setOnline(true));
        await new Promise((r) => setTimeout(r, 50));
        expect(content).toHaveBeenCalledTimes(2);
      } finally {
        onlineManager.setOnline(true);
      }
    });
  });

  it('a multi-org caller sees an org picker and must choose before searching', async () => {
    const listEntities = vi.fn().mockResolvedValue(
      pageOf([
        { id: 'org_1', name: 'Acme Inc' },
        { id: 'org_2', name: 'Beta LLC' },
      ]),
    );
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const content = vi.fn().mockResolvedValue({ results: [], totalResults: 0 });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    expect(await screen.findByLabelText('Org')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    // No org picked yet — the query stays disabled, and (regression guard: a disabled
    // react-query reports `isPending: true` forever, so this must NOT be the loading spinner —
    // live-caught via the smoke suite before this check existed) shows a real prompt instead.
    await waitFor(() => expect(content).not.toHaveBeenCalled());
    expect(screen.getByText('Pick an org above to run this search.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Searching…')).not.toBeInTheDocument();

    // Re-submitting the same term before an org is picked still sends nothing, and still shows
    // the prompt rather than a loading state.
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(content).not.toHaveBeenCalled();
    expect(screen.getByText('Pick an org above to run this search.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Searching…')).not.toBeInTheDocument();
  });

  it('a case_note result resolves its caseId (externalId) to a case link', async () => {
    const { listEntities, lookupRecords: orgLookup } = singleFounderOrg();
    const content = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'note_1',
          metadata: { recordType: 'case_note', caseId: 'case-ext-123' },
          contextText: 'Intake notes for the employee.',
        },
      ],
      totalResults: 1,
    });
    // lookupRecords is shared across org-membership discovery (org_membership, empty) and this
    // result's caseId resolve (type: 'case') — dispatch on the requested type.
    const lookupRecordsByBody = vi.fn().mockResolvedValue(pageOf([{ id: 'case_1' }]));
    renderPage({
      identity: { listEntities },
      records: { lookupRecords: orgLookup, lookupRecordsByBody },
      search: { content },
    });

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'intake');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Case entry' })).toHaveAttribute(
      'href',
      '/cases/case_1',
    );
    expect(lookupRecordsByBody).toHaveBeenCalledWith({
      type: 'case',
      field: 'externalId',
      value: 'case-ext-123',
    });
  });

  it('a case_document result with no caseId in its metadata renders with no link', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'doc_1',
          metadata: { recordType: 'case_document', title: 'Intake form.pdf' },
          contextText: 'Employee intake form contents.',
        },
      ],
      totalResults: 1,
    });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'intake form');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Intake form.pdf')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Intake form.pdf' })).not.toBeInTheDocument();
  });

  it('shows the API error state when the search call fails', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi.fn().mockRejectedValue(new Error('boom'));
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText("Couldn't run this search")).toBeInTheDocument();
  });

  it('renders a result date when the result carries createdAt', async () => {
    const { listEntities, lookupRecords } = singleFounderOrg();
    const content = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'case_1',
          metadata: { recordType: 'case', caseType: 'grievance' },
          contextText: 'A grievance about scheduling.',
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
      totalResults: 1,
    });
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'scheduling');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('link', { name: 'Grievance' })).toBeInTheDocument();
    // Not an exact day string — the day itself can shift a calendar date either way depending on
    // the test environment's timezone against a midnight-UTC timestamp; the year is enough to
    // confirm `dateLabel` actually rendered from `createdAt` rather than being silently omitted.
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it('regression: org-discovery failure must not leave the search spinner stuck forever', async () => {
    // A DISABLED react-query reports `isPending: true` forever — before `orgDiscoveryFailed`
    // existed, a caller who submitted a query while org discovery itself was broken saw an
    // infinite "Searching…" spinner instead of the (already-shown) org-load error alert.
    const listEntities = vi.fn().mockRejectedValue(new Error('org discovery boom'));
    const lookupRecords = vi.fn().mockResolvedValue(pageOf([]));
    const content = vi.fn();
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content } });

    expect(await screen.findByText("Couldn't load your orgs")).toBeInTheDocument();

    // Submitting a query anyway must not surface the loading spinner — org discovery having
    // failed means `effectiveOrgId` can never resolve, same "forever pending" trap.
    await userEvent.type(screen.getByRole('textbox', { name: 'Search' }), 'anything');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    await waitFor(() => expect(content).not.toHaveBeenCalled());
    expect(screen.queryByLabelText('Searching…')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SearchPage tests — the query/mode/org-scope submit flow, single vs.
// multi-org gating, and the three result shapes (`case` links directly,
// `case_note`/`case_document` resolve their `caseId` externalId to a case
// link best-effort, an unresolved reference renders with no link at all).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
  identity: { partnerUserId: 'usr_alice' },
  can: () => true,
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
function singleFounderOrg(): { listEntities: ReturnType<typeof vi.fn>; lookupRecords: ReturnType<typeof vi.fn> } {
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
    renderPage({ identity: { listEntities }, records: { lookupRecords }, search: { content: vi.fn() } });

    expect(
      await screen.findByText("You don't have an org to search in yet — ask an HR admin to invite you."),
    ).toBeInTheDocument();
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

  it('a multi-org caller sees an org picker and must choose before searching', async () => {
    const listEntities = vi
      .fn()
      .mockResolvedValue(pageOf([{ id: 'org_1', name: 'Acme Inc' }, { id: 'org_2', name: 'Beta LLC' }]));
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

    expect(await screen.findByRole('link', { name: 'Case entry' })).toHaveAttribute('href', '/cases/case_1');
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

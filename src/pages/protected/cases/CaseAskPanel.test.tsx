// ---------------------------------------------------------------------------
// CaseAskPanel tests — a case-scoped RAG ask, streamed via the (mock)
// async-iterable contract `useInferenceStream` expects (see that hook's own
// tests in packages/react for the pattern this reuses). Each ask is still a
// single-shot API call; what's under test here is this panel's OWN local
// history — the CaseAskPanel-specific adaptation over AskPage's "replace the
// previous answer" behavior.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { CaseAskPanel } from './CaseAskPanel';
import { IntlProvider } from '../../../i18n/IntlProvider';
import type { InferenceStreamEvent } from '@vectros-ai/react';

vi.mock('../../../api/vectrosApi', () => ({ vectrosApiClient: vi.fn(), CASEWORK_CONTEXT_ID: 'casework' }));
import { vectrosApiClient } from '../../../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

const DONE = {
  event: 'done' as const,
  inputTokens: 1,
  outputTokens: 1,
  model: 'm',
  platformCreditsCharged: 0,
  inferenceBalanceCentsCharged: 0,
};

async function* fromArray(events: InferenceStreamEvent[]): AsyncGenerator<InferenceStreamEvent> {
  for (const e of events) yield e;
}

const NO_MODELS = { models: [], defaultModel: undefined };

function renderPanel(client: Record<string, unknown>, onClose = vi.fn()) {
  mockedClient.mockReturnValue(client as never);
  render(
    <IntlProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CaseAskPanel open caseId="case_1" orgScope="org:org_1" onClose={onClose} />
      </QueryClientProvider>
    </IntlProvider>,
  );
  return { onClose };
}

describe('CaseAskPanel', () => {
  it('shows suggested prompts in the empty state', async () => {
    renderPanel({ inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS) } });
    expect(await screen.findByText('Summarize this case')).toBeInTheDocument();
    expect(screen.getByText("What's the latest status?")).toBeInTheDocument();
  });

  it('asks scoped to this case\'s own id AND its org scope — a regression guard for a real bug: search.scope is what authorizes the request; search.filters alone 403s for every real user', async () => {
    const user = userEvent.setup();
    const ragInference = vi.fn().mockResolvedValue(
      fromArray([
        { event: 'content_delta', delta: 'The case ' },
        { event: 'content_delta', delta: 'is open.' },
        DONE,
      ]),
    );
    renderPanel({
      inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS), ragInference },
    });

    await user.type(screen.getByPlaceholderText('Ask a question…'), 'What is the status?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    await waitFor(() =>
      expect(ragInference).toHaveBeenCalledWith(
        {
          query: 'What is the status?',
          search: { filters: { caseId: 'case_1' }, scope: 'org:org_1' },
        },
        expect.objectContaining({ abortSignal: expect.anything() }),
      ),
    );
    expect(await screen.findByText('The case is open.')).toBeInTheDocument();
    // The question itself is rendered above its answer.
    expect(screen.getByText('What is the status?')).toBeInTheDocument();
  });

  it('keeps a running history — a second ask does not erase the first exchange', async () => {
    const user = userEvent.setup();
    const ragInference = vi
      .fn()
      .mockResolvedValueOnce(fromArray([{ event: 'content_delta', delta: 'First answer.' }, DONE]))
      .mockResolvedValueOnce(fromArray([{ event: 'content_delta', delta: 'Second answer.' }, DONE]));
    renderPanel({
      inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS), ragInference },
    });

    const input = screen.getByPlaceholderText('Ask a question…');
    await user.type(input, 'First question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('First answer.')).toBeInTheDocument();
    // Wait for the first exchange to fully settle (input re-enabled, same
    // signal a real user waits on) before asking a follow-up.
    await waitFor(() => expect(input).not.toBeDisabled());

    await user.type(input, 'Second question');
    await user.click(screen.getByRole('button', { name: 'Ask' }));
    expect(await screen.findByText('Second answer.')).toBeInTheDocument();

    // Both exchanges are still visible — this panel never replaces the prior
    // answer the way AskPage's single-shot UI does.
    expect(screen.getByText('First question')).toBeInTheDocument();
    expect(screen.getByText('First answer.')).toBeInTheDocument();
    expect(screen.getByText('Second question')).toBeInTheDocument();
  });

  it('renders citations from the search_results event', async () => {
    const user = userEvent.setup();
    const ragInference = vi.fn().mockResolvedValue(
      fromArray([
        { event: 'content_delta', delta: 'Grounded answer.' },
        {
          event: 'search_results',
          results: [{ documentId: 'doc_1', score: 0.9, snippet: 'Matched snippet.' }],
          totalResults: 1,
          searchTimeMs: 12,
        },
        DONE,
      ]),
    );
    renderPanel({
      inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS), ragInference },
    });

    await user.type(screen.getByPlaceholderText('Ask a question…'), 'Anything grounded?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByText('Matched snippet.', { exact: false })).toBeInTheDocument();
  });

  it('shows the error alert (with the answer streamed so far) when the stream fails', async () => {
    const user = userEvent.setup();
    const ragInference = vi.fn().mockResolvedValue(
      fromArray([
        { event: 'content_delta', delta: 'Partial before failure.' },
        { event: 'error', message: 'model unavailable', code: 'inference_error' },
      ]),
    );
    renderPanel({
      inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS), ragInference },
    });

    await user.type(screen.getByPlaceholderText('Ask a question…'), 'Will this fail?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('model unavailable');
    expect(screen.getByText('Partial before failure.')).toBeInTheDocument();
  });

  it('shows the error alert even when the stream fails before any content_delta arrives', async () => {
    // Regression guard: the empty-state condition used to check only
    // `state.text.length` / `isStreaming`, so a run that errors before
    // streaming any text reverted straight back to the suggested-prompts
    // empty state with the failure never shown at all.
    const user = userEvent.setup();
    const ragInference = vi
      .fn()
      .mockResolvedValue(fromArray([{ event: 'error', message: 'model unavailable', code: 'inference_error' }]));
    renderPanel({
      inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS), ragInference },
    });

    await user.type(screen.getByPlaceholderText('Ask a question…'), 'Will this fail immediately?');
    await user.click(screen.getByRole('button', { name: 'Ask' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('model unavailable');
    expect(screen.queryByText('Summarize this case')).not.toBeInTheDocument();
  });

  it('calls onClose when the close button is clicked', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel({ inference: { listInferenceModels: vi.fn().mockResolvedValue(NO_MODELS) } });
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

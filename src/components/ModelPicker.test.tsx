// ---------------------------------------------------------------------------
// ModelPicker tests — soft-annotated model list (tiers + the US-served credit
// rate, plus the long-prompt rate where a model has one), the load-error
// fallback, the loading hint and the empty note. The registry is served by a
// mocked `vectrosApiClient().inference.listInferenceModels`, so the real
// `useInferenceModels` hook runs, as in the Ask panel's own tests.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ModelPicker } from './ModelPicker';
import { TestProviders } from '../test/TestProviders';

vi.mock('../api/vectrosApi', () => ({ vectrosApiClient: vi.fn() }));
import { vectrosApiClient } from '../api/vectrosApi';

const mockedClient = vi.mocked(vectrosApiClient);

// Entries follow the catalog contract: `inputCreditsPer1kTokens` and
// `outputCreditsPer1kTokens` are the BASE rate, `regionPricing.us` is the rate
// a default (US-served) request is billed, and `longContext` (only on a model
// priced by prompt length) is the standard rates times `multiplier`.
const HAIKU_5_5 = {
  id: 'claude-haiku-5-5',
  name: 'Claude Haiku 5.5',
  provider: 'Anthropic',
  contextWindow: 1000000,
  availableOn: ['free', 'starter', 'pro', 'scale', 'enterprise'],
  inputCreditsPer1kTokens: 0.01,
  outputCreditsPer1kTokens: 0.05,
  regionPricing: {
    base: { input: 0.01, output: 0.05 },
    us: { input: 0.011, output: 0.055 },
    regionPremiumFactor: 1.1,
    globalAvailable: true,
  },
  longContext: {
    promptTokensOver: 100000,
    multiplier: 5,
    base: { input: 0.05, output: 0.25 },
    us: { input: 0.055, output: 0.275 },
  },
};

const HAIKU_4_5 = {
  id: 'claude-haiku-4-5',
  name: 'Claude Haiku 4.5',
  provider: 'Anthropic',
  contextWindow: 200000,
  availableOn: ['free', 'pro'],
  inputCreditsPer1kTokens: 0.1,
  outputCreditsPer1kTokens: 0.5,
  regionPricing: {
    base: { input: 0.1, output: 0.5 },
    us: { input: 0.11, output: 0.55 },
    regionPremiumFactor: 1.1,
    globalAvailable: true,
  },
};

// No region premium: the US rate equals the base rate.
const NOVA = {
  id: 'nova-lite',
  name: 'Amazon Nova Lite',
  provider: 'Amazon',
  contextWindow: 300000,
  availableOn: ['free', 'pro'],
  inputCreditsPer1kTokens: 0.006,
  outputCreditsPer1kTokens: 0.024,
  regionPricing: {
    base: { input: 0.006, output: 0.024 },
    us: { input: 0.006, output: 0.024 },
    regionPremiumFactor: 1.0,
    globalAvailable: true,
  },
};

const MODELS = { defaultModel: 'claude-haiku-5-5', models: [HAIKU_5_5, HAIKU_4_5, NOVA] };

function serve(listInferenceModels: () => Promise<unknown>): void {
  mockedClient.mockReturnValue({ inference: { listInferenceModels } } as never);
}

function renderPicker(value = 'claude-haiku-5-5'): void {
  render(
    <TestProviders>
      <ModelPicker value={value} onChange={vi.fn()} />
    </TestProviders>,
  );
}

async function openMenu(data: unknown): Promise<void> {
  serve(() => Promise.resolve(data));
  const user = userEvent.setup();
  renderPicker();
  const combobox = screen.getByRole('combobox', { name: /model/i });
  // Disabled while the registry loads.
  await waitFor(() => expect(combobox).not.toHaveAttribute('aria-disabled', 'true'));
  await user.click(combobox);
}

describe('ModelPicker', () => {
  beforeEach(() => mockedClient.mockReset());

  it('shows the selected model name and annotates options with tiers + credit rate', async () => {
    await openMenu(MODELS);

    // Closed control shows just the selected model's name (renderValue).
    expect(screen.getByRole('combobox', { name: /model/i, hidden: true })).toHaveTextContent(
      'Claude Haiku 5.5',
    );

    // Options carry the tier + credit-rate annotation: the US-served rate,
    // not the base rate.
    const haiku45 = await screen.findByRole('option', { name: /Claude Haiku 4\.5/ });
    expect(haiku45).toHaveTextContent('free/pro');
    expect(haiku45).toHaveTextContent('0.11/0.55 credits per 1k tokens');
    expect(haiku45).not.toHaveTextContent('0.1/0.5');
  });

  it('shows the long-prompt rate beside the standard rate for a model that has one', async () => {
    await openMenu(MODELS);
    const haiku55 = await screen.findByRole('option', { name: /Claude Haiku 5\.5/ });

    // Every figure comes from the catalog entry: the US standard rate, then the
    // threshold (grouped) and the US long-prompt rate. The base figures are not
    // shown.
    expect(haiku55).toHaveTextContent(
      '0.011/0.055 credits per 1k tokens · prompts over 100,000 tokens: 0.055/0.275 credits per 1k tokens',
    );
    expect(haiku55).not.toHaveTextContent('0.05/0.25');
    expect(haiku55).not.toHaveTextContent('0.01/0.05');
  });

  it('shows no long-prompt rate for a model without one', async () => {
    await openMenu(MODELS);
    const haiku45 = await screen.findByRole('option', { name: /Claude Haiku 4\.5/ });
    expect(haiku45).not.toHaveTextContent('prompts over');
    // Exactly one option (the model with a second rate card) carries the line.
    expect(screen.getAllByText(/prompts over/)).toHaveLength(1);
  });

  it('shows the rate as is for a model with no region premium (US equals base)', async () => {
    await openMenu(MODELS);
    const nova = await screen.findByRole('option', { name: /Amazon Nova Lite/ });
    expect(nova).toHaveTextContent('0.006/0.024 credits per 1k tokens');
  });

  it('shows the published US rate, not one computed from the base rate and the premium', async () => {
    // Deliberately not base x premium (1 x 1.1, 3 x 1.1): a picker that computed
    // the rate itself could not produce these figures.
    await openMenu({
      defaultModel: 'm',
      models: [
        {
          ...HAIKU_4_5,
          id: 'm',
          name: 'Published',
          inputCreditsPer1kTokens: 1,
          outputCreditsPer1kTokens: 3,
          regionPricing: {
            base: { input: 1, output: 3 },
            us: { input: 1.2, output: 3.5 },
            regionPremiumFactor: 1.1,
            globalAvailable: true,
          },
        },
      ],
    });
    const option = await screen.findByRole('option', { name: /Published/ });
    expect(option).toHaveTextContent('1.2/3.5 credits per 1k tokens');
  });

  it('shows a rate of three or more decimals as published, without rounding', async () => {
    await openMenu({
      defaultModel: 'm',
      models: [
        {
          ...NOVA,
          id: 'm',
          name: 'Tiny',
          regionPricing: {
            base: { input: 0.0004, output: 0.0012 },
            us: { input: 0.0004, output: 0.0012 },
            regionPremiumFactor: 1.0,
            globalAvailable: true,
          },
        },
      ],
    });
    const option = await screen.findByRole('option', { name: /Tiny/ });
    expect(option).toHaveTextContent('0.0004/0.0012 credits per 1k tokens');
  });

  it.each([
    ['absent', undefined],
    ['null', null],
  ])(
    'renders the menu with a %s longContext and no long-prompt line',
    async (_label, longContext) => {
      await openMenu({
        defaultModel: 'm',
        models: [{ ...HAIKU_4_5, id: 'm', name: 'Plain', longContext }],
      });
      const option = await screen.findByRole('option', { name: /Plain/ });
      expect(option).toHaveTextContent('0.11/0.55 credits per 1k tokens');
      expect(option).not.toHaveTextContent('prompts over');
    },
  );

  it('lets a long option wrap instead of clipping on a narrow screen', async () => {
    await openMenu(MODELS);
    const haiku55 = await screen.findByRole('option', { name: /Claude Haiku 5\.5/ });
    expect(getComputedStyle(haiku55).whiteSpace).toBe('normal');
  });

  it('reports a load error with a fallback note', async () => {
    serve(() => Promise.reject(new Error('boom')));
    renderPicker('');
    expect(await screen.findByText(/couldn't load the model list/i)).toBeInTheDocument();
  });

  it('shows a loading hint while the registry loads', () => {
    serve(() => new Promise(() => {}));
    renderPicker('');
    expect(screen.getByText(/loading models/i)).toBeInTheDocument();
  });

  it('shows a plain (non-alert) note when the registry returns no models', async () => {
    serve(() => Promise.resolve({ defaultModel: '', models: [] }));
    renderPicker('');
    expect(await screen.findByText(/no models are available/i)).toBeInTheDocument();
    // An Alert's role="alert" would collide with the panel's own error alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

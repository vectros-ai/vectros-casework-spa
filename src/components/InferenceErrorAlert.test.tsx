import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createIntl } from 'react-intl';
import type { InferenceStreamError } from '@vectros-ai/react';

import messages from '../i18n/messages.en.json';
import { TestProviders } from '../test/TestProviders';
import { inferenceErrorDetail } from '../lib/inferenceErrorDetail';
import { InferenceErrorAlert } from './InferenceErrorAlert';

const intl = createIntl({ locale: 'en', messages });

// What the stream hook keeps for an SDK error: its multi-line text as `message`.
const SDK_DUMP =
  'TooManyRequestsError\nStatus code: 429\nBody: {"message":"Your pre-paid inference balance is busy.","errorCode":"BALANCE_BUSY"}';

function thrown(extra: Partial<InferenceStreamError>): InferenceStreamError {
  return { message: SDK_DUMP, code: 'stream_error', ...extra };
}

describe('inferenceErrorDetail', () => {
  it('shows nothing when there is no error, or its message is blank', () => {
    expect(inferenceErrorDetail(undefined, intl)).toBeUndefined();
    expect(inferenceErrorDetail({ message: '   ', code: 'x' }, intl)).toBeUndefined();
  });

  it('shows the message of an error without a status (stream event, network failure, routed call)', () => {
    expect(inferenceErrorDetail({ message: ' Model unavailable. ', code: 'inference_error' }, intl)).toBe(
      'Model unavailable.',
    );
    expect(inferenceErrorDetail({ message: 'Failed to fetch', code: 'stream_error' }, intl)).toBe(
      'Failed to fetch',
    );
  });

  it('shows the API message for a busy balance (429 BALANCE_BUSY), as the platform words it, never the SDK dump', () => {
    const busy = 'Your pre-paid inference balance is busy with other concurrent requests. This is not a shortage: retry in a moment.';
    const out = inferenceErrorDetail(thrown({ status: 429, errorCode: 'BALANCE_BUSY', detail: busy }), intl);
    expect(out).toBe(busy);
    expect(out).toMatch(/not a shortage/);
    expect(out).not.toMatch(/Status code|Body:|TooManyRequestsError/);
  });

  it('shows the API message for an interrupted balance step (503 BALANCE_UNAVAILABLE)', () => {
    const unavailable =
      'A temporary fault interrupted the pre-paid balance step of this call. This is not a shortage: do not top up; retry in a moment.';
    const out = inferenceErrorDetail(
      thrown({ status: 503, errorCode: 'BALANCE_UNAVAILABLE', detail: unavailable }),
      intl,
    );
    expect(out).toBe(unavailable);
  });

  it('shows the API message for a short balance (402) without telling the person to retry', () => {
    const out = inferenceErrorDetail(
      thrown({ status: 402, detail: 'Insufficient inference balance. Please top up in the developer portal.' }),
      intl,
    );
    expect(out).toBe('Insufficient inference balance. Please top up in the developer portal.');
  });

  it.each([400, 401, 403, 404, 409, 413])(
    'status %i with no API message: a neutral line with the status and no "try again"',
    (status) => {
      const out = inferenceErrorDetail(thrown({ status }), intl);
      expect(out).toBe(`The request failed (status ${status}).`);
      expect(out).not.toMatch(/try again|Status code|Body:/i);
    },
  );

  it.each([408, 429, 500, 502, 503])('status %i with no API message: a neutral line that says to try again', (status) => {
    expect(inferenceErrorDetail(thrown({ status }), intl)).toBe(
      `The request failed (status ${status}). Please try again.`,
    );
  });

  it('never shows the SDK dump, whatever the status or code', () => {
    for (const error of [
      thrown({ status: 429 }),
      thrown({ status: 503, errorCode: 'SOMETHING_NEW' }),
      thrown({ status: 418, errorCode: 'BALANCE_BUSY' }),
    ]) {
      expect(inferenceErrorDetail(error, intl)).not.toMatch(/Status code|Body:|Error\n/);
    }
  });
});

describe('InferenceErrorAlert', () => {
  it('renders the title and the API message as an announced alert, without the SDK dump', () => {
    render(
      <TestProviders>
        <InferenceErrorAlert
          error={thrown({
            status: 429,
            errorCode: 'BALANCE_BUSY',
            detail: 'Your balance is busy. This is not a shortage: retry in a moment.',
          })}
        >
          This answer didn't finish
        </InferenceErrorAlert>
      </TestProviders>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("This answer didn't finish");
    expect(alert).toHaveTextContent('This is not a shortage: retry in a moment.');
    expect(alert).not.toHaveTextContent(/Status code|Body:/);
  });

  it('renders only the title when there is no detail', () => {
    render(
      <TestProviders>
        <InferenceErrorAlert error={undefined}>Title only</InferenceErrorAlert>
      </TestProviders>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/^Title only$/);
  });
});

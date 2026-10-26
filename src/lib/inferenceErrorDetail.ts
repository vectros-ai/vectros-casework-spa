// ---------------------------------------------------------------------------
// inferenceErrorDetail — the detail line under an inference error's title.
// See InferenceErrorAlert for where the two kinds of error come from.
// ---------------------------------------------------------------------------

import type { IntlShape } from 'react-intl';
import type { InferenceStreamState } from '@vectros-ai/react';

/**
 * The detail line for a failed inference run, or `undefined` when there is
 * nothing to add under the title.
 *
 * A failure that carries an HTTP status never shows the stream state's raw
 * `message` (the SDK's multi-line text). It shows the API's own message, which
 * for the retryable refusals says so in plain words (for example that a busy
 * balance is not a shortage), and otherwise a neutral line with the status: one
 * that says to try again for a timeout, a rate limit or a server error.
 */
export function inferenceErrorDetail(
  error: InferenceStreamState['error'],
  intl: IntlShape,
): string | undefined {
  if (error === undefined) return undefined;
  if (error.status === undefined) {
    const message = error.message?.trim();
    return message === undefined || message === '' ? undefined : message;
  }
  if (error.detail !== undefined) return error.detail;
  const retryable = error.status === 408 || error.status === 429 || error.status >= 500;
  return intl.formatMessage(
    { id: retryable ? 'caseAsk.error.genericRetry' : 'caseAsk.error.generic' },
    { status: error.status },
  );
}

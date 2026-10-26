// ---------------------------------------------------------------------------
// InferenceErrorAlert — the terminal-error banner for the case Ask panel. A
// friendly title plus a detail line, which comes from one of two places:
//   - a request the API refused before the stream started (a busy pre-paid
//     balance, a rate limit, a missing permission) is thrown by the SDK, and the
//     SDK error's own `message` is a multi-line dump (class name, status line,
//     JSON body). That is never shown. The API's own client-facing message is
//     (`error.detail`), or a neutral line carrying the status when it sent none;
//   - anything without a status (an `error` event in the stream, a cancelled
//     request, a network failure) shows its `message` as before.
// Centralized so the detail isn't dropped on the floor, and so the alert
// always announces (`role="alert"`; MUI's Alert has no implicit role).
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Alert, Typography } from '@mui/material';
import { useIntl } from 'react-intl';
import type { InferenceStreamState } from '@vectros-ai/react';

import { inferenceErrorDetail } from '../lib/inferenceErrorDetail';

export interface InferenceErrorAlertProps {
  /** The terminal error from the stream state. */
  readonly error: InferenceStreamState['error'];
  /** The friendly, localized title (typically a <FormattedMessage>). */
  readonly children: ReactNode;
}

/**
 * An accessible error Alert for a failed inference run. Surfaces the friendly
 * title and the error detail (when present) so the failure isn't an opaque
 * dead-end.
 */
export function InferenceErrorAlert({
  error,
  children,
}: InferenceErrorAlertProps): React.JSX.Element {
  const intl = useIntl();
  const detail = inferenceErrorDetail(error, intl);
  return (
    <Alert severity="error" role="alert">
      {children}
      {detail !== undefined && (
        <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
          {detail}
        </Typography>
      )}
    </Alert>
  );
}

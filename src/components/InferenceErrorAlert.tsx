// ---------------------------------------------------------------------------
// InferenceErrorAlert — the terminal-error banner for the case Ask panel. A
// friendly title plus, when the stream's `error` event carried one, the
// backend-supplied detail message (which the SDK marks as suitable for end
// users). Centralized so the detail isn't dropped on the floor, and so the
// alert always announces (`role="alert"`; MUI's Alert has no implicit role).
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Alert, Typography } from '@mui/material';
import type { InferenceStreamState } from '@vectros-ai/react';

export interface InferenceErrorAlertProps {
  /** The terminal error from the stream state (its `message` is shown as detail). */
  readonly error: InferenceStreamState['error'];
  /** The friendly, localized title (typically a <FormattedMessage>). */
  readonly children: ReactNode;
}

/**
 * An accessible error Alert for a failed inference run. Surfaces the friendly
 * title and the backend error detail (when present) so the failure isn't an
 * opaque dead-end.
 */
export function InferenceErrorAlert({
  error,
  children,
}: InferenceErrorAlertProps): React.JSX.Element {
  const detail = error?.message?.trim();
  return (
    <Alert severity="error" role="alert">
      {children}
      {detail !== undefined && detail !== '' && (
        <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
          {detail}
        </Typography>
      )}
    </Alert>
  );
}

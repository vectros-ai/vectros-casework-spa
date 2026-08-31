// ---------------------------------------------------------------------------
// SuccessAlert — the "it worked" confirmation banner every mutation success
// path shows. Was independently re-authored byte-for-byte identical
// (`<Alert severity="success" role="status" onClose={...}>`) in six places
// (OrgDetailPage/ClientDetailPage's save success, ClientDetailPage's archive
// success, TeamPage's invite success, AccountPage's password-reset success,
// CaseDetailPage's status-change success) — the exact duplication
// `@vectros-ai/react`'s `ApiErrorAlert` was already promoted to fix on the
// error side. One shared component now, same reasoning.
// ---------------------------------------------------------------------------

import type { ReactNode } from 'react';
import { Alert } from '@mui/material';

export interface SuccessAlertProps {
  readonly children: ReactNode;
  /** Called when the user dismisses the banner (e.g. `() => mutation.reset()`). */
  readonly onDismiss: () => void;
}

export function SuccessAlert({ children, onDismiss }: SuccessAlertProps): React.JSX.Element {
  return (
    <Alert severity="success" role="status" onClose={onDismiss}>
      {children}
    </Alert>
  );
}

// ---------------------------------------------------------------------------
// EmptyStateCard — the "nothing here yet" card every list page shows.
//
// Was independently re-authored byte-for-byte identical (just a different
// message id) in CasesListPage, ClientsListPage, OrgsListPage, and TeamPage --
// good evidence the convention IS consistent, but nothing enforced it stayed
// that way. One shared component now, same reasoning as RefreshIconButton.
// ---------------------------------------------------------------------------

import { Paper, Typography } from '@mui/material';
import { FormattedMessage } from 'react-intl';

export interface EmptyStateCardProps {
  /** Message id for the empty-state copy, rendered via FormattedMessage. */
  readonly messageId: string;
  /** Interpolation values, when the message needs them. */
  readonly values?: Record<string, React.ReactNode>;
}

export function EmptyStateCard({ messageId, values }: EmptyStateCardProps): React.JSX.Element {
  return (
    <Paper sx={{ p: 4, textAlign: 'center' }}>
      <Typography variant="body1" color="text.secondary">
        <FormattedMessage id={messageId} {...(values ? { values } : {})} />
      </Typography>
    </Paper>
  );
}

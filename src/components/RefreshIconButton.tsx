// ---------------------------------------------------------------------------
// RefreshIconButton — a manual refresh affordance for a list page.
//
// Rough-edges item 1 (this app's punch list): before this, no list page had
// any way to re-pull the server's current state short of a full page reload
// — which also made a real cache-invalidation bug (a case status change not
// showing back up on the Cases list) hard to even DIAGNOSE as a cache issue
// rather than an app bug. One shared button, wired to the page's own
// `refetch`, keeps every list page consistent rather than reinventing this
// per page.
// ---------------------------------------------------------------------------

import { CircularProgress, IconButton, Tooltip } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useIntl } from 'react-intl';

export interface RefreshIconButtonProps {
  /** Called on click. Fire-and-forget from the caller's side — this button
   *  doesn't await it; pass an already-bound `() => query.refetch()` (or a
   *  function invalidating + refetching several queries at once). */
  readonly onRefresh: () => void;
  /** True while a refresh is in flight — shows a spinner in place of the icon
   *  and disables the button (so a second click can't queue a redundant
   *  refetch on top of one already running). */
  readonly isRefreshing: boolean;
}

/** A small icon button that re-triggers a list page's query/queries. */
export function RefreshIconButton({ onRefresh, isRefreshing }: RefreshIconButtonProps): React.JSX.Element {
  const intl = useIntl();
  const label = intl.formatMessage({ id: isRefreshing ? 'layout.refreshing' : 'layout.refresh' });
  return (
    <Tooltip title={label}>
      {/* A disabled IconButton doesn't fire mouse events needed for the Tooltip's own
          listeners — MUI's documented fix is wrapping it in a plain span. */}
      <span>
        <IconButton onClick={onRefresh} disabled={isRefreshing} aria-label={label} size="small">
          {isRefreshing ? <CircularProgress size={20} /> : <RefreshIcon fontSize="small" />}
        </IconButton>
      </span>
    </Tooltip>
  );
}

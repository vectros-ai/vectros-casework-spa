// ---------------------------------------------------------------------------
// Shared shape for react-router's `location.state`, as set by RequireAuth
// (`state={{ from: location }}`) and read back by LoginPage/CallbackPage to
// return the user to where they were headed before the auth detour.
// ---------------------------------------------------------------------------

import type { Location } from 'react-router';

export interface LocationFromState {
  readonly from?: Location;
}

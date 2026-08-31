// ---------------------------------------------------------------------------
// Carries an invite token across the Auth0 hosted-redirect round trip.
//
// `signInWithRedirect`'s own `appState` only carries `returnTo`
// (`@vectros-ai/react`'s `HostedRedirectAuth` interface, deliberately narrow —
// see that interface's own doc) — nothing in this package's redirect flow
// threads an arbitrary extra value through Auth0 and back. AcceptInvitePage
// stashes the token here, right before the browser navigates away; CallbackPage
// reads it back (once, destructively) after the redirect returns, and passes it
// to `acceptInvite()`. sessionStorage survives the full-page navigation but not
// a new tab, which is the right lifetime for a single accept attempt.
// ---------------------------------------------------------------------------

const PENDING_INVITE_KEY = 'casework-spa:pendingInviteToken';

export function storePendingInviteToken(token: string): void {
  sessionStorage.setItem(PENDING_INVITE_KEY, token);
}

/** Reads the pending invite token, if any, and clears it — a re-run of
 *  CallbackPage's effect (e.g. React StrictMode's double-invoke in dev) must
 *  not re-attempt an already-consumed bind with a second, stale copy. */
export function readAndClearPendingInviteToken(): string | null {
  const token = sessionStorage.getItem(PENDING_INVITE_KEY);
  sessionStorage.removeItem(PENDING_INVITE_KEY);
  return token;
}

// ---------------------------------------------------------------------------
// CallbackPage — Auth0's redirect-back target. Its route (`/callback`) must
// exactly match an Allowed Callback URL configured on the Auth0 application.
//
// Completes the code exchange via handleRedirectCallback(), then lands on
// `/`, which sits behind RequireAuth and renders straight through once a
// session exists. A deep link visited pre-sign-in is not restored after the
// redirect round trip — the one-hop cost of any hosted-redirect flow that
// doesn't carry its own return-path state across the provider boundary.
//
// The single shared redirect target for BOTH plain sign-in (LoginPage) and
// first-login invite acceptance (AcceptInvitePage) — Auth0's own Allowed
// Callback URLs is one fixed list, and `signInWithRedirect` has no per-call
// override, so there is exactly one route Auth0 ever returns to. This page
// tells the two apart via pendingInvite.ts's sessionStorage flag (AcceptInvitePage
// sets it right before navigating away); when present, it completes the
// SERVER-SIDE bind via acceptInvite() before treating the session as usable —
// a bare handleRedirectCallback() alone only establishes the Auth0-side
// session, it never presents the invite token the platform's token-exchange
// endpoint requires to transition PENDING → ACTIVE.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';

import { useAuth } from '../../auth';
import { authErrorToMessage } from '@vectros-ai/react';
import { readAndClearPendingInviteToken } from '../../lib/pendingInvite';

export function CallbackPage(): React.JSX.Element {
  const { handleRedirectCallback, acceptInvite, isAuthenticated } = useAuth();
  const intl = useIntl();
  const [error, setError] = useState<string | null>(null);
  const [inviteAttemptFailed, setInviteAttemptFailed] = useState(false);
  const [done, setDone] = useState(false);
  // Guards against React StrictMode's dev-only double-invoke of this effect.
  // Live-diagnosed 2026-08-28: an authorization code / PKCE transaction is
  // one-time-use, and without this guard StrictMode's two near-simultaneous
  // invocations both call handleRedirectCallback() and race for that single
  // exchange -- one wins it (a real, successful token exchange), the other
  // loses it and throws, rendering "Sign-in failed" even though sign-in
  // genuinely succeeded moments earlier. (An earlier version of this effect
  // used a `cancelled` flag to suppress a stale run's state updates -- that
  // solves a different problem, silences the WRONG run here, and doesn't
  // stop the losing run's handleRedirectCallback() call from firing in the
  // first place. Dropped rather than layered on top of this guard: with
  // hasRunRef ensuring the work only ever runs once, there is no second,
  // stale run left to suppress, and React 18+ already no-ops a setState
  // after a real unmount without warning, so nothing else to guard here.)
  // A ref, not a plain module-scope flag, so it resets on a genuine remount
  // (e.g. visiting /callback again in the same SPA session) -- useRef's
  // identity persists across StrictMode's simulated remount but is fresh on
  // an actual new mount of this component.
  const hasRunRef = useRef(false);

  useEffect(() => {
    if (hasRunRef.current) return;
    hasRunRef.current = true;
    void (async (): Promise<void> => {
      let isInviteAttempt = false;
      try {
        await handleRedirectCallback();
        const pendingInviteToken = readAndClearPendingInviteToken();
        if (pendingInviteToken) {
          isInviteAttempt = true;
          // Uniform-not-found by design: a bad/expired/already-used token and
          // an email mismatch all surface as the same generic rejection —
          // this flow's own error copy, distinct from plain sign-in's, not a
          // per-cause breakdown either way.
          await acceptInvite!(pendingInviteToken);
        }
      } catch (err) {
        setInviteAttemptFailed(isInviteAttempt);
        setError(isInviteAttempt ? intl.formatMessage({ id: 'acceptInvite.error' }) : authErrorToMessage(intl, err));
      } finally {
        setDone(true);
      }
    })();
    // Runs once on mount only — handleRedirectCallback consumes a one-time
    // authorization code, re-running it on a dependency change would
    // re-attempt an already-spent exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // `&& !error`: Auth0's own exchange (handleRedirectCallback) sets `isAuthenticated` true the
  // moment IT succeeds -- before the server-side acceptInvite() call below even runs. A realistic
  // failure (Auth0 exchange succeeds, but the invite bind fails) therefore reaches `done` with
  // `isAuthenticated` ALREADY true; without this check the redirect below fires first and the
  // error branch never renders at all, silently dropping the invitee onto an empty Home screen
  // with zero indication anything went wrong -- this app's only onboarding path.
  if (done && isAuthenticated && !error) {
    return <Navigate to="/" replace />;
  }

  return (
    <Box
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}
    >
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 360, px: 3, textAlign: 'center' }}>
        {error ? (
          <>
            <Typography variant="h6" component="h1">
              <FormattedMessage id={inviteAttemptFailed ? 'acceptInvite.errorTitle' : 'callback.errorTitle'} />
            </Typography>
            <Alert severity="error" role="alert" sx={{ width: '100%' }}>
              {error}
            </Alert>
            <Button href="/login" variant="contained">
              <FormattedMessage id="callback.backToLogin" />
            </Button>
          </>
        ) : (
          <>
            <CircularProgress />
            <Typography color="text.secondary">
              <FormattedMessage id="callback.completing" />
            </Typography>
          </>
        )}
      </Stack>
    </Box>
  );
}

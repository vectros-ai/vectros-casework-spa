// ---------------------------------------------------------------------------
// AcceptInvitePage — the first-login half of onboarding.
//
// Distinct from LoginPage: this person has NO existing Vectros identity yet —
// that's the whole point of an invite. This page's only job is the "before"
// half of the round trip: read `t=` off the URL, stash it (pendingInvite.ts)
// since nothing survives the upcoming full-page navigation to Auth0 in memory,
// then kick off the same hosted-redirect flow LoginPage uses. The "after" half
// — actually binding the invite once Auth0 returns — happens in CallbackPage,
// which is the single shared redirect target for both plain sign-in and this
// flow.
//
// The invite token is opaque and carries no user-facing content worth
// decoding client-side (unlike some invite flows, there's no inviter name to
// show before the button) — never trust a client-side decode of it for
// anything security-relevant; the server independently re-verifies
// everything at exchange time.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Alert, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';

import { useAuth } from '../../auth';
import { authErrorToMessage } from '@vectros-ai/react';
import { AuthCard } from '@vectros-ai/react';
import { BRAND } from '../../brand';
import { storePendingInviteToken } from '../../lib/pendingInvite';

/** UX-only shape check matching the platform's own `inv_` invite-token
 *  prefix — never security-relevant, purely so a truncated/mangled link
 *  fails with a clear message instead of a confusing round trip through
 *  Auth0 first. */
function looksLikeInviteToken(t: string | null): t is string {
  return typeof t === 'string' && t.startsWith('inv_') && t.length > 4;
}

export function AcceptInvitePage(): React.JSX.Element {
  const { signInWithRedirect, signOut, isAuthenticated, loading, user } = useAuth();
  const [searchParams] = useSearchParams();
  const intl = useIntl();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const token = searchParams.get('t');
  const tokenLooksValid = looksLikeInviteToken(token);

  const handleAccept = async (): Promise<void> => {
    if (!tokenLooksValid) return;
    setError(null);
    setRedirecting(true);
    storePendingInviteToken(token);
    try {
      // Browser navigates away on success, same as LoginPage's handleContinue —
      // this only returns early on a genuine failure to START the redirect.
      await signInWithRedirect();
    } catch (err) {
      setError(authErrorToMessage(intl, err));
      setRedirecting(false);
    }
  };

  // signOut()'s own redirect always lands back on the bare origin (`window.location.origin`,
  // per Auth0AuthProvider), never this page's own `?t=` URL — so unlike handleAccept above,
  // there is nothing useful to stash here; pendingInvite.ts's token is only ever read by
  // CallbackPage, after a real sign-IN redirect completes, not after a plain sign-out. The
  // person needs to re-open the original invite email link once they've signed out — the copy
  // below says so explicitly rather than implying this button alone finishes the job.
  const handleSignOut = async (): Promise<void> => {
    setSigningOut(true);
    await signOut();
  };

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '60vh' }}>
        <CircularProgress aria-label={intl.formatMessage({ id: 'layout.loadingSession' })} />
      </Stack>
    );
  }
  // Already signed in (e.g. this link was opened in a tab/browser with a live session from a
  // DIFFERENT account) — regression guard: silently redirecting to "/" here used to drop the
  // invite with no explanation at all, indistinguishable from a real failure. Explain what
  // happened and offer a real way forward instead.
  if (isAuthenticated) {
    return (
      <AuthCard
        brandName={BRAND.productName}
        title={intl.formatMessage({ id: 'acceptInvite.title' })}
        subtitle={intl.formatMessage({ id: 'acceptInvite.alreadySignedInSubtitle' })}
      >
        <Stack spacing={2}>
          <Alert severity="info" role="status">
            <FormattedMessage
              id="acceptInvite.alreadySignedIn"
              values={{ email: user?.email ?? intl.formatMessage({ id: 'acceptInvite.unknownAccount' }) }}
            />
          </Alert>
          <Typography variant="body2" color="text.secondary">
            <FormattedMessage id="acceptInvite.alreadySignedInHint" />
          </Typography>
          <Button
            type="button"
            variant="contained"
            size="large"
            fullWidth
            disabled={signingOut}
            onClick={handleSignOut}
            startIcon={signingOut ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            <FormattedMessage id={signingOut ? 'login.redirecting' : 'acceptInvite.signOutCta'} />
          </Button>
        </Stack>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      brandName={BRAND.productName}
      title={intl.formatMessage({ id: 'acceptInvite.title' })}
      subtitle={intl.formatMessage({ id: 'acceptInvite.subtitle' }, { productName: BRAND.productName })}
    >
      <Stack spacing={2}>
        {!tokenLooksValid && (
          <Alert severity="error" role="alert">
            <FormattedMessage id="acceptInvite.missingToken" />
          </Alert>
        )}
        {error && (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        )}
        <Button
          type="button"
          variant="contained"
          size="large"
          fullWidth
          disabled={!tokenLooksValid || redirecting}
          onClick={handleAccept}
          startIcon={redirecting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          <FormattedMessage id={redirecting ? 'login.redirecting' : 'acceptInvite.cta'} />
        </Button>
      </Stack>
    </AuthCard>
  );
}

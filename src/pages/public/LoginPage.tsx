// ---------------------------------------------------------------------------
// LoginPage — kicks off Auth0 Universal Login.
//
// Under hosted-redirect auth, this page owns none of the sign-in ceremony
// itself (no email/password form, no MFA challenge UI) — Auth0's own hosted
// pages own that end to end. This page's only job is:
//   1. If a session already exists, skip the button and go straight where
//      the user was headed.
//   2. Otherwise, offer a single "Continue" action that navigates the whole
//      browser away to Auth0.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Navigate, useLocation } from 'react-router';
import { Alert, Button, CircularProgress, Stack } from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';

import { useAuth } from '../../auth';
import { authErrorToMessage } from '@vectros-ai/react';
import { AuthCard } from '@vectros-ai/react';
import { BRAND } from '../../brand';
import type { LocationFromState } from '../../lib/routerTypes';

export function LoginPage(): React.JSX.Element {
  const { signInWithRedirect, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const intl = useIntl();
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const fromState = location.state as LocationFromState | null;
  const fromPath = fromState?.from?.pathname ?? '/';

  const handleContinue = async (): Promise<void> => {
    setError(null);
    setRedirecting(true);
    try {
      // The browser navigates away on success — this only ever returns early
      // (without navigating) on a genuine failure to START the redirect
      // (network error, misconfigured Auth0 client), so re-enabling the
      // button in that case is correct and not a race with the navigation.
      await signInWithRedirect();
    } catch (err) {
      setError(authErrorToMessage(intl, err));
      setRedirecting(false);
    }
  };

  if (loading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '60vh' }}>
        <CircularProgress aria-label={intl.formatMessage({ id: 'layout.loadingSession' })} />
      </Stack>
    );
  }
  if (isAuthenticated) {
    return <Navigate to={fromPath} replace />;
  }

  return (
    <AuthCard
      brandName={BRAND.productName}
      title={intl.formatMessage({ id: 'login.title' })}
      subtitle={intl.formatMessage({ id: 'login.subtitle' }, { productName: BRAND.productName })}
    >
      <Stack spacing={2}>
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
          disabled={redirecting}
          onClick={handleContinue}
          startIcon={redirecting ? <CircularProgress size={16} color="inherit" /> : undefined}
        >
          <FormattedMessage id={redirecting ? 'login.redirecting' : 'login.cta'} />
        </Button>
      </Stack>
    </AuthCard>
  );
}

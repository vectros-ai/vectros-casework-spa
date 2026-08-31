// ---------------------------------------------------------------------------
// AccountPage — the user's own account: who they are, and the two
// self-service actions Auth0 supports without this app needing a backend.
//
// **Password.** A direct call to Auth0's own `/dbconnections/change_password`
// endpoint (api/changePassword.ts) — sends Auth0's own hosted reset email;
// this app never sees or handles a password. Only shown for a DATABASE-
// connection user (`user.sub` prefixed `auth0|`, Auth0's own documented
// convention — see that field's own doc comment on AuthUser). A social or
// enterprise-connection user's password (if any) is owned by their identity
// provider, not Auth0, so there's nothing for this button to do — the page
// explains that instead of showing a button that would just fail.
//
// **Two-factor authentication.** Re-running sign-in (`signInWithRedirect`,
// the exact same call `LoginPage` makes) is the whole mechanism: Auth0's own
// hosted Universal Login shows whatever MFA enrollment/verification/
// management screen the TENANT is configured for, then returns to the app.
// This app deliberately does NOT build its own MFA UI — Auth0 already hosts
// one, and building a second would mean keeping it in sync with whatever the
// tenant's own policy allows. If the tenant has no MFA policy configured,
// clicking this is a harmless no-op re-login; `docs/AUTH0-SETUP.md` covers
// turning MFA on, and the newer Auth0 My Account API (self-service factor
// list/remove, currently Early Access) as a future upgrade path once
// available on a given tenant.
//
// **Lands back on Home, not back on this page.** `signInWithRedirect` accepts a `returnTo`,
// but nothing in this app's redirect chain actually restores it —
// `CallbackPage.tsx` always navigates to `/` on a successful callback (a documented, deliberate
// simplification — see that file's own header comment on why a deep-link return path isn't
// carried across the Auth0 redirect hop). Passing `returnTo: '/account'` here would silently do
// nothing, so this deliberately doesn't pass one rather than promise a round trip this app
// doesn't implement.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation } from '@tanstack/react-query';
import { LoadingBlock, SubmitButton } from '@vectros-ai/react';

import { useAuth } from '../../auth';
import { requestPasswordChange } from '../../api/changePassword';
import { SuccessAlert } from '../../components/SuccessAlert';

/** Auth0's own documented `sub` claim convention: `<connection-strategy>|<user-id>`.
 *  A database connection is always `auth0|...`; every other strategy (social, enterprise
 *  SAML/OIDC, custom) uses its own non-`auth0` prefix. See
 *  https://auth0.com/docs/secure/tokens/json-web-tokens/json-web-token-claims. */
function isDatabaseConnectionUser(sub: string): boolean {
  return sub.startsWith('auth0|');
}

export function AccountPage(): React.JSX.Element {
  const intl = useIntl();
  const { user, loading, signInWithRedirect } = useAuth();
  const [mfaRedirecting, setMfaRedirecting] = useState(false);

  const passwordMutation = useMutation({
    mutationFn: () => requestPasswordChange(user?.email ?? ''),
  });

  const handleManageMfa = (): void => {
    setMfaRedirecting(true);
    // No `returnTo` -- see this file's own header comment: nothing in the redirect chain
    // actually restores it today, so passing one here would just be a promise this app can't
    // keep. Never resolves on success — the browser navigates away. Only reachable on a
    // synchronous throw (e.g. popup/redirect blocked), which SubmitButton's `pending`
    // prop needs an actual settle for, so undo the pending state on that path only.
    void signInWithRedirect().catch(() => setMfaRedirecting(false));
  };

  const backButton = (
    <Button component={RouterLink} to="/" startIcon={<ArrowBack />} size="small" sx={{ alignSelf: 'flex-start' }}>
      <FormattedMessage id="account.back" />
    </Button>
  );

  if (loading) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'account.loading' })} />
      </Stack>
    );
  }
  if (!user) {
    // Unreachable in practice once `loading` clears (this route sits behind RequireAuth),
    // but keeps the component total rather than reading `user.email`/`user.sub` through a
    // null check at every call site below.
    return <Stack spacing={3}>{backButton}</Stack>;
  }

  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
  const canChangePassword = isDatabaseConnectionUser(user.sub);

  return (
    <Stack spacing={3}>
      {backButton}

      <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
        <FormattedMessage id="account.title" />
      </Typography>

      <Card>
        <CardContent>
          <Stack spacing={1}>
            <Typography variant="h6" component="h2">
              <FormattedMessage id="account.profileTitle" />
            </Typography>
            {fullName && <Typography variant="body1">{fullName}</Typography>}
            <Typography variant="body2" color="text.secondary">
              {user.email}
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Box>
              <Typography variant="h6" component="h2">
                <FormattedMessage id="account.passwordTitle" />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage
                  id={canChangePassword ? 'account.passwordBody' : 'account.passwordExternalBody'}
                />
              </Typography>
            </Box>

            {passwordMutation.isError && (
              <Alert severity="error" role="alert">
                <FormattedMessage id="account.passwordError" />
                {/* NOT extractErrorMessage -- this call never goes through vectrosApiClient() (see
                    changePassword.ts's own header comment), so the thrown error has no `.body` for
                    extractErrorMessage to read; it would always return undefined here. The detail
                    Auth0 actually gave us is already in the plain Error's own .message. */}
                {passwordMutation.error instanceof Error && passwordMutation.error.message && (
                  <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                    {passwordMutation.error.message}
                  </Typography>
                )}
              </Alert>
            )}
            {passwordMutation.isSuccess && (
              <SuccessAlert onDismiss={() => passwordMutation.reset()}>
                <FormattedMessage id="account.passwordSuccess" />
              </SuccessAlert>
            )}

            {canChangePassword && (
              <SubmitButton
                variant="outlined"
                pending={passwordMutation.isPending}
                disabled={passwordMutation.isSuccess}
                onClick={() => passwordMutation.mutate()}
              >
                <FormattedMessage id="account.passwordCta" />
              </SubmitButton>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack spacing={2} alignItems="flex-start">
            <Box>
              <Typography variant="h6" component="h2">
                <FormattedMessage id="account.mfaTitle" />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage id="account.mfaBody" />
              </Typography>
            </Box>
            <SubmitButton variant="outlined" pending={mfaRedirecting} onClick={handleManageMfa}>
              <FormattedMessage id="account.mfaCta" />
            </SubmitButton>
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}

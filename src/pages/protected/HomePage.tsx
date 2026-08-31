// ---------------------------------------------------------------------------
// HomePage — the signed-in landing page.
//
// This used to be a placeholder that only proved the sign-in + token-exchange
// chain worked (mint a Vectros partner-API bearer, report success/failure) —
// useful while there was nothing else to land on, but not a real landing
// screen once a caller can actually reach Cases/Orgs. Now it's a role-aware
// dashboard: an open-cases count linking to Cases, and the caller's own
// accessible orgs (founder + member, via `useAccessibleOrgs` — the same
// discovery wired into CreateCaseDialog/TeamPage's InviteDialog) with a
// "create your first org" prompt for a caller who can found one but hasn't
// yet. Nothing here is role-branched by NAME (case-handler vs hr-admin) —
// it's branched by the SAME scope-actions the nav/routes already gate on
// (`scopeActions.ts`), so a caller sees exactly the shortcuts they can
// actually use, the same discipline `App.tsx`'s nav already follows.
//
// The token-exchange smoke check is kept, demoted to a secondary
// "Connection" section — still useful as a first-run diagnostic for anyone
// forking this app, just no longer the whole page.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActions,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';
import { useQuery } from '@tanstack/react-query';

import { getVectrosApiToken } from '@vectros-ai/react';
import { useAuth, useScopeGate } from '../../auth';
import { EXCHANGE_RESOLVED_TENANT } from '../../api/vectrosApi';
import { vectrosApiClient } from '../../api/vectrosApi';
import { dataQueryKeys } from '../../lib/dataQueryKeys';
import { drainPages } from '../../lib/drainPages';
import { CASES_ACTION, ORGS_ACTION } from '../../lib/scopeActions';
import { useAccessibleOrgs } from '../../hooks/useAccessibleOrgs';

export function HomePage(): React.JSX.Element {
  const { user } = useAuth();
  const { can: canPerformAction, identity } = useScopeGate();
  const intl = useIntl();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ readonly ok: boolean; readonly message: string } | null>(
    null,
  );

  const myUserId = identity.partnerUserId;
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';
  const canReachCases = canPerformAction(CASES_ACTION);
  // The org-FOUNDING action, not just "can read an org" — this is what gates
  // the "create your first org" prompt below, same floor App.tsx's own nav
  // item uses for the Orgs link, so the prompt only ever appears for a
  // caller who could actually follow through on it.
  const canFoundOrg = canPerformAction(ORGS_ACTION);

  const openCasesQuery = useQuery({
    queryKey: dataQueryKeys.cases('open'),
    // Drained to completion, not a single un-paged call — see drainPages.ts's own header. This
    // feeds a COUNT, not a list, so an un-paged call wouldn't drop rows silently the way a list
    // would — it would instead show a confidently wrong number (capped at the page size) once the
    // real count passed 20, which is worse: nothing about "20" on screen hints it's a ceiling.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().records.lookupRecords({
          type: 'case',
          field: 'status,assignedTo',
          values: ['open'],
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: hasUserId && canReachCases,
  });
  const openCaseCount = openCasesQuery.data?.length;

  const accessibleOrgs = useAccessibleOrgs(hasUserId ? myUserId : undefined, true);
  const orgNames = accessibleOrgs.orgs
    .map((o) => (o.name && o.name.length > 0 ? o.name : o.externalId))
    .filter((n): n is string => typeof n === 'string' && n.length > 0);

  const handleCheckConnection = async (): Promise<void> => {
    setChecking(true);
    setResult(null);
    try {
      await getVectrosApiToken(EXCHANGE_RESOLVED_TENANT);
      setResult({ ok: true, message: intl.formatMessage({ id: 'home.tokenCheckOk' }) });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setResult({
        ok: false,
        message: `${intl.formatMessage({ id: 'home.tokenCheckError' })}: ${detail}`,
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          <FormattedMessage id="home.title" />
        </Typography>
        {user && (
          <Typography color="text.secondary">
            <FormattedMessage id="home.signedInAs" /> {user.email}
          </Typography>
        )}
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
        {canReachCases && (
          <Card sx={{ flex: 1 }}>
            <CardContent>
              <Typography variant="overline" color="text.secondary">
                <FormattedMessage id="home.casesCardTitle" />
              </Typography>
              {openCasesQuery.isPending ? (
                <CircularProgress size={20} sx={{ display: 'block', mt: 1 }} />
              ) : openCasesQuery.isError ? (
                // MUI's Typography has no implicit ARIA role — set one explicitly, same
                // discipline this file's own Connection Alert below already follows.
                <Typography variant="body2" color="text.secondary" role="alert" sx={{ mt: 1 }}>
                  <FormattedMessage id="home.casesCardError" />
                </Typography>
              ) : (
                <Typography variant="h4" sx={{ mt: 1 }}>
                  {openCaseCount ?? 0}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage id="home.casesCardSubtitle" />
              </Typography>
            </CardContent>
            <CardActions>
              <Button component={RouterLink} to="/cases" size="small">
                <FormattedMessage id="home.casesCardCta" />
              </Button>
            </CardActions>
          </Card>
        )}

        <Card sx={{ flex: 1 }}>
          <CardContent>
            <Typography variant="overline" color="text.secondary">
              <FormattedMessage id="home.orgsCardTitle" />
            </Typography>
            {accessibleOrgs.isPending ? (
              <CircularProgress size={20} sx={{ display: 'block', mt: 1 }} />
            ) : accessibleOrgs.isError ? (
              <Typography variant="body2" color="text.secondary" role="alert" sx={{ mt: 1 }}>
                <FormattedMessage id="home.orgsCardError" />
              </Typography>
            ) : orgNames.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                <FormattedMessage id={canFoundOrg ? 'home.orgsCardEmptyCanCreate' : 'home.orgsCardEmpty'} />
              </Typography>
            ) : (
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
                {orgNames.map((name) => (
                  <Chip key={name} label={name} size="small" />
                ))}
              </Stack>
            )}
          </CardContent>
          {canFoundOrg && (
            <CardActions>
              <Button component={RouterLink} to="/orgs" size="small">
                <FormattedMessage id={orgNames.length === 0 ? 'home.orgsCardCreateCta' : 'home.orgsCardManageCta'} />
              </Button>
            </CardActions>
          )}
        </Card>
      </Stack>

      <Divider />

      <Stack spacing={2} alignItems="flex-start">
        <Typography variant="subtitle2" color="text.secondary">
          <FormattedMessage id="home.connectionTitle" />
        </Typography>
        <Button
          variant="outlined"
          onClick={handleCheckConnection}
          disabled={checking}
          startIcon={checking ? <CircularProgress size={16} /> : undefined}
        >
          <FormattedMessage id={checking ? 'home.tokenCheckChecking' : 'home.tokenCheckCta'} />
        </Button>
        {result && (
          // MUI's Alert has NO implicit ARIA role (same note as ApiErrorAlert's own) — every
          // error/status surface in this app sets one explicitly rather than relying on a default
          // that doesn't exist.
          <Alert
            severity={result.ok ? 'success' : 'error'}
            role={result.ok ? 'status' : 'alert'}
            sx={{ width: '100%' }}
          >
            {result.message}
          </Alert>
        )}
      </Stack>
    </Stack>
  );
}

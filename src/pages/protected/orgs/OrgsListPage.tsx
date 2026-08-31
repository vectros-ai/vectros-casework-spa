// ---------------------------------------------------------------------------
// OrgsListPage — Org management, screen 1 of 2 (list + create).
//
// Lists every org the signed-in HR admin FOUNDED and lets them found another.
// Founding an org is the self-service onboarding path this app is built to
// showcase: an admin spins up their own employer org, and its case-management
// data compartment, without anyone else touching a blueprint or a database.
//
// **Founder-only, for now.** An org an admin was INVITED into (rather than
// founded) would also belong on this screen, badged distinctly from a
// founded one — but reaching that set depends on a team/invite flow this app
// doesn't build yet, so there is currently no way for a caller's session to
// ever hold one. Every row here is a founded org; the founder badge is
// rendered for forward compatibility with that later addition, not because
// today's caller could be shown anything else.
//
// Founding writes two things in one call: the org identity entity itself
// (name) and its bound `org_profile` schema payload (industry/headquarters/
// employee count) — the SAME generic schema-driven form the case screens use,
// demonstrating that a schema can govern an identity entity's payload just as
// well as a record's.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiErrorAlert,
  LoadingBlock,
  RecordFormFields,
  SubmitButton,
  coerceFieldValue,
  extractErrorMessage,
  isReservedPayloadKey,
  stripReservedPayloadKeys,
  validateFields,
  withField,
} from '@vectros-ai/react';
import type { Vectros } from '@vectros-ai/sdk';

import { useScopeGate } from '../../../auth';
import { CASEWORK_CONTEXT_ID, vectrosApiClient } from '../../../api/vectrosApi';
import type { EntityResponse } from '../../../api/vectrosApi';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { RefreshIconButton } from '../../../components/RefreshIconButton';
import { EmptyStateCard } from '../../../components/EmptyStateCard';
import { ORGS_ACTION } from '../../../lib/scopeActions';
import { useTouchedFieldErrors } from '../../../lib/useTouchedFieldErrors';
import { drainPages } from '../../../lib/drainPages';

const ORG_PROFILE_TYPE_NAME = 'org_profile';

/** A fresh, per-org identifier — this app's own idempotency key, never shown
 *  to the user (the org's `name` is the human-facing identifier). */
function generateExternalId(): string {
  return `org_${crypto.randomUUID()}`;
}

interface CreateOrgDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (org: EntityResponse) => void;
}

function CreateOrgDialog({ open, onClose, onCreated }: CreateOrgDialogProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [payload, setPayload] = useState<Record<string, unknown>>({});

  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schemaByType(ORG_PROFILE_TYPE_NAME),
    queryFn: async () =>
      (
        await vectrosApiClient().schemas.listSchemas({
          recordType: ORG_PROFILE_TYPE_NAME,
          surface: 'entity',
        })
      ).data?.[0],
    enabled: open,
  });
  const schemaFields: ReadonlyArray<Vectros.FieldDef> = (schemaQuery.data?.fields ?? []).filter(
    (f) => !isReservedPayloadKey(f.fieldId),
  );
  const fieldErrors = validateFields(schemaFields, payload);
  const { visibleErrors, markTouched, reset: resetTouched } = useTouchedFieldErrors(fieldErrors);

  const handleFieldChange = (field: Vectros.FieldDef, input: string | boolean): void => {
    setPayload((prev) => withField(prev, field.fieldId, coerceFieldValue(field, input)));
    markTouched(field.fieldId);
  };

  const handleClose = (): void => {
    if (createMutation.isPending) return;
    setName('');
    setPayload({});
    resetTouched();
    createMutation.reset();
    onClose();
  };

  const createMutation = useMutation({
    mutationFn: async (): Promise<EntityResponse> => {
      const schema = schemaQuery.data;
      if (!schema?.id) throw new Error('org_profile schema not resolved');
      return vectrosApiClient().identity.createEntity({
        namespace: 'org',
        contextId: CASEWORK_CONTEXT_ID,
        body: {
          externalId: generateExternalId(),
          name: name.trim(),
          schemaId: schema.id,
          payload: stripReservedPayloadKeys(payload),
        },
      });
    },
    onSuccess: (org) => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.orgsFounded() });
      setName('');
      setPayload({});
      resetTouched();
      onCreated(org);
    },
  });

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName !== '' &&
    Object.keys(fieldErrors).length === 0 &&
    typeof schemaQuery.data?.id === 'string' &&
    !createMutation.isPending;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <FormattedMessage id="orgs.createTitle" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {schemaQuery.isPending && (
            <LoadingBlock label={intl.formatMessage({ id: 'orgs.loadingSchema' })} />
          )}
          {schemaQuery.isError && (
            <ApiErrorAlert error={schemaQuery.error}>
              <FormattedMessage id="orgs.schemaError" />
            </ApiErrorAlert>
          )}
          {createMutation.isError && (
            <ApiErrorAlert error={createMutation.error}>
              <FormattedMessage id="orgs.createError" />
              {extractErrorMessage(createMutation.error) && (
                <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                  {extractErrorMessage(createMutation.error)}
                </Typography>
              )}
            </ApiErrorAlert>
          )}
          {schemaQuery.isSuccess && (
            <>
              <TextField
                label={intl.formatMessage({ id: 'orgs.fieldName' })}
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                size="small"
              />
              <RecordFormFields
                fields={schemaFields}
                value={payload}
                errors={visibleErrors}
                renderHints={schemaQuery.data?.renderHints}
                onChange={handleFieldChange}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={createMutation.isPending}>
          <FormattedMessage id="orgs.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          disabled={!canSubmit}
          pending={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <FormattedMessage id="orgs.createCta" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}

export function OrgsListPage(): React.JSX.Element {
  const intl = useIntl();
  const navigate = useNavigate();
  const { identity, can: canPerformAction, loading: scopeLoading } = useScopeGate();
  const [createOpen, setCreateOpen] = useState(false);

  // The founder-enumeration call (`GET /v1/entities/org?userId=`) needs the
  // caller's OWN Vectros user id — the platform's `${{ self.userId }}` —
  // which is NOT the Auth0 `sub` useAuth() exposes. It's the `partnerUserId`
  // the exchanged token's own `scope.identity` claim carries (see
  // useScopeGate's doc). Absent only while the gate is still loading.
  const myUserId = identity.partnerUserId;

  const hasUserId = typeof myUserId === 'string' && myUserId !== '';
  const orgsQuery = useQuery({
    queryKey: dataQueryKeys.orgsFounded(),
    queryFn: () => {
      if (!hasUserId) throw new Error('myUserId not resolved'); // unreachable — guarded by `enabled`
      // Drained to completion, not a single un-paged call — `listEntities` defaults to a 20-item
      // page (same SDK-documented default `fetchAllCasesForOrg` drains around for cases), so a
      // founder with more than 20 orgs would otherwise silently lose everything past the first
      // page. See drainPages.ts's own header for why this can't stop on a short/empty page.
      return drainPages((startFrom) =>
        vectrosApiClient().identity.listEntities({
          namespace: 'org',
          contextId: CASEWORK_CONTEXT_ID,
          userId: myUserId,
          ...(startFrom ? { startFrom } : {}),
        }),
      );
    },
    enabled: hasUserId,
  });
  const orgs = orgsQuery.data ?? [];

  // Same action `App.tsx`'s nav item and route both gate on (`lib/scopeActions.ts`) — imported
  // rather than re-typed, so this can't independently drift from the floor that already decided
  // whether this caller could reach this screen at all.
  const canCreate = canPerformAction(ORGS_ACTION);

  const handleCreated = (org: EntityResponse): void => {
    setCreateOpen(false);
    // Navigate straight to the new org's own detail page -- matches CasesListPage's own
    // create-flow pattern. "+ Create" used to resolve success three different ways across the
    // app; this and ClientsListPage's create both closed silently with no feedback at all, so
    // the only sign anything happened was scanning the table for a new row. If the platform
    // didn't hand back an id (shouldn't happen), fall back to the list.
    if (org.id) navigate(`/orgs/${encodeURIComponent(org.id)}`);
  };

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems="flex-start"
        justifyContent="space-between"
        spacing={2}
      >
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
            <FormattedMessage id="orgs.title" />
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            <FormattedMessage id="orgs.subtitle" />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <RefreshIconButton onRefresh={() => void orgsQuery.refetch()} isRefreshing={orgsQuery.isFetching} />
          <Tooltip
            title={
              !canCreate && !scopeLoading ? intl.formatMessage({ id: 'orgs.createForbidden' }) : ''
            }
          >
            <span style={{ flexShrink: 0 }}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateOpen(true)}
                disabled={!canCreate}
                sx={{ whiteSpace: 'nowrap' }}
              >
                <FormattedMessage id="orgs.createButton" />
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {(scopeLoading || (hasUserId && orgsQuery.isPending)) && !orgsQuery.isError && (
        <LoadingBlock label={intl.formatMessage({ id: 'orgs.loading' })} />
      )}

      {orgsQuery.isError && (
        <ApiErrorAlert error={orgsQuery.error}>
          <FormattedMessage id="orgs.loadError" />
        </ApiErrorAlert>
      )}

      {!scopeLoading && hasUserId && !orgsQuery.isPending && !orgsQuery.isError && orgs.length === 0 && (
        <EmptyStateCard messageId="orgs.empty" />
      )}

      {orgs.length > 0 && (
        <TableContainer component={Paper}>
          <Table aria-label={intl.formatMessage({ id: 'orgs.title' })}>
            <TableHead>
              <TableRow>
                <TableCell>
                  <FormattedMessage id="orgs.columnName" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="orgs.columnRole" />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {orgs.map((org, idx) => {
                const rowKey = org.id ?? org.externalId ?? `row-${idx}`;
                return (
                  <TableRow key={rowKey} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/orgs/${encodeURIComponent(org.id ?? '')}`}>
                        {org.name && org.name.length > 0 ? org.name : org.externalId}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Chip label={intl.formatMessage({ id: 'orgs.badgeFounder' })} size="small" />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {!scopeLoading && !hasUserId && (
        <Alert severity="warning" role="alert">
          <FormattedMessage id="orgs.noIdentity" />
        </Alert>
      )}

      <CreateOrgDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </Stack>
  );
}

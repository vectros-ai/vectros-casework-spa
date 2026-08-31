// ---------------------------------------------------------------------------
// ClientsListPage — client management, screen 1 of 2 (list + create),
// following the exact Orgs pattern: list with a create button, a
// schema-driven create form
// (`client_profile`, mirroring `org_profile`), a detail screen for edit.
//
// **Org-scoped, not a flat global list.** A client always belongs to one
// org (`scope:org:<id>`), and this app's caller can belong to more than one
// (`useAccessibleOrgs`) — the same shared `OrgPickerField` `CreateCaseDialog`/
// `TeamPage`'s `InviteDialog` also use: an editable select for more than one
// org, a disabled field naming it for exactly one, so a single-org caller
// never sees UI for a choice they don't have, but the org is never silently
// implied either.
//
// **Who sees what client is the actual point of this screen, not an
// afterthought.** `useAccessibleClients` unions org-wide reach (hr-admin)
// with founder/member discovery (either role) — a case-handler here sees
// only clients they founded or were granted `client_membership` on, per the
// data-isolation pass this same item C shipped. See that hook's own header
// comment for the full mechanism.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import AddIcon from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
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
import { OrgPickerField } from '../../../components/OrgPickerField';
import { useAccessibleOrgs } from '../../../hooks/useAccessibleOrgs';
import { useAccessibleClients } from '../../../hooks/useAccessibleClients';
import { CLIENTS_ACTION } from '../../../lib/scopeActions';
import { useTouchedFieldErrors } from '../../../lib/useTouchedFieldErrors';

const CLIENT_PROFILE_TYPE_NAME = 'client_profile';

/** A fresh, per-client identifier — mirrors `createCase.ts`'s own
 *  `generateClientExternalId`, kept separate since this screen creates a
 *  client with no case attached at all (this file has no reason to import
 *  `api/createCase.ts` just for one id-generation helper). */
function generateClientExternalId(): string {
  return `client_${crypto.randomUUID()}`;
}

interface CreateClientDialogProps {
  readonly open: boolean;
  readonly orgId: string;
  /** The caller's own user id, when resolved — `entities:c:client` is granted org-wide to BOTH
   *  roles (`scopeActions.ts`), so a case-handler can create a client here too. Without this, the
   *  broad `clientsForOrg` invalidation below refreshes a list they have no read reach on (their
   *  own `entities:r:client` is founder/member-narrowed as of this pass) — the new client would be
   *  silently absent from THEIR OWN list until an unrelated cache eviction. Same bug shape, same
   *  fix `CasesListPage.tsx`'s own `CreateCaseDialog` already applies for its "new client" path. */
  readonly myUserId: string | undefined;
  readonly onClose: () => void;
  readonly onCreated: (client: EntityResponse) => void;
}

function CreateClientDialog({ open, orgId, myUserId, onClose, onCreated }: CreateClientDialogProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [payload, setPayload] = useState<Record<string, unknown>>({});

  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schemaByType(CLIENT_PROFILE_TYPE_NAME),
    queryFn: async () =>
      (
        await vectrosApiClient().schemas.listSchemas({
          recordType: CLIENT_PROFILE_TYPE_NAME,
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
      if (!schema?.id) throw new Error('client_profile schema not resolved');
      return vectrosApiClient().identity.createEntity({
        namespace: 'client',
        contextId: CASEWORK_CONTEXT_ID,
        body: {
          externalId: generateClientExternalId(),
          name: name.trim(),
          schemaId: schema.id,
          payload: stripReservedPayloadKeys(payload),
          scopes: [`org:${orgId}`],
        },
      });
    },
    onSuccess: (client) => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientsForOrg(orgId) });
      if (typeof myUserId === 'string' && myUserId !== '') {
        void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientsFoundedBy(myUserId) });
      }
      setName('');
      setPayload({});
      resetTouched();
      onCreated(client);
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
        <FormattedMessage id="clients.createTitle" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {schemaQuery.isPending && (
            <LoadingBlock label={intl.formatMessage({ id: 'clients.loadingSchema' })} />
          )}
          {schemaQuery.isError && (
            <ApiErrorAlert error={schemaQuery.error}>
              <FormattedMessage id="clients.schemaError" />
            </ApiErrorAlert>
          )}
          {createMutation.isError && (
            <ApiErrorAlert error={createMutation.error}>
              <FormattedMessage id="clients.createError" />
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
                label={intl.formatMessage({ id: 'clients.fieldName' })}
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
          <FormattedMessage id="clients.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          disabled={!canSubmit}
          pending={createMutation.isPending}
          onClick={() => createMutation.mutate()}
        >
          <FormattedMessage id="clients.createCta" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}

export function ClientsListPage(): React.JSX.Element {
  const intl = useIntl();
  const navigate = useNavigate();
  const { identity, can: canPerformAction, loading: scopeLoading } = useScopeGate();
  const myUserId = identity.partnerUserId;
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const orgsQuery = useAccessibleOrgs(hasUserId ? myUserId : undefined, true);
  const orgs = orgsQuery.orgs;
  const needsOrgPicker = orgs.length > 1;
  const effectiveOrgId = needsOrgPicker ? selectedOrgId : (orgs[0]?.id ?? '');

  const clientsQuery = useAccessibleClients(effectiveOrgId, hasUserId ? myUserId : undefined, true);
  const clients = clientsQuery.clients;

  // Same floor App.tsx's nav item and route both gate on — see this pass's own scopeActions.ts note.
  const canCreate = canPerformAction(CLIENTS_ACTION);

  const handleCreated = (client: EntityResponse): void => {
    setCreateOpen(false);
    // Navigate straight to the new client's own detail page -- see OrgsListPage's identical fix
    // for the full rationale.
    if (client.id) navigate(`/clients/${encodeURIComponent(client.id)}`);
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
            <FormattedMessage id="clients.title" />
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            <FormattedMessage id="clients.subtitle" />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <RefreshIconButton onRefresh={clientsQuery.refetch} isRefreshing={clientsQuery.isFetching} />
          <Tooltip
            title={
              !canCreate && !scopeLoading ? intl.formatMessage({ id: 'clients.createForbidden' }) : ''
            }
          >
            <span style={{ flexShrink: 0 }}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setCreateOpen(true)}
                disabled={!canCreate || effectiveOrgId === ''}
                sx={{ whiteSpace: 'nowrap' }}
              >
                <FormattedMessage id="clients.createButton" />
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      <OrgPickerField
        orgs={orgs}
        value={selectedOrgId}
        onChange={setSelectedOrgId}
        labelId="clients.fieldOrg"
        sx={{ maxWidth: 320 }}
      />

      {(scopeLoading || orgsQuery.isPending || (effectiveOrgId !== '' && clientsQuery.isPending)) &&
        !clientsQuery.isError && <LoadingBlock label={intl.formatMessage({ id: 'clients.loading' })} />}

      {clientsQuery.isError && (
        <ApiErrorAlert error={clientsQuery.error}>
          <FormattedMessage id="clients.loadError" />
        </ApiErrorAlert>
      )}

      {needsOrgPicker && selectedOrgId === '' && !orgsQuery.isPending && (
        <Alert severity="info">
          <FormattedMessage id="clients.pickOrgPrompt" />
        </Alert>
      )}

      {!scopeLoading &&
        effectiveOrgId !== '' &&
        !clientsQuery.isPending &&
        !clientsQuery.isError &&
        clients.length === 0 && <EmptyStateCard messageId="clients.empty" />}

      {clients.length > 0 && (
        <TableContainer component={Paper}>
          <Table aria-label={intl.formatMessage({ id: 'clients.title' })}>
            <TableHead>
              <TableRow>
                <TableCell>
                  <FormattedMessage id="clients.columnName" />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {clients.map((client, idx) => {
                const rowKey = client.id ?? client.externalId ?? `row-${idx}`;
                return (
                  <TableRow key={rowKey} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/clients/${encodeURIComponent(client.id ?? '')}`}>
                        {client.name && client.name.length > 0 ? client.name : client.externalId}
                      </Link>
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
          <FormattedMessage id="clients.noIdentity" />
        </Alert>
      )}

      <CreateClientDialog
        open={createOpen}
        orgId={effectiveOrgId}
        myUserId={hasUserId ? myUserId : undefined}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </Stack>
  );
}

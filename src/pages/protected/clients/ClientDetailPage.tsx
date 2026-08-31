// ---------------------------------------------------------------------------
// ClientDetailPage — client management, screen 2 of 2 (edit + archive +
// members).
//
// **Archive, not delete — deliberately, not a scope cut.** There is no
// `entities:d:client` grant anywhere in this blueprint: deleting a client
// while cases/notes/documents still reference it via `scope:client:<id>`
// would orphan them, and there's no composed/transactional endpoint to
// cascade the delete safely (`createCase.ts`'s own header comment documents
// the same platform gap for the create path). Archiving uses the entity's
// own platform-native `status` field (`ACTIVE`/`SUSPENDED` — see
// `client_profile`'s schema comment) instead — an ordinary `entities:u:client`
// update, no new grant, no cascade.
//
// **Members section — `hr-admin`-only, gated on `records:c:client_membership`
// (the only role holding write on that schema at all).** This is what makes
// this pass's `entities:r:client` narrowing (founder-or-member) usable for a
// case-handler who didn't found this client — see `useAccessibleClients`'s
// own header comment for the discovery side, `assignClientMembership.ts` for
// the write side.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  MenuItem,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiErrorAlert,
  ConfirmDialog,
  LoadingBlock,
  RecordFormFields,
  RequestIdCaption,
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
import type { RecordResponse } from '../../../api/vectrosApi';
import {
  assignClientMembership,
  type ClientMembershipLevel,
} from '../../../api/assignClientMembership';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { useTouchedFieldErrors } from '../../../lib/useTouchedFieldErrors';
import { useOrgName } from '../../../hooks/useOrgName';
import { SuccessAlert } from '../../../components/SuccessAlert';
import { drainPages } from '../../../lib/drainPages';

const CLIENT_PROFILE_TYPE_NAME = 'client_profile';
const MEMBERSHIP_LEVELS: ReadonlyArray<ClientMembershipLevel> = ['member', 'admin'];

function orgIdFromScopes(scopes: readonly string[] | undefined): string | undefined {
  const orgScope = (scopes ?? []).find((s) => s.startsWith('org:'));
  return orgScope?.slice('org:'.length);
}

interface AssignMemberDialogProps {
  readonly open: boolean;
  readonly orgId: string;
  readonly clientId: string;
  /** `targetUserId`s already holding a `client_membership` row on this client — excluded from the
   *  picker so an admin can't create a duplicate row for the same person (review finding,
   *  2026-08-28: nothing previously stopped this; a duplicate rendered as two indistinguishable
   *  rows in the Members table, keyed on the record's own `id`, not `targetUserId`). */
  readonly existingMemberUserIds: ReadonlySet<string>;
  readonly onClose: () => void;
  readonly onAssigned: () => void;
}

/** Roster candidates for this dialog — `case-handler` only: an `hr-admin`
 *  already has org-wide client reach, so granting one `client_membership`
 *  would be a real, legitimate no-op, not a control worth offering here.
 *
 *  **Known, accepted gap (review finding, 2026-08-28): the roster is
 *  CONTEXT-WIDE, not org-scoped** — `GET /v1/app-contexts/{contextId}/
 *  profiles` has no per-org filter (same limitation `TeamPage.tsx`'s own
 *  header comment documents for its member roster), so this picker offers
 *  case-handlers from every org in the tenant, not just this client's own
 *  org. A mistaken cross-org assignment is possible from the UI. Not fixed
 *  here — cross-referencing every candidate against their own org
 *  memberships is real, separate scope, and `casework.blueprint.yaml`'s
 *  `scope:org` requirement on `entities:r:client`/`entities:u:client`
 *  (added the same review pass) means such a grant would be a real
 *  DEFENSE-IN-DEPTH backstop: the assigned case-handler still couldn't
 *  actually read/update the client, only hold an inert membership row. */
function AssignMemberDialog({
  open,
  orgId,
  clientId,
  existingMemberUserIds,
  onClose,
  onAssigned,
}: AssignMemberDialogProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [targetUserId, setTargetUserId] = useState('');
  const [level, setLevel] = useState<ClientMembershipLevel>('member');

  const rosterQuery = useQuery({
    queryKey: dataQueryKeys.team(),
    // Drained to completion — see drainPages.ts's own header; TeamPage.tsx's identical roster
    // query drains for the same reason.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().auth.listAccessProfiles({
          contextId: CASEWORK_CONTEXT_ID,
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: open,
  });
  const caseHandlers = (rosterQuery.data ?? []).filter(
    (p) => p.roleId === 'case-handler' && !existingMemberUserIds.has(p.principalId ?? ''),
  );

  const handleClose = (): void => {
    if (assignMutation.isPending) return;
    setTargetUserId('');
    setLevel('member');
    assignMutation.reset();
    onClose();
  };

  const assignMutation = useMutation({
    mutationFn: () => assignClientMembership({ orgId, clientId, targetUserId, level }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientMembersByOrg(orgId) });
      setTargetUserId('');
      setLevel('member');
      onAssigned();
    },
  });

  const canSubmit = targetUserId !== '' && !assignMutation.isPending;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <FormattedMessage id="clientDetail.assignTitle" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {rosterQuery.isPending && (
            <LoadingBlock label={intl.formatMessage({ id: 'clientDetail.assignLoadingRoster' })} />
          )}
          {rosterQuery.isError && (
            <ApiErrorAlert error={rosterQuery.error}>
              <FormattedMessage id="clientDetail.assignRosterError" />
            </ApiErrorAlert>
          )}
          {assignMutation.isError && (
            <ApiErrorAlert error={assignMutation.error}>
              <FormattedMessage id="clientDetail.assignError" />
              {extractErrorMessage(assignMutation.error) && (
                <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                  {extractErrorMessage(assignMutation.error)}
                </Typography>
              )}
            </ApiErrorAlert>
          )}
          {rosterQuery.isSuccess && caseHandlers.length === 0 && (
            <Alert severity="info">
              <FormattedMessage id="clientDetail.assignNoCandidates" />
            </Alert>
          )}
          {rosterQuery.isSuccess && caseHandlers.length > 0 && (
            <>
              <TextField
                select
                label={intl.formatMessage({ id: 'clientDetail.assignFieldPerson' })}
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
                size="small"
                required
              >
                {caseHandlers.map((p, idx) => {
                  const id = p.principalId ?? '';
                  const hasEmail = typeof p.email === 'string' && p.email.length > 0;
                  return (
                    <MenuItem key={id || `candidate-${idx}`} value={id}>
                      {hasEmail ? p.email : id}
                    </MenuItem>
                  );
                })}
              </TextField>
              <TextField
                select
                label={intl.formatMessage({ id: 'clientDetail.assignFieldLevel' })}
                value={level}
                onChange={(e) => setLevel(e.target.value as ClientMembershipLevel)}
                size="small"
              >
                {MEMBERSHIP_LEVELS.map((lvl) => (
                  <MenuItem key={lvl} value={lvl}>
                    <FormattedMessage id={`clientDetail.level.${lvl}`} />
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={assignMutation.isPending}>
          <FormattedMessage id="clientDetail.assignCancel" />
        </Button>
        <SubmitButton
          variant="contained"
          disabled={!canSubmit}
          pending={assignMutation.isPending}
          onClick={() => assignMutation.mutate()}
        >
          <FormattedMessage id="clientDetail.assignCta" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}

interface MembersSectionProps {
  readonly orgId: string;
  readonly clientId: string;
}

function MembersSection({ orgId, clientId }: MembersSectionProps): React.JSX.Element {
  const intl = useIntl();
  const [assignOpen, setAssignOpen] = useState(false);

  // Single-dim filter (`scope:org`) — the only non-`${{ any }}` dimension `hr-admin`'s
  // `records:crud:client_membership` clause names (see that clause's own blueprint comment) —
  // filtered client-side to this one client's rows, same reasoning `dataQueryKeys.clientMembersByOrg`
  // documents.
  const membersQuery = useQuery({
    queryKey: dataQueryKeys.clientMembersByOrg(orgId),
    // Drained to completion — see drainPages.ts's own header; an org with more than 20
    // client_membership rows would otherwise silently lose members past the first page.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().records.listRecords({
          type: 'client_membership',
          scope: `org:${orgId}`,
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: orgId !== '',
  });
  const members: RecordResponse[] = (membersQuery.data ?? []).filter((r) =>
    (r.scopes ?? []).includes(`client:${clientId}`),
  );
  const existingMemberUserIds = new Set(
    members
      .map((m) => (typeof m.payload?.targetUserId === 'string' ? m.payload.targetUserId : undefined))
      .filter((id): id is string => typeof id === 'string'),
  );

  const rosterQuery = useQuery({
    queryKey: dataQueryKeys.team(),
    // Drained to completion — see drainPages.ts's own header; TeamPage.tsx's identical roster
    // query drains for the same reason.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().auth.listAccessProfiles({
          contextId: CASEWORK_CONTEXT_ID,
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
  });
  const rosterById = new Map((rosterQuery.data ?? []).map((p) => [p.principalId, p]));

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={2}>
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                <FormattedMessage id="clientDetail.membersTitle" />
              </Typography>
              <Typography variant="body2" color="text.secondary">
                <FormattedMessage id="clientDetail.membersSubtitle" />
              </Typography>
            </Box>
            <Button variant="outlined" size="small" onClick={() => setAssignOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
              <FormattedMessage id="clientDetail.assignButton" />
            </Button>
          </Stack>

          {membersQuery.isPending && (
            <LoadingBlock label={intl.formatMessage({ id: 'clientDetail.membersLoading' })} />
          )}
          {membersQuery.isError && (
            <ApiErrorAlert error={membersQuery.error}>
              <FormattedMessage id="clientDetail.membersError" />
            </ApiErrorAlert>
          )}
          {membersQuery.isSuccess && members.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              <FormattedMessage id="clientDetail.membersEmpty" />
            </Typography>
          )}
          {members.length > 0 && (
            <TableContainer component={Paper} variant="outlined">
              <Table size="small" aria-label={intl.formatMessage({ id: 'clientDetail.membersTitle' })}>
                <TableHead>
                  <TableRow>
                    <TableCell>
                      <FormattedMessage id="clientDetail.membersColumnPerson" />
                    </TableCell>
                    <TableCell>
                      <FormattedMessage id="clientDetail.membersColumnLevel" />
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {members.map((m, idx) => {
                    const targetUserId =
                      typeof m.payload?.targetUserId === 'string' ? m.payload.targetUserId : undefined;
                    const profile = targetUserId ? rosterById.get(targetUserId) : undefined;
                    const hasEmail = typeof profile?.email === 'string' && profile.email.length > 0;
                    const level = typeof m.payload?.level === 'string' ? m.payload.level : '—';
                    return (
                      <TableRow key={m.id ?? `member-${idx}`}>
                        <TableCell sx={{ fontFamily: hasEmail ? undefined : 'monospace' }}>
                          {hasEmail ? profile.email : (targetUserId ?? '—')}
                        </TableCell>
                        <TableCell>
                          <Chip label={level} size="small" />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </CardContent>

      <AssignMemberDialog
        open={assignOpen}
        orgId={orgId}
        clientId={clientId}
        existingMemberUserIds={existingMemberUserIds}
        onClose={() => setAssignOpen(false)}
        onAssigned={() => setAssignOpen(false)}
      />
    </Card>
  );
}

export function ClientDetailPage(): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const { identity, can: canPerformAction } = useScopeGate();
  const myUserId = identity.partnerUserId;
  const canEdit = canPerformAction('entities:u:client');
  const canManageMembers = canPerformAction('records:c:client_membership');

  const [name, setName] = useState('');
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [seeded, setSeeded] = useState(false);
  // Archive confirmation — reactivate stays a direct one-click action (it's the un-doing of
  // archive, not itself a step that needs guarding); only the forward action gets a confirm step,
  // via the shared ConfirmDialog.
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);

  const clientQuery = useQuery({
    queryKey: dataQueryKeys.client(id),
    queryFn: () =>
      vectrosApiClient().identity.getEntity({ namespace: 'client', id, contextId: CASEWORK_CONTEXT_ID }),
    enabled: id !== '',
  });
  const client = clientQuery.data;
  const orgId = orgIdFromScopes(client?.scopes);
  const isSuspended = client?.status === 'SUSPENDED';

  // Breadcrumb to the owning org — mirrors CaseDetailPage's identical use of the same shared
  // hook. This page computed `orgId` already but never displayed or linked it, so a caller who
  // reached a client directly had no way to tell or navigate to which org it belonged to, unlike
  // CaseDetailPage's own org->client breadcrumb.
  const { name: orgName } = useOrgName(orgId);

  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schemaByType(CLIENT_PROFILE_TYPE_NAME),
    queryFn: async () =>
      (
        await vectrosApiClient().schemas.listSchemas({ recordType: CLIENT_PROFILE_TYPE_NAME, surface: 'entity' })
      ).data?.[0],
    enabled: client !== undefined,
  });
  const schemaFields: ReadonlyArray<Vectros.FieldDef> = (schemaQuery.data?.fields ?? []).filter(
    (f) => !isReservedPayloadKey(f.fieldId),
  );
  const fieldErrors = validateFields(schemaFields, payload);
  // Touched-gated for display only -- `canSave` below still uses the full, unfiltered
  // `fieldErrors`. Currently latent (payload is seeded from an already-valid saved record), but
  // without this, the moment client_profile gains a new required field an existing record
  // doesn't have, this page would show that field red the instant it loads, before the caller
  // touched anything -- same bug class the create dialogs already fixed, via schema evolution
  // instead of a blank form.
  const { visibleErrors, markTouched, reset: resetTouched } = useTouchedFieldErrors(fieldErrors);

  // Seed the editor from the loaded client exactly once, same discipline OrgDetailPage's own
  // identical comment explains (a background refetch must never clobber an in-progress edit).
  useEffect(() => {
    if (client && !seeded) {
      setName(client.name ?? '');
      setPayload(stripReservedPayloadKeys(client.payload ?? {}));
      setSeeded(true);
      resetTouched();
    }
  }, [client, seeded, resetTouched]);

  const handleFieldChange = (field: Vectros.FieldDef, input: string | boolean): void => {
    setPayload((prev) => withField(prev, field.fieldId, coerceFieldValue(field, input)));
    markTouched(field.fieldId);
  };

  // Shared by both mutations below — a rename OR an archive/reactivate both make the entity-level
  // cache AND every list that might show this client stale. Review finding (2026-08-28): this used
  // to invalidate `dataQueryKeys.client(id)` alone, leaving `ClientsListPage`/`CreateCaseDialog`'s
  // existing-client picker showing a stale name or status for up to the query's `staleTime`. Mirrors
  // `OrgDetailPage.tsx`'s own save/delete handlers, which invalidate both `org(id)` AND
  // `orgsFounded()` for the identical reason — this page's own commit message claimed to follow that
  // exact pattern; this closes the gap where it didn't.
  const invalidateClientCaches = (): void => {
    void queryClient.invalidateQueries({ queryKey: dataQueryKeys.client(id) });
    if (orgId) {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientsForOrg(orgId) });
    }
    if (typeof myUserId === 'string' && myUserId !== '') {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientsFoundedBy(myUserId) });
    }
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      vectrosApiClient().identity.updateEntity({
        namespace: 'client',
        id,
        contextId: CASEWORK_CONTEXT_ID,
        body: {
          externalId: client?.externalId ?? '',
          name: name.trim(),
          ...(schemaQuery.data?.id ? { schemaId: schemaQuery.data.id } : {}),
          payload: stripReservedPayloadKeys(payload),
        },
      }),
    onSuccess: invalidateClientCaches,
  });

  // Archive/reactivate — the platform-native `status` field, not a schema field or a delete. See
  // this file's own header comment for why there's no delete action on this screen at all.
  const archiveMutation = useMutation({
    mutationFn: () =>
      vectrosApiClient().identity.updateEntity({
        namespace: 'client',
        id,
        contextId: CASEWORK_CONTEXT_ID,
        body: {
          externalId: client?.externalId ?? '',
          status: isSuspended ? 'ACTIVE' : 'SUSPENDED',
        },
      }),
    onSuccess: () => {
      setArchiveConfirmOpen(false);
      invalidateClientCaches();
    },
  });

  const trimmedName = name.trim();
  const canSave =
    canEdit && trimmedName !== '' && Object.keys(fieldErrors).length === 0 && !saveMutation.isPending;

  const backButton = (
    <Button component={RouterLink} to="/clients" startIcon={<ArrowBack />} size="small" sx={{ alignSelf: 'flex-start' }}>
      <FormattedMessage id="clientDetail.back" />
    </Button>
  );

  if (clientQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'clientDetail.loading' })} />
      </Stack>
    );
  }
  if (clientQuery.isError || !client) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={clientQuery.error}>
          <FormattedMessage id="clientDetail.loadError" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      {backButton}

      {orgId && (
        <Breadcrumbs aria-label={intl.formatMessage({ id: 'clientDetail.breadcrumb' })}>
          <Link component={RouterLink} to={`/orgs/${encodeURIComponent(orgId)}`} underline="hover">
            {orgName}
          </Link>
        </Breadcrumbs>
      )}

      <Stack direction="row" alignItems="center" spacing={2}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {client.name && client.name.length > 0 ? client.name : client.externalId}
        </Typography>
        {isSuspended && (
          <Chip label={intl.formatMessage({ id: 'clientDetail.archivedBadge' })} size="small" />
        )}
      </Stack>

      {saveMutation.isError && (
        <ApiErrorAlert error={saveMutation.error}>
          <FormattedMessage id="clientDetail.saveError" />
          {extractErrorMessage(saveMutation.error) && (
            <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
              {extractErrorMessage(saveMutation.error)}
            </Typography>
          )}
        </ApiErrorAlert>
      )}
      {saveMutation.isSuccess && (
        <SuccessAlert onDismiss={() => saveMutation.reset()}>
          <FormattedMessage id="clientDetail.saveSuccess" />
        </SuccessAlert>
      )}
      {archiveMutation.isSuccess && (
        <SuccessAlert onDismiss={() => archiveMutation.reset()}>
          {/* archiveMutation.data (the mutation's own fresh response) picks the message, NOT the
              separately-cached `isSuspended` -- invalidateClientCaches() only INVALIDATES the
              client query, it doesn't await a refetch, so `client`/`isSuspended` can still be the
              PRE-mutation value on this render, which would otherwise show "Reactivated." right
              after an archive, until the background refetch lands. */}
          <FormattedMessage
            id={archiveMutation.data?.status === 'SUSPENDED' ? 'clientDetail.archiveSuccess' : 'clientDetail.reactivateSuccess'}
          />
        </SuccessAlert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={3}>
            <TextField
              label={intl.formatMessage({ id: 'clients.fieldName' })}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={!canEdit}
              size="small"
            />
            {schemaQuery.isPending && (
              <LoadingBlock label={intl.formatMessage({ id: 'clients.loadingSchema' })} />
            )}
            {schemaQuery.isError && (
              <ApiErrorAlert error={schemaQuery.error}>
                <FormattedMessage id="clients.schemaError" />
              </ApiErrorAlert>
            )}
            {schemaQuery.isSuccess && (
              <RecordFormFields
                fields={schemaFields}
                value={payload}
                errors={visibleErrors}
                renderHints={schemaQuery.data?.renderHints}
                onChange={canEdit ? handleFieldChange : () => {}}
              />
            )}
            {canEdit && (
              <Stack direction="row" spacing={2}>
                <SubmitButton
                  variant="contained"
                  disabled={!canSave}
                  pending={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <FormattedMessage id="clientDetail.save" />
                </SubmitButton>
                <SubmitButton
                  variant="outlined"
                  color={isSuspended ? 'primary' : 'inherit'}
                  pending={archiveMutation.isPending}
                  onClick={() =>
                    isSuspended ? archiveMutation.mutate() : setArchiveConfirmOpen(true)
                  }
                >
                  <FormattedMessage id={isSuspended ? 'clientDetail.reactivate' : 'clientDetail.archive'} />
                </SubmitButton>
              </Stack>
            )}
          </Stack>
        </CardContent>
      </Card>

      {canManageMembers && orgId && <MembersSection orgId={orgId} clientId={id} />}

      <ConfirmDialog
        open={archiveConfirmOpen}
        title={intl.formatMessage({ id: 'clientDetail.archiveConfirmTitle' })}
        body={intl.formatMessage({ id: 'clientDetail.archiveConfirmBody' })}
        confirmLabel={intl.formatMessage({ id: 'clientDetail.archiveConfirmCta' })}
        cancelLabel={intl.formatMessage({ id: 'clientDetail.archiveConfirmCancel' })}
        destructive={false}
        pending={archiveMutation.isPending}
        onConfirm={() => archiveMutation.mutate()}
        onClose={() => setArchiveConfirmOpen(false)}
        // ConfirmDialog's own error slot renders INSIDE the still-open modal -- without it, a
        // failed archive left the mutation's error alert rendered in the page body, occluded
        // behind the open dialog backdrop, with nothing visible telling the caller it failed.
        error={
          archiveMutation.isError ? (
            <>
              <FormattedMessage id="clientDetail.archiveError" />
              {extractErrorMessage(archiveMutation.error) && (
                <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                  {extractErrorMessage(archiveMutation.error)}
                </Typography>
              )}
              <RequestIdCaption error={archiveMutation.error} />
            </>
          ) : undefined
        }
      />
    </Stack>
  );
}

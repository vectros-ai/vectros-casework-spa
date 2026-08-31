// ---------------------------------------------------------------------------
// OrgDetailPage — Org management, screen 2 of 2 (edit + delete).
//
// A single founded org: its name plus its bound `org_profile` schema fields,
// editable in place, and a delete action in a clearly separated danger zone.
// Every org this page can successfully LOAD is already the caller's own —
// the read itself is scoped to founded-or-admitted orgs server-side (the
// blueprint's `entities:r:org` grants), so a stray link to someone else's org
// id fails closed as an ordinary load error, not a distinguishable
// "forbidden" response (the platform's uniform not-found discipline).
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router';
import {
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
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
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { useTouchedFieldErrors } from '../../../lib/useTouchedFieldErrors';
import { SuccessAlert } from '../../../components/SuccessAlert';

export function OrgDetailPage(): React.JSX.Element {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const { can: canPerformAction } = useScopeGate();
  const canEdit = canPerformAction('entities:u:org');
  const canDelete = canPerformAction('entities:d:org');

  const [name, setName] = useState('');
  const [payload, setPayload] = useState<Record<string, unknown>>({});
  const [seeded, setSeeded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [typedName, setTypedName] = useState('');

  const orgQuery = useQuery({
    queryKey: dataQueryKeys.org(id),
    queryFn: () =>
      vectrosApiClient().identity.getEntity({ namespace: 'org', id, contextId: CASEWORK_CONTEXT_ID }),
    enabled: id !== '',
  });
  const org = orgQuery.data;

  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schemaByType('org_profile'),
    queryFn: async () =>
      (
        await vectrosApiClient().schemas.listSchemas({ recordType: 'org_profile', surface: 'entity' })
      ).data?.[0],
    enabled: org !== undefined,
  });
  const schemaFields: ReadonlyArray<Vectros.FieldDef> = (schemaQuery.data?.fields ?? []).filter(
    (f) => !isReservedPayloadKey(f.fieldId),
  );
  const fieldErrors = validateFields(schemaFields, payload);
  // Touched-gated for display only -- `canSave` below still uses the full, unfiltered
  // `fieldErrors`. See ClientDetailPage's identical fix for the full rationale.
  const { visibleErrors, markTouched, reset: resetTouched } = useTouchedFieldErrors(fieldErrors);

  // Seed the editor from the loaded org exactly once, so a background
  // refetch never clobbers an in-progress edit.
  useEffect(() => {
    if (org && !seeded) {
      setName(org.name ?? '');
      setPayload(stripReservedPayloadKeys(org.payload ?? {}));
      setSeeded(true);
      resetTouched();
    }
  }, [org, seeded, resetTouched]);

  const handleFieldChange = (field: Vectros.FieldDef, input: string | boolean): void => {
    setPayload((prev) => withField(prev, field.fieldId, coerceFieldValue(field, input)));
    markTouched(field.fieldId);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      vectrosApiClient().identity.updateEntity({
        namespace: 'org',
        id,
        contextId: CASEWORK_CONTEXT_ID,
        body: {
          externalId: org?.externalId ?? '',
          name: name.trim(),
          ...(schemaQuery.data?.id ? { schemaId: schemaQuery.data.id } : {}),
          payload: stripReservedPayloadKeys(payload),
        },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.org(id) });
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.orgsFounded() });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      vectrosApiClient().identity.deleteEntity({ namespace: 'org', id, contextId: CASEWORK_CONTEXT_ID }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.orgsFounded() });
      // Also invalidate the single-org cache — otherwise a stale cached org (name/payload) could
      // reappear if the user navigates back here via browser history before the 404 surfaces.
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.org(id) });
      navigate('/orgs');
    },
  });

  const handleDeleteClose = (): void => {
    if (deleteMutation.isPending) return;
    setDeleteOpen(false);
    setTypedName('');
    deleteMutation.reset();
  };

  const trimmedName = name.trim();
  const canSave =
    canEdit &&
    trimmedName !== '' &&
    Object.keys(fieldErrors).length === 0 &&
    !saveMutation.isPending;
  const deleteMatches = org?.name != null && typedName === org.name;

  const backButton = (
    <Button component={RouterLink} to="/orgs" startIcon={<ArrowBack />} size="small" sx={{ alignSelf: 'flex-start' }}>
      <FormattedMessage id="orgDetail.back" />
    </Button>
  );

  if (orgQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'orgDetail.loading' })} />
      </Stack>
    );
  }
  if (orgQuery.isError || !org) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={orgQuery.error}>
          <FormattedMessage id="orgDetail.loadError" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  return (
    <Stack spacing={3}>
      {backButton}

      <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
        {org.name && org.name.length > 0 ? org.name : org.externalId}
      </Typography>

      {saveMutation.isError && (
        <ApiErrorAlert error={saveMutation.error}>
          <FormattedMessage id="orgDetail.saveError" />
          {extractErrorMessage(saveMutation.error) && (
            <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
              {extractErrorMessage(saveMutation.error)}
            </Typography>
          )}
        </ApiErrorAlert>
      )}
      {saveMutation.isSuccess && (
        <SuccessAlert onDismiss={() => saveMutation.reset()}>
          <FormattedMessage id="orgDetail.saveSuccess" />
        </SuccessAlert>
      )}

      <Card>
        <CardContent>
          <Stack spacing={3}>
            <TextField
              label={intl.formatMessage({ id: 'orgs.fieldName' })}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={!canEdit}
              size="small"
            />
            {schemaQuery.isPending && (
              <LoadingBlock label={intl.formatMessage({ id: 'orgs.loadingSchema' })} />
            )}
            {schemaQuery.isError && (
              <ApiErrorAlert error={schemaQuery.error}>
                <FormattedMessage id="orgs.schemaError" />
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
              <Box>
                <SubmitButton
                  variant="contained"
                  disabled={!canSave}
                  pending={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  <FormattedMessage id="orgDetail.save" />
                </SubmitButton>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      {canDelete && (
        <Card variant="outlined" sx={{ borderColor: 'error.main' }}>
          <CardContent>
            <Stack spacing={2} alignItems="flex-start">
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: 'error.main' }}>
                  <FormattedMessage id="orgDetail.dangerZoneTitle" />
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  <FormattedMessage id="orgDetail.dangerZoneBody" />
                </Typography>
              </Box>
              <Button color="error" variant="outlined" onClick={() => setDeleteOpen(true)}>
                <FormattedMessage id="orgDetail.deleteButton" />
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Dialog open={deleteOpen} onClose={handleDeleteClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          <FormattedMessage id="orgDetail.deleteConfirmTitle" />
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {deleteMutation.isError && (
              <ApiErrorAlert error={deleteMutation.error}>
                <FormattedMessage id="orgDetail.deleteError" />
                {extractErrorMessage(deleteMutation.error) && (
                  <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                    {extractErrorMessage(deleteMutation.error)}
                  </Typography>
                )}
              </ApiErrorAlert>
            )}
            <DialogContentText>
              <FormattedMessage id="orgDetail.deleteConfirmBody" />
            </DialogContentText>
            <TextField
              label={intl.formatMessage(
                { id: 'orgDetail.deleteConfirmLabel' },
                { name: org.name ?? '' },
              )}
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              size="small"
              slotProps={{ htmlInput: { style: { fontFamily: 'monospace' } } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteClose} disabled={deleteMutation.isPending}>
            <FormattedMessage id="orgDetail.deleteCancel" />
          </Button>
          <SubmitButton
            variant="contained"
            color="error"
            disabled={!deleteMatches}
            pending={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            <FormattedMessage id="orgDetail.deleteConfirmCta" />
          </SubmitButton>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

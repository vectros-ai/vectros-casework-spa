// ---------------------------------------------------------------------------
// CaseDetailPage — screen 3 of this app's screen-by-screen design: a case's header + entries.
//
// **Entries are linked to their case by a `caseId` REFERENCE field, not by
// ownership scope alone** — CORRECTED (owner-caught, 2026-08-27, a real data-
// modeling error in the original design, not a query-shape nuance):
// `case_note`/`case_document` are scoped `[org:<id>, client:<id>]` for
// PERMISSIONS (this app authorizes client-by-client, not case-by-case — see
// `case`'s own schema description), but that scope was ALSO being used to
// pick out ONE case's own entries, which only works while every client has
// at most one case. `createCase()` explicitly supports a SECOND case for an
// existing client, at which point both cases share the exact same
// `client:<id>` scope and become indistinguishable by scope alone — a read-
// only bug for notes (entries from two cases would mix), and a write-target
// bug for documents (an upload could land in the wrong case's folder). The
// fix: `case_note.caseId`/`case_document.caseId` are declared `fieldType:
// reference` (`targetTypeName: case`, `targetField: externalId`) — a genuine
// typed foreign key, never an ownership dimension — so a query can ask for
// exactly one case's entries regardless of how many cases its client has.
// The reference target is `case`'s own `externalId` (`createCase.ts`'s
// `generateCaseExternalId()`), NOT the route's system `id` used for
// `getRecord` above — the platform's reference mechanism always resolves via
// a target's declared UNIQUE lookup, which for a plain system id there isn't
// one; `caseExternalId` below is what's actually passed everywhere `caseId`
// is needed.
//
// **The entries query is `lookupRecords({type:'case_note', field:'caseId',
// value: caseExternalId})`** — no client-side filtering needed any more; the
// platform's own `filterByDataScope` narrowing per-role (org-only for
// hr-admin, org+client for case-handler) still runs underneath, unaffected
// by this fix — this only changes WHICH rows the query asks for, not how
// they're authorized. (`case-handler`'s two-real-dimension `scope:org`+
// `scope:client` clause is still why this is `lookupRecords`, not
// `listRecords` — a `listRecords` call's `scope` filter only ever takes ONE
// `namespace:value` pair, an open platform limitation for a
// two-dimension clause like this one.)
//
// **Scope for this cut, same reasoning as CasesListPage:** the status
// control is real (both roles hold `records:u:case`, scoped to their own
// cases) and gated on it. The "Add entry" composer is real and gated on
// `records:c:case_note` too — wired correctly, but note hr-admin (the only
// role reachable today) holds READ only on `case_note`, not create, so it
// stays invisible until a case-handler session exists. The assignee field
// is rendered read-only — editing it is an HR-admin reassignment workflow
// that needs a case-handler picker, which needs the Team screen's member
// list (the same platform gap CasesListPage's own note names).
//
// **Documents + Ask** — the two sections this screen's original design
// deferred are now built: `CaseDocumentsSection` (list + upload) and
// `CaseAskPanel` (a case-scoped RAG drawer, reached from here rather than a
// standalone nav item — RAG is compartment-scoped by construction, there is
// no "ask across everything" mode). Both use `caseId` the same way the notes
// query does. The one folder `createCase()` creates per case is still used
// as the upload TARGET (a real, human-facing organizational unit — "each
// case gets its own folder"), but is no longer how a case's documents get
// FOUND: `case`'s own schema now carries a `folderId` field, stamped at
// create time, read directly off the already-loaded case record below — no
// query needed, since folders themselves can't bind a schema (no lookup
// fields possible), which is what made the old folder-listing approach
// necessary in the first place.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink, useParams } from 'react-router';
import {
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import ArrowBack from '@mui/icons-material/ArrowBack';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ApiErrorAlert,
  LoadingBlock,
  MetaList,
  MetaRow,
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
import { useOrgName } from '../../../hooks/useOrgName';
import { SuccessAlert } from '../../../components/SuccessAlert';
import { CASEWORK_CONTEXT_ID, vectrosApiClient } from '../../../api/vectrosApi';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { drainPages } from '../../../lib/drainPages';
import { useTouchedFieldErrors } from '../../../lib/useTouchedFieldErrors';
import { STATUS_COLORS } from '../../../lib/caseStatusColors';
import { CaseDocumentsSection } from './CaseDocumentsSection';
import { CaseAskPanel } from './CaseAskPanel';

const STATUS_VALUES = ['open', 'active', 'closed'];

export function CaseDetailPage(): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { id = '' } = useParams();
  const { can: canPerformAction } = useScopeGate();
  const canChangeStatus = canPerformAction('records:u:case');
  const canAddEntry = canPerformAction('records:c:case_note');
  const canUploadDocument = canPerformAction('documents:c');
  const canAsk = canPerformAction('inference:r');

  const [entryPayload, setEntryPayload] = useState<Record<string, unknown>>({});
  const [askOpen, setAskOpen] = useState(false);

  const caseQuery = useQuery({
    queryKey: dataQueryKeys.case(id),
    queryFn: () => vectrosApiClient().records.getRecord({ id }),
    enabled: id !== '',
  });
  const caseRecord = caseQuery.data;
  const clientScope = (caseRecord?.scopes ?? []).find((s) => s.startsWith('client:'));
  const orgScope = (caseRecord?.scopes ?? []).find((s) => s.startsWith('org:'));
  const orgId = orgScope?.slice('org:'.length);
  const clientId = clientScope?.slice('client:'.length);
  // What `case_note.caseId`/`case_document.caseId` (both `fieldType: reference`)
  // actually resolve against — the platform's reference mechanism always
  // resolves via a target's declared UNIQUE lookup, which for `case` is its
  // `externalId` (`createCase.ts`'s own comment); the route's system `id`
  // (used for `getRecord` above) is a different value and won't resolve.
  // Undefined for a case that predates this field.
  const caseExternalId = caseRecord?.externalId;

  // Breadcrumb — a case's org and client are its own scope dims, not payload
  // fields (this file's own header comment), so nothing before this resolved
  // them to a display name; the page just showed the case type alone with no
  // sense of which org/client it belongs to. Org links to OrgDetailPage (a
  // real screen); client has no detail screen yet, deliberately deferred, so
  // it's plain text, not a link, until that screen exists.
  const { name: orgName } = useOrgName(orgId);
  const clientNameQuery = useQuery({
    queryKey: dataQueryKeys.client(clientId ?? ''),
    queryFn: () =>
      vectrosApiClient().identity.getEntity({
        namespace: 'client',
        id: clientId ?? '',
        contextId: CASEWORK_CONTEXT_ID,
      }),
    enabled: typeof clientId === 'string',
  });
  const clientName = clientNameQuery.data?.name || clientId;

  const notesQuery = useQuery({
    queryKey: dataQueryKeys.caseNotes(id),
    // Drained to completion — see drainPages.ts's own header; a case with more than 20 entries
    // would otherwise silently drop the oldest ones from this chronological list.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().records.lookupRecords({
          type: 'case_note',
          field: 'caseId',
          value: caseExternalId ?? '',
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: typeof caseExternalId === 'string',
  });
  const notes = notesQuery.data ?? [];

  // This case's own folder — createCase() creates exactly one per case and
  // stamps its id onto the case record's own `folderId` field (folders can't
  // bind a schema, so there's no lookup-field path to find one FROM a case
  // id the way case_note/case_document's own `caseId` field lets a query
  // find THEM — storing the id on the one record this page already has
  // loaded is the workaround). No query needed.
  const caseFolderId =
    typeof caseRecord?.payload?.folderId === 'string' ? caseRecord.payload.folderId : undefined;

  const noteSchemaQuery = useQuery({
    queryKey: dataQueryKeys.schemaByType('case_note'),
    queryFn: async () =>
      (await vectrosApiClient().schemas.listSchemas({ recordType: 'case_note' })).data?.[0],
    enabled: canAddEntry,
  });
  // `caseId` is excluded here too — it's a real schema field (case_note
  // needs it to be queryable by lookupRecords above), but it's stamped
  // programmatically from the route param below, never user-editable.
  const noteSchemaFields: ReadonlyArray<Vectros.FieldDef> = (
    noteSchemaQuery.data?.fields ?? []
  ).filter((f) => !isReservedPayloadKey(f.fieldId) && f.fieldId !== 'caseId');
  const noteFieldErrors = validateFields(noteSchemaFields, entryPayload);
  const {
    visibleErrors: visibleEntryErrors,
    markTouched: markEntryFieldTouched,
    reset: resetEntryTouched,
  } = useTouchedFieldErrors(noteFieldErrors);

  const statusMutation = useMutation({
    mutationFn: (nextStatus: string) => {
      if (!caseRecord) throw new Error('case not loaded'); // unreachable — control is gated on caseQuery.isSuccess
      return vectrosApiClient().records.updateRecord({
        id,
        body: {
          typeName: caseRecord.typeName ?? 'case',
          schemaId: caseRecord.schemaId ?? '',
          payload: withField(caseRecord.payload ?? {}, 'status', nextStatus),
          expectedVersion: caseRecord.version,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.case(id) });
      // Also invalidate every cached Cases list query (CasesListPage's own create-case mutation
      // does the same, same reasoning) — otherwise a status change made here never shows up back
      // on the list, since ['cases', statusFilter] is a separate cache entry from ['cases', 'record', id].
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
    },
    // `expectedVersion`'s optimistic-concurrency check rejects a stale write with a 409 rather than
    // silently clobbering a concurrent one — the exact everyday case of two people (an hr-admin and a case handler,
    // say) both having this same case open and one changing status after the other already did.
    // Without this, the loser is stuck: `caseRecord.version` never refetches after a failure, so
    // clicking the dropdown again — the obvious next move, and what the error text itself invites
    // ("re-read the record and re-apply") — resends the same stale version and fails identically
    // forever, with a full page reload as the only way out. Refetching on ANY failure (not just a
    // version conflict specifically) is deliberate: it's harmless for a transient network error too,
    // and means the caller's very next attempt is against the record's real current state.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.case(id) });
    },
  });

  const addEntryMutation = useMutation({
    mutationFn: () => {
      const schema = noteSchemaQuery.data;
      // Live-tested and corrected: a `case_note` create stamps BOTH `org:<id>` AND
      // `client:<id>` (`casework.blueprint.yaml`'s own comment: "a case/case_note/document create
      // always stamps BOTH... the platform's create-side guard denies a write outright unless the
      // authorizing clause has a key for EVERY dimension it stamps") — omitting `orgScope` here
      // 403'd with "the resulting ownership falls outside the token's data scope", same class of bug
      // as `createCase.ts` already guards against by sending both scopes together.
      if (!schema?.id || !clientScope || !orgScope || !caseExternalId) {
        throw new Error('no schema, case scope, or case externalId resolved');
      }
      return vectrosApiClient().records.createRecord({
        body: {
          typeName: 'case_note',
          schemaId: schema.id,
          // `caseId` merged in AFTER the strip, not through the user-editable
          // form state — see this file's header comment for why this field
          // exists at all (disambiguating a client's 2nd+ case). Its value is
          // this case's `externalId`, not its route/system id — see
          // `caseExternalId`'s own comment above.
          payload: { ...stripReservedPayloadKeys(entryPayload), caseId: caseExternalId },
          scopes: [orgScope, clientScope],
        },
      });
    },
    onSuccess: () => {
      setEntryPayload({});
      resetEntryTouched();
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.caseNotes(id) });
    },
  });

  const handleEntryFieldChange = (field: Vectros.FieldDef, input: string | boolean): void => {
    setEntryPayload((prev) => withField(prev, field.fieldId, coerceFieldValue(field, input)));
    markEntryFieldTouched(field.fieldId);
  };

  const backButton = (
    <Button
      component={RouterLink}
      to="/cases"
      startIcon={<ArrowBack />}
      size="small"
      sx={{ alignSelf: 'flex-start' }}
    >
      <FormattedMessage id="caseDetail.back" />
    </Button>
  );

  if (caseQuery.isPending) {
    return (
      <Stack spacing={3}>
        {backButton}
        <LoadingBlock label={intl.formatMessage({ id: 'caseDetail.loading' })} />
      </Stack>
    );
  }
  if (caseQuery.isError || !caseRecord) {
    return (
      <Stack spacing={3}>
        {backButton}
        <ApiErrorAlert error={caseQuery.error}>
          <FormattedMessage id="caseDetail.loadError" />
        </ApiErrorAlert>
      </Stack>
    );
  }

  const caseType = typeof caseRecord.payload?.caseType === 'string' ? caseRecord.payload.caseType : '—';
  const status = typeof caseRecord.payload?.status === 'string' ? caseRecord.payload.status : '—';
  const assignedTo =
    typeof caseRecord.payload?.assignedTo === 'string' && caseRecord.payload.assignedTo.length > 0
      ? caseRecord.payload.assignedTo
      : null;
  const openedAt = typeof caseRecord.payload?.openedAt === 'string' ? caseRecord.payload.openedAt : '—';

  const trimmedEntryBody =
    typeof entryPayload.body === 'string' ? entryPayload.body.trim() : '';
  const canSubmitEntry =
    canAddEntry &&
    trimmedEntryBody !== '' &&
    Object.keys(noteFieldErrors).length === 0 &&
    typeof noteSchemaQuery.data?.id === 'string' &&
    typeof caseExternalId === 'string' &&
    !addEntryMutation.isPending;

  return (
    <Stack spacing={3}>
      {backButton}

      {(orgId || clientId) && (
        <Breadcrumbs aria-label={intl.formatMessage({ id: 'caseDetail.breadcrumb' })}>
          {orgId && (
            <Link component={RouterLink} to={`/orgs/${encodeURIComponent(orgId)}`} underline="hover">
              {orgName}
            </Link>
          )}
          {/* Real link, not plain text — a client detail screen now exists to reach. Always
              reachable for anyone who can see THIS case: the case-read clause's `scope:client` condition
              (founder or `client_membership`) is exactly `entities:r:client`'s own narrowed
              condition, so seeing the case already proves the client read will succeed too. */}
          {clientId && (
            <Link component={RouterLink} to={`/clients/${encodeURIComponent(clientId)}`} underline="hover">
              {clientName}
            </Link>
          )}
        </Breadcrumbs>
      )}

      <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          {caseType}
        </Typography>
        {canAsk && (
          <Button variant="outlined" onClick={() => setAskOpen(true)}>
            <FormattedMessage id="caseDetail.askCta" />
          </Button>
        )}
      </Stack>

      {statusMutation.isError && (
        <ApiErrorAlert error={statusMutation.error}>
          <FormattedMessage id="caseDetail.statusError" />
          {extractErrorMessage(statusMutation.error) && (
            <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
              {extractErrorMessage(statusMutation.error)}
            </Typography>
          )}
        </ApiErrorAlert>
      )}
      {statusMutation.isSuccess && (
        <SuccessAlert onDismiss={() => statusMutation.reset()}>
          <FormattedMessage id="caseDetail.statusSuccess" />
        </SuccessAlert>
      )}

      <Card>
        <CardContent>
          <MetaList>
            <MetaRow label={<FormattedMessage id="caseDetail.fieldStatus" />}>
              {canChangeStatus ? (
                <FormControl size="small" sx={{ minWidth: 160 }}>
                  <InputLabel id="case-status-label">
                    <FormattedMessage id="caseDetail.fieldStatus" />
                  </InputLabel>
                  <Select
                    labelId="case-status-label"
                    label={intl.formatMessage({ id: 'caseDetail.fieldStatus' })}
                    value={status}
                    disabled={statusMutation.isPending}
                    onChange={(e: SelectChangeEvent) => statusMutation.mutate(e.target.value)}
                  >
                    {STATUS_VALUES.map((s) => (
                      <MenuItem key={s} value={s}>
                        {s}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              ) : (
                <Chip label={status} size="small" color={STATUS_COLORS[status] ?? 'default'} />
              )}
            </MetaRow>
            <MetaRow label={<FormattedMessage id="caseDetail.fieldAssignedTo" />}>
              {assignedTo ?? <FormattedMessage id="caseDetail.unassigned" />}
            </MetaRow>
            <MetaRow label={<FormattedMessage id="caseDetail.fieldOpened" />}>{openedAt}</MetaRow>
          </MetaList>
        </CardContent>
      </Card>

      <Divider />

      <Typography variant="h6" component="h2">
        <FormattedMessage id="caseDetail.entriesTitle" />
      </Typography>

      {/* `notesQuery` is disabled (never fires) when `caseExternalId` is undefined — react-query
          reports a disabled query's own `isPending` as permanently true (it never distinguishes
          "actively fetching" from "never enabled"), so checking `notesQuery.isPending` alone here
          would spin forever with no request ever made and no error to show — confirmed live
          against a real pre-existing case (2026-08-28). Once the CASE itself has loaded, a missing
          `caseExternalId` is a known, terminal state (this file's own comment above: "a case that
          predates this field"), not a still-loading one — show that explicitly instead. */}
      {caseQuery.isSuccess && typeof caseExternalId !== 'string' && (
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage id="caseDetail.entriesUnavailableLegacy" />
        </Typography>
      )}
      {notesQuery.isPending && typeof caseExternalId === 'string' && (
        <LoadingBlock label={intl.formatMessage({ id: 'caseDetail.entriesLoading' })} />
      )}
      {notesQuery.isError && (
        <ApiErrorAlert error={notesQuery.error}>
          <FormattedMessage id="caseDetail.entriesLoadError" />
        </ApiErrorAlert>
      )}
      {notesQuery.isSuccess && notes.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage id="caseDetail.entriesEmpty" />
        </Typography>
      )}
      {notes.length > 0 && (
        <Stack spacing={2}>
          {notes.map((note, idx) => (
            <Card key={note.id ?? `note-${idx}`} variant="outlined">
              <CardContent>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Chip
                    label={typeof note.payload?.noteType === 'string' ? note.payload.noteType : '—'}
                    size="small"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {note.createdAt}
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {typeof note.payload?.body === 'string' ? note.payload.body : ''}
                </Typography>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {canAddEntry && (
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="subtitle2">
                <FormattedMessage id="caseDetail.addEntryTitle" />
              </Typography>
              {addEntryMutation.isError && (
                <ApiErrorAlert error={addEntryMutation.error}>
                  <FormattedMessage id="caseDetail.addEntryError" />
                </ApiErrorAlert>
              )}
              {noteSchemaQuery.isSuccess && (
                <RecordFormFields
                  fields={noteSchemaFields}
                  value={entryPayload}
                  errors={visibleEntryErrors}
                  renderHints={noteSchemaQuery.data?.renderHints}
                  onChange={handleEntryFieldChange}
                />
              )}
              <Box>
                <SubmitButton
                  variant="contained"
                  disabled={!canSubmitEntry}
                  pending={addEntryMutation.isPending}
                  onClick={() => addEntryMutation.mutate()}
                >
                  <FormattedMessage id="caseDetail.addEntryCta" />
                </SubmitButton>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      )}

      <Divider />

      {orgScope && clientScope && caseExternalId && (
        <CaseDocumentsSection
          caseId={caseExternalId}
          folderId={caseFolderId}
          orgScope={orgScope}
          clientScope={clientScope}
          canUpload={canUploadDocument}
        />
      )}

      {canAsk && caseExternalId && orgScope && (
        <CaseAskPanel
          open={askOpen}
          caseId={caseExternalId}
          orgScope={orgScope}
          onClose={() => setAskOpen(false)}
        />
      )}
    </Stack>
  );
}

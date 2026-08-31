// ---------------------------------------------------------------------------
// CasesListPage — screen 2 of this app's screen-by-screen design: the case list.
//
// Both roles CAN see cases here, but their READ clauses are deliberately NOT scoped identically —
// hr-admin sees every case in an org they belong to; case-handler sees only cases for a client
// they founded or hold membership in, within an org they belong to (`casework.blueprint.yaml`'s
// own comment on the case/case_note READ clause has the full rationale). The default "All" view
// fans a `listRecords` call out over the caller's own orgs (`useAccessibleOrgs`) — see the query
// definition below for why a single unfiltered call doesn't satisfy either role's token scope, and
// why the fan-out fully pages each org and tolerates a partial per-org failure rather than blanking
// the whole list. A real status filter goes through `lookupRecords` instead, which never had the
// same upfront gate — the platform's own post-query `filterByDataScope` narrows per-role there.
//
// **"+ New case" — added once the real blocker was found and fixed.** The original design
// premise ("case creation needs identity.scope:org, set only via the unbuilt
// /select endpoint") was WRONG: record-create authorization checks the caller's
// per-request-resolved data_scope, never that single pinned value directly.
// casework.blueprint.yaml's roles were simply authored against the broken
// `${{ self.scope.org }}` spelling — fixed to `${{ under.self.userId }}` (founder
// placement, live today) / `${{ member.scope.org }}` (membership-resolved,
// currently inert — see the blueprint's own comment on why). Gated on
// `records:c:case`, so it only ever renders for a caller who can actually reach
// it — in practice today, an org-founder hr-admin.
//
// **Still deliberately NOT built:** the assignee filter. It's HR-admin-only and
// needs a picker over the org's case handlers — which needs the Team screen's
// member list, itself blocked on a real platform gap (`casework.blueprint.yaml`'s
// own comment: no context-scoped way to list members exists yet).
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiErrorAlert, LoadingBlock, SubmitButton, extractErrorMessage } from '@vectros-ai/react';

import { useScopeGate } from '../../../auth';
import { vectrosApiClient } from '../../../api/vectrosApi';
import type { EntityResponse, RecordResponse } from '../../../api/vectrosApi';
import { createCase } from '../../../api/createCase';
import type { CaseType, CreateCaseResult } from '../../../api/createCase';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { drainPages } from '../../../lib/drainPages';
import { STATUS_COLORS } from '../../../lib/caseStatusColors';
import { RefreshIconButton } from '../../../components/RefreshIconButton';
import { EmptyStateCard } from '../../../components/EmptyStateCard';
import { OrgPickerField } from '../../../components/OrgPickerField';
import { useAccessibleOrgs } from '../../../hooks/useAccessibleOrgs';
import { useAccessibleClients } from '../../../hooks/useAccessibleClients';

const CASE_TYPES: readonly CaseType[] = [
  'grievance',
  'accommodation',
  'onboarding',
  'investigation',
  'leave_request',
];

interface CreateCaseDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onCreated: (result: CreateCaseResult) => void;
}

/**
 * "+ New case" — org picker (an editable select when the caller reaches more than one org; a
 * disabled field naming the org, not hidden, when there's only one — see OrgPickerField's own
 * header comment for why), a
 * client selector (a case is about a client — an employee — who is NOT 1:1
 * with a case: this is either that client's FIRST case, created inline, or
 * a later case for a client this org already has a record for), case type,
 * and a folder name defaulted from the case type. Submits through
 * `createCase` (api/createCase.ts) — one call site, so the eventual swap to a
 * real atomic endpoint touches that file alone, not this dialog.
 */
function CreateCaseDialog({ open, onClose, onCreated }: CreateCaseDialogProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { identity } = useScopeGate();
  const myUserId = identity.partnerUserId;
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';

  const [orgId, setOrgId] = useState('');
  const [clientMode, setClientMode] = useState<'new' | 'existing'>('new');
  const [clientId, setClientId] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [caseType, setCaseType] = useState<CaseType | ''>('');
  const [folderName, setFolderName] = useState('');
  const [folderNameTouched, setFolderNameTouched] = useState(false);

  // Founder orgs UNION member-only orgs (`useAccessibleOrgs`) — this used to
  // be `orgsFounded()` alone, which never matched a case-handler invited into
  // (not founding) an org — see that hook's own header comment.
  const orgsQuery = useAccessibleOrgs(hasUserId ? myUserId : undefined, open);
  const orgs: readonly EntityResponse[] = orgsQuery.orgs;
  const showOrgPicker = orgs.length > 1;

  // A single-org caller never sees an EDITABLE picker (no real choice to offer) — pin the
  // value silently; OrgPickerField still shows them a disabled field naming the org.
  const effectiveOrgId = showOrgPicker ? orgId : (orgs[0]?.id ?? '');

  // A client selected under a different org is meaningless once the org changes.
  useEffect(() => {
    setClientId('');
  }, [effectiveOrgId]);

  // This used to be a plain org-scoped `identity.listEntities({..., scope: 'org:<id>'})` call —
  // which silently 403s for a
  // case-handler now that `entities:r:client` no longer carries an org-scoped grant at all (data
  // isolation pass, `casework.blueprint.yaml`). `useAccessibleClients` unions the org-wide source
  // (works for hr-admin) with founder/member discovery (works for either role) — see that hook's
  // own header comment.
  const clientsQuery = useAccessibleClients(
    effectiveOrgId,
    hasUserId ? myUserId : undefined,
    open && clientMode === 'existing',
  );
  const clients: readonly EntityResponse[] = clientsQuery.clients;

  const caseTypeLabel = (t: CaseType): string => intl.formatMessage({ id: `cases.type.${t}` });

  // Default the folder name from the case type, unless the caller edited it —
  // a sensible default that doesn't fight a deliberate override.
  const derivedFolderName = caseType ? caseTypeLabel(caseType) : '';
  const effectiveFolderName = folderNameTouched ? folderName : derivedFolderName;

  const handleClose = (): void => {
    if (createMutation.isPending) return;
    setOrgId('');
    setClientMode('new');
    setClientId('');
    setNewClientName('');
    setCaseType('');
    setFolderName('');
    setFolderNameTouched(false);
    createMutation.reset();
    onClose();
  };

  const createMutation = useMutation({
    mutationFn: async (): Promise<CreateCaseResult> => {
      if (!effectiveOrgId) throw new Error('no org selected');
      if (!caseType) throw new Error('no case type selected');
      return createCase({
        orgId: effectiveOrgId,
        caseType,
        ...(clientMode === 'existing'
          ? { clientId }
          : { newClientName: newClientName.trim() }),
        folderName: effectiveFolderName.trim() || caseTypeLabel(caseType),
      });
    },
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['cases'] });
      // A "new client" submission just created a client entity a case-handler now founded — their
      // OWN founder-discovery source needs invalidating too, not just the org-wide list (which
      // 403s for them anyway as of the data-isolation pass), or a newly-created client won't
      // appear in this same dialog's picker until an unrelated cache eviction happens to occur.
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientsForOrg(effectiveOrgId) });
      if (hasUserId) {
        void queryClient.invalidateQueries({ queryKey: dataQueryKeys.clientsFoundedBy(myUserId) });
      }
      handleClose();
      onCreated(result);
    },
  });

  const clientValid = clientMode === 'existing' ? clientId !== '' : newClientName.trim() !== '';
  const canSubmit =
    effectiveOrgId !== '' &&
    clientValid &&
    caseType !== '' &&
    !orgsQuery.isPending &&
    !createMutation.isPending;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <FormattedMessage id="cases.createTitle" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {orgsQuery.isError && (
            <ApiErrorAlert error={orgsQuery.error}>
              <FormattedMessage id="cases.createOrgsError" />
            </ApiErrorAlert>
          )}
          {createMutation.isError && (
            <ApiErrorAlert error={createMutation.error}>
              <FormattedMessage id="cases.createError" />
              {extractErrorMessage(createMutation.error) && (
                <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                  {extractErrorMessage(createMutation.error)}
                </Typography>
              )}
            </ApiErrorAlert>
          )}
          {orgsQuery.isPending && (
            <LoadingBlock label={intl.formatMessage({ id: 'cases.createLoadingOrgs' })} />
          )}
          {orgsQuery.isSuccess && orgs.length === 0 && (
            <Alert severity="warning">
              <FormattedMessage id="cases.createNoOrgs" />
            </Alert>
          )}
          {orgsQuery.isSuccess && orgs.length > 0 && (
            <>
              <OrgPickerField
                orgs={orgs}
                value={orgId}
                onChange={setOrgId}
                labelId="cases.fieldOrg"
                disabled={createMutation.isPending}
              />
              <ToggleButtonGroup
                value={clientMode}
                exclusive
                size="small"
                disabled={createMutation.isPending}
                onChange={(_e, next: 'new' | 'existing' | null) => {
                  if (next !== null) setClientMode(next);
                }}
                aria-label={intl.formatMessage({ id: 'cases.fieldClientMode' })}
              >
                <ToggleButton value="new">
                  <FormattedMessage id="cases.clientModeNew" />
                </ToggleButton>
                <ToggleButton value="existing">
                  <FormattedMessage id="cases.clientModeExisting" />
                </ToggleButton>
              </ToggleButtonGroup>
              {clientMode === 'new' && (
                <TextField
                  label={intl.formatMessage({ id: 'cases.fieldNewClientName' })}
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  required
                  fullWidth
                  size="small"
                  disabled={createMutation.isPending}
                />
              )}
              {clientMode === 'existing' && (
                <>
                  {clientsQuery.isError && (
                    <ApiErrorAlert error={clientsQuery.error}>
                      <FormattedMessage id="cases.createClientsError" />
                    </ApiErrorAlert>
                  )}
                  {clientsQuery.isPending && (
                    <LoadingBlock label={intl.formatMessage({ id: 'cases.createLoadingClients' })} />
                  )}
                  {clientsQuery.isSuccess && clients.length === 0 && (
                    <Alert severity="info">
                      <FormattedMessage id="cases.createNoClients" />
                    </Alert>
                  )}
                  {clientsQuery.isSuccess && clients.length > 0 && (
                    <FormControl size="small" fullWidth>
                      <InputLabel id="create-case-client-label">
                        <FormattedMessage id="cases.fieldClient" />
                      </InputLabel>
                      <Select
                        labelId="create-case-client-label"
                        label={intl.formatMessage({ id: 'cases.fieldClient' })}
                        value={clientId}
                        disabled={createMutation.isPending}
                        onChange={(e: SelectChangeEvent) => setClientId(e.target.value)}
                      >
                        {clients.map((c) => (
                          <MenuItem key={c.id} value={c.id ?? ''}>
                            {c.name && c.name.length > 0 ? c.name : c.externalId}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  )}
                </>
              )}
              <FormControl size="small" fullWidth>
                <InputLabel id="create-case-type-label">
                  <FormattedMessage id="cases.fieldCaseType" />
                </InputLabel>
                <Select
                  labelId="create-case-type-label"
                  label={intl.formatMessage({ id: 'cases.fieldCaseType' })}
                  value={caseType}
                  disabled={createMutation.isPending}
                  onChange={(e: SelectChangeEvent) => setCaseType(e.target.value as CaseType)}
                >
                  {CASE_TYPES.map((t) => (
                    <MenuItem key={t} value={t}>
                      {caseTypeLabel(t)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label={intl.formatMessage({ id: 'cases.fieldFolderName' })}
                value={effectiveFolderName}
                onChange={(e) => {
                  setFolderNameTouched(true);
                  setFolderName(e.target.value);
                }}
                fullWidth
                size="small"
                disabled={createMutation.isPending}
                helperText={intl.formatMessage({ id: 'cases.fieldFolderNameHelp' })}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={createMutation.isPending}>
          <FormattedMessage id="cases.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit}
          pending={createMutation.isPending}
        >
          <FormattedMessage id="cases.createSubmit" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}

/** A case record's `openedAt` payload field, or `''` if absent — sort-safe fallback rather than
 *  `undefined` reaching `localeCompare`. */
function openedAtOf(record: RecordResponse): string {
  const value = record.payload?.openedAt;
  return typeof value === 'string' ? value : '';
}

/** The distinct `org:<id>` values a set of case records carries, in first-seen order. */
function distinctOrgIds(cases: ReadonlyArray<RecordResponse>): string[] {
  const seen = new Set<string>();
  for (const c of cases) {
    const orgScope = (c.scopes ?? []).find((s) => s.startsWith('org:'));
    if (orgScope) seen.add(orgScope.slice('org:'.length));
  }
  return [...seen];
}

/** Every case in one org, following `nextCursor` to completion via `drainPages` — `listRecords`
 *  defaults to a 20-record page (the SDK's own documented default), so a single un-paged call
 *  silently drops every case past the first page for any org with more than 20. `drainPages` also
 *  bounds the drain (fails closed at its default `maxPages`) rather than looping forever against a
 *  cursor that never resolves. */
async function fetchAllCasesForOrg(orgId: string): Promise<RecordResponse[]> {
  return drainPages((startFrom) =>
    vectrosApiClient().records.listRecords({
      type: 'case',
      scope: `org:${orgId}`,
      ...(startFrom ? { startFrom } : {}),
    }),
  );
}

export interface CasesFetchResult {
  readonly data: RecordResponse[];
  /** Orgs whose fetch failed while others succeeded — surfaced as a non-blocking warning rather
   *  than discarding the orgs that DID load. Empty on a real status filter (single call, no
   *  per-org fan-out) and on full success. */
  readonly failedOrgCount: number;
}

export function CasesListPage(): React.JSX.Element {
  const intl = useIntl();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { can: canPerformAction, identity, loading: scopeLoading } = useScopeGate();
  const canCreate = canPerformAction('records:c:case');
  const [statusFilter, setStatusFilter] = useState('all');
  const [createOpen, setCreateOpen] = useState(false);

  // `statusFilter === 'all'` fans `listRecords` out over the caller's own ORGS (from
  // `useAccessibleOrgs`, the same discovery `CreateCaseDialog`'s own org picker below already
  // uses) rather than one unfiltered call — neither `lookupRecords` with `values` omitted nor
  // `listRecords({ type: 'case' })` with no scope param satisfies either role's token scope (both
  // 400 against the live API); supplying `scope=org:<id>` explicitly, one call per org the caller
  // can actually reach, satisfies both roles' gates and lets the platform's own row-level
  // ownership filter narrow the rest (case-handler's client scope) automatically. A case belongs
  // to exactly one org, so per-org pages never overlap — no de-dup needed on merge. A real status
  // filter (below) is unaffected — `lookupRecords` never had this upfront gate at all.
  //
  // Three properties the fan-out itself needs, beyond just issuing N calls:
  // (1) EACH org's own results must be fully paged (`fetchAllCasesForOrg` drains `nextCursor` to
  //     completion via `drainPages` — the same fail-closed paginator `ui/admin-app` and
  //     `ui/app-vectros-ai` each carry their own copy of) — `listRecords` defaults to a 20-record
  //     page, so a single un-paged call per org would silently drop any org's cases past its
  //     first 20, and an un-bounded loop would hang forever against a cursor that never resolves.
  // (2) One org's failure must not blank every other org's successful data — `Promise.allSettled`,
  //     not `Promise.all`, so a transient error on one org doesn't discard the rest.
  // (3) The query must actually refetch when the caller's own accessible-org SET changes (a new
  //     membership grant landing while this page stays mounted) — the query key includes the
  //     resolved org ids (sorted, for a stable key across re-renders in the same set), not just
  //     `statusFilter`, so `myOrgIds` growing invalidates the cache entry that depended on the old
  //     set.
  const myUserId = identity.partnerUserId;
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';
  const accessibleOrgs = useAccessibleOrgs(hasUserId ? myUserId : undefined, hasUserId);
  const myOrgIds = accessibleOrgs.orgs
    .map((o) => o.id)
    .filter((id): id is string => typeof id === 'string');
  const sortedOrgIdsKey = [...myOrgIds].sort();
  const casesQuery = useQuery({
    queryKey:
      statusFilter === 'all'
        ? [...dataQueryKeys.cases(statusFilter), sortedOrgIdsKey]
        : dataQueryKeys.cases(statusFilter),
    queryFn: async (): Promise<CasesFetchResult> => {
      if (statusFilter !== 'all') {
        // Drained to completion, not a single un-paged call — the 'all' branch below already
        // does this via `fetchAllCasesForOrg`; this branch was missing the same treatment, so a
        // caller with more than 20 cases in one status silently lost the rest.
        const result = await drainPages((startFrom) =>
          vectrosApiClient().records.lookupRecords({
            type: 'case',
            field: 'status,assignedTo',
            values: [statusFilter],
            ...(startFrom ? { startFrom } : {}),
          }),
        );
        // Sorted the same way the 'all' branch is, so toggling the filter doesn't visibly
        // reorder the same rows for reasons unrelated to the filter itself.
        const data = [...result].sort((a, b) => openedAtOf(a).localeCompare(openedAtOf(b)));
        return { data, failedOrgCount: 0 };
      }
      const settled = await Promise.allSettled(myOrgIds.map(fetchAllCasesForOrg));
      const failedOrgCount = settled.filter((r) => r.status === 'rejected').length;
      if (failedOrgCount > 0 && failedOrgCount === settled.length) {
        // Every org failed -- nothing to show, so this is a real error, not a partial one.
        const first = settled.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
        throw first?.reason ?? new Error('Failed to load cases for every accessible org.');
      }
      const data = settled
        .filter((r): r is PromiseFulfilledResult<RecordResponse[]> => r.status === 'fulfilled')
        .flatMap((r) => r.value)
        .sort((a, b) => openedAtOf(a).localeCompare(openedAtOf(b)));
      return { data, failedOrgCount };
    },
    // The 'all' branch needs the caller's own org ids resolved first; a real status filter
    // doesn't depend on `accessibleOrgs` at all, so it isn't gated on it finishing.
    enabled: hasUserId && (statusFilter !== 'all' || accessibleOrgs.isSuccess),
  });
  // `accessibleOrgs.isError` must be checked explicitly here: `casesQuery` is only ever ENABLED
  // once `accessibleOrgs.isSuccess` (for the 'all' branch), so if org discovery itself fails,
  // `casesQuery` never runs at all and its own `isPending`/`isError` stay at their unhelpful
  // "never enabled" defaults (a disabled react-query reports `isPending: true` forever, with no
  // way to distinguish "loading" from "never going to load") -- without this check the page would
  // spin forever with no error shown, the same trap `CaseDetailPage`'s entries list hit before.
  const orgDiscoveryFailed = statusFilter === 'all' && accessibleOrgs.isError;
  const casesPending = !hasUserId || (!orgDiscoveryFailed && casesQuery.isPending);
  const casesError = orgDiscoveryFailed ? accessibleOrgs.error : casesQuery.isError ? casesQuery.error : undefined;
  const casesSuccess = !casesPending && !casesError;
  const cases = casesQuery.data?.data ?? [];
  const failedOrgCount = casesQuery.data?.failedOrgCount ?? 0;

  // Org column: only shown when the caller can see more than one org — a
  // single-org caller's cases are all implicitly "their org", and showing a
  // column that's always the same value would just be noise.
  const orgIds = distinctOrgIds(cases);
  const showOrgColumn = orgIds.length > 1;
  // `accessibleOrgs.orgs` already carries every org's name (fetched moments earlier, above) — only
  // fetch an org's entity here if it's NOT already in that set. That's structurally always true for
  // the 'all' branch (every case's org came from `myOrgIds` in the first place) but not guaranteed
  // for a real status filter's `lookupRecords` results, which can include a case reachable through
  // a different clause (e.g. case-handler's client-scoped read) for an org the caller never
  // founded or joined.
  const knownOrgNameById: Record<string, string> = {};
  accessibleOrgs.orgs.forEach((o) => {
    if (o.id && o.name) knownOrgNameById[o.id] = o.name;
  });
  const orgIdsNeedingFetch = showOrgColumn ? orgIds.filter((id) => !(id in knownOrgNameById)) : [];
  const orgQueries = useQueries({
    queries: orgIdsNeedingFetch.map((id) => ({
      queryKey: dataQueryKeys.org(id),
      queryFn: () =>
        vectrosApiClient().identity.getEntity({
          namespace: 'org',
          id,
          contextId: 'casework',
        }),
    })),
  });
  const orgNameById: Record<string, string> = { ...knownOrgNameById };
  orgIdsNeedingFetch.forEach((id, i) => {
    const name = orgQueries[i]?.data?.name;
    if (name) orgNameById[id] = name;
  });

  const isRefreshing = casesQuery.isFetching || orgQueries.some((q) => q.isFetching);
  const handleRefresh = (): void => {
    // Prefix-invalidate rather than targeting each individual query key — `orgQueries` is still a
    // dynamic array (one per distinct org id found in the returned cases), so a fixed list of keys
    // would silently miss whichever ones exist at refresh time.
    void queryClient.invalidateQueries({ queryKey: ['orgs'] });
    void queryClient.invalidateQueries({ queryKey: ['cases'] });
  };

  return (
    <Stack spacing={3}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        spacing={2}
      >
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          <FormattedMessage id="cases.title" />
        </Typography>
        <Stack direction="row" spacing={1} alignItems="center">
          <RefreshIconButton onRefresh={handleRefresh} isRefreshing={isRefreshing} />
          <Tooltip
            title={
              !canCreate && !scopeLoading ? intl.formatMessage({ id: 'cases.createForbidden' }) : ''
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
                <FormattedMessage id="cases.createButton" />
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {canCreate && (
        <CreateCaseDialog
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={(result) => {
            if (result.case.id) navigate(`/cases/${encodeURIComponent(result.case.id)}`);
          }}
        />
      )}

      <ToggleButtonGroup
        value={statusFilter}
        exclusive
        size="small"
        onChange={(_e, next: string | null) => {
          if (next !== null) setStatusFilter(next);
        }}
        aria-label={intl.formatMessage({ id: 'cases.filterStatus' })}
      >
        <ToggleButton value="all">
          <FormattedMessage id="cases.filterAll" />
        </ToggleButton>
        <ToggleButton value="open">
          <FormattedMessage id="cases.statusOpen" />
        </ToggleButton>
        <ToggleButton value="active">
          <FormattedMessage id="cases.statusActive" />
        </ToggleButton>
        <ToggleButton value="closed">
          <FormattedMessage id="cases.statusClosed" />
        </ToggleButton>
      </ToggleButtonGroup>

      {casesPending && <LoadingBlock label={intl.formatMessage({ id: 'cases.loading' })} />}

      {Boolean(casesError) && (
        <ApiErrorAlert error={casesError}>
          <FormattedMessage id="cases.loadError" />
        </ApiErrorAlert>
      )}

      {casesSuccess && failedOrgCount > 0 && (
        <Alert severity="warning" role="alert">
          <FormattedMessage id="cases.partialLoadError" values={{ count: failedOrgCount }} />
        </Alert>
      )}

      {casesSuccess && cases.length === 0 && (
        <EmptyStateCard messageId={statusFilter === 'all' ? 'cases.empty' : 'cases.emptyFiltered'} />
      )}

      {cases.length > 0 && (
        <TableContainer component={Paper}>
          <Table aria-label={intl.formatMessage({ id: 'cases.title' })}>
            <TableHead>
              <TableRow>
                <TableCell>
                  <FormattedMessage id="cases.columnType" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="cases.columnStatus" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="cases.columnOpened" />
                </TableCell>
                {showOrgColumn && (
                  <TableCell>
                    <FormattedMessage id="cases.columnOrg" />
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {cases.map((c, idx) => {
                const rowKey = c.id ?? `row-${idx}`;
                const rawCaseType = typeof c.payload?.caseType === 'string' ? c.payload.caseType : '';
                const caseType = rawCaseType
                  ? intl.formatMessage({ id: `cases.type.${rawCaseType}`, defaultMessage: rawCaseType })
                  : '—';
                const status = typeof c.payload?.status === 'string' ? c.payload.status : '—';
                const openedAt = typeof c.payload?.openedAt === 'string' ? c.payload.openedAt : '—';
                const orgId = (c.scopes ?? []).find((s) => s.startsWith('org:'))?.slice('org:'.length);
                return (
                  <TableRow key={rowKey} hover>
                    <TableCell>
                      <Link component={RouterLink} to={`/cases/${encodeURIComponent(c.id ?? '')}`}>
                        {caseType}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={status}
                        size="small"
                        color={STATUS_COLORS[status] ?? 'default'}
                      />
                    </TableCell>
                    <TableCell>{openedAt}</TableCell>
                    {showOrgColumn && (
                      <TableCell>{orgId ? (orgNameById[orgId] ?? orgId) : '—'}</TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  );
}

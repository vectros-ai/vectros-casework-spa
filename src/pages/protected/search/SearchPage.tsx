// ---------------------------------------------------------------------------
// SearchPage — unified hybrid search across cases, case entries, and case
// documents (path: `/search`).
//
// **hr-admin only, deliberately, for now.** `case-handler` holds `search:r` in
// its own blueprint clause too, but that clause's `dataScope` needs BOTH
// `scope:org` AND `scope:client`, and the search API's caller-filter is a
// single `namespace:value` string that can't carry both — the same
// platform-side limitation `CaseAskPanel`'s header comment documents for Ask.
// A `case-handler` reaching this screen would only ever see a 403, so the nav
// item/route is gated on `SEARCH_ACTION` (`scopeActions.ts`'s own comment has
// the full reasoning for why that's `TEAM_ACTION`, not `search:r` itself).
// Revisit once that platform-side limitation is fixed.
//
// **Org-scoped, one org at a time.** `hr-admin`'s `search:r` `dataScope` is
// single-dimension (`scope:org` only) — but the search API's caller-filter
// still only carries ONE `namespace:value` pair, so a caller reachable across
// more than one org needs a real choice of which org to search, not a fan-out
// (search is materially heavier than `listRecords`, not worth firing once per
// org for a first cut — see `OrgPickerField`'s use below).
//
// **Routing a result to its case**: a `case` result's `documentId` IS the
// case's own system id (`/cases/{documentId}` directly). A `case_note`/
// `case_document` result only carries its case's `externalId` (`caseId` in
// its search metadata, now `filterable` — see the blueprint's own comment on
// why it wasn't before), which the case DETAIL route needs resolved to the
// case's system id first (`CaseDetailPage`'s own header comment documents
// this exact externalId-vs-system-id trap). `SearchResultDisplay` below
// resolves it the same way `app-vectros-ai`'s `ReferenceLink` already does —
// best-effort: while pending, or unresolved (a dangling/pre-filterable-change
// reference), the result renders with no link rather than a dead one.
//
// `SearchResultCard`/`SearchModeToggle` are promoted primitives
// (`@vectros-ai/react`, `0.11.0`) — see that package's CHANGELOG for the full
// promotion note on what stayed app-local and why.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import { Link as RouterLink } from 'react-router';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { FormattedMessage, useIntl } from 'react-intl';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiErrorAlert, LoadingBlock, SearchModeToggle, SearchResultCard } from '@vectros-ai/react';
import type { SearchMode } from '@vectros-ai/react';

import { useScopeGate } from '../../../auth';
import { vectrosApiClient } from '../../../api/vectrosApi';
import type { SearchResultItem } from '../../../api/vectrosApi';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { OrgPickerField } from '../../../components/OrgPickerField';
import { EmptyStateCard } from '../../../components/EmptyStateCard';
import { useAccessibleOrgs } from '../../../hooks/useAccessibleOrgs';

/** Result page size — the API caps at 100; 25 is a reasonable page. */
const SEARCH_LIMIT = 25;
/** The API caps `offset` at 200, so paging stops once we'd cross it. */
const MAX_OFFSET = 200;

/** A non-empty string at `key` in a result's metadata, else undefined. */
function metaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = meta?.[key];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

export function SearchPage(): React.JSX.Element {
  const intl = useIntl();
  const { identity } = useScopeGate();
  const myUserId = identity.partnerUserId;
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';

  const [queryInput, setQueryInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('HYBRID');
  const [orgId, setOrgId] = useState('');

  const accessibleOrgs = useAccessibleOrgs(hasUserId ? myUserId : undefined, hasUserId);
  const orgs = accessibleOrgs.orgs;
  const showOrgPicker = orgs.length > 1;
  // A single-org caller never sees an EDITABLE picker (no real choice to offer) — pin the value
  // silently; `OrgPickerField` still shows them a disabled field naming the org (rendered
  // unconditionally below, same convention `CreateCaseDialog`'s own org picker actually uses —
  // it never hides the field, it lets `OrgPickerField` itself decide what to show).
  const effectiveOrgId = showOrgPicker ? orgId : (orgs[0]?.id ?? '');

  const searchQuery = useInfiniteQuery({
    queryKey: dataQueryKeys.search(effectiveOrgId, submittedQuery, mode),
    queryFn: ({ pageParam }) =>
      vectrosApiClient().search.content({
        query: submittedQuery,
        mode,
        limit: SEARCH_LIMIT,
        offset: pageParam,
        scope: `org:${effectiveOrgId}`,
      }),
    initialPageParam: 0,
    getNextPageParam: (_lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + (p.results?.length ?? 0), 0);
      const total = allPages[0]?.totalResults ?? loaded;
      if (loaded >= total || loaded > MAX_OFFSET) return undefined;
      return loaded;
    },
    enabled: submittedQuery !== '' && effectiveOrgId !== '',
  });

  const handleSubmit = (event: React.FormEvent): void => {
    event.preventDefault();
    setSubmittedQuery(queryInput.trim());
  };

  const pages = searchQuery.data?.pages ?? [];
  const results: ReadonlyArray<SearchResultItem> = pages.flatMap((p) => p.results ?? []);
  const totalResults = pages[0]?.totalResults ?? results.length;
  const degraded = pages.some((p) => p.degraded === true);
  // A DISABLED react-query reports `isPending: true` forever, same trap `CasesListPage`'s own
  // header comment documents — without these checks, `searchQuery.isPending` below would show a
  // spinner that never resolves in EITHER of two cases where `effectiveOrgId` can never become
  // non-empty: a multi-org caller who submits a query before picking an org (live-caught via the
  // smoke suite, `06-search.spec.ts`: the fixture smoke user belongs to more than one org), or
  // org discovery itself failing outright (the `ApiErrorAlert` above already covers messaging
  // for that case — `orgDiscoveryFailed` just has to keep the render ladder from ALSO falling
  // into the loading branch beneath it).
  //
  // `orgDiscoveryFailed` is gated on `effectiveOrgId === ''` too, not `accessibleOrgs.isError`
  // alone — `useAccessibleOrgs` can report `isError` while `orgs` still carries real, usable
  // entries (a PARTIAL failure: one membership-org's entity fetch 403s — a stale membership row,
  // or a deleted org — while the founder org and every other membership resolve fine). An
  // unconditional `isError` check would hide a genuinely working search result behind the
  // org-load error alert whenever ANY of possibly several org lookups failed, not just when
  // there's truly no org left to search.
  const orgDiscoveryFailed = accessibleOrgs.isError && effectiveOrgId === '';
  const awaitingOrgChoice = !orgDiscoveryFailed && showOrgPicker && effectiveOrgId === '';

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 700 }}>
          <FormattedMessage id="search.title" />
        </Typography>
        <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
          <FormattedMessage id="search.subtitle" />
        </Typography>
      </Box>

      {accessibleOrgs.isError && (
        <ApiErrorAlert error={accessibleOrgs.error}>
          <FormattedMessage id="search.orgsError" />
        </ApiErrorAlert>
      )}

      <Stack spacing={2}>
        <Box component="form" onSubmit={handleSubmit}>
          <TextField
            fullWidth
            size="small"
            label={intl.formatMessage({ id: 'search.queryLabel' })}
            value={queryInput}
            onChange={(e) => setQueryInput(e.target.value)}
            slotProps={{
              input: {
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      type="submit"
                      edge="end"
                      size="small"
                      aria-label={intl.formatMessage({ id: 'search.submit' })}
                      disabled={queryInput.trim() === ''}
                    >
                      <SearchIcon />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <SearchModeToggle
            value={mode}
            onChange={setMode}
            ariaLabel={intl.formatMessage({ id: 'search.modeLabel' })}
            labels={{
              hybrid: intl.formatMessage({ id: 'search.modeHybrid' }),
              semantic: intl.formatMessage({ id: 'search.modeSemantic' }),
              keyword: intl.formatMessage({ id: 'search.modeKeyword' }),
            }}
          />
          {orgs.length > 0 && (
            <OrgPickerField orgs={orgs} value={orgId} onChange={setOrgId} labelId="search.fieldOrg" sx={{ maxWidth: 260 }} />
          )}
        </Box>
      </Stack>

      {orgs.length === 0 && accessibleOrgs.isSuccess ? (
        <EmptyStateCard messageId="search.noOrgs" />
      ) : submittedQuery === '' ? (
        <Alert severity="info">
          <FormattedMessage id="search.prompt" />
        </Alert>
      ) : awaitingOrgChoice ? (
        <Alert severity="info">
          <FormattedMessage id="search.pickOrgPrompt" />
        </Alert>
      ) : orgDiscoveryFailed ? null : searchQuery.isPending ? (
        <LoadingBlock label={intl.formatMessage({ id: 'search.loading' })} />
      ) : searchQuery.isError ? (
        <ApiErrorAlert error={searchQuery.error}>
          <FormattedMessage id="search.error" />
        </ApiErrorAlert>
      ) : results.length === 0 ? (
        <Alert severity="info">
          <FormattedMessage id="search.empty" values={{ query: submittedQuery }} />
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            <FormattedMessage id="search.resultCount" values={{ count: totalResults }} />
          </Typography>

          {degraded && (
            <Alert severity="warning" role="alert">
              <FormattedMessage id="search.degraded" />
            </Alert>
          )}

          {results.map((r, index) => (
            <SearchResultDisplay key={`${r.documentId ?? 'result'}-${index}`} result={r} />
          ))}

          {searchQuery.hasNextPage && (
            <Button
              variant="outlined"
              onClick={() => void searchQuery.fetchNextPage()}
              disabled={searchQuery.isFetchingNextPage}
              startIcon={
                searchQuery.isFetchingNextPage ? <CircularProgress size={16} color="inherit" /> : undefined
              }
              sx={{ alignSelf: 'center' }}
            >
              <FormattedMessage id="search.loadMore" />
            </Button>
          )}
        </Stack>
      )}
    </Stack>
  );
}

interface SearchResultDisplayProps {
  readonly result: SearchResultItem;
}

/** One result, resolved to a title/chip/href by its `recordType` and rendered via the shared
 *  `SearchResultCard`. A `case_note`/`case_document` result's link depends on resolving its
 *  `caseId` (externalId) to the case's system id — same best-effort shape `app-vectros-ai`'s
 *  `ReferenceLink` already uses: never a dead link, just no link at all while pending or
 *  unresolved (a dangling reference, or a result reindexed before `caseId` became filterable).
 *  That resolve's `useQuery` is `enabled` only for a result that actually needs it (a `case`
 *  result already has its own id, no resolve needed) — React Query's own mechanism for a
 *  conditionally-needed query, not a second component split out to dodge the rules of hooks. */
function SearchResultDisplay({ result }: SearchResultDisplayProps): React.JSX.Element {
  const intl = useIntl();
  const recordType = metaString(result.metadata, 'recordType');
  const isCase = recordType === 'case';
  const isDocument = recordType === 'case_document';
  const snippet = result.contextText ?? result.chunkText ?? result.snippet ?? '';
  const similarity =
    typeof result.semanticScore === 'number' && result.semanticScore > 0
      ? Math.round(result.semanticScore * 100)
      : null;

  const typeLabelId = isCase ? 'search.typeCase' : recordType === 'case_note' ? 'search.typeCaseEntry' : 'search.typeDocument';

  const title = isCase
    ? (() => {
        const caseType = metaString(result.metadata, 'caseType');
        return caseType
          ? intl.formatMessage({ id: `cases.type.${caseType}`, defaultMessage: caseType })
          : intl.formatMessage({ id: typeLabelId });
      })()
    : (metaString(result.metadata, 'title') ??
      metaString(result.metadata, 'name') ??
      intl.formatMessage({ id: typeLabelId }));

  const cardProps = {
    title,
    typeLabel: intl.formatMessage({ id: typeLabelId }),
    typeColor: (isDocument ? 'primary' : 'secondary') as 'primary' | 'secondary',
    snippet,
    // `exactOptionalPropertyTypes`: only include a prop when there's a real value — passing an
    // explicit `undefined` violates the optional (no-explicit-undefined) prop contract.
    ...(result.documentId ? { idCaption: result.documentId } : {}),
    ...(result.createdAt
      ? { dateLabel: intl.formatDate(result.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }) }
      : {}),
    similarityPercent: similarity,
    similarityLabel: intl.formatMessage({ id: 'search.similarity' }),
  };

  const caseExternalId = isCase ? undefined : metaString(result.metadata, 'caseId');
  // Scale note, same tradeoff `ReferenceLink.tsx`'s own header comment discloses for the
  // identical resolve shape: each result with a distinct `caseId` fires its own lookup (React
  // Query dedupes identical ones via this query key, so results sharing a case cost one call,
  // not N) — fine for a results page (`SEARCH_LIMIT` = 25), not a batch resolve; there's no
  // batch-lookup endpoint on the SDK today.
  const lookupQuery = useQuery({
    queryKey: dataQueryKeys.caseByExternalId(caseExternalId ?? ''),
    queryFn: () =>
      vectrosApiClient().records.lookupRecordsByBody({
        type: 'case',
        field: 'externalId',
        value: caseExternalId as string,
      }),
    enabled: caseExternalId !== undefined,
    staleTime: 30_000,
  });

  const href = isCase
    ? result.documentId
      ? `/cases/${encodeURIComponent(result.documentId)}`
      : null
    : caseExternalId
      ? (() => {
          const caseId = lookupQuery.data?.data?.[0]?.id;
          return caseId ? `/cases/${encodeURIComponent(caseId)}` : null;
        })()
      : null;

  return <SearchResultCard {...cardProps} href={href} linkComponent={RouterLink} />;
}

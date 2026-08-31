// ---------------------------------------------------------------------------
// CaseDocumentsSection — the documents half of screen 3 (case detail): a list
// of the case's own attached files plus an upload control. Ported + adapted
// from app-vectros-ai's DocumentsPage — this app has no standalone document
// browser, so only the list-and-upload slice of that page applies.
//
// **Listing is `documents.lookupDocuments({type:'case_document', field:
// 'caseId', value: caseId})`**, not `listDocuments` — same reasoning as
// CaseDetailPage's own notes query (see its header comment): `documents:r`'s
// dataScope needs both `scope:org` AND `scope:client` for case-handler, which
// a single-param `listDocuments({scope, folderId})` call can't express either
// (no `lookupRecords`-equivalent coarse-check-then-post-filter path existed
// for documents before `case_document` declared a lookup field — it does
// now). `caseId` also fixes a real data-modeling error the folder-based
// version of this query had: a client can have more than one case, so a
// folder alone (scoped by the shared client compartment) couldn't reliably
// tell which case a document belonged to — `caseId` can, since it's a direct
// reference to the owning case record, not an ownership scope reused as an
// identifier.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Link,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiErrorAlert, LoadingBlock } from '@vectros-ai/react';

import { vectrosApiClient } from '../../../api/vectrosApi';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { drainPages } from '../../../lib/drainPages';
import { formatBytes } from '../../../lib/formatBytes';
import { AddCaseDocumentDialog } from './AddCaseDocumentDialog';

interface CaseDocumentsSectionProps {
  readonly caseId: string;
  /** This case's own folder id (the upload TARGET only — listing no longer
   *  depends on it). Undefined for a case that predates the `folderId` field. */
  readonly folderId: string | undefined;
  readonly orgScope: string;
  readonly clientScope: string;
  readonly canUpload: boolean;
}

export function CaseDocumentsSection({
  caseId,
  folderId,
  orgScope,
  clientScope,
  canUpload,
}: CaseDocumentsSectionProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | undefined>(undefined);
  const [downloadError, setDownloadError] = useState(false);

  const documentsQuery = useQuery({
    queryKey: dataQueryKeys.caseDocuments(caseId),
    // Drained to completion — see drainPages.ts's own header; a case with more than 20 documents
    // would otherwise silently drop the rest from this list.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().documents.lookupDocuments({
          type: 'case_document',
          field: 'caseId',
          value: caseId,
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
    enabled: caseId !== '',
  });
  const documents = documentsQuery.data ?? [];

  const downloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await vectrosApiClient().documents.getDocumentDownloadUrl({ id });
      if (!res.downloadUrl) throw new Error('no download URL');
      return res.downloadUrl;
    },
    onMutate: (id) => {
      setDownloadingId(id);
      setDownloadError(false);
    },
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    onError: () => setDownloadError(true),
    onSettled: () => setDownloadingId(undefined),
  });

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" component="h2">
          <FormattedMessage id="caseDetail.documentsTitle" />
        </Typography>
        {canUpload && (
          <Tooltip
            title={
              typeof folderId !== 'string'
                ? intl.formatMessage({ id: 'caseDetail.uploadDocumentNoFolder' })
                : ''
            }
          >
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<UploadFileIcon />}
                disabled={typeof folderId !== 'string'}
                onClick={() => setAddOpen(true)}
              >
                <FormattedMessage id="caseDetail.uploadDocumentCta" />
              </Button>
            </span>
          </Tooltip>
        )}
      </Stack>

      {documentsQuery.isPending && (
        <LoadingBlock label={intl.formatMessage({ id: 'caseDetail.documentsLoading' })} />
      )}
      {documentsQuery.isError && (
        <ApiErrorAlert error={documentsQuery.error}>
          <FormattedMessage id="caseDetail.documentsLoadError" />
        </ApiErrorAlert>
      )}
      {downloadError && (
        <Alert severity="error" role="alert">
          <FormattedMessage id="caseDetail.documentDownloadError" />
        </Alert>
      )}
      {documentsQuery.isSuccess && documents.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          <FormattedMessage id="caseDetail.documentsEmpty" />
        </Typography>
      )}
      {documents.length > 0 && (
        <Stack spacing={1.5}>
          {documents.map((doc, idx) => (
            <Card key={doc.id ?? `doc-${idx}`} variant="outlined">
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    {doc.id ? (
                      <Link
                        component="button"
                        variant="body2"
                        sx={{ fontWeight: 600, textAlign: 'left' }}
                        disabled={downloadingId === doc.id}
                        onClick={() => downloadMutation.mutate(doc.id ?? '')}
                      >
                        {doc.title || doc.id}
                      </Link>
                    ) : (
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                        {doc.title ?? '—'}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                      {formatBytes(doc.fileSize)}
                    </Typography>
                  </Box>
                  <Chip size="small" label={doc.indexStatus ?? '—'} />
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      {typeof folderId === 'string' && (
        <AddCaseDocumentDialog
          open={addOpen}
          caseId={caseId}
          folderId={folderId}
          orgScope={orgScope}
          clientScope={clientScope}
          onClose={() => setAddOpen(false)}
          onUploaded={() =>
            void queryClient.invalidateQueries({ queryKey: dataQueryKeys.caseDocuments(caseId) })
          }
        />
      )}
    </Stack>
  );
}

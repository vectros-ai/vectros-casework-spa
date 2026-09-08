// ---------------------------------------------------------------------------
// AddCaseDocumentDialog — upload a file onto this case. Ported + adapted from
// app-vectros-ai's AddDocumentDialog: this dialog only needs the upload half
// (this screen calls for "Upload document," never text-ingest), the
// folder is fixed to the case's own (no picker — a case has exactly one), and
// the type is fixed to `case_document` (no metadata-form picker — the schema's
// only field is `caseId`, stamped here, never user-editable). Places the
// document in the case's compartment explicitly (`scopes: [orgScope,
// clientScope]`) so it lands in the same dataScope every other case-owned
// record already stamps, mirroring `CaseDetailPage`'s own `addEntryMutation`
// — and stamps `payload: { caseId }` the same way that mutation stamps
// `case_note.caseId`, so `CaseDocumentsSection`'s `lookupDocuments` can find
// it again by case, not by folder.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Stack,
  Switch,
  Typography,
} from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { ApiErrorAlert, SubmitButton } from '@vectros-ai/react';

import { putBytesOrCompensate } from '../../../api/putBytesOrCompensate';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { vectrosApiClient } from '../../../api/vectrosApi';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { formatBytes } from '../../../lib/formatBytes';
import { MAX_UPLOAD_BYTES } from '../../../lib/uploadLimits';

interface AddCaseDocumentDialogProps {
  readonly open: boolean;
  readonly caseId: string;
  readonly folderId: string;
  readonly orgScope: string;
  readonly clientScope: string;
  readonly onClose: () => void;
  /** Called after a successful upload, so the caller can invalidate its list. */
  readonly onUploaded: () => void;
}

export function AddCaseDocumentDialog({
  open,
  caseId,
  folderId,
  orgScope,
  clientScope,
  onClose,
  onUploaded,
}: AddCaseDocumentDialogProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  // Default true — keep the extracted text retrievable and answerable by the
  // case's Ask panel; fixed at ingest time, matching the upstream dialog.
  const [storeText, setStoreText] = useState(true);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setStoreText(true);
  }, [open]);

  // The `case_document` schema binds the upload to the right document TYPE —
  // it declares no fields, so no metadata form is needed, only its id.
  const schemaQuery = useQuery({
    queryKey: dataQueryKeys.schemaByType('case_document'),
    queryFn: async () =>
      (await vectrosApiClient().schemas.listSchemas({ recordType: 'case_document' })).data?.[0],
    enabled: open,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('no file selected');
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new Error(intl.formatMessage({ id: 'addCaseDocument.fileTooLarge' }));
      }
      const schemaId = schemaQuery.data?.id;
      if (!schemaId) throw new Error('case_document schema not resolved');
      const fileType = file.type || 'application/octet-stream';
      const created = await vectrosApiClient().documents.uploadDocument({
        fileName: file.name,
        fileType,
        storeText,
        schemaId,
        folderId,
        scopes: [orgScope, clientScope],
        payload: { caseId },
      });
      // A document row EXISTS from here on, so every failure below has to undo
      // it. Both branches count: a missing presigned URL strands the document
      // just as surely as a rejected PUT, which is why the check sits INSIDE
      // the boundary rather than in front of it.
      await putBytesOrCompensate(created, file, fileType, (args) =>
        vectrosApiClient().documents.deleteDocument(args),
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.caseDocuments(caseId) });
      onUploaded();
      onClose();
    },
  });

  const fileTooLarge = file !== null && file.size > MAX_UPLOAD_BYTES;
  const canSubmit =
    !mutation.isPending &&
    file !== null &&
    !fileTooLarge &&
    typeof schemaQuery.data?.id === 'string';

  return (
    <Dialog open={open} onClose={() => !mutation.isPending && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>
        <FormattedMessage id="addCaseDocument.title" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {mutation.isError && (
            <ApiErrorAlert error={mutation.error}>
              <FormattedMessage id="addCaseDocument.error" />
            </ApiErrorAlert>
          )}

          <Box>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              aria-label={intl.formatMessage({ id: 'addCaseDocument.fileLabel' })}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => fileInputRef.current?.click()}
            >
              <FormattedMessage
                id={file ? 'addCaseDocument.changeFile' : 'addCaseDocument.chooseFile'}
              />
            </Button>
            {file ? (
              <Chip
                label={`${file.name} · ${formatBytes(file.size)}`}
                onDelete={() => setFile(null)}
                color={fileTooLarge ? 'error' : 'default'}
                variant="outlined"
                sx={{ mt: 1.5, maxWidth: '100%' }}
              />
            ) : (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
                <FormattedMessage id="addCaseDocument.noFileChosen" />
              </Typography>
            )}
            {fileTooLarge && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
                <FormattedMessage id="addCaseDocument.fileTooLarge" />
              </Typography>
            )}
            {mutation.isPending && (
              <LinearProgress
                sx={{ mt: 1.5 }}
                aria-label={intl.formatMessage({ id: 'addCaseDocument.uploading' })}
              />
            )}
            <FormControlLabel
              sx={{ mt: 1.5, display: 'block' }}
              control={
                <Switch checked={storeText} onChange={(e) => setStoreText(e.target.checked)} />
              }
              label={intl.formatMessage({ id: 'addCaseDocument.storeText' })}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              <FormattedMessage id="addCaseDocument.storeTextHelp" />
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={mutation.isPending}>
          <FormattedMessage id="addCaseDocument.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          onClick={() => mutation.mutate()}
          disabled={!canSubmit}
          pending={mutation.isPending}
        >
          <FormattedMessage id="addCaseDocument.upload" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}

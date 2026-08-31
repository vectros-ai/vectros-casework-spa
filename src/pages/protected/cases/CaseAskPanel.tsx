// ---------------------------------------------------------------------------
// CaseAskPanel — a chat-style RAG panel scoped to ONE case, reached from the
// case-detail screen. It's not a standalone nav item — there's no "ask across
// everything" mode, since RAG stays compartment-scoped by construction. Same
// useInferenceStream/ModelPicker/citations-rail mechanics as a plain ask
// screen, but:
//   - grounding is scoped via `RagSearch.filters: { caseId }`, not `folderId`
//     — narrower AND correct where folder scoping wasn't: `case_note` isn't
//     folder-attached at all (only `case_document` is), so a folder-scoped
//     search could never ground on a case's own entries, only its files.
//     `caseId` (both schemas declare it — see CaseDetailPage's header
//     comment) covers both content types uniformly, no folder/content-type
//     picker needed — there's exactly one case to search.
//   - each ask is still single-shot at the API (RagRequest carries no
//     conversation memory), but the panel keeps a local history of past
//     exchanges so it reads as a conversation. The PREVIOUS exchange (if
//     any) is finalized into `history` at the START of the next ask() —
//     imperative, not a `useEffect` reacting to the stream's own state
//     transitions, which raced the very render it was driving (a two-step
//     "push then reset" from inside an effect can commit as two separate
//     renders, transiently duplicating the previous answer across both the
//     history list and the still-live slot — finalizing at the point a
//     caller can next act removes the window entirely).
//
// **`RagSearch.scope` is REQUIRED, not optional — confirmed by tracing the
// actual authorization check, not assumed.** `RagSearch.filters` only
// narrows WHAT gets retrieved; it is never read by the platform's own
// data-scope authorization check, which is built exclusively from
// `RagSearch.scope`. Without it, BOTH roles' Ask requests 403 — hr-admin's
// access clause names `scope:org` as a real (non-wildcard) set, case-handler's
// names `scope:org` AND `scope:client`, and an absent filter on a named
// dimension fails the gate closed. This panel now sends `orgScope` — fixes
// hr-admin's Ask completely. It does NOT fix case-handler: `RagSearch.scope`
// is a single `namespace:value` string, and case-handler's access clause
// needs BOTH `org` and `client` at once, which one field can't carry —
// blocked on a platform-side limitation regardless of anything this app can
// do. Case-handler's Ask request still 403s until `RagSearch.scope` (or its
// replacement) can express more than one scope dimension at a time.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import { FormattedMessage, useIntl } from 'react-intl';
import { useInferenceStream } from '@vectros-ai/react';
import type { InferenceStreamState } from '@vectros-ai/react';
import type { Vectros } from '@vectros-ai/sdk';

import { vectrosApiClient } from '../../../api/vectrosApi';
import { ModelPicker } from '../../../components/ModelPicker';
import { InferenceErrorAlert } from '../../../components/InferenceErrorAlert';
import { useInferenceModels } from '../../../hooks/useInferenceModels';

interface CaseAskPanelProps {
  readonly open: boolean;
  /** The owning case's own record id — every ask is grounded to this case
   *  alone via `RagSearch.filters.caseId`. */
  readonly caseId: string;
  /** `"org:<id>"` — sent as `RagSearch.scope` so the request satisfies
   *  hr-admin's authorization clause (see the header comment above). NOT
   *  sufficient for case-handler, whose clause additionally needs
   *  `scope:client`; that half stays blocked on a platform-side limitation
   *  (see the header comment above). */
  readonly orgScope: string;
  readonly onClose: () => void;
}

interface Exchange {
  readonly id: string;
  readonly query: string;
  readonly snapshot: InferenceStreamState;
}

const SUGGESTED_PROMPT_IDS = ['caseAsk.suggestSummarize', 'caseAsk.suggestStatus'] as const;

function citationSnippet(c: Vectros.RagSearchResult): string {
  return c.snippet ?? c.chunkText ?? c.contextText ?? '';
}

export function CaseAskPanel({ open, caseId, orgScope, onClose }: CaseAskPanelProps): React.JSX.Element {
  const intl = useIntl();
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<Exchange[]>([]);
  const { state, run, cancel, reset, isStreaming } = useInferenceStream();
  // Gated on `open` — this panel is mounted (though hidden) for as long as
  // its case-detail page is, so an ungated fetch would cost every page view
  // one models-list round trip even when Ask is never opened.
  const modelsQuery = useInferenceModels(open);
  // The query text for the run currently in flight — InferenceStreamState
  // carries the answer, never the question that produced it.
  const askedQueryRef = useRef('');
  // A monotonic counter, not crypto.randomUUID() — this key never leaves the
  // component and never needs to be unguessable, only unique per exchange.
  const nextExchangeIdRef = useRef(0);

  useEffect(() => {
    const def = modelsQuery.data?.defaultModel;
    if (model === undefined && def) setModel(def);
  }, [model, modelsQuery.data]);

  // Each time the panel opens, start clean — no stale conversation from a
  // previously-viewed case.
  useEffect(() => {
    if (open) {
      setPrompt('');
      setHistory([]);
      reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset only on open, not on every reset identity change
  }, [open]);

  const ask = (q: string): void => {
    const trimmed = q.trim();
    if (trimmed === '' || isStreaming) return;
    // Finalize the PREVIOUS exchange (if any) into history before starting
    // this one — done imperatively here, synchronously with the click that
    // starts the new run, rather than reactively off a `state` transition.
    // A `useEffect` watching `state.status` and calling `setHistory` +
    // `reset()` raced this exact same rendering the "live" slot occupies
    // (`(isStreaming || state.text.length > 0) && <AskExchange live />`
    // below) — its own commit could still be in flight when a fast test (or
    // a fast typist) started the next ask, briefly duplicating the previous
    // answer across both the history list and the live slot. Finalizing at
    // the START of the next ask() has no such window: by the time a caller
    // can trigger it, the previous run has already finished rendering.
    if (state.status === 'done' || state.status === 'error') {
      nextExchangeIdRef.current += 1;
      setHistory((prev) => [
        ...prev,
        { id: String(nextExchangeIdRef.current), query: askedQueryRef.current, snapshot: state },
      ]);
    }
    askedQueryRef.current = trimmed;
    setPrompt('');
    const request: Vectros.RagRequest = {
      query: trimmed,
      ...(model !== undefined ? { model } : {}),
      // `scope` is what actually authorizes this request (the platform never
      // reads `filters` for that) — see the header comment. `filters.caseId`
      // narrows retrieval; `scope: orgScope` is what lets the call run at all.
      search: { filters: { caseId }, scope: orgScope },
    };
    run(({ abortSignal }) => vectrosApiClient().inference.ragInference(request, { abortSignal }));
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    // Ignore Enter mid-IME-composition (CJK etc.).
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      ask(prompt);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{ paper: { 'aria-label': intl.formatMessage({ id: 'caseAsk.title' }) } }}
    >
      <Stack spacing={2} sx={{ width: { xs: '100vw', sm: 480 }, p: 3, height: '100%' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
            <FormattedMessage id="caseAsk.title" />
          </Typography>
          <IconButton onClick={onClose} aria-label={intl.formatMessage({ id: 'caseAsk.close' })}>
            <CloseIcon />
          </IconButton>
        </Box>

        <ModelPicker value={model} onChange={setModel} disabled={isStreaming} enabled={open} />

        <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {/* A run that fails before its first content_delta has status
              'error' with empty text — check status too, not just whether
              any text arrived, or a genuine failure reverts straight back to
              the empty/suggested-prompts view with no error ever shown. */}
          {history.length === 0 &&
          !isStreaming &&
          state.text.length === 0 &&
          state.status !== 'error' ? (
            <Stack spacing={2}>
              <Alert severity="info">
                <FormattedMessage id="caseAsk.empty" />
              </Alert>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {SUGGESTED_PROMPT_IDS.map((id) => {
                  const label = intl.formatMessage({ id });
                  return <Chip key={id} label={label} onClick={() => ask(label)} clickable />;
                })}
              </Stack>
            </Stack>
          ) : (
            <List sx={{ width: '100%' }}>
              {history.map((exchange) => (
                <AskExchange key={exchange.id} query={exchange.query} snapshot={exchange.snapshot} />
              ))}
              {(isStreaming || state.text.length > 0 || state.status === 'error') && (
                <AskExchange query={askedQueryRef.current} snapshot={state} live />
              )}
            </List>
          )}
        </Box>

        <Divider />

        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            fullWidth
            multiline
            maxRows={4}
            size="small"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={intl.formatMessage({ id: 'caseAsk.placeholder' })}
            slotProps={{
              htmlInput: { 'aria-label': intl.formatMessage({ id: 'caseAsk.placeholder' }) },
            }}
            disabled={isStreaming}
          />
          {isStreaming ? (
            <IconButton color="error" onClick={cancel} aria-label={intl.formatMessage({ id: 'caseAsk.stop' })}>
              <StopIcon />
            </IconButton>
          ) : (
            <Button
              variant="contained"
              onClick={() => ask(prompt)}
              disabled={prompt.trim() === ''}
              startIcon={<SendIcon />}
            >
              <FormattedMessage id="caseAsk.submit" />
            </Button>
          )}
        </Box>
      </Stack>
    </Drawer>
  );
}

interface AskExchangeProps {
  readonly query: string;
  readonly snapshot: InferenceStreamState;
  /** True for the in-flight exchange (not yet snapshotted into history). */
  readonly live?: boolean;
}

function AskExchange({ query, snapshot, live }: AskExchangeProps): React.JSX.Element {
  const citations = snapshot.citations ?? [];
  return (
    <ListItem disableGutters sx={{ display: 'block', mb: 2 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {query}
      </Typography>
      {snapshot.status === 'error' ? (
        <>
          {snapshot.text.length > 0 && (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', mb: 1 }}>
              {snapshot.text}
            </Typography>
          )}
          <InferenceErrorAlert error={snapshot.error}>
            <FormattedMessage id="caseAsk.errorTitle" />
          </InferenceErrorAlert>
        </>
      ) : (
        <Box aria-live="polite" aria-busy={live || undefined}>
          {snapshot.text.length > 0 ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {snapshot.text}
            </Typography>
          ) : (
            <Box role="status" sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'text.secondary' }}>
              <CircularProgress size={16} />
              <Typography variant="body2">
                <FormattedMessage id="caseAsk.thinking" />
              </Typography>
            </Box>
          )}
          {citations.length > 0 && (
            <>
              <Typography variant="caption" sx={{ display: 'block', mt: 1, fontWeight: 700 }}>
                <FormattedMessage id="caseAsk.citationsTitle" />
              </Typography>
              <List dense disablePadding>
                {citations.map((c, i) => (
                  <ListItem key={`${c.documentId}-${i}`} alignItems="flex-start" disableGutters>
                    <Typography variant="caption" sx={{ wordBreak: 'break-word' }}>
                      {i + 1}. {citationSnippet(c) || <FormattedMessage id="caseAsk.citationNoPreview" />}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Box>
      )}
    </ListItem>
  );
}

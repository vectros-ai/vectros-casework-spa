// ---------------------------------------------------------------------------
// TeamPage — the context-wide member roster + the invite flow.
//
// This is a Captive Enterprise deployment (no self-signup at all — see
// LoginPage.tsx): there is exactly ONE onboarding mechanism in this app — an
// existing `hr-admin` inviting someone in. This screen is the only place
// that happens; the very first `hr-admin` is invited out-of-band, by
// whoever deploys the blueprint, using a root credential (see the
// deployment README) — never through this UI, since there's no signed-in
// caller to show it to yet.
//
// **Roster is CONTEXT-WIDE, not org-scoped** — `GET /v1/app-contexts/
// {contextId}/profiles` has no per-org filter, and under this app's own
// premise (one deployment = one company) that's rarely a real distinction in
// practice. Shows a member's email when the platform resolves one, falling
// back to the raw `principalId` otherwise — `hr-admin` does NOT hold `users:r`
// (tried and rejected; see the blueprint's own comment on that grant), so
// email currently never resolves for anyone. The fallback is what keeps this
// screen working regardless of how/whether that's ever revisited.
//
// **No resend action** — blocked on a real platform gap (`member-lifecycle`
// doesn't cover `POST /v1/users/invite/resend`, still filed and open). A
// pending invite that expires unaccepted just gets a fresh one sent.
// ---------------------------------------------------------------------------

import { useState } from 'react';
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
  Tooltip,
  Typography,
} from '@mui/material';
import { FormattedMessage, useIntl } from 'react-intl';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiErrorAlert, LoadingBlock, SubmitButton, extractErrorMessage } from '@vectros-ai/react';

import { useScopeGate } from '../../../auth';
import { CASEWORK_CONTEXT_ID, vectrosApiClient } from '../../../api/vectrosApi';
import type { EntityResponse } from '../../../api/vectrosApi';
import { inviteMember, InviteMembershipGrantError, type InviteRole } from '../../../api/inviteMember';
import { dataQueryKeys } from '../../../lib/dataQueryKeys';
import { RefreshIconButton } from '../../../components/RefreshIconButton';
import { EmptyStateCard } from '../../../components/EmptyStateCard';
import { OrgPickerField } from '../../../components/OrgPickerField';
import { SuccessAlert } from '../../../components/SuccessAlert';
import { useAccessibleOrgs } from '../../../hooks/useAccessibleOrgs';
import { drainPages } from '../../../lib/drainPages';

/** The blueprint's two real-user roles, in the order the picker offers them —
 *  `case-handler` first as the sensible default; `hr-admin` is a real,
 *  legitimate option (the platform's role-delegation check permits it —
 *  equal-authority invites are allowed), not hidden behind anything. */
const INVITE_ROLES: ReadonlyArray<InviteRole> = ['case-handler', 'hr-admin'];

const ROLE_LABEL_IDS: Record<InviteRole, string> = {
  'case-handler': 'team.roleCaseHandler',
  'hr-admin': 'team.roleHrAdmin',
};

const STATUS_LABEL_IDS: Record<string, string> = {
  active: 'team.statusActive',
  pending: 'team.statusPending',
  suspended: 'team.statusSuspended',
};

/** `team.statusPending` already existed in the message catalog, but this map never listed
 *  `pending` at all — a freshly-invited teammate's status fell through to the raw, unlocalized
 *  string, AND the color logic below rendered it "success" green, visually indistinguishable
 *  from an actually-active member. */
const STATUS_COLORS: Record<string, 'default' | 'warning' | 'success'> = {
  active: 'success',
  pending: 'warning',
  suspended: 'default',
};

interface InviteDialogProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onInvited: () => void;
}

function InviteDialog({ open, onClose, onInvited }: InviteDialogProps): React.JSX.Element {
  const intl = useIntl();
  const queryClient = useQueryClient();
  const { identity } = useScopeGate();
  const myUserId = identity.partnerUserId;
  const hasUserId = typeof myUserId === 'string' && myUserId !== '';
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [role, setRole] = useState<InviteRole>('case-handler');
  const [orgId, setOrgId] = useState('');

  // Founder orgs UNION member-only orgs (`useAccessibleOrgs`).
  // CORRECTED (this pass): this used to be the FOUNDER set alone
  // (`orgsFounded()`), on the premise that the org+membership `entities:r:org`
  // clause is for "I already know the org id" reads, not discovery — true for
  // the ORG entity read itself, but that premise missed that `hr-admin` also
  // holds a self-only `records:r:org_membership` read (added the same session
  // this comment used to predate) specifically FOR discovery, mirroring
  // case-handler's own. An hr-admin invited into (not founding) an org now
  // shows up here too — see `useAccessibleOrgs`'s own header comment for the
  // full mechanism.
  const orgsQuery = useAccessibleOrgs(hasUserId ? myUserId : undefined, open);
  const orgs: ReadonlyArray<EntityResponse> = orgsQuery.orgs;
  // No EDITABLE choice to offer when there's exactly one org — OrgPickerField still shows a
  // disabled field naming it, same pattern the case-creation dialog's own picker uses.
  const needsOrgPicker = orgs.length > 1;
  const effectiveOrgId = needsOrgPicker ? orgId : (orgs[0]?.id ?? '');

  const handleClose = (): void => {
    if (inviteMutation.isPending) return;
    setEmail('');
    setFirstName('');
    setRole('case-handler');
    setOrgId('');
    inviteMutation.reset();
    onClose();
  };

  const inviteMutation = useMutation({
    mutationFn: () =>
      inviteMember({
        email: email.trim(),
        ...(firstName.trim() ? { firstName: firstName.trim() } : {}),
        role,
        orgId: effectiveOrgId,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataQueryKeys.team() });
      setEmail('');
      setFirstName('');
      setRole('case-handler');
      setOrgId('');
      onInvited();
    },
    // inviteMember.ts's own header doc says a step-2
    // (org-membership grant) failure after step-1 (the invite itself) succeeds is
    // "recoverable, not... the whole invite failed" — but nothing here honored that
    // distinction until now. A step-2 failure still means a PENDING profile now
    // exists (the invite email is on its way), so the roster is invalidated the
    // same as a full success — just without resetting the form/closing the dialog,
    // since the org grant itself still needs the caller's attention (see the error
    // alert below, which shows a different message for this case).
    onError: (error) => {
      if (error instanceof InviteMembershipGrantError) {
        void queryClient.invalidateQueries({ queryKey: dataQueryKeys.team() });
      }
    },
  });

  const trimmedEmail = email.trim();
  // A crude but adequate client-side shape check — the platform is the real
  // validator; this only avoids an obviously-empty submit.
  const emailLooksValid = /^\S+@\S+\.\S+$/.test(trimmedEmail);
  const canSubmit =
    emailLooksValid &&
    effectiveOrgId !== '' &&
    !inviteMutation.isPending &&
    (!open || orgsQuery.isSuccess);

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <FormattedMessage id="team.inviteTitle" />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 1 }}>
          {orgsQuery.isPending && (
            <LoadingBlock label={intl.formatMessage({ id: 'team.loadingOrgs' })} />
          )}
          {orgsQuery.isError && (
            <ApiErrorAlert error={orgsQuery.error}>
              <FormattedMessage id="team.orgsError" />
            </ApiErrorAlert>
          )}
          {orgsQuery.isSuccess && orgs.length === 0 && (
            <Alert severity="warning" role="alert">
              <FormattedMessage id="team.noOrgs" />
            </Alert>
          )}
          {orgsQuery.isSuccess && orgs.length > 0 && (
            <>
              <TextField
                label={intl.formatMessage({ id: 'team.fieldEmail' })}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                size="small"
              />
              <TextField
                label={intl.formatMessage({ id: 'team.fieldFirstName' })}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                size="small"
              />
              <TextField
                select
                label={intl.formatMessage({ id: 'team.fieldRole' })}
                value={role}
                onChange={(e) => setRole(e.target.value as InviteRole)}
                size="small"
              >
                {INVITE_ROLES.map((r) => (
                  <MenuItem key={r} value={r}>
                    {intl.formatMessage({ id: ROLE_LABEL_IDS[r] })}
                  </MenuItem>
                ))}
              </TextField>
              <OrgPickerField orgs={orgs} value={orgId} onChange={setOrgId} labelId="team.fieldOrg" required />
            </>
          )}
          {inviteMutation.isError && (() => {
            // A step-2 (org-membership grant) failure means the invite itself
            // went out — a different message than "the whole invite failed",
            // and the DETAIL/request-id below should describe the underlying
            // membership-grant failure, not this wrapper (which has neither).
            const isMembershipGrantError = inviteMutation.error instanceof InviteMembershipGrantError;
            const detailError = isMembershipGrantError
              ? inviteMutation.error.cause
              : inviteMutation.error;
            return (
              <ApiErrorAlert error={detailError}>
                <FormattedMessage
                  id={isMembershipGrantError ? 'team.inviteMembershipGrantError' : 'team.inviteError'}
                />
                {extractErrorMessage(detailError) && (
                  <Typography variant="caption" component="p" sx={{ mt: 0.5, opacity: 0.85 }}>
                    {extractErrorMessage(detailError)}
                  </Typography>
                )}
              </ApiErrorAlert>
            );
          })()}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={inviteMutation.isPending}>
          <FormattedMessage id="team.cancel" />
        </Button>
        <SubmitButton
          variant="contained"
          disabled={!canSubmit}
          pending={inviteMutation.isPending}
          onClick={() => inviteMutation.mutate()}
        >
          <FormattedMessage id="team.inviteCta" />
        </SubmitButton>
      </DialogActions>
    </Dialog>
  );
}

export function TeamPage(): React.JSX.Element {
  const intl = useIntl();
  const { can: canPerformAction, loading: scopeLoading } = useScopeGate();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [justInvited, setJustInvited] = useState(false);

  const rosterQuery = useQuery({
    queryKey: dataQueryKeys.team(),
    // Drained to completion, not a single un-paged call — `listAccessProfiles` defaults to a
    // 20-item page (same SDK-documented default `fetchAllCasesForOrg` drains around for cases),
    // so a deployment with more than 20 team members would otherwise silently lose everyone past
    // the first page, with no error and no "load more" to reach them. Live-found 2026-08-29: this
    // session's own repeated smoke runs pushed a real roster past 20 for the first time, and a
    // freshly-invited member landed on a page this screen never fetched.
    queryFn: () =>
      drainPages((startFrom) =>
        vectrosApiClient().auth.listAccessProfiles({
          contextId: CASEWORK_CONTEXT_ID,
          ...(startFrom ? { startFrom } : {}),
        }),
      ),
  });
  // Neither `roleId` nor `roleIds` set means `scopes` is (they're mutually exclusive per
  // AccessProfileResponse) — an INLINE-scoped profile, not a role-referencing one. Every human
  // grant this app ever authors (self-invite or Team-screen invite) is role-referencing; the one
  // thing that isn't is the platform's own auto-created SERVICE principal for this context (see
  // this blueprint's top-level `accessProfile:` block, deliberately inline-scoped and minimal).
  // Filtered OUT of the roster entirely now (previously only labeled distinctly) — a screen meant
  // to show "who has access" for a human admin to manage shouldn't make them read past the
  // platform's own internal service account to find their actual team.
  const roster = (rosterQuery.data ?? []).filter(
    (profile) => profile.roleId || (profile.roleIds && profile.roleIds.length > 0),
  );

  const canInvite = canPerformAction('profiles:c');

  const handleInvited = (): void => {
    setInviteOpen(false);
    setJustInvited(true);
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
            <FormattedMessage id="team.title" />
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            <FormattedMessage id="team.subtitle" />
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
          <RefreshIconButton
            onRefresh={() => void rosterQuery.refetch()}
            isRefreshing={rosterQuery.isFetching}
          />
          <Tooltip
            title={
              !canInvite && !scopeLoading ? intl.formatMessage({ id: 'team.inviteForbidden' }) : ''
            }
          >
            <span style={{ flexShrink: 0 }}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => setInviteOpen(true)}
                disabled={!canInvite}
                sx={{ whiteSpace: 'nowrap' }}
              >
                <FormattedMessage id="team.inviteButton" />
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Stack>

      {justInvited && (
        <SuccessAlert onDismiss={() => setJustInvited(false)}>
          <FormattedMessage id="team.inviteSuccess" />
        </SuccessAlert>
      )}

      {rosterQuery.isPending && (
        <LoadingBlock label={intl.formatMessage({ id: 'team.loading' })} />
      )}

      {rosterQuery.isError && (
        <ApiErrorAlert error={rosterQuery.error}>
          <FormattedMessage id="team.loadError" />
        </ApiErrorAlert>
      )}

      {rosterQuery.isSuccess && roster.length === 0 && <EmptyStateCard messageId="team.empty" />}

      {roster.length > 0 && (
        <TableContainer component={Paper}>
          <Table aria-label={intl.formatMessage({ id: 'team.title' })}>
            <TableHead>
              <TableRow>
                <TableCell>
                  <FormattedMessage id="team.columnPrincipal" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="team.columnRole" />
                </TableCell>
                <TableCell>
                  <FormattedMessage id="team.columnStatus" />
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {roster.map((profile, idx) => {
                const rowKey = profile.id ?? profile.principalId ?? `row-${idx}`;
                // A profile composing 2+ roles has no singular `roleId` (the platform's own
                // multi-role composition feature) — this app never authors that shape itself,
                // but a roster reading someone else's deployment should still render SOMETHING
                // rather than a blank cell.
                const roleLabelId = profile.roleId ? ROLE_LABEL_IDS[profile.roleId as InviteRole] : undefined;
                const roleLabel = roleLabelId
                  ? intl.formatMessage({ id: roleLabelId })
                  : (profile.roleIds?.join(', ') ?? '—');
                const statusLabelId = profile.status ? STATUS_LABEL_IDS[profile.status] : undefined;
                // `email` resolves only for a `usr_` principal AND only if this credential holds
                // `users:r` — `hr-admin` currently does not (tried and rejected; see the blueprint's
                // own comment on that grant), so this is always undefined today. A `key_` (API key)
                // principal never has one either way. Falls back to the raw principalId so the row
                // still reads as SOMETHING rather than blank, and needs no further change whenever/
                // however email resolution eventually gets enabled.
                const hasEmail = typeof profile.email === 'string' && profile.email.length > 0;
                return (
                  <TableRow key={rowKey} hover>
                    <TableCell>
                      {hasEmail ? (
                        <Stack spacing={0}>
                          <Typography variant="body2">{profile.email}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {profile.principalId}
                          </Typography>
                        </Stack>
                      ) : (
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          {profile.principalId}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>{roleLabel}</TableCell>
                    <TableCell>
                      <Chip
                        label={statusLabelId ? intl.formatMessage({ id: statusLabelId }) : (profile.status ?? '—')}
                        size="small"
                        color={profile.status ? (STATUS_COLORS[profile.status] ?? 'default') : 'default'}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvited={handleInvited}
      />
    </Stack>
  );
}

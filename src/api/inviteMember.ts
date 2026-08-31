// ---------------------------------------------------------------------------
// inviteMember — a single abstraction over what is genuinely a TWO-call
// sequence today: invite the person (grants them a ROLE — the actions they
// may perform), then grant them org-level SCOPE (an org_membership row —
// which org those actions reach) via a separate write. Deliberately kept
// behind one function, same reasoning as createCase.ts: no composed-write
// endpoint exists today, so the client drives the sequence, with no
// rollback if the second call fails after the first succeeds. If it does,
// the invite still exists (the person can still accept it) — only their
// org-level access needs a retry, so the caller should treat that failure
// as recoverable, not as "the whole invite failed."
// ---------------------------------------------------------------------------

import { CASEWORK_CONTEXT_ID, vectrosApiClient } from './vectrosApi';
import type { RecordResponse, Vectros } from './vectrosApi';

/** `casework.blueprint.yaml`'s two real-user roles. */
export type InviteRole = 'case-handler' | 'hr-admin';

export interface InviteMemberInput {
  readonly email: string;
  readonly firstName?: string;
  readonly role: InviteRole;
  /** The org this invitee should reach immediately on accept — its
   *  `org_membership` row's `scope:org`. */
  readonly orgId: string;
}

export interface InviteMemberResult {
  readonly invite: Vectros.CreateInviteResponse;
  readonly membership: RecordResponse;
}

/**
 * Thrown when step 1 (the invite itself) SUCCEEDED but step 2 (the
 * org-membership grant) failed. A caller showing the same generic "invite
 * failed" message for this case as for a step-1 failure gives no signal that
 * the invitee already has a usable invite link, which contradicts this
 * file's own header doc on how a step-2 failure should be treated. Carries
 * the successful `invite` result so a caller can still act on it (e.g. tell
 * the person their invite email is on the way, or invalidate a roster query
 * that shows pending invites).
 */
export class InviteMembershipGrantError extends Error {
  readonly invite: Vectros.CreateInviteResponse;
  override readonly cause: unknown;

  constructor(invite: Vectros.CreateInviteResponse, cause: unknown) {
    super(
      cause instanceof Error
        ? `Invite sent, but the org-level access grant failed: ${cause.message}`
        : 'Invite sent, but the org-level access grant failed.',
    );
    this.name = 'InviteMembershipGrantError';
    this.invite = invite;
    this.cause = cause;
  }
}

/**
 * Invites a new person into this deployment and grants them org-level
 * membership in one logical operation. See this file's header for why it's
 * two real HTTP calls today, and how a caller should treat a step-2 failure
 * — thrown as {@link InviteMembershipGrantError}, distinct from an ordinary
 * `Error` for a step-1 failure, so a caller can tell the two apart.
 */
export async function inviteMember(input: InviteMemberInput): Promise<InviteMemberResult> {
  const api = vectrosApiClient();
  const trimmedEmail = input.email.trim();
  const trimmedFirstName = input.firstName?.trim();

  // 1. Invite — creates a PENDING user and binds their role-based access
  //    profile in this context. Returns the new principal's userId
  //    immediately, before they've accepted.
  //
  //    `acceptUrl` is REQUIRED whenever `sendEmail` is true (the platform's
  //    own default), and the platform has no built-in notion of this app's
  //    own URL — it's entirely caller-supplied per invite. `window.location.origin`
  //    at call time, not a build-time env var: self-adapts to wherever this
  //    deployment actually lives (localhost, a Vercel preview, production, a
  //    custom domain later) with nothing to keep in sync. Must be `https://`
  //    in any real deployment (rejected for `http://`, except
  //    for the operator's own out-of-band first-admin `sendEmail: false` call
  //    documented in this app's README, which skips this validation).
  const invite = await api.auth.createInvite({
    email: trimmedEmail,
    contextId: CASEWORK_CONTEXT_ID,
    accessProfile: { roleId: input.role },
    acceptUrl: `${window.location.origin}/accept`,
    ...(trimmedFirstName ? { firstName: trimmedFirstName } : {}),
  });
  const targetUserId = invite.userId;
  if (!targetUserId) {
    throw new Error('inviteMember: the platform did not return a userId for the invite.');
  }

  // 2. Grant org-level membership — separate from the role grant above.
  //    `level: 'member'` by convention (not 'admin') for every invite this
  //    screen sends; there is no UI to invite someone directly as an
  //    org-level admin-level member.
  //
  //    `userId: targetUserId` (the ownership STAMP, distinct from the
  //    `targetUserId` PAYLOAD field above) is required — without it this
  //    record defaults to the CALLER's identity (the inviting hr-admin), not
  //    the invitee, per the SDK's own `RecordRequest.userId` doc ("may be set
  //    automatically from the calling token's identity"). The stamp is what
  //    lets `case-handler`'s own narrow, self-only `records:r:org_membership`
  //    read grant (`casework.blueprint.yaml`) actually find this row —
  //    without it, that discovery grant stays permanently vacuous no matter
  //    how many invites are sent. Authorized by hr-admin's own
  //    `records:crud:org_membership` clause naming `userId: ['${{ any }}']`.
  let membership: RecordResponse;
  try {
    membership = await api.records.createRecord({
      body: {
        typeName: 'org_membership',
        scopes: [`org:${input.orgId}`],
        userId: targetUserId,
        payload: { targetUserId, level: 'member' },
      },
    });
  } catch (cause) {
    throw new InviteMembershipGrantError(invite, cause);
  }

  return { invite, membership };
}

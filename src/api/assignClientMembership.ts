// ---------------------------------------------------------------------------
// assignClientMembership — grants an EXISTING member (case-handler or
// hr-admin) access to a client they didn't found, via a `client_membership`
// row. `hr-admin`-only in practice: `casework.blueprint.yaml`'s
// `records:crud:client_membership` grant belongs to that role alone —
// `case-handler` holds no create/update/delete reach on this schema at all,
// deliberately (a prior review pass found and removed a real self-escalation
// hole here, 2026-08-21 — see the blueprint's own comment on that removal).
//
// This is what makes `entities:r:client`'s founder-or-member narrowing (item
// C's data-isolation pass) actually usable: without a way to WRITE a
// `client_membership` row, a case-handler who didn't found a client could
// never reach one, full stop — see `useAccessibleClients`'s own header
// comment for the discovery side of this same mechanism.
// ---------------------------------------------------------------------------

import { vectrosApiClient } from './vectrosApi';
import type { RecordResponse } from './vectrosApi';

export type ClientMembershipLevel = 'admin' | 'member';

export interface AssignClientMembershipInput {
  readonly orgId: string;
  readonly clientId: string;
  /** The target's Vectros user id (`AccessProfileResponse.principalId` from
   *  the roster, `GET /v1/app-contexts/{contextId}/profiles` — the same id
   *  space `inviteMember.ts`'s own `targetUserId` resolves into). */
  readonly targetUserId: string;
  readonly level: ClientMembershipLevel;
}

/**
 * `userId: targetUserId` is the ownership STAMP (distinct from the
 * `targetUserId` PAYLOAD field) — required so the row defaults to the
 * TARGET's identity, not the calling hr-admin's own, same reasoning
 * `inviteMember.ts`'s own `org_membership` create documents. Authorized by
 * hr-admin's `records:crud:client_membership` clause, which as of this pass
 * names `userId: ['${{ any }}']` for exactly this reason (previously
 * missing — this schema was never written before, see that clause's own
 * comment in the blueprint).
 */
export async function assignClientMembership(
  input: AssignClientMembershipInput,
): Promise<RecordResponse> {
  return vectrosApiClient().records.createRecord({
    body: {
      typeName: 'client_membership',
      scopes: [`org:${input.orgId}`, `client:${input.clientId}`],
      userId: input.targetUserId,
      payload: { targetUserId: input.targetUserId, level: input.level },
    },
  });
}

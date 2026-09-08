// ---------------------------------------------------------------------------
// createCase — TWO calls: select or create the case's client entity, then run
// the `create-case` script, which creates the case's folder and the case record
// carrying that folder's id as ONE transaction. They commit together or not at
// all, so a failure part-way can no longer leave an orphan folder with no case.
//
// The client entity stays a separate call in front, and is NOT covered by that
// transaction: a script's host object reaches records, documents and folders,
// not identity entities. So a failure AFTER the entity is created still leaves
// a client with no case — a real residual, much smaller than the one this
// closed, and not fixable until a script can reach entities.
//
// Executing the script needs `scripts:x:create-case` — qualified to this one
// name, never a bare `scripts:x`, which would mean "may run every script in
// this context". The blueprint grants it on the two roles that create cases.
// AUTHORING a script remains a separate, admin-shaped surface: script rows
// carry no owner, so a create from an ordinary role — a clause with a bare,
// non-empty data scope, the shape every role here uses — is refused. That is
// why the script ships in the blueprint rather than being pushed by the app.
//
// The script's own writes are still checked one by one against the caller's
// data scopes, so this composes what a handler could already do by hand; it
// does not widen what data they can reach.
//
// **`client` is a real, reusable identity entity — NOT the case itself.** A
// client represents the person/subject a case is about; one client can have
// many cases over time (a later, second case for the same employee). So
// this function accepts EITHER an existing client's id (a returning
// client's next case) OR a name for a brand-new one (that client's first
// case) — never assumes the case creates its own compartment.
// ---------------------------------------------------------------------------

import { CASEWORK_CONTEXT_ID, vectrosApiClient } from './vectrosApi';
import type { EntityResponse } from './vectrosApi';

/** The `case` schema's `caseType` enum (casework.blueprint.yaml). */
export type CaseType =
  | 'grievance'
  | 'accommodation'
  | 'onboarding'
  | 'investigation'
  | 'leave_request';

export interface CreateCaseInput {
  /** The org this case belongs to — its compartment's `org:<id>` half. */
  readonly orgId: string;
  /**
   * Exactly one of `clientId`/`newClientName` must be supplied. `clientId`
   * selects an existing client (this org's returning employee, a second or
   * later case); `newClientName` creates a brand-new client entity scoped to
   * `orgId` (that person's first case) as part of this same call.
   */
  readonly clientId?: string;
  readonly newClientName?: string;
  readonly caseType: CaseType;
  /** userId of the case handler this case is assigned to, if known up front. */
  readonly assignedTo?: string;
  /** Display name for the case's own folder (document upload lands here). */
  readonly folderName: string;
  readonly folderDescription?: string;
  /**
   * Identifies ONE submission, stable across retries of it and different for a
   * genuinely new one. Every id this call mints is derived from it, and it is
   * sent as the execution's `Idempotency-Key`, so re-submitting after a lost or
   * failed response replays the first outcome instead of creating a second case.
   * The caller owns its lifetime: mint one per submission and mint a fresh one
   * whenever the form changes, because the platform compares a keyed request
   * byte for byte and refuses a changed body under a used key.
   */
  readonly submissionId: string;
}

/** What `create-case` returns. Ids only — see the execute call for why. */
interface CreateCaseScriptResult {
  readonly caseId?: string;
  readonly caseExternalId?: string;
  readonly folderId?: string;
}

export interface CreateCaseResult {
  /** The new case's system id — what the case route is keyed on. */
  readonly caseId: string;
  /** The new case's `externalId`, the key `case_note`/`case_document` reference. */
  readonly caseExternalId: string;
  /** The case's own folder, created in the same transaction. */
  readonly folderId: string;
  /** The client entity this case belongs to — newly created, or the one selected. */
  readonly client: EntityResponse;
}

/**
 * The stored script this call executes. Provisioned by the blueprint's own
 * `scripts:` block and granted per-role as `scripts:x:create-case` — qualified
 * to this one name, never a bare `scripts:x`.
 */
const CREATE_CASE_SCRIPT = 'create-case';

/** `YYYY-MM-DD`, matching the schema-ui date-field convention (recordForm.ts). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** This submission's client identifier — this app's own idempotency key, never
 *  shown to the user (the client entity's `name` is the human-facing one).
 *  DERIVED, not random: a retry of the same submission must produce the same
 *  value, or it creates a second client for the same person. */
function clientExternalIdFor(submissionId: string): string {
  return `client_${submissionId}`;
}

/** A fresh, per-case identifier — this is what `case_note.caseId`/
 *  `case_document.caseId` (both declared `fieldType: reference`,
 *  `targetField: externalId`) actually resolve against, per the platform's
 *  own reference mechanism (always resolves via a target's UNIQUE lookup,
 *  which defaults to `externalId` — there is no way to reference a record by
 *  its plain system id). Never shown to the user. */
function caseExternalIdFor(submissionId: string): string {
  return `case_${submissionId}`;
}

/**
 * Creates a case, its client entity (when needed), and its folder as one
 * logical operation. Two HTTP calls: the client entity, then the composed
 * script execution. See this file's header for which of them is atomic.
 */
export async function createCase(input: CreateCaseInput): Promise<CreateCaseResult> {
  if (!input.clientId && !input.newClientName) {
    throw new Error('createCase: one of clientId or newClientName is required.');
  }
  const api = vectrosApiClient();
  const orgScope = `org:${input.orgId}`;

  // 1. Resolve the client entity — select an existing one, or create a new
  //    one scoped to this org. Either way its id is known BEFORE the case is
  //    created, so the case's own compartment scope needs no patch step.
  const clientEntity = input.clientId
    ? await api.identity.getEntity({
        namespace: 'client',
        id: input.clientId,
        contextId: CASEWORK_CONTEXT_ID,
      })
    : await api.identity.createEntity({
        namespace: 'client',
        contextId: CASEWORK_CONTEXT_ID,
        body: {
          externalId: clientExternalIdFor(input.submissionId),
          name: (input.newClientName ?? '').trim(),
          scopes: [orgScope],
        },
      });
  const clientId = clientEntity.id;
  if (!clientId) {
    throw new Error('createCase: the platform did not return an id for the client entity.');
  }
  const compartmentScope = `client:${clientId}`;

  // 2. Folder + case record as ONE transaction. The folder must exist before
  //    the record can carry its id, and driven from here those were two
  //    independently-failing writes: a failure between them left an orphan
  //    folder and no case, with nothing to roll it back. Executed as a stored
  //    script they commit together or not at all.
  //
  //    The script takes `externalId` and `openedAt` from here rather than
  //    minting them itself — they are this client's own idempotency key and
  //    business date, and generating them inside the execution would make two
  //    attempts at the same case indistinguishable.
  //
  //    It returns ids, not objects: an execution's result is size-capped, and
  //    every caller re-reads through its own cache anyway.
  //    `Idempotency-Key` makes a re-submission safe rather than duplicating.
  //    Re-sending the same body under the same key within 24h replays the first
  //    response without executing again. It does NOT resolve an indeterminate
  //    outcome: an execution that exceeded its budget while its writes may have
  //    committed answers 500 EXECUTION_OUTCOME_UNKNOWN, and a keyed retry gets
  //    that same answer by design — inspect, then submit again for a new key.
  //    `openedAt` is in the body and rolls at UTC midnight, which falls inside the
  //    working day for much of the world. A retry that crosses it is a changed
  //    body under a used key, refused 422 — the safe direction, a visible error
  //    rather than a second case, but the caller cannot act on it: editing the
  //    form to clear the error mints a new identity and creates the duplicate.
  //    Deriving the business date from the submission would remove the boundary.
  const caseExternalId = caseExternalIdFor(input.submissionId);
  const execution = await api.scripts.executeScript({
    'Idempotency-Key': `case-create-${input.submissionId}`,
    scriptRef: { name: CREATE_CASE_SCRIPT, version: 'latest' },
    input: {
      caseExternalId,
      folderName: input.folderName,
      ...(input.folderDescription ? { folderDescription: input.folderDescription } : {}),
      caseType: input.caseType,
      openedAt: today(),
      ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
      scopes: [orgScope, compartmentScope],
    },
  });

  // The platform commits before it responds, so a missing field here is a
  // malformed result rather than a partial write. Each is named separately: the
  // two halves fail for different reasons and a single message sends whoever
  // debugs it into the wrong half of the script.
  const result = execution.result as CreateCaseScriptResult | undefined;
  if (!result?.caseId) {
    throw new Error('createCase: the create-case script returned no case id.');
  }
  if (!result.folderId) {
    throw new Error('createCase: the create-case script returned no folder id.');
  }
  if (result.caseExternalId !== caseExternalId) {
    // This is the key `case_note.caseId` and `case_document.caseId` resolve
    // against, so a value that is not the one written makes every later
    // reference to this case unresolvable.
    throw new Error('createCase: the create-case script echoed a different externalId.');
  }

  return {
    caseId: result.caseId,
    caseExternalId,
    folderId: result.folderId,
    client: clientEntity,
  };
}

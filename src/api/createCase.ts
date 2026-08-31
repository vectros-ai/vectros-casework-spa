// ---------------------------------------------------------------------------
// createCase — a single abstraction over what is genuinely a THREE-call
// sequence today: select or create the case's client entity, create the
// case record, then create its folder. Deliberately kept behind one function
// so every call site (the "+ New case" form, and anything added later) has
// exactly one place to update when this becomes a single atomic call — a
// real platform gap, not a client-side simplification we're choosing to
// skip: there is no composed-write endpoint today, so the client drives the
// sequence, with no rollback if a later step fails. That composition is a
// deliberately separate, larger piece of work — this function's whole point
// is to be the one place that later swap touches.
//
// **`client` is a real, reusable identity entity — NOT the case itself.** A
// client represents the person/subject a case is about; one client can have
// many cases over time (a later, second case for the same employee). So
// this function accepts EITHER an existing client's id (a returning
// client's next case) OR a name for a brand-new one (that client's first
// case) — never assumes the case creates its own compartment.
// ---------------------------------------------------------------------------

import { CASEWORK_CONTEXT_ID, vectrosApiClient } from './vectrosApi';
import type { EntityResponse, RecordResponse, Vectros } from './vectrosApi';

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
}

export interface CreateCaseResult {
  readonly case: RecordResponse;
  readonly folder: Vectros.FolderResponse;
  /** The client entity this case belongs to — newly created, or the one selected. */
  readonly client: EntityResponse;
}

/** `YYYY-MM-DD`, matching the schema-ui date-field convention (recordForm.ts). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A fresh, per-client identifier — this app's own idempotency key, never
 *  shown to the user (the client entity's `name` is the human-facing one). */
function generateClientExternalId(): string {
  return `client_${crypto.randomUUID()}`;
}

/** A fresh, per-case identifier — this is what `case_note.caseId`/
 *  `case_document.caseId` (both declared `fieldType: reference`,
 *  `targetField: externalId`) actually resolve against, per the platform's
 *  own reference mechanism (always resolves via a target's UNIQUE lookup,
 *  which defaults to `externalId` — there is no way to reference a record by
 *  its plain system id). Never shown to the user. */
function generateCaseExternalId(): string {
  return `case_${crypto.randomUUID()}`;
}

/**
 * Creates a case, its client entity (when needed), and its folder as one
 * logical operation. See this file's header for why it's three real HTTP
 * calls today, and why that's fine to paper over here rather than at every
 * call site.
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
          externalId: generateClientExternalId(),
          name: (input.newClientName ?? '').trim(),
          scopes: [orgScope],
        },
      });
  const clientId = clientEntity.id;
  if (!clientId) {
    throw new Error('createCase: the platform did not return an id for the client entity.');
  }
  const compartmentScope = `client:${clientId}`;

  // 2. Create the case's folder FIRST, in the SAME compartment — its id gets
  //    stamped onto the case record below (step 3), so the case can create
  //    it directly rather than needing a second PATCH once the folder exists.
  //    Folders can't bind a schema (no lookup fields), so this is the only
  //    way to later resolve "this case's own folder" in O(1) — see `case`
  //    schema's own `folderId` field description.
  const folder = await api.folders.createFolder({
    body: {
      name: input.folderName,
      ...(input.folderDescription ? { description: input.folderDescription } : {}),
      scopes: [orgScope, compartmentScope],
    },
  });

  // 3. Create the case directly in its full compartment, carrying its own
  //    folder's id.
  const created = await api.records.createRecord({
    body: {
      typeName: 'case',
      scopes: [orgScope, compartmentScope],
      // `externalId` is what `case_note.caseId`/`case_document.caseId`
      // (reference fields) actually resolve against — see
      // `generateCaseExternalId`'s own comment.
      externalId: generateCaseExternalId(),
      payload: {
        caseType: input.caseType,
        status: 'open',
        openedAt: today(),
        ...(input.assignedTo ? { assignedTo: input.assignedTo } : {}),
        ...(folder.id ? { folderId: folder.id } : {}),
      },
    },
  });

  return { case: created, folder, client: clientEntity };
}

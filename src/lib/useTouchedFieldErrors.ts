// ---------------------------------------------------------------------------
// useTouchedFieldErrors — filters a schema form's validation errors down to
// only the fields the caller has actually edited at least once.
//
// `validateFields(schemaFields, payload)` runs eagerly against whatever
// `payload` currently is — on a blank "create" form, that's `{}`, so every
// `required` field is a validation error from the very first render, before
// the user has typed or blurred anything (pre-release UX audit, finding
// UX-2). RecordFormFields itself is presentational and has no concept of
// "touched" — the fix belongs at each call site, which already owns the
// payload state this hook needs to key off of.
//
// The DISPLAYED errors are touched-gated; whether the form is actually valid
// is not — a caller's own `canSubmit` check should keep using the full,
// unfiltered `fieldErrors` (validateFields's own return value), same as
// before this hook existed. A create button correctly staying disabled on a
// still-blank required field is normal, expected behavior (the same
// disabled+tooltip pattern this app's other primary actions already use) —
// what's NOT normal is that field turning red before anyone touched it.
// ---------------------------------------------------------------------------

import { useState } from 'react';
import type { FieldErrors } from '@vectros-ai/react';

export interface TouchedFieldErrors {
  /** `fieldErrors`, filtered to only the fields `markTouched` has been called for — pass this to
   *  RecordFormFields's `errors` prop instead of the raw validateFields() result. */
  readonly visibleErrors: FieldErrors;
  /** Call from the form's own onChange handler, keyed by the field that changed. */
  readonly markTouched: (fieldId: string) => void;
  /** Clears touched state — call when the form/dialog resets (e.g. on close), so a reopened
   *  blank form doesn't inherit the previous attempt's touched set. */
  readonly reset: () => void;
}

export function useTouchedFieldErrors(fieldErrors: FieldErrors): TouchedFieldErrors {
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const visibleErrors = Object.fromEntries(
    Object.entries(fieldErrors).filter(([fieldId]) => touched.has(fieldId)),
  ) as FieldErrors;
  return {
    visibleErrors,
    markTouched: (fieldId: string) => setTouched((prev) => new Set(prev).add(fieldId)),
    reset: () => setTouched(new Set()),
  };
}
